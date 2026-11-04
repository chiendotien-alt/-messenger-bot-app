import test from "node:test";
import assert from "node:assert/strict";
import { deriveOrderFacts, qtyFromReplies } from "../lib/orderFacts.js";
import { productAttributes, attributeStatus, attributesComplete, dropQuestionClauses } from "../lib/attributes.js";
import { detectQty } from "../lib/priceLadder.js";

// Bộ kiểm tra "khách nhắn kiểu gì cũng phải đọc đúng đơn": ~170 tình huống thật (gõ tắt, không dấu, địa chỉ có số / tên đường trùng tên màu,
// vừa chọn vừa hỏi, đổi ý, hỏi ship/đổi trả, số đo trùng chiều dài, số lượng...). Mỗi ca có đáp án đúng viết sẵn.
const C = (text) => ({ from: "customer", text });
const B = (text) => ({ from: "bot", text });
const product = {
  name: "Chân váy 3 tầng", description: "Chân váy 3 tầng, miễn phí ship",
  priceLadder: [{ qty: 1, list: "185k", steps: "", floor: "185k" }, { qty: 2, list: "350k", steps: "", floor: "350k" }, { qty: 3, list: "520k", steps: "", floor: "520k" }],
  attributes: [
    { name: "Màu", values: "Trắng, Đen, Kem, Vàng, Xanh, Hồng, Đỏ đô, Cam Đất", how: "" },
    { name: "Size", values: "S, M, L, XL, 2XL", how: "theo cân nặng" },
    { name: "Chiều dài", values: "75cm, 85cm, 92cm", how: "theo chiều cao" },
  ],
};
// Mở đầu chuẩn: shop hỏi số đo, khách trả lời, shop tư vấn size L + dài 85cm rồi hỏi màu
const lead = (w = "58kg", h = "1m54") => [
  B("Em xin chiều cao cân nặng của chị nhá"), C(w),
  B("Dạ chị nặng 58kg thì mình mặc size L ạ."), B("Em xin chiều cao để chọn chiều dài váy nha chị?"), C(h),
  B("Dạ chị cao 1m54 thì mặc chân váy dài 85cm là vừa đẹp ạ."), B("Chị ưng màu nào bên em chưa ạ?"),
];
const askContact = [B("dạ em lấy chân váy cho chị nha."), B("chị cho em xin số điện thoại và địa chỉ nhận hàng để em lên đơn nhé ạ.")];

const V = (color, size = "L", len = "85cm") => `Màu ${color}, Size ${size}, Chiều dài ${len}`;
const tailC = [...askContact, C("0972985918"), C("12 Lê Lợi Hà Nội")];
function check(name, messages, exp) {
  test(name, () => {
    const f = deriveOrderFacts({ product, messages });
    if (exp.v !== undefined) assert.equal(f.variant, exp.v);
    if (exp.q !== undefined) assert.equal(f.quantity, exp.q);
    if (exp.t !== undefined) assert.equal(f.dealTotal, exp.t);
  });
}

// ===== nhóm run1 =====
{
const base = lead();
// ---- A. Câu trả lời MÀU với nhiều cách nói ----
const colorCases = [
  ["Màu đen đi", V("Đen")], ["đen", V("Đen")], ["lấy màu đen nha", V("Đen")], ["chị lấy đen", V("Đen")], ["den nha shop", V("Đen")],
  ["màu trắng", V("Trắng")], ["trang", V("Trắng")], ["lấy cái màu kem", V("Kem")], ["kem đi em", V("Kem")], ["màu hồng nhé", V("Hồng")],
  ["xanh", V("Xanh")], ["màu xanh nha", V("Xanh")], ["màu đỏ đô", V("Đỏ đô")], ["cam đất", V("Cam Đất")], ["vàng", V("Vàng")], ["màu vàng nhé", V("Vàng")],
  ["Cho chị cái màu đen", V("Đen")], ["chị lấy 1 cái màu đen", V("Đen")], ["lấy màu đen nhé, cảm ơn em", V("Đen")], ["mau den", V("Đen")],
];
for (const [t, v] of colorCases) check(`MÀU: "${t}"`, [...base, C(t), ...askContact, C("0972985918"), C("12 Lê Lợi Hà Nội")], { v, q: 1, t: 185000 });
// ---- B. Câu xã giao / đồng ý đi kèm (không được nhầm thành màu/size) ----
for (const t of ["vâng ạ, màu đen", "Vâng chị lấy màu đen", "vang a mau den", "cam on shop, mau den nhe", "cảm ơn em, lấy màu đen", "ok em, màu đen", "dạ màu đen ạ", "ừ màu đen đi", "uk den", "do chị cao nên lấy màu đen", "mình lấy màu đen nhé", "m lấy màu đen nha", "mk lấy màu đen"])
  check(`XÃ GIAO: "${t}"`, [...base, C(t), ...askContact, C("0972985918"), C("12 Lê Lợi Hà Nội")], { v: V("Đen"), q: 1 });
// ---- C. Tin liên hệ chứa số/chữ trùng giá trị ----
const contacts = [
  ["0975851292", "số 92 Nguyễn Trãi Hà Nội"], ["0972985918", "ngõ 85 Hồng Hà Hoàn Kiếm"], ["0975 858 592", "75 Trần Phú, Hà Đông"], ["0912345678", "Nguyễn Thị Hồng, 12 Hà Nội"],
  ["0912345678", "thôn Vàng xã Xanh huyện Kem Bắc Giang"], ["0912345678", "số 2 ngõ 5 Trần Duy Hưng"], ["0912345678", "xóm 3 thôn Đen xã Cam Hòa"],
  ["0912345678", "Hồng Bàng Hải Phòng"], ["0912345678", "đường Xanh Tam Bình, Vĩnh Long"], ["0912345678", "Chị Hồng 85 Lê Lợi"],
];
for (const [ph, ad] of contacts) check(`LIÊN HỆ: "${ph} | ${ad}"`, [...base, C("Màu đen đi"), ...askContact, C(ph), C(ad)], { v: V("Đen"), q: 1, t: 185000 });
for (const [ph, ad] of contacts) check(`LIÊN HỆ 1 TIN: "${ph} ${ad}"`, [...base, C("Màu đen đi"), ...askContact, C(`${ph} ${ad}`)], { v: V("Đen"), q: 1, t: 185000 });


}

