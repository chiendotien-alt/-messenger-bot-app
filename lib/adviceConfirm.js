// lib/adviceConfirm.js — khách ĐÃ gửi đủ SĐT + địa chỉ, chỉ còn chờ bot tư vấn nốt chiều dài/size theo số đo (trạng thái "measured").
// AI tư vấn xong ("chị cao 1m52 mặc dài 85cm là vừa đẹp ạ") nhưng câu xin SĐT/địa chỉ bị bỏ (đã có) → tin trả lời không còn câu hỏi nào
// → khách không biết phải trả lời gì, tin nhắn bồi cũng không có gì để nhắc → ĐƠN ĐỨNG YÊN (chủ shop phải nhắn tay).
// Hàm này thêm đúng 1 câu xin chốt giá trị vừa tư vấn; khách đáp "ok" là đơn được hệ thống ghép và báo như bình thường.
import { matchValues } from "./attributes.js";

const plain = (t) =>
  String(t || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/đ/gi, "d").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/**
 * @returns {string|null} câu xin chốt, hoặc null nếu không cần thêm
 */
export function buildAdviceConfirm({ status, messages = [], haveContact = false, kh = "chị", tu = "em", neutral = false, recentBotTexts = [] } = {}) {
  if (!haveContact) return null; // chưa đủ SĐT/địa chỉ → AI vẫn xin bình thường
  const list = status?.list || [];
  const open = list.filter((x) => x.state !== "chosen");
  if (!open.length) return null; // đã chọn đủ → đường ghép đơn bình thường lo
  if (open.some((x) => x.state !== "measured")) return null; // còn thiếu màu/size... → để AI hỏi, không chen vào
  if ((messages || []).some((m) => /\?/.test(String(m)))) return null; // AI đã có câu hỏi rồi
  const text = (messages || []).join(" ");
  const parts = [];
  for (const x of open) {
    const vals = matchValues(x.attr, text);
    if (vals.length !== 1) return null; // AI chưa nói rõ đúng 1 giá trị → không đoán
    const nm = String(x.attr.name || "").toLowerCase();
    parts.push(/^size$/i.test(nm) ? `size ${vals[0]}` : `${nm} ${vals[0]}`);
  }
  const what = parts.join(" và ");
  const pw = plain(what);
  // Đã hỏi chốt đúng giá trị này gần đây rồi → không lặp
  if ((recentBotTexts || []).some((t) => /len don/.test(plain(t)) && plain(t).includes(pw))) return null;
  return neutral ? `Shop lên đơn ${what} luôn nhé ạ?` : `Vậy ${tu} lên đơn ${what} cho ${kh} nha?`;
}
