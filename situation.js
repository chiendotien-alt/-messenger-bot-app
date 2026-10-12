// lib/situation.js — "đoán tình huống & ngữ cảnh khách" trước khi bot trả lời.
//
// 3 lớp, rẻ → đắt:
//  1) Prompt: AI tự ghi "tinh_huong" ngay trong JSON trả lời (xem lib/botPrompt.js) — không tốn thêm lần gọi.
//  2) detectSituation(): nhãn tình huống bằng luật (không gọi AI) — dùng để tìm câu đã dạy đúng tình huống hơn (lib/training.js).
//  3) classifySituation(): AI phân loại RIÊNG bằng model nhẹ — chỉ chạy khi tin khách dễ hiểu sai (shouldClassify).
//
// Tắt toàn bộ lớp 3 bằng biến môi trường SITUATION_LAYER=off (lớp 1 + 2 vẫn chạy, không tốn quota).
import { normKey } from "./products";

export const SITUATION_LABELS = [
  "hoi_gia", // hỏi giá
  "mac_ca", // xin giảm giá, chê đắt, so sánh giá
  "hoi_hang", // còn hàng không, còn size/màu không
  "hoi_size", // tư vấn size, chiều cao cân nặng
  "hoi_anh", // xin xem ảnh/video/feedback
  "ship", // phí ship, thời gian giao, COD, kiểm tra hàng
  "chot_don", // muốn mua, đưa SĐT/địa chỉ, xác nhận lên đơn
  "phan_van", // để xem lại, hỏi người nhà, chưa chắc
  "doi_tra", // đổi/trả, bảo hành, hàng lỗi
  "phan_nan", // chậm, chưa nhận, bực, nghi ngờ, huỷ đơn
  "dong_y_ngan", // "ok", "vâng", "dạ" — trả lời ngắn cho câu shop vừa hỏi
  "khac",
];

// Từ khoá (đã bỏ dấu, so khớp theo TỪ/CỤM TỪ nguyên vẹn). Thứ tự = độ ưu tiên khi 1 câu dính nhiều nhóm.
// Phần tử bắt đầu bằng "~" được so khớp trên chữ CÓ DẤU (tránh nhầm "ảnh" với "anh", "bột" với "bớt"...).
// Phần tử thứ 3 (nếu có) là các biểu thức chính quy chạy trên chữ đã bỏ dấu.
const RULES = [
  ["phan_nan", ["cham qua", "sao lau", "chua thay", "chua nhan", "chua duoc nhan", "lau qua", "lua dao", "that vong", "te qua", "khong giong", "sai hang", "thieu hang", "huy don", "khong mua nua", "boc phet", "bao cong an", "khieu nai"]],
  ["doi_tra", ["doi tra", "doi size", "doi mau", "doi hang", "tra hang", "tra lai", "hoan tien", "bao hanh", "hang loi", "bi loi", "bi hu", "bi rach", "bi vo", "hu hong", "bi sai size"]],
  ["mac_ca", ["giam gia", "giam chut", "giam them", "giam di", "giam k", "giam ko", "giam khong", "giam duoc khong", "bot chut", "bot di", "bot duoc khong", "bot k", "bot ko", "re hon", "re di", "dat qua", "dat the", "dat vay", "mac qua", "khuyen mai", "uu dai", "sale", "ben khac re", "chot gia"]],
  ["chot_don", ["lay", "lay cai", "lay 1", "lay 2", "chot", "chot don", "dat hang", "dat luon", "dat 1", "dat 2", "len don", "muon mua", "mua luon", "mua 1", "mua 2", "mua cai nay", "minh mua", "em mua", "chi mua", "anh mua", "so dien thoai", "sdt", "dia chi", "ship ve", "gui ve"]],
  ["ship", ["ship", "giao hang", "van chuyen", "phi ship", "freeship", "free ship", "bao lau", "may ngay", "khi nao nhan", "bao gio nhan", "cod", "kiem tra hang", "cho xem hang", "nhan hang"]],
  ["phan_van", ["de xem", "de em xem", "de minh xem", "suy nghi", "hoi chong", "hoi vo", "hoi me", "hoi ba", "de a hoi", "de hoi", "luc nua", "tinh sau", "chua chac", "phan van", "de xem sao", "tham khao them"]],
  ["hoi_size", ["size", "sz", "chieu cao", "can nang", "mac vua", "vua khong", "rong khong", "chat khong"], [/(^| )\d{2,3} ?kg( |$)/, /(^| )1m\d{1,2}( |$)/, /(^| )cao \d/, /(^| )nang \d/]],
  ["hoi_anh", ["~ảnh", "~hình", "~ảnh", "xem hang", "xem anh", "xin anh", "xem hinh", "xin hinh", "hinh anh", "anh that", "anh mau", "anh khach", "feedback", "video", "clip", "xem mau"]],
  ["hoi_hang", ["con hang", "het hang", "con khong", "con size", "con mau", "con k", "con ko", "co san"]],
  ["hoi_gia", ["gia", "~giá", "bao nhieu", "bn", "bnh", "nhieu tien", "gia sao", "gia the nao", "bao nhieu tien"]],
];

