import { tidyAddress } from "./textTidy";
// lib/priceLadder.js
// BẢNG GIÁ MẶC CẢ của sản phẩm — chủ shop điền trong cài đặt sản phẩm:
//   Số lượng | Giá niêm yết | Các mức giảm | Giá sàn      (mọi số tiền là TỔNG TIỀN cho số lượng đó)
//
// Hệ thống TỰ tính khách đang ở mức giá nào và chỉ đưa cho bot đúng con số cần nói.
// Bot KHÔNG nhìn thấy giá sàn. Luật của chủ shop:
//   - Khách tự đưa một mức giá mà CHƯA thấp hơn giá sàn  → đồng ý luôn (đúng mức khách đưa, nhưng không bao giờ cao hơn giá shop đã báo).
//   - Khách đưa giá thấp hơn giá sàn, hoặc chỉ xin "bớt đi" → hạ xuống mức kế tiếp trong bảng; hết mức thì giữ nguyên.
//
// File này chỉ có hàm thuần (không đụng database) để dùng được ở cả bot, trang "Dạy bot" và trang quản trị.

const strip = (t) =>
  String(t || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d");

const clampMoney = (v) => (Number.isFinite(v) && v >= 1000 && v <= 1e9 ? v : null);

/** "185k" · "185.000" · "185000đ" · "185" (= 185k) · "1tr2" · "1,5 triệu" → số đồng. Không hiểu → null. */
export function parseMoney(input) {
  const t = strip(input).replace(/\s+/g, " ").trim();
  if (!t) return null;
  let m;
  if ((m = t.match(/^(\d+)\s?(?:tr|trieu)\s?(\d{1,3})?$/))) {
    const frac = m[2] ? parseInt(m[2], 10) / Math.pow(10, m[2].length) : 0;
    return clampMoney(Math.round((parseInt(m[1], 10) + frac) * 1e6));
  }
  if ((m = t.match(/^(\d+[.,]\d+)\s?(?:tr|trieu)$/))) return clampMoney(Math.round(parseFloat(m[1].replace(",", ".")) * 1e6));
  if ((m = t.match(/^(\d+(?:[.,]\d+)?)\s?(?:k|nghin|ngan)$/))) return clampMoney(Math.round(parseFloat(m[1].replace(",", ".")) * 1000));
  if ((m = t.match(/^(\d[\d.,\s]*)\s?(d|dong|vnd)?$/))) {
    const digits = m[1].replace(/[^\d]/g, "");
    if (!digits) return null;
    let v = parseInt(digits, 10);
    if (!m[2] && v < 10000) v *= 1000; // gõ "185" nghĩa là 185k
    return clampMoney(v);
  }
  return null;
}

/** Số đồng → cách nói của shop: 175000 → "175k", 1200000 → "1 triệu 2", 166667 → "166.667đ". */
export function fmtMoney(n) {
  const v = Math.round(Number(n) || 0);
  if (v % 1000 !== 0) return v.toLocaleString("vi-VN") + "đ";
  if (v >= 1e6) {
    const m = Math.floor(v / 1e6);
    const r = v - m * 1e6;
    if (r === 0) return `${m} triệu`;
    if (r % 1e5 === 0) return `${m} triệu ${r / 1e5}`;
    return `${m} triệu ${r / 1000}k`;
  }
  return `${v / 1000}k`;
}

/** Đọc bảng giá của sản phẩm → các dòng đã chuẩn hóa, sắp theo số lượng. Dòng sai/thiếu bị bỏ qua. */
export function ladderRows(product) {
  const raw = Array.isArray(product?.priceLadder) ? product.priceLadder : [];
  const rows = [];
  const seen = new Set();
  for (const r of raw) {
    const qty = parseInt(String(r?.qty ?? "").replace(/\D/g, ""), 10);
    const list = parseMoney(r?.list);
    if (!(qty >= 1 && qty <= 99) || !list || seen.has(qty)) continue;
    seen.add(qty);
    const floorIn = parseMoney(r?.floor);
    let floor = floorIn && floorIn <= list ? floorIn : null;
    let steps = String(r?.steps ?? "")
      .split(/[;,\n|→>]+/)
      .map((x) => parseMoney(x))
      .filter((v) => v && v < list && v >= list * 0.3);
    if (floor) steps = steps.filter((v) => v >= floor);
    steps = [...new Set(steps)].sort((a, b) => b - a);
    if (!floor) floor = steps.length ? steps[steps.length - 1] : list;
    rows.push({ qty, list, steps, floor });
  }
  return rows.sort((a, b) => a.qty - b.qty);
}

export const hasLadder = (product) => ladderRows(product).length > 0;

/** Câu mô tả bảng giá đã hiểu (cho chủ shop xem trước trong trang quản trị). */
export function ladderPreview(rows) {
  return (rows || []).map((r) => {
    const chain = [r.list, ...r.steps].map(fmtMoney).join(" → ");
    return `${r.qty} cái: ${chain} (thấp nhất ${fmtMoney(r.floor)})`;
  });
}

// ----------------------------------------------------------------------------------------------
// Tìm số tiền trong một đoạn chat
// ----------------------------------------------------------------------------------------------

const BODY_BEFORE = /(?:size|sz|cao|nang|dai|rong|eo|nguc|mong|vong|so|anh|ma|id|lo|can|dia chi|duong|ngo|ngach|hem|phuong|quan|xom|thon|toa|ap|sn|to|khu|kp|tdp|tt|xa|nha|lang|ban|cum)\s*$/;
const UNIT_AFTER = /^\s?(?:cm|kg|ky|m\b|tuoi|h\b|gio|ngay|nguoi|cai|chiec|vay|ao|quan|bo|ml|g\b|size|sz|%|\/)/;
const PER_ITEM_AFTER = /^\s*(?:\/|moi|mot|1)\s*(?:cai|chiec|vay|ao|quan|bo|em|doi|set)\b/;
const PER_ITEM_BEFORE = /(?:moi|mot)\s+(?:cai|chiec|vay|ao|quan|bo|em|doi|set)\s*[:\-]?\s*$/;

/**
 * Các số tiền trong text. Mặc định chỉ nhận số CÓ đơn vị rõ (175k, 175.000, 175000đ, 1tr2).
 * bare=true: nhận thêm số trần kiểu "175" (= 175k) — chỉ dùng khi bối cảnh chắc chắn đang nói chuyện giá.
 * Trả về [{ value, perItem, start, end }]
 */
export function amountsIn(text, { bare = false } = {}) {
  const s = strip(text);
  const found = [];
  const taken = [];
  const free = (a, b) => taken.every(([x, y]) => b <= x || a >= y);
  const add = (a, b, value) => {
    if (!value || !free(a, b)) return;
    taken.push([a, b]);
    const after = s.slice(b);
    const before = s.slice(0, a);
    found.push({ value, start: a, end: b, perItem: PER_ITEM_AFTER.test(after) || PER_ITEM_BEFORE.test(before) });
  };
  const run = (re, toValue, guard) => {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(s))) {
      const a = m.index;
      const b = a + m[0].length;
      if (guard && !guard(a, b)) continue;
      add(a, b, toValue(m));
    }
  };

  // 1tr2 · 1 triệu 2 · 2tr
  run(/(?<![\d.,])(\d+)\s?(?:tr|trieu)(?:(\d{1,3})(?![a-z\d])|\s(\d{1,3})(?!\s?[a-z\d]))?(?![a-z\d])/g, (m) => {
    const fr = m[2] || m[3];
    const frac = fr ? parseInt(fr, 10) / Math.pow(10, fr.length) : 0;
    return clampMoney(Math.round((parseInt(m[1], 10) + frac) * 1e6));
  });
  // 175k · 175 nghìn · 1,5k
  run(/(?<![\d.,])(\d+(?:[.,]\d+)?)\s?(?:k|nghin|ngan)(?![a-z\d])/g, (m) => clampMoney(Math.round(parseFloat(m[1].replace(",", ".")) * 1000)));
  // 185.000 · 1.200.000 (có thể kèm đ / đồng)
  run(/(?<![\d.,])(\d{1,3}(?:[.,]\d{3})+)(?!\d)(?:\s?(?:d|dong|vnd)(?![a-z]))?/g, (m) => clampMoney(parseInt(m[1].replace(/[^\d]/g, ""), 10)));
  // 185000đ
  run(/(?<![\d.,])(\d{4,9})\s?(?:d|dong|vnd)(?![a-z])/g, (m) => clampMoney(parseInt(m[1], 10)));
  if (bare) {
    // 185000 (5-6 chữ số, không đơn vị)
    run(/(?<![\d.,])(\d{5,6})(?![\d.,])/g, (m) => clampMoney(parseInt(m[1], 10)));
    // 300/2 cái = 300k cho 2 cái (chủ shop hay viết tắt kiểu này) — phải chạy TRƯỚC số 3 chữ số trơn bên dưới
    run(/(?<![\d.,])([1-9]\d{2})\s?\/\s?\d{1,2}\s?(?:cai|chiec|vay|ao|quan|bo|doi|set)\b/g, (m) => parseInt(m[1], 10) * 1000);
    // 175 (= 175k) — bỏ qua số đo, size, tuổi, mã...
    run(
      /(?<![\d.,])([1-9]\d{2})(?![\d.,])/g,
      (m) => parseInt(m[1], 10) * 1000,
      (a, b) => !UNIT_AFTER.test(s.slice(b)) && !BODY_BEFORE.test(s.slice(0, a))
    );
  }
  return found.sort((x, y) => x.start - y.start);
}

