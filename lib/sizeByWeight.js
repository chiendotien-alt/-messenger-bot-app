// lib/sizeByWeight.js — SIZE THEO CÂN NẶNG do HỆ THỐNG tính từ bảng của chủ shop, không để AI tự so số.
//
// Lỗi cũ (25/11/2026): bảng ghi "L: 54–60kg ... 2XL: 68–75kg", khách nhắn "Cao 145 nặng 59" mà bot tư vấn "size 2XL".
// Lý do: không có đoạn code nào đổi cân nặng thành size, bot (AI chạy nhanh, không suy nghĩ) tự đọc cả dòng chữ rồi so → nhầm.
//
// Cách làm:
//  1) Đọc các khoảng cân nặng trong ô "Cách chọn" của thuộc tính (dạng "S: 37-46kg M:47–53kg L: 54–60kg ...").
//  2) Lấy cân nặng khách nói gần nhất → ra ĐÚNG size theo bảng.
//  3) Trước khi gọi AI: dặn thẳng "khách nặng 59kg → size L" (sizeAdviceNote).
//  4) Sau khi AI trả lời: nếu AI nói size khác bảng → tự sửa lại thành size đúng trước khi gửi khách (fixSizeInMessages).
// Khách TỰ nói size (vd "XL là đc", "2xL 68 kg có rộng không") thì theo khách, hệ thống KHÔNG sửa.
//
// File chỉ chứa luật thuần (không gọi mạng/CSDL) nên test riêng được.

import { normalizeBodyText } from "./replyDedupe";
import { matchValues } from "./attributes";

const esc = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Các khoảng cân nặng đọc từ ô "Cách chọn" của 1 thuộc tính: [{ label, min, max }] (sắp theo min). Không đọc được → []. */
export function weightRanges(attr) {
  const how = String(attr?.how || "");
  if (!how || !Array.isArray(attr?.values) || attr.values.length < 2) return [];
  const out = [];
  for (const label of attr.values) {
    const lab = String(label || "").trim();
    if (!lab) continue;
    // "L: 54–60kg" / "L 54-60" / "L = 54 ~ 60kg". Nhãn không được dính vào chữ/số khác (để "XL" không khớp trong "2XL")
    const re = new RegExp(`(?<![\\p{L}\\p{N}])${esc(lab)}\\s*[:=]?\\s*(\\d{2,3})\\s*[-–—~]\\s*(\\d{2,3})(?![\\d])`, "iu");
    const m = re.exec(how);
    if (!m) continue;
    const min = parseInt(m[1], 10);
    const max = parseInt(m[2], 10);
    if (!(min >= 20 && max <= 250 && min <= max)) continue;
    out.push({ label: lab, min, max });
  }
  out.sort((a, b) => a.min - b.min);
  return out.length >= 2 ? out : [];
}

/** Size hợp với cân nặng kg theo bảng. { label, min, max } hoặc null nếu cân nặng vượt quá bảng (không đoán). */
export function sizeForWeight(ranges, kg) {
  if (!ranges?.length || !(kg > 0)) return null;
  const hit = ranges.find((r) => kg >= r.min && kg <= r.max);
  if (hit) return hit;
  if (kg < ranges[0].min) return ranges[0]; // nhẹ hơn mốc nhỏ nhất → size nhỏ nhất
  if (kg > ranges[ranges.length - 1].max) return null; // nặng hơn mốc lớn nhất → không có số trong bảng, để AI/chủ shop tự nói
  // rơi vào khoảng hở giữa 2 mốc (vd 46,5kg giữa 37–46 và 47–53) → lấy size lớn hơn
  return ranges.find((r) => r.min > kg) || null;
}

// Cân nặng khách viết: "59kg", "59 kg", "59 ký", "59 cân", "nặng 59", "nặng tới 60"
const KG_RE = /(?<![\d.,])(\d{2,3})(?:[.,]\d)?\s?(?:kg|ky|kí|ký|kilo|cân|can)(?![\p{L}\p{N}])|(?:nặng|nang)\s*(?:tới\s*|toi\s*|khoảng\s*|khoang\s*|tầm\s*|tam\s*)?(\d{2,3})(?![\d])/giu;

/** Số cân nặng (kg) trong 1 đoạn chữ; mọi số tìm được (25–160). */
export function weightsIn(text) {
  const out = [];
  for (const m of String(text || "").matchAll(KG_RE)) {
    const kg = parseInt(m[1] || m[2], 10);
    if (kg >= 25 && kg <= 160) out.push(kg);
  }
  return out;
}

/**
 * Cân nặng khách nói GẦN NHẤT trong cuộc chat. msgs: [{ from, text }] cũ → mới (tin khách có from === "customer").
 * Tin gần nhất có cân nặng mà nói 2 con số khác nhau (vd "mình 59kg, bạn mình 68kg") → null (không đoán).
 */
