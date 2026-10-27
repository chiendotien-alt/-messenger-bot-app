import test from "node:test";
import assert from "node:assert/strict";
import { productAttributes, attributeStatus, composeVariant, summaryDetail } from "../lib/attributes.js";

const product = {
  name: "Chân váy 3 tầng",
  attributes: [
    { name: "Màu", values: "Đen, Kem, Trắng, Hồng", how: "" },
    { name: "Size", values: "S, M, L", how: "theo chiều cao cân nặng" },
    { name: "Chiều dài", values: "75cm, 85cm, 92cm", how: "theo chiều cao" },
  ],
};
const attrs = productAttributes(product);
const by = (st, n) => st.list.find((x) => x.attr.name === n);
const advice = [
  { from: "customer", text: "Chị cao 1m60 nặng 55kg" },
  { from: "bot", text: "Dạ chị cao 1m60 nặng 55kg thì mặc size M dài 85cm là vừa đẹp ạ. Chị chọn màu nào ạ?" },
];

test("Shop vừa tư vấn, khách chưa nhắn gì → vẫn chỉ là gợi ý", () => {
  const st = attributeStatus(attrs, advice, [], "");
  assert.equal(by(st, "Size").state, "proposed");
  assert.equal(by(st, "Chiều dài").state, "proposed");
});

test("Khách chọn màu, không phản đối → size + chiều dài được ghi nhận, vào cả tin báo lẫn đơn lưu", () => {
  const st = attributeStatus(attrs, advice, ["Màu kem"], "");
  assert.deepEqual(by(st, "Size").picked, ["M"]);
  assert.equal(by(st, "Size").state, "chosen");
  assert.equal(by(st, "Chiều dài").state, "chosen");
  assert.equal(composeVariant(st), "Màu Kem, Size M, Chiều dài 85cm");
  assert.deepEqual(summaryDetail(st).specs, ["size M", "dài 85cm"]);
});

test("Khách gửi thẳng SĐT/địa chỉ → vẫn ghi nhận như cũ", () => {
  const st = attributeStatus(attrs, advice, ["Sđt 0904251427 Đc 12 Nguyễn Bỉnh Khiêm Hà Nội"], "");
  assert.equal(by(st, "Size").state, "chosen");
  assert.equal(by(st, "Chiều dài").state, "chosen");
});

test("Khách phản đối / đổi ý → KHÔNG ghi nhận số cũ", () => {
  const rej = attributeStatus(attrs, advice, ["Chị không lấy size M đâu"], "");
  assert.notEqual(by(rej, "Size").picked[0], "M");
  assert.notEqual(by(rej, "Size").state, "chosen");
  const change = attributeStatus(attrs, advice, ["Màu kem, mà chị lấy size L nha"], "");
  assert.deepEqual(by(change, "Size").picked, ["L"]);
});

test("Khách hỏi lại về size/chiều dài (nghi ngờ) → chưa chốt", () => {
  for (const q of ["Size M có chật không em?", "dài 85cm có dài quá không em", "vậy có vừa không em?"]) {
    const st = attributeStatus(attrs, advice, [q], "");
    assert.notEqual(by(st, "Size").state, "chosen", q);
  }
});

test("Màu là khách tự chọn: shop khen màu hợp mà khách không nói gì về màu → KHÔNG tự chốt màu", () => {
  const h = [
    { from: "customer", text: "Chị cao 1m60 nặng 55kg" },
    { from: "bot", text: "Dạ màu đen rất hợp với chị đó ạ, size M là vừa nha." },
  ];
  const st = attributeStatus(attrs, h, ["Ship về Hà Nội mấy ngày vậy em"], "");
  assert.notEqual(by(st, "Màu").state, "chosen");
});