/** Có nhắc số tiền rõ ràng (có đơn vị) không. */
export const hasExplicitMoney = (text) => amountsIn(text).length > 0;

// ----------------------------------------------------------------------------------------------
// Hiểu ý khách: số lượng, xin giảm giá
// ----------------------------------------------------------------------------------------------

const WORD_NUM = { mot: 1, hai: 2, ba: 3, bon: 4, nam: 5, sau: 6 };

/** Số lượng khách nói trong tin (lấy 2 cái, 3 váy, mua hai...). Không thấy → null. Lấy lần nhắc CUỐI. */
export function detectQty(text) {
  const s = strip(text);
  const hits = [];
  let m;
  const re1 = /(?<![\d.,])(\d{1,2})\s?(?:cai|chiec|vay|ao|quan|bo|doi|em|set)\b/g;
  while ((m = re1.exec(s))) hits.push({ at: m.index, qty: parseInt(m[1], 10) });
  const re2 = /\b(?:lay|mua|chot|dat|order|can|cho|them)\s+(\d{1,2})\b(?![\d.,])(?!\s?(?:k\b|nghin|ngan|tr\b|trieu|cm|kg|m\b|d\b|dong|%))/g;
  while ((m = re2.exec(s))) hits.push({ at: m.index, qty: parseInt(m[1], 10) });
  const re3 = /\b(mot|hai|ba|bon|nam|sau)\s+(?:cai|chiec|vay|ao|quan|bo|doi|set)\b/g;
  while ((m = re3.exec(s))) hits.push({ at: m.index, qty: WORD_NUM[m[1]] });
  const re4 = /\b(?:lay|mua|chot|dat)\s+(mot|hai|ba|bon|nam|sau)\b/g;
  while ((m = re4.exec(s))) hits.push({ at: m.index, qty: WORD_NUM[m[1]] });
  const ok = hits.filter((h) => h.qty >= 1 && h.qty <= 50).sort((a, b) => a.at - b.at);
  return ok.length ? ok[ok.length - 1].qty : null;
}

