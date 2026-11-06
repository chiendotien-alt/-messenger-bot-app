import test from "node:test";
import assert from "node:assert/strict";
import { crossCheckBody, applyCrossBody, dropKnownBodyAsks } from "../lib/bodyCross.js";
import { productAttributes, attributeStatus } from "../lib/attributes.js";
import { bodyInfoGiven } from "../lib/replyDedupe.js";

const product = {
  name: "Chân váy 3 tầng",
  attributes: [
    { name: "Màu", values: "Trắng, Đen, Kem", how: "" },
    { name: "Size", values: "S, M, L, XL", how: "theo cân nặng" },
    { name: "Chiều dài váy", values: "75cm, 85cm, 92cm", how: "theo chiều cao" },
  ],
};
const attrs = productAttributes(product);
const C = (text) => ({ from: "customer", text });
const B = (text) => ({ from: "bot", text });

test("Ca thật: khách 'M62 58kg eo 78 -80', AI nhắc lại 'cao 1m62 nặng 58kg' → khách ĐÃ đưa đủ số đo", () => {
  const r = crossCheckBody({
    customerTexts: ["M62 58kg eo 78 -80"],
    replyTexts: ["Dạ chị cao 1m62 nặng 58kg eo 78cm thì mình mặc size L là vừa đẹp chị ạ."],
  });
  assert.equal(r.height, true);
  assert.equal(r.weight, true);
  assert.equal(r.heightCm, 162);
  assert.equal(r.weightKg, 58);
});

test("Cách viết lạ mà luật không biết ('1 62 58kg') vẫn nhận được nhờ AI + tin khách khớp nhau", () => {
  const msg = "Mình 1 62 58kg";
  assert.equal(bodyInfoGiven([msg]).height, false); // luật bỏ sót (đúng là lý do cần đối chiếu)
  const r = crossCheckBody({ customerTexts: [msg], replyTexts: ["Dạ chị cao 1m62 thì mặc chân váy dài 92cm là vừa đẹp ạ."] });
  assert.equal(r.height, true);
});

test("AI không được bịa số: khách không hề nói thì không tính", () => {
  assert.equal(crossCheckBody({ customerTexts: ["tư vấn size giúp em"], replyTexts: ["Dạ chị cao 1m62 nặng 58kg ạ."] }).height, false);
  assert.equal(crossCheckBody({ customerTexts: ["tư vấn size giúp em"], replyTexts: ["Dạ chị cao 1m62 nặng 58kg ạ."] }).weight, false);
  // khách chỉ nói cân nặng 58kg, AI bịa "cao 1m58" → 58 là cân nặng, không được hiểu thành chiều cao
  assert.equal(crossCheckBody({ customerTexts: ["58kg"], replyTexts: ["Dạ chị cao 1m58 ạ."] }).height, false);
});

test("Câu bảng size / khoảng số của shop không bị coi là số đo của khách", () => {
  const cust = ["mình 61kg"];
  assert.equal(crossCheckBody({ customerTexts: cust, replyTexts: ["Váy dài 92cm phù hợp cho khách cao trên 1m61."] }).height, false);
  assert.equal(crossCheckBody({ customerTexts: ["m51 60"], replyTexts: ["Váy dài 85cm phù hợp khách cao 1m51 - 1m60."] }).height, false);
});

test("Câu hỏi của AI không được tính là 'AI đã biết'", () => {
  assert.equal(crossCheckBody({ customerTexts: ["m62 58kg"], replyTexts: ["Chị cao 1m62 phải không ạ?"] }).height, false);
});

test("applyCrossBody: chiều cao + cân nặng → mục chiều dài và size chuyển 'measured'", () => {
  const st = attributeStatus(attrs, [B("Chị cho em xin chiều cao cân nặng nha?")], ["Mình 1 62 58kg"], "");
  assert.equal(st.list[2].state, "missing");
  const changed = applyCrossBody(st, { height: true, weight: false, heightCm: 162, weightKg: null });
  assert.equal(changed.length >= 1, true);
  assert.equal(st.list[2].state, "measured"); // chiều dài váy suy ra từ chiều cao
  assert.equal(st.body.height, true);
});

test("dropKnownBodyAsks: bỏ câu xin chiều cao khi đã biết (đúng ca khách M62)", () => {
  const msgs = ["Dạ chị cao 1m62 nặng 58kg eo 78cm thì mình mặc size L là vừa đẹp chị ạ.", "Em xin chiều cao để chọn chiều dài váy nha chị?"];
  const r = dropKnownBodyAsks(msgs, { height: true, weight: true });
  assert.deepEqual(r.messages, [msgs[0]]);
  assert.equal(r.dropped.length, 1);
});

test("dropKnownBodyAsks: chỉ biết một nửa thì CHỈ bỏ câu xin đúng nửa đó; xin cả hai mà mới biết một nửa → giữ", () => {
  const ask = "Chị cho em xin chiều cao cân nặng nha?";
  assert.deepEqual(dropKnownBodyAsks([ask], { height: true, weight: false }).messages, [ask]);
  const onlyH = "Chị cho em xin chiều cao nha?";
  assert.deepEqual(dropKnownBodyAsks(["Dạ size L ạ.", onlyH], { height: true, weight: false }).messages, ["Dạ size L ạ."]);
  const onlyW = "Chị cho em xin cân nặng nha?";
  assert.deepEqual(dropKnownBodyAsks(["Dạ ạ.", onlyW], { height: true, weight: false }).messages, ["Dạ ạ.", onlyW]);
});

test("dropKnownBodyAsks: vế ghép chỉ bỏ vế xin số đo; câu xác nhận có con số được giữ; không bao giờ trả mảng rỗng", () => {
  const r = dropKnownBodyAsks(["Dạ size L vừa ạ, chị cho em xin chiều cao nha?"], { height: true, weight: true });
  assert.deepEqual(r.messages, ["Dạ size L vừa ạ."]);
  const confirm = "Chị cao 1m62 đúng không ạ?";
  assert.deepEqual(dropKnownBodyAsks([confirm], { height: true, weight: true }).messages, [confirm]);
  const only = "Chị cho em xin chiều cao nha?";
  assert.deepEqual(dropKnownBodyAsks([only], { height: true, weight: true }).messages, [only]);
  assert.deepEqual(dropKnownBodyAsks(["Chị cho em xin chiều cao nha?"], { height: false, weight: false }).messages, ["Chị cho em xin chiều cao nha?"]);
});
