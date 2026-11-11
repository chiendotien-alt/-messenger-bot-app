// lib/packQty.js — SẢN PHẨM BÁN THEO VỈ / HỘP / GÓI (1 vỉ = 5 viên...).
// Chủ shop điền trong cài đặt sản phẩm: "Đơn vị bán" (vỉ) + "Số viên mỗi vỉ" (5) [+ "Tên đơn vị lẻ" (viên, mặc định)].
// Bảng giá mặc cả của sản phẩm tính theo ĐƠN VỊ BÁN (2 vỉ = 69k...). Khách thường nói theo số viên ("cho 10 viên") →
// hệ thống đổi ra vỉ (10 viên = 2 vỉ) để tính giá và ghi tin báo đơn "SL:2 vỉ (10 viên)".
// Sản phẩm KHÔNG điền 2 ô này → packConfig trả null → mọi chỗ gọi giữ nguyên cách cũ.
// File này không import gì nên test được bằng `npm test`.

const plain = (t) =>
  String(t || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/gi, "d")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

const NUM_WORD = { mot: 1, hai: 2, ba: 3, bon: 4, nam: 5, sau: 6, bay: 7, tam: 8, chin: 9, muoi: 10, "một": 1, "bốn": 4, "năm": 5, "sáu": 6, "bảy": 7, "tám": 8, "chín": 9, "mười": 10 };
const NUM_RE = "(\\d{1,3}|mot|hai|ba|bon|nam|sau|bay|tam|chin|muoi)";
const esc = (x) => String(x).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const toNum = (w) => (/^\d/.test(w) ? parseInt(w, 10) : NUM_WORD[w]);

// Bản chữ GIỮ DẤU (chỉ hạ chữ thường + bỏ ký tự lạ). Bỏ dấu thì "vỉ", "vì", "vị", "vĩ" đều thành "vi" →
// "xã Ba Vì" bị đọc thành "3 vỉ" (15 viên, 79k). Nhận số lượng phải dựa vào đúng dấu của đơn vị.
const light = (t) => String(t || "").normalize("NFC").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
const NUM_WORDS_RE = Object.keys(NUM_WORD).join("|");

/** Cấu hình bán theo gói của sản phẩm, hoặc null nếu sản phẩm không bán theo gói. */
export function packConfig(product) {
  const unit = String(product?.unitName ?? "").trim();
  const size = parseInt(String(product?.unitSize ?? "").replace(/\D/g, ""), 10);
  if (!unit || !(size >= 2 && size <= 999)) return null;
  const sub = String(product?.subUnitName ?? "").trim() || "viên";
  return { unit, size, sub, unitP: plain(unit), subP: plain(sub), unitL: light(unit), subL: light(sub) };
}

/** "2 vỉ (10 viên)" */
export function packLabel(packs, cfg) {
  return `${packs} ${cfg.unit} (${packs * cfg.size} ${cfg.sub})`;
}

/**
 * Số lượng khách nói trong 1 tin, theo vỉ hoặc theo viên (lấy chỗ nói SAU CÙNG trong tin).
 *   "cho 10 viên"  → { packs: 2, pieces: 10, exact: true }
 *   "lấy 3 vỉ"     → { packs: 3, pieces: 15, exact: true }
 *   "cho 7 viên"   → { exact: false, pieces: 7, low: 1, high: 2 }   (không tròn vỉ → phải hỏi lại, không tự đoán)
 * Tin không nói vỉ/viên → null.
 */
export function detectPackQty(text, cfg) {
  if (!cfg) return null;
  const s = light(text);
  if (!s) return null;
  const hits = [];
  // Số viết bằng CHỮ SỐ ("2 vỉ", "10 viên"): nhận chữ có dấu đúng ("vỉ") hoặc gõ không dấu hẳn ("vi", "vien").
  // Số viết bằng CHỮ ("ba vỉ", "hai vỉ"): chỉ nhận khi đơn vị có dấu đúng — "ba vi" có thể là địa chỉ "Ba Vì", "hai vị khách"...
  const scan = (unitL, unitP, kind) => {
    const edge = "(?![\\p{L}\\p{N}])";
    const reDigit = new RegExp(`(?<![\\p{L}\\p{N}])(\\d{1,3})\\s*(?:${esc(unitL)}|${esc(unitP)})${edge}`, "gu");
    const reWord = new RegExp(`(?<![\\p{L}\\p{N}])(${NUM_WORDS_RE})\\s+${esc(unitL)}${edge}`, "gu");
    let m;
    while ((m = reDigit.exec(s))) hits.push({ at: m.index, n: toNum(m[1]), kind });
    while ((m = reWord.exec(s))) hits.push({ at: m.index, n: toNum(m[1]), kind });
  };
  scan(cfg.unitL, cfg.unitP, "unit");
  scan(cfg.subL, cfg.subP, "sub");
  const ok = hits.filter((h) => h.n >= 1 && h.n <= 999).sort((a, b) => a.at - b.at);
  if (!ok.length) return null;
  const h = ok[ok.length - 1];
  if (h.kind === "unit") return { packs: h.n, pieces: h.n * cfg.size, exact: true };
  if (h.n % cfg.size === 0) return { packs: h.n / cfg.size, pieces: h.n, exact: true };
  return { exact: false, pieces: h.n, low: Math.floor(h.n / cfg.size), high: Math.ceil(h.n / cfg.size) };
}

/**
 * Khách trả lời TRƠN bằng một con số ("2", "vỉ 2", "hai", "lấy 2 nha") — thường là chọn 1 trong 2 phương án bot vừa hỏi lại
 * (vd "1 vỉ hay 2 vỉ ạ?"). Chỉ dùng để gỡ tình huống số viên không tròn vỉ. Không phải câu trơn → null.
 */
export function bareNumberReply(text, cfg) {
  if (!cfg) return null;
  const s = plain(text);
  const m = s.match(new RegExp(`^(?:(?:lay|cho|chon|loai|em lay|minh lay)\\s+)?(?:${esc(cfg.unitP)}\\s+)?${NUM_RE}(?:\\s+(?:${esc(cfg.unitP)}|nha|nhe|a|ak|nhen|di|ha|ne))*$`));
  const n = m ? toNum(m[1]) : null;
  return n >= 1 && n <= 99 ? n : null;
}
