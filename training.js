// lib/training.js — câu trả lời chuẩn do chủ shop dạy bot (lưu trong Neon Postgres)
import { getSql } from "./db";
import { normKey } from "./products";
import { detectOne, detectSituation } from "./situation";

const MAX_MATCHED = 5; // số tình huống GIỐNG tin khách nhất đưa cho bot đọc
const MAX_STYLE = 4; // số ví dụ mới nhất (không khớp) đưa thêm để bot học giọng điệu
const MATCH_MIN_SCORE = 0.25;
const MATCH_REL_CUTOFF = 0.6; // chỉ giữ tình huống có điểm ≥ 60% điểm của tình huống giống nhất (bớt nhiễu) // dưới mức này coi như không giống
const SITUATION_BOOST = 0.15; // câu đã dạy CÙNG NHÓM tình huống với tin khách (hỏi giá, mặc cả, ship...) được cộng thêm điểm
const SITUATION_MIN_BASE = 0.08; // nhưng phải có chút giống về chữ mới được cộng (tránh kéo câu không liên quan)
const MATCHED_CHARS = 4500;
const STYLE_CHARS = 2500;
const MAX_VARIANTS = 12; // mỗi tình huống có tối đa ngần này cách khách hỏi
const OPENING_MARK = "[Shop đã gửi câu mở đầu quảng cáo + ảnh mẫu]"; // giống lib/botPlayground.js + app/admin/TeachChat.js

const clean = (t, max) => String(t || "").replace(/\r/g, "").trim().slice(0, max);

function mapRow(r) {
  return {
    id: r.id,
    productId: r.product_id || "",
    context: r.context || "",
    customer: r.customer_text,
    reply: r.reply_text,
    createdAt: r.created_at,
  };
}

export async function listTraining() {
  const sql = await getSql();
  const rows = await sql`SELECT * FROM bot_training ORDER BY id DESC LIMIT 500`;
  return rows.map(mapRow);
}

export async function addTraining({ productId, context, customer, reply }) {
  const c = clean(customer, 3000);
  const r = clean(reply, 2000);
  if (!c || !r) throw new Error("Cần có cả câu khách hỏi và câu bot trả lời chuẩn.");
  const sql = await getSql();
  const rows = await sql`INSERT INTO bot_training (product_id, context, customer_text, reply_text)
    VALUES (${productId ? String(productId) : null}, ${clean(context, 1500)}, ${c}, ${r}) RETURNING id`;
  return rows[0].id;
}

export async function updateTraining({ id, productId, customer, reply }) {
  const c = clean(customer, 3000);
  const r = clean(reply, 2000);
  if (!id || !c || !r) throw new Error("Thiếu nội dung cần sửa.");
  const sql = await getSql();
  await sql`UPDATE bot_training SET customer_text = ${c}, reply_text = ${r},
    product_id = ${productId ? String(productId) : null} WHERE id = ${Number(id)}`;
}

export async function deleteTraining(id) {
  const sql = await getSql();
  await sql`DELETE FROM bot_training WHERE id = ${Number(id)}`;
}

const MAX_CHATS_IN_PROMPT = 6; // tối đa số đoạn chat mẫu bot đọc
const MAX_RELEVANT_CHATS = 4; // trong đó tối đa ngần này đoạn GIỐNG cuộc trò chuyện hiện tại nhất
const MAX_CHATS_CHARS = 5000;
const MAX_ONE_CHAT_CHARS = 1600; // đoạn chat quá dài thì chỉ lấy phần đầu (cắt theo tin, không cắt giữa câu)

