// lib/orderItems.js — ĐỐI CHIẾU "AI đọc đơn" với "hệ thống đọc đơn" (luật) để chọn bản đáng tin, KHÔNG hỏi lại khách.
//
// AI ghi danh sách món trong cùng câu trả lời (trường order_items, không tốn thêm lần gọi AI):
//   [{ "qty": 1, "values": { "Màu": "Kem", "Size": "M", "Chiều dài váy": "75cm" } }, ...]
// Hệ thống KIỂM từng giá trị: có trong danh sách của sản phẩm không, và khách có thật sự nhắc tới không (chống AI bịa).
// Rồi so với cách đọc bằng luật (lib/attributes.js):
//   agree      hai bên giống nhau
//   ai_filled  AI đọc được thêm điều luật bỏ sót (vd khách gõ sai chính tả) → dùng bản của AI
//   conflict   hai bên mâu thuẫn → dùng bản của hệ thống (có chữ khách làm bằng chứng) + báo chủ shop xem đơn
//   ai_invalid AI ghi giá trị không có trong danh sách / khách không hề nhắc → bỏ bản AI
//   ai_none    AI không ghi món nào trong khi luật thấy khách đã chọn
// Chỉ chứa luật thuần (không gọi mạng/CSDL) nên test riêng được.
import { plain, matchValues, fixTypos } from "./attributes";

const isColorAttr = (a) => /(^| )mau( |$)/.test(a.key);

