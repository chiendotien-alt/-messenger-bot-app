// lib/customerRewrite.js — AI "DỊCH LẠI" tin khách thành bản ĐÚNG CHÍNH TẢ theo quy ước của hệ thống, rồi báo cho hệ thống xử lý.
//
// Vấn đề: khách gõ lạ ("M61" = cao 1m61, "5ok" = 50kg, "zai l" = size L, "cám" = cam...). AI đọc hiểu được nhưng các luật của hệ thống
// (nhận số đo, nhận thuộc tính, nhắn bồi, tạo đơn) chỉ biết những kiểu viết đã được dạy → hệ thống tưởng khách chưa nói và xin lại.
// Vá từng kiểu gõ bằng luật thì không bao giờ hết.
//
// Cách làm: ngay trong lượt trả lời, AI viết thêm trường "khach_viet_lai" = từng tin MỚI của khách viết lại đúng chính tả / đúng dạng hệ thống hiểu
// ("cao 1m61", "nặng 50kg", "size L"). Hệ thống KIỂM TRA bản đó (không cho AI bịa số), lưu vào messages.text_norm, và từ đó MỌI luật đọc
// bản đúng chính tả thay cho tin thô. Tin thô vẫn giữ nguyên để chủ shop xem đúng cái khách gõ.
//
// File này không import DB/AI nên test được bằng `npm test`.

const MAX_REWRITE_LEN = 900;
const MAX_EXTRA_WORDS = 4; // bản viết lại được thêm tối đa 4 chữ so với tin gốc (vd "cao", "nặng", "size", "kg")

const wordsOf = (t) => String(t || "").split(/\s+/).filter(Boolean);

const plainNorm = (t) =>
  String(t || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/gi, "d")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();

/** Khách gõ chữ o thay số 0 ("5ok" = 50k, "1m5o" = 1m50, "09o" ...): đổi lại thành số 0 — CHỈ dùng để so số, không dùng để hiển thị. */
export function fixOforZero(t) {
  return String(t || "").replace(/(?<=\d)[oO](?=\d|k(?![\p{L}])|kg|ky|ký|kí|cm|\b)/gu, "0");
}

/** Mọi cụm chữ số trong chữ (đã sửa o→0). "1.61" → ["1","61"]. */
function digitRuns(t) {
  return [...fixOforZero(t).matchAll(/\d+/g)].map((m) => m[0]);
}

/**
 * Kiểm tra MỘT bản viết lại của AI. Trả về chữ đã làm sạch, hoặc "" nếu không dùng được / không khác tin gốc.
 * Chặn AI bịa: mọi số trong bản viết lại phải có trong tin gốc (cho phép "1m" đứng trước số chiều cao: M61 → 1m61),
 * và mọi số ≥ 2 chữ số của tin gốc (SĐT, cân nặng, số nhà...) phải còn nguyên.
 */
export function acceptRewrite(orig, rewritten) {
  const o = String(orig || "").trim();
  let r = String(rewritten ?? "").replace(/[\u0000-\u001f]+/g, " ").replace(/\s+/g, " ").trim();
  if (!o || !r) return "";
  if (r.length > MAX_REWRITE_LEN || r.length > o.length * 2 + 40) return "";
  if (plainNorm(r) === plainNorm(o)) return ""; // không đổi gì → không cần lưu
  if (wordsOf(r).length > wordsOf(o).length + MAX_EXTRA_WORDS) return ""; // AI viết thêm cả đoạn → không tin

  const origRuns = digitRuns(o);
  const rewRunsAll = digitRuns(r);
  // "1m61": số 1 đứng trước chữ m là phần của đơn vị mét, không tính là "số mới"
  const rewRuns = digitRuns(r.replace(/(?<![\p{L}\p{N}])[12]\s?m(?=\s?\d)/giu, " "));
  // 1) không có số lạ
  for (const run of rewRuns) if (!origRuns.some((x) => x.includes(run))) return "";
  // 2) không mất số quan trọng
  const joined = rewRunsAll.join("");
  for (const run of origRuns) {
    if (run.length < 2) continue;
    if (!rewRunsAll.some((x) => x.includes(run)) && !joined.includes(run)) return "";
  }
  return r;
}

