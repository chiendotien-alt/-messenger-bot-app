// Lỗi 25/11/2026: bảng ghi L: 54–60kg, khách nhắn "Cao 145 nặng 59" mà bot tư vấn size 2XL.
import test from "node:test";
import assert from "node:assert/strict";
import { productAttributes, attributeStatus } from "../lib/attributes.js";
import { weightRanges, sizeForWeight, weightFromMessages, sizeAdviceFor, sizeAdviceNote, fixSizeInMessages } from "../lib/sizeByWeight.js";

const B = (text) => ({ from: "bot", text });
const C = (text) => ({ from: "customer", text });
const product = {
  name: "Chân váy 3 tầng",
  attributes: [
    { name: "Size", values: "S, M, L, XL, 2XL", how: "Theo cân nặng S: 37-46kg M:47–53kg L: 54–60kg XL: 61–67kg 2XL: 68–75kg" },
    { name: "Chiều dài váy", values: "75cm, 85cm, 92cm", how: "Theo chiều cao 75cm:phù hợp khách cao từ 1m40 đến 1m50. 85cm: phù hợp khách cao từ 1m51 đến 1m64. 92cm: phù hợp khách cao từ 1m65 trở lên." },
    { name: "màu", values: "Trắng, Đen, Kem, Vàng, Xanh, Hồng, Đỏ đô, Cam Đất", how: "Khách tự chọn hoặc khách bảo tư vấn" },
  ],
};
const attrs = productAttributes(product);
const size = attrs[0];

test("đọc đúng các khoảng cân nặng từ ô 'Cách chọn' (XL không bị lẫn vào 2XL)", () => {
  assert.deepEqual(weightRanges(size).map((r) => `${r.label}:${r.min}-${r.max}`), ["S:37-46", "M:47-53", "L:54-60", "XL:61-67", "2XL:68-75"]);
  assert.equal(weightRanges(attrs[1]).length, 0); // bảng chiều cao không có kg
  assert.equal(weightRanges(attrs[2]).length, 0);
});

test("cân nặng → size theo bảng, kể cả mốc biên", () => {
  const r = weightRanges(size);
  const pick = (kg) => sizeForWeight(r, kg)?.label ?? null;
  assert.equal(pick(59), "L");
  assert.equal(pick(60), "L");
  assert.equal(pick(61), "XL");
  assert.equal(pick(54), "L");
  assert.equal(pick(53), "M");
  assert.equal(pick(75), "2XL");
  assert.equal(pick(30), "S"); // nhẹ hơn mốc nhỏ nhất → size nhỏ nhất
  assert.equal(pick(80), null); // vượt bảng → không đoán
});

test("đọc cân nặng khách viết: 'nặng 59', '59kg', '53' trả lời trơn, 2 con số khác nhau → không đoán", () => {
  assert.equal(weightFromMessages([C("Cao 145 nặng 59")]), 59);
  assert.equal(weightFromMessages([C("1m60 50kg")]), 50);
  assert.equal(weightFromMessages([B("Chị nặng bao nhiêu kg ạ?"), C("53")]), 53);
  assert.equal(weightFromMessages([C("mình 59kg bạn mình 68kg")]), null);
  assert.equal(weightFromMessages([C("Lấy màu kem")]), null);
});

const chat = [C("Lấy màu kem"), B("Dạ chị cho em xin chiều cao cân nặng để em chọn váy nha?")];
const now = ["Cao 145 nặng 59"];
const status = () => attributeStatus(attrs, chat, now, "");
const msgs = [...chat, C(now[0])];

test("LỖI THẬT: khách 1m45 59kg → hệ thống tính ra size L và dặn AI", () => {
  const adv = sizeAdviceFor(attrs, status(), msgs, now);
  assert.equal(adv.length, 1);
  assert.equal(adv[0].label, "L");
  assert.match(sizeAdviceNote(adv), /59kg → Size = L/);
});

test("LỖI THẬT: AI nói 'size 2XL' thì bị sửa lại thành L, câu còn lại giữ nguyên", () => {
  const adv = sizeAdviceFor(attrs, status(), msgs, now);
  const ai = ["Dạ chị cao 1m45 nặng 59kg thì mình mặc size 2XL và lấy chân váy dài 75cm là vừa đẹp ạ.", "Chị cho em xin số điện thoại và địa chỉ nhận hàng để em lên đơn nhé."];
  const fx = fixSizeInMessages(ai, adv);
  assert.equal(fx.messages[0], "Dạ chị cao 1m45 nặng 59kg thì mình mặc size L và lấy chân váy dài 75cm là vừa đẹp ạ.");
  assert.equal(fx.messages[1], ai[1]);
  assert.deepEqual(fx.changes, [{ from: "2XL", to: "L" }]);
});

test("AI nói đúng size rồi thì không đụng vào", () => {
  const adv = sizeAdviceFor(attrs, status(), msgs, now);
  const ai = ["Dạ chị cao 1m45 nặng 59kg thì mình mặc size L và lấy chân váy dài 75cm là vừa đẹp ạ."];
  const fx = fixSizeInMessages(ai, adv);
  assert.deepEqual(fx.messages, ai);
  assert.equal(fx.changes.length, 0);
});

test("tin liệt kê nhiều size ('có size S, M, L, XL, 2XL') không bị sửa", () => {
  const adv = sizeAdviceFor(attrs, status(), msgs, now);
  for (const t of ["Dạ bên em có size S, M, L, XL, 2XL ạ", "Dạ size 2XL và size XL đều có ạ", "S: 37-46kg, XL: 61-67kg, 2XL: 68-75kg"]) {
    assert.deepEqual(fixSizeInMessages([t], adv).messages, [t], t);
  }
});

test("khách TỰ nói size ('XL là đc') → theo khách, không sửa, không dặn AI", () => {
  const chat2 = [...chat, C("Cao 145 nặng 59"), B("Dạ chị nặng dưới 60kg thì mình mặc size L là vừa đẹp nha chị.")];
  const st = attributeStatus(attrs, chat2, ["XL là đc"], "");
  assert.equal(st.list[0].state, "chosen");
  assert.equal(sizeAdviceFor(attrs, st, [...chat2, C("XL là đc")], ["XL là đc"]).length, 0);
});

test("khách hỏi về một size ('2xL 68 kg có rộng kh') → không sửa", () => {
  const t = ["2xL 68 kg có rộng kh"];
  const st = attributeStatus(attrs, [], t, "");
  assert.equal(sizeAdviceFor(attrs, st, [C(t[0])], t).length, 0);
});

test("khách nặng 68kg → size 2XL đúng bảng, AI nói 2XL thì giữ nguyên", () => {
  const t = ["Cao 1m60 nặng 68kg"];
  const st = attributeStatus(attrs, [], t, "");
  const adv = sizeAdviceFor(attrs, st, [C(t[0])], t);
  assert.equal(adv[0].label, "2XL");
  const ai = ["Dạ chị mặc size 2XL là vừa đẹp ạ."];
  assert.deepEqual(fixSizeInMessages(ai, adv).messages, ai);
});

test("sản phẩm không có khoảng kg trong bảng → không làm gì (bot chạy như cũ)", () => {
  const p2 = productAttributes({ name: "Áo", attributes: [{ name: "Size", values: "S, M, L", how: "theo cân nặng" }] });
  const t = ["nặng 59kg"];
  assert.equal(sizeAdviceFor(p2, attributeStatus(p2, [], t, ""), [C(t[0])], t).length, 0);
});