/** Khoảng cách chỉnh sửa giữa 2 chuỗi ngắn (để nhận ra khách gõ lệch 1-2 chữ cái). */
export function editDistance(a, b) {
  const x = String(a), y = String(b);
  if (x === y) return 0;
  if (Math.abs(x.length - y.length) > 2) return 3;
  let prev = Array.from({ length: y.length + 1 }, (_, i) => i);
  for (let i = 1; i <= x.length; i++) {
    const cur = [i];
    for (let j = 1; j <= y.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (x[i - 1] === y[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[y.length];
}

// ch↔tr, s↔x, d↔gi/r hay bị gõ lẫn: đưa về một dạng để so
const dialect = (w) => w.replace(/^ch/, "tr").replace(/^s(?=[a-z]{3,})/, "x").replace(/^gi/, "d").replace(/^r(?=[a-z]{3,})/, "d");

/**
 * Khách có NHẮC tới giá trị `label` của thuộc tính `attr` trong `text` không?
 *  "exact": luật đọc ra đúng giá trị này | "fuzzy": có chữ gần giống (gõ sai 1-2 chữ cái) | "none": không thấy
 */
export function valueSupport(attr, label, text) {
  const fixed = fixTypos(text);
  if (matchValues(attr, fixed, { bare: true }).includes(label)) return "exact";
  const lw = plain(label).split(/\s+/).filter(Boolean);
  const words = plain(fixed).replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter(Boolean);
  // giá trị dạng số/ký hiệu ngắn (size S/M/L, 75cm): phải khớp đúng, không so gần giống (tránh "m" khớp chữ khác)
  if (lw.every((w) => w.length <= 3)) return "none";
  const head = lw.find((w) => w.length >= 3) || lw[0];
  const hd = dialect(head);
  const hit = words.some((w) => w.length >= 3 && (editDistance(dialect(w), hd) <= (head.length >= 5 ? 2 : 1)));
  return hit ? "fuzzy" : "none";
}

/** Tên mục AI ghi ("Màu", "size", "Chiều dài") → chỉ số thuộc tính của sản phẩm, hoặc -1. */
export function resolveAttrIndex(attrs, key) {
  const k = plain(key).replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
  if (!k) return -1;
  let i = attrs.findIndex((a) => a.key === k);
  if (i >= 0) return i;
  i = attrs.findIndex((a) => a.key.includes(k) || k.includes(a.key));
  if (i >= 0) return i;
  if (/(^| )(mau|color|colour)( |$)/.test(k)) return attrs.findIndex(isColorAttr);
  if (/(^| )(size|sz|co)( |$)/.test(k)) return attrs.findIndex((a) => /(^| )(size|sz|co)( |$)/.test(a.key));
  if (/(^| )(dai|length)( |$)/.test(k)) return attrs.findIndex((a) => /dai/.test(a.key));
  return -1;
}

// Giá trị AI ghi phải TRÙNG một giá trị trong danh sách của sản phẩm (không cho "3XL" khớp nhầm "XL"); bỏ chữ thừa như "màu", "size", "cm"
const bareValue = (t) => plain(t).replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim().replace(/^(?:mau|size|sz|co|dai|chieu dai)\s+/, "").replace(/\s*cm$/, "").trim();
function findLabel(attr, val) {
  const v = bareValue(val);
  if (!v) return "";
  return attr.values.find((x) => bareValue(x) === v) || "";
}

/**
 * Kiểm tra và chuẩn hóa danh sách món AI ghi.
 * Trả { ok, items: [{ qty, values: { [chỉ số]: nhãn } }], problems: [...], fuzzy: số giá trị khách gõ sai nhưng đọc được }
 */
export function normalizeAiItems(attrs, aiRaw, customerTexts = [], shopTexts = [], skipAttrs = new Set()) {
  const problems = [];
  if (!Array.isArray(aiRaw) || !aiRaw.length) return { ok: false, items: [], problems: ["rỗng"], fuzzy: 0 };
  if (aiRaw.length > 10) return { ok: false, items: [], problems: ["quá nhiều món"], fuzzy: 0 };
  const text = (customerTexts || []).map((t) => String(t || "")).join("\n");
  // Size / chiều dài thường do SHOP tư vấn theo số đo rồi khách đồng ý ngầm → lời tư vấn của shop (các tin gần đây) cũng là căn cứ
  const shopText = (shopTexts || []).map((t) => String(t || "")).join("\n");
  const items = [];
  let fuzzy = 0;
  for (const raw of aiRaw) {
    if (!raw || typeof raw !== "object") { problems.push("món không hợp lệ"); continue; }
    let qty = Math.round(Number(raw.qty ?? raw.sl ?? 1));
    if (!Number.isFinite(qty) || qty < 1 || qty > 50) { problems.push(`số lượng lạ: ${raw.qty}`); qty = 1; }
    const src = raw.values && typeof raw.values === "object" ? raw.values : Object.fromEntries(Object.entries(raw).filter(([k]) => !["qty", "sl"].includes(k)));
    const values = {};
    for (const [k, v] of Object.entries(src)) {
      const val = String(v ?? "").trim();
      if (!val) continue;
      const ai = resolveAttrIndex(attrs, k);
      if (ai < 0) { problems.push(`mục lạ: ${k}`); continue; }
      // Mục khách mới đưa số đo, shop CHƯA tư vấn (size/chiều dài đang chờ shop nói): giá trị AI ghi ở đây là lời tư vấn của chính bot trong lượt này, không phải khách chọn → bỏ qua, không kiểm
      if (skipAttrs.has(ai)) continue;
      const a = attrs[ai];
      if (!a.values.length) continue;
      const label = findLabel(a, val);
      if (!label) { problems.push(`${a.name}: "${val}" không có trong danh sách`); continue; }
      const labels = [label];
      let sup = valueSupport(a, labels[0], text);
      if (sup === "none" && shopText && valueSupport(a, labels[0], shopText) === "exact") sup = "shop";
      if (sup === "none") { problems.push(`${a.name}: "${val}" khách không hề nhắc`); continue; }
      if (sup === "fuzzy") fuzzy++;
      values[ai] = labels[0];
    }
    if (!Object.keys(values).length) { problems.push("món không có giá trị nào hợp lệ"); continue; }
    items.push({ qty, values });
  }
  // Có giá trị bị loại (không hợp lệ / khách không nhắc) → không tin bản AI này (không dùng nửa vời)
  const ok = items.length === aiRaw.length && problems.every((p) => p.startsWith("số lượng lạ")); // số lượng lạ đã đưa về 1; mọi lỗi khác → bỏ cả bản AI
  return { ok, items: mergeSame(attrs, items), problems, fuzzy };
}

const keyOf = (attrs, it) => attrs.map((a, i) => `${i}:${it.values[i] || ""}`).join("|");
/** Gộp các món giống hệt nhau (cộng số lượng). */
export function mergeSame(attrs, items) {
  const out = [];
  for (const it of items || []) {
    const k = keyOf(attrs, it);
    const hit = out.find((x) => x.k === k);
    if (hit) hit.qty += it.qty || 1;
    else out.push({ k, qty: it.qty || 1, values: { ...it.values } });
  }
  return out.map(({ qty, values }) => ({ qty, values }));
}

const totalQty = (items) => (items || []).reduce((n, it) => n + (it.qty || 1), 0);
const unionOf = (attrs, items) => attrs.map((a, i) => new Set((items || []).map((it) => it.values[i]).filter(Boolean)));
const multisetKey = (attrs, items) => (items || []).map((it) => `${keyOf(attrs, it)}#${it.qty || 1}`).sort().join(";");
const subset = (a, b) => [...a].every((x) => b.has(x)); // a ⊆ b

/** Cách đọc của HỆ THỐNG (luật): danh sách món nếu có, và các giá trị đã chọn ở từng mục. */
export function systemView(attrs, status, sysQty = 1) {
  const items = status?.itemsRaw?.length >= 2 ? status.itemsRaw : null;
  const union = attrs.map((a, i) => {
    const x = status?.list?.[i];
    return new Set(x && x.state === "chosen" ? x.picked : []);
  });
  const qty = items ? totalQty(items) : Math.max(1, Number(sysQty) || 1);
  return { items, union, qty, any: !!items || union.some((u) => u.size) };
}

/**
 * Đối chiếu và chọn. Trả:
 *  verdict  none | agree | ai_filled | conflict | ai_invalid | ai_none
 *  final    danh sách món dùng để áp vào đơn (hoặc null = giữ nguyên cách đọc của hệ thống)
 *  mode     "multi" | "fill" | null
 */
export function readOrder({ attrs, status, aiRaw, customerTexts = [], shopTexts = [], sysQty = 1 }) {
  const skipAttrs = new Set((status?.list || []).map((x, i) => (x.state === "measured" ? i : -1)).filter((i) => i >= 0));
  const sys = systemView(attrs, status, sysQty);
  const hasAi = Array.isArray(aiRaw) && aiRaw.length > 0;
  if (!hasAi) return { verdict: sys.any ? "ai_none" : "none", final: null, mode: null, ai: null, sys, notes: [] };
  const ai = normalizeAiItems(attrs, aiRaw, customerTexts, shopTexts, skipAttrs);
  if (!ai.ok) return { verdict: "ai_invalid", final: null, mode: null, ai, sys, notes: ai.problems };
  const aiUnion = unionOf(attrs, ai.items);
  const aiQty = totalQty(ai.items);
  const notes = [];

  // --- cả hai cùng có danh sách món (nhiều món) ---
  if (sys.items) {
    if (multisetKey(attrs, ai.items) === multisetKey(attrs, sys.items)) return { verdict: "agree", final: null, mode: null, ai, sys, notes };
    const sameUnion = attrs.every((_, i) => aiUnion[i].size === sys.union[i].size && subset(aiUnion[i], sys.union[i]));
    const aiCovers = attrs.every((_, i) => subset(sys.union[i], aiUnion[i])) && aiQty >= sys.qty && ai.items.length >= sys.items.length;
    if (aiCovers && !(sameUnion && aiQty === sys.qty && ai.items.length === sys.items.length)) {
      notes.push("AI đọc được nhiều món/giá trị hơn luật");
      return { verdict: "ai_filled", final: ai.items, mode: ai.items.length >= 2 ? "multi" : "fill", ai, sys, notes };
    }
    notes.push(sameUnion ? "cùng giá trị nhưng ghép cặp khác nhau" : "mâu thuẫn giá trị/số lượng");
    return { verdict: "conflict", final: null, mode: null, ai, sys, notes };
  }

  // --- hệ thống chỉ đọc ra các mục đã chọn (không có danh sách món) ---
  const equalUnion = attrs.every((_, i) => aiUnion[i].size === sys.union[i].size && subset(aiUnion[i], sys.union[i]) || (!aiUnion[i].size && !sys.union[i].size));
  const sysCoversAi = attrs.every((_, i) => subset(aiUnion[i], sys.union[i]));
  const aiCoversSys = attrs.every((_, i) => subset(sys.union[i], aiUnion[i]));
  if (equalUnion && aiQty === sys.qty) {
    // Giống nhau về giá trị và số lượng. AI ghi nhiều món → nhận cách GHÉP CẶP của AI (luật chỉ thấy tập hợp, không biết màu nào đi với size nào)
    return { verdict: "agree", final: ai.items.length >= 2 ? ai.items : null, mode: ai.items.length >= 2 ? "multi" : null, ai, sys, notes };
  }
  if (aiCoversSys && aiQty >= sys.qty) {
    notes.push("AI đọc được thêm điều luật bỏ sót");
    return { verdict: "ai_filled", final: ai.items, mode: ai.items.length >= 2 ? "multi" : "fill", ai, sys, notes };
  }
  notes.push(sysCoversAi && aiQty < sys.qty ? "AI đọc ít hơn luật" : "mâu thuẫn giá trị/số lượng");
  return { verdict: "conflict", final: null, mode: null, ai, sys, notes };
}

// ---------------------------------------------------------------------------------------------------------------------
// Chuyển qua lại giữa dạng theo chỉ số (xử lý) và dạng theo TÊN mục (lưu / hiển thị)
// ---------------------------------------------------------------------------------------------------------------------
export const toNamed = (attrs, items) => (items || []).map((it) => ({ qty: it.qty || 1, values: Object.fromEntries(Object.entries(it.values || {}).map(([i, v]) => [attrs[i]?.name || i, v])) }));
export function fromNamed(attrs, named) {
  const out = [];
  for (const it of Array.isArray(named) ? named : []) {
    const values = {};
    for (const [k, v] of Object.entries(it?.values || {})) {
      const i = attrs.findIndex((a) => a.name === k);
      if (i >= 0 && attrs[i].values.some((x) => x === v)) values[i] = v;
    }
    if (Object.keys(values).length) out.push({ qty: Math.max(1, Math.round(Number(it.qty) || 1)), values });
  }
  return out;
}

/** Mô tả ngắn để báo chủ shop / lưu nhật ký: "1x kem M 75cm + 1x trắng XL 92cm" */
export function describeItems(attrs, items) {
  return (items || []).map((it) => `${it.qty || 1}x ${attrs.map((a, i) => it.values?.[i]).filter(Boolean).join(" ")}`).join(" + ") || "(trống)";
}

/**
 * Danh sách món đã lưu từ lượt trước còn dùng được không? Khách nhắn tiếp ĐỔI/THÊM/BỚT thì không dùng (tránh ghi sai đơn).
 *  saved: { items (theo tên mục), src: tin khách cuối cùng lúc AI đọc }, customerTexts: các tin khách cũ → mới
 */
export function savedItemsStillValid(attrs, saved, customerTexts = []) {
  const items = fromNamed(attrs, saved?.items);
  if (!items.length) return null;
  const texts = (customerTexts || []).map((t) => fixTypos(t));
  const src = fixTypos(saved?.src || "");
  let at = -1;
  if (src) for (let i = texts.length - 1; i >= 0; i--) if (texts[i] === src) { at = i; break; }
  const later = at >= 0 ? texts.slice(at + 1) : [];
  for (const t of later) {
    const flip = attrs.some((a, ai) => a.values.length && matchValues(a, t, { bare: false }).some((v) => !items.some((it) => it.values[ai] === v)));
    if (flip) return null;
    if (/(?<![a-z])(?:them|nua|bot|bo|huy|doi|thay)(?![a-z])/.test(plain(t)) && /\d/.test(t)) return null;
  }
  return items;
}
