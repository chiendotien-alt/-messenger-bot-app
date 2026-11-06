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

/** true nếu là tin chữ DÀI (từ maxWords chữ trở lên, không kèm ảnh) — loại tin này trả lời ngay, không chờ gom. */
export function isLongMessage(text, hasImages = false, maxWords = 5) {
  return !hasImages && countWords(text) >= maxWords;
}

/**
 * Luật "nhắn dồn" (chờ ngắn ~1,2s): chỉ áp cho tin NGẮN / tin kèm ảnh.
 * Tin chữ dài (>= maxWords chữ) KHÔNG chờ: nếu cho chờ, tin dài sẽ bị tin ngắn đến sau (vốn chờ 6s) cướp lượt trả lời.
 */
export function burstWaitApplies({ text, hasImages = false, pendCount = 0, outAgeMs = null, burstRecentMs = 10000, maxWords = 5 }) {
  if (isLongMessage(text, hasImages, maxWords)) return false;
  return pendCount >= 2 || (outAgeMs !== null && outAgeMs < burstRecentMs);
}
