// Test H — hồi quy: các hành vi cũ của bảng thuộc tính / tin báo đơn vẫn như trước
import test from "node:test";
import assert from "node:assert/strict";
import { productAttributes, attributeStatus, composeVariant, nextAttrToAsk, summaryDetail } from "../lib/attributes.js";
import { buildSummaryText } from "../lib/priceLadder.js";

const attrs = productAttributes({
  name: "Chân váy",
  attributes: [
    { name: "Màu", values: "Đen, Kem, Trắng, Xanh", how: "" },
    { name: "Size", values: "S, M, L", how: "theo chiều cao cân nặng" },
    { name: "Chiều dài", values: "75cm, 85cm, 92cm", how: "theo chiều cao" },
  ],
});
const by = (st, n) => st.list.find((x) => x.attr.name === n);

test("khách tự chọn đủ màu, size, dài → ready, variant đủ", () => {
  const st = attributeStatus(attrs, [], ["màu đen size M dài 85cm"], "");
  assert.ok(st.list.every((x) => x.state === "chosen"));
  assert.equal(composeVariant(st), "Màu Đen, Size M, Chiều dài 85cm");
});

test("thêm màu → cộng vào màu đã chọn", () => {
  const h = [{ from: "customer", text: "màu đen" }];
  const st = attributeStatus(attrs, h, ["thêm màu xanh"], "");
  assert.deepEqual(by(st, "Màu").picked.sort(), ["Xanh", "Đen"].sort());
});

test("'không lấy dài 85cm đâu' vẫn là từ chối (không bị hiểu thành chọn, cũng không nảy ra hỏi xác nhận)", () => {
  const h = [{ from: "bot", text: "Chị cao 1m60 thì mặc dài 85cm là vừa đẹp nha" }];
  const st = attributeStatus(attrs, h, ["Mình không lấy dài 85cm đâu shop"], "");
  assert.notEqual(by(st, "Chiều dài").state, "chosen");
  assert.notEqual(by(st, "Chiều dài").state, "confirm");
  assert.equal(st.refusals.length, 1);
});

test("khách đưa chiều cao/cân nặng → vẫn là 'measured', không phải chiều dài lạ", () => {
  const st = attributeStatus(attrs, [], ["mình cao 1m60 nặng 52kg"], "");
  assert.equal(by(st, "Chiều dài").state, "measured");
  assert.equal(by(st, "Size").state, "measured");
});

test("nextAttrToAsk vẫn hỏi mục thiếu theo thứ tự bảng", () => {
  const st = attributeStatus(attrs, [], ["màu đen"], "");
  assert.equal(nextAttrToAsk(st).attr.name, "Size");
});

test("tin báo đơn sản phẩm KHÔNG có bảng thuộc tính vẫn đủ SĐT/địa chỉ/SL (hồi quy)", () => {
  const t = buildSummaryText({ product: { name: "Váy" }, ctx: null, info: { phone: "0912345678", address: "12 le loi q1 hcm", variant: "đen, size M" }, kh: "chị", tu: "em", noPrice: true });
  assert.match(t, /Váy/);
  assert.match(t, /đen, size M, SL:1/);
  assert.match(t, /SĐT 0912345678/);
});

test("1 màu 1 cái: tin báo đơn như cũ 'Màu đen, size M, dài 85cm, SL:1'", () => {
  const st = attributeStatus(attrs, [], ["màu đen size M dài 85cm"], "");
  const t = buildSummaryText({ product: { name: "Chân váy" }, ctx: null, info: { phone: "0912345678", address: "12 le loi q1 hcm" }, kh: "chị", tu: "em", noPrice: true, detail: summaryDetail(st, 1) });
  assert.match(t, /Màu đen, size M, dài 85cm, SL:1/);
});

// ---- Hồi quy: số nhà "294" bị hiểu là giá 294k → đơn SL:2 (30/10) ----
import { computePriceContext, amountsIn, looksLikeContactText } from "../lib/priceLadder.js";
const ladderProduct = { priceLadder: [
  { qty: 1, list: "199k", steps: "175k", floor: "175k" },
  { qty: 2, list: "380k", steps: "350k;330k", floor: "330k" },
] };
const shopQuote = "Dạ em giảm cho chị còn 175k một chân váy và vẫn miễn phí ship nha chị.";
const addrMsg = "hoàng thị loan ,tổ 2 sn 294 việt quang tt bắc quang tỉnh hà giang dt0363001633";
const priceCtx = (now, recent = []) => computePriceContext({
  product: ladderProduct,
  outgoing: [{ from: "bot", text: shopQuote }],
  customerNow: [now], customerRecent: [now, ...recent], lastShopText: shopQuote,
});

test("tin SĐT + địa chỉ: số nhà 294 KHÔNG bị hiểu là giá, số lượng vẫn là 1", () => {
  assert.equal(looksLikeContactText(addrMsg), true);
  const ctx = priceCtx(addrMsg, ["có giảm giá ko", "màu trắng"]);
  assert.equal(ctx.qty, 1);
  assert.equal(ctx.offer, null);
  assert.notEqual(ctx.decision.type, "counter");
});

test("địa chỉ viết khác nhau (sn/số nhà/ngõ) đều không thành giá", () => {
  for (const t of ["sn 294 đường lê lợi hà giang 0363001633", "số nhà 185 ngõ 3 tt bắc quang", "giao 175 nguyễn trãi sdt 0912345678"]) {
    assert.equal(priceCtx(t).offer, null, t);
    assert.equal(priceCtx(t).qty, 1, t);
  }
});

test("khách CHƯA nói số lượng mà trả giá trùng khoảng dòng 2 cái → vẫn tính 1 cái, không tự nhảy sang 2", () => {
  const ctx = priceCtx("350k nha shop");
  assert.equal(ctx.qty, 1);
});

test("khách nói rõ '2 cái' + giá → vẫn tính dòng 2 cái như cũ", () => {
  const ctx = priceCtx("lấy 2 cái 350k nha shop");
  assert.equal(ctx.qty, 2);
  assert.equal(ctx.offer, 350000);
});

test("mặc cả thật vẫn hoạt động: 'bớt còn 170k' → hiểu là đề nghị giá", () => {
  const ctx = priceCtx("bớt còn 170k đi shop");
  assert.equal(ctx.qty, 1);
  assert.equal(ctx.offer, 170000);
});
