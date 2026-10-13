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

// Câu hỏi kết thúc bằng "chưa" (vd "chị đã chọn được màu ưng ý chưa ạ", "chọn màu chưa chị ơi!") — không có dấu ? vẫn là câu hỏi
const ASK_END_CHUA = /\bchua(?:\s+(?:a|ak|nhi|nha|nhe|oi|chi|anh|em|ban|minh)){0,3}\s*[!?.…]*\s*$/;

function isAsk(sentence) {
  const p = plain(sentence);
  return sentence.includes("?") || ASK_CUE.test(p) || ASK_END_CHUA.test(p);
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
  if (!(QUESTION_CUE.test(p) || ASK_CUE.test(p) || ASK_END_CHUA.test(p))) return [];
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

// ---- Khách đang LO LẮNG / NGHI NGỜ (đổi trả, hoàn hàng, mất ship, kiểm tra hàng, hàng thật không, uy tín...) ----
// Lúc này bot chỉ trấn an, KHÔNG hỏi thêm thông tin (màu, size, SĐT, địa chỉ...). Hỏi lại là việc của tin nhắn bồi.
const WORRY_RE = new RegExp(
  "(?:^|[^a-z0-9])(?:" +
    [
      "doi tra", "doi hang", "tra hang", "hoan hang", "hoan tien", "hoan ship", "ung hoan",
      "mat (?:phi )?ship", "mat (?:phi|tien)", "phi (?:ship|hoan|doi)", "ship hoan",
      "lua dao", "bi lua", "so lua", "uy tin", "co that", "that khong", "co chac", "chac khong", "cam ket", "bao dam",
      "xem hang", "kiem tra hang", "kiem hang", "dong kiem", "nhan hang (?:dc|duoc)? ?(?:xem|kiem|thu)", "thu hang", "mac thu",
      "(?:ko|k|khong|chua) ung", "neu (?:ko |k |khong )?ung", "lo (?:ko|k|khong) (?:ung|vua|dep)", "so (?:ko|k|khong)? ?(?:vua|ung|dep|giong)", "so (?:mac|mua) (?:ko|k|khong) (?:vua|ung|dep|hop|giong)", "(?:ko|k|khong) (?:biet )?(?:co )?(?:vua|giong anh)",
    ].join("|") +
    ")(?:$|[^a-z0-9])"
);
export function isWorryText(text) {
  return WORRY_RE.test(plain(text).replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " "));
}

// ---- Khách đã nói chiều cao / cân nặng chưa? (hiểu 1m47, 1,47m, 1.47m, 147cm, cao 147, 45kg, 45 ký, 45 cân, nặng 45...) ----
export const HEIGHT_TEXT_RE = /(?<![\d.,])(?:[12](?:\s?m\s?\d{0,2}|[,.]\d{1,2}\s?m)|1[3-9]\d\s?cm|cao\s+\d)(?![\p{L}\p{N}])/iu;
export const WEIGHT_TEXT_RE = /(?<![\d.,])\d{2,3}(?:[.,]\d)?\s?(?:kg|ky|kí|ký|kilo|cân|can)(?![\p{L}\p{N}])|(?:nặng|nang)\s*\d{2,3}/iu;

/** Từ danh sách tin của khách → { height, weight } (true nếu khách đã nói). */
export function bodyInfoGiven(customerTexts) {
  const all = (customerTexts || []).map((t) => String(t || "")).join(" \n ");
  return { height: HEIGHT_TEXT_RE.test(all), weight: WEIGHT_TEXT_RE.test(all) };
}

const BODY_RE = /\b(can nang|chieu cao|cao bao nhieu|nang bao nhieu|bao nhieu kg|kg)\b/;
const WEIGHT_RE = /\b(can nang|nang bao nhieu|bao nhieu kg|bao nhieu can|kg)\b/;
const HEIGHT_RE = /\b(chieu cao|cao bao nhieu|m\d+)\b/;

