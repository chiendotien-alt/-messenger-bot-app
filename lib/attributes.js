// lib/attributes.js — BẢNG THUỘC TÍNH của sản phẩm (Màu, Chiều dài, Size...) do chủ shop cài trong trang sản phẩm.
//
// Mỗi dòng của bảng: { name: "Chiều dài", values: "60cm, 70cm, 80cm", how: "theo chiều cao ..." }
//  - name   : tên thuộc tính
//  - values : các giá trị, ngăn cách bằng dấu phẩy (có thể để trống)
//  - how    : "cách chọn" — chủ shop viết chữ bình thường. Hệ thống đọc chữ trong ô này để biết cách hỏi:
//       có cả "chiều cao" và "cân nặng" → hỏi CẶP chiều cao + cân nặng (hỏi nốt nửa còn lại nếu khách mới nói một nửa)
//       chỉ có "chiều cao"             → chỉ hỏi chiều cao
//       chỉ có "cân nặng"              → chỉ hỏi cân nặng
//       còn lại / để trống              → khách tự chọn trong các giá trị
//
// File này chỉ chứa luật thuần (không gọi mạng/CSDL) nên test riêng được.

import { HEIGHT_TEXT_RE, WEIGHT_TEXT_RE, pronounsFrom, cap } from "./replyDedupe";

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
    out.push({ name, key: squash(name), values, how, kind: attributeKind(how) });
  }
  return out;
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
 * Giá trị nào của thuộc tính `attr` xuất hiện trong `text`? Trả về mảng nhãn gốc (vd ["Đen"]).
 * bare = true: chấp nhận cả khi khách chỉ nhắn trơn giá trị (vd "70", "L") — dùng khi shop vừa hỏi đúng thuộc tính này.
 */
