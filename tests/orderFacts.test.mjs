import test from "node:test";
import assert from "node:assert/strict";
import { deriveOrderFacts, validateOrder } from "../lib/orderFacts.js";
import { productAttributes, attributeStatus, summaryDetail } from "../lib/attributes.js";
import { buildSummaryText, buildOrderMessages, summaryQty } from "../lib/priceLadder.js";

// Sản phẩm có bảng thuộc tính + bảng giá mặc cả (1 cái 199k, 2 cái 350k, 3 cái 480k)
const product = {
  name: "Chân váy 3 tầng",
  shipFee: 0,
  attributes: [
    { name: "Màu", values: "Đen, Kem, Trắng, Hồng", how: "" },
    { name: "Size", values: "S, M, L", how: "theo chiều cao cân nặng" },
    { name: "Chiều dài", values: "75cm, 85cm, 92cm", how: "theo chiều cao" },
  ],
  priceLadder: [
    { qty: 1, list: "199k", steps: "199k", floor: "199k" },
    { qty: 2, list: "350k", steps: "350k", floor: "350k" },
    { qty: 3, list: "480k", steps: "480k", floor: "480k" },
  ],
};
const noLadder = { ...product, priceLadder: undefined };

const chat = (...c) => c.map(([from, text]) => ({ from, text }));
const lenAndSize = [
  ["customer", "Chân váy bên em có 8 màu không?"],
  ["bot", "Dạ chị cho em xin chiều cao cân nặng để em chọn váy nha."],
  ["customer", "size S"],
  ["bot", "Dạ chị chọn size S, thế chị cao tầm mét mấy ạ?"],
  ["customer", "70cm"],
  ["bot", "Dạ chiều dài bên em có 75cm, 85cm và 92cm ạ. Ý chị là chọn chiều dài 75cm đúng không chị?"],
  ["customer", "Đúng rồi"],
];

test("hạ tầng: sản phẩm test có bảng giá hợp lệ", async () => {
  const { hasLadder } = await import("../lib/priceLadder.js");
  assert.equal(hasLadder(product), true);
});

test("D: đặt 2 chiếc (2 màu) → tin báo SL:2 và đơn lưu quantity = 2, chiều dài 75cm nằm trong cả hai", () => {
  const messages = chat(...lenAndSize, ["bot", "Dạ chị lấy màu nào ạ?"], ["customer", "1 đen 1 kem"]);
  const facts = deriveOrderFacts({ product, messages, variantText: "" });
  assert.equal(facts.quantity, 2);
  assert.match(facts.variant, /Chiều dài 75cm/);
  assert.match(facts.variant, /Size S/);
  assert.equal(facts.variant.includes("70"), false);
  // tin báo đơn dựng từ CÙNG dữ liệu
  const block = buildSummaryText({ product, ctx: facts.ctx, info: { phone: "0912345678", address: "12 Lê Lợi, Quận 1, TP HCM" }, kh: "chị", tu: "em", detail: facts.detail, hintQty: facts.hintQty });
  assert.match(block, /SL:2/);
  assert.match(block, /dài 75cm/);
  assert.equal(Number((block.match(/SL:(\d+)/) || [])[1]), facts.quantity);
});

test("D2: khách nói '2 cái' với 1 màu → SL 2 ở cả tin báo và dữ liệu lưu", () => {
  const messages = chat(...lenAndSize, ["bot", "Dạ chị lấy màu nào ạ?"], ["customer", "lấy 2 cái màu đen"]);
  for (const p of [product, noLadder]) {
    const f = deriveOrderFacts({ product: p, messages, variantText: "" });
    assert.equal(f.quantity, 2, p === product ? "có bảng giá" : "không bảng giá");
    const block = buildSummaryText({ product: p, ctx: f.ctx, info: { phone: "0912345678", address: "12 Lê Lợi, Quận 1, TP HCM" }, kh: "chị", tu: "em", detail: f.detail, hintQty: f.hintQty, noPrice: !f.ctx });
    assert.equal(Number((block.match(/SL:(\d+)/) || [])[1]), 2);
  }
});

test("E: đặt 3 chiếc → quantity = 3 ở mọi nơi", () => {
  const messages = chat(...lenAndSize, ["bot", "Dạ chị lấy màu nào ạ?"], ["customer", "lấy 3 cái màu trắng"]);
  const f = deriveOrderFacts({ product: noLadder, messages, variantText: "" });
  assert.equal(f.quantity, 3);
  assert.equal(f.qtySource, "customer");
  const f2 = deriveOrderFacts({ product, messages, variantText: "" });
  assert.equal(f2.quantity, 3);
  assert.equal(f2.unitPrice * 3, f2.dealTotal > 0 ? f2.dealTotal : f2.unitPrice * 3);
});

