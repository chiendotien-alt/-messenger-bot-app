// lib/replyDedupe.js — chặn bot hỏi/xin lại 1 thông tin mà bot/shop vừa hỏi (mặc định so với 3 tin gần nhất).
//
// So từng CÂU (không phải cả tin), vì AI hay gộp nhiều câu trong 1 tin và hay đổi cách nói
// ("Chị cho em xin cân nặng...?" → "Dạ chị cho em xin cân nặng để em chọn size... nha chị.").
// Chỉ xét câu HỎI/XIN (có dấu ? hoặc có cụm "cho em xin/biết/hỏi", "xin thêm"...).
// Câu thường (giá, số tài khoản, địa chỉ...) không bao giờ bị chặn, vì khách xin lại thì bot phải gửi lại được.

const MIN_CONTENT = 3; // câu phải có ít nhất ngần này từ khóa (đã bỏ chữ đệm như dạ/chị/em/nha...)
const MIN_SHARED = 3; // và trùng ít nhất ngần này từ khóa với câu cũ
const SIMILAR = 0.6; // tỉ lệ từ khóa trùng (so với câu ngắn hơn) từ 60% trở lên → coi là hỏi lặp

// Chữ đệm/xưng hô (viết không dấu) — bỏ đi để chỉ so phần nội dung (cân nặng, size, màu, địa chỉ...)
const FILLER = new Set(
  "da vang uh a ah oi nha nhe nhi nghen ne chi anh em shop minh cho xin la de va thi cua cung voi rat lam nhat qua nua them the nay kia do duoc co khong ko k ma ban to bo cai nhung vay roi luon dang se giup".split(" ")
);

// Cụm cho biết câu đang xin/hỏi khách điều gì (không dấu, chữ thường)
const ASK_CUE = /\b(cho (em|shop|minh) (xin|biet|hoi)|xin them|nhan (cho )?(em|shop)|gui (cho )?(em|shop)|bao (em|shop))\b/;

function plain(t) {
  return String(t || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d");
}

function contentWords(t) {
  return plain(t)
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w && !FILLER.has(w));
}

function isAsk(sentence) {
  return sentence.includes("?") || ASK_CUE.test(plain(sentence));
}

// ---- Câu hỏi LẤY THÔNG TIN theo chủ đề (màu, size, số lượng, SĐT, địa chỉ, tên) — dùng cho luật "giãn cách thời gian hỏi lại" ----
const TOPIC_RULES = [
  ["mau", /\b(mau|mau sac|mau nao|mau gi)\b/],
  ["size", /\b(size|sz|kich co|kich thuoc|so do|can nang|chieu cao|cao bao nhieu|nang bao nhieu|bao nhieu kg|bao nhieu can)\b/],
  ["so luong", /\b(so luong|lay may|may cai|may bo|may chiec|may mon)\b/],
  ["so dien thoai", /\b(sdt|so dien thoai|so dt|dien thoai|zalo)\b/],
  ["dia chi", /\b(dia chi|giao (ve|toi|den) dau|ship (ve|toi|den) dau|nhan hang (o|tai|ve)|(xa|huyen|tinh|quan|phuong) nao)\b/],
  ["ten nguoi nhan", /\b(ten nguoi nhan|ten nhan hang|nguoi nhan|ten (cua )?(minh|chi|anh|ban))\b/],
];
// Dấu hiệu câu đang HỎI (không phải chỉ nêu thông tin như "shop có 3 màu đen trắng xanh")
const QUESTION_CUE = /\?|\b(nao|nhi|bao nhieu|may cai|may bo|hay)\b|\bha\b/;

/** Câu (hoặc vế câu) này đang hỏi/xin khách thông tin gì? Trả về mảng chủ đề, rỗng nếu không phải câu hỏi lấy thông tin. */
export function infoTopicsOf(sentence) {
  const p = plain(sentence);
  if (!(QUESTION_CUE.test(p) || ASK_CUE.test(p))) return [];
  return TOPIC_RULES.filter(([, re]) => re.test(p)).map(([name]) => name);
}

