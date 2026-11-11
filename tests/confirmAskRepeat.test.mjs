import test from "node:test";
import assert from "node:assert/strict";
import { buildConfirmAsk } from "../lib/attributes.js";

const item = { attr: { name: "Chiều dài", values: ["75cm", "85cm", "92cm"] }, pending: { raw: "83", suggested: "85cm" }, picked: [] };
const FULL = "Dạ chiều dài bên em có 75cm, 85cm và 92cm ạ. Ý chị là chọn chiều dài 85cm đúng không chị?";

test("lần đầu: hỏi đầy đủ như cũ", () => {
  assert.equal(buildConfirmAsk(item, { kh: "chị" }), FULL);
});

test("đã hỏi rồi, khách chưa trả lời → hỏi lại bằng câu NGẮN, không lặp nguyên văn", () => {
  const again = buildConfirmAsk(item, { kh: "chị", avoid: [FULL, "Dạ chị cao 1m6 mặc váy dài 85cm là qua gối đẹp và gọn gàng lắm ạ."] });
  assert.notEqual(again, FULL);
  assert.equal(again, "Vậy chị lấy chiều dài 85cm nha chị?");
});

test("cả câu dài lẫn câu ngắn đã hỏi → không hỏi nữa", () => {
  assert.equal(buildConfirmAsk(item, { kh: "chị", avoid: [FULL, "Vậy chị lấy chiều dài 85cm nha chị?"] }), "");
});

test("câu cũ chỉ đổi xưng hô vẫn nhận ra là đã hỏi", () => {
  const old = "Dạ chiều dài bên em có 75cm, 85cm và 92cm ạ. Ý mình là chọn chiều dài 85cm đúng không mình?";
  assert.equal(buildConfirmAsk(item, { kh: "chị", avoid: [old] }), "Vậy chị lấy chiều dài 85cm nha chị?");
});