/**
 * Lấy danh sách bản viết lại từ JSON AI trả về, ghép với các tin khách đang chờ trả lời.
 * targets = [{ id, text }] (cũ → mới). Trả về [{ index, id, orig, norm }] chỉ gồm các bản ĐÃ qua kiểm tra.
 * - AI trả mảng đúng số tin → ghép theo thứ tự.
 * - AI trả 1 chuỗi (hoặc mảng 1 phần tử) cho nhiều tin → coi là bản viết lại của CẢ cụm, gắn vào tin cuối (kiểm tra với cả cụm).
 * - Số lượng lệch mà không phải hai trường hợp trên → bỏ (không đoán).
 */
export function pickRewrites(parsed, targets) {
  const raw = parsed && typeof parsed === "object" ? parsed.khach_viet_lai : null;
  const list = (Array.isArray(raw) ? raw : typeof raw === "string" ? [raw] : []).map((x) => (typeof x === "string" ? x : x?.chuan || x?.text || ""));
  const tg = (targets || []).filter((t) => String(t?.text || "").trim());
  if (!list.length || !tg.length) return [];
  const out = [];
  if (list.length === tg.length) {
    tg.forEach((t, i) => {
      const norm = acceptRewrite(t.text, list[i]);
      if (norm) out.push({ index: i, id: t.id ?? null, orig: t.text, norm });
    });
    return out;
  }
  if (list.length === 1) {
    const all = tg.map((t) => String(t.text).trim()).join(" ");
    const norm = acceptRewrite(all, list[0]);
    const last = tg[tg.length - 1];
    if (norm) out.push({ index: tg.length - 1, id: last.id ?? null, orig: last.text, norm, joined: true });
  }
  return out;
}

/** Danh sách tin để các LUẬT đọc: tin khách đã có bản đúng chính tả thì dùng bản đó (tin thô giữ nguyên ở trường rawText). */
export function ruleRows(rows) {
  return (rows || []).map((m) => {
    const n = m && m.from === "customer" ? String(m.text_norm || m.norm || "").trim() : "";
    return n ? { ...m, rawText: m.text, text: n } : m;
  });
}

/** Thay các tin của lượt này (mảng chữ) bằng bản đúng chính tả nếu có. rewrites từ pickRewrites; targets là danh sách đã đưa vào pickRewrites. */
export function applyRewritesToTexts(texts, rewrites, targets) {
  const byText = new Map();
  (rewrites || []).forEach((r) => {
    const t = (targets || [])[r.index];
    const key = String(t?.text ?? r.orig ?? "").trim();
    if (key) byText.set(key, r.norm);
  });
  return (texts || []).map((t) => byText.get(String(t || "").trim()) || t);
}

/** Dặn AI cách viết lại — nối vào ghi chú lượt (prompt). lines = các tin MỚI của khách (chữ thô, cũ → mới). */
export function rewriteTurnNote(lines) {
  const ls = (lines || []).map((l) => String(l || "").trim()).filter(Boolean).slice(-8);
  if (!ls.length) return "";
  return (
    "\n\nVIẾT LẠI TIN KHÁCH (trường \"khach_viet_lai\"): đúng " + ls.length + " phần tử, theo đúng thứ tự các tin MỚI của khách dưới đây:\n" +
    ls.map((l, i) => `${i + 1}. ${l}`).join("\n") +
    "\nMỗi phần tử = tin đó viết lại ĐÚNG CHÍNH TẢ và đúng dạng hệ thống hiểu. Tin nào đã đúng rồi thì chép lại y nguyên. " +
    "Nếu khách gõ lạ mà bạn hiểu được thì ĐỪNG hỏi lại thông tin đó."
  );
}