const BARGAIN_RE =
  /\b(giam|bot|re hon|re di|re them|mem hon|dat qua|dat the|dat vay|mac ca|xuong gia|thap hon|bot chut|bot di|giam gia|giam them|giam chut|co giam|co bot|uu dai|khuyen mai|sale|gia tot|chot gia|re chut|re xiu|bot xiu|bot it|nua di|nua nha|them nua|them chut nua|chut nua|xiu nua|giam nua)\b/;

/** Khách đang xin giảm giá/mặc cả (kể cả khi chưa nói con số). */
export const isBargainText = (text) => BARGAIN_RE.test(strip(text));

// Tin nhắc tới số tiền nhưng KHÔNG phải khách đề nghị giá (ship, cọc, giá bên khác...)
const NOT_OFFER_RE = /\b(ben kia|ben khac|shop khac|noi khac|cho khac|nha khac|o ngoai|ngoai kia|nhan hang|ship|phi|coc|dat coc|chuyen khoan|ck|tien hang)\b/;
const BODY_WORDS = /(?:\bcao\b|\bnang\b|\bsize\b|\bsz\b|\d\s?(?:cm|kg|ky)\b|\bm\d)/;
const ASKED_BODY = /(cao bao nhieu|nang bao nhieu|can nang|chieu cao|\bsize\b|so dien thoai|\bsdt\b|dia chi|mau nao|mau gi|cao nang)/;

// Số trần (vd "170 đi shop") chỉ được hiểu là giá khi chắc chắn đang nói chuyện giá — tránh nhầm với chiều cao/cân nặng.
const ADDRESS_WORDS = /\b(sn|so nha|to \d|khu|kp|tdp|thon|xom|ngo|ngach|hem|duong|phuong|xa|tt|thi tran|quan|huyen|tinh|thanh pho|tp|sdt|dt|dia chi)\b/;
const PHONE_RE = /(?<!\d)(?:\+?84|0)[\s.]?\d(?:[\s.]?\d){7,9}(?!\d)|\d{9,}/;
/** Tin đang đưa SĐT / địa chỉ → mọi số trong đó là số nhà, số điện thoại, KHÔNG phải giá khách đề nghị. */
export const looksLikeContactText = (text) => {
  const s = strip(text);
  return PHONE_RE.test(s) || ADDRESS_WORDS.test(s);
};

function bareAllowed(text, lastShopText) {
  const s = strip(text);
  if (looksLikeContactText(text)) return false;
  if (BODY_WORDS.test(s)) return false;
  if (ASKED_BODY.test(strip(lastShopText))) return false;
  const nums = (s.match(/(?<![\d.,])\d{2,3}(?![\d.,])/g) || []).length;
  const priceTalk = isBargainText(s) || /\b(gia|chot|lay|mua|bao nhieu)\b/.test(s) || hasExplicitMoney(lastShopText);
  if (!priceTalk) return false;
  if (nums >= 2 && !isBargainText(s)) return false; // "165 55" = chiều cao + cân nặng
  return true;
}

// ----------------------------------------------------------------------------------------------
// Tính tình huống giá của lượt này
// ----------------------------------------------------------------------------------------------

/** Hiểu 1 số tiền khách nói thuộc dòng nào của bảng (tổng tiền hay giá 1 cái). null = không giống giá. */
function interpretAmount(a, rows, qtyHint, perItem) {
  const cands = [];
  for (const r of rows) {
    const lo = r.floor * 0.8;
    const hi = r.list * 1.15;
    const asTotal = a >= lo && a <= hi;
    const perTotal = a * r.qty;
    const asPer = r.qty > 1 && a < lo && perTotal >= lo && perTotal <= hi;
    if (perItem && qtyHint > 1 && r.qty === qtyHint && perTotal >= lo && perTotal <= hi * 1.05) cands.push({ row: r, total: perTotal });
    else if (asTotal) cands.push({ row: r, total: a });
    else if (asPer) cands.push({ row: r, total: perTotal });
  }
  if (cands.length) {
    if (qtyHint) {
      const c = cands.find((x) => x.row.qty === qtyHint);
      if (c) return c;
    }
    return cands.sort((x, y) => x.row.qty - y.row.qty)[0];
  }
  // Không khớp dòng nào nhưng thấp hơn giá sàn một đoạn vừa phải → khách đang trả giá QUÁ THẤP (vẫn phải trả lời, không được lờ đi)
  const minPer = Math.min(...rows.map((r) => r.floor / r.qty));
  if (a >= minPer * 0.5 && a < minPer) {
    const r = (qtyHint && rows.find((x) => x.qty === qtyHint)) || rows[0];
    return { row: r, total: a, tooLow: true };
  }
  return null;
}

function findCustomerOffer(customerNow, lastShopText, rows, qtyHint) {
  for (let i = customerNow.length - 1; i >= 0; i--) {
    const text = String(customerNow[i] || "");
    if (!text.trim()) continue;
    const s = strip(text);
    if (NOT_OFFER_RE.test(s) && !isBargainText(s)) continue;
    if (looksLikeContactText(text) && !isBargainText(s)) continue;
    const list = amountsIn(text, { bare: bareAllowed(text, lastShopText) });
    for (let j = list.length - 1; j >= 0; j--) {
      const it = interpretAmount(list[j].value, rows, qtyHint, list[j].perItem);
      if (it) return { ...it, raw: list[j].value };
    }
  }
  return null;
}

