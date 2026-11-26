// lib/imageAsk.js — khách xin xem BẢNG MÀU / ẢNH mà bot lỡ chặn, và câu "em gửi ảnh..." hứa suông.
//
// Lỗi 25/11/2026: khách nhắn "Gửi bản màu" (gõ thiếu chữ g của "bảng màu"). AI hiểu đúng và đặt send_catalog = true, nhưng bộ chặn
// ảnh của hệ thống không nhận "bản màu" là xin xem ảnh nên CHẶN, và vẫn để nguyên câu "Dạ em gửi chị xem bảng màu..." → khách thấy
// bot hứa mà không có ảnh, chủ shop phải gửi tay.
//
// File chỉ chứa luật thuần (không gọi mạng/CSDL) nên test riêng được.

const plainKey = (t) =>
  String(t || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/gi, "d")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

/**
 * AI đã nhận ra khách xin xem ảnh các màu/mẫu (send_catalog = true) VÀ chính tin khách có nhắc màu/mẫu kèm chữ gửi/xem/xin/cho
 * → tin AI quyết định, đừng chặn chỉ vì khách gõ sai chính tả. Tin đang đưa SĐT/địa chỉ (chốt đơn) thì không áp dụng.
 */
export function catalogAskByAi({ sendCatalog, text, hasPhone = false } = {}) {
  if (sendCatalog !== true || hasPhone) return false;
  const t = plainKey(text);
  if (!t) return false;
  return /\b(mau|mau sac|mau ma|ban mau|bang mau)\b/.test(t) && /\b(gui|xem|xin|cho|show|dua)\b/.test(t);
}

// Câu hứa gửi ảnh / bảng màu: "em gửi chị xem bảng màu", "em gửi ảnh nha", "xem hình bên dưới"
const IMAGE_PROMISE = /(gửi|gui)[^,.!?\n]{0,40}(ảnh|hình|anh|hinh|bảng màu|bang mau|bản màu|ban mau|mẫu màu|mau mau)|xem (ảnh|hình|anh|hinh|bảng màu|bang mau|bản màu|ban mau)/i;

/**
 * Bot KHÔNG gửi ảnh lượt này (bị chặn) mà tin trả lời có câu hứa gửi ảnh → bỏ các câu hứa đó, giữ phần còn lại.
 * @returns {{ messages: string[], dropped: string[] }} dropped rỗng = không có câu hứa nào
 */
export function dropImagePromises(messages) {
  const dropped = [];
  const out = (messages || [])
    .map((m) => {
      const kept = String(m || "")
        .split(/(?<=[,;.!?])\s*/)
        .filter((c) => {
          if (!c.trim()) return false;
          if (IMAGE_PROMISE.test(c)) {
            dropped.push(c.trim());
            return false;
          }
          return true;
        });
      let s = kept.join(" ").trim().replace(/[,;]\s*$/, "");
      if (s && !/[.!?]$/.test(s)) s += /ạ$/i.test(s) ? "." : " ạ.";
      return s;
    })
    .filter(Boolean);
  return { messages: out, dropped };
}
