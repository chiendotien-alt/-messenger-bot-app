import test from "node:test";
import assert from "node:assert/strict";
import { productAttributes, attributeStatus, attributesComplete } from "../lib/attributes.js";
import { buildAdviceConfirm } from "../lib/adviceConfirm.js";

const B = (text) => ({ from: "bot", text });
const C = (text) => ({ from: "customer", text });
const product = {
  name: "Chân váy 3 tầng", description: "x",
  priceLadder: [{ qty: 1, list: "195k", steps: "", floor: "195k" }, { qty: 2, list: "360k", steps: "", floor: "360k" }],
  attributes: [
    { name: "Màu", values: "Trắng, Đen, Kem, Vàng, Xanh, Hồng, Đỏ đô, Cam Đất", how: "" },
    { name: "Size", values: "S, M, L, XL, 2XL", how: "theo chiều cao cân nặng" },
    { name: "Chiều dài váy", values: "75cm, 85cm, 92cm", how: "theo chiều cao" },
  ],
};
const attrs = productAttributes(product);

// Cuộc chat thật (khách gửi SĐT + địa chỉ TRƯỚC khi nói chiều cao)
const before = [
  C("Giá sản phẩm ?"), B("Bên em có chương trình giảm giá: 1 váy: 195K + Miễn phí Ship"),
  B("Chân váy bên em có 8 màu không biết chị chọn được màu nào chưa ạ ?"),
  C("Size S màu vàng"), C("1 cái"),
  B("Dạ em lấy chân váy màu vàng size S cho chị nha."), B("Em xin chiều cao để chọn chiều dài váy nha chị?"),
  C("Liêm Lợi 2,xã nhơn phong thị xã an nhơn tỉnh bình định.0979868312"),
  B("Chị cao tầm mét mấy ạ?"),
];
const burst = ["1 m52", "Nặng 43 kg"];
const advice = "Dạ chị cao 1m52 thì mặc chân váy dài 85cm là vừa đẹp ạ.";

test("khách đã gửi SĐT+địa chỉ, AI tư vấn dài 85cm mà không có câu hỏi → thêm câu xin chốt", () => {
  const st = attributeStatus(attrs, before, burst, "");
  assert.deepEqual(st.list.map((x) => x.state), ["chosen", "chosen", "measured"]);
  const q = buildAdviceConfirm({ status: st, messages: [advice], haveContact: true, kh: "chị", tu: "em" });
  assert.equal(q, "Vậy em lên đơn chiều dài váy 85cm cho chị nha?");
});

test("khách trả lời 'ok' → đủ thuộc tính để hệ thống ghép đơn", () => {
  const after = [...before, ...burst.map(C), B(advice), B("Vậy em lên đơn chiều dài váy 85cm cho chị nha?")];
  const st = attributeStatus(attrs, after, ["ok"], "");
  assert.equal(attributesComplete(st), true);
});

test("không chen vào khi: chưa đủ SĐT/địa chỉ, AI đã có câu hỏi, còn thiếu màu/size, AI chưa nói rõ giá trị", () => {
  const st = attributeStatus(attrs, before, burst, "");
  const ok = { status: st, haveContact: true };
  assert.equal(buildAdviceConfirm({ ...ok, messages: [advice], haveContact: false }), null);
  assert.equal(buildAdviceConfirm({ ...ok, messages: [advice + " Chị lấy màu gì ạ?"] }), null);
  assert.equal(buildAdviceConfirm({ ...ok, messages: ["Dạ vâng ạ."] }), null);
  const stMissing = attributeStatus(attrs, [C("Giá sản phẩm ?"), B("Chân váy bên em có 8 màu không biết chị chọn được màu nào chưa ạ ?"), C("Liêm Lợi 2 an nhơn bình định 0979868312")], burst, "");
  assert.equal(buildAdviceConfirm({ status: stMissing, messages: [advice], haveContact: true }), null);
});

test("không hỏi lặp nếu vừa hỏi chốt đúng giá trị đó", () => {
  const st = attributeStatus(attrs, before, burst, "");
  const q = buildAdviceConfirm({ status: st, messages: [advice], haveContact: true, recentBotTexts: ["Vậy em lên đơn chiều dài váy 85cm cho chị nha?"] });
  assert.equal(q, null);
});
