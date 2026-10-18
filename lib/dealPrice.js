// lib/dealPrice.js — giá / ưu đãi mà CHỦ SHOP tự nhắn tay với khách.
// Đây là giá đã thỏa thuận với riêng khách đó → ưu tiên hơn giá niêm yết trong "Nội dung" sản phẩm.

/** Có số tiền trong câu: "320k", "320 nghìn", "1tr2", "320.000", "320,000đ"... (không tính "5kg", số điện thoại có dấu chấm) */
export const MONEY_RE = /\d+(?:[.,]\d+)?\s?(?:k|nghìn|ngàn|tr|triệu|đ|vnđ|vnd)(?![\p{L}])|(?<![\d.,])\d{1,3}(?:[.,]\d{3})+(?![\d])/iu;

export const hasMoney = (t) => MONEY_RE.test(String(t || ""));

const clean = (t) => String(t || "").replace(/\s+/g, " ").trim().slice(0, 300);

/**
 * Các tin CHỦ SHOP nhắn tay có nhắc tiền (cũ → mới).
 * messages: mảng { from, text, time } (from === "admin" là chủ shop). days: chỉ lấy tin trong N ngày gần đây (có field time).
 */
export function ownerPriceLines(messages, { max = 4, scan = 300, days = 1 } = {}) {
  const since = Date.now() - days * 86400000;
  return (messages || [])
    .slice(-scan)
    .filter((m) => {
      if (!m || m.from !== "admin" || !hasMoney(m.text)) return false;
      const t = m.time ? new Date(m.time).getTime() : NaN;
      return Number.isNaN(t) || t >= since;
    })
    .slice(-max)
    .map((m) => clean(m.text));
}

/** Đoạn dặn AI (bot chat) dùng đúng giá chủ shop đã thỏa thuận. */
export function ownerPriceNote(lines) {
  const list = (lines || []).filter(Boolean);
  if (!list.length) return "";
  return (
    "\n\nCHỦ SHOP ĐÃ TỰ NHẮN VỚI KHÁCH NÀY (có nhắc giá/ưu đãi):\n" +
    list.map((l) => `- ${l}`).join("\n") +
    "\nĐây là giá/ưu đãi chủ shop đã thỏa thuận riêng với khách này, ƯU TIÊN HƠN giá niêm yết trong phần Nội dung sản phẩm. " +
    "Khi nhắc giá, trả lời về giá, chốt đơn hay tóm tắt đơn thì dùng đúng giá này (nếu là tổng tiền cho nhiều cái thì giữ nguyên là tổng, vd \"2 váy 320k\"), " +
    "không quay lại giá niêm yết, không tự đổi giá. Khách nói đúng giá này thì xác nhận luôn. " +
    "Khách nói một mức giá KHÁC mà chủ shop chưa từng nói, phần Nội dung và LƯU Ý CỦA CHỦ SHOP của sản phẩm cũng không có thì không tự đồng ý (mức giảm đã ghi trong Nội dung hoặc LƯU Ý CỦA CHỦ SHOP thì vẫn được dùng)."
  );
}