export function matchValues(attr, text, { bare = false } = {}) {
  if (!attr.values.length) return [];
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
      if (bare || shortMsg) res.push(new RegExp(`(?<![0-9a-z])${vr}(?![0-9a-z])`));
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
export function attributeStatus(attrs, history, currentTexts = [], variantText = "") {
  const msgs = [
    ...(history || []).map((m) => ({ c: m.from === "customer", text: String(m.text || "") })),
    ...(currentTexts || []).map((t) => ({ c: true, text: String(t || "") })),
  ].filter((m) => m.text.trim());

  const chosen = attrs.map(() => null); // { values: [label], by }
  const proposal = attrs.map(() => null); // label
  let lastShopText = "";
  let shopAskIdx = -1;

  for (const m of msgs) {
    if (!m.c) {
      lastShopText = m.text;
      shopAskIdx = askedAttrIndex(attrs, m.text);
      // Shop gợi ý ĐÚNG 1 giá trị (câu không phải câu hỏi, có chữ lấy/hợp/vừa/mặc...)
      attrs.forEach((a, i) => {
        for (const s of sentencesOf(m.text)) {
          if (s.includes("?")) continue;
          if (!RECOMMEND.test(plain(s))) continue;
          const f = matchValues(a, s);
          if (f.length === 1 && !(chosen[i] && chosen[i].values.length === 1 && chosen[i].values[0] === f[0])) proposal[i] = f[0];
        }
      });
      continue;
    }
    const question = QUESTIONISH.test(plain(m.text));
    const phone = PHONE_IN.test(m.text.replace(/[\s.\-]/g, ""));
    attrs.forEach((a, i) => {
      const found = question ? [] : matchValues(a, m.text, { bare: i === shopAskIdx });
      if (found.length) {
        chosen[i] = { values: found, by: "customer" };
        proposal[i] = null;
      } else if (proposal[i] && (isAffirm(m.text) || phone)) {
        chosen[i] = { values: [proposal[i]], by: "confirmed" };
        proposal[i] = null;
      } else if (proposal[i] && !question && NEGATE.test(plain(m.text))) {
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
    if (chosen[i]) {
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
      } else if ((a.kind === "pair" && body.height && body.weight) || (a.kind === "height" && body.height) || (a.kind === "weight" && body.weight)) {
        state = "measured";
      }
    }
    return { attr: a, state, picked };
  });
  return { list, body };
}

/** Mục kế tiếp cần hỏi: mục "cặp số đo" mới có một nửa thì hỏi nốt trước, còn lại theo thứ tự bảng. */
export function nextAttrToAsk(status) {
  const missing = status.list.filter((x) => x.state === "missing");
  if (!missing.length) return null;
  const half = missing.find((x) => x.attr.kind === "pair" && (status.body.height !== status.body.weight));
  return half || missing[0];
}

/** Ghép màu/size/chiều dài khách ĐÃ CHỌN thành 1 dòng để lưu vào đơn: "Màu Đen, Chiều dài 70cm, Size L". */
export function composeVariant(status) {
  const parts = status.list.filter((x) => x.state === "chosen" && x.picked.length).map((x) => `${x.attr.name} ${x.picked.join(" + ")}`);
  return parts.join(", ").slice(0, 120);
}

/** Mục nào đang cho phép hỏi lại ở lượt này (khách vừa trả lời → được hỏi mục kế tiếp). Trả mảng chủ đề của luật chống hỏi lặp. */
export function topicsToUnblock(status, progressed) {
  if (!progressed) return [];
  const next = nextAttrToAsk(status);
  if (!next) return [];
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
  const lines = attrs.map((a, i) => `     ${i + 1}) ${a.name}: ${a.values.length ? a.values.join(" / ") : "(không liệt kê giá trị)"} — cách chọn: ${howText(a)}`);
  return `   BẢNG THUỘC TÍNH (khách phải chọn đủ các mục này trước khi xin số điện thoại và địa chỉ; hỏi theo đúng thứ tự dòng):\n${lines.join("\n")}\n`;
}

const joinOpts = (vals) => (vals.length <= 1 ? vals.join("") : vals.length === 2 ? vals.join(" hay ") : vals.slice(0, -1).join(", ") + " hay " + vals[vals.length - 1]);

function needText(item, body) {
  const a = item.attr;
  const opts = a.values.length ? `, các giá trị: ${a.values.join(" / ")}` : "";
  if (item.state === "chosen") {
    const note = a.kind === "choose" ? "" : " → KHÔNG xin chiều cao/cân nặng nữa để kiểm tra mục này";
    return `ĐÃ CHỌN ${item.picked.join(" + ")}, không hỏi lại${note}`;
  }
  if (item.state === "proposed") return `shop đã gợi ý ${item.picked[0]} và khách chưa phản đối → coi như đã chọn, không hỏi lại`;
  if (item.state === "measured") return `khách ĐÃ đưa số đo cần thiết → trong tin này tư vấn luôn giá trị hợp theo cách chọn${opts}, KHÔNG hỏi lại số đo`;
  // missing
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
  const lines = status.list.map((x, i) => `${i + 1}. ${x.attr.name} (cách chọn: ${howText(x.attr)}): ${needText(x, status.body)}`);
  const missing = status.list.filter((x) => x.state === "missing");
  const next = nextAttrToAsk(status);
  const tail = next
    ? `Mục cần chốt kế tiếp: "${next.attr.name}". ${missing.length > 1 ? "Các mục còn thiếu theo thứ tự: " + missing.map((x) => x.attr.name).join(" → ") + ". " : ""}Mỗi tin chỉ hỏi 1 mục. CHƯA xin số điện thoại và địa chỉ cho tới khi hết mục CHƯA chọn. Khi khách đang hỏi chuyện khác (giá, ship, ảnh...) thì chỉ trả lời, theo luật không hỏi ở mọi tin.`
    : `Các mục đã đủ → theo Bước 3: xin số điện thoại và địa chỉ nhận hàng nếu chưa có.`;
  return (
    `\n\nTRẠNG THÁI THUỘC TÍNH của sản phẩm "${product?.name || ""}" (hệ thống đã đối chiếu cả cuộc chat, ĐÚNG hơn trí nhớ của bạn, BẮT BUỘC làm theo; ưu tiên hơn các luật hỏi size/cặp khác):\n` +
    lines.join("\n") +
    `\n${tail}\nMục đã ghi ĐÃ CHỌN thì tuyệt đối không hỏi lại và không xin số đo để kiểm tra lại. Điền customer_info.variant đủ các mục khách đã chọn (vd "Màu đen, Chiều dài 70cm, Size L").`
  );
}

// ---------------------------------------------------------------------------------------------
// Câu hỏi lại (tin nhắn bồi) cho 1 thuộc tính
// ---------------------------------------------------------------------------------------------

/** Soạn câu hỏi ngắn cho mục `item` (phần tử của status.list). Không có gì để hỏi → "". */
export function buildAttrAsk(item, status, { pronounText = "", avoid = [], neutral = false } = {}) {
  if (!item) return "";
  const a = item.attr;
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