// Mức thấp nhất shop ĐÃ BÁO cho dòng này (bot hoặc chủ shop nhắn). Không có → giá niêm yết.
function lowestQuoted(row, outgoing) {
  let low = row.list;
  for (const m of outgoing || []) {
    const text = String(m?.text || "");
    if (!text) continue;
    const fromAdmin = m.from === "admin";
    const lo = fromAdmin ? row.floor * 0.5 : row.floor; // chủ shop tự giảm sâu hơn bảng = quyền của chủ shop, được tôn trọng
    const sText = strip(text);
    for (const a of amountsIn(text, { bare: fromAdmin })) {
      // Số tiền đứng sau/trước nhãn số lượng KHÁC dòng này (vd "1 vây: 199k" khi đang xét dòng 2 cái) → không phải giá của dòng này
      const lbBefore = sText.slice(Math.max(0, a.start - 30), a.start).match(/(\d{1,2})\s?(?:cai|chiec|vay|ao|quan|bo|doi|set|em)\b[^\d\n]{0,14}$/);
      if (lbBefore && !a.perItem && parseInt(lbBefore[1], 10) !== row.qty) continue;
      const lbAfter = sText.slice(a.end).match(/^\s*cho\s+(\d{1,2})\s?(?:cai|chiec|vay|ao|quan|bo|doi|set)\b/);
      if (lbAfter && parseInt(lbAfter[1], 10) !== row.qty) continue;
      const v = a.perItem && row.qty > 1 ? a.value * row.qty : a.value;
      if (v >= lo && v <= row.list && v < low) low = v;
    }
  }
  return low;
}

/**
 * Tình huống giá của lượt trả lời này.
 *  product       — sản phẩm (có priceLadder)
 *  outgoing      — các tin shop đã gửi cho khách [{ from: "bot"|"admin", text }] (cũ → mới)
 *  customerNow   — tin khách chưa được trả lời (lượt này), cũ → mới
 *  customerRecent— các tin khách trước đó, MỚI NHẤT TRƯỚC (để biết khách đang nói số lượng nào)
 *  lastShopText  — tin shop gửi ngay trước lượt này
 * Trả về null nếu sản phẩm không có bảng giá.
 */
export function computePriceContext({ product, outgoing = [], customerNow = [], customerRecent = [], lastShopText = "", minQty = 0 }) {
  const rows = ladderRows(product);
  if (!rows.length) return null;

  // Số lượng khách đang nói tới
  let qtyHint = null;
  for (let i = customerNow.length - 1; i >= 0 && !qtyHint; i--) qtyHint = detectQty(customerNow[i]);
  for (let i = 0; i < customerRecent.length && !qtyHint; i++) qtyHint = detectQty(customerRecent[i]);
  // Khách chọn thêm màu (mỗi màu 1 cái) mà không nói số lượng → số lượng ít nhất bằng số màu
  if (minQty > (qtyHint || 0)) qtyHint = minQty;
  const qtyGuess = !qtyHint;
  const wantQty = qtyHint || 1;

  const supported = rows.some((r) => r.qty === wantQty);
  // Khách CHƯA nói số lượng → chỉ xét dòng 1 cái, không tự nhảy sang dòng 2+ chỉ vì con số trùng khoảng giá (lỗi SL:2 do số nhà 294)
  const offerRows = qtyGuess && rows.some((r) => r.qty === 1) ? rows.filter((r) => r.qty === 1) : rows;
  const offer = supported || qtyGuess ? findCustomerOffer(customerNow, lastShopText, offerRows, supported ? wantQty : null) : null;

  const row = offer ? offer.row : rows.find((r) => r.qty === wantQty) || null;
  const bargain = customerNow.some((t) => isBargainText(t));
  const ctx = { rows, qty: row ? row.qty : wantQty, qtyGuess: qtyGuess && !offer, row, qtyUnsupported: !row, bargain };

  if (!row) {
    ctx.decision = { type: "unsupported" };
    ctx.dealTotal = null;
    return ctx;
  }

  const lowest = lowestQuoted(row, outgoing);
  const next = row.steps.find((v) => v < lowest) || null;
  ctx.lowest = lowest;
  ctx.next = next;
  ctx.offer = offer ? offer.total : null;

  if (offer) {
    if (offer.total >= row.floor) ctx.decision = { type: "accept", amount: Math.min(offer.total, lowest) };
    else ctx.decision = next ? { type: "counter", amount: next } : { type: "counter_last", amount: lowest };
  } else if (bargain) {
    ctx.decision = next ? { type: "step", amount: next } : { type: "hold", amount: lowest };
  } else {
    ctx.decision = { type: "none", amount: lowest };
  }
  ctx.dealTotal = ctx.decision.amount;
  return ctx;
}

// ----------------------------------------------------------------------------------------------
// Chữ đưa vào lệnh cho bot
// ----------------------------------------------------------------------------------------------

