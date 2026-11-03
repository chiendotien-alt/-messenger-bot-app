import test from "node:test";
import assert from "node:assert/strict";
import { productAttributes, attributeStatus, summaryDetail, composeVariant } from "../lib/attributes.js";
import { deriveOrderFacts } from "../lib/orderFacts.js";
import { readOrder } from "../lib/orderItems.js";

const C = (text) => ({ from: "customer", text });
const B = (text) => ({ from: "bot", text });
const product = {
  name: "Chân váy 3 tầng",
  description: "Chân váy 3 tầng, miễn phí ship",
  priceLadder: [
    { qty: 1, list: "185k", steps: "", floor: "185k" },
    { qty: 2, list: "350k", steps: "", floor: "350k" },
  ],
  attributes: [
    { name: "Màu", values: "Trắng, Đen, Kem, Vàng, Xanh, Hồng, Đỏ đô, Cam Đất", how: "" },
    { name: "Size", values: "S, M, L, XL, 2XL", how: "theo cân nặng" },
    { name: "Chiều dài", values: "75cm, 85cm, 92cm", how: "theo chiều cao" },
  ],
};
const attrs = productAttributes(product);
const lead = [
  B("Em xin chiều cao cân nặng của chị nhá"),
  C("58kg"),
  B("Dạ chị nặng 58kg thì mình mặc size L ạ."),
  B("Em xin chiều cao để chọn chiều dài váy nha chị?"),
  C("1m54"),
  B("Dạ chị cao 1m54 thì mặc chân váy dài 85cm là vừa đẹp ạ."),
  B("Chị ưng màu nào bên em chưa ạ?"),
];
const tail = [
  B("dạ em lấy chân váy màu đen cho chị nha."),
  B("chị cho em xin số điện thoại và địa chỉ nhận hàng để em lên đơn nhé ạ."),
  C("Qt tấn tài cà sáng hàm tân trà cú Trà Vinh"),
  C("0972985918"),
];

test("Lỗi thật: khách nói 'Xem hàng ko ưng ko nhận nha sop' không bị hiểu là từ chối chiều dài 85cm", () => {
  const msgs = [...lead, C("Xem hàng ko ưng ko nhận nha sop"), C("Màu đen đi"), ...tail];
  const st = attributeStatus(attrs, msgs, [], "");
  assert.deepEqual(st.list[2].picked, ["85cm"]);
  assert.equal(st.list[2].state, "chosen");
  assert.equal(composeVariant(st), "Màu Đen, Size L, Chiều dài 85cm");
  const f = deriveOrderFacts({ product, messages: msgs });
  assert.deepEqual(f.issues, []);
  assert.equal(f.quantity, 1);
  assert.equal(f.dealTotal, 185000);
  assert.deepEqual(summaryDetail(st, 1).specs, ["size L", "dài 85cm"]);
});

test("Các câu nói về nhận / kiểm tra / hoàn hàng không làm mất lời tư vấn của shop", () => {
  for (const t of [
    "Xem hàng ko ưng ko nhận nha sop",
    "cho kiểm tra hàng rồi mới nhận nha",
    "được xem hàng không shop",
    "không ưng thì hoàn hàng nha",
    "ship cod nha shop",
    "nhận hàng rồi mới thanh toán",
    "ko vừa thì đổi trả hàng nha",
  ]) {
    const st = attributeStatus(attrs, [...lead, C(t), C("Màu đen đi")], [], "");
    assert.deepEqual(st.list[2].picked, ["85cm"], t);
    assert.deepEqual(st.list[1].picked, ["L"], t);
  }
});

test("Từ chối thật vẫn hoạt động: 'không lấy dài 85cm', 'ko vừa', 'thôi', 'đổi dài hơn'", () => {
  for (const t of ["không lấy dài 85cm", "ko lấy 85cm nha", "thôi", "dài hơn chút được không", "đổi dài 92cm"]) {
    const st = attributeStatus(attrs, [...lead, C(t)], [], "");
    assert.ok(!(st.list[2].picked.length === 1 && st.list[2].picked[0] === "85cm" && st.list[2].state === "chosen" && /không lấy|ko lấy|thôi/.test(t)), t);
  }
  const st = attributeStatus(attrs, [...lead, C("không lấy dài 85cm lấy 92cm nha")], [], "");
  assert.deepEqual(st.list[2].picked, ["92cm"]);
});

test("AI ghi size/dài theo lời tư vấn của shop (khách chỉ đồng ý ngầm) → được chấp nhận, không bị coi là bịa", () => {
  const msgs = [...lead, C("Xem hàng ko ưng ko nhận nha sop"), C("Màu đen đi")];
  const custTexts = msgs.filter((m) => m.from === "customer").map((m) => m.text);
  const shopTexts = msgs.filter((m) => m.from !== "customer").map((m) => m.text);
  const st = attributeStatus(attrs, msgs, [], "");
  const aiRaw = [{ qty: 1, values: { Màu: "Đen", Size: "L", "Chiều dài": "85cm" } }];
  const withShop = readOrder({ attrs, status: st, aiRaw, customerTexts: custTexts, shopTexts });
  assert.equal(withShop.verdict, "agree");
  // không có lời tư vấn của shop làm căn cứ thì "85cm" khách không hề nhắc → bỏ bản AI
  assert.equal(readOrder({ attrs, status: st, aiRaw, customerTexts: custTexts, shopTexts: [] }).verdict, "ai_invalid");
  // AI ghi giá trị shop KHÔNG hề tư vấn cũng không được chấp nhận
  const bad = readOrder({ attrs, status: st, aiRaw: [{ qty: 1, values: { Màu: "Đen", "Chiều dài": "92cm" } }], customerTexts: custTexts, shopTexts });
  assert.equal(bad.verdict, "ai_invalid");
});
