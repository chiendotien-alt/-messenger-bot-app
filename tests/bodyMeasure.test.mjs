import test from "node:test";
import assert from "node:assert/strict";
import { productAttributes, attributeStatus } from "../lib/attributes.js";
import { readOrder } from "../lib/orderItems.js";
import { normalizeBodyText, bodyInfoGiven, HEIGHT_TEXT_RE } from "../lib/replyDedupe.js";

const C = (text) => ({ from: "customer", text });
const B = (text) => ({ from: "bot", text });
const product = {
  name: "Chân váy 3 tầng",
  attributes: [
    { name: "Màu", values: "Trắng, Đen, Kem", how: "" },
    { name: "Size", values: "S, M, L, XL", how: "theo cân nặng" },
    { name: "Chiều dài váy", values: "75cm, 85cm, 92cm", how: "theo chiều cao" },
  ],
};
const attrs = productAttributes(product);
const ask = [B("Chị cho em xin chiều cao cân nặng để em chọn váy nha?")];
const known = (msgs) => { const st = attributeStatus(attrs, msgs, [], ""); return { size: st.list[1].state !== "missing", len: st.list[2].state !== "missing" }; };

test("Lỗi thật: 'Mình cao m150 năng 53kg' → bot nhận ra cả chiều cao lẫn cân nặng, không hỏi lại chiều cao", () => {
  assert.deepEqual(known([...ask, C("Mình cao m150 năng 53kg")]), { size: true, len: true });
});

test("Các cách viết chiều cao thường gặp đều được nhận ra", () => {
  for (const h of ["1m50", "1m5", "1m 50", "1 m 50", "1,5m", "1.5m", "1m50cm", "150cm", "150 cm", "m150", "1met50", "1 mét 50", "1mét5", "một mét rưỡi", "mét rưỡi", "1m rưỡi", "cao m50", "cao mét 50", "cao 150"]) {
    assert.deepEqual(known([...ask, C(`Mình cao ${h} nặng 53kg`)]), { size: true, len: true }, h);
    assert.ok(HEIGHT_TEXT_RE.test(`cao ${h}`), h);
  }
});

test("Số đo viết liền không đơn vị: '1m50 53', '1m50/53', '53 1m50', '150 53', '1m5 50k'", () => {
  for (const t of ["1m50 53", "1m50/53", "1m50, 53", "53 1m50", "53/1m50", "150 53", "150/53", "1m5 50k", "1.5 53", "1m55 và 48kg"]) {
    assert.deepEqual(known([...ask, C(t)]), { size: true, len: true }, t);
  }
});

test("Khách trả lời trơn một con số khi shop vừa hỏi riêng chiều cao / cân nặng", () => {
  for (const t of ["160", "1.6", "m6", "m55", "mét 6", "1m6", "cao 160"]) {
    assert.equal(known([B("Chị cao tầm mét mấy ạ?"), C(t)]).len, true, t);
  }
  for (const t of ["53", "nặng 53", "53 ký"]) {
    assert.equal(known([B("Chị nặng bao nhiêu kg ạ?"), C(t)]).size, true, t);
  }
  assert.equal(normalizeBodyText("160", "Chị cao tầm mét mấy ạ?"), "cao 1m60");
  assert.equal(normalizeBodyText("1.6", "Chị cao tầm mét mấy ạ?"), "cao 1m60");
  assert.equal(normalizeBodyText("53", "Chị nặng bao nhiêu kg ạ?"), "53kg");
});

test("Không đoán bừa: con số trơn khi shop KHÔNG hỏi số đo; số nhà / ngõ / size / giá không bị đọc thành cân nặng", () => {
  assert.equal(normalizeBodyText("160", "Chị ưng màu nào ạ?"), "160");
  assert.equal(normalizeBodyText("53", "Chị lấy mấy cái ạ?"), "53");
  assert.equal(normalizeBodyText("cao 1m6 ngõ 85", ""), "cao 1m6 ngõ 85");
  assert.equal(normalizeBodyText("cao 1m6 số 85 Hồng Hà", ""), "cao 1m6 số 85 Hồng Hà");
  assert.equal(normalizeBodyText("cao 1m6 lấy size 40", ""), "cao 1m6 lấy size 40");
  assert.equal(normalizeBodyText("0972985918", "Chị cao tầm mét mấy ạ?"), "0972985918");
  assert.equal(known([B("Chị ưng màu nào ạ?"), C("160")]).len, false);
});

test("bodyInfoGiven (dùng cho tin nhắn bồi) cũng hiểu 'm150' và '1m50 53'", () => {
  assert.deepEqual(bodyInfoGiven(["Mình cao m150 năng 53kg"]), { height: true, weight: true });
  assert.deepEqual(bodyInfoGiven(["1m50 53"]), { height: true, weight: true });
  assert.deepEqual(bodyInfoGiven(["lấy màu đen"]), { height: false, weight: false });
});

test("Lượt AI vừa tư vấn size/chiều dài vừa ghi đơn: giá trị tư vấn của chính bot không bị coi là 'khách không nhắc'", () => {
  const msgs = [B("Chị ưng màu nào ạ?"), C("Mình lấy màu kem nhé"), B("dạ em lấy chân váy màu kem nha chị"), ...ask, C("Mình cao m150 năng 53kg")];
  const st = attributeStatus(attrs, msgs, [], "");
  assert.equal(st.list[1].state, "measured");
  assert.equal(st.list[2].state, "measured");
  const ai = [{ qty: 1, values: { Màu: "Kem", Size: "M", "Chiều dài váy": "75cm" } }];
  const r = readOrder({ attrs, status: st, aiRaw: ai, customerTexts: msgs.filter((m) => m.from === "customer").map((m) => m.text), shopTexts: msgs.filter((m) => m.from !== "customer").map((m) => m.text) });
  assert.equal(r.verdict, "agree");
});

test("Lỗi thật: 'M62 58kg eo 78 -80' → hiểu M62 = cao 1m62, KHÔNG hỏi lại chiều cao", () => {
  const msg = "M62 58kg eo 78 -80";
  assert.deepEqual(known([B("Váy có những size nào?"), ...ask, C(msg)]), { size: true, len: true });
  assert.deepEqual(bodyInfoGiven([msg]), { height: true, weight: true });
  assert.ok(HEIGHT_TEXT_RE.test("m62 58kg"));
  assert.match(normalizeBodyText(msg), /1m62 58kg/);
});

test("Các kiểu viết tắt 'm62' kèm cân nặng đều nhận ra chiều cao", () => {
  for (const x of ["M62 58kg", "m62 58kg", "m 62 58kg", "m62, 58kg", "m62/58kg", "M70 63kg", "m55 48kg"]) {
    assert.deepEqual(bodyInfoGiven([x]), { height: true, weight: true }, x);
    assert.deepEqual(known([...ask, C(x)]), { size: true, len: true }, x);
  }
  assert.equal(normalizeBodyText("m62 58"), "cao 1m62 58kg");
});

test("Không nhầm size M / mã hàng thành chiều cao", () => {
  for (const x of ["size M 58kg", "lấy size M nặng 58kg", "mã M62", "M 58kg", "m40 58kg", "lấy 2 cái M62"]) {
    assert.equal(bodyInfoGiven([x]).height, false, x);
  }
});