/** Đoạn dặn bot cho lượt này (nối vào cuối system prompt). */
export function priceTurnNote(ctx) {
  if (!ctx) return "";
  const head =
    "\n\nBẢNG GIÁ MẶC CẢ CỦA SẢN PHẨM NÀY (HỆ THỐNG đã tính sẵn — bắt buộc làm đúng, ƯU TIÊN HƠN mọi chỗ khác nói về giảm giá/mặc cả, kể cả quy tắc chung và \"Lưu ý của chủ shop\". " +
    "Đừng nói với khách là có \"bảng giá\", \"giá sàn\" hay \"mức giảm\"):\n";
  const d = ctx.decision;
  const q = ctx.qty;
  let body = "";

  if (d.type === "unsupported") {
    body =
      `- Khách đang nói tới ${q} cái, nhưng bảng giá của sản phẩm chỉ có cho số lượng: ${ctx.rows.map((r) => r.qty).join(", ")}. ` +
      "Với số lượng khác thì báo giá theo phần Nội dung sản phẩm, KHÔNG tự giảm giá; khách đòi bớt thì nói để shop kiểm tra rồi báo lại.\n";
  } else {
    body += `- Số lượng khách đang nói tới: ${q} cái${ctx.qtyGuess ? " (khách chưa nói số lượng, tạm tính 1 cái)" : ""}.\n`;
    body += `- Giá shop ĐÃ BÁO thấp nhất cho ${q} cái: ${fmtMoney(ctx.lowest)}.\n`;
    if (d.type === "accept") {
      body +=
        d.amount === ctx.offer
          ? `- KẾT LUẬN cho tin vừa rồi: khách đề nghị ${fmtMoney(ctx.offer)} cho ${q} cái → SHOP ĐỒNG Ý. Trả lời đồng ý đúng giá ${fmtMoney(d.amount)} (1-2 câu, vui vẻ, không nói là \"giảm sâu\" hay \"lỗ\"), rồi chuyển tiếp bước chốt đơn như bình thường.\n`
          : `- KẾT LUẬN cho tin vừa rồi: khách đề nghị ${fmtMoney(ctx.offer)} → shop chốt đúng giá đã báo ${fmtMoney(d.amount)} cho ${q} cái (không báo cao hơn mức đã nói). Trả lời đồng ý chốt ${fmtMoney(d.amount)}, rồi chuyển tiếp bước chốt đơn.\n`;
    } else if (d.type === "counter") {
      body += `- KẾT LUẬN cho tin vừa rồi: khách đề nghị ${fmtMoney(ctx.offer)}, THẤP HƠN mức shop nhận được → KHÔNG đồng ý ${fmtMoney(ctx.offer)}. Trả lời nhẹ nhàng, hạ giá xuống ${fmtMoney(d.amount)} cho ${q} cái (1-2 câu). Không nói đây là mức thấp nhất hay mức cuối cùng.\n`;
    } else if (d.type === "counter_last") {
      body += `- KẾT LUẬN cho tin vừa rồi: khách đề nghị ${fmtMoney(ctx.offer)}, THẤP HƠN mức shop nhận được và shop đã hết mức để giảm → KHÔNG đồng ý ${fmtMoney(ctx.offer)}, KHÔNG báo mức nào thấp hơn ${fmtMoney(d.amount)}. Nói nhẹ nhàng ${fmtMoney(d.amount)} cho ${q} cái là mức shop làm được ạ (không nhắc \"giá sàn\"); có ưu đãi khác trong Nội dung sản phẩm (freeship...) thì nhắc.\n`;
    } else if (d.type === "step") {
      body += `- KẾT LUẬN cho tin vừa rồi: khách đang xin bớt giá (chưa nêu con số) → hạ xuống ${fmtMoney(d.amount)} cho ${q} cái (1-2 câu). Không nói đây là mức thấp nhất hay mức cuối cùng.\n`;
    } else if (d.type === "hold") {
      body += `- KẾT LUẬN cho tin vừa rồi: khách đang xin bớt nhưng shop đã hết mức giảm → KHÔNG báo mức thấp hơn ${fmtMoney(d.amount)}. Nói nhẹ nhàng ${fmtMoney(d.amount)} cho ${q} cái là mức shop làm được ạ; có ưu đãi khác trong Nội dung sản phẩm (freeship...) thì nhắc.\n`;
    } else {
      body +=
        `- KẾT LUẬN cho tin vừa rồi: khách CHƯA mặc cả. Giá đang áp dụng ${fmtMoney(d.amount)} cho ${q} cái. Chỉ nhắc giá khi khách hỏi và đừng tự giảm. ` +
        `Nếu khách xin bớt chung chung mà dòng này chưa nói tới thì ${ctx.next ? "hạ xuống " + fmtMoney(ctx.next) : "KHÔNG hạ thêm (giữ " + fmtMoney(ctx.lowest) + ")"}. ` +
        `Nếu khách nêu một con số giá cụ thể mà KẾT LUẬN ở đây không nhắc tới thì CHƯA đồng ý ngay: báo lại giá đang áp dụng ${fmtMoney(ctx.lowest)}.\n`;
    }
    body += "- Chỉ nói con số đúng như KẾT LUẬN. Không tự nghĩ ra mức giá khác, không hứa \"để em xin chị chủ giảm thêm\".\n";
  }

  const summary =
    "TIN TÓM TẮT ĐƠN: khi khách đã đưa đủ SĐT + địa chỉ (và đã chọn đủ màu/size), HỆ THỐNG tự gửi ngay sau tin của bạn một tin liệt kê đơn (sản phẩm, phân loại, số lượng, tổng tiền, SĐT, địa chỉ). " +
    "Khi đó bạn KHÔNG tự tóm tắt/liệt kê lại đơn và KHÔNG nhắc lại giá, SĐT, địa chỉ; chỉ viết 1 câu ngắn nhận thông tin hoặc trả lời câu khách vừa hỏi (không nhờ khách kiểm tra đơn — tin của hệ thống đã có câu đó). Ưu tiên hơn \"Bước 4\" ở trên.\n";
  return head + body + summary;
}

