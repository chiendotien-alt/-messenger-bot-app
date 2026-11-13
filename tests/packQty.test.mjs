import test from "node:test";
import assert from "node:assert/strict";
import { packConfig, detectPackQty, packLabel } from "../lib/packQty.js";
import { computePriceContext, priceTurnNote, buildSummaryText, buildOrderMessages, qtyHintFromTexts } from "../lib/priceLadder.js";
import { deriveOrderFacts, customerQtyHint } from "../lib/orderFacts.js";

// Sản phẩm thật: Pin CR2032 bán theo vỉ (5 viên/vỉ), bảng giá tính theo vỉ (ảnh cài đặt của chủ shop)
const base = {
  name: "Pin CR2032",
  description: "mỗi vỉ gồm 5 viên pin\n2 vỉ(10 Viên): 69K\n3 vỉ(15 Viên): 79K\n4 vỉ(20 Viên): 89K\n5 vỉ(25 Viên): 99K\nMiễn phí vận chuyển toàn quốc",
  priceLadder: [
    { qty: "2", list: "69k", steps: "", floor: "" },
    { qty: "3", list: "79k", steps: "75k", floor: "75k" },
    { qty: "4", list: "89k", steps: "85k", floor: "85k" },
    { qty: "5", list: "99k", steps: "95k", floor: "95k" },
  ],
};
const pack = { ...base, unitName: "vỉ", unitSize: "5" };
const quoted = [{ from: "bot", text: "2 vỉ(10 Viên): 69K\n3 vỉ(15 Viên): 79K\n4 vỉ(20 Viên): 89K\n5 vỉ(25 Viên): 99K\nĐã bao gồm phí vận chuyển" }];

test("packConfig: chỉ bật khi điền đủ đơn vị + số lượng mỗi gói", () => {
  assert.equal(packConfig(base), null);
  assert.equal(packConfig({ ...base, unitName: "vỉ" }), null);
  assert.equal(packConfig({ ...base, unitSize: "5" }), null);
  assert.equal(packConfig({ ...base, unitName: "vỉ", unitSize: "1" }), null);
  const c = packConfig(pack);
  assert.deepEqual([c.unit, c.size, c.sub], ["vỉ", 5, "viên"]);
  assert.equal(packLabel(2, c), "2 vỉ (10 viên)");
});

test("đọc số lượng theo vỉ / viên", () => {
  const c = packConfig(pack);
  assert.deepEqual(detectPackQty("Cho 10 viên", c), { packs: 2, pieces: 10, exact: true });
  assert.deepEqual(detectPackQty("lấy 3 vỉ", c), { packs: 3, pieces: 15, exact: true });
  assert.deepEqual(detectPackQty("hai vỉ nhé", c), { packs: 2, pieces: 10, exact: true });
  assert.deepEqual(detectPackQty("cho anh 20 vien", c), { packs: 4, pieces: 20, exact: true });
  assert.deepEqual(detectPackQty("2 vỉ 10 viên", c), { packs: 2, pieces: 10, exact: true });
  assert.deepEqual(detectPackQty("Cho 7 viên", c), { exact: false, pieces: 7, low: 1, high: 2 });
  assert.equal(detectPackQty("mình lấy màu đen", c), null);
  assert.equal(detectPackQty("0382383850 âu cơ thuận thành", c), null);
});

test("CHUYỆN THẬT: khách 'Cho 10 viên' → 2 vỉ, giá 69k (trước đây ra SL:10 và không có giá)", () => {
  const ctx = computePriceContext({ product: pack, outgoing: quoted, customerNow: ["Cho 10 viên"] });
  assert.equal(ctx.qty, 2);
  assert.equal(ctx.row.list, 69000);
  assert.equal(ctx.dealTotal, 69000);
  assert.equal(ctx.decision.type, "none");
});

test("tin báo đơn ghi 'SL:2 vỉ (10 viên)' và có tổng tiền freeship", () => {
  const ctx = computePriceContext({ product: pack, outgoing: quoted, customerNow: ["Cho 10 viên"] });
  const text = buildSummaryText({ product: pack, ctx, info: { phone: "0382383850", address: "âu cơ thuận thành" }, kh: "anh", tu: "em", hintQty: 2 });
  assert.match(text, /SL:2 vỉ \(10 viên\)/);
  assert.match(text, /Tổng tiền: 69k \(freeship\)/);
  const msgs = buildOrderMessages({ product: pack, ctx, info: { phone: "0382383850", address: "âu cơ thuận thành" }, kh: "anh", tu: "em", hintQty: 2 });
  assert.ok(msgs && /SL:2 vỉ \(10 viên\)/.test(msgs.block));
});

