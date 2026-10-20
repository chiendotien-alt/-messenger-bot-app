// lib/groq.js — Groq làm AI DỰ PHÒNG khi Gemini lỗi / hết hạn mức.
// Groq dùng chuẩn OpenAI-compatible nên chỉ cần 1 hàm fetch, không cần cài thêm thư viện.
//
// Biến môi trường (đặt trên Vercel → Settings → Environment Variables):
//   GROQ_API_KEY        key lấy ở https://console.groq.com/keys (nhiều key thì ngăn cách bằng dấu phẩy)
//                       HOẶC dán key ngay trên trang quản trị (nút 🔑 → ô "Groq (dự phòng)") — không cần biến môi trường.
//   GROQ_MODELS         (không bắt buộc) model chữ, thử lần lượt. Mặc định: openai/gpt-oss-120b,openai/gpt-oss-20b
//   GROQ_VISION_MODELS  (không bắt buộc) model đọc được ảnh. Mặc định: trống (bỏ ảnh, trả lời bằng chữ)
// Groq đổi/xoá model khá thường xuyên → nếu log báo "model not found", vào console.groq.com/docs/models lấy tên mới rồi sửa biến trên.

const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";
const MAX_IMAGES = 5; // Groq cho tối đa 5 ảnh / request

const list = (v, def) =>
  String(v || def)
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

const textModels = () => list(process.env.GROQ_MODELS, "openai/gpt-oss-120b,openai/gpt-oss-20b");
const visionModels = () => list(process.env.GROQ_VISION_MODELS, "");

// Key Groq = biến môi trường + key thêm ở trang quản trị (lưu trong database). Cache 30s để không truy vấn DB mỗi tin nhắn.
let keyCache = { at: 0, keys: [] };
const envGroqKeys = () =>
  String(process.env.GROQ_API_KEY || "")
    .split(/[,\s]+/)
    .filter((k) => k.length > 10)
    .map((key, i) => ({ id: i === 0 ? "env" : `env${i}`, key }));

/** @returns {Promise<{id: string, key: string}[]>} */
export async function getGroqKeys() {
  if (Date.now() - keyCache.at < 30000) return keyCache.keys;
  let keys = envGroqKeys();
  try {
    const { getGroqRawKeys } = await import("./apiKeys");
    keys = await getGroqRawKeys();
  } catch {
    /* không đọc được DB → dùng key từ biến môi trường */
  }
  keyCache = { at: Date.now(), keys };
  return keys;
}

export async function hasGroq() {
  return (await getGroqKeys()).length > 0;
}

// "model::chỉ số key" → thời điểm được thử lại (bộ nhớ theo từng instance, đủ dùng)
const cooldown = new Map();
const isCooling = (k) => (cooldown.get(k) || 0) > Date.now();


// ---- Giữ request vừa hạn mức token/phút (TPM) của Groq (gói free: 8000) ----
// Ước lượng tiếng Việt ≈ 2.5 ký tự/token. Request = input + max_tokens nên phải trừ phần trả lời.
const GROQ_TPM_LIMIT = Number(process.env.GROQ_TPM_LIMIT) || 7500; // chừa dư so với 8000
const GROQ_MAX_OUTPUT = Number(process.env.GROQ_MAX_OUTPUT) || 1200;
const CHARS_PER_TOKEN = 2.5;
let budgetScale = 1; // tự thu nhỏ thêm nếu Groq vẫn báo 413 (học từ lỗi)

const msgSize = (m) =>
  typeof m.content === "string"
    ? m.content.length
    : (m.content || []).reduce((n, p) => n + (p.type === "text" ? (p.text || "").length : 3000), 0);