/** 1 dòng cho chủ shop biết hệ thống vừa quyết định thế nào (hiện ở trang "Dạy bot"). Chưa mặc cả → rỗng. */
export function priceVerdictText(ctx) {
  if (!ctx || !ctx.decision) return "";
  const d = ctx.decision;
  const q = ctx.qty;
  if (d.type === "accept") return `Bảng giá: khách đề nghị ${fmtMoney(ctx.offer)} → shop ĐỒNG Ý ${fmtMoney(d.amount)} cho ${q} cái.`;
  if (d.type === "counter") return `Bảng giá: khách đề nghị ${fmtMoney(ctx.offer)} (thấp hơn mức shop nhận) → bot phải hạ xuống ${fmtMoney(d.amount)} cho ${q} cái.`;
  if (d.type === "counter_last") return `Bảng giá: khách đề nghị ${fmtMoney(ctx.offer)} (thấp hơn mức shop nhận), đã hết mức giảm → bot giữ ${fmtMoney(d.amount)} cho ${q} cái.`;
  if (d.type === "step") return `Bảng giá: khách xin bớt → bot hạ xuống ${fmtMoney(d.amount)} cho ${q} cái.`;
  if (d.type === "hold") return `Bảng giá: khách xin bớt nhưng đã hết mức giảm → bot giữ ${fmtMoney(d.amount)} cho ${q} cái.`;
  if (d.type === "unsupported") return `Bảng giá: không có bảng cho ${q} cái → bot báo theo Nội dung sản phẩm, không tự giảm.`;
  return "";
}

// ----------------------------------------------------------------------------------------------
// Kiểm tra cuối: tin bot lỡ nói giá thấp hơn sàn → cắt bỏ
// ----------------------------------------------------------------------------------------------

// Câu đang từ chối / than thấp ("150k thì em chưa làm được ạ") — nhắc lại số của khách để từ chối thì không phải lỗi
const REFUSE_RE = /\b(chua|khong|ko|kho|tiec|thap|lo von|lo het|het muc|ngai|khong duoc|chua duoc|chua lam duoc)\b/;

/**
 * Bot lỡ báo/nhận một con số THẤP HƠN mức thấp nhất shop chấp nhận → bỏ câu đó.
 * Chỉ để phòng hờ: bình thường bot đã được dặn đúng con số. Câu đang từ chối mức đó thì giữ.
 * Trả về { messages, changed }.
 */
export function guardPriceMessages(messages, ctx, { tu = "em" } = {}) {
  if (!ctx || !ctx.rows?.length) return { messages, changed: false };
  const T = Math.min(...ctx.rows.map((r) => r.floor / r.qty)); // giá sàn tính cho 1 cái (thấp nhất)
  const bad = (sentence) => amountsIn(sentence).some((a) => a.value >= T * 0.6 && a.value < T) && !REFUSE_RE.test(strip(sentence));
  let changed = false;
  const out = [];
  for (const m of messages || []) {
    const parts = String(m).split(/(?<=[.!?])\s+|\n+/);
    const kept = parts.filter((x) => !bad(x));
    if (kept.length === parts.length) {
      out.push(m);
      continue;
    }
    changed = true;
    const text = kept.join(" ").trim();
    if (text) out.push(text);
  }
  if (changed && !out.length) {
    const d = ctx.decision || {};
    const amt = d.amount || ctx.lowest;
    out.push(amt ? `Dạ giá này ${tu} báo được ${fmtMoney(amt)} cho ${ctx.qty} cái ạ.` : `Dạ để ${tu} kiểm tra lại giá rồi báo mình ạ.`);
  }
  return { messages: out.slice(0, 3), changed };
}

// ----------------------------------------------------------------------------------------------
// Tin tóm tắt đơn do hệ thống ghép (đúng giá, không để bot tự viết lại)
// ----------------------------------------------------------------------------------------------

/** Sản phẩm có ghi miễn phí ship không (để thêm dòng "Phí ship: miễn phí"). */
export function productShipFree(product) {
  const t = strip([product?.description, product?.notes, product?.openingScript].filter(Boolean).join(" "));
  return /(mien phi (ship|van chuyen|giao hang)|free ?ship)/.test(t);
}

/** Phí ship (đồng / đơn) chủ shop nhập trong cài đặt sản phẩm; 0 nếu để trống. */
export function productShipFee(product) {
  const raw = String(product?.shipFee ?? "").trim();
  if (!raw) return 0;
  const v = parseMoney(raw);
  if (v) return v;
  const d = Number(raw.replace(/\D/g, ""));
  return Number.isFinite(d) ? d : 0;
}

/** Sản phẩm có màu/size cần khách chọn không (suy từ chữ trong nội dung) — dùng khi sản phẩm chưa có bảng thuộc tính. */
export function productNeedsVariant(product) {
  const t = strip([product?.description, product?.notes].filter(Boolean).join(" "));
  return /\b(mau|size|sz)\b/.test(t);
}

/**
 * SỐ LƯỢNG của đơn — MỘT công thức duy nhất, dùng cho cả tin báo đơn gửi khách lẫn dữ liệu đơn lưu vào hệ thống
 * (trước đây hai nơi tính riêng nên tin báo SL:2 mà đơn lưu SL:1).
 *  - nhiều màu → tổng số lượng từng màu; 1 màu → số lượng của màu đó
 *  - không có màu → số lượng theo bảng giá (nếu khách đã nói) → số lượng khách nói (hintQty) → 1
 */
export function summaryQty({ detail = null, ctx = null, hintQty = null } = {}) {
  const hasPrice = !!(ctx && ctx.row && ctx.dealTotal);
  const fallback = hasPrice && ctx.qty > 0 ? ctx.qty : hintQty > 0 ? hintQty : 1;
  const colors = detail?.colors || [];
  if (colors.length === 1) return colors[0].qty || fallback;
  if (colors.length > 1) return colors.reduce((a, c) => a + (c.qty || 1), 0);
  return fallback;
}

/**
 * Ghép tin tóm tắt đơn. Trả về chuỗi, hoặc "" nếu chưa đủ điều kiện.
 *  info: { name, phone, address, variant }   kh/tu: cách gọi khách / tự xưng đang dùng trong cuộc chat
 */