/** Cả đoạn tin này đã hỏi khách những chủ đề nào? (xét từng câu và từng vế cách nhau dấu phẩy) */
export function askedTopics(text) {
  const out = new Set();
  for (const parts of splitSentences(text)) {
    for (const s of parts) {
      for (const t of infoTopicsOf(s)) out.add(t);
      for (const clause of s.split(/,\s+/)) for (const t of infoTopicsOf(clause)) out.add(t);
    }
  }
  return out;
}

// Chỉ nhớ các câu hỏi thông tin trong khoảng này (tránh chặn nhầm câu hỏi từ hôm qua)
const ASK_MEMORY_MS = 30 * 60 * 1000;

/** Các chủ đề bot/shop đã từng hỏi khách trong ~30 phút gần đây. rows MỚI NHẤT TRƯỚC: [{ text, ageMs }]. */
export function askedEver(rows) {
  const topics = new Set();
  for (const r of rows || []) {
    if (!(Number(r.ageMs) < ASK_MEMORY_MS)) continue;
    for (const t of askedTopics(r.text)) topics.add(t);
  }
  return topics;
}

/**
 * Giờ hỏi lại tính từ TIN CUỐI CỦA BOT/SHOP (rows[0]). Tin cuối cách đây chưa tới gapMs →
 * trả các chủ đề đã hỏi (không hỏi lại những chủ đề này). Đủ giờ rồi → topics rỗng (được hỏi lại).
 * Chủ đề chưa từng hỏi thì không bị chặn (lần đầu hỏi luôn, không chờ).
 * Trả { topics: Set, ageMs: tin cuối của bot cách đây bao lâu }.
 */
export function recentAskedTopics(rows, gapMs) {
  const ageMs = rows && rows.length ? Number(rows[0].ageMs) : null;
  if (ageMs === null || !(ageMs < gapMs)) return { topics: new Set(), ageMs };
  return { topics: askedEver(rows), ageMs };
}

// ---- Hỏi lại thông minh: tính giờ từ TIN CUỐI CỦA BOT, chỉ xin phần thông tin khách CHƯA đưa ----

// Chủ đề đã hỏi ↔ ô thông tin khách đã lưu (conversations.info). "số lượng" không có ô lưu nên không xét thiếu/đủ.
const TOPIC_INFO_KEY = { mau: "variant", size: "variant", "so dien thoai": "phone", "dia chi": "address", "ten nguoi nhan": "name" };
export const TOPIC_LABEL = { mau: "màu", size: "size", "so luong": "số lượng", "so dien thoai": "số điện thoại", "dia chi": "địa chỉ", "ten nguoi nhan": "tên người nhận" };

/** Trong các chủ đề cho trước, chủ đề nào khách CHƯA đưa (theo thông tin đã lưu)? Trả mảng tên chủ đề, không trùng ô. */
export function missingTopics(topics, info) {
  const out = [];
  const seenKeys = new Set();
  for (const t of topics || []) {
    const key = TOPIC_INFO_KEY[t];
    if (!key || seenKeys.has(key)) continue;
    seenKeys.add(key);
    if (!String(info?.[key] || "").trim()) out.push(t);
  }
  return out;
}

/** Ghép nhãn tiếng Việt: ["mau","so dien thoai"] → "màu và số điện thoại" */
export function topicLabels(topics) {
  const l = (topics || []).map((t) => TOPIC_LABEL[t]).filter(Boolean);
  if (l.length <= 1) return l.join("");
  return l.slice(0, -1).join(", ") + " và " + l[l.length - 1];
}

/**
 * Thông tin TIẾP THEO cần xin khách, theo thứ tự: màu/size → SĐT → địa chỉ → tên người nhận (tối đa 2 mục/lần).
 * - Khách đã đưa mục nào thì bỏ mục đó.
 * - Màu/size và tên người nhận chỉ xin khi bot từng hỏi mục đó trong chat (sản phẩm không có lựa chọn thì khỏi hỏi).
 * - SĐT và địa chỉ luôn cần để lên đơn, kể cả khi chưa từng hỏi.
 * Trả mảng chủ đề (tên không dấu như TOPIC_LABEL); rỗng = đã đủ, không cần hỏi nữa.
 */
