// Các quyết định dùng chung cho hồ sơ khách, câu trả lời và đơn nháp.
import { looksLikeAddressStrict, hasClearAddressSignal, isLocationOnlyText, removeInfoAsks } from "./replyDedupe";
import { pickAddressFromTexts } from "./pickAddress";

const plain = value => String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/đ/gi, "d").toLowerCase();
const PHONE = /(?<!\d)(?:0|\+?84)[ .-]?(?:[35789](?:[ .-]?\d){8}|2(?:[ .-]?\d){9})(?!\d)/g;
const digits = value => value.replace(/[ .-]/g, "");
export function phoneChange(text) {
  const s = plain(text);
  const replacing = s.match(/(?:so moi|doi (?:sang )?(?:sdt|so))\s*[:,-]?\s*(0\d{2,8})(?![ .-]?\d)/);
  if (replacing) return { partial: replacing[1], pending: true };
  const matches = [...s.matchAll(PHONE)];
  const valid = matches.filter((m,i) => {
    const left = s.slice(i ? matches[i-1].index + matches[i-1][0].length : 0, m.index);
    const right = s.slice(m.index + m[0].length, matches[i+1]?.index);
    return !/(?:so cu|so sai|nham so|bo so|khong (?:goi|dung)(?: so)?)\s*[:,-]?\s*$/.test(left)
      && !/^\s*(?:bo (?:nhe|di)|sai roi|khong dung nua)/.test(right);
  });
  if (valid.length) {
    const distinct = new Set(valid.map(m => digits(m[0])));
    if (distinct.size === 1) return {phone: [...distinct][0]};
    const marked = valid.filter(m => /(?:so moi|goi so|doi (?:sang )?so|lien he)\s*[:,-]?\s*$/.test(s.slice(0,m.index)));
    if (marked.length === 1) return {phone: digits(marked[0][0])};
    return {pending: true};
  }
  const part = s.match(/(?:sdt|so dien thoai|so moi|doi so|sua so)\s*[:,-]?\s*(0\d{2,8})(?!\d)/);
  return {partial: part?.[1], pending: /(?:doi|sua|thay|nham)\s+(?:sdt|so)|so (?:cu|moi|sai)/.test(s)};
}
export const selectedPhone = text => phoneChange(text).phone || null;

export function rawAddress(text) {
  const s = String(text || "").trim();
  if (!s || /[?]/.test(s) || /\b(?:mai|lat|sau|se) (?:gui|cho)|\b(?:dia chi cu|dung giao|khong (?:gui|giao))\b/.test(plain(s))) return "";
  const replacing = s.match(/(?:so moi|doi (?:sang )?(?:sdt|so))\s*[:,-]?\s*(0\d{2,8})(?![ .-]?\d)/);
  if (replacing) return { partial: replacing[1], pending: true };
  const matches = [...s.matchAll(PHONE)];
  const afterPhone = matches.length ? s.slice(matches.at(-1).index + matches.at(-1)[0].length).replace(/^[\s.,;:-]+/,"") : "";
  const explicit = s.match(/(?:đổi (?:địa chỉ|đc) (?:sang|thành)|địa chỉ mới|địa chỉ nhận hàng|giao (?:về|tới)|ship (?:về|tới))\s*[:,-]?\s+(.+)/iu);
  const part = (explicit?.[1] || afterPhone || s).trim();
  if (!hasClearAddressSignal(part) || isLocationOnlyText(part) || /\b(?:size|kg|mau (?:den|kem|trang)|may ngay|bao lau|bao nhieu|co ship|ship duoc|phi ship)\b/.test(plain(part))) return "";
  return pickAddressFromTexts([part], {requireClearSignal:true});
}

export function resolveAddress(texts, candidate = "") {
  for (const text of [...texts].reverse()) {
    const raw = rawAddress(text);
    if (raw) return raw;
    if (!candidate || isLocationOnlyText(candidate)) continue;
    const words = s => plain(s).match(/[a-z0-9]+/g) || [];
    const source = new Set(words(text));
    // Mọi thành phần thực (bao gồm số nhà và ngõ) phải xuất hiện trong cùng tin.
    const significant = words(candidate).filter(w => !["phuong","quan","huyen","tinh","tp","xa"].includes(w));
    if (significant.length && significant.every(w => source.has(w)) && looksLikeAddressStrict(candidate)) return candidate;
  }
  return "";
}

export function cleanConsultation(messages, info = {}) {
  const known = new Set();
  if (info.phone && !info.phonePending) known.add("so dien thoai");
  if (info.address) known.add("dia chi");
  return messages.map(msg => String(msg).split(/(?<=[.!?])\s+|\n+/)
    .filter(s => !/\b(?:vong eo|vong bung|so do eo|eo (?:bao nhieu|may|cua|chi|minh))\b/.test(plain(s)))
    .map(s => removeInfoAsks(s, known)).filter(Boolean).join(" ")).filter(Boolean);
}
export function substantiveOpening(text) {
  return !!selectedPhone(text) || !!rawAddress(text) || /\b(?:size\s*[smlx\d]+|\d+\s*(?:kg|ki|ky|can)\b|\d\s*m\s*\d|mau (?:den|trang|kem|hong|xanh|do|vang)|lay\s+\d|may ngay|bao lau)\b/.test(plain(text));
}

// Lời mời tư vấn chỉ xuất hiện sau khi trả lời thời gian giao hàng.
// Mỗi lượt giữ phần trả lời và một câu hỏi tiếp theo.
export function finishConsultation(messages, customerText, {apparel = false, kh = "mình", tu = "shop"} = {}) {
  const delivery = /\b(?:may ngay|bao lau|khi nao|bao gio)\b/.test(plain(customerText)) &&
    /\b(?:giao|ship|nhan|hang)\b/.test(plain(customerText));
  const out = [];
  let asked = false;
  for (const message of messages) {
    const kept = [];
    for (const sentence of String(message).split(/(?<=[.!?])\s+|\n+/)) {
      const s = plain(sentence);
      const bodyAsk = /(?:cho|gui|xin|bao|hoi|cao bao nhieu|nang bao nhieu)/.test(s) && /chieu cao|can nang/.test(s);
      const question = sentence.includes("?") || bodyAsk || /(?:cho .{0,12}xin|chon duoc .+ chua|thich mau nao)/.test(s);
      if (question && asked) continue;
      if (question) asked = true;
      kept.push(delivery && apparel && bodyAsk
        ? `Nếu ${kh} muốn ${tu} tư vấn size, ${kh} gửi ${tu} chiều cao và cân nặng nhé.`
        : sentence);
    }
    if (kept.length) out.push(kept.join(" "));
  }
  return delivery && out.length ? [out.join(" ")] : out;
}