export function buildSummaryText({ product, ctx, info = {}, kh = "mình", tu = "em", noPrice = false, detail = null, bare = false, hintQty = null }) {
  // bare = chỉ phần thông tin đơn, không có dòng "Đơn của chị:" và dòng nhờ kiểm tra
  // noPrice = sản phẩm không có bảng giá mặc cả (hoặc chưa tính được giá): vẫn tóm tắt đơn nhưng bỏ dòng tổng tiền
  const hasPrice = !!(ctx && ctx.row && ctx.dealTotal);
  if (!hasPrice && !noPrice) return "";
  const phone = String(info.phone || "").trim();
  const address = String(info.address || "").trim();
  if (!phone || !address) return "";
  const pname = String(product?.name || "").trim() || "(chưa rõ)";
  const colors = detail?.colors || [];
  const lines = bare ? [] : [`Đơn của ${kh}:`];
  // Định dạng: dòng 1 = tên sản phẩm; dòng 2 = "Màu đen, size L, dài 92cm, SL:1"
  const lowFirst = (x) => { const t = String(x || "").trim(); return t.charAt(0).toLowerCase() + t.slice(1); };
  const hasDetail = !!(detail && (detail.specs?.length || colors.length));
  lines.push(pname);
  if (hasDetail) {
    const parts = [];
    const sl = summaryQty({ detail, ctx, hintQty });
    if (colors.length === 1) {
      parts.push(`Màu ${lowFirst(colors[0].name)}`);
    } else if (colors.length > 1) {
      // Mỗi màu ghi đúng số lượng riêng khi có màu lấy nhiều hơn 1 cái: "Màu đen x2 + kem x1"
      const perColor = colors.some((c) => (c.qty || 1) > 1);
      parts.push(`Màu ${colors.map((c) => lowFirst(c.name) + (perColor ? ` x${c.qty || 1}` : "")).join(" + ")}`);
    }
    parts.push(...(detail.specs || []));
    parts.push(`SL:${sl}`);
    lines.push(parts.join(", "));
  } else {
    const variant = String(info.variant || "").trim();
    const sl = summaryQty({ ctx, hintQty });
    lines.push(variant ? `${variant}, SL:${sl}` : `SL:${sl}`);
  }
  if (hasPrice) {
    const fee = productShipFee(product);
    if (fee > 0) lines.push(`Tổng tiền: ${fmtMoney(ctx.dealTotal + fee)} (gồm ship)`);
    else if (productShipFree(product)) lines.push(`Tổng tiền: ${fmtMoney(ctx.dealTotal)} (freeship)`);
    else lines.push(`Tổng tiền: ${fmtMoney(ctx.dealTotal)} (chưa gồm ship)`);
  }
  // Tin báo đơn KHÔNG ghi tên khách (chỉ SĐT + địa chỉ); địa chỉ được chỉnh chính tả (viết hoa, dấu phẩy, bỏ dấu cách thừa)
  lines.push(`SĐT ${phone} · ${tidyAddress(address)}`);
  if (!bare) {
    const Kh = kh.charAt(0).toUpperCase() + kh.slice(1);
    lines.push(`${Kh} kiểm tra giúp ${tu}, đúng thì ${tu} lên đơn luôn ạ.`);
  }
  return lines.join("\n");
}

/**
 * Câu CUỐI của chuỗi chốt đơn do hệ thống gửi: "Đơn hàng giao trong khoảng từ 3-4 ngày chị để ý điện thoại giúp em nha."
 * Dùng để biết bot đã chốt đơn xong → tự tắt bot với khách đó (đúng cấu trúc câu buildOrderMessages sinh ra, nên câu AI tự viết
 * kiểu "ship khoảng 3-4 ngày" khi khách hỏi giao hàng KHÔNG bị tính).
 */
export const isOrderClosingMessage = (t) => /^Đơn hàng giao trong khoảng (?:từ \d+-\d+|\d+) ngày .{1,20} để ý điện thoại giúp .{1,20} nha\.?$/.test(String(t || "").trim());

/** Tin nhắn có dạng bản tóm tắt đơn (có dòng SĐT + số điện thoại) không. */
export const looksLikeOrderBlock = (t) => /SĐT:?\s*[\d .]{9,}/.test(String(t || ""));

/**
 * Chuỗi tin chốt đơn gửi cho khách (2 tin):
 *   tin 1: "Em lên đơn ạ:" + thông tin đơn (cùng 1 tin)
 *   tin 2: "Đơn hàng giao trong khoảng từ 3-4 ngày chị để ý điện thoại giúp em nha."
 * Đơn đã được tóm tắt trước đó mà nay đổi nội dung (thêm màu...) thì: "Em cập nhật lại đơn nha chị:" + thông tin đơn mới (không nhắc giao hàng nữa).
 * Trả { block, messages, updated } hoặc null nếu chưa đủ điều kiện.
 */
