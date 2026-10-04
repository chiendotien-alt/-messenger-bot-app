// lib/replyDedupe.js — chặn bot hỏi lại 1 câu hỏi gần giống 1 trong vài tin bot/shop vừa gửi (mặc định 3 tin gần nhất).
//
// Chỉ áp dụng cho CÂU HỎI (có dấu ?) đủ dài. Câu trả lời thường (giá, số tài khoản, địa chỉ...) không bị chặn,
// vì khách có thể xin lại và bot phải gửi lại được.

const MIN_WORDS = 6; // câu hỏi ngắn hơn ngần này chữ thì không so sánh (tránh chặn nhầm "Dạ mình lấy màu nào ạ?")
const SIMILAR = 0.6; // giống nhau từ 60% số chữ (không tính dấu, hoa/thường) trở lên → coi là hỏi lặp

function words(t) {
  return String(t || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d")
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
}

function jaccard(a, b) {
  const A = new Set(a);
  const B = new Set(b);
  let both = 0;
  for (const w of A) if (B.has(w)) both++;
  const all = A.size + B.size - both;
  return all ? both / all : 0;
}

/** Câu `candidate` có phải câu hỏi lặp của 1 trong các tin bot/shop đã gửi gần đây (`recentTexts`)? */
export function isRepeatedQuestion(candidate, recentTexts) {
  const text = String(candidate || "");
  if (!text.includes("?")) return false;
  const w = words(text);
  if (w.length < MIN_WORDS) return false;
  for (const old of recentTexts || []) {
    if (!String(old).includes("?")) continue; // chỉ so với các câu hỏi cũ
    const ow = words(old);
    if (ow.length < MIN_WORDS) continue;
    if (w.join(" ") === ow.join(" ") || jaccard(w, ow) >= SIMILAR) return true;
  }
  return false;
}