// Một đoạn chat đã lưu → chữ đưa vào câu lệnh (rỗng nếu không có gì)
function chatToBlock(messages) {
  const lines = [];
  let prevBot = false;
  let len = 0;
  for (const m of Array.isArray(messages) ? messages : []) {
    let text = String(m?.text || "").trim();
    if (!text) continue;
    if (text === OPENING_MARK) text = "(shop gửi câu mở đầu quảng cáo kèm ảnh mẫu sản phẩm)";
    const line = m.from === "customer" ? `Khách: ${text}` : prevBot ? `Shop (tin kế tiếp): ${text}` : `Shop: ${text}`;
    if (lines.length && len + line.length > MAX_ONE_CHAT_CHARS) break;
    lines.push(line);
    len += line.length + 1;
    prevBot = m.from !== "customer";
  }
  return lines.join("\n");
}

// Các đoạn chat mẫu (nút "Dạy bot" ở trang chat chính) → chữ đưa vào câu lệnh của bot.
// Ưu tiên các đoạn GIỐNG cuộc trò chuyện đang diễn ra (so với tin khách), rồi mới đến các đoạn mới sửa gần đây (để giữ giọng điệu).
// Đoạn giống nhất được đặt CUỐI CÙNG (gần câu hỏi nhất nên bot chú ý nhất).
async function getChatExamples(pid, queries = [], label) {
  try {
    const sql = await getSql();
    const rows = await sql`SELECT id, product_id, messages FROM bot_training_chats ORDER BY updated_at DESC LIMIT 60`;
    const cands = []; // mới → cũ
    for (const r of rows) {
      const productId = r.product_id || "";
      if (productId && pid && productId !== pid) continue;
      const msgs = Array.isArray(r.messages) ? r.messages : [];
      const block = chatToBlock(msgs);
      if (!block) continue;
      const customer = msgs
        .filter((m) => m?.from === "customer")
        .map((m) => String(m?.text || "").trim())
        .filter(Boolean)
        .join("\n");
      cands.push({ id: r.id, block, customer });
    }

    const picked = [];
    const used = new Set();
    let total = 0;
    const take = (c) => {
      if (used.has(c.id) || picked.length >= MAX_CHATS_IN_PROMPT) return false;
      if (total + c.block.length > MAX_CHATS_CHARS) return false; // đoạn này quá dài so với chỗ còn lại → thử đoạn khác, không dừng hẳn
      total += c.block.length;
      used.add(c.id);
      picked.push(c);
      return true;
    };

    const ranked = rankEntries(cands.map((c) => ({ ...c })), queries, label).filter((r) => r.score >= MATCH_MIN_SCORE);
    const relevant = [];
    for (const r of ranked) {
      if (relevant.length >= MAX_RELEVANT_CHATS) break;
      if (take(r.entry)) relevant.push(r.entry);
    }
    const recent = [];
    for (const c of cands) {
      if (picked.length >= MAX_CHATS_IN_PROMPT) break;
      if (take(c)) recent.push(c);
    }
    // cũ → mới: các đoạn gần đây trước, đoạn giống nhất sau cùng
    return [...recent.reverse(), ...relevant.reverse()].map((c) => c.block);
  } catch {
    return [];
  }
}

// ---------- Chọn tình huống giống tin khách ----------
// Viết tắt hay gặp → dạng đầy đủ (so sánh sau khi bỏ dấu)
const ABBR = {
  k: "khong", ko: "khong", kh: "khong", hok: "khong", hong: "khong", khg: "khong",
  dc: "duoc", dk: "duoc", bn: "bao nhieu", bnh: "bao nhieu", sp: "san pham", sz: "size",
  ib: "nhan tin", sdt: "so dien thoai", dt: "dien thoai", ship: "giao hang", cod: "thanh toan khi nhan hang",
};
const STOP = new Set(["da", "a", "nha", "nhe", "nhen", "ha", "oi", "vang", "ok", "shop", "ad", "ban", "minh", "chi", "anh", "em", "cho", "la", "va", "thi", "cai", "nay", "kia", "the", "ay", "o", "u"]);

