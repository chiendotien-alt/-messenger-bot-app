// lib/gemini.js — MỘT nơi duy nhất gọi Gemini cho cả bot (chat, câu bồi, tạo đơn, phân loại, dạy bot).
// Thử lần lượt từng model × từng API key, nhớ cặp nào vừa lỗi để lần sau bỏ qua (không gọi vô ích):
//  - 429 (hết quota)      → nghỉ key đó (hết quota NGÀY thì nghỉ 30 phút, hết quota PHÚT thì nghỉ theo thời gian Google báo, mặc định 60s)
//  - 503 (model quá tải)  → nghỉ cả model 45s, sang model kế tiếp ngay
//  - 404 (model không có) → bỏ hẳn model đó 30 phút
//  - 401/403 (key sai)    → bỏ hẳn key đó 30 phút
//  - 400 do thinkingConfig → gọi lại không kèm thinkingConfig
//  - Gemini hỏng hết      → Groq dự phòng (nếu có key Groq)
// Lưu ý: bộ nhớ "nghỉ" nằm trong từng máy chủ Vercel đang chạy, nên mỗi máy tự học riêng.
import { callGroq, hasGroq } from "./groq";

// Free tier: 3.6-flash chỉ ~20 request/ngày → hết thì tự rơi xuống 3.5-flash, rồi 3.5-flash-lite.
// Đổi bằng biến môi trường GEMINI_MODEL / GEMINI_FALLBACK_MODELS="model-a,model-b" (không bắt buộc).
const DEFAULT_MODEL_CHAIN = ["gemini-3.6-flash", "gemini-3.5-flash", "gemini-3.5-flash-lite"];
export const MODEL_CHAIN = [
  ...new Set(
    [
      process.env.GEMINI_MODEL,
      ...(process.env.GEMINI_FALLBACK_MODELS ? process.env.GEMINI_FALLBACK_MODELS.split(",") : DEFAULT_MODEL_CHAIN),
    ]
      .map((m) => (m || "").trim().replace(/^models\//, ""))
      .filter(Boolean)
  ),
];
// Mặc định: gặp 429 thì thử tiếp key khác (key thuộc project khác nhau có quota riêng). GEMINI_429_TRY_ALL_KEYS=0 → dừng cả model khi 429.
const TRY_ALL_KEYS_ON_429 = process.env.GEMINI_429_TRY_ALL_KEYS !== "0";
// Timeout → thử thêm tối đa N key khác của cùng model (mặc định 2) rồi mới nhảy sang model kế tiếp / Groq. Đặt 1 để về như cũ.
const MAX_TIMEOUT_KEYS = Math.max(1, Number(process.env.GEMINI_TIMEOUT_MAX_KEYS) || 2);
const GEMINI_TIMEOUT_MS = Number(process.env.GEMINI_TIMEOUT_MS) || 10000; // mỗi lần gọi chờ tối đa 10s rồi chuyển model/key khác

const modelDown = new Map(); // model → thời điểm được thử lại (model quá tải 503 với MỌI key)
const modelCooldown = new Map(); // `${model}::${keyId}` → thời điểm được thử lại

/** Nghỉ bao lâu sau lỗi 429: hết quota ngày → 30 phút; Google báo retryDelay → theo đó; không có thì 60 giây. */
function cooldownFor429(err) {
  const s = JSON.stringify(err || {});
  if (/PerDay/i.test(s)) return 30 * 60 * 1000;
  const m = s.match(/"retryDelay"\s*:\s*"(\d+(?:\.\d+)?)s"/);
  if (m) return Math.min(5 * 60 * 1000, Math.max(5000, Math.ceil(Number(m[1]) * 1000) + 1000));
  return 60 * 1000;
}

/**
 * Gọi Gemini (KHÔNG có Groq). Trả { text, model }; text rỗng nếu mọi model + key đều lỗi.
 * opts: models (danh sách model riêng), maxKeys (chỉ dùng N key đầu), timeoutMs (mỗi lần gọi), minRemainingMs (còn ít hơn thì dừng, mặc định 3000)
 */
export async function callGeminiOnly(systemPrompt, contents, generationConfig, deadline, apiKeys, opts = {}) {
  const allKeys = apiKeys && apiKeys.length ? apiKeys : [{ id: "__none__", key: "" }];
  const keys = opts.maxKeys ? allKeys.slice(0, opts.maxKeys) : allKeys;
  const models = opts.models && opts.models.length ? opts.models : MODEL_CHAIN;
  const lastModel = models[models.length - 1];
  const perCallMs = opts.timeoutMs || GEMINI_TIMEOUT_MS;
  const minRemaining = opts.minRemainingMs ?? 3000;

  for (const model of models) {
    // Model vừa báo quá tải (503) → nhảy thẳng sang model kế tiếp; riêng model cuối luôn được thử
    if ((modelDown.get(model) || 0) > Date.now() && model !== lastModel) continue;

    let config = generationConfig;
    let stripped = false;

    const now = Date.now();
    let keyChain = keys.filter((k) => (modelCooldown.get(`${model}::${k.id}`) || 0) <= now);
    if (!keyChain.length) {
      // Mọi key đang "nghỉ" với model này: bỏ qua model, sang model kế tiếp (đỡ gọi vô ích); riêng model cuối thì thử lại hết
      if (model !== lastModel) continue;
      keyChain = keys;
    }

    let timeouts = 0; // số lần timeout liên tiếp của model này
    for (const keyObj of keyChain) {
      const cooldownKey = `${model}::${keyObj.id}`;
      const remaining = deadline - Date.now();
      if (remaining < minRemaining) {
        console.warn("Hết thời gian dành cho AI, dừng thử.");
        return { text: "", model: null };
      }

      let res;
      try {
        res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-goog-api-key": keyObj.key || "" },
          body: JSON.stringify({
            ...(systemPrompt ? { systemInstruction: { parts: [{ text: systemPrompt }] } } : {}),
            contents,
            generationConfig: config,
          }),
          signal: AbortSignal.timeout(Math.min(perCallMs, remaining)),
        });
      } catch (e) {
        console.error(`Gemini ${model} (key ${keyObj.id}) timeout/lỗi mạng:`, e.message);
        // Timeout: thử thêm key khác (tối đa MAX_TIMEOUT_KEYS key/model); hết lượt hoặc hết key thì cho model nghỉ 30s, sang model kế tiếp
        modelCooldown.set(cooldownKey, Date.now() + 20 * 1000);
        timeouts++;
        const isLastKey = keyChain.indexOf(keyObj) === keyChain.length - 1;
        if (timeouts >= MAX_TIMEOUT_KEYS || isLastKey) {
          modelDown.set(model, Date.now() + 30 * 1000);
          break;
        }
        continue;
      }

      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        const err = data.error || {};
        console.error(`Lỗi Gemini API [${model}] (key ${keyObj.id}) HTTP ${res.status}:`, JSON.stringify(err));

        if (res.status === 401 || res.status === 403) {
          modelCooldown.set(cooldownKey, Date.now() + 30 * 60 * 1000); // key sai/bị khoá — nghỉ lâu
          continue;
        }
        if (res.status === 400 && config?.thinkingConfig && !stripped && /think/i.test(err.message || "")) {
          const { thinkingConfig, ...rest } = config; // model này không nhận thinkingConfig
          config = rest;
          stripped = true;
          continue; // thử lại đúng key này với cấu hình mới, không tính là lỗi
        }
        if (res.status === 404) {
          for (const k of keys) modelCooldown.set(`${model}::${k.id}`, Date.now() + 30 * 60 * 1000);
          break; // tên model sai/đã tắt — nghỉ hẳn model này
        }
        if (res.status === 429) {
          // Hạn mức tính theo PROJECT: key cùng project dùng chung quota, key khác project có quota riêng.
          const wait = cooldownFor429(err);
          modelCooldown.set(cooldownKey, Date.now() + wait);
          if (TRY_ALL_KEYS_ON_429) continue;
          for (const k of keys) modelCooldown.set(`${model}::${k.id}`, Date.now() + wait);
          break;
        }
        if (res.status === 503) {
          // "Model đang quá tải" là lỗi của CẢ model (đổi key không giúp) → nghỉ model 45s, sang model kế tiếp ngay
          modelDown.set(model, Date.now() + 45 * 1000);
          break;
        }
        if (res.status >= 500) {
          modelCooldown.set(cooldownKey, Date.now() + 15 * 1000);
          continue;
        }
        continue; // 400 khác → thử key khác của model này
      }

      const cand = data.candidates?.[0];
      const text = cand?.content?.parts?.map((p) => p.text || "").join("") || "";
      if (text.trim()) return { text, model };

      console.warn(
        `Gemini ${model} (key ${keyObj.id}) không trả nội dung. finishReason=${cand?.finishReason} promptFeedback=${JSON.stringify(data.promptFeedback || null)}`
      );
      break; // rỗng → thử model kế tiếp (không phải lỗi key)
    }
  }
  return { text: "", model: null };
}

