// lib/aiRecognized.js — "AI báo đã nhận" chiều cao / cân nặng của khách.
//
// Vấn đề: khách gõ số đo kiểu lạ ("cn 50 cc 155", "nặg 5o kg", "cao mét năm lăm") → quy tắc (regex) trong code bỏ sót,
// dù AI đọc hiểu và trả lời đúng. Hệ quả: hỏi bồi / lượt sau lại hỏi lại số đo.
// Cách xử lý: AI trả thêm trường khach_da_cho = { chieu_cao: true/false, can_nang: true/false }. Code KIỂM TRA (chống AI nói bừa:
// khách phải thật sự đã gõ con số nào đó), lưu vào hồ sơ khách (info.body = "height,weight"), rồi CỘNG với kết quả của quy tắc.
// Chỉ cộng thêm, không bao giờ xóa.

const TRUE_WORDS = new Set(["true", "co", "có", "yes", "da", "đã", "1"]);

function truthy(v) {
  if (v === true) return true;
  if (typeof v === "number") return v === 1;
  if (typeof v === "string") return TRUE_WORDS.has(v.trim().toLowerCase());
  return false;
}

// Khách có gõ con số (hoặc số viết bằng chữ / đơn vị đo) nào chưa? Không dùng "không", "năm", "ba", "hai", "sau" vì trùng chữ thường ("còn không shop").
const NUMBER_HINT_RE = /\d|(?<![\p{L}])(?:mét|met|kg|ký|kí|mươi|muoi|mười|lăm|bảy|bay|tám|tam|chín|chin|bốn|bon)(?![\p{L}])/iu;

export function customerHasNumbers(texts) {
  return (texts || []).some((t) => NUMBER_HINT_RE.test(String(t || "")));
}

/** Đọc trường khach_da_cho của AI → { height, weight }. Khách chưa nói số nào thì không tin (AI nói bừa). */
export function parseKhachDaCho(raw, customerTexts) {
  const out = { height: false, weight: false };
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return out;
  if (!customerHasNumbers(customerTexts)) return out;
  out.height = truthy(raw.chieu_cao ?? raw.height);
  out.weight = truthy(raw.can_nang ?? raw.weight);
  return out;
}

export function bodyFlagsToInfo(flags) {
  const parts = [];
  if (flags?.height) parts.push("height");
  if (flags?.weight) parts.push("weight");
  return parts.join(",");
}

export function bodyFlagsFromInfo(info) {
  const set = new Set(String(info?.body || "").split(",").map((s) => s.trim()));
  return { height: set.has("height"), weight: set.has("weight") };
}

/** Quy tắc HOẶC AI: một bên nhận là coi như khách đã nói. */
export function mergeBodyFlags(a, b) {
  return { height: Boolean(a?.height || b?.height), weight: Boolean(a?.weight || b?.weight) };
}

/**
 * Sau mỗi lượt AI trả lời: có thông tin số đo MỚI cần lưu không? Trả chuỗi để lưu vào info.body, hoặc null nếu không có gì mới.
 * savedInfo = hồ sơ khách đã lưu. Chỉ cộng thêm, không xóa cái đã lưu.
 */
export function bodyUpdateFromReply({ khachDaCho, customerTexts, savedInfo }) {
  const saved = bodyFlagsFromInfo(savedInfo);
  const merged = mergeBodyFlags(saved, parseKhachDaCho(khachDaCho, customerTexts));
  const next = bodyFlagsToInfo(merged);
  if (!next || next === bodyFlagsToInfo(saved)) return null;
  return next;
}