const SHORT_ACK = new Set(["ok", "oke", "okie", "okela", "vang", "da", "uh", "u", "um", "uhm", "duoc", "dc", "dong y", "roi", "vang a", "da vang", "ok shop", "ok em", "da ok"]);

/** Nhãn tình huống của 1 câu (luật từ khoá, không gọi AI). */
export function detectOne(text) {
  const raw = ` ${String(text || "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim()} `;
  const norm = ` ${normKey(text)} `;
  if (norm.trim().length < 2) return "khac";
  for (const [label, kws, regexes] of RULES) {
    for (const kw of kws) {
      if (kw.startsWith("~")) {
        if (raw.includes(` ${kw.slice(1)} `) || raw.includes(kw.slice(1))) return label;
      } else if (norm.includes(` ${kw} `)) return label;
    }
    if (regexes) for (const re of regexes) if (re.test(norm)) return label;
  }
  if (SHORT_ACK.has(norm.trim())) return "dong_y_ngan";
  return "khac";
}

/** Nhãn tình huống của 1 hoặc nhiều tin (lấy nhãn đầu tiên khác "khac"; tin đầu danh sách ưu tiên nhất). */
export function detectSituation(texts) {
  const list = (Array.isArray(texts) ? texts : [texts]).map((t) => String(t || "").trim()).filter(Boolean);
  let ack = false;
  for (const t of list) {
    const l = detectOne(t);
    if (l === "dong_y_ngan") ack = true;
    else if (l !== "khac") return l;
  }
  return ack ? "dong_y_ngan" : "khac";
}

const HIGH_STAKES = new Set(["phan_nan", "mac_ca", "doi_tra", "phan_van"]);

/**
 * Có nên gọi AI phân loại riêng cho tin này không? Chỉ khi tin dễ hiểu sai hoặc nhạy cảm:
 *  - khách phàn nàn / xin giảm giá / đổi trả / đang phân vân
 *  - tin quá ngắn hoặc mơ hồ ("vậy hả", "thôi", "ok") — cần lịch sử mới hiểu
 *  - khách ĐÃ có đơn mà hỏi tiếp
 * Tin bình thường (hỏi giá, hỏi size, xin ảnh...) thì bỏ qua → không tốn thêm thời gian/quota.
 */
export function shouldClassify({ customerMessage, label, hasOrder, hasImages, historyLen }) {
  if (String(process.env.SITUATION_LAYER || "").toLowerCase() === "off") return false;
  if (hasImages) return false;
  if (!historyLen) return false; // chưa có lịch sử thì không có gì để "đoán ngữ cảnh"
  if (HIGH_STAKES.has(label)) return true;
  const words = normKey(customerMessage).split(" ").filter(Boolean);
  const ambiguous = words.length <= 2 && (label === "khac" || label === "dong_y_ngan");
  if (ambiguous) return true;
  if (hasOrder && ["khac", "ship", "dong_y_ngan"].includes(label)) return true;
  return false;
}

const CLASSIFIER_MODELS = ["gemini-3.5-flash-lite", "gemini-3.5-flash"];
const CLASSIFIER_BUDGET_MS = Number(process.env.SITUATION_BUDGET_MS) || 4500;

const CLASSIFIER_PROMPT = `Bạn là bộ phân tích tình huống cho bot bán hàng qua Messenger. Đọc đoạn chat và tin MỚI của khách, rồi đoán khách đang ở tình huống nào. KHÔNG trả lời khách.
Chỉ trả JSON: {"nhom": "...", "khach_muon": "...", "buoc": "...", "can_tranh": "...", "do_chac": "cao" | "vua" | "thap"}
- nhom: đúng 1 trong: ${SITUATION_LABELS.join(", ")}
- khach_muon: khách thực sự muốn gì / ý thật sau câu nói (tối đa 20 từ)
- buoc: khách đang ở bước nào (mới hỏi, đang so sánh, sắp chốt, đã đặt chờ hàng, đã nhận hàng...) (tối đa 12 từ)
- can_tranh: điều bot không nên làm lúc này (vd: hỏi lại thông tin đã có, ép chốt đơn, lặp lại thời gian ship) (tối đa 20 từ)
- do_chac: mức chắc chắn của bạn. Nếu đoạn chat không đủ để hiểu thì ghi "thap". Không bịa.
Chỉ dựa vào đoạn chat được đưa; không suy đoán giá, chính sách, hay thông tin shop.`;