// Cụm ngắn cho từng chủ đề khi ghép thành câu hỏi lại
function topicPhrase(topic, refText, sizeNeed) {
  if (topic === "size") {
    if (sizeNeed === "weight") return "cân nặng"; // khách đã nói chiều cao → chỉ xin cân nặng
    if (sizeNeed === "height") return "chiều cao"; // khách đã nói cân nặng → chỉ xin chiều cao
    const p = plain(refText);
    const w = WEIGHT_RE.test(p), h = HEIGHT_RE.test(p);
    if (w && !h) return "cân nặng"; // chỉ đang xin cân nặng (khách đã cho chiều cao rồi) → hỏi đúng cân nặng thôi
    if (h && !w) return "chiều cao";
    return w && h ? "chiều cao cân nặng" : "size";
  }
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
// Kiểu tự xưng mặc định khi chưa có tin nào của shop cho biết ("em" hay "shop")
const DEFAULT_SELF = "em";
// text = các tin shop đã gửi, MỚI NHẤT TRƯỚC (mỗi tin một dòng). Tự xưng: tin MỚI NHẤT có "em" hoặc "shop" quyết định → cả cuộc chat chỉ một kiểu, không lúc "em" lúc "shop".
function pronounsFrom(text) {
  const t = String(text || "").toLowerCase();
  const kh = (t.match(/(?:^|[\s,.!?])(chị|anh|bạn|cô|chú|bác)(?=$|[\s,.!?])/) || [])[1] || "mình";
  let tu = DEFAULT_SELF;
  for (const line of t.split(/\n+/)) {
    const l = line.replace(/\bshop\s+em\b/g, " "); // "Shop em" = tên shop, không tính là tự xưng
    const hasEm = /(?:^|[\s,.!?])em(?=$|[\s,.!?])/.test(l);
    const hasShop = /(?:^|[\s,.!?])shop(?=$|[\s,.!?])/.test(l);
    if (hasEm !== hasShop) { tu = hasEm ? "em" : "shop"; break; }
  }
  return { kh, tu };
}

const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

/** Lưu ý của chủ shop có YÊU CẦU RÕ \"nói trống không / không xưng hô\" không? Chỉ khi đó mới bỏ chị/anh/em. Có lưu ý nhưng không nói gì về xưng hô → vẫn xưng hô lễ phép như bình thường. */
export function notesForbidPronouns(notes) {
  const t = plain(notes);
  return /\b(nong khong|khong (can )?(xung ho|goi (khach|anh|chi|ban))|bo xung ho|khong dung (anh|chi|ban|em))\b/.test(t);
}


// ---- Mỗi câu hỏi (kể cả tin bồi) chỉ xin 1 NHÓM thông tin. Nhóm: size (chiều cao + cân nặng), màu, số lượng, nhận hàng (SĐT + địa chỉ + tên) ----
const TOPIC_GROUP = { size: "size", mau: "mau", "so luong": "so luong", "so dien thoai": "nhan hang", "dia chi": "nhan hang", "ten nguoi nhan": "nhan hang" };
const TOPIC_PRIORITY = ["size", "mau", "so luong", "so dien thoai", "dia chi", "ten nguoi nhan"];

/** Đoạn tin này có hỏi gộp từ 2 nhóm thông tin trở lên không (vd "cân nặng và màu")? */
export function asksMultipleGroups(text) {
  const groups = new Set([...askedTopics(text)].map((t) => TOPIC_GROUP[t] || t));
  return groups.size > 1;
}

/**
 * Chọn ĐÚNG 1 nhóm thông tin để hỏi lại. rows = tin bot/shop gần nhất, MỚI NHẤT TRƯỚC ({ text }).
 * Ưu tiên nhóm shop vừa hỏi gần nhất mà khách chưa trả lời; không có thì theo thứ tự size > màu > số lượng > nhận hàng.
 * Trả về Set chủ đề (SĐT + địa chỉ vẫn đi cùng nhau vì là 1 nhóm "nhận hàng").
 */
export function pickOneTopic(topics, rows = []) {
  const want = new Set(topics || []);
  if (!want.size) return new Set();
  let group = null;
  for (const r of rows) {
    const hit = [...askedTopics(r.text)].find((t) => want.has(t));
    if (hit) { group = TOPIC_GROUP[hit] || hit; break; }
  }
  if (!group) {
    const first = TOPIC_PRIORITY.find((t) => want.has(t)) || [...want][0];
    group = TOPIC_GROUP[first] || first;
  }
  return new Set([...want].filter((t) => (TOPIC_GROUP[t] || t) === group));
}

/**
 * Soạn câu HỎI LẠI ngắn cho các chủ đề `topics` (Set/mảng). `refText` = câu hỏi cũ (để lấy cách xưng hô, biết hỏi "chiều cao cân nặng" hay "size").
 * `avoid` = các tin bot đã gửi — chọn khung câu chưa dùng. Không có chủ đề hợp lệ → "".
 */
export function buildShortAsk(topics, { refText = "", avoid = [], neutral = false, sizeNeed = "", pronounText = "" } = {}) {
  // Chỉ hỏi 1 nhóm thông tin mỗi câu (không ghép "cân nặng và màu")
  const one = pickOneTopic(topics, []);
  const list = [...one].map((t) => topicPhrase(t, refText, sizeNeed)).filter(Boolean);
  if (!list.length) return "";
  const what = list.length > 1 ? list.slice(0, -1).join(", ") + " và " + list[list.length - 1] : list[0];
  const { kh, tu } = pronounsFrom(pronounText || refText);
  // neutral = "Lưu ý của chủ shop" YÊU CẦU nói trống không (xem notesForbidPronouns) → không gắn chị/anh/bạn/em, nhưng vẫn phải đủ chủ ngữ + vị ngữ (Shop xin ...)
  const frames = neutral
    ? [`Shop xin ${what} của mình nha?`, `Shop cần ${what} để tư vấn ạ?`, `Mình gửi shop ${what} giúp nhé?`]
    : [
        `${cap(kh)} cho ${tu} xin ${what} nha?`,
        `${cap(kh)} gửi ${tu} ${what} nhé?`,
        `${cap(kh)} nhắn ${tu} ${what} giúp nha?`,
        `${cap(kh)} cho ${tu} biết ${what} nha?`,
        `Để ${tu} tư vấn cho chuẩn, ${kh} gửi ${tu} ${what} nha?`,
        `${cap(kh)} bổ sung giúp ${tu} ${what} nha?`,
        `${cap(kh)} báo ${tu} ${what} nhé?`,
        `${cap(kh)} cho ${tu} xin thêm ${what} nhé?`,
        `${cap(kh)} gửi giúp ${tu} ${what} luôn nha?`,
        `${cap(kh)} cho ${tu} xin ${what} ạ?`,
      ];
  const used = new Set();
  for (const t of avoid || []) for (const parts of splitSentences(t)) for (const s of parts) used.add(plain(s).replace(/[^a-z0-9 ]/g, "").trim());
  const norm = (s) => plain(s).replace(/[^a-z0-9 ]/g, "").trim();
  // Đã có tin kiểu "để em tư vấn (cho) chuẩn..." rồi thì đừng dùng lại khung đó (nghe như máy)
  const stemUsed = (avoid || []).some((t) => /tư vấn[^.?!]{0,20}chuẩn/i.test(String(t || "")));
  const free = frames.filter((f) => !used.has(norm(f)) && !(stemUsed && /tư vấn cho chuẩn/.test(f)));
  const pool = free.length ? free : frames.filter((f) => !(stemUsed && /tư vấn cho chuẩn/.test(f)));
  return pool[Math.floor(Math.random() * pool.length)]; // chọn ngẫu nhiên trong các mẫu chưa dùng với khách này
}

/**
 * Tin bồi LẦN 2 dự phòng (khi AI lỗi): nhẹ nhàng mời khách nhắn khi cần, KHÔNG hỏi lại thông tin, KHÔNG giục chốt.
 * refText = các tin gần nhất của shop (để giữ đúng cách xưng hô); avoid = các tin shop đã gửi (tránh trùng câu).
 */
export function buildLightNudge({ refText = "", avoid = [], neutral = false } = {}) {
  const { kh, tu } = pronounsFrom(refText);
  const frames = neutral
    ? ["Cần tư vấn thêm gì cứ nhắn shop nha.", "Có gì chưa rõ cứ nhắn shop nha.", "Shop vẫn ở đây, cần gì cứ nhắn nha.", "Có gì thắc mắc cứ nhắn shop nhé."]
    : [
        `${cap(kh)} cần ${tu} tư vấn thêm gì cứ nhắn ${tu} nha.`,
        `${cap(kh)} cứ thong thả xem, có gì chưa rõ nhắn ${tu} nha.`,
        `Có gì ${kh} còn băn khoăn thì nhắn ${tu} nha.`,
        `${cap(tu)} vẫn ở đây, ${kh} cần gì cứ nhắn nha.`,
        `${cap(kh)} cần tham khảo thêm gì thì nhắn ${tu} nhé.`,
        `Có gì thắc mắc ${kh} cứ nhắn ${tu} nhé.`,
        `${cap(kh)} thấy ưng thì nhắn ${tu} nha.`,
      ];
  const norm = (s) => plain(s).replace(/[^a-z0-9 ]/g, "").trim();
  const used = new Set();
  for (const t of avoid || []) for (const parts of splitSentences(t)) for (const s of parts) used.add(norm(s));
  const free = frames.filter((f) => !used.has(norm(f)));
  const pool = free.length ? free : frames;
  return pool[Math.floor(Math.random() * pool.length)];
}

/**
 * Câu hỏi LẤY THÔNG TIN trong `candidate` mà shop ĐÃ hỏi trước đó (trong `rows` = tin bot/shop gần nhất, mới nhất trước: [{ text }])
 * → thay bằng câu hỏi lại NGẮN và KHÁC cách nói. Phần trả lời đi kèm vẫn giữ.
 * Câu hỏi chưa từng hỏi (lần đầu) hoặc đã đủ ngắn + khác câu cũ → giữ nguyên. Không có gì đổi → trả đúng nguyên văn.
 */
export function softenRepeatedInfoAsks(candidate, rows, { neutral = false } = {}) {
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
        // Ưu tiên câu mới của bot để biết đang xin gì (chỉ cân nặng / chỉ chiều cao / cả hai); không có thì lấy câu cũ
        const ask = buildShortAsk(topics, { refText: BODY_RE.test(plain(s)) ? s : old.s, avoid, neutral, pronounText: avoid.join("\n") });
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