export function buildOrderMessages({ product, ctx, info = {}, kh = "mình", tu = "em", noPrice = false, detail = null, sentBefore = [], deliveryDays = null, hintQty = null }) {
  const block = buildSummaryText({ product, ctx, info, kh, tu, noPrice, detail, bare: true, hintQty });
  if (!block) return null;
  const cap = (x) => x.charAt(0).toUpperCase() + x.slice(1);
  const updated = (sentBefore || []).some(looksLikeOrderBlock);
  // Đơn đã gửi rồi mà khách chỉ đổi THÔNG TIN (địa chỉ, SĐT, màu, size...) — giá và số lượng không đổi → chỉ báo đã nhận thông tin, KHÔNG gửi lại cả đơn.
  // Giá hoặc số lượng đổi thì vẫn gửi lại đơn mới (khách cần thấy số tiền đúng).
  const prevBlock = [...(sentBefore || [])].reverse().find(looksLikeOrderBlock);
  const pick = (t, re) => (String(t || "").match(re) || [])[0] || "";
  const sameMoney = !!prevBlock && pick(prevBlock, /Tổng tiền:[^\n]*/) === pick(block, /Tổng tiền:[^\n]*/) && pick(prevBlock, /SL:\s*\d+/) === pick(block, /SL:\s*\d+/);
  // Phần "hàng" của đơn (tên + màu/size/dài/SL), bỏ dòng SĐT-địa chỉ và dòng tổng tiền. Khác nhau = khách đã đổi/sửa màu, size... → phải gửi lại bảng đơn đã sửa cho khách thấy
  const specOf = (b) => summaryBody(b).split("\n").filter((l) => !/^\s*(SĐT|Tổng tiền|Người nhận)/.test(l)).join("\n").trim();
  const specChanged = !!prevBlock && specOf(prevBlock) !== specOf(block);
  if (updated && sameMoney && !specChanged) {
    return { block, messages: [`Dạ vâng, ${tu} nhận được thông tin mới của ${kh} rồi ạ, ${tu} cập nhật đơn cho ${kh} nha.`], updated, ackOnly: true };
  }
  const head = updated ? `${cap(tu)} cập nhật lại đơn nha ${kh}:` : `${cap(tu)} lên đơn ạ:`;
  const messages = [`${head}\n${block}`];
  if (!updated && deliveryDays?.max) {
    const range = deliveryDays.min === deliveryDays.max ? `${deliveryDays.max} ngày` : `từ ${deliveryDays.min}-${deliveryDays.max} ngày`;
    messages.push(`Đơn hàng giao trong khoảng ${range} ${kh} để ý điện thoại giúp ${tu} nha.`);
  }
  return { block, messages, updated, specChanged: updated && specChanged };
}

/** Phần nội dung của tin tóm tắt (bỏ dòng chào cuối — dòng đó đổi theo cách xưng hô, không tính là "đơn đã đổi"). */
const summaryBody = (t) =>
  String(t || "")
    .trim()
    .split("\n")
    .filter((l) => !/^(Đơn của .*|Thông tin đơn):$/.test(l.trim()) && !/^\S+ (lên đơn ạ|cập nhật lại đơn nha[^\n]*):$/i.test(l.trim()) && !/kiểm tra (lại đơn )?giúp/.test(l))
    .join("\n")
    .trim();

/** Bản tóm tắt này (cùng nội dung đơn) đã được gửi cho khách rồi chưa. */
export function summarySentBefore(text, sentTexts = []) {
  const body = summaryBody(text);
  return !!body && (sentTexts || []).some((t) => summaryBody(t) === body);
}

/** Tin của bot trông giống một bản tóm tắt đơn (có SĐT hoặc địa chỉ khách vừa đưa) → sẽ được thay bằng tin hệ thống. */
export function looksLikeSummary(text, info = {}) {
  const t = String(text || "");
  const phone = String(info.phone || "").replace(/\D/g, "");
  if (phone.length >= 9 && t.replace(/\D/g, "").includes(phone.replace(/^0/, ""))) return true;
  const addr = strip(info.address || "").replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
  if (addr.length >= 12 && strip(t).replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").includes(addr.slice(0, 12))) return true;
  return false;
}

/**
 * Bước cuối cho 1 lượt trả lời: cắt giá lỡ nói thấp hơn sàn + thêm tin tóm tắt đơn khi đủ điều kiện.
 *  messages      — tin bot vừa soạn
 *  ready         — đã đủ SĐT + địa chỉ + chọn đủ phân loại (do nơi gọi quyết định)
 *  sentBefore    — các tin shop đã gửi trước đó (để không gửi lại đúng bản tóm tắt đã gửi)
 * Trả về { messages, summary, scrubbed }
 */
export function finalizePriceReply({ product, ctx, messages, info, ready, sentBefore = [], kh = "mình", tu = "em", detail = null, deliveryDays = null, replaceDraft = false, hintQty = null }) {
  if (!ctx) return { messages, summary: "", scrubbed: false };
  const g = guardPriceMessages(messages, ctx, { tu });
  let out = g.messages;
  let summary = "";
  if (ready) {
    const order = buildOrderMessages({ product, ctx, info, kh, tu, detail, sentBefore, deliveryDays, hintQty });
    // Đơn chỉ khác chút xíu (giá + số lượng giữ nguyên), khách KHÔNG đưa SĐT/địa chỉ mới, AI đã có câu trả lời thật
    // (vd khách đang lo "váy xoè quá em thấp mặc không đẹp") → GIỮ câu trả lời của AI, không chèn tin mẫu "cập nhật đơn" đè lên.
    const keepAiReply = !!(order && order.ackOnly && !replaceDraft && out.length);
    if (order && !keepAiReply && !summarySentBefore(order.block, sentBefore)) {
      // AI lỡ tự viết bản tóm tắt → bỏ bản đó, dùng bản của hệ thống
      out = out.filter((m) => !looksLikeSummary(m, info));
      // Khách vừa gửi SĐT/địa chỉ (hoặc đơn đổi nội dung mà khách không đang mặc cả) → bỏ câu nháp của AI, chỉ gửi chuỗi chốt đơn
      // Khách sửa màu/size (đơn đổi phần hàng): GIỮ câu trả lời của AI (xin lỗi/xác nhận) rồi gửi kèm bảng đơn đã sửa
      const dropDraft = replaceDraft || order.ackOnly || (order.updated && !ctx.bargain && !(order.specChanged && out.length));
      out = dropDraft ? [...order.messages] : [...out.slice(0, 1), ...order.messages];
      summary = order.block;
    }
  }
  return { messages: out, summary, scrubbed: g.changed };
}
