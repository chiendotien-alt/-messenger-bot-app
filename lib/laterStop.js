// lib/laterStop.js
// Khách đã nói "để tham khảo thêm / nhắn sau / để lúc khác..." → bot vẫn trả lời lịch sự như bình thường,
// nhưng KHÔNG nhắn bồi thêm (bồi lúc này nghe như đang thúc khách).
// Chỉ đọc TIN CUỐI của khách (loạt tin khách nhắn liền nhau ngay trước lúc bot trả lời). Không đụng tới các trường hợp bồi khác.

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
  if (!raw.trim() || /[?？]/.test(raw)) return false;
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
