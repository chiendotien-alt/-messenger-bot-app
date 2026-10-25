// lib/attributes.js — BẢNG THUỘC TÍNH của sản phẩm (Màu, Chiều dài, Size...) do chủ shop cài trong trang sản phẩm.
//
// Mỗi dòng của bảng: { name: "Chiều dài", values: "60cm, 70cm, 80cm", how: "theo chiều cao ..." }
//  - name   : tên thuộc tính
//  - values : các giá trị, ngăn cách bằng dấu phẩy (có thể để trống)
//  - ask    : "câu hỏi bồi" — câu chủ shop muốn bot dùng khi hỏi/hỏi lại thuộc tính này (để trống = tự soạn)
//  - how    : "cách chọn" — chủ shop viết chữ bình thường. Hệ thống đọc chữ trong ô này để biết cách hỏi:
//       có cả "chiều cao" và "cân nặng" → hỏi CẶP chiều cao + cân nặng (hỏi nốt nửa còn lại nếu khách mới nói một nửa)
//       chỉ có "chiều cao"             → chỉ hỏi chiều cao
//       chỉ có "cân nặng"              → chỉ hỏi cân nặng
//       còn lại / để trống              → khách tự chọn trong các giá trị
//
// File này chỉ chứa luật thuần (không gọi mạng/CSDL) nên test riêng được.

import { HEIGHT_TEXT_RE, WEIGHT_TEXT_RE, pronounsFrom, cap, looksLikeAddress } from "./replyDedupe";

