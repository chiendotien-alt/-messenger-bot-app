// lib/laterBuy.js — khách nói MUA THÊM / LẤY THÊM nhưng CÓ ĐIỀU KIỆN hoặc để SAU:
//   "Về mặc đẹp thì mua thêm cái màu trắng", "Nhận về mặt đẹp mới mua thêm màu trắng", "ưng thì lấy thêm", "lần sau mua thêm"...
// Đó KHÔNG phải đặt hàng ngay: khách mới lấy món đang chọn, món "mua thêm" là hứa hẹn sau khi nhận hàng.
// Lỗi cũ: hệ thống thấy chữ "mua thêm màu trắng" nên ghi luôn màu trắng vào đơn → đơn 2 váy 360k trong khi khách chỉ lấy 1 váy 195k.
//
// Cách làm: bỏ đúng CÁI VẾ nói chuyện mua thêm có điều kiện ra khỏi chữ mà các luật đọc đơn (màu, size, số lượng) nhìn thấy.
// Vế nào nói mua thêm bình thường ("lấy thêm 1 cái trắng nữa", "cho thêm màu trắng") vẫn giữ nguyên.
// Điều kiện về GIÁ ("bớt thì mua thêm", "miễn ship thì lấy thêm") KHÔNG tính ở đây: đó là chuyện mặc cả, do lib/priceLadder.js lo.
//
// File chỉ chứa luật thuần (không gọi mạng/CSDL) nên test riêng được.

const plain = (t) =>
  String(t || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/gi, "d")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const W = "(?: [a-z0-9]+)"; // một từ bất kỳ
const BUY = "(?:mua|lay|dat|order|chot)";
const MORE = "(?:them|tiep|nua)";
// Khen / hài lòng về hàng: "đẹp", "ưng", "vừa", "tốt", "hợp", "thích", "ổn"...
const EVAL = "(?:dep|ung|vua|tot|hop|thich|hai long|vua y|ung y|giong anh|giong hinh|chat luong|mac duoc|dung duoc|on)";
// Điều kiện về giá / khuyến mãi → chuyện mặc cả, không phải "mua thêm sau"
const PRICEY = /(?:^| )(?:bot|giam|re hon|khuyen mai|tang|freeship|mien phi|gia|uu dai|sale|combo|chiet khau|ck)(?: |$)/;

// A) "đẹp thì mua thêm", "ưng mới lấy thêm", "vừa mình sẽ mua thêm"
const RULE_A = new RegExp(`(?:^| )${EVAL}${W}{0,3} (?:thi|moi|se|roi)${W}{0,3} ${BUY} ${MORE}(?: |$)`);
// B) "nhận về ... mới mua", "mặc thử ưng thì lấy" (sau khi nhận / dùng thử rồi mới mua)
const RULE_B = new RegExp(`(?:^| )(?:nhan ve|nhan hang|nhan duoc|mac thu|dung thu|ve mac|ve dung)${W}{0,8} (?:thi|moi|se)${W}{0,3} ${BUY}(?: |$)`);
// C) "lần sau mua thêm", "mua thêm sau", "đợt sau lấy"
const RULE_C = new RegExp(`(?:^| )(?:lan sau|dot sau|sau nay|khi khac|hom sau|lan toi)${W}{0,4} ${BUY}(?: |$)|(?:^| )${BUY}(?: ${MORE})? (?:sau|lan sau|dot sau|lan nua|hom khac)(?: |$)`);
// D) "nếu đẹp mình lấy thêm", "khi nào ưng mua thêm"
const RULE_D = new RegExp(`(?:^| )(?:neu|khi|sau khi)${W}{0,8} ${BUY} ${MORE}(?: |$)`);

const BUY_MORE = new RegExp(`(?:^| )${BUY} ${MORE}(?: |$)`);
// Vế đứng TRƯỚC (cách nhau dấu phẩy) mang điều kiện: "Nếu đẹp," + "mua thêm màu trắng"; "Nhận về ưng," + "mua thêm trắng"
const PREV_COND = /(?:^| )(?:neu|khi|sau khi)(?: |$)|(?:^| )(?:nhan ve|nhan hang|mac thu|dung thu|ve mac|ve dung)(?: |$)/;

const isLaterClause = (pc) => !PRICEY.test(pc) && (RULE_A.test(pc) || RULE_B.test(pc) || RULE_C.test(pc) || RULE_D.test(pc));

/**
 * Bỏ khỏi tin khách các vế "mua thêm có điều kiện / để sau".
 * @returns {{ text: string, dropped: string[] }} text = phần còn lại (có thể rỗng); dropped = các vế đã bỏ
 */
export function splitLaterBuy(text) {
  const raw = String(text || "");
  if (!raw.trim()) return { text: raw, dropped: [] };
  const clauses = raw.split(/(?<=[,;.!\n])\s*/).filter((c) => c.trim());
  const pcs = clauses.map(plain);
  const drop = new Set();
  pcs.forEach((pc, k) => {
    if (!pc) return;
    if (isLaterClause(pc)) {
      drop.add(k);
      return;
    }
    if (k > 0 && BUY_MORE.test(pc) && !PRICEY.test(pc) && !PRICEY.test(pcs[k - 1]) && PREV_COND.test(pcs[k - 1])) {
      drop.add(k);
      drop.add(k - 1);
    }
  });
  if (!drop.size) return { text: raw, dropped: [] };
  return {
    text: clauses.filter((_, k) => !drop.has(k)).join(" ").trim(),
    dropped: clauses.filter((_, k) => drop.has(k)).map((c) => c.trim()),
  };
}

/** Chữ khách đã bỏ các vế mua thêm có điều kiện (để các luật đọc đơn dùng). */
export const dropLaterBuy = (text) => splitLaterBuy(text).text;

/** Tin này có vế "mua thêm có điều kiện / để sau" không? */
export const hasLaterBuy = (text) => splitLaterBuy(text).dropped.length > 0;

/** Ghi chú dặn AI (nối vào câu lệnh của lượt) khi tin khách lượt này có vế mua thêm có điều kiện. Rỗng nếu không có. */
export function laterBuyTurnNote(texts) {
  const quotes = [];
  for (const t of texts || []) for (const d of splitLaterBuy(t).dropped) quotes.push(d);
  if (!quotes.length) return "";
  return (
    "\n\nKHÁCH NÓI MUA THÊM CÓ ĐIỀU KIỆN / ĐỂ SAU (hệ thống đã nhận ra: \"" + quotes.slice(0, 2).join(" | ") + "\"): đó KHÔNG phải đặt hàng ngay. " +
    "Khách CHỈ lấy các món khách đã chọn rõ trước đó. TUYỆT ĐỐI KHÔNG ghi món / màu / size khách nói ở vế \"mua thêm\" đó vào đơn (order_items), KHÔNG tính thêm số lượng, KHÔNG báo giá 2 cái, KHÔNG xin khách chọn lại màu/size cho món đó. " +
    "Chỉ đáp 1 câu ngắn, nhẹ nhàng, thân thiện (vd \"dạ vâng, chị nhận hàng ưng thì nhắn em lên thêm đơn cho chị nha\"), rồi tiếp tục các bước còn thiếu cho món khách đang lấy (nếu còn thiếu), không thúc ép mua thêm."
  );
}
