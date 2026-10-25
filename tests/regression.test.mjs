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
