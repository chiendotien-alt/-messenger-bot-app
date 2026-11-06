// lib/shortMessage.js — nhận biết tin nhắn NGẮN của khách ("46k", "2c", "sai s", "1trang 1den", "cao 1m50"...).
// Khách hay nhắn dồn từng mảnh ngắn; bot chờ vài giây để gom cả loạt rồi trả lời MỘT lần (xem SHORT_MSG_WAIT_MS trong webhook).

/** Đếm "chữ" (tách theo khoảng trắng). Dấu câu đứng riêng ("?", "...", "!") và emoji không tính là chữ. */
export function countWords(text) {
  return String(text || "").trim().split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length;
}

/** true nếu tin có chữ và ÍT HƠN maxWords chữ (mặc định < 5 chữ, tức 1–4 chữ). */
export function isShortMessage(text, maxWords = 5) {
  const n = countWords(text);
  return n > 0 && n < maxWords;
}
