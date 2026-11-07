// lib/contactKind.js — AI phân loại "tin này của khách có phải SĐT / địa chỉ không" để quyết định CÓ CHỜ 30 giây hay không.
//
// Bối cảnh: shop vừa xin SĐT + địa chỉ, khách chỉ đưa MỘT nửa → bot chờ 30 giây cho khách gửi nốt (PAIR_WAIT_MS).
// Việc "tin này có phải một nửa thông tin liên hệ không" do luật chữ (looksLikeAddress / extractPhone) đoán; luật hay đoán nhầm
// khi khách gõ lạ ("Mà mặc 85 dài quá k em" bị đọc là địa chỉ → bot chờ 30 giây dù khách đang hỏi về sản phẩm).
//
// Nguyên tắc an toàn: AI CHỈ ĐƯỢC HỦY việc chờ, KHÔNG BAO GIỜ được tự bắt chờ.
//  - Luật chữ đã nói "không phải một nửa" → không chờ, AI không can thiệp.
//  - Luật chữ nói "một nửa" + AI nói "không phải liên hệ" hoặc "đã đủ cả hai" → bỏ chờ, trả lời ngay.
//  - AI lỗi / hết giờ / trả lời lạ / không có key → giữ nguyên hành vi cũ (chờ).
// AI sai theo hướng bỏ chờ chỉ làm bot trả lời sớm hơn (vẫn hỏi nốt phần còn thiếu như bình thường), không làm mất thông tin.
//
// Tắt hẳn bằng biến môi trường CONTACT_AI=off. File này không import DB nên test được bằng `npm test`
// (lib/gemini chỉ được nạp khi thật sự gọi AI).

const MODELS = ["gemini-3.5-flash-lite", "gemini-3.8-flash", "gemini-3.6-flash"];
const BUDGET_MS = Number(process.env.CONTACT_AI_BUDGET_MS) || 3500;

export const CONTACT_KINDS = ["phone", "address", "both", "none"];

const ALIASES = {
  sdt: "phone", phone: "phone", so_dien_thoai: "phone",
  dia_chi: "address", address: "address",
  ca_hai: "both", both: "both",
  khong: "none", none: "none",
};

export const CONTACT_PROMPT = `Bạn phân loại MỘT tin nhắn của khách trong cuộc chat bán hàng trên Messenger. Shop vừa hỏi khách xin số điện thoại và/hoặc địa chỉ nhận hàng. Hãy cho biết tin MỚI NHẤT của khách có chứa gì:
- "sdt": có số điện thoại của khách (và chưa có địa chỉ).
- "dia_chi": có địa chỉ nhận hàng (số nhà, ngõ, đường, thôn/xóm, phường/xã, quận/huyện, tỉnh/thành...) và chưa có số điện thoại.
- "ca_hai": có cả số điện thoại và địa chỉ.
- "khong": KHÔNG phải thông tin liên hệ. Gồm: hỏi / nhận xét / than phiền về sản phẩm (độ dài, size, màu, chất vải, giá, ship, đổi trả...), chọn màu hoặc size, nói số đo (cao 1m54, nặng 50kg, váy dài 85cm), trả lời "ok", "dạ", "vâng"...
Lưu ý: con số trong câu nói về kích thước / số đo / giá (vd "mặc 85 dài quá k em", "váy dài 92cm", "195k") KHÔNG phải địa chỉ hay số điện thoại. Khách gõ tắt, không dấu, sai chính tả thì vẫn hiểu theo nghĩa. Không chắc là địa chỉ / số điện thoại thì chọn "khong". Chỉ dựa vào đoạn chat được đưa.
Chỉ trả JSON: {"loai": "sdt" | "dia_chi" | "ca_hai" | "khong"}`;

const oneLine = (t, max) => String(t || "").replace(/\s+/g, " ").trim().slice(0, max);

/** Đọc JSON AI trả về → "phone" | "address" | "both" | "none"; không đọc được / giá trị lạ → null. */
export function parseContactKind(raw) {
  const cleaned = String(raw || "").replace(/```json|```/g, "").trim();
  if (!cleaned) return null;
  let obj = null;
  try {
    obj = JSON.parse(cleaned);
  } catch {
    const m = cleaned.match(/\{[\s\S]*\}/);
    if (m) {
      try {
        obj = JSON.parse(m[0]);
      } catch {}
    }
  }
  const v = obj && typeof obj === "object" ? obj.loai ?? obj.kind : null;
  const key = String(v ?? "").trim().toLowerCase().replace(/[\s-]+/g, "_");
  return ALIASES[key] || null;
}

/**
 * Quyết định BỎ chờ hay không (chỉ gọi khi luật chữ đã nói "khách mới đưa một nửa").
 * true = bỏ chờ, trả lời ngay: AI nói tin không phải thông tin liên hệ, hoặc khách đã đưa đủ cả hai.
 * false = giữ chờ (AI xác nhận một nửa, hoặc không có kết quả).
 */
export function shouldReleaseHold(kind) {
  return kind === "none" || kind === "both";
}

export function contactAiEnabled() {
  return String(process.env.CONTACT_AI || "").toLowerCase() !== "off";
}

/** Gọi AI thật (Gemini nhẹ, tối đa 2 key, ngân sách ngắn). Tách riêng để test thay bằng bản giả. */
async function defaultAskGeminiJson({ system, text, keys, budgetMs }) {
  const { callGeminiOnly } = await import("./gemini.js");
  const r = await callGeminiOnly(
    system,
    [{ role: "user", parts: [{ text }] }],
    { temperature: 0.1, maxOutputTokens: 60, responseMimeType: "application/json", thinkingConfig: { thinkingLevel: "low" } },
    Date.now() + budgetMs,
    keys,
    { models: MODELS, maxKeys: 2, timeoutMs: 3000, minRemainingMs: 1000 }
  );
  return r?.text || "";
}

/**
 * @param {{text: string, pendingTexts?: string[], botAsk?: string, keys?: any[], io?: {askGeminiJson: Function}}} args
 * @returns {Promise<"phone"|"address"|"both"|"none"|null>} null = không phân loại được (lỗi / hết giờ / không có key)
 */
export async function classifyContactMessage({ text, pendingTexts = [], botAsk = "", keys = [], io } = {}) {
  const ask = io?.askGeminiJson || defaultAskGeminiJson;
  if (!io && !(keys || []).length) return null;
  const newest = oneLine(text, 300);
  if (!newest) return null;
  const earlier = (pendingTexts || []).map((t) => oneLine(t, 200)).filter((t) => t && t !== newest).slice(-3);
  const body =
    (botAsk ? `Shop vừa hỏi: ${oneLine(botAsk, 300)}\n` : "") +
    (earlier.length ? `\nCác tin khách gửi trước đó (chưa được trả lời):\n${earlier.map((t) => `Khách: ${t}`).join("\n")}\n` : "") +
    `\nTin MỚI NHẤT của khách cần phân loại:\nKhách: ${newest}`;
  try {
    const raw = await ask({ system: CONTACT_PROMPT, text: body, keys, budgetMs: BUDGET_MS });
    return parseContactKind(raw);
  } catch {
    return null;
  }
}