/**
 * Gemini trước; hỏng hết → Groq dự phòng (nếu có). Trả { text, model }.
 * opts (ngoài các opts của callGeminiOnly): groqReserveMs (chừa cho Groq, mặc định 4000), groqSystem (system riêng cho Groq),
 * groqMinMs (Groq được ít nhất ngần này ms, mặc định 3500), groqTimeoutMs (mặc định 9000)
 */
export async function callGemini(systemPrompt, contents, generationConfig, deadline, apiKeys, opts = {}) {
  const groqOn = await hasGroq();
  const r = await callGeminiOnly(systemPrompt, contents, generationConfig, groqOn ? deadline - (opts.groqReserveMs ?? 4000) : deadline, apiKeys, opts);
  if ((r.text || "").trim() || !groqOn) return r;

  console.warn("Gemini không trả lời được → thử Groq dự phòng.");
  const g = await callGroq({
    system: opts.groqSystem ?? systemPrompt,
    contents,
    json: generationConfig?.responseMimeType === "application/json",
    maxTokens: generationConfig?.maxOutputTokens || 2048,
    temperature: generationConfig?.temperature ?? 0.8,
    deadline: Math.max(deadline, Date.now() + (opts.groqMinMs ?? 3500)),
    timeoutMs: opts.groqTimeoutMs ?? 9000,
  });
  return g.text ? { text: g.text, model: g.model } : { text: "", model: null };
}

/** Gọi nhanh trả JSON dạng chữ (dùng cho câu bồi...). Giữ tên cũ để nơi gọi không phải sửa. */
export async function askGeminiJson({ system, text, keys, budgetMs = 15000 }) {
  const r = await callGemini(
    system,
    [{ role: "user", parts: [{ text }] }],
    { temperature: 0.9, maxOutputTokens: 1024, responseMimeType: "application/json", thinkingConfig: { thinkingLevel: "low" } },
    Date.now() + budgetMs,
    keys,
    { timeoutMs: 9000, groqReserveMs: 4500, groqTimeoutMs: 8000 }
  );
  return r.text || "";
}