test("đơn lưu vào hệ thống: số lượng 2 vỉ, tổng 69k", () => {
  const messages = [
    { from: "bot", text: quoted[0].text },
    { from: "bot", text: "Không biết anh mua mấy vỉ ạ ?" },
    { from: "customer", text: "Cho 10 viên" },
    { from: "bot", text: "dạ anh cho em xin số điện thoại và địa chỉ nhận hàng để em lên đơn 2 vỉ 10 viên giá 69k nhé ạ" },
    { from: "customer", text: "0382383850 âu cơ thuận thành" },
  ];
  const f = deriveOrderFacts({ product: pack, messages });
  assert.equal(f.quantity, 2);
  assert.equal(f.dealTotal, 69000);
});

test("khách nói 3 vỉ / 15 viên → dòng 3 vỉ, giá 79k", () => {
  for (const t of ["lấy 3 vỉ", "cho 15 viên"]) {
    const ctx = computePriceContext({ product: pack, outgoing: quoted, customerNow: [t] });
    assert.equal(ctx.qty, 3, t);
    assert.equal(ctx.dealTotal, 79000, t);
  }
});

test("số viên không tròn vỉ (7 viên) → hỏi lại, không tự chọn, chưa báo giá", () => {
  const ctx = computePriceContext({ product: pack, outgoing: quoted, customerNow: ["Cho 7 viên"] });
  assert.deepEqual([ctx.packAmbig.low, ctx.packAmbig.high], [1, 2]);
  assert.match(priceTurnNote(ctx), /HỎI LẠI khách lấy 1 vỉ \(5 viên\) hay 2 vỉ \(10 viên\)/);
  const ctx2 = computePriceContext({ product: pack, outgoing: quoted, customerNow: ["Cho 3 viên"] });
  assert.match(priceTurnNote(ctx2), /HỎI LẠI khách lấy 1 vỉ \(5 viên\)/);
});

test("khách đổi ý: tin vỉ/viên mới nhất quyết định", () => {
  const ctx = computePriceContext({ product: pack, outgoing: quoted, customerNow: ["lấy 5 vỉ", "thôi cho 15 viên"] });
  assert.equal(ctx.qty, 3);
});

test("sản phẩm KHÔNG cấu hình bán theo gói: giữ nguyên cách cũ", () => {
  const a = computePriceContext({ product: base, outgoing: quoted, customerNow: ["lấy 2 cái"] });
  assert.equal(a.qty, 2);
  assert.equal(a.dealTotal, 69000);
  assert.equal(a.pack, undefined);
  const b = computePriceContext({ product: base, outgoing: quoted, customerNow: ["Cho 10 viên"] });
  assert.equal(b.qty, 10); // đúng như cũ (chủ shop chưa bật bán theo vỉ)
  assert.equal(b.decision.type, "unsupported");
  assert.doesNotMatch(buildSummaryText({ product: base, ctx: a, info: { phone: "0382383850", address: "Hà Nội" }, hintQty: 2 }), /vỉ/);
  assert.equal(customerQtyHint(["Cho 10 viên"], base), 10);
  assert.equal(customerQtyHint(["Cho 10 viên"], pack), 2);
  assert.deepEqual(qtyHintFromTexts(["lấy 2 cái"], base), { qty: 2, ambig: null });
});

test("bot hỏi 'mấy vỉ' kiểu nào, khách đáp trơn '2' cũng hiểu là 2 vỉ", async () => {
  const { qtyFromReplies } = await import("../lib/orderFacts.js");
  for (const ask of ["Không biết anh mua mấy vỉ ạ ?", "Anh cần mấy vỉ ạ?", "Anh đặt mấy vỉ ạ", "Anh lấy mấy vỉ nhỉ", "Mình dùng bao nhiêu vỉ ạ"]) {
    assert.equal(qtyFromReplies([{ from: "bot", text: ask }, { from: "customer", text: "2" }]), 2, ask);
  }
  // câu hỏi không phải hỏi số lượng thì không đổi
  assert.equal(qtyFromReplies([{ from: "bot", text: "Anh cho em xin địa chỉ ạ?" }, { from: "customer", text: "2" }]), null);
});

test("khách nói '2 vỉ' bằng nhiều cách → đều ra 2 vỉ, 69k", () => {
  for (const t of ["2 vỉ", "2 vi", "2vỉ", "cho 2 vỉ", "báo 2 vỉ nhé", "lấy 2 vỉ nha shop", "hai vỉ", "2 vỉ 10 viên"]) {
    const ctx = computePriceContext({ product: pack, outgoing: quoted, customerNow: [t] });
    assert.equal(ctx.qty, 2, t);
    assert.equal(ctx.dealTotal, 69000, t);
  }
});
