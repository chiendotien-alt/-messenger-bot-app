// lib/pickAddress.js — lấy ĐỊA CHỈ nhận hàng từ tin khách khi AI quên điền customer_info.address
// (tách khỏi webhook/route.js để chạy test được). Dùng luật nhận địa chỉ CHẶT: câu chat thường dài (vd "Để chị suy nghĩ thêm rồi nhắn lại nha")
// không được lưu nhầm thành địa chỉ giao hàng.
import { looksLikeAddressStrict } from "./replyDedupe.js";

/**
 * Lưới an toàn: lấy ĐỊA CHỈ nhận hàng thẳng từ tin của khách (khi AI — nhất là AI dự phòng — quên điền customer_info.address).
 * texts = các tin khách theo thứ tự CŨ → MỚI (từ sau lần shop xin SĐT/địa chỉ). Lấy tin địa chỉ ĐẦU TIÊN, bỏ qua câu nói chuyện
 * ("không có số nhà", "shipper tự gọi điện nhé"...). Trả "" nếu không có tin nào giống địa chỉ.
 */
export function pickAddressFromTexts(texts) {
  for (const raw of texts || []) {
    const t = String(raw || "");
    if (!looksLikeAddressStrict(t)) continue;
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