/** Bỏ tin cũ nhất (giữ system + tin mới nhất) cho tới khi vừa ngân sách ký tự. Nếu system quá dài thì cắt phần giữa. */
function fitMessages(messages, maxChars) {
  const out = messages.slice();
  let total = out.reduce((n, m) => n + msgSize(m), 0);
  while (total > maxChars && out.length > 2) {
    total -= msgSize(out[1]);
    out.splice(1, 1);
  }
  // vẫn quá dài (system prompt quá lớn) → cắt giữa system, giữ đầu và cuối
  if (total > maxChars && typeof out[0].content === "string") {
    const rest = total - out[0].content.length;
    const allow = Math.max(4000, maxChars - rest);
    const sys = out[0].content;
    if (sys.length > allow) {
      const head = Math.floor(allow * 0.6);
      const tail = allow - head;
      out[0] = { ...out[0], content: sys.slice(0, head) + "\n...\n" + sys.slice(sys.length - tail) };
    }
  }
  // tin đầu tiên sau system nên là của khách
  while (out.length > 2 && out[1].role === "assistant") out.splice(1, 1);
  return out;
}

/** Đổi `contents` kiểu Gemini sang `messages` kiểu OpenAI. */
export function toOpenAIMessages(system, contents, { withImages = false } = {}) {
  const messages = [{ role: "system", content: system || "" }];

  // Chỉ giữ MAX_IMAGES ảnh mới nhất
  let seen = 0;
  const totalImgs = withImages
    ? contents.reduce((n, c) => n + (c.parts || []).filter((p) => p.inlineData).length, 0)
    : 0;
  const skip = Math.max(0, totalImgs - MAX_IMAGES); // bỏ các ảnh cũ nhất

  for (const c of contents || []) {
    const role = c.role === "model" ? "assistant" : "user";
    const text = (c.parts || []).map((p) => p.text || "").filter(Boolean).join("\n");
    const images = [];
    if (withImages && role === "user") {
      for (const p of c.parts || []) {
        if (!p.inlineData) continue;
        seen++;
        if (seen <= skip) continue;
        images.push({
          type: "image_url",
          image_url: { url: `data:${p.inlineData.mimeType || "image/jpeg"};base64,${p.inlineData.data}` },
        });
      }
    }
    const content = images.length ? [{ type: "text", text: text || "(khách gửi ảnh)" }, ...images] : text;
    if (!content || (Array.isArray(content) ? false : !content.trim())) continue;

    // Gộp 2 tin liên tiếp cùng vai (chỉ khi cùng là chữ)
    const last = messages[messages.length - 1];
    if (last.role === role && typeof last.content === "string" && typeof content === "string") {
      last.content += "\n" + content;
    } else {
      messages.push({ role, content });
    }
  }
  return messages;
}

/**
 * Gọi Groq. Trả về { text, model } — text rỗng nếu tất cả đều lỗi.
 * @param {object} o
 * @param {string} o.system         system prompt
 * @param {Array}  o.contents       contents kiểu Gemini [{role:"user"|"model", parts:[{text}|{inlineData}]}]
 * @param {boolean} [o.json=true]   bắt model trả JSON
 * @param {number} [o.maxTokens=1024]
 * @param {number} [o.temperature=0.7]
 * @param {number} [o.deadline]     mốc thời gian (ms epoch) phải xong trước đó
 * @param {number} [o.timeoutMs=8000] tối đa cho mỗi lần gọi
 */
