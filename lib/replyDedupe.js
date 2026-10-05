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

/**
 * rows = tin bot/shop gần nhất, MỚI NHẤT TRƯỚC: [{ text, ageMs }].
 * Trả { topics: Set chủ đề đã hỏi trong vòng gapMs, ageMs: lần hỏi gần nhất cách đây bao lâu }.
 */
export function recentAskedTopics(rows, gapMs) {
  const topics = new Set();
  let ageMs = null;
  for (const r of rows || []) {
    if (!(Number(r.ageMs) < gapMs)) continue;
    const t = askedTopics(r.text);
    if (!t.size) continue;
    for (const x of t) topics.add(x);
    if (ageMs === null || r.ageMs < ageMs) ageMs = Number(r.ageMs);
  }
  return { topics, ageMs };
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

// ---------------------------------------------------------------------------------------------
// HỎI LẠI NGẮN GỌN / ĐỔI CÁCH NÓI
// Lần đầu hỏi xin thông tin → hỏi nguyên văn, không chờ. Từ lần thứ 2 (đã hết "thời gian hỏi lại"),
// nếu AI lại viết câu y như câu cũ → tự đổi sang câu NGẮN hơn và KHÁC cách diễn đạt.
// ---------------------------------------------------------------------------------------------

const BODY_RE = /\b(can nang|chieu cao|cao bao nhieu|nang bao nhieu|bao nhieu kg|kg)\b/;

// Cụm ngắn cho từng chủ đề khi ghép thành câu hỏi lại
function topicPhrase(topic, refText) {
  if (topic === "size") return BODY_RE.test(plain(refText)) ? "chiều cao cân nặng" : "size";
  return (
    {
      mau: "màu",
      "so luong": "số lượng",
      "so dien thoai": "số điện thoại",
      "dia chi": "địa chỉ nhận hàng",
      "ten nguoi nhan": "tên người nhận",
    }[topic] || ""
  );
}

// Giữ đúng cách xưng hô shop đang dùng: khách (chị/anh/bạn...) và shop tự xưng (shop/em)
function pronounsFrom(text) {
  const t = String(text || "").toLowerCase();
  const kh = (t.match(/(?:^|[\s,.!?])(chị|anh|bạn|cô|chú|bác)(?=$|[\s,.!?])/) || [])[1] || "mình";
  const tu = /(?:^|[\s,.!?])shop(?=$|[\s,.!?])/.test(t) ? "shop" : "em";
  return { kh, tu };
}

const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

/**
 * Soạn câu HỎI LẠI ngắn cho các chủ đề `topics` (Set/mảng). `refText` = câu hỏi cũ (để lấy cách xưng hô, biết hỏi "chiều cao cân nặng" hay "size").
 * `avoid` = các tin bot đã gửi — chọn khung câu chưa dùng. Không có chủ đề hợp lệ → "".
 */
export function buildShortAsk(topics, { refText = "", avoid = [] } = {}) {
  const list = [...(topics || [])].map((t) => topicPhrase(t, refText)).filter(Boolean);
  if (!list.length) return "";
  const what = list.length > 1 ? list.slice(0, -1).join(", ") + " và " + list[list.length - 1] : list[0];
  const { kh, tu } = pronounsFrom(refText);
  const frames = [
    `${cap(kh)} cho ${tu} xin ${what} nha?`,
    `${cap(kh)} gửi ${tu} ${what} nhé?`,
    `${cap(kh)} nhắn ${tu} ${what} giúp nha?`,
  ];
  const used = new Set();
  for (const t of avoid || []) for (const parts of splitSentences(t)) for (const s of parts) used.add(plain(s).replace(/[^a-z0-9 ]/g, "").trim());
  const norm = (s) => plain(s).replace(/[^a-z0-9 ]/g, "").trim();
  return frames.find((f) => !used.has(norm(f))) || frames[frames.length - 1];
}

/**
 * Câu hỏi LẤY THÔNG TIN trong `candidate` mà shop ĐÃ hỏi trước đó (trong `rows` = tin bot/shop gần nhất, mới nhất trước: [{ text }])
 * → thay bằng câu hỏi lại NGẮN và KHÁC cách nói. Phần trả lời đi kèm vẫn giữ.
 * Câu hỏi chưa từng hỏi (lần đầu) hoặc đã đủ ngắn + khác câu cũ → giữ nguyên. Không có gì đổi → trả đúng nguyên văn.
 */
export function softenRepeatedInfoAsks(candidate, rows) {
  const olds = [];
  for (const r of rows || [])
    for (const parts of splitSentences(r.text))
      for (const s of parts) {
        const topics = new Set();
        for (const t of infoTopicsOf(s)) topics.add(t);
        for (const c of s.split(/,\s+/)) for (const t of infoTopicsOf(c)) topics.add(t);
        if (topics.size) olds.push({ s, topics });
      }
  if (!olds.length) return candidate;

  const avoid = (rows || []).map((r) => r.text);
  const oldPlain = new Set(olds.map((o) => plain(o.s).replace(/[^a-z0-9 ]/g, "").trim()));
  let changed = false;

  const lines = splitSentences(candidate)
    .map((parts) =>
      parts.map((s) => {
        const clauses = s.split(/,\s+/);
        const hitClauses = clauses.filter((c) => infoTopicsOf(c).length);
        if (!hitClauses.length) return s;
        const topics = new Set();
        for (const c of hitClauses) for (const t of infoTopicsOf(c)) topics.add(t);
        // Đã hỏi trước đó mới tính là hỏi lại (lần đầu thì để nguyên)
        const old = olds.find((o) => [...topics].every((t) => o.topics.has(t)));
        if (!old) return s;
        // Đã đủ ngắn và khác hẳn câu cũ → giữ
        const words = s.replace(/[^\p{L}\p{N}\s]/gu, " ").split(/\s+/).filter(Boolean).length;
        if (words <= 7 && !oldPlain.has(plain(s).replace(/[^a-z0-9 ]/g, "").trim())) return s;
        const ask = buildShortAsk(topics, { refText: old.s, avoid });
        if (!ask) return s;
        changed = true;
        const keep = clauses.filter((c) => !infoTopicsOf(c).length);
        if (!keep.length) return ask;
        const lead = keep.join(", ").replace(/[,\s]+$/, "");
        return (/[.!?…]$/.test(lead) ? lead : lead + ".") + " " + ask;
      })
    )
    .map((parts) => parts.join(" "));
  return changed ? lines.join("\n") : candidate;
}