export function weightFromMessages(msgs) {
  let prevShop = "";
  let last = null;
  for (const m of msgs || []) {
    const text = String(m?.text || "");
    if (!text.trim()) continue;
    if (m.from !== "customer") {
      prevShop = text;
      continue;
    }
    const ws = weightsIn(normalizeBodyText(text, prevShop));
    if (ws.length) last = [...new Set(ws)];
  }
  if (!last || last.length !== 1) return null;
  return last[0];
}

/**
 * Với từng thuộc tính có bảng cân nặng: size đúng theo cân nặng khách đã nói.
 *  attrs/status: như trong lib/attributes.js | msgs: tin chat (cũ → mới) | currentTexts: các tin khách LƯỢT NÀY (mảng chữ)
 * Bỏ qua thuộc tính mà khách đã tự chọn, hoặc khách tự nhắc tới một size trong lượt này (khách quyết).
 * @returns {{ index: number, attr: object, kg: number, label: string, min: number, max: number }[]}
 */
export function sizeAdviceFor(attrs, status, msgs, currentTexts = []) {
  const kg = weightFromMessages(msgs);
  if (!kg) return [];
  const out = [];
  (attrs || []).forEach((a, i) => {
    const ranges = weightRanges(a);
    if (!ranges.length) return;
    const st = status?.list?.[i]?.state;
    if (st === "chosen" || st === "confirm") return;
    if ((currentTexts || []).some((t) => matchValues(a, String(t || "")).length)) return;
    const r = sizeForWeight(ranges, kg);
    if (!r) return;
    out.push({ index: i, attr: a, kg, label: r.label, min: r.min, max: r.max });
  });
  return out;
}

/** Dặn AI (nối vào câu lệnh của lượt): size đúng theo bảng cân nặng. Rỗng nếu không có. */
export function sizeAdviceNote(advice) {
  if (!advice?.length) return "";
  return (
    "\n\nSIZE THEO BẢNG CÂN NẶNG (hệ thống đã tính, ĐÚNG hơn bạn tự so số): " +
    advice
      .map((x) => `khách nặng ${x.kg}kg → ${x.attr.name} = ${x.label} (khoảng ${x.min}–${x.max}kg)`)
      .join("; ") +
    ". Khi tư vấn PHẢI nói đúng giá trị này, KHÔNG tự đổi sang size khác (kể cả size lớn hơn cho rộng). Chỉ khi khách tự nói muốn size khác thì mới theo khách."
  );
}

/**
 * Sửa tin trả lời: AI nói size KHÁC size theo bảng (vd 59kg mà nói 2XL) → đổi thành size đúng.
 * Chỉ sửa khi tin nói ĐÚNG MỘT size (tin liệt kê "size S, M, L, XL" thì không đụng vào).
 * @returns {{ messages: string[], changes: { from: string, to: string }[] }}
 */
export function fixSizeInMessages(messages, advice) {
  const list = Array.isArray(messages) ? messages : [];
  const changes = [];
  if (!advice?.length) return { messages: list, changes };
  let out = list.map((m) => String(m ?? ""));
  for (const adv of advice) {
    const labels = [...adv.attr.values].sort((a, b) => String(b).length - String(a).length);
    if (!labels.length) continue;
    const alt = labels.map(esc).join("|");
    // "size 2XL" / "sz L" / "cỡ M" (có chữ size) hoặc 2XL / XL / XXL đứng một mình. Chữ L, M, S trơn không có chữ size thì bỏ qua (dễ nhầm).
    const re = new RegExp(`(?<![\\p{L}\\p{N}])(?:((?:size|sz|cỡ)\\s*[:.\\-]?\\s*))?(${alt})(?![\\p{L}\\p{N}])`, "giu");
    const bareOk = (lab) => /^\d?x{1,3}l$/i.test(lab);
    out = out.map((msg) => {
      const hits = [];
      for (const m of msg.matchAll(re)) {
        if (!m[1] && !bareOk(m[2])) continue;
        hits.push(String(m[2]).toLowerCase());
      }
      const distinct = [...new Set(hits)];
      if (distinct.length !== 1 || distinct[0] === adv.label.toLowerCase()) return msg;
      const was = distinct[0];
      const fixed = msg.replace(re, (all, pre, lab) => {
        if (String(lab).toLowerCase() !== was) return all;
        if (!pre && !bareOk(lab)) return all;
        return `${pre || ""}${adv.label}`;
      });
      if (fixed !== msg) changes.push({ from: was.toUpperCase(), to: adv.label });
      return fixed;
    });
  }
  return { messages: out, changes };
}