// ===== nhóm run2 =====
{
// ---- D. Số đo trùng với giá trị chiều dài (75/85/92) ----
for (const [w, h] of [["75kg", "1m68"], ["85kg", "1m68"], ["92kg", "1m60"], ["75 kg", "1m75"], ["58kg", "1m85"], ["58kg", "1m92"], ["75 ký", "1m6"], ["75 cân", "1m6"], ["nặng 75", "cao 1m7"], ["58kg", "175cm"], ["58kg", "185"], ["58kg", "cao 175"], ["85", "1m6"], ["58kg", "1,75"]])
  check(`SỐ ĐO: nặng "${w}", cao "${h}"`, [...lead(w, h), C("Màu đen đi"), ...tailC], { v: V("Đen"), q: 1, t: 185000 });
// ---- E. Số lượng ----
const qcases = [["lấy 2 cái màu đen", 2, 350000], ["2 cái đen", 2, 350000], ["hai cái màu đen", 2, 350000], ["lấy 3 cái màu đen", 3, 520000], ["chị lấy 1 cái thôi, màu đen", 1, 185000], ["màu đen, 2 cái nha", 2, 350000], ["đen x2", 2, 350000], ["màu đen 2c", 2, 350000]];
for (const [t, q, tt] of qcases) check(`SỐ LƯỢNG: "${t}"`, [...lead(), C(t), ...tailC], { v: V("Đen"), q, t: tt });
check(`SỐ LƯỢNG: "1 đen 1 trắng"`, [...lead(), C("1 đen 1 trắng"), ...tailC], { v: "Màu Trắng + Đen, Size L, Chiều dài 85cm", q: 2, t: 350000 });
check(`SỐ LƯỢNG: "2 đen 1 trắng"`, [...lead(), C("2 đen 1 trắng"), ...tailC], { q: 3, t: 520000 });
check(`SỐ LƯỢNG: "màu đen và trắng"`, [...lead(), C("màu đen và trắng"), ...tailC], { v: "Màu Trắng + Đen, Size L, Chiều dài 85cm", q: 2, t: 350000 });
// ---- F. Khách đổi / tự chọn size, dài ----
const own = [
  ["lấy size M màu đen", V("Đen", "M")], ["màu đen size XL", V("Đen", "XL")], ["màu đen dài 92cm", V("Đen", "L", "92cm")], ["màu đen size M dài 75cm", V("Đen", "M", "75cm")],
  ["không lấy size L, lấy M, màu đen", V("Đen", "M")], ["đổi size M nha, màu đen", V("Đen", "M")], ["màu đen sai M", V("Đen", "M")], ["màu đen sz XL", V("Đen", "XL")],
  ["màu đen dài 75 nha", V("Đen", "L", "75cm")], ["85 dài quá, lấy 75 màu đen", V("Đen", "L", "75cm")], ["màu đen, lấy size S", V("Đen", "S")],
  ["lấy đen nhé à thôi lấy màu trắng", V("Trắng")], ["không lấy màu đen, lấy màu trắng", V("Trắng")], ["màu đen size 2XL", V("Đen", "2XL")],
];
for (const [t, v] of own) check(`TỰ CHỌN: "${t}"`, [...lead(), C(t), ...tailC], { v, q: 1 });
// ---- G. Câu hỏi thăm / nói chuyện ship, giá, đổi trả — KHÔNG được làm đổi lựa chọn ----
const chatter = ["bớt chút được không shop", "mấy ngày nhận được hàng vậy shop", "không ưng được đổi trả không shop", "nhận hàng được kiểm tra không shop", "mặc size L có vừa không em", "váy này có xòe không shop", "ship về Hà Nội bao lâu em", "sao shop hỏi nhiều thế", "ok vậy lấy luôn nhé", "chị thấy hơi đắt", "có freeship không em", "được kiểm tra hàng không", "hàng có đúng ảnh không shop", "ảnh thật đâu em", "không biết có hợp không nữa", "chưa ưng lắm", "dài 85 có hơi dài không em"];
for (const t of chatter) check(`HỎI THĂM: "${t}"`, [...lead(), C("Màu đen đi"), C(t), ...tailC], { v: V("Đen"), q: 1, t: 185000 });
for (const t of chatter.filter((x) => x !== "chưa ưng lắm")) check(`HỎI THĂM TRƯỚC MÀU: "${t}"`, [...lead(), C(t), C("Màu đen đi"), ...tailC], { v: V("Đen"), q: 1, t: 185000 });
// ---- H. Thứ tự lộn xộn ----
check("THỨ TỰ: chọn màu trước khi tư vấn", [B("Dạ chị cần tư vấn màu hay size ạ?"), C("lấy màu đen 1 cái"), B("Em xin chiều cao cân nặng của chị nhá"), C("58kg"), B("Dạ chị nặng 58kg thì mình mặc size L ạ."), B("Em xin chiều cao để chọn chiều dài váy nha chị?"), C("1m54"), B("Dạ chị cao 1m54 thì mặc chân váy dài 85cm là vừa đẹp ạ."), ...askContact, C("0972985918"), C("12 Lê Lợi Hà Nội")], { v: V("Đen"), q: 1 });
check("THỨ TỰ: số đo + màu một tin", [B("Em xin chiều cao cân nặng của chị nhá"), C("chị 1m54 58kg lấy màu đen"), B("Dạ chị nặng 58kg thì mình mặc size L ạ."), B("Dạ chị cao 1m54 thì mặc chân váy dài 85cm là vừa đẹp ạ."), ...askContact, C("0972985918"), C("12 Lê Lợi Hà Nội")], { v: V("Đen"), q: 1 });
check("THỨ TỰ: 'Có màu đen ko sop' rồi 'Màu đen đi'", [C("Có màu đen ko sop"), B("Dạ có ạ"), ...lead(), C("Màu đen đi"), ...tailC], { v: V("Đen"), q: 1 });
check("THỨ TỰ: hỏi 'màu đen có không' rồi mới chọn", [...lead(), C("màu đen có không shop"), B("Dạ có màu đen ạ"), C("lấy màu đen đi"), ...tailC], { v: V("Đen"), q: 1 });
// ---- I. Hai món khác nhau ----
check("2 MÓN: đen M / trắng L", [...lead(), C("1 váy đen size M, 1 váy trắng size L"), ...tailC], { q: 2, t: 350000 });
check("2 MÓN: viết kiểu 'đen M trắng L'", [...lead(), C("đen M trắng L"), ...tailC], { q: 2, t: 350000 });


}