export function nextMissing(info, rows) {
  const asked = askedEver(rows);
  const has = (k) => String(info?.[k] || "").trim() !== "";
  const entries = [];
  if (!has("variant") && (asked.has("mau") || asked.has("size"))) {
    entries.push(["mau", "size"].filter((t) => asked.has(t)));
  }
  if (!has("phone")) entries.push(["so dien thoai"]);
  if (!has("address")) entries.push(["dia chi"]);
  if (!has("name") && asked.has("ten nguoi nhan")) entries.push(["ten nguoi nhan"]);
  return entries.slice(0, 2).flat();
}

/**
 * Khách im lặng: đã tới giờ nhắn bồi chưa?
 * - Mốc đếm giờ = TIN CUỐI CỦA BOT/SHOP (rows[0]); đủ askGapMs kể từ đó là tới giờ.
 * - Quá hạn lateMs thì bỏ, không nhắn trễ.
 * rows = tin bot/shop gần nhất, MỚI NHẤT TRƯỚC: [{ text, ageMs }].
 */
export function nudgeDue(rows, { askGapMs, lateMs }) {
  if (!rows || !rows.length) return { due: false, reason: "no-outgoing" };
  const overdue = Number(rows[0].ageMs) - askGapMs; // >= 0: đã tới giờ
  if (overdue < 0) return { due: false, reason: "not-yet" };
  if (overdue > lateMs) return { due: false, reason: "too-late" };
  return { due: true };
}

/**
 * Bỏ khỏi `candidate` những câu hỏi lấy thông tin thuộc các chủ đề trong `blocked` (vừa hỏi chưa lâu).
 * Câu trả lời đi kèm vẫn giữ: "Dạ vải cotton mát lắm chị, chị lấy màu nào ạ?" → "Dạ vải cotton mát lắm chị".
 * Không có gì phải bỏ → trả đúng nguyên văn.
 */
export function removeInfoAsks(candidate, blocked) {
  if (!blocked || !blocked.size) return candidate;
  const hit = (s) => infoTopicsOf(s).some((t) => blocked.has(t));
  let removed = false;
  const lines = splitSentences(candidate)
    .map((parts) =>
      parts
        .map((s) => {
          if (!hit(s)) return s;
          removed = true;
          const clauses = s.split(/,\s+/);
          if (clauses.length < 2) return "";
          const kept = clauses.filter((c) => !hit(c));
          if (!kept.length) return "";
          const text = kept.join(", ").replace(/[,\s]+$/, "");
          return /[.!?…]$/.test(text) ? text : text + ".";
        })
        .filter(Boolean)
    )
    .filter((parts) => parts.length)
    .map((parts) => parts.join(" "));
  return removed ? lines.join("\n") : candidate;
}

function splitSentences(text) {
  // [{ line, parts: [câu, câu...] }, ...]
  return String(text || "")
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => line.split(/(?<=[.!?…])\s+/).filter(Boolean));
}

function sameAsk(a, b) {
  const A = new Set(contentWords(a));
  const B = new Set(contentWords(b));
  if (A.size < MIN_CONTENT || B.size < MIN_CONTENT) return false;
  let shared = 0;
  for (const w of A) if (B.has(w)) shared++;
  return shared >= MIN_SHARED && shared / Math.min(A.size, B.size) >= SIMILAR;
}

/**
 * Bỏ khỏi `candidate` những câu hỏi/xin đã hỏi trong `recentTexts`. Trả về phần còn lại ("" nếu bỏ hết).
 * Không có câu nào lặp → trả đúng nguyên văn `candidate`.
 */
export function removeRepeatedAsks(candidate, recentTexts, { skipInfo = false } = {}) {
  // skipInfo = true: câu hỏi LẤY THÔNG TIN (màu, size, SĐT...) do luật thời gian lo, không so trùng ở đây
  const oldAsks = [];
  for (const t of recentTexts || [])
    for (const line of splitSentences(t))
      for (const s of line) if (isAsk(s) && !(skipInfo && infoTopicsOf(s).length)) oldAsks.push(s);
  if (!oldAsks.length) return candidate;

  const lines = splitSentences(candidate);
  let removed = false;
  const kept = lines
    .map((parts) =>
      parts.filter((s) => {
        if (isAsk(s) && !(skipInfo && infoTopicsOf(s).length) && oldAsks.some((o) => sameAsk(s, o))) {
          removed = true;
          return false;
        }
        return true;
      })
    )
    .filter((parts) => parts.length)
    .map((parts) => parts.join(" "));
  return removed ? kept.join("\n") : candidate;
}