// Các từ có nghĩa của câu (đã bỏ dấu, mở rộng viết tắt, bỏ từ đệm)
function contentWords(text) {
  const words = [];
  for (const w of normKey(text).split(" ").filter(Boolean)) {
    const ex = ABBR[w] || w;
    for (const x of ex.split(" ")) if (!STOP.has(x)) words.push(x);
  }
  return words;
}

function featuresOf(text) {
  const words = contentWords(text);
  const f = new Set(words);
  for (let i = 0; i < words.length - 1; i++) f.add(words[i] + "_" + words[i + 1]);
  return f;
}

function trigrams(text) {
  const t = contentWords(text).join("");
  const g = new Set();
  for (let i = 0; i + 3 <= t.length; i++) g.add(t.slice(i, i + 3));
  return g;
}

function dice(a, b) {
  if (!a.size || !b.size) return 0;
  let n = 0;
  for (const x of a) if (b.has(x)) n++;
  return (2 * n) / (a.size + b.size);
}

/** Tách ô "khách nói" thành các cách hỏi (mỗi dòng 1 cách). */
export function splitVariants(customerText) {
  return String(customerText || "")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .slice(0, MAX_VARIANTS);
}

/**
 * Chấm điểm 0..1 mức giống nhau giữa các tin khách (queries) và từng tình huống đã dạy.
 * Dùng trọng số IDF (từ hiếm quan trọng hơn từ phổ biến như "shop", "có") + độ giống ký tự để chịu lỗi gõ/không dấu.
 */
function rankEntries(entries, queries, labelOverride, strongLabel = false) {
  const qs = (queries || []).map((q) => String(q || "").trim()).filter((q) => q.length >= 2);
  if (!qs.length || !entries.length) return [];

  // Nhóm tình huống của tin khách (do lớp phân loại truyền vào, hoặc đoán bằng luật từ khoá)
  const qLabel = labelOverride || detectSituation(qs);
  const useLabel = qLabel && qLabel !== "khac" && qLabel !== "dong_y_ngan";

  const docs = entries.map((e) => splitVariants(e.customer).map((v) => ({ text: v, f: featuresOf(v), g: trigrams(v), key: contentWords(v).join(" "), label: useLabel ? detectOne(v) : "khac" })));
  const df = new Map();
  let nDocs = 0;
  for (const vs of docs) for (const v of vs) {
    nDocs++;
    for (const x of v.f) df.set(x, (df.get(x) || 0) + 1);
  }
  const idf = (x) => Math.log((nDocs + 1) / ((df.get(x) || 0) + 0.5)) + 1;

  const qv = qs.map((q, i) => ({ f: featuresOf(q), g: trigrams(q), key: contentWords(q).join(" "), weight: i === 0 ? 1 : 0.9 }));

  return entries
    .map((e, idx) => {
      let best = 0;
      let bestVariant = "";
      const sameGroup = useLabel && docs[idx].some((v) => v.label === qLabel);
      for (const v of docs[idx]) {
        for (const q of qv) {
          let dot = 0, nq = 0, nv = 0;
          for (const x of q.f) { const w = idf(x); nq += w * w; if (v.f.has(x)) dot += w * w; }
          for (const x of v.f) { const w = idf(x); nv += w * w; }
          const cos = nq && nv ? dot / (Math.sqrt(nq) * Math.sqrt(nv)) : 0;
          let sc = Math.max(cos, 0.9 * dice(q.g, v.g));
          // một câu chứa trọn câu kia (vd "giảm chút được không shop" ⊃ "giảm chút")
          const shorter = q.key.length <= v.key.length ? q.key : v.key;
          const longer = q.key.length <= v.key.length ? v.key : q.key;
          if (shorter.length >= 4 && (" " + longer + " ").includes(" " + shorter + " ")) sc = Math.max(sc, 0.8);
          sc *= q.weight;
          if (sc > best) { best = sc; bestVariant = v.text; }
        }
      }
      if (sameGroup && best >= SITUATION_MIN_BASE) best = Math.min(1, best + SITUATION_BOOST);
      // Nhãn do AI phân loại (đã chắc) mà tin khách quá ngắn nên không có chữ nào giống ("thôi vậy", "vậy hả"):
      // vẫn lấy các tình huống cùng nhóm, xếp sau những tình huống giống về chữ.
      else if (sameGroup && strongLabel && best < MATCH_MIN_SCORE) best = MATCH_MIN_SCORE + 0.01;
      return { entry: e, score: best, variant: bestVariant };
    })
    .sort((a, b) => b.score - a.score);
}

