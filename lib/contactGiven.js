// lib/contactGiven.js — khách "VỪA đưa" SĐT / địa chỉ ở lượt này? (chỉ xét tin khách vừa nhắn, KHÔNG xét lịch sử chat)
//
// Lỗi cũ: webhook dùng `verified.address` / `verified.phone` (thông tin AI trích ra, đối chiếu với TOÀN BỘ lịch sử) để coi là "khách vừa đưa".
// Khách đã gửi địa chỉ từ trước thì lượt nào AI cũng trích lại → lượt nào cũng bị coi là "vừa đưa địa chỉ" → mở khóa chống hỏi lặp
// → bot xin lại SĐT ngay cả khi vừa xin xong (đúng ra phải chờ tin bồi sau "Thời gian hỏi lại").
import { looksLikeAddressStrict, hasClearAddressSignal, addressPartOfMixed } from "./replyDedupe.js";

const PHONE_RE = /(?:\+?84|0)\d{9}/;
const UNIT_WORDS = new Set("phuong xa quan huyen tinh tp tx tt thon".split(" "));
const plain = (t) => String(t || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/đ/gi, "d").toLowerCase();

/** Trong các tin khách vừa nhắn (lượt này) có SĐT không? */
export function phoneInTexts(texts) {
  return (texts || []).some((t) => PHONE_RE.test(String(t || "").replace(/[\s.\-]/g, "")));
}

/**
 * Trong các tin khách vừa nhắn (lượt này) có địa chỉ không?
 * `aiAddress` = địa chỉ AI trích ra: chỉ tính khi các từ của nó thật sự xuất hiện trong tin vừa nhắn (không phải chỉ trong lịch sử).
 */
export function addressInTexts(texts, aiAddress = "", { requireClearSignal = false, ruleOff = false } = {}) {
  const list = (texts || []).map((t) => String(t || "")).filter((t) => t.trim());
  if (!list.length) return false;
  // ruleOff: AI đã ghi tình huống là chuyện khác (hỏi giá/ship...) → bỏ luật đoán theo mẫu chữ, chỉ còn đường "địa chỉ AI trích ra có nằm trong tin khách"
  if (!ruleOff && list.some((t) => {
    const p = addressPartOfMixed(t);
    if (!requireClearSignal) return looksLikeAddressStrict(p);
    return hasClearAddressSignal(p) && (p !== t || looksLikeAddressStrict(p));
  })) return true;
  const tokens = plain(aiAddress).replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter((w) => w && !UNIT_WORDS.has(w));
  if (tokens.length < 3) return false;
  const blob = new Set(plain(list.join(" \n ")).replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter(Boolean));
  const hit = tokens.filter((w) => blob.has(w)).length;
  return hit / tokens.length >= 0.6;
}
