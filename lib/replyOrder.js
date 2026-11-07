// lib/replyOrder.js — giữ thứ tự tin trả lời đúng theo thứ tự khách nói.
//
// Vấn đề: khách nhắn "40kg" rồi "1m61 vừa không". Bot gộp đúng cả hai tin, nhưng tin trả lời lại ra theo thứ tự
// "chiều cao (1m61 → váy 92cm)" rồi mới "cân nặng (40kg → size S)", vì AI trả lời câu HỎI trước, hoặc vì bước
// "nhờ AI viết lại để tư vấn" gắn phần còn thiếu (size) vào CUỐI. Khách đọc thấy bị đảo lộn.
//
// Hàm này sắp lại các tin trả lời nói về chiều cao / cân nặng theo thứ tự khách đã nhắc tới hai thứ đó.
// Làm rất thận trọng: chỉ đổi khi chắc chắn, còn lại giữ nguyên.
//
// File này không import DB/AI nên test được bằng `npm test`.

import { HEIGHT_TEXT_RE, WEIGHT_TEXT_RE } from "./replyDedupe.js";

/** Vị trí (0, 1, 2...) của tin khách đầu tiên nhắc tới chủ đề; không có → -1. */
function firstIndexOf(re, customerTexts) {
  return (customerTexts || []).findIndex((t) => re.test(String(t || "")));
}

/**
 * Sắp lại messages cho khớp thứ tự khách nói.
 * @param {string[]} messages      các tin bot định gửi (theo thứ tự hiện tại)
 * @param {string[]} customerTexts các tin khách lượt này, CŨ → MỚI (ưu tiên bản đã sửa chính tả)
 * @returns {string[]} mảng mới (hoặc chính mảng cũ nếu không cần / không chắc chắn để đổi)
 *
 * Điều kiện để đổi:
 * - có ít nhất 2 tin trả lời nói về đúng MỘT chủ đề (chiều cao hoặc cân nặng), hai chủ đề khác nhau;
 * - khách nhắc hai chủ đề đó ở hai tin KHÁC nhau (cùng một tin "1m61 40kg" thì không có thứ tự để theo);
 * - không tin nào nói cả hai chủ đề (mơ hồ → bỏ).
 * Tin không nói về chủ đề nào (vd câu xin SĐT ở cuối) giữ nguyên vị trí.
 */
export function orderByCustomerSequence(messages, customerTexts) {
  const msgs = Array.isArray(messages) ? messages : [];
  if (msgs.length < 2 || !Array.isArray(customerTexts) || customerTexts.length < 2) return msgs;

  const posHeight = firstIndexOf(HEIGHT_TEXT_RE, customerTexts);
  const posWeight = firstIndexOf(WEIGHT_TEXT_RE, customerTexts);
  if (posHeight < 0 || posWeight < 0 || posHeight === posWeight) return msgs;

  const slots = []; // vị trí các tin có chủ đề rõ ràng
  const keys = []; // thứ tự khách nhắc tới chủ đề của tin đó
  for (let i = 0; i < msgs.length; i++) {
    const text = String(msgs[i] || "");
    const h = HEIGHT_TEXT_RE.test(text);
    const w = WEIGHT_TEXT_RE.test(text);
    if (h && w) return msgs; // tin nói cả hai → không đoán
    if (!h && !w) continue; // tin chung chung (xin SĐT, chào...) → đứng yên
    slots.push(i);
    keys.push(h ? posHeight : posWeight);
  }
  if (slots.length < 2 || new Set(keys).size < 2) return msgs;

  // Sắp ổn định: tin cùng chủ đề giữ thứ tự cũ với nhau
  const order = slots.map((slot, n) => ({ slot, key: keys[n], n })).sort((a, b) => a.key - b.key || a.n - b.n);
  if (order.every((o, n) => o.slot === slots[n])) return msgs; // đã đúng thứ tự

  const out = msgs.slice();
  order.forEach((o, n) => {
    out[slots[n]] = msgs[o.slot];
  });
  return out;
}
