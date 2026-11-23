// lib/knownInfo.js — khách có đang NÓI VỀ / ĐỔI thông tin liên hệ (SĐT, địa chỉ) không?
//
// Lỗi cũ: tin khách có chữ "sđt" / "địa chỉ" là coi như khách đang đổi thông tin → TẮT bộ lọc "bỏ câu xin lại thông tin đã có".
// Nhưng khách gõ "…sđt 0919944458 tỉnh Vĩnh Long…" là đang ĐƯA thông tin chứ không phải đổi → bot xin lại SĐT/địa chỉ thừa.
//
// Quy tắc mới:
//  - Có từ chỉ việc đổi/sửa (đổi, mới, khác, sai, nhầm, sửa, thay) → vẫn coi là đang nói về thông tin (giữ như cũ).
//  - Chỉ nhắc chữ "sđt/địa chỉ" mà tin đó KHÔNG có SĐT hay địa chỉ thật (vd "địa chỉ mình ở đâu?") → vẫn coi là đang nói về thông tin.
//  - Nhắc chữ "sđt/địa chỉ" KÈM đúng SĐT/địa chỉ thật (đang đưa thông tin) → KHÔNG coi là đang đổi.
const CHANGE_RE = /(đổi|mới|khác|sai|nhầm|sửa|thay)/i;
const INFO_WORD_RE = /(địa chỉ|dia chi|sđt|sdt|số điện thoại|so dien thoai)/i;

/**
 * @param {string[]} texts tin khách vừa nhắn (lượt này)
 * @param {{ givingContact?: boolean }} opts givingContact = trong tin có SĐT hoặc địa chỉ thật
 * @returns {boolean} true nếu khách đang nói về / đổi thông tin liên hệ (bộ lọc xin-lại phải tắt)
 */
export function customerTouchesInfo(texts, { givingContact = false } = {}) {
  const all = (texts || []).join(" ");
  if (CHANGE_RE.test(all)) return true;
  if (INFO_WORD_RE.test(all) && !givingContact) return true;
  return false;
}
