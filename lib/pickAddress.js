// lib/pickAddress.js — lấy ĐỊA CHỈ nhận hàng từ tin khách khi AI quên điền customer_info.address
// (tách khỏi webhook/route.js để chạy test được). Dùng luật nhận địa chỉ CHẶT: câu chat thường dài (vd "Để chị suy nghĩ thêm rồi nhắn lại nha")
// không được lưu nhầm thành địa chỉ giao hàng.
import { looksLikeAddressStrict, hasClearAddressSignal, addressPartOfMixed } from "./replyDedupe.js";

/**
 * Lưới an toàn: lấy ĐỊA CHỈ nhận hàng thẳng từ tin của khách (khi AI — nhất là AI dự phòng — quên điền customer_info.address).
 * texts = các tin khách theo thứ tự CŨ → MỚI (từ sau lần shop xin SĐT/địa chỉ). Lấy tin địa chỉ ĐẦU TIÊN, bỏ qua câu nói chuyện
 * ("không có số nhà", "shipper tự gọi điện nhé"...). Trả "" nếu không có tin nào giống địa chỉ.
 * requireClearSignal=true (AI chính Gemini/Claude đã trả lời): chỉ nhận tin có từ khóa địa chỉ cụ thể hoặc kết thúc bằng tên tỉnh/thành.
 */
export function pickAddressFromTexts(texts, { requireClearSignal = false } = {}) {
  for (const raw of texts || []) {
    const t0 = String(raw || "");
    const t = addressPartOfMixed(t0); // "2 váy 350k ship về 12 Nguyễn Trãi Hà Nội" → chỉ lấy "12 Nguyễn Trãi Hà Nội"
    const mixed = t !== t0;
    // AI chính để trống địa chỉ → chỉ tin khách có dấu hiệu địa chỉ rõ ràng mới được lấy (tin trộn giá + địa chỉ chỉ cần phần sau "về" có dấu hiệu rõ)
    const ok = requireClearSignal
      ? hasClearAddressSignal(t) && (mixed || looksLikeAddressStrict(t))
      : looksLikeAddressStrict(t);
    if (!ok) continue;
    if (/(?<![\p{L}])(?:không có|ko có|k có|shipper|shiper|gọi điện|tự gọi|ghi chú|giúp|nhờ|cứ giao)(?![\p{L}])/iu.test(t)) continue; // câu dặn dò, không phải địa chỉ
    const clean = t
      .replace(/(?:\+?84|0)(?:[\s.\-]?\d){9}/g, " ") // bỏ SĐT
      .replace(/(?<![\p{L}])(?:số\s*điện\s*thoại|sđt|sdt|đt|điện\s*thoại|zalo)(?![\p{L}])\s*[:.\-]?/giu, " ")
      .replace(/^\s*(?:địa\s*chỉ|dia\s*chi|đc)\s*[:\-]?\s*/iu, "")
      .replace(/\s+/g, " ")
      .replace(/^[\s,.;:\-]+|[\s,.;:\-]+$/g, "");
    if (clean.split(/\s+/).length >= 3) return clean.slice(0, 300);
  }
  return "";
}