// ===== nhóm run3 =====
{
const own = [
  ["size L nhỏ quá, lấy XL, màu đen", V("Đen", "XL")], ["L chật quá lấy XL màu đen", V("Đen", "XL")], ["chị mặc M được, màu đen", V("Đen", "M")], ["lấy size M thôi, màu đen", V("Đen", "M")],
  ["dài 85 được rồi, màu đen", V("Đen")], ["ừ dài 85 đi, màu đen", V("Đen")], ["không, dài 92, màu đen", V("Đen", "L", "92cm")], ["size L nhé, màu đen", V("Đen")],
  ["màu đỏ", V("Đỏ đô")], ["đỏ", V("Đỏ đô")], ["màu cam", V("Cam Đất")], ["cam", V("Cam Đất")], ["màu xanh dương", V("Xanh")], ["trắng tinh", V("Trắng")],
  ["Chị lấy màu đen, size L, dài 85cm nha", V("Đen")], ["đen L 85", V("Đen")], ["đen, L, 85cm", V("Đen")], ["lấy màu kem (như shop tư vấn)", V("Kem")],
  ["màu đen, ngắn hơn chút được không", V("Đen")], // câu hỏi → giữ tư vấn
  ["màu đen ạ. mặc có nóng không em", V("Đen")], ["màu đen nha shop ơi, giao nhanh giúp chị", V("Đen")], ["màu đen nhé, chị cần gấp", V("Đen")],
  ["màu đen, nhớ gói cẩn thận giúp chị", V("Đen")], ["lấy màu đen, sao shop không trả lời sớm", V("Đen")], ["cho chị màu đen, không cần túi", V("Đen")], ["màu đen, không lấy hóa đơn", V("Đen")],
];
for (const [t, v] of own) check(`J-K: "${t}"`, [...lead(), C(t), ...tailC], { v, q: 1, t: 185000 });
// số lượng trả lời trơn
check("L: shop hỏi mấy cái, khách trả '2'", [...lead(), C("màu đen"), B("Chị lấy mấy cái ạ?"), C("2"), ...tailC], { v: V("Đen"), q: 2, t: 350000 });
check("L: shop hỏi mấy cái, khách trả 'lấy 2 bộ'", [...lead(), C("màu đen"), B("Chị lấy mấy cái ạ?"), C("lấy 2 bộ"), ...tailC], { v: V("Đen"), q: 2, t: 350000 });
check("L: shop hỏi mấy cái, khách trả '1'", [...lead(), C("màu đen"), B("Chị lấy mấy cái ạ?"), C("1"), ...tailC], { v: V("Đen"), q: 1, t: 185000 });
check("L: 2 cái 1 đen 1 trắng", [...lead(), C("2 cái 1 đen 1 trắng"), ...tailC], { q: 2, t: 350000 });
check("L: '2 cái giống nhau màu đen'", [...lead(), C("2 cái giống nhau màu đen"), ...tailC], { v: V("Đen"), q: 2, t: 350000 });
// tin dồn nhiều thứ một lúc
const ONE = [
  ["Chị Lan 0912345678 số 2 ngõ 5 Trần Duy Hưng lấy 1 cái màu đen", V("Đen"), 1],
  ["màu đen. 0912345678. số 85 Hồng Hà Hà Nội", V("Đen"), 1],
  ["lấy 2 cái màu đen nha sdt 0912345678 đc 92 Nguyễn Trãi", V("Đen"), 2],
  ["Màu đen\n0972985918\nxóm 3 thôn Vàng xã Đen Hà Nam", V("Đen"), 1],
];
for (const [t, v, q] of ONE) check(`M: "${t.replace(/\n/g, " / ")}"`, [...lead(), ...askContact, C(t)], { v, q });


}

