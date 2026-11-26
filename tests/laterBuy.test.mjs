// Lỗi 25/11/2026: khách nói "Về mặc đẹp thì mua thêm cái màu trắng" (chưa đặt) mà bot ghi luôn màu trắng, đơn thành 2 váy 360k.
import test from "node:test";
import assert from "node:assert/strict";
import { splitLaterBuy, hasLaterBuy, dropLaterBuy, laterBuyTurnNote } from "../lib/laterBuy.js";
import { productAttributes, attributeStatus, colorCount, summaryDetail } from "../lib/attributes.js";
import { deriveOrderFacts } from "../lib/orderFacts.js";

const B = (text) => ({ from: "bot", text });
const C = (text) => ({ from: "customer", text });

test("nhận ra 'mua thêm' có điều kiện / để sau", () => {
  for (const t of [
    "Về mặt đẹp thì mua thêm cái màu trắng",
    "Nhận về mặt đẹp mới mua thêm màu trắng",
    "vẻ mặc đẹp thì mua thêm cái màu trắng", // bản AI viết lại chính tả
    "Ưng thì lấy thêm cái trắng nha",
    "Nếu đẹp mình lấy thêm màu trắng",
    "Nếu đẹp, mua thêm màu trắng",
    "Lần sau mình mua thêm",
  ]) assert.equal(hasLaterBuy(t), true, t);
});

test("KHÔNG nhầm: mua thêm bình thường, điều kiện về giá, khen rồi chọn ngay", () => {
  for (const t of [
    "Lấy thêm cái màu trắng nữa",
    "Cho chị mua thêm 1 cái trắng",
    "Bớt thì mua thêm",
    "Miễn ship thì mình lấy thêm",
    "Đẹp, lấy màu đen",
    "Váy đẹp thì lấy màu đen",
    "Lấy màu đen loại 75cm",
    "Nhận hàng thanh toán sau nha",
    "Cho kiểm tra hàng trước khi nhận không",
  ]) assert.equal(hasLaterBuy(t), false, t);
});

test("tin có cả phần chọn thật lẫn vế mua thêm: chỉ bỏ vế mua thêm", () => {
  assert.equal(dropLaterBuy("Lấy màu đen, đẹp thì mua thêm màu trắng"), "Lấy màu đen,");
  assert.equal(dropLaterBuy("Lấy màu đen loại 75cm"), "Lấy màu đen loại 75cm");
  assert.equal(splitLaterBuy("").text, "");
});

test("ghi chú dặn AI chỉ có khi có vế mua thêm có điều kiện", () => {
  assert.equal(laterBuyTurnNote(["Lấy màu đen"]), "");
  assert.match(laterBuyTurnNote(["Về mặt đẹp thì mua thêm cái màu trắng"]), /KHÔNG ghi món/);
});

const product = {
  name: "Chân váy 3 tầng",
  attributes: [
    { name: "Size", values: "S, M, L, XL, 2XL", how: "Theo cân nặng S: 37-46kg M:47–53kg L: 54–60kg XL: 61–67kg 2XL: 68–75kg" },
    { name: "Chiều dài váy", values: "75cm, 85cm, 92cm", how: "Theo chiều cao 75cm:phù hợp khách cao từ 1m40 đến 1m50. 85cm: phù hợp khách cao từ 1m51 đến 1m64. 92cm: phù hợp khách cao từ 1m65 trở lên." },
    { name: "màu", values: "Trắng, Đen, Kem, Vàng, Xanh, Hồng, Đỏ đô, Cam Đất", how: "Khách tự chọn hoặc khách bảo tư vấn" },
  ],
};
const attrs = productAttributes(product);
const colorIdx = attrs.findIndex((a) => a.name === "màu");
const history = [
  B("Dạ chị cho em xin chiều cao cân nặng để em chọn váy nha?"),
  C("Cao 145 nặng 59"),
  B("Dạ chị cao 1m45 nặng 59kg thì mình mặc size L và lấy chân váy dài 75cm là vừa đẹp ạ."),
  C("XL là đc"),
  B("Dạ em lấy chân váy màu kem size XL cho chị nha."),
  C("Lấy màu đen loại 75cm"),
  B("Dạ em lấy chân váy màu đen dài 75cm cho chị nha."),
];

test("LỖI THẬT: 'Về mặt đẹp thì mua thêm cái màu trắng' → màu trắng KHÔNG vào đơn, vẫn chỉ 1 màu đen", () => {
  const st = attributeStatus(attrs, history, ["Về mặt đẹp thì mua thêm cái màu trắng"], "");
  assert.deepEqual(st.list[colorIdx].picked, ["Đen"]);
  assert.equal(colorCount(st), 1);
});

test("LỖI THẬT: 'Nhận về mặt đẹp mới mua thêm màu trắng' (tin đã nằm trong lịch sử) → vẫn chỉ màu đen", () => {
  const h = [...history, C("Về mặt đẹp thì mua thêm cái màu trắng"), C("Nhận về mặt đẹp mới mua thêm màu trắng")];
  const st = attributeStatus(attrs, h, ["546 đường liên ấp 26 Vĩnh Lộc A thành phố Hồ Chí Minh 0932658930"], "");
  assert.deepEqual(st.list[colorIdx].picked, ["Đen"]);
});

test("khách THẬT SỰ lấy thêm màu trắng ('lấy thêm cái trắng nữa') vẫn được ghi", () => {
  const st = attributeStatus(attrs, history, ["Lấy thêm cái màu trắng nữa"], "");
  assert.deepEqual(st.list[colorIdx].picked.slice().sort(), ["Trắng", "Đen"].sort());
});

test("đơn lưu / tin báo đơn (deriveOrderFacts): 1 váy đen, không có màu trắng", () => {
  const messages = [
    ...history,
    C("Về mặt đẹp thì mua thêm cái màu trắng"),
    B("Dạ chị cho em xin số điện thoại và địa chỉ nhận nhận hàng để em lên đơn nhé."),
    C("546 đường liên ấp 26 Vĩnh Lộc A thành phố Hồ Chí Minh 0932658930"),
  ];
  const facts = deriveOrderFacts({ product, messages });
  assert.equal(facts.quantity, 1);
  const colors = (facts.lines || []).map((l) => String(l.color || ""));
  assert.ok(!colors.some((c) => /trắng/i.test(c)), JSON.stringify(facts.lines));
});
