import test from "node:test";
import assert from "node:assert/strict";
import { computePriceContext, priceTurnNote } from "../lib/priceLadder.js";

// Lỗi thật 11/11: sản phẩm thường (KHÔNG bán theo vỉ) có bảng giá mặc cả → priceTurnNote ném
// "ReferenceError: Cannot access 'qLabel' before initialization" → bot không trả lời được khách.
// Trước đó chỉ có test cho sản phẩm bán theo vỉ nên nhánh sản phẩm thường không ai chạy thử.

const skirt = {
  name: "Chân váy 3 tầng",
  priceLadder: [
    { qty: 1, list: "199k", steps: "199k, 195k", floor: "195k" },
    { qty: 2, list: "350k", steps: "350k", floor: "350k" },
  ],
};
const battery = {
  name: "Pin CR2032",
  unitName: "vỉ",
  unitSize: "5",
  priceLadder: [
    { qty: 1, list: "39k", steps: "39k", floor: "39k" },
    { qty: 2, list: "69k", steps: "69k", floor: "69k" },
  ],
};

const note = (product, customerNow, extra = {}) => {
  const ctx = computePriceContext({ product, outgoing: [], customerNow, customerRecent: [], lastShopText: "", ...extra });
  return { ctx, text: priceTurnNote(ctx) };
};

test("sản phẩm thường: mọi tình huống giá đều ra lời dặn, không văng lỗi", () => {
  const cases = {
    none: ["Chiều dài bn"], // khách chưa mặc cả (đúng ca trong nhật ký Vercel)
    step: ["bớt chút đi shop"], // xin bớt chung chung
    counter: ["150k được không shop"], // trả giá thấp hơn sàn
    accept: ["195k nha shop"], // đúng giá sàn
    unsupported: ["lấy 5 cái nha"], // số lượng không có trong bảng
  };
  for (const [kind, msgs] of Object.entries(cases)) {
    const { text } = note(skirt, msgs);
    assert.ok(text.length > 100, kind);
    assert.equal(text.includes("undefined"), false, kind);
  }
});

test("sản phẩm thường: số lượng ghi là \"N cái\" (không phải vỉ)", () => {
  const { ctx, text } = note(skirt, ["Chiều dài bn"]);
  assert.equal(ctx.pack, undefined);
  assert.match(text, /Số lượng khách đang nói tới: 1 cái/);
  assert.match(text, /thấp nhất cho 1 cái/);
  const two = note(skirt, ["lấy 2 cái nha"]);
  assert.match(two.text, /Số lượng khách đang nói tới: 2 cái/);
});

test("sản phẩm bán theo vỉ vẫn ghi \"2 vỉ (10 viên)\" như cũ", () => {
  const { ctx, text } = note(battery, ["Cho 10 viên"]);
  assert.equal(ctx.qty, 2);
  assert.match(text, /2 vỉ \(10 viên\)/);
  assert.equal(text.includes("2 cái"), false);
});

test("sản phẩm không có bảng giá → lời dặn rỗng, không lỗi", () => {
  const ctx = computePriceContext({ product: { name: "Áo" }, customerNow: ["giá bao nhiêu"] });
  assert.equal(ctx, null);
  assert.equal(priceTurnNote(ctx), "");
});