export async function callGroq({ system, contents, json = true, maxTokens = 1024, temperature = 0.7, deadline, timeoutMs = 8000 }) {
  const keys = await getGroqKeys();
  if (!keys.length) {
    console.warn("Groq: chưa có key nào (thêm ở nút 🔑 → Groq (dự phòng), hoặc biến GROQ_API_KEY).");
    return { text: "", model: null };
  }
  const end = deadline || Date.now() + 12000;

  // Groq bắt buộc có chữ "JSON" trong prompt khi bật JSON mode
  const sys = json && !/json/i.test(system || "") ? `${system || ""}\n\nChỉ trả lời bằng một đối tượng JSON hợp lệ.` : system || "";

  const hasImages = (contents || []).some((c) => (c.parts || []).some((p) => p.inlineData));
  const plans = [];
  if (hasImages) for (const m of visionModels()) plans.push({ model: m, images: true });
  for (const m of textModels()) plans.push({ model: m, images: false }); // ảnh lỗi → trả lời bằng chữ, bỏ ảnh

  const skipped = []; // model/key đang "nghỉ" do lỗi trước đó → ghi log để dễ chẩn đoán
  for (const plan of plans) {
    const outTokens = Math.min(Math.max(Number(maxTokens) || 1024, 800), GROQ_MAX_OUTPUT);
    const inputChars = Math.max(6000, (GROQ_TPM_LIMIT - outTokens) * CHARS_PER_TOKEN * budgetScale);
    const messages = fitMessages(toOpenAIMessages(sys, contents, { withImages: plan.images }), inputChars);
    if (messages.length < 2) continue;

    for (const keyObj of keys) {
      const ck = `${plan.model}::${keyObj.id}`;
      if (isCooling(ck)) {
        skipped.push(plan.model);
        continue;
      }
      const remaining = end - Date.now();
      if (remaining < 1200) {
        console.warn("Groq: hết thời gian chờ trước khi gọi được.");
        return { text: "", model: null };
      }

      const isReasoning = /gpt-oss|qwen3|deepseek-r1/i.test(plan.model);
      let useReasoningParam = isReasoning;
      for (const useJsonMode of json ? [true, false] : [false]) {
        let res;
        try {
          res = await fetch(GROQ_URL, {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${keyObj.key}` },
            body: JSON.stringify({
              model: plan.model,
              messages,
              temperature,
              // gpt-oss là model suy luận: token suy luận tính chung vào max_tokens → chừa dư để không bị cụt câu trả lời
              max_tokens: outTokens,
              ...(isReasoning && useReasoningParam ? { reasoning_effort: "low" } : {}),
              ...(useJsonMode ? { response_format: { type: "json_object" } } : {}),
            }),
            signal: AbortSignal.timeout(Math.min(timeoutMs, Math.max(1000, end - Date.now()))),
          });
        } catch (e) {
          console.error(`Groq ${plan.model} timeout/lỗi mạng:`, e.message);
          cooldown.set(ck, Date.now() + 15 * 1000);
          break; // sang key/model khác
        }

        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          const err = data.error || {};
          console.error(`Lỗi Groq [${plan.model}] HTTP ${res.status}:`, JSON.stringify(err).slice(0, 300));
          if (res.status === 400 && useReasoningParam && /reasoning/i.test(err.message || "")) {
            useReasoningParam = false; // model không nhận reasoning_effort → thử lại không kèm
            continue;
          }
          if (res.status === 400 && useJsonMode && /json/i.test(err.message || err.code || "")) continue; // thử lại không bật JSON mode
          if (res.status === 413) {
            const m = String(err.message || "").match(/Limit\s+(\d+).*?Requested\s+(\d+)/i);
            if (m) budgetScale = Math.max(0.3, Math.min(budgetScale, (Number(m[1]) / Number(m[2])) * 0.85));
            cooldown.set(ck, Date.now() + 2 * 1000);
          } else if (res.status === 429) {
            const ra = Number(res.headers.get("retry-after")) || 60;
            cooldown.set(ck, Date.now() + Math.min(ra, 300) * 1000);
          } else if (res.status === 401 || res.status === 403) {
            cooldown.set(ck, Date.now() + 30 * 60 * 1000);
          } else if (res.status === 404 || /decommission|not found|does not exist/i.test(err.message || "")) {
            for (const k of keys) cooldown.set(`${plan.model}::${k.id}`, Date.now() + 5 * 60 * 1000);
          } else {
            cooldown.set(ck, Date.now() + 10 * 1000);
          }
          break; // key/model khác
        }

        const text = data?.choices?.[0]?.message?.content || "";
        if (text.trim()) return { text, model: `groq:${plan.model}` };
        break;
      }
    }
  }
  console.warn(
    `Groq: không có model nào trả lời được (model: ${plans.map((p) => p.model).join(", ") || "không có"}` +
      (skipped.length ? `; đang tạm nghỉ do lỗi trước đó: ${[...new Set(skipped)].join(", ")} — xem các dòng "Lỗi Groq" ở trên` : "") +
      `). Kiểm tra tên model ở console.groq.com/docs/models và biến GROQ_MODELS.`
  );
  return { text: "", model: null };
}