test("F: nhiều biến thể — mỗi màu có số lượng riêng, không gộp nhầm", () => {
  const messages = chat(...lenAndSize, ["bot", "Dạ chị lấy màu nào ạ?"], ["customer", "2 đen 1 kem"]);
  const f = deriveOrderFacts({ product, messages, variantText: "" });
  assert.equal(f.quantity, 3);
  assert.deepEqual(f.lines.map((l) => [l.color, l.qty]), [["Đen", 2], ["Kem", 1]]);
  assert.match(f.variant, /Màu Đen x2 \+ Kem/);
  const block = buildSummaryText({ product, ctx: f.ctx, info: { phone: "0912345678", address: "12 Lê Lợi, Quận 1, TP HCM" }, kh: "chị", tu: "em", detail: f.detail, hintQty: f.hintQty });
  assert.match(block, /Màu đen x2 \+ kem x1/);
  assert.match(block, /SL:3/);
});

test("G: thiếu thông tin → không tự chốt (chưa ready, có cảnh báo)", () => {
  // khách nói 70cm nhưng chưa xác nhận
  const m1 = chat(...lenAndSize.slice(0, 5), ["bot", "Dạ chiều dài bên em có 75cm..."], ["customer", "lấy màu đen"]);
  const f1 = deriveOrderFacts({ product, messages: m1, variantText: "" });
  assert.equal(f1.ready, false);
  assert.equal(f1.variant.includes("Chiều dài"), false);
  assert.ok(f1.issues.some((i) => i.code === "needs_confirm"));
  // chưa nói số lượng → mặc định chỉ được đánh dấu là "default"
  const m2 = chat(...lenAndSize, ["bot", "Dạ chị lấy màu nào ạ?"], ["customer", "màu đen"]);
  const f2 = deriveOrderFacts({ product: noLadder, messages: m2, variantText: "" });
  assert.equal(f2.qtySource, "default");
  assert.equal(f2.ready, true);
});

test("khách nói tổng số cái khác tổng các màu → báo mâu thuẫn, không tự chọn", () => {
  const messages = chat(...lenAndSize, ["bot", "Dạ chị lấy màu nào ạ?"], ["customer", "lấy 3 cái, 1 đen 1 kem"]);
  const f = deriveOrderFacts({ product: noLadder, messages, variantText: "" });
  assert.equal(f.qtyConflict, true);
});

test("số lượng của sản phẩm trước không áp sang sản phẩm khác (mỗi lần tính từ đúng sản phẩm + chat)", () => {
  const other = { name: "Áo thun", attributes: [{ name: "Màu", values: "Đen, Trắng", how: "" }] };
  const f = deriveOrderFacts({ product: other, messages: chat(["customer", "áo màu đen"]), variantText: "" });
  assert.equal(f.quantity, 1);
  assert.equal(f.qtySource, "default");
});

test("validateOrder: số lượng sai bị chặn, chiều dài lạ bị cảnh báo", () => {
  assert.equal(validateOrder({ quantity: 0 }, product).errors.length, 1);
  assert.equal(validateOrder({ quantity: "abc" }, product).errors.length, 1);
  assert.equal(validateOrder({ quantity: 2, variant: "Màu Đen, Chiều dài 75cm, Size S" }, product).warnings.length, 0);
  assert.equal(validateOrder({ quantity: 2, variant: "Màu Đen, Chiều dài 70cm, Size S" }, product).warnings.length, 1);
});

test("buildOrderMessages: tin báo đơn có đủ chiều dài + SL", () => {
  const messages = chat(...lenAndSize, ["bot", "Dạ chị lấy màu nào ạ?"], ["customer", "1 đen 1 kem"]);
  const f = deriveOrderFacts({ product, messages, variantText: "" });
  const out = buildOrderMessages({ product, ctx: f.ctx, info: { phone: "0912345678", address: "12 Lê Lợi, Quận 1, TP HCM" }, kh: "chị", tu: "em", detail: f.detail, hintQty: f.hintQty });
  assert.match(out.messages[0], /dài 75cm/);
  assert.match(out.messages[0], /SL:2/);
});