async function loadEntriesFor(currentProductId) {
  const sql = await getSql();
  const rows = await sql`SELECT * FROM bot_training ORDER BY id DESC LIMIT 500`;
  const pid = currentProductId ? String(currentProductId) : "";
  return rows.map(mapRow).filter((e) => !e.productId || !pid || e.productId === pid); // mới → cũ
}

/** Dùng cho nút "Thử khớp" ở trang Dạy bot: tin khách này sẽ khớp tình huống nào, điểm bao nhiêu. */
export async function matchTraining({ text, productId }) {
  const entries = await loadEntriesFor(productId);
  const ranked = rankEntries(entries, [text]);
  const top = ranked[0]?.score || 0;
  return ranked
    .slice(0, 6)
    .map((r) => ({
      id: r.entry.id,
      score: Math.round(r.score * 100),
      used: r.score >= MATCH_MIN_SCORE && r.score >= top * MATCH_REL_CUTOFF,
      matchedVariant: r.variant,
      customer: r.entry.customer,
      reply: r.entry.reply,
    }));
}

function formatEntry(e, variantsShown) {
  const replyLines = e.reply.split("\n").map((l) => l.trim()).filter(Boolean);
  const vs = splitVariants(e.customer);
  const shown = variantsShown ? vs.slice(0, 4).join(" / ") : vs[0] || e.customer;
  return (
    (e.context ? `(trước đó)\n${e.context}\n` : "") +
    `Khách: ${shown}\n` +
    replyLines.map((l, i) => (i === 0 ? `Shop: ${l}` : `Shop (tin kế tiếp): ${l}`)).join("\n")
  );
}

/**
 * Biến các tình huống đã dạy thành đoạn chữ đưa vào câu lệnh của bot.
 *  - Tin khách vừa nhắn (queries) được so với TOÀN BỘ kho tình huống → chỉ đưa vài tình huống GIỐNG nhất, kèm lệnh "trả lời theo đúng ý này".
 *  - Thêm vài ví dụ mới nhất để bot giữ giọng điệu chung.
 * Không có gì → chuỗi rỗng (bot chạy y như cũ).
 */