function oneLine(t, max) {
  return String(t || "").replace(/\s+/g, " ").trim().slice(0, max);
}

/**
 * Gọi AI nhẹ phân loại tình huống. Lỗi/timeout/độ chắc thấp → trả null (bot chạy như cũ, không ảnh hưởng khách).
 * @returns {Promise<null | {nhom, khach_muon, buoc, can_tranh, do_chac}>}
 */
export async function classifySituation({ history, customerMessage, pendingTexts = [], orderBrief = "", productName = "", keys = [] }) {
  if (!keys.length) return null;
  const lines = (history || [])
    .slice(-8)
    .map((m) => `${m.from === "customer" ? "Khách" : "Shop"}: ${oneLine(m.text, 220) || "[ảnh]"}`);
  const newest = [...pendingTexts.map((t) => oneLine(t, 220)).filter(Boolean), oneLine(customerMessage, 220)].filter(Boolean);
  const uniqNewest = [...new Set(newest)].slice(-4);
  const text =
    (productName ? `Sản phẩm khách đang hỏi: ${oneLine(productName, 80)}\n` : "") +
    (orderBrief ? `Đơn của khách: ${oneLine(orderBrief, 400)}\n` : "") +
    `\nĐoạn chat gần nhất:\n${lines.join("\n") || "(chưa có)"}\n\nTin MỚI của khách (chưa trả lời):\n${uniqNewest.map((t) => `Khách: ${t}`).join("\n")}`;

  const t0 = Date.now();
  for (const model of CLASSIFIER_MODELS) {
    for (const k of keys.slice(0, 2)) {
      const remaining = CLASSIFIER_BUDGET_MS - (Date.now() - t0);
      if (remaining < 1200) return null;
      try {
        const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-goog-api-key": k.key },
          body: JSON.stringify({
            systemInstruction: { parts: [{ text: CLASSIFIER_PROMPT }] },
            contents: [{ role: "user", parts: [{ text }] }],
            generationConfig: { temperature: 0.1, maxOutputTokens: 300, responseMimeType: "application/json" },
          }),
          signal: AbortSignal.timeout(Math.min(3500, remaining)),
        });
        if (!res.ok) continue;
        const data = await res.json();
        const raw = data?.candidates?.[0]?.content?.parts?.map((p) => p.text || "").join("") || "";
        const parsed = safeParse(raw);
        if (!parsed) continue;
        const nhom = SITUATION_LABELS.includes(parsed.nhom) ? parsed.nhom : "khac";
        const doChac = ["cao", "vua", "thap"].includes(parsed.do_chac) ? parsed.do_chac : "thap";
        return {
          nhom,
          khach_muon: oneLine(parsed.khach_muon, 160),
          buoc: oneLine(parsed.buoc, 100),
          can_tranh: oneLine(parsed.can_tranh, 160),
          do_chac: doChac,
          model,
        };
      } catch {
        /* timeout / lỗi mạng → thử key/model kế tiếp trong ngân sách ngắn */
      }
    }
  }
  return null;
}

function safeParse(raw) {
  const cleaned = String(raw || "").replace(/```json|```/g, "").trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    const m = cleaned.match(/\{[\s\S]*\}/);
    if (m) {
      try {
        return JSON.parse(m[0]);
      } catch {}
    }
    return null;
  }
}

/** Đoạn ghi chú đưa vào câu lệnh của bot từ kết quả phân loại (rỗng nếu không đủ chắc). */
export function situationNote(s) {
  if (!s || s.do_chac === "thap") return "";
  const parts = [
    s.nhom && s.nhom !== "khac" && `- Nhóm tình huống: ${s.nhom}`,
    s.khach_muon && `- Khách đang muốn: ${s.khach_muon}`,
    s.buoc && `- Bước hiện tại: ${s.buoc}`,
    s.can_tranh && `- Lúc này nên tránh: ${s.can_tranh}`,
  ].filter(Boolean);
  if (!parts.length) return "";
  return (
    "\n\nPHÂN TÍCH TÌNH HUỐNG (hệ thống đoán trước từ cuộc trò chuyện, có thể sai — nếu mâu thuẫn với tin nhắn thật của khách hoặc đơn hàng/thông tin đã lưu thì tin thật là đúng):\n" +
    parts.join("\n") +
    "\nTrả lời cho hợp tình huống này, nhưng không nhắc tới \"phân tích\" hay \"tình huống\" với khách."
  );
}