export function plain(t) {
  return String(t || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d");
}

const esc = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const squash = (t) => plain(t).replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();

/** Cách chọn (chữ chủ shop viết) → loại: pair | height | weight | choose */
export function attributeKind(how) {
  const h = plain(how);
  const hasH = /chieu cao|cao bao nhieu|theo cao/.test(h);
  const hasW = /can nang|nang bao nhieu|theo can/.test(h);
  if (hasH && hasW) return "pair";
  if (hasH) return "height";
  if (hasW) return "weight";
  return "choose";
}

function parseValues(v) {
  const raw = Array.isArray(v) ? v.join(",") : String(v || "");
  const out = [];
  for (const part of raw.split(/[,;|\n]+/)) {
    const label = part.trim();
    if (!label) continue;
    if (!out.some((x) => plain(x) === plain(label))) out.push(label);
  }
  return out;
}

/** Bảng thuộc tính đã chuẩn hóa của 1 sản phẩm ([] nếu sản phẩm chưa cài bảng → bot chạy như cũ). */
export function productAttributes(p) {
  const rows = Array.isArray(p?.attributes) ? p.attributes : [];
  const out = [];
  for (const r of rows) {
    const name = String(r?.name || "").trim();
    if (!name) continue;
    const values = parseValues(r?.values);
    const how = String(r?.how || "").trim();
    // ask: CÂU HỎI BỒI do chủ shop tự viết cho thuộc tính này (để trống → hệ thống tự soạn). Nhiều câu: mỗi câu 1 dòng, bot hỏi lần lượt theo thứ tự (câu 1, 2, 3... hết thì quay lại câu 1).
    const ask = String(r?.ask || "").trim();
    out.push({ name, key: squash(name), values, how, ask, kind: attributeKind(how) });
  }
  out.groups = productAttrGroups(p, out);
  return out;
}

/**
 * BỘ THUỘC TÍNH: p.attributeGroups = [{ name, members: ["Size", "Chiều dài"], ask: "câu hỏi bồi của cả bộ" }]
 * Chỉ giữ bộ có >= 2 thuộc tính còn tồn tại và có câu hỏi. Trả về [{ name, keys: [key thuộc tính], asks: [câu...] }].
 */
export function productAttrGroups(p, attrs) {
  const rows = Array.isArray(p?.attributeGroups) ? p.attributeGroups : [];
  const have = new Set((attrs || []).map((a) => a.key));
  const out = [];
  for (const g of rows) {
    const keys = [...new Set((Array.isArray(g?.members) ? g.members : []).map((m) => squash(m)).filter((k) => have.has(k)))];
    const asks = String(g?.ask || "").split(/\n+/).map((x) => x.trim()).filter(Boolean);
    if (keys.length < 2 || !asks.length) continue;
    out.push({ name: String(g?.name || "").trim(), keys, asks });
  }
  return out;
}

/** Bộ chứa thuộc tính `attr` mà TẤT CẢ thuộc tính trong bộ đều còn thiếu (chưa chọn/chưa gợi ý/chưa có số đo) → trả bộ đó, ngược lại null. */
export function emptyGroupOf(status, attr) {
  for (const g of status?.groups || []) {
    if (!g.keys.includes(attr.key)) continue;
    const items = status.list.filter((x) => g.keys.includes(x.attr.key));
    if (items.length >= 2 && items.every((x) => x.state === "missing")) return g;
  }
  return null;
}

// ---------------------------------------------------------------------------------------------
// Nhận biết khách đã chọn giá trị nào
// ---------------------------------------------------------------------------------------------

const HEIGHT_G = new RegExp(HEIGHT_TEXT_RE.source, "giu");
const WEIGHT_G = new RegExp(WEIGHT_TEXT_RE.source, "giu");

// Câu hỏi của khách (đang hỏi chứ chưa chọn): "màu đen có không", "size L vừa k ạ?"
const QUESTIONISH = /\?|\b(co (k|ko|khong|hok|hong)|con (k|ko|khong|hang)|het (chua|k|ko|khong)|duoc (k|ko|khong)|dc (k|ko|khong)|vua (k|ko|khong)|bao nhieu|nao|the nao|sao)\b/;

function attrWords(attr) {
  const words = new Set([attr.key]);
  for (const w of attr.key.split(" ")) if (w.length >= 3) words.add(w);
  return [...words].filter(Boolean).map(esc).join("|");
}

/**
 * Giá trị có dấu (vd "Đen", "Vàng", "Hồng") mà khách gõ chữ CÓ DẤU nhưng khác hẳn ("đến", "vâng", "hông") → che đi, khỏi nhầm thành giá trị đó.
 * Khách gõ không dấu ("den", "vang") hoặc đúng dấu thì vẫn nhận. Giá trị chủ shop gõ không dấu thì không che gì.
 */
function maskLookalikes(attr, text) {
  const want = new Map();
  const bad = new Set(); // chữ có dấu hay bị nhầm với giá trị chủ shop gõ không dấu: "cảm ơn" ≠ màu Cam, "kém" ≠ màu Kem
  for (const label of attr.values) {
    const l = String(label).trim().toLowerCase().normalize("NFC");
    if (!/^\p{L}{2,}$/u.test(l)) continue;
    if (plain(l) !== l) want.set(plain(l), l);
    else if (l === "cam") ["cảm", "cám"].forEach((x) => bad.add(x));
    else if (l === "kem") ["kém"].forEach((x) => bad.add(x));
  }
  if (!want.size && !bad.size) return text;
  return String(text || "").normalize("NFC").replace(/\p{L}+/gu, (tok) => {
    const lt = tok.toLowerCase();
    if (bad.has(lt)) return "_".repeat(tok.length);
    const w = want.get(plain(lt));
    if (!w || lt === w || plain(lt) === lt) return tok;
    return "_".repeat(tok.length);
  });
}

// Chữ khách gõ KHÔNG DẤU nhưng trùng tên màu mà thường là từ khác: "cam on" (cảm ơn), "da vang" (dạ vâng), "do" (do/vì),
// "den" (đến), "tim" (tìm), "trang" (tên Trang), "hong" (hông). Chỉ tính là màu khi có chữ báo hiệu đứng ngay trước
// ("lay mau den", "doi sang mau do", "1 den", "2 trang") hoặc khi shop VỪA hỏi đúng thuộc tính này (khách trả lời trơn "den").
const AMBIG_PLAIN = new Set(["cam", "vang", "do", "den", "tim", "trang", "hong", "nau"]);
const COLOR_CUE = /^(?:mau|lay|chon|doi|them|mua|dat|size|sz|cai|chiec|bo|vay|c|\d+(?:c|cai|chiec|bo|vay)?)$/; // "1c trắng 1c cam" (1c = 1 cái), "2 cái cam"
function maskAmbiguousPlain(text, bare) {
  const src = String(text || "").normalize("NFC");
  const toks = [...src.matchAll(/[\p{L}\p{N}]+/gu)];
  const low = toks.map((t) => plain(t[0].toLowerCase()));
  let out = "";
  let last = 0;
  toks.forEach((t, k) => {
    const lt = t[0].toLowerCase();
    if (!(plain(lt) === lt && AMBIG_PLAIN.has(lt))) return; // chỉ xét chữ gõ không dấu
    let mask = false;
    if (lt === "cam" && low[k + 1] === "on") mask = true; // "cam on" = cảm ơn
    else if (lt === "vang" && low[k - 1] === "da") mask = true; // "da vang" = dạ vâng
    else if (!bare && !(COLOR_CUE.test(low[k - 1] || "") || COLOR_CUE.test(low[k - 2] || ""))) mask = true;
    if (mask) {
      out += src.slice(last, t.index) + "_".repeat(t[0].length);
      last = t.index + t[0].length;
    }
  });
  return out + src.slice(last);
}

// Khách đặt nhiều màu kèm số lượng: "2 trắng 1 vàng", "1 đen 1 trắng", "đen x2" → { Trắng: 2, Vàng: 1 }. Không nói số → 1 cái.
function colorQtys(found, text, prev = {}) {
  const t = plain(String(text || ""));
  const out = { ...prev };
  for (const v of found) {
    const pv = plain(v).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const before = t.match(new RegExp(`(?<![0-9a-z])([1-9])(?![0-9])\\s*(?:cai|chiec|bo|vay|chan vay|doi|c)?\\s*(?:mau\\s*)?${pv}(?![a-z0-9])`));
    const after = t.match(new RegExp(`(?<![a-z0-9])${pv}\\s*(?:x|\\*)\\s*([1-9])(?![0-9])`));
    out[v] = before ? +before[1] : after ? +after[1] : out[v] || 1;
  }
  return out;
}

/**
 * Giá trị nào của thuộc tính `attr` xuất hiện trong `text`? Trả về mảng nhãn gốc (vd ["Đen"]).
 * bare = true: chấp nhận cả khi khách chỉ nhắn trơn giá trị (vd "70", "L") — dùng khi shop vừa hỏi đúng thuộc tính này.
 */
export function matchValues(attr, text, { bare = false } = {}) {
  if (!attr.values.length) return [];
  text = maskAmbiguousPlain(maskLookalikes(attr, text), bare);
  // Bỏ số đo người (1m52, 55kg) để chữ "m", "kg" không bị nhầm thành size M...
  let t = " " + plain(text).replace(HEIGHT_G, " ").replace(WEIGHT_G, " ") + " ";
  const shortMsg = t.trim().split(/\s+/).length <= 6;
  const words = attrWords(attr);
  const order = [...attr.values].sort((a, b) => squash(b).length - squash(a).length);
  const hits = [];
  for (const label of order) {
    const v = squash(label);
    if (!v) continue;
    const vr = v.split(" ").map(esc).join("\\s*");
    const num = v.match(/^(\d{1,3})\s?(cm|mm|m|l|ml)?$/);
    const letter = /^(?:\d?x{0,3}[sml]|x{1,3}l|\d?xl)$/.test(v);
    const res = [];
    if (num) {
      const d = num[1];
      if (num[2]) res.push(new RegExp(`(?<![0-9a-z])${d}\\s?${num[2]}(?![0-9a-z])`));
      res.push(new RegExp(`(?<![0-9a-z])(?:size|sz|siz|saiz|${words})\\s*[:.\\-]?\\s*${d}(?:\\s?(?:cm|mm|ml))?(?![0-9a-z])`));
      if (bare) res.push(new RegExp(`(?<![0-9a-z])${d}(?![0-9a-z])`));
    } else if (letter) {
      res.push(new RegExp(`(?<![0-9a-z])(?:size|sz|siz|saiz|${words})\\s*[:.\\-]?\\s*${vr}(?![0-9a-z])`));
      // Nhắn trơn "M", "L" hoặc dính số lượng "1M", "2L" (1 cái size M, 2 cái size L)
      if (bare || shortMsg) res.push(new RegExp(`(?<![0-9a-z])[1-9]?${vr}(?![0-9a-z])`));
    } else {
      res.push(new RegExp(`(?<![0-9a-z])${vr}(?![0-9a-z])`));
    }
    for (const re of res) {
      const m = re.exec(t);
      if (m) {
        hits.push(label);
        // che đoạn đã khớp để giá trị ngắn nằm trong giá trị dài ("kem" trong "kem nhạt") không bị tính thêm
        t = t.slice(0, m.index) + " ".repeat(m[0].length) + t.slice(m.index + m[0].length);
        break;
      }
    }
  }
  return hits;
}

const AFFIRM_TOKENS = new Set("ok oke okie okay da vang uh um u duoc dc roi dong y chot lay luon dung vua nhe nha a shop em chi anh minh".split(" "));
function isAffirm(text) {
  const toks = squash(text).split(" ").filter(Boolean);
  if (!toks.length || toks.length > 6) return false;
  if (!toks.some((x) => x !== "da" && x !== "vang" && !["nhe", "nha", "a", "shop", "em", "chi", "anh", "minh"].includes(x))) return false;
  return toks.every((x) => AFFIRM_TOKENS.has(x));
}
const NEGATE = /\b(khong|ko|k|thoi|doi|dai hon|ngan hon|khac|chua)\b/;
const PHONE_IN = /(?:\+?84|0)\d{9}/;

// Tin phủ nhận ("nếu k cho dài 85cm") chỉ hủy gợi ý của đúng thuộc tính mà tin đó nói tới (ở đây là chiều dài), KHÔNG hủy gợi ý size/màu.
// Tin phủ nhận chung chung, không nhắc thuộc tính nào ("không", "thôi") → giữ cách cũ: hủy mọi gợi ý đang chờ.
function aboutAttr(a, text) {
  const p = plain(text);
  if (new RegExp(`(?<![a-z0-9])(?:${attrWords(a)})(?![a-z0-9])`).test(p)) return true;
  return /(^| )dai( |$)/.test(a.key) && /(dai|ngan) hon/.test(p);
}
function changeMatch(a, text, current) {
  if (!current) return [];
  const items = a.values
    .map((v) => {
      const m = squash(v).match(/^(\d{1,3})\s?(?:cm|mm|ml|m|l)?$/);
      return m ? { v, n: parseInt(m[1], 10) } : null;
    })
    .filter(Boolean)
    .sort((x, y) => x.n - y.n);
  if (!items.length) return [];
  const p = " " + plain(text).replace(HEIGHT_G, " ").replace(WEIGHT_G, " ").replace(/(\d)\s?cn\b/g, "$1cm") + " ";
  if (p.trim().split(/\s+/).length > 9 || PHONE_IN.test(p.replace(/[\s.\-]/g, ""))) return [];
  const cur = items.find((x) => squash(x.v) === squash(current));
  if (/(^| )dai( |$)/.test(a.key)) {
    if (/\bdai nhat\b/.test(p)) return [items[items.length - 1].v];
    if (/\bngan nhat\b/.test(p)) return [items[0].v];
    if (cur && /\bdai hon\b/.test(p)) { const nx = items.find((x) => x.n > cur.n); if (nx) return [nx.v]; }
    if (cur && /\bngan hon\b/.test(p)) { const pv = [...items].reverse().find((x) => x.n < cur.n); if (pv) return [pv.v]; }
  }
  // số trơn ("lấy 85", "cho chị 85 nha", "85cm" gõ sai thành 85cn): chỉ khi có chữ lấy/chọn/cho/đổi/thôi và số đó trùng ĐÚNG 1 giá trị
  if (/\b(lay|chon|cho|doi|thoi)\b/.test(p) || /\d\s?cm\b/.test(p)) {
    const hit = new Set();
    for (const m of p.matchAll(/(?<![0-9a-z.,])(\d{2,3})(?:\s?cm)?(?![0-9a-z.,])/g)) {
      const it = items.find((x) => x.n === parseInt(m[1], 10));
      if (it) hit.add(it.v);
    }
    if (hit.size === 1) return [...hit];
  }
  return [];
}
/** Số trơn khách từ chối ("không phải 85 đâu") trùng ĐÚNG giá trị dạng số của thuộc tính (85cm). */
function negNumeric(a, text) {
  const items = a.values
    .map((v) => {
      const m = squash(v).match(/^(\d{1,3})\s?(?:cm|mm|ml|m|l)?$/);
      return m ? { v, n: parseInt(m[1], 10) } : null;
    })
    .filter(Boolean);
  if (!items.length) return [];
  const p = " " + plain(text).replace(HEIGHT_G, " ").replace(WEIGHT_G, " ") + " ";
  const hit = new Set();
  for (const m of p.matchAll(/(?<![0-9a-z.,])(\d{2,3})(?:\s?cm)?(?![0-9a-z.,])/g)) {
    const it = items.find((x) => x.n === parseInt(m[1], 10));
    if (it) hit.add(it.v);
  }
  return [...hit];
}
/** Các giá trị dạng số của thuộc tính (75cm, 85cm...) → [{ v, n }] sắp tăng dần. Chỉ trả khi MỌI giá trị đều là số (vd Chiều dài), ngược lại [] */
function numericItems(a) {
  const items = a.values
    .map((v) => {
      const m = squash(v).match(/^(\d{1,3})\s?(?:cm|mm|ml|m|l)?$/);
      return m ? { v, n: parseInt(m[1], 10) } : null;
    })
    .filter(Boolean)
    .sort((x, y) => x.n - y.n);
  return items.length >= 2 && items.length === a.values.length ? items : [];
}

/** Thuộc tính độ dài (Chiều dài...) — chỉ loại này mới kiểm tra "số khách đưa có nằm trong danh sách không". */
const isLengthAttr = (a) => /(^| )dai( |$)/.test(a.key) || (a.values.length >= 2 && a.values.every((v) => /\d\s?cm$/i.test(plain(v).trim())));

/**
 * Khách đưa MỘT SỐ ĐO KHÔNG CÓ trong danh sách giá trị (vd \"70cm\" khi chỉ có 75/85/92cm) → { raw, suggested }.
 * suggested = giá trị hợp lệ GẦN NHẤT, chỉ dùng để HỎI LẠI khách (không bao giờ tự ghi vào đơn).
 * Chỉ nhận khi khách viết rõ đơn vị cm, hoặc có chữ dài/lấy/chọn đứng ngay trước số, hoặc shop vừa hỏi đúng thuộc tính này (bare = true).
 * Số đo người (1m70, 165cm, 55kg), SĐT, giá tiền không bị nhầm.
 */
export function offeredOutOfList(a, text, { bare = false } = {}) {
  if (!isLengthAttr(a)) return null;
  const items = numericItems(a);
  if (!items.length) return null;
  const p = " " + plain(text).replace(HEIGHT_G, " ").replace(WEIGHT_G, " ") + " ";
  if (PHONE_IN.test(p.replace(/[\s.\-]/g, ""))) return null;
  const cands = [];
  for (const m of p.matchAll(/(?<![0-9a-z.,])(?:(dai|lay|chon|cho|doi)\s*(?:size\s*)?[:.\-]?\s*)?(\d{2,3})(\s?(?:cm|cn))?(?![0-9a-z.,])/g)) {
    const hasCm = !!m[3];
    const hasCue = !!m[1];
    if (!hasCm && !hasCue && !bare) continue;
    // \"lấy 2 cái\" / \"cho 350k\": số ngay sau chữ lấy/cho nhưng kèm k / đơn vị khác không tới được đây vì (?![0-9a-z]) ở cuối
    cands.push(parseInt(m[2], 10));
  }
  if (!cands.length) return null;
  if (cands.some((n) => items.some((x) => x.n === n))) return null; // có số hợp lệ trong tin → để matchValues xử lý
  const raw = cands[0];
  let best = items[0];
  for (const x of items) if (Math.abs(x.n - raw) < Math.abs(best.n - raw)) best = x;
  return { raw: `${raw}cm`, suggested: best.v };
}

function negateAbout(a, text, attrs) {
  return attrs.some((x) => aboutAttr(x, text)) ? aboutAttr(a, text) : true;
}
const RECOMMEND = /\b(lay|chon|hop|vua|dep|mac|dung|nen|phu hop|len don|chot)\b/;

function sentencesOf(text) {
  return String(text || "")
    .split(/\n+/)
    .flatMap((l) => l.split(/(?<=[.!?…])\s+/))
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Các thuộc tính mà tin shop này đang HỎI khách (chỉ xét câu hỏi). */
function askedAttrSet(attrs, shopText) {
  const hit = new Set();
  for (const s of sentencesOf(shopText)) {
    if (!s.includes("?") && !/\bcho (em|shop|minh) (xin|biet)\b/.test(plain(s))) continue;
    const ps = plain(s);
    attrs.forEach((a, i) => {
      const byName = new RegExp(`(?<![a-z0-9])(?:${attrWords(a)})(?![a-z0-9])`).test(ps);
      const byBody =
        (a.kind === "pair" || a.kind === "height") && /chieu cao|cao bao nhieu/.test(ps) ||
        (a.kind === "pair" || a.kind === "weight") && /can nang|nang bao nhieu/.test(ps);
      const byValues = a.values.length >= 2 && matchValues(a, s).length >= 2;
      if (byName || byBody || byValues) hit.add(i);
    });
  }
  return hit;
}

/** Tin shop đang hỏi ĐÚNG 1 thuộc tính → chỉ số thuộc tính, ngược lại -1 */
function askedAttrIndex(attrs, shopText) {
  const hit = askedAttrSet(attrs, shopText);
  return hit.size === 1 ? [...hit][0] : -1;
}

/** Số đo khách đã nói (từ các tin của KHÁCH). */
export function bodyGiven(customerTexts) {
  const all = (customerTexts || []).join(" \n ");
  return { height: new RegExp(HEIGHT_TEXT_RE.source, "iu").test(all), weight: new RegExp(WEIGHT_TEXT_RE.source, "iu").test(all) };
}

/**
 * Đối chiếu cả cuộc chat → trạng thái từng thuộc tính.
 *   history: [{ from, text }]  (from === "customer" là khách, còn lại là shop/bot)
 *   currentTexts: các tin khách vừa nhắn (chưa nằm trong history)
 *   variantText: màu/size đã lưu từ trước (nếu có)
 * Mỗi thuộc tính ra 1 trong:
 *   chosen   : khách tự nói giá trị, hoặc xác nhận giá trị shop gợi ý (ok/dạ/gửi SĐT...)
 *   proposed : shop đã gợi ý đúng 1 giá trị, khách chưa phản đối
 *   measured : thuộc tính theo số đo và khách đã đưa đủ số đo → shop cần tư vấn giá trị hợp NGAY
 *   missing  : chưa có gì
 */
// Shop vừa xin SĐT / địa chỉ / tên người nhận → tin khách trả lời là THÔNG TIN LIÊN HỆ
const CONTACT_ASK_RE = /dia chi|so dien thoai|\bsdt\b|nguoi nhan|ho ten|ten cua/;
// Trong tin liên hệ chỉ tin chữ khách NÓI RÕ là chọn ("màu trắng", "lấy hồng", "đổi sang đen", "size L", "dài 85"); chữ còn lại
// (tên đường "Lê Hồng Phong", tên người "Nguyễn Thị Hồng", "Cam Ranh"...) KHÔNG phải màu/size.
const EXPLICIT_CHOICE_RE = /(?<![\p{L}\p{N}])(?:màu|mầu|mau|lấy|lay|chọn|chon|đổi|size|sz|siz|dài|dai)(?![\p{L}\p{N}])\s*(?:(?:sang|là|la)\s+)?(?:[\p{L}\p{N}.,]+\s*){0,2}/giu;
function explicitChoiceText(text) {
  return (String(text || "").match(EXPLICIT_CHOICE_RE) || []).join(" | ");
}

// ---- Câu PHỦ ĐỊNH của khách: "Mình không lấy dài 85cm đâu shop", "không phải màu đen", "ko lấy 85", "đừng lấy size M" ----
// Giá trị nằm trong vế phủ định KHÔNG phải khách chọn (trước đây "không lấy 85cm" bị hiểu thành lấy 85cm).
const NEG_CUE = new Set(["khong", "ko", "k", "chang", "chua", "hok"]); // "đừng" xét riêng (plain trùng "đúng")
const NEG_VERB = new Set(["phai", "lay", "can", "muon", "chon", "doi", "mua", "dat", "cho"]);
const NEG_STOP = new Set(["ma", "nhung", "con", "lay", "doi", "chuyen", "thay", "sang", "chon"]);
/** Tách tin thành phần KHẲNG ĐỊNH (pos) và phần PHỦ ĐỊNH (neg). "không lấy 85 mà lấy 75" → neg "không lấy 85", pos "lấy 75". */
function splitNegation(text) {
  const src = String(text || "");
  const pos = [];
  const neg = [];
  for (const clause of src.split(/(?<=[,;.!?\n])/)) {
    const toks = [...clause.matchAll(/[\p{L}\p{N}]+/gu)];
    const lows = toks.map((t) => plain(t[0].toLowerCase()));
    const cue = toks.findIndex((t, k) => NEG_CUE.has(lows[k]) || t[0].toLowerCase() === "đừng");
    if (cue < 0) {
      pos.push(clause);
      continue;
    }
    let start = cue + 1;
    while (start < lows.length && NEG_VERB.has(lows[start])) start++; // bỏ "lấy", "phải", "cần"... ngay sau chữ không
    let end = lows.length;
    for (let k = start; k < lows.length; k++) {
      if (NEG_STOP.has(lows[k])) {
        end = k;
        break;
      }
    }
    if (start >= end) {
      pos.push(clause); // "có màu đen không?" → chữ không đứng cuối câu, không phủ định giá trị nào
      continue;
    }
    const a = toks[cue].index;
    const b = end < toks.length ? toks[end].index : clause.length;
    neg.push(clause.slice(a, b));
    pos.push(clause.slice(0, a) + " " + clause.slice(b));
  }
  return { pos: pos.join(" "), neg: neg.join(" ") };
}

export function attributeStatus(attrs, history, currentTexts = [], variantText = "") {
  const msgs = [
    ...(history || []).map((m) => ({ c: m.from === "customer", text: String(m.text || "") })),
    ...(currentTexts || []).map((t) => ({ c: true, text: String(t || "") })),
  ].filter((m) => m.text.trim());

  const chosen = attrs.map(() => null); // { values: [label], by }
  const proposal = attrs.map(() => null); // label
  const lastAdvice = attrs.map(() => null); // giá trị shop/bot/chủ shop tư vấn GẦN NHẤT cho từng thuộc tính (không mất đi khi khách phủ nhận chung chung)
  const rejected = attrs.map(() => new Set()); // giá trị khách đã từ chối rõ ràng → không lấy lại
  let lastShopText = "";
  let shopAskIdx = -1;
  let lastRefusals = []; // việc khách từ chối ở tin khách MỚI NHẤT: [{ idx, refused: [giá trị] }]
  const pending = attrs.map(() => null); // khách đưa số KHÔNG có trong danh sách (vd 70cm): { raw, suggested } — chờ khách xác nhận, CHƯA phải lựa chọn
  let freshPending = new Set(); // thuộc tính vừa bị tin khách MỚI NHẤT làm nảy ra câu cần xác nhận

  for (const m of msgs) {
    if (!m.c) {
      lastShopText = m.text;
      shopAskIdx = askedAttrIndex(attrs, m.text);
      // Shop gợi ý ĐÚNG 1 giá trị (câu không phải câu hỏi, có chữ lấy/hợp/vừa/mặc...)
      attrs.forEach((a, i) => {
        // Mỗi câu tách tiếp theo dấu phẩy: "mặc size M dài 75cm là vừa đẹp nha, chị chọn được màu nào chưa ạ?" → vế tư vấn vẫn được ghi nhận, chỉ bỏ vế có dấu ?
        const clauses = sentencesOf(m.text).flatMap((sn) => sn.split(/(?<=[,;])/));
        for (const s of clauses) {
          if (s.includes("?")) continue;
          if (!RECOMMEND.test(plain(s))) continue;
          const f = matchValues(a, s);
          if (f.length === 1) {
            lastAdvice[i] = f[0];
            rejected[i].delete(f[0]);
            if (!(chosen[i] && chosen[i].values.length === 1 && chosen[i].values[0] === f[0])) proposal[i] = f[0];
          }
        }
      });
      continue;
    }
    // Câu hỏi có/không: "có màu đen không shop", "màu đen ok ko" (kết thúc bằng không/ko/chưa...) → khách đang HỎI, chưa phải chọn
    const plainEnd = plain(m.text).trim().replace(/[?!.…\s]+$/, "");
    const question = QUESTIONISH.test(plain(m.text)) || /(?<![0-9]\s?)(?:^| )(?:khong|ko|k|hok|chua|chu)(?: (?:shop|a|ak|ah|nhi|nhe|vay|ha))?$/.test(plainEnd); // không có "hong": trùng màu Hồng ("màu hồng nhé")
    const phone = PHONE_IN.test(m.text.replace(/[\s.\-]/g, ""));
    // Tin gửi SĐT / địa chỉ / tên nhận hàng (hoặc trả lời đúng câu shop xin thông tin đó) → chỉ đọc phần khách NÓI RÕ là chọn màu/size
    const contactMsg = phone || looksLikeAddress(m.text) || (shopAskIdx < 0 && CONTACT_ASK_RE.test(plain(lastShopText)));
    // Tách phần PHỦ ĐỊNH ("không lấy dài 85cm") TRƯỚC khi lọc tin liên hệ, kẻo chữ "không" bị cắt mất và "85cm" thành chọn
    const rawSplit = splitNegation(m.text);
    const cut = (t) => (contactMsg ? explicitChoiceText(t) : t);
    const posText = cut(rawSplit.pos);
    const negText = cut(rawSplit.neg);
    // Thuộc tính shop VỪA hỏi ngay trước tin này (vd "chị chọn size nào ạ?"): khách trả lời ngay đầu tin ("L, số 5 ngõ 3...") vẫn đọc được
    const leadPos = contactMsg ? String(rawSplit.pos).split(/[,.;\n]/)[0] + " | " + posText : rawSplit.pos;
    // Tin của khách đọc được giá trị mới cho thuộc tính nào (kể cả đổi ý kiểu "lấy 85 cơ")
    const splitList = attrs.map((a, i) => ({ pos: i === shopAskIdx ? leadPos : posText, neg: negText }));
    const foundList = attrs.map((a, i) => {
      const txt = splitList[i].pos;
      let f = question ? [] : matchValues(a, txt, { bare: i === shopAskIdx });
      // Khách đổi ý kiểu "lấy 85 cơ", "cho chị 85 nha", "lấy dài nhất" (không gõ "cm") → hiểu đúng giá trị mới
      if (!f.length && !question) f = changeMatch(a, txt, (chosen[i] && chosen[i].values[0]) || proposal[i] || lastAdvice[i]);
      return f;
    });
    // Giá trị khách PHỦ ĐỊNH ("không lấy 85cm đâu") → không được tính là chọn
    const negList = attrs.map((a, i) => {
      const neg = splitList[i].neg;
      if (!neg || question) return [];
      return [...new Set([...matchValues(a, neg, { bare: false }), ...changeMatch(a, neg, (chosen[i] && chosen[i].values[0]) || proposal[i] || lastAdvice[i]), ...negNumeric(a, neg)])];
    });
    lastRefusals = []; // chỉ giữ việc từ chối của tin khách MỚI NHẤT
    freshPending = new Set();
    const askedIdxNow = shopAskIdx;
    const anyFound = foundList.some((f) => f.length) || negList.some((n) => n.length); // đã nói rõ về giá trị nào đó (chọn HOẶC từ chối) → không coi là "phủ nhận chung chung" các gợi ý còn lại
    attrs.forEach((a, i) => {
      const found = foundList[i];
      // Số khách đưa KHÔNG nằm trong danh sách giá trị (70cm khi chỉ có 75/85/92cm) → không ghi nhận, chờ khách xác nhận giá trị hợp lệ
      const offer = !found.length ? offeredOutOfList(a, splitList[i].pos, { bare: i === askedIdxNow }) : null;
      if (offer) {
        pending[i] = offer;
        freshPending.add(i);
        proposal[i] = null;
        return;
      }
      if (pending[i] && !found.length) {
        // Khách trả lời câu \"ý chị là 75cm đúng không?\": đồng ý → chốt giá trị đã hỏi; từ chối chung chung → bỏ, hỏi lại; nói chuyện khác → vẫn chờ
        if (!question && isAffirm(m.text)) {
          chosen[i] = { values: [pending[i].suggested], by: "confirmed" };
          pending[i] = null;
          return;
        }
        const bareNo = /^(?:da )?(?:khong|ko|k|hok|thoi|chua|sai|khong phai|ko phai)(?: (?:a|ak|ah|nha|nhe|shop|chi|em|anh|dau|roi|phai|ne))*$/.test(squash(m.text));
        if (bareNo || (!question && !anyFound && NEGATE.test(plain(m.text)) && negateAbout(a, m.text, attrs))) {
          lastRefusals.push({ idx: i, refused: [pending[i].suggested] });
          rejected[i].add(pending[i].suggested);
          pending[i] = null;
          return;
        }
        return; // giữ nguyên trạng thái chờ xác nhận
      }
      if (found.length) pending[i] = null; // khách đã nói rõ giá trị hợp lệ (vd \"không, chị muốn 85cm\") → bỏ câu chờ xác nhận
      const negVals = negList[i].filter((v) => !found.includes(v));
      if (negVals.length) {
        lastRefusals.push({ idx: i, refused: negVals });
        // Khách từ chối giá trị shop vừa gợi ý / giá trị đang ghi → bỏ, không lấy lại; không có giá trị thay thế thì hỏi lại
        negVals.forEach((v) => {
          if (v === proposal[i] || v === lastAdvice[i]) rejected[i].add(v);
        });
        if (proposal[i] && negVals.includes(proposal[i])) proposal[i] = null;
        if (chosen[i] && !found.length) {
          const left = chosen[i].values.filter((v) => !negVals.includes(v));
          if (left.length !== chosen[i].values.length) chosen[i] = left.length ? { ...chosen[i], values: left } : null;
        }
      }
      if (found.length) {
        // Khách nói "thêm màu xanh" / "lấy thêm cái màu đen nữa" → CỘNG vào màu đã chọn (không thay thế)
        const adding = chosen[i] && /(^| )mau( |$)/.test(a.key) && /\b(them|nua)\b/.test(plain(m.text));
        const isColor = /(^| )mau( |$)/.test(a.key);
        const vals = adding ? [...new Set([...chosen[i].values, ...found])] : found;
        chosen[i] = { values: vals, by: "customer", ...(isColor ? { qtys: colorQtys(found, m.text, adding ? chosen[i].qtys : {}) } : {}) };
        proposal[i] = null;
      } else if (proposal[i] && (isAffirm(m.text) || phone)) {
        chosen[i] = { values: [proposal[i]], by: "confirmed" };
        proposal[i] = null;
      } else if (!proposal[i] && !chosen[i] && phone && lastAdvice[i] && !rejected[i].has(lastAdvice[i])) {
        chosen[i] = { values: [lastAdvice[i]], by: "confirmed" };
      } else if (proposal[i] && !question && !anyFound && NEGATE.test(plain(m.text)) && negateAbout(a, m.text, attrs)) {
        rejected[i].add(proposal[i]);
        proposal[i] = null;
      }
    });
    shopAskIdx = -1; // chỉ tính cho tin trả lời NGAY sau câu hỏi của shop
  }

  const customerTexts = msgs.filter((m) => m.c).map((m) => m.text);
  const body = bodyGiven(customerTexts);

  const list = attrs.map((a, i) => {
    let state = "missing";
    let picked = [];
    if (pending[i]) {
      state = "confirm"; // khách nói số ngoài danh sách → chưa chốt gì (kể cả khi trước đó đã chọn giá trị khác: khách đang đổi ý), phải hỏi xác nhận
      picked = [pending[i].suggested];
    } else if (chosen[i]) {
      state = "chosen";
      picked = chosen[i].values;
    } else if (proposal[i]) {
      state = "proposed";
      picked = [proposal[i]];
    } else {
      const fromVariant = variantText ? matchValues(a, variantText, { bare: false }) : [];
      if (fromVariant.length) {
        state = "chosen";
        picked = fromVariant;
      } else if (lastAdvice[i] && !rejected[i].has(lastAdvice[i])) {
        state = "proposed";
        picked = [lastAdvice[i]];
      } else if ((a.kind === "pair" && body.height && body.weight) || (a.kind === "height" && body.height) || (a.kind === "weight" && body.weight)) {
        state = "measured";
      }
    }
    return { attr: a, state, picked, qtys: (chosen[i] && chosen[i].qtys) || null, ...(state === "confirm" ? { pending: pending[i], fresh: freshPending.has(i) } : {}) };
  });
  const shopTexts = msgs.filter((m) => !m.c).map((m) => m.text).reverse();
  const refusals = lastRefusals.map((r) => ({ attrName: attrs[r.idx].name, refused: r.refused, kept: list[r.idx].state === "chosen" ? list[r.idx].picked : [] }));
  return { list, body, groups: attrs.groups || [], shopTexts, refusals };
}

/** Các mục khách ĐÃ đưa đủ số đo nhưng shop CHƯA tư vấn giá trị (vd có chiều cao rồi mà chưa nói chiều dài váy). */
export function measuredItems(status) {
  return (status?.list || []).filter((x) => x.state === "measured");
}

/** Số màu khách đang chọn (mỗi màu 1 cái) — dùng làm số lượng tối thiểu khi khách chọn thêm màu. */
export function colorCount(status) {
  const x = (status?.list || []).find((y) => /(^| )mau( |$)/.test(y.attr.key) && y.state === "chosen");
  return x ? x.picked.reduce((sum, v) => sum + ((x.qtys && x.qtys[v]) || 1), 0) : 0;
}

/** Chi tiết để ghép tin tóm tắt đơn: specs ["size M", "dài 92cm"], colors [{ name, qty }]. */
export function summaryDetail(status, qty = 1) {
  const specs = [];
  let colors = [];
  for (const x of status?.list || []) {
    if (!(x.state === "chosen" || x.state === "proposed") || !x.picked.length) continue;
    const a = x.attr;
    const nm = plain(a.name);
    if (/(^| )mau( |$)/.test(a.key)) colors = x.picked.map((v) => ({ name: v, qty: x.picked.length === 1 ? Math.max(1, qty) : (x.qtys && x.qtys[v]) || 1 }));
    else {
      const v = x.picked.join(" + ");
      specs.push(/(^| )(size|sz|co)( |$)/.test(nm) ? `size ${v}` : /dai/.test(nm) ? `dài ${v}` : `${String(a.name).toLowerCase()} ${v}`);
    }
  }
  return { specs, colors };
}

/** Các mục khách nói số NGOÀI danh sách và đang chờ khách xác nhận (vd 70cm → hỏi lại 75cm). */
export function confirmItems(status) {
  return (status?.list || []).filter((x) => x.state === "confirm");
}

const joinVals = (vals) => (vals.length <= 1 ? vals.join("") : vals.slice(0, -1).join(", ") + " và " + vals[vals.length - 1]);

/**
 * Câu hỏi xác nhận khi khách đưa số không có trong danh sách, soạn bằng HỆ THỐNG (không phụ thuộc AI):
 * "Dạ chiều dài bên em có 75cm, 85cm và 92cm ạ. Ý chị là chọn chiều dài 75cm đúng không chị?"
 */
export function buildConfirmAsk(item, { kh = "mình", tu = "em", neutral = false } = {}) {
  const a = item.attr;
  const nm = String(a.name).toLowerCase();
  const list = joinVals(a.values);
  const sug = item.pending?.suggested || item.picked[0];
  if (neutral) return `Dạ ${nm} bên shop có ${list} ạ. Ý mình là chọn ${nm} ${sug} đúng không ạ?`;
  return `Dạ ${nm} bên ${tu} có ${list} ạ. Ý ${kh} là chọn ${nm} ${sug} đúng không ${kh}?`;
}

/** Giữ lại trong chuỗi variant đã lưu CHỈ những phần khớp một giá trị hợp lệ của bảng thuộc tính (bỏ giá trị lạ như "Chiều dài 70cm"). */
export function sanitizeVariant(attrs, variantText) {
  const parts = String(variantText || "").split(/\s*,\s*/).filter(Boolean);
  const keep = parts.filter((part) => {
    const attr = attrs.find((a) => a.values.length && new RegExp(`(?<![a-z0-9])(?:${attrWords(a)})(?![a-z0-9])`).test(plain(part)));
    if (attr) return matchValues(attr, part, { bare: true }).length > 0; // phần nói về thuộc tính nào thì phải đúng giá trị của thuộc tính đó
    return attrs.some((a) => matchValues(a, part, { bare: false }).length > 0);
  });
  return keep.join(", ").slice(0, 120);
}

/** Mục kế tiếp cần hỏi: mục "cặp số đo" mới có một nửa thì hỏi nốt trước, còn lại theo thứ tự bảng. */
export function nextAttrToAsk(status) {
  const pend = (status?.list || []).find((x) => x.state === "confirm");
  if (pend) return pend; // khách đang chờ được hỏi xác nhận (số ngoài danh sách) → hỏi lại việc này trước
  const missing = status.list.filter((x) => x.state === "missing");
  if (!missing.length) return null;
  const half = missing.find((x) => x.attr.kind === "pair" && (status.body.height !== status.body.weight));
  return half || missing[0];
}

/** Ghép màu/size/chiều dài khách ĐÃ CHỌN thành 1 dòng để lưu vào đơn: "Màu Đen, Chiều dài 70cm, Size L". */
export function composeVariant(status) {
  const parts = status.list
    .filter((x) => x.state === "chosen" && x.picked.length)
    .map((x) => {
      // Màu chọn nhiều + có màu lấy từ 2 cái trở lên → ghi số lượng từng màu ("Màu Đen x2 + Kem") để đơn lưu không mất thông tin
      const isColor = /(^| )mau( |$)/.test(x.attr.key);
      const perColor = isColor && x.picked.length > 1 && x.picked.some((v) => ((x.qtys && x.qtys[v]) || 1) > 1);
      const vals = x.picked.map((v) => (perColor ? `${v} x${(x.qtys && x.qtys[v]) || 1}` : v));
      return `${x.attr.name} ${vals.join(" + ")}`;
    });
  return parts.join(", ").slice(0, 120);
}

/** Mục nào đang cho phép hỏi lại ở lượt này (khách vừa trả lời → được hỏi mục kế tiếp). Trả mảng chủ đề của luật chống hỏi lặp. */
export function topicsToUnblock(status, progressed) {
  if (!progressed) return [];
  const next = nextAttrToAsk(status);
  if (!next || next.state === "confirm") return [];
  const out = [];
  const a = next.attr;
  if (a.kind !== "choose") out.push("size");
  else if (/(^| )mau( |$)/.test(a.key)) out.push("mau");
  else if (/(^| )(size|kich|co)( |$)/.test(a.key)) out.push("size");
  return out;
}

/** Khách vừa nhắn có làm trạng thái thay đổi không (chọn thêm giá trị / nói thêm số đo)? */
export function progressedBy(before, after) {
  const key = (s) => s.list.map((x) => (x.state === "chosen" ? x.picked.join("+") : x.state)).join("|") + `|${s.body.height}|${s.body.weight}`;
  return key(before) !== key(after);
}

// ---------------------------------------------------------------------------------------------
// Chữ đưa vào câu lệnh của bot
// ---------------------------------------------------------------------------------------------

function howText(a) {
  return a.how || "khách tự chọn";
}

/** Bảng thuộc tính của sản phẩm (đưa vào DANH SÁCH SẢN PHẨM). Rỗng nếu sản phẩm chưa cài bảng. */
export function attributeTableForPrompt(p) {
  const attrs = productAttributes(p);
  if (!attrs.length) return "";
  const lines = attrs.map((a, i) => `     ${i + 1}) ${a.name}: ${a.values.length ? a.values.join(" / ") : "(không liệt kê giá trị)"} — cách chọn: ${howText(a)}${customAsks(a).length === 1 ? ` — CÂU HỎI CỦA CHỦ SHOP khi hỏi mục này: "${customAsks(a)[0]}"` : customAsks(a).length > 1 ? " — chủ shop có sẵn nhiều câu hỏi, câu cần dùng được ghi ở phần TRẠNG THÁI THUỘC TÍNH" : ""}`);
  return `   BẢNG THUỘC TÍNH (khách phải chọn đủ các mục này trước khi xin số điện thoại và địa chỉ; hỏi theo đúng thứ tự dòng):\n${lines.join("\n")}\n`;
}

const joinOpts = (vals) => (vals.length <= 1 ? vals.join("") : vals.length === 2 ? vals.join(" hay ") : vals.slice(0, -1).join(", ") + " hay " + vals[vals.length - 1]);

function needText(item, body, status) {
  const a = item.attr;
  const opts = a.values.length ? `, các giá trị: ${a.values.join(" / ")}` : "";
  if (item.state === "chosen") {
    const note = a.kind === "choose" ? "" : " → KHÔNG xin chiều cao/cân nặng nữa để kiểm tra mục này";
    return `ĐÃ CHỌN ${item.picked.join(" + ")}, không hỏi lại${note}`;
  }
  if (item.state === "confirm") {
    const sug = item.pending?.suggested || item.picked[0];
    return `khách nói "${item.pending?.raw || ""}" nhưng sản phẩm CHỈ có: ${a.values.join(" / ")} → CHƯA chốt, KHÔNG ghi nhận "${item.pending?.raw || ""}" và KHÔNG tự chọn thay khách. ${item.fresh ? `Trong tin này PHẢI nói rõ sản phẩm chỉ có các giá trị đó và hỏi lại đúng 1 câu: "Ý khách là chọn ${sug} đúng không?"` : `Đã hỏi khách xác nhận ${sug}; chờ khách trả lời, chưa hỏi mục khác.`} Chỉ khi khách đồng ý rõ ràng hoặc nói một giá trị hợp lệ khác thì mới ghi nhận.`;
  }
  if (item.state === "proposed") return `shop đã gợi ý ${item.picked[0]} và khách chưa phản đối → coi như đã chọn, không hỏi lại`;
  if (item.state === "measured") return `khách ĐÃ đưa số đo cần thiết → trong tin này tư vấn luôn giá trị hợp theo cách chọn${opts}, KHÔNG hỏi lại số đo`;
  // missing
  const grp = status ? emptyGroupOf(status, a) : null;
  if (grp) {
    const names = status.list.filter((x) => grp.keys.includes(x.attr.key)).map((x) => x.attr.name).join(" + ");
    return `CHƯA chọn, và CẢ BỘ (${names}) đều chưa có gì → hỏi MỘT câu chung cho cả bộ theo đúng câu chủ shop đã viết (giữ nguyên ý, chỉ chỉnh xưng hô cho khớp đoạn chat): "${pickNextAsk(grp.asks, status.shopTexts)}"`;
  }
  const own = customAsks(a);
  if (own.length) {
    const half = a.kind === "pair" && body.height !== body.weight;
    if (!half) return `CHƯA chọn. Khi hỏi mục này PHẢI hỏi đúng câu chủ shop đã viết (giữ nguyên ý, chỉ chỉnh xưng hô cho khớp đoạn chat): "${pickNextAsk(own, status?.shopTexts)}"`;
  }
  if (a.kind === "pair") {
    if (body.height && !body.weight) return "CHƯA chọn. Khách mới nói chiều cao → chỉ hỏi nốt cân nặng";
    if (body.weight && !body.height) return "CHƯA chọn. Khách mới nói cân nặng → chỉ hỏi nốt chiều cao";
    return "CHƯA chọn. Xin chiều cao + cân nặng cùng lúc trong 1 câu ngắn, rồi tư vấn giá trị hợp";
  }
  if (a.kind === "height") return `CHƯA chọn. Chỉ xin chiều cao (KHÔNG xin cân nặng), có chiều cao thì tư vấn luôn giá trị hợp${opts}`;
  if (a.kind === "weight") return `CHƯA chọn. Chỉ xin cân nặng (KHÔNG xin chiều cao), có cân nặng thì tư vấn luôn giá trị hợp${opts}`;
  return a.values.length ? `CHƯA chọn. Hỏi khách lấy: ${joinOpts(a.values)}` : `CHƯA chọn. Hỏi khách chọn ${a.name.toLowerCase()} nào`;
}

/** Ghi chú theo từng lượt: trạng thái từng thuộc tính + việc cần làm tiếp. */
export function attributeTurnNote(product, status) {
  if (!status?.list?.length) return "";
  const lines = status.list.map((x, i) => `${i + 1}. ${x.attr.name} (cách chọn: ${howText(x.attr)}): ${needText(x, status.body, status)}`);
  const missing = status.list.filter((x) => x.state === "missing");
  const next = nextAttrToAsk(status);
  const measured = measuredItems(status);
  // Khách đã đưa số đo mà shop chưa nói giá trị (chiều dài, size...) → PHẢI nói trong tin này, rồi xin SĐT/địa chỉ ngay ở tin kế tiếp nếu các mục khác đã đủ
  const adviceTail = measured.length
    ? `BẮT BUỘC trong tin này: nói rõ MỘT giá trị cụ thể (đúng trong danh sách giá trị, theo cách chọn của chủ shop) cho: ${measured.map((x) => x.attr.name).join(", ")} — vd "chị cao 1m48 thì chân váy dài 75cm là vừa đẹp ạ". Phải nói giá trị này TRƯỚC, rồi mới xin số điện thoại và địa chỉ. `
    : "";
  const confirms = confirmItems(status);
  const tail = confirms.length
    ? `CÒN MỤC CHỜ KHÁCH XÁC NHẬN (${confirms.map((x) => x.attr.name).join(", ")}) → CHƯA xin số điện thoại/địa chỉ, CHƯA lên đơn, CHƯA hỏi mục khác cho tới khi khách xác nhận.`
    : next
    ? `${adviceTail}Mục cần chốt kế tiếp: "${next.attr.name}". ${missing.length > 1 ? "Các mục còn thiếu theo thứ tự: " + missing.map((x) => x.attr.name).join(" → ") + ". " : ""}Mỗi tin chỉ hỏi 1 mục (riêng các mục cùng 1 BỘ mà cả bộ còn thiếu thì hỏi chung 1 câu như ghi ở trên). CHƯA xin số điện thoại và địa chỉ cho tới khi hết mục CHƯA chọn. Khi khách đang hỏi chuyện khác (giá, ship, ảnh...) thì chỉ trả lời, theo luật không hỏi ở mọi tin.`
    : measured.length
      ? adviceTail + "Các mục khác đã đủ → ngay trong LƯỢT TRẢ LỜI NÀY, sau khi đã nói giá trị tư vấn, gửi THÊM 1 tin ngắn xin số điện thoại và địa chỉ nhận hàng (vd \"chị cho em xin số điện thoại và địa chỉ nhận hàng để em lên đơn nha\"). KHÔNG chờ khách nhắn tiếp, KHÔNG hỏi \"chị chọn được mẫu ưng ý chưa\"."
      : `Các mục đã đủ → theo Bước 3: xin số điện thoại và địa chỉ nhận hàng nếu chưa có.`;
  // Khách VỪA từ chối một giá trị (vd shop/bot nhắc "dài 85cm", khách nói "mình không lấy dài 85cm đâu") → xác nhận đúng lựa chọn của khách, không khuyên đổi
  const refusalNote = (status.refusals || []).length
    ? "\n\nKHÁCH VỪA TỪ CHỐI: " +
      status.refusals
        .map((r) => `${r.attrName}: khách KHÔNG lấy ${r.refused.join(", ")}; đơn đang ghi ${r.kept.length ? r.kept.join(", ") : "(chưa có)"}`)
        .join("; ") +
      '. Trả lời ĐÚNG 1 câu ngắn xác nhận đúng lựa chọn của khách, kiểu "dạ đúng rồi, em lấy chiều dài 75cm cho chị nha" (nếu đơn chưa có giá trị cho mục đó thì hỏi lại ĐÚNG 1 câu cho mục đó). KHÔNG nói "em nhầm", KHÔNG nhắc lại hay khuyên giá trị khách vừa từ chối, KHÔNG xin khách đổi ý.'
    : "";
  return (
    refusalNote +
    `\n\nTRẠNG THÁI THUỘC TÍNH của sản phẩm "${product?.name || ""}" (hệ thống đã đối chiếu cả cuộc chat, ĐÚNG hơn trí nhớ của bạn, BẮT BUỘC làm theo; ưu tiên hơn các luật hỏi size/cặp khác):\n` +
    lines.join("\n") +
    `\n${tail}\nMục đã ghi ĐÃ CHỌN thì tuyệt đối không hỏi lại và không xin số đo để kiểm tra lại. Điền customer_info.variant đủ các mục khách đã chọn (vd "Màu đen, Chiều dài 70cm, Size L").`
  );
}

// ---------------------------------------------------------------------------------------------
// Câu hỏi lại (tin nhắn bồi) cho 1 thuộc tính
// ---------------------------------------------------------------------------------------------

/**
 * Chọn câu hỏi bồi THEO THỨ TỰ: tìm câu mới nhất shop đã gửi khớp với 1 câu trong danh sách → lấy câu kế tiếp (hết thì quay lại câu 1).
 * Chưa gửi câu nào → câu 1. `shopTexts` = các tin shop/bot đã gửi, MỚI NHẤT TRƯỚC.
 * So khớp theo độ trùng từ (≥ 60%) để vẫn nhận ra câu đã được chỉnh xưng hô.
 */
export function pickNextAsk(asks, shopTexts) {
  if (!asks || !asks.length) return "";
  if (asks.length === 1) return asks[0];
  const toks = (t) => new Set(squash(t).split(" ").filter(Boolean));
  const sim = (a, b) => {
    const A = toks(a);
    const B = toks(b);
    if (!A.size || !B.size) return 0;
    let n = 0;
    for (const x of A) if (B.has(x)) n++;
    return n / Math.max(A.size, B.size);
  };
  for (const t of shopTexts || []) {
    for (const s of sentencesOf(t)) {
      let best = -1;
      let bestSim = 0;
      asks.forEach((q, i) => {
        const v = sim(q, s);
        if (v > bestSim) {
          bestSim = v;
          best = i;
        }
      });
      if (best >= 0 && bestSim >= 0.6) return asks[(best + 1) % asks.length];
    }
  }
  return asks[0];
}

/** Các câu hỏi bồi chủ shop tự viết cho thuộc tính (mỗi dòng 1 câu). */
export function customAsks(a) {
  return String(a?.ask || "")
    .split(/\n+/)
    .map((x) => x.trim())
    .filter(Boolean);
}

/** Soạn câu hỏi ngắn cho mục `item` (phần tử của status.list). Không có gì để hỏi → "". */
export function buildAttrAsk(item, status, { pronounText = "", avoid = [], neutral = false } = {}) {
  if (!item) return "";
  if (item.state === "confirm") {
    const { kh: k2, tu: t2 } = pronounsFrom(pronounText);
    return buildConfirmAsk(item, { kh: k2, tu: t2, neutral });
  }
  const a = item.attr;
  // Thuộc tính thuộc 1 BỘ mà cả bộ còn thiếu → hỏi câu hỏi bồi của bộ (thiếu một phần thì chạy như bình thường)
  const grp = emptyGroupOf(status, a);
  if (grp) {
    return pickNextAsk(grp.asks, avoid);
  }
  // Chủ shop đã viết sẵn câu hỏi bồi cho thuộc tính này → dùng đúng câu đó (trừ khi mục "cặp số đo" khách mới nói một nửa thì hỏi nốt nửa còn lại)
  const halfPair = a.kind === "pair" && status?.body && status.body.height !== status.body.weight;
  const own = customAsks(a);
  if (own.length && !halfPair) {
    return pickNextAsk(own, avoid);
  }
  const { kh, tu } = pronounsFrom(pronounText);
  let frames;
  if (a.kind === "choose") {
    const isColor = /(^| )mau( |$)/.test(a.key);
    const what = a.values.length ? joinOpts(isColor ? a.values.map((v) => v.toLowerCase()) : a.values) : isColor ? "màu nào" : `${a.name.toLowerCase()} nào`;
    const pick = a.values.length ? (isColor ? `màu ${what}` : what) : what;
    frames = neutral
      ? [`Shop xin ${a.values.length ? "mình chọn " + pick : a.name.toLowerCase()} nha?`, `Mình lấy ${pick} ạ?`]
      : [`${cap(kh)} lấy ${pick} ạ?`, `${cap(kh)} chọn ${pick} giúp ${tu} nha?`, `${cap(kh)} cho ${tu} biết ${a.values.length ? "lấy " + pick : what} nha?`];
  } else {
    const body = status?.body || {};
    let what = "chiều cao";
    if (a.kind === "weight") what = "cân nặng";
    else if (a.kind === "pair") what = body.height && !body.weight ? "cân nặng" : body.weight && !body.height ? "chiều cao" : "chiều cao cân nặng";
    frames = neutral
      ? [`Shop xin ${what} của mình nha?`, `Mình gửi shop ${what} giúp nhé?`]
      : [
          `${cap(kh)} cho ${tu} xin ${what} nha?`,
          `${cap(kh)} gửi ${tu} ${what} nhé?`,
          `${cap(kh)} nhắn ${tu} ${what} giúp nha?`,
          `${cap(kh)} cho ${tu} biết ${what} nha?`,
          `${cap(kh)} báo ${tu} ${what} nhé?`,
        ];
  }
  const used = new Set();
  for (const t of avoid || []) for (const s of sentencesOf(t)) used.add(squash(s));
  const free = frames.filter((f) => !used.has(squash(f)));
  const pool = free.length ? free : frames;
  return pool[Math.floor(Math.random() * pool.length)];
}

/** Shop đã từng hỏi khách về 1 thuộc tính nào của bảng chưa (xét các tin shop gần đây)? Dùng cho tin nhắn bồi. */
export function shopAskedAnyAttr(attrs, shopTexts) {
  for (const t of shopTexts || []) if (askedAttrSet(attrs, t).size) return true;
  return false;
}
