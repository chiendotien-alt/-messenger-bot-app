// lib/replyGuard.js — chặn "rò rỉ" ghi chú nội bộ của AI ra tin gửi khách.
// Lỗi gốc: khi AI không trả JSON (lần thử 2 không bật chế độ JSON, hoặc AI dự phòng Groq), nó viết thẳng phần
// "Bước phân tích tình huống: ... Tin nhắn: 1. ... 2. ..." ra chữ thường → hệ thống coi cả đoạn là câu trả lời và gửi cho khách.
// Ngoài ra AI đôi khi chèn 1-2 chữ lạ (Bengali, Thái, Hindi...) vào đầu tin.

// Các hệ chữ không bao giờ xuất hiện trong tin bán hàng tiếng Việt
const FOREIGN_SCRIPT_RE =
  /[\p{Script=Bengali}\p{Script=Devanagari}\p{Script=Thai}\p{Script=Arabic}\p{Script=Hebrew}\p{Script=Cyrillic}\p{Script=Hangul}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Han}\p{Script=Tamil}\p{Script=Telugu}\p{Script=Gujarati}\p{Script=Gurmukhi}\p{Script=Kannada}\p{Script=Malayalam}\p{Script=Khmer}\p{Script=Lao}\p{Script=Myanmar}\p{Script=Sinhala}\p{Script=Georgian}\p{Script=Armenian}]+/gu;

// Dấu hiệu ghi chú nội bộ / phân tích bị lộ
const LEAK_RE =
  /bước\s+phân\s+tích|phân\s+tích\s+tình\s+huống|tinh_huong|tình\s+huống\s*:|(?:^|\n)\s*[-*•]?\s*(?:xưng\s+hô|cần\s+tư\s+vấn|theo\s+trạng\s+thái)[^\n]{0,40}:|(?:^|\n)\s*(?:tin\s+nhắn|nội\s+dung\s+tin|câu\s+trả\s+lời)\s*:/iu;

const REPLY_MARK_RE = /(?:^|\n)\s*(?:tin\s+nhắn|nội\s+dung\s+tin|câu\s+trả\s+lời)\s*:\s*/iu;

export function stripForeignScript(t) {
  return String(t || "")
    .replace(FOREIGN_SCRIPT_RE, "")
    .replace(/^[\s/\\|:;,\-–—]+/, "")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

export function looksLikeLeak(t) {
  return LEAK_RE.test(String(t || ""));
}

/** Từ một đoạn có lộ phân tích → chỉ lấy phần sau "Tin nhắn:" (tối đa 2 tin). Không có phần đó → [] (hệ thống sẽ gọi AI lại). */
export function extractRealMessages(t) {
  const s = String(t || "");
  const m = REPLY_MARK_RE.exec(s);
  if (!m) return [];
  const body = s.slice(m.index + m[0].length);
  return body
    .split(/\n+/)
    .map((l) => l.replace(/^\s*(?:\d+\s*[.)]|[-*•])\s*/, "").replace(/^["“”']+|["“”']+$/g, "").trim())
    .map(stripForeignScript)
    .filter((l) => l && !looksLikeLeak(l))
    .slice(0, 2);
}

/** Làm sạch danh sách tin sắp gửi khách: bỏ chữ lạ, bóc phần phân tích bị lộ, bỏ tin trùng, tối đa 2 tin. */
export function cleanReplyList(list) {
  const out = [];
  for (const raw of list || []) {
    const t = stripForeignScript(raw);
    if (!t) continue;
    if (looksLikeLeak(t)) {
      out.push(...extractRealMessages(t));
    } else {
      out.push(t);
    }
  }
  const seen = new Set();
  return out.filter((m) => (seen.has(m) ? false : seen.add(m))).slice(0, 2);
}