// ===== các ca riêng =====
test("Khách chê chung chung ('chưa ưng lắm') rồi chọn màu: đơn báo THIẾU chiều dài → bot không được tự chốt đơn", () => {
  const f = deriveOrderFacts({ product, messages: [...lead(), C("chưa ưng lắm"), C("Màu đen đi"), ...tailC] });
  assert.ok(f.issues.some((i) => i.code === "missing_attr"));
  const st = attributeStatus(productAttributes(product), [...lead(), C("chưa ưng lắm"), C("Màu đen đi")], [], "");
  assert.equal(attributesComplete(st), false);
});
test("attributesComplete: đủ màu/size/dài thì true", () => {
  const st = attributeStatus(productAttributes(product), [...lead(), C("Màu đen đi")], [], "");
  assert.equal(attributesComplete(st), true);
});
test("Tin vừa chọn vừa hỏi: bỏ vế hỏi, giữ vế chọn; 'có không shop?' dính vào vế trước", () => {
  assert.equal(dropQuestionClauses("màu đen, ngắn hơn chút được không").trim(), "màu đen,");
  assert.equal(dropQuestionClauses("màu đen ạ. mặc có nóng không em").trim(), "màu đen ạ.");
  assert.equal(dropQuestionClauses("màu đen, có không shop?"), "màu đen, có không shop?"); // cả tin là câu hỏi → giữ nguyên
  assert.equal(dropQuestionClauses("màu đen có không shop"), "màu đen có không shop");
});
test("Shop hỏi 'chị lấy mấy cái ạ?' khách trả lời trơn '2' → 2 cái; câu khác thì không", () => {
  assert.equal(qtyFromReplies([B("Chị lấy mấy cái ạ?"), C("2")]), 2);
  assert.equal(qtyFromReplies([B("Chị lấy mấy cái ạ?"), C("lấy 3 nha")]), 3);
  assert.equal(qtyFromReplies([B("Chị lấy mấy cái ạ?"), C("hai cái")]), 2);
  assert.equal(qtyFromReplies([B("Chị ưng màu nào ạ?"), C("2")]), null);
  assert.equal(qtyFromReplies([B("Chị lấy mấy cái ạ?"), C("mai chị gửi địa chỉ")]), null);
});
test("detectQty đọc '2c', '1c trắng 1c cam' (c = cái) nhưng không nhầm '2cm'", () => {
  assert.equal(detectQty("màu đen 2c"), 2);
  assert.equal(detectQty("dài 92cm"), null);
});
