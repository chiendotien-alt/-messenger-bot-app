// lib/contactAsk.js — CHỐT CHẶN: khách vừa đưa ĐÚNG MỘT nửa của cặp (địa chỉ / SĐT) mà câu trả lời của AI quên xin nửa còn lại
// (AI hay chỉ viết "dạ em nhận được thông tin rồi ạ" vì câu ví dụ trong luật "chốt đơn") → hệ thống tự thêm câu xin phần còn thiếu.
import { askedTopics } from "./replyDedupe";

const cap = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

/**
 * @param messages       các tin AI định gửi
 * @param gaveAddress    khách VỪA đưa địa chỉ ở lượt này
 * @param gavePhone      khách VỪA đưa SĐT ở lượt này
 * @param havePhone      shop đã lưu SĐT của khách (trước hoặc trong lượt này)
 * @param haveAddress    shop đã lưu địa chỉ của khách
 * @param kh, tu         cách xưng hô ("chị"/"anh"..., "em"/"shop")
 * @param neutral        sản phẩm cấm xưng hô anh/chị → dùng câu trung tính
 * @returns { messages, need, ask } nếu cần thêm câu xin; null nếu không cần
 */
export function missingContactAsk({ messages, gaveAddress, gavePhone, havePhone, haveAddress, kh = "mình", tu = "em", neutral = false }) {
  const list = (messages || []).map((m) => String(m || "")).filter((m) => m.trim());
  if (!list.length) return null;

  let need = "";
  if (gaveAddress && !gavePhone && !havePhone) need = "phone";
  else if (gavePhone && !gaveAddress && !haveAddress) need = "address";
  if (!need) return null;

  // AI đã tự xin đúng phần đó rồi → không thêm
  if (askedTopics(list.join(" ")).has(need === "phone" ? "so dien thoai" : "dia chi")) return null;

  const what = need === "phone" ? "số điện thoại" : "địa chỉ nhận hàng";
  const ask = neutral ? `Shop xin thêm ${what} nữa nha ạ.` : `${cap(tu)} xin thêm ${what} nữa nha ${kh}.`;
  const out = list.length >= 2 ? [...list.slice(0, -1), `${list[list.length - 1].replace(/\s+$/, "")} ${ask}`] : [...list, ask];
  return { messages: out, need, ask };
}
