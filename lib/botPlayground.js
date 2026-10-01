// lib/botPlayground.js — chạy bot thử trong trang "Dạy bot" (chủ shop đóng vai khách).
// Dùng đúng câu lệnh hệ thống + danh sách sản phẩm + ví dụ đã dạy như bot thật, nhưng KHÔNG gửi gì cho Facebook
// và KHÔNG lưu vào hộp thoại khách hàng.
import { getProducts, formatProductsForPrompt } from "./products";
import { getSettings } from "./settings";
import { getAllRawKeys } from "./apiKeys";
import { buildSystemPrompt } from "./botPrompt";
import { getTrainingForPrompt } from "./training";

const MODELS = [
  ...new Set(
    [
      process.env.GEMINI_MODEL,
      ...(process.env.GEMINI_FALLBACK_MODELS
        ? process.env.GEMINI_FALLBACK_MODELS.split(",")
        : ["gemini-3.6-flash", "gemini-3.5-flash", "gemini-3.5-flash-lite"]),
    ]
      .map((m) => (m || "").trim().replace(/^models\//, ""))
      .filter(Boolean)
  ),
];

async function callModel(systemPrompt, contents, keys, budgetMs = 40000) {
  const t0 = Date.now();
  for (const model of MODELS) {
    for (const k of keys) {
      const remaining = budgetMs - (Date.now() - t0);
      if (remaining < 3000) return "";
      for (const withThinking of [true, false]) {
        try {
          const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
            method: "POST",
            headers: { "Content-Type": "application/json", "x-goog-api-key": k.key || "" },
            body: JSON.stringify({
              systemInstruction: { parts: [{ text: systemPrompt }] },
              contents,
              generationConfig: {
                maxOutputTokens: 2048,
                temperature: 0.8,
                responseMimeType: "application/json",
                ...(withThinking ? { thinkingConfig: { thinkingLevel: "low" } } : {}),
              },
            }),
            signal: AbortSignal.timeout(Math.min(18000, remaining)),
          });
          if (!res.ok) {
            const data = await res.json().catch(() => ({}));
            // model không nhận thinkingConfig → thử lại không kèm; lỗi khác → đổi key/model
            if (res.status === 400 && withThinking && /think/i.test(data?.error?.message || "")) continue;
            break;
          }
          const data = await res.json();
          const out = data?.candidates?.[0]?.content?.parts?.map((p) => p.text || "").join("") || "";
          if (out.trim()) return out;
          break;
        } catch {
          break;
        }
      }
    }
  }
  return "";
}

function parseJson(raw) {
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

/**
 * history: [{ from: "customer" | "bot", text }] — kết thúc bằng tin của khách.
 * Trả về { messages: [...], note: "..." } hoặc { error }.
 */
export async function runPlayground({ history, productId }) {
  const products = await getProducts();
  const currentProduct = products.find((p) => String(p.id) === String(productId)) || (products.length === 1 ? products[0] : null);
  const settings = await getSettings();
  const trainingText = await getTrainingForPrompt(currentProduct?.id).catch(() => "");
  const systemPrompt = buildSystemPrompt(
    formatProductsForPrompt(products),
    settings.botPrompt,
    currentProduct,
    null,
    {},
    trainingText
  );

  // Gộp các tin liên tiếp cùng người, bắt đầu bằng khách, kết thúc bằng khách
  const contents = [];
  for (const m of history || []) {
    const text = String(m.text || "").trim();
    if (!text) continue;
    const role = m.from === "customer" ? "user" : "model";
    const last = contents[contents.length - 1];
    if (last && last.role === role) last.parts[0].text += "\n" + text;
    else contents.push({ role, parts: [{ text }] });
  }
  while (contents.length && contents[0].role !== "user") contents.shift();
  if (!contents.length || contents[contents.length - 1].role !== "user") {
    return { error: "Hãy gõ một tin nhắn với vai khách trước." };
  }

  const keys = await getAllRawKeys();
  if (!keys.length) return { error: "Chưa có API key Gemini. Thêm bằng nút 🔑 ở trang quản trị." };

  const raw = await callModel(systemPrompt, contents, keys);
  if (!raw) return { error: "AI không trả lời được (quá tải hoặc hết hạn mức). Thử gửi lại sau ít giây." };

  const parsed = parseJson(raw);
  let list = [];
  if (Array.isArray(parsed?.messages)) list = parsed.messages;
  else if (typeof parsed?.messages === "string") list = [parsed.messages];
  else if (typeof parsed?.reply === "string") list = [parsed.reply];
  else if (!parsed) list = [raw];
  const messages = list.map((m) => String(m || "").trim()).filter(Boolean).slice(0, 2);

  // Những việc bot thật sẽ làm thêm nhưng trang thử không gửi: ảnh, câu mở đầu quảng cáo
  const notes = [];
  if (parsed?.use_opening_product) {
    const p = products.find((x) => String(x.id) === String(parsed.use_opening_product));
    notes.push(`Bot thật sẽ gửi câu mở đầu quảng cáo + ảnh mẫu của "${p?.name || "sản phẩm"}" ở đây.`);
  }
  if (parsed?.send_images?.product_id) {
    const p = products.find((x) => String(x.id) === String(parsed.send_images.product_id));
    notes.push(`Bot thật sẽ gửi ảnh${p ? ` của "${p.name}"` : ""} (${parsed.send_images.type || "ảnh"}) kèm tin này.`);
  }
  if (!messages.length && !notes.length) return { error: "Bot trả về rỗng, thử gửi lại." };
  return { messages, note: notes.join(" ") };
}
