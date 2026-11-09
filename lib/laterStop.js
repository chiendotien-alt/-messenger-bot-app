// lib/laterStop.js
// Khách đã nói "để tham khảo thêm / nhắn sau / để lúc khác..." → bot vẫn trả lời lịch sự như bình thường,
// nhưng KHÔNG nhắn bồi thêm (bồi lúc này nghe như đang thúc khách).
// Chỉ đọc TIN CUỐI của khách (loạt tin khách nhắn liền nhau ngay trước lúc bot trả lời). Không đụng tới các trường hợp bồi khác.

import { infoTopicsOf } from "./replyDedupe";
import { analyzeHesitation } from "./hesitate";

const strip = (t) =>
  String(t || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d");

// Cụm từ (đã bỏ dấu) cho thấy khách hẹn quay lại sau / còn đang cân nhắc thêm
const LATER_PHRASES = [
  "de sau", "nt sau", "nhan sau", "nhan lai sau", "ib sau", "inbox sau", "nhan tin sau", "lien he sau", "lien he lai sau",
  "tinh sau", "mua sau", "lay sau", "dat sau", "xem sau", "hen sau", "hen lai sau",
  "luc khac", "khi khac", "hom khac", "bua khac", "dip khac", "hom sau", "ngay mai", "tuan sau", "thang sau",
  "mai nhan", "mai nt", "mai ib", "mai mua", "mai tinh", "mai xem", "mai lay",
  "luc nua", "lat nua", "lat nhan", "lat ib", "lat nt",
  "tham khao them", "tham khao da", "tham khao truoc", "de tham khao", "th kh them", "thkh",
  "de xem them", "de suy nghi", "suy nghi them", "can nhac them", "de can nhac", "de nghi them", "nghi them",
];

/** Tin này có phải khách hẹn "để sau / tham khảo thêm" không. Tin có dấu "?" (khách còn đang hỏi) thì KHÔNG tính. */
export function saidLater(text) {
  const raw = String(text || "");
  if (!raw.trim()) return false;
  if (analyzeDefer([raw]).defer) return true; // "mai chị gửi địa chỉ / thông tin nha" (kể cả có dấu ?)
  if (/[?？]/.test(raw)) return false;
  if (analyzeHesitation([raw]).kind === "defer") return true; // "để mình hỏi chồng đã", "để mình xem đã", "lăn tăn quá"... → không bồi
  // "th/kh" (= tham khảo) viết tắt có dấu gạch: đổi thành khoảng trắng để so khớp "th kh"
  const n = ` ${strip(raw).replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim()} `;
  if (LATER_PHRASES.some((p) => n.includes(` ${p} `))) return true;
  // "mai chị nhắn lại", "mai em mua nha"...
  return /\bmai\b.{0,12}\b(nhan|nt|ib|mua|lay|tinh|xem|lien he)\b/.test(n);
}

/**
 * messages: tin gần đây, CŨ → MỚI, mỗi tin { from: "customer"|"bot"|"admin", text }.
 * Lấy loạt tin khách liền nhau trước các tin trả lời cuối cùng của bot/chủ shop; có tin nào hẹn "để sau" → true.
 */
export function customerWantsLater(messages) {
  const list = (messages || []).filter((m) => String(m?.text || "").trim() && !/^📷/.test(String(m.text)));
  let i = list.length - 1;
  while (i >= 0 && list[i].from !== "customer") i--; // bỏ qua các tin trả lời của bot/chủ shop ở cuối
  const burst = [];
  while (i >= 0 && list[i].from === "customer") burst.push(list[i--].text);
  return burst.some(saidLater);
}


/**
 * Khách đã hẹn "để tham khảo thêm / nhắn sau" TRONG VÀI TIN GẦN ĐÂY (kể cả khi sau đó khách hỏi thêm chuyện khác, vd hỏi chất vải).
 * Lỗi cũ: chỉ xét loạt tin cuối của khách → khách nói "để chị tham khảo thêm rồi gửi", rồi hỏi "chất liệu vải gì vậy" →
 * loạt tin cuối chỉ có câu hỏi vải → bot vẫn nhắn bồi xin số điện thoại/địa chỉ. Khách đã hẹn thì không thúc nữa.
 */
export function customerWantsLaterRecently(messages, maxBack = 12) {
  const list = (messages || []).filter((m) => String(m?.text || "").trim() && !/^📷/.test(String(m.text))).slice(-maxBack);
  return list.some((m) => m.from === "customer" && saidLater(m.text));
}


// =====================================================================================================================
// KHÁCH HẸN "GỬI SAU": "mai chị gửi địa chỉ nha", "tối chị gửi thông tin", "để chị gửi sđt sau", "chưa có địa chỉ"...
// Khi đó bot chỉ đáp lịch sự, TUYỆT ĐỐI không tự thêm câu xin SĐT/địa chỉ nữa, và KHÔNG lưu câu hẹn đó làm địa chỉ.
// =====================================================================================================================
const NOT_LETTER_BEFORE = "(?<![\\p{L}])";
const NOT_LETTER_AFTER = "(?![\\p{L}])";
const word = (alts) => new RegExp(`${NOT_LETTER_BEFORE}(?:${alts})${NOT_LETTER_AFTER}`, "iu");
const wordG = (alts) => new RegExp(`${NOT_LETTER_BEFORE}(?:${alts})${NOT_LETTER_AFTER}`, "giu");

// Từ chỉ thời gian "để sau" (ngày mai, lát nữa, tối nay, hôm sau, khi nào tiện...)
const TIME_ALTS = [
  "ngày mai", "ngay mai", "sáng mai", "sang mai", "chiều mai", "chieu mai", "tối mai", "toi mai", "mai", "ngày mốt", "mốt",
  "lát nữa", "lat nua", "lát", "lúc nữa", "luc nua", "tối nay", "toi nay", "chiều nay", "chieu nay", "sáng nay", "trưa nay",
  "tối", "trưa", "chiều(?!\\s+(?:dài|dai|cao|rộng|rong|ngang))",
  "hôm sau", "hom sau", "bữa sau", "bua sau", "tuần sau", "tuan sau", "lúc khác", "luc khac", "hôm khác", "hom khac", "sau này", "sau",
  "(?:khi|lúc|luc|bao giờ|bao gio)(?:\\s+nào|\\s+nao)?\\s+(?:tiện|tien|rảnh|ranh|có|co)",
  "không vội", "khong voi", "không gấp", "khong gap",
].join("|");
const TIME_RE = word(TIME_ALTS);
// Động từ "gửi/đưa/nhắn..." (không cần đối tượng cụ thể) và động từ yếu (cần có địa chỉ/SĐT/thông tin đi kèm)
const VERB_STRONG_ALTS = "gửi|gởi|gui|đưa|dua|nhắn|ib|nt|inbox|cung cấp|cung cap|điền|dien|tư vấn|tu van|liên hệ|lien he|trả lời|tra loi|phản hồi|phan hoi";
const VERB_WEAK_ALTS = "cho|báo|bao|ghi|chụp|chup|nói|noi";
const VERB_STRONG_RE = word(VERB_STRONG_ALTS);
const VERB_WEAK_RE = word(VERB_WEAK_ALTS);
// Đối tượng: địa chỉ / SĐT / thông tin chung
const OBJ_ADDR_RE = word("địa chỉ|dia chi|đc|dc|nơi nhận|noi nhan|số nhà|so nha|nhận hàng|nhan hang");
const OBJ_PHONE_RE = word("sđt|sdt|số điện thoại|so dien thoai|số đt|số phone|số zalo|zalo|số máy|đt|phone");
const OBJ_GENERIC_RE = word("thông tin|thong tin|tt|info");
// Khách đang nói chuyện gửi HÀNG / tiền / ảnh (không phải thông tin) → không tính là hẹn gửi thông tin
const NOT_INFO_RE = /(?:gửi|gởi|gui|giao|chuyển|chuyen|ship|lấy|lay|nhận|nhan)\s*(?:hàng|hang|đồ|do|váy|vay|áo|ao|quần|quan|đơn|don)|tiền|tien|cọc|coc|chuyển khoản|chuyen khoan|thanh toán|thanh toan|(?:ảnh|anh|hình|hinh|clip|video)\s|(?:ảnh|hình|clip|video)$/iu;
// Khách nói CHƯA CÓ thông tin ("chưa có địa chỉ cụ thể", "chưa biết địa chỉ")
const NOT_YET_RE = /(?<![\p{L}])(?:chưa|chua)\s+(?:có|co|biết|biet|rõ|ro|nhớ|nho|chắc|chac|nắm|nam)\s+(?:[\p{L}]+\s+){0,2}(?:địa chỉ|dia chi|sđt|sdt|số điện thoại|so dien thoai|thông tin|thong tin|nơi nhận|noi nhan)/iu;

const FILLER_RE = wordG("chị|chi|anh|em|mình|minh|bạn|ban|cô|co|chú|chu|shop|nha|nhé|nhe|nhá|ạ|a|nhỉ|y|ơi|oi|dạ|da|vâng|vang|ok|nhen|hen|với|voi|luôn|luon|sẽ|se|để|de|được|duoc|rồi|roi|lại|lai|cái|cai|của|cua|là|la|có|co|thì|thi");
const strip2 = (s) => s.replace(/\s{2,}/g, " ").replace(/^[\s,.;:\-]+|[\s,.;:\-]+$/g, "");

/**
 * Một câu/cụm có phải khách hẹn "gửi sau" không. Trả { defer, topics:Set("dia chi"|"so dien thoai"), rest: phần còn lại sau khi bỏ chữ hẹn }.
 */
function analyzeClause(clause) {
  const c = String(clause || "");
  if (!c.trim()) return { defer: false, topics: new Set(), rest: c };
  const hasTime = TIME_RE.test(c);
  const hasAddr = OBJ_ADDR_RE.test(c);
  const hasPhone = OBJ_PHONE_RE.test(c);
  const hasGeneric = OBJ_GENERIC_RE.test(c);
  const hasObj = hasAddr || hasPhone || hasGeneric;
  const notYet = NOT_YET_RE.test(c);
  let defer = false;
  if (notYet) defer = true;
  else if (hasTime && (hasObj ? VERB_STRONG_RE.test(c) || VERB_WEAK_RE.test(c) : VERB_STRONG_RE.test(c) && !NOT_INFO_RE.test(c))) defer = true;
  if (!defer) return { defer: false, topics: new Set(), rest: c };
  const topics = new Set();
  if (hasAddr) topics.add("dia chi");
  if (hasPhone) topics.add("so dien thoai");
  if (!topics.size || hasGeneric) {
    topics.add("dia chi");
    topics.add("so dien thoai");
  }
  // rest = phần còn lại khi bỏ chữ hẹn (để kiểm tra khách có lỡ đưa địa chỉ thật trong cùng câu không)
  let rest = c;
  for (const re of [TIME_RE, VERB_STRONG_RE, VERB_WEAK_RE, OBJ_ADDR_RE, OBJ_PHONE_RE, OBJ_GENERIC_RE]) rest = rest.replace(new RegExp(re.source, "giu"), " ");
  rest = strip2(rest.replace(FILLER_RE, " "));
  return { defer: true, topics, rest };
}

/**
 * texts: các tin khách vừa nhắn (loạt tin liền nhau). Trả:
 *  - defer: có cụm nào là "hẹn gửi sau" không
 *  - topics: Set chủ đề đang hẹn ("dia chi", "so dien thoai") — nói chung chung ("gửi thông tin") thì cả hai
 *  - rest: các tin sau khi BỎ phần hẹn (dùng để nhận địa chỉ thật, không nhận câu hẹn làm địa chỉ)
 */
export function analyzeDefer(texts) {
  const topics = new Set();
  const rest = [];
  let defer = false;
  for (const raw of texts || []) {
    const t = String(raw || "");
    if (!t.trim()) continue;
    // Tách theo dấu câu / xuống dòng; mỗi cụm xét riêng để câu "SĐT 09.., mai gửi địa chỉ" vẫn giữ phần SĐT
    const clauses = t.split(/(?<=[,;.!?…\n])\s*/).filter((x) => x.trim());
    const keep = [];
    for (const cl of clauses.length ? clauses : [t]) {
      const r = analyzeClause(cl);
      if (r.defer) {
        defer = true;
        for (const x of r.topics) topics.add(x);
        if (r.rest) keep.push(r.rest);
      } else keep.push(cl);
    }
    rest.push(keep.join(" ").trim());
  }
  return { defer, topics, rest: rest.filter(Boolean) };
}

/** Khách có hẹn "gửi sau" trong loạt tin hiện tại không (dạng tiện dùng) */
export function customerDefersInfo(texts) {
  return analyzeDefer(texts).defer;
}

const ECHO_RE = /(?<![\p{L}])(?:khi|lúc|bao giờ)\s*(?:nào\s*)?(?:tiện|rảnh)|không vội|không gấp|từ từ|cứ gửi|cứ nhắn|cứ báo|(?<![\p{L}])(?:mai|lát|sau)(?![\p{L}])/iu;

/**
 * Bỏ khỏi tin trả lời của bot những câu XIN lại thông tin khách vừa hẹn gửi sau (vd khách hẹn gửi địa chỉ mà AI lại viết "chị cho em xin SĐT nha").
 * Câu đáp lại lời hẹn ("dạ vâng ạ, mai chị gửi địa chỉ cho em nhé ạ") được giữ nguyên.
 */
export function dropAsksForDeferred(messages, topics) {
  if (!topics || !topics.size) return messages || [];
  const out = [];
  for (const m of messages || []) {
    const sentences = String(m || "").split(/(?<=[.!?…])\s+/).filter(Boolean);
    const kept = sentences.filter((s) => {
      const asked = infoTopicsOf(s);
      if (!asked.some((t) => topics.has(t))) return true;
      return analyzeDefer([s]).defer || ECHO_RE.test(s); // câu đáp lời hẹn → giữ
    });
    const text = kept.join(" ").trim();
    if (text) out.push(text);
  }
  return out;
}