export async function getTrainingForPrompt(currentProductId, queries = [], opts = {}) {
  const entries = await loadEntriesFor(currentProductId);

  const all = rankEntries(entries, queries, opts?.label, !!opts?.strong);
  const top = all[0]?.score || 0;
  const ranked = all.filter((r) => r.score >= MATCH_MIN_SCORE && r.score >= top * MATCH_REL_CUTOFF).slice(0, MAX_MATCHED);
  const matchedBlocks = [];
  let total = 0;
  for (const r of ranked) {
    const block = formatEntry(r.entry, true);
    if (total + block.length > MATCHED_CHARS) break;
    total += block.length;
    matchedBlocks.push(block);
  }
  const usedIds = new Set(ranked.slice(0, matchedBlocks.length).map((r) => r.entry.id));

  const styleBlocks = [];
  total = 0;
  for (const e of entries) {
    if (usedIds.has(e.id)) continue;
    const block = formatEntry(e, false);
    if (total + block.length > STYLE_CHARS) break;
    total += block.length;
    styleBlocks.push(block);
    if (styleBlocks.length >= MAX_STYLE) break;
  }
  styleBlocks.reverse();

  const chats = await getChatExamples(currentProductId ? String(currentProductId) : "", queries, opts?.label);
  if (!matchedBlocks.length && !styleBlocks.length && !chats.length) return "";

  let text = `CÁCH TRẢ LỜI CHUẨN (chủ shop đã dạy — ưu tiên hơn các quy tắc về GIỌNG ĐIỆU và CÁCH DẪN DẮT ở trên, nhưng KHÔNG được làm sai trạng thái cuộc trò chuyện thật; xem mục "KHI MÂU THUẪN" ở cuối phần này). Mỗi dòng "Shop:" là một tin nhắn riêng.`;
  if (matchedBlocks.length) {
    text += `\n\nTÌNH HUỐNG GIỐNG TIN KHÁCH VỪA NHẮN (xếp từ giống nhất xuống). Khách đang hỏi đúng kiểu này: hãy trả lời THEO ĐÚNG Ý, thông tin và cách dẫn dắt của câu trả lời chuẩn, giữ giọng điệu của chủ shop. Chỉ đổi xưng hô (anh/chị) cho đúng khách và bỏ chi tiết không hợp ngữ cảnh; giá/thông tin vẫn phải đúng theo danh sách sản phẩm. Nếu các tình huống mâu thuẫn nhau thì theo tình huống đầu tiên. Nếu câu trả lời chuẩn có xin/hỏi tên, số điện thoại, địa chỉ, màu/size mà phần "THÔNG TIN KHÁCH ĐÃ CUNG CẤP" hoặc cuộc trò chuyện thật đã có rồi thì BỎ phần xin đó, chỉ giữ phần còn lại. Nếu thật sự không tình huống nào đúng ý khách thì trả lời theo quy tắc chung.\n\n${matchedBlocks.map((b, i) => `Tình huống ${i + 1}:\n${b}`).join("\n\n")}`;
  }
  if (styleBlocks.length) {
    text += `\n\nVÍ DỤ GIỌNG ĐIỆU (các tình huống khác chủ shop đã dạy — chỉ để học cách nhắn, không cần chép):\n\n${styleBlocks.map((b, i) => `Ví dụ ${i + 1}:\n${b}`).join("\n\n")}`;
  }
  if (chats.length) {
    text += `\n\nCÁC ĐOẠN CHAT MẪU (cả cuộc trò chuyện chuẩn từ đầu đến cuối — đây là cuộc trò chuyện của KHÁCH KHÁC, chỉ để học cách chủ shop dẫn dắt, hỏi lại và chốt đơn; KHÔNG chép nguyên thứ tự câu hỏi, không coi thông tin trong đoạn mẫu là của khách này; các đoạn xếp CUỐI là những đoạn giống nhất)\n\n${chats
      .map((b, i) => `Đoạn chat mẫu ${i + 1}:\n${b}`)
      .join("\n\n")}`;
  }
  text += `\n\nKHI MÂU THUẪN (luôn áp dụng, đứng trên mọi tình huống/đoạn chat mẫu ở trên)\n- Cuộc trò chuyện THẬT và mục THÔNG TIN KHÁCH ĐÃ CUNG CẤP là sự thật. Đoạn mẫu chỉ là cách làm, không phải dữ liệu của khách này.\n- Không hỏi lại thứ khách đã nói hoặc hệ thống đã lưu, dù đoạn mẫu có hỏi ở bước đó. Chỉ hỏi phần còn thiếu để lên đơn.\n- Không lặp lại câu shop vừa hỏi/vừa gửi ở các tin gần nhất, dù đoạn mẫu có câu đó.\n- Khách vừa hỏi gì thì trả lời câu đó trước; không nhảy sang bước chốt đơn của đoạn mẫu khi khách chưa tới bước đó.\n- Giá, size, màu, ưu đãi luôn lấy từ danh sách sản phẩm, không lấy từ đoạn mẫu.`;
  return text;
}
