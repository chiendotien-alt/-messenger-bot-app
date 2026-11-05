// lib/claude.js — Claude (Anthropic) làm AI DỰ PHÒNG Ở GIỮA: Gemini hỏng hết → Claude → Groq.
// Claude là API TRẢ PHÍ (tính theo token) nên chỉ được gọi khi Gemini đã thất bại, không bao giờ gọi trước.
//
// Biến môi trường (đặt trên Vercel → Settings → Environment Variables):
//   ANTHROPIC_API_KEY   key lấy ở https://console.anthropic.com/settings/keys (bắt đầu bằng sk-ant-; nhiều key thì ngăn cách bằng dấu phẩy)
//                       HOẶC dán key ngay trên trang quản trị (nút 🔑 → ô "Claude (dự phòng)") — không cần biến môi trường.
//   CLAUDE_MODELS       (không bắt buộc) model thử lần lượt. Mặc định: claude-haiku-5-5,claude-sonnet-5-5
//   CLAUDE_ENABLED=0    (không bắt buộc) tắt hẳn bước Claude (không xoá key) — bot đi thẳng Gemini → Groq như cũ
//   CLAUDE_EFFORT       (không bắt buộc) mức suy nghĩ: low (mặc định, nhanh/rẻ) | medium | high | xhigh | max; để rỗng = mặc định của Anthropic
//   CLAUDE_TIMEOUT_MS   (không bắt buộc) mỗi lần gọi chờ tối đa (mặc định 15000)
//   CLAUDE_MAX_IMAGES   (không bắt buộc) số ảnh mới nhất gửi kèm (mặc định 4; ảnh càng nhiều càng tốn tiền)
// Không cần cài thêm thư viện: gọi thẳng REST bằng fetch.

const CLAUDE_URL = "https://api.anthropic.com/v1/messages";
const API_VERSION = "2023-06-01";
const IMG_TYPES = new Set(["image/jpeg", "image/png", "image/gif", "image/webp"]);

const list = (v, def) =>
  String(v || def)
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

const textModels = () => list(process.env.CLAUDE_MODELS, "claude-haiku-5-5,claude-sonnet-5-5");
const enabled = () => process.env.CLAUDE_ENABLED !== "0";
const maxImages = () => {
  const n = Number(process.env.CLAUDE_MAX_IMAGES);
  return Number.isFinite(n) && n >= 0 ? n : 4;
};

// Mức "suy nghĩ" của Claude: low (nhanh/rẻ, mặc định) | medium | high | xhigh | max. Rỗng = dùng mặc định của Anthropic (medium với Haiku).
// Haiku/Sonnet 5.5 mặc định BẬT suy nghĩ ngầm: token suy nghĩ vẫn tính tiền như token ra và tính vào max_tokens, nên hạ xuống "low" để trả lời nhanh hơn, ít bị cắt JSON.
const EFFORTS = new Set(["low", "medium", "high", "xhigh", "max"]);
let effortOffUntil = 0; // nếu Anthropic từ chối tham số effort → tạm bỏ qua 30 phút để khỏi lỗi lặp lại
const effortValue = () => {
  if (Date.now() < effortOffUntil) return null;
  const v = String(process.env.CLAUDE_EFFORT ?? "low").trim().toLowerCase();
  return EFFORTS.has(v) ? v : null;
};

// Key Claude = biến môi trường + key thêm ở trang quản trị (database). Cache 30s để không truy vấn DB mỗi tin nhắn.
let keyCache = { at: 0, keys: [] };
const envClaudeKeys = () =>
  String(process.env.ANTHROPIC_API_KEY || "")
    .split(/[,\s]+/)
    .filter((k) => k.length > 10)
    .map((key, i) => ({ id: i === 0 ? "env" : `env${i}`, key }));

/** @returns {Promise<{id: string, key: string}[]>} */
export async function getClaudeKeys() {
  if (!enabled()) return [];
  if (Date.now() - keyCache.at < 30000) return keyCache.keys;
  let keys = envClaudeKeys();
  try {
    const { getClaudeRawKeys } = await import("./apiKeys");
    keys = await getClaudeRawKeys();
  } catch {
    /* không đọc được DB → dùng key từ biến môi trường */
  }
  keyCache = { at: Date.now(), keys };
  return keys;
}

export async function hasClaude() {
  return (await getClaudeKeys()).length > 0;
}

// "kiểu::model::key" → thời điểm được thử lại (bộ nhớ theo từng instance)
const cooldown = new Map();
const isCooling = (k) => (cooldown.get(k) || 0) > Date.now();
const rest = (k, ms) => cooldown.set(k, Date.now() + ms);
/** Xoá trí nhớ "đang nghỉ" (dùng trong test). */
export const resetClaudeCooldowns = () => {
  cooldown.clear();
  effortOffUntil = 0;
};

/**
 * Đổi `contents` kiểu Gemini sang `messages` kiểu Anthropic.
 * Claude đòi: tin đầu là của khách, vai xen kẽ, không có khối chữ rỗng, tin cuối là của khách.
 */
export function toClaudeMessages(contents, { withImages = true } = {}) {
  const limit = withImages ? maxImages() : 0;
  const totalImgs = (contents || []).reduce((n, c) => n + (c.parts || []).filter((p) => p.inlineData).length, 0);
  const skip = Math.max(0, totalImgs - limit); // bỏ các ảnh cũ nhất
  let seen = 0;

  const out = [];
  for (const c of contents || []) {
    const role = c.role === "model" ? "assistant" : "user";
    const text = (c.parts || []).map((p) => p.text || "").filter(Boolean).join("\n").trim();
    const blocks = [];
    if (role === "user") {
      for (const p of c.parts || []) {
        if (!p.inlineData) continue;
        seen++;
        if (seen <= skip) continue;
        const mt = IMG_TYPES.has(p.inlineData.mimeType) ? p.inlineData.mimeType : "image/jpeg";
        blocks.push({ type: "image", source: { type: "base64", media_type: mt, data: p.inlineData.data } });
      }
    }
    if (text) blocks.push({ type: "text", text });
    else if (blocks.length) blocks.push({ type: "text", text: "(khách gửi ảnh)" });
    if (!blocks.length) continue;

    const last = out[out.length - 1];
    if (last && last.role === role) last.content.push(...blocks); // gộp 2 tin liên tiếp cùng vai
    else out.push({ role, content: blocks });
  }
  while (out.length && out[0].role === "assistant") out.shift();
  if (out.length && out[out.length - 1].role === "assistant") out.push({ role: "user", content: [{ type: "text", text: "(hãy trả lời tiếp)" }] });
  return out;
}

// Báo Telegram nhưng chỉ chờ tối đa 2.5s — không để việc báo lỗi làm khách chờ lâu hơn
async function alertOnce(code, title, fields, gapMs) {
  try {
    const { reportError } = await import("./alert");
    await Promise.race([reportError(code, title, fields, { gapMs }), new Promise((r) => setTimeout(r, 2500))]);
  } catch {
    /* không báo được cũng không sao */
  }
}

/**
 * Gọi Claude. Trả { text, model, errors } — text rỗng nếu mọi model/key đều lỗi. Không bao giờ throw.
 * @param {object} o
 * @param {string} o.system       system prompt
 * @param {Array}  o.contents     contents kiểu Gemini [{role:"user"|"model", parts:[{text}|{inlineData}]}]
 * @param {boolean} [o.json=true] nhắc model chỉ trả JSON (Claude không có "JSON mode", nên nhắc bằng lời)
 * @param {number} [o.maxTokens=2048]
 * @param {number} [o.temperature]  (KHÔNG gửi cho Claude: model Claude mới báo lỗi 400 "temperature is deprecated"; giữ tham số để các nơi gọi không phải sửa)
 * @param {number} [o.deadline]   mốc thời gian (ms epoch) phải xong trước đó
 * @param {number} [o.timeoutMs]  tối đa cho mỗi lần gọi
 */
export async function callClaude({ system, contents, json = true, maxTokens = 2048, temperature = 0.8, deadline, timeoutMs }) {
  const errors = [];
  const keys = await getClaudeKeys();
  if (!keys.length) return { text: "", model: null, errors };

  const perCall = timeoutMs || Number(process.env.CLAUDE_TIMEOUT_MS) || 15000;
  const end = deadline || Date.now() + perCall;
  const sys = json
    ? `${system || ""}\n\nQUAN TRỌNG: chỉ trả lời bằng MỘT đối tượng JSON hợp lệ, không kèm chữ nào khác ngoài JSON và không bọc trong \`\`\`.`.trim()
    : system || "";
  const messages = toClaudeMessages(contents);
  if (!messages.length) return { text: "", model: null, errors: ["Claude: không có nội dung để gửi"] };

  for (const model of textModels()) {
    for (const keyObj of keys) {
      const ck = `c::${model}::${keyObj.id}`;
      if (isCooling(ck) || isCooling(`m::${model}`) || isCooling(`k::${keyObj.id}`)) continue;
      const remaining = end - Date.now();
      if (remaining < 1500) {
        console.warn("Claude: hết thời gian chờ trước khi gọi được.");
        return { text: "", model: null, errors };
      }

      const send = (withEffort) =>
        fetch(CLAUDE_URL, {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-api-key": keyObj.key, "anthropic-version": API_VERSION },
          body: JSON.stringify({
            model,
            max_tokens: Math.max(1024, Number(maxTokens) || 2048), // token suy nghĩ cũng tính vào đây
            ...(withEffort ? { output_config: { effort: withEffort } } : {}),
            ...(sys ? { system: sys } : {}),
            messages,
          }),
          signal: AbortSignal.timeout(Math.min(perCall, Math.max(1000, end - Date.now()))),
        });

      let res;
      let data;
      try {
        const effort = effortValue();
        res = await send(effort);
        data = await res.json().catch(() => ({}));
        // Anthropic không nhận tham số effort → bỏ nó đi và gọi lại ngay (khách không bị mất câu trả lời)
        if (!res.ok && effort && res.status === 400 && /effort|output_config/i.test(String(data?.error?.message || ""))) {
          console.warn("Claude từ chối tham số effort → tạm bỏ qua 30 phút và gọi lại không có effort:", data.error.message);
          effortOffUntil = Date.now() + 30 * 60 * 1000;
          res = await send(null);
          data = await res.json().catch(() => ({}));
        }
      } catch (e) {
        console.error(`Claude ${model} (key ${keyObj.id}) timeout/lỗi mạng:`, e.message);
        errors.push(`Claude ${model} (key ${keyObj.id}): timeout/lỗi mạng`);
        rest(ck, 15 * 1000);
        continue;
      }

      if (!res.ok) {
        const err = data.error || {};
        const msg = String(err.message || "");
        console.error(`Lỗi Claude [${model}] (key ${keyObj.id}) HTTP ${res.status}:`, JSON.stringify(err).slice(0, 300));
        errors.push(`Claude ${model} (key ${keyObj.id}): HTTP ${res.status} ${msg.slice(0, 160)}`);

        if (res.status === 402 || /credit balance|billing/i.test(msg)) {
          // Hết tiền trong tài khoản Anthropic → báo chủ shop nạp thêm (mỗi 6 giờ 1 lần)
          rest(`k::${keyObj.id}`, 10 * 60 * 1000);
          await alertOnce(
            `claude_no_credit_${keyObj.id}`,
            "Tài khoản Claude API HẾT TIỀN — bot đang bỏ qua Claude",
            { Key: keyObj.id === "env" ? "ANTHROPIC_API_KEY (biến môi trường)" : `key thêm ở trang quản trị, id ${keyObj.id}`, "Cách xử lý": "Vào console.anthropic.com → Plans & Billing → nạp thêm tiền." },
            6 * 60 * 60 * 1000
          );
        } else if (res.status === 401 || res.status === 403) {
          rest(`k::${keyObj.id}`, 30 * 60 * 1000);
          await alertOnce(
            `claude_key_bad_${keyObj.id}`,
            "Key Claude bị từ chối (sai hoặc bị khoá)",
            { Key: keyObj.id === "env" ? "ANTHROPIC_API_KEY (biến môi trường)" : `key thêm ở trang quản trị, id ${keyObj.id}`, "Anthropic báo": `HTTP ${res.status} ${msg.slice(0, 200)}`, "Cách xử lý": "Vào trang quản trị → nút 🔑 → kiểm tra/đổi key Claude." },
            6 * 60 * 60 * 1000
          );
        } else if (res.status === 404) {
          rest(`m::${model}`, 30 * 60 * 1000); // tên model sai/đã tắt
        } else if (res.status === 429) {
          const ra = Number(res.headers?.get?.("retry-after")) || 30;
          rest(ck, Math.min(ra, 300) * 1000);
        } else if (res.status === 529 || res.status >= 500) {
          rest(`m::${model}`, 20 * 1000); // quá tải phía Anthropic → thử model kế
        } else {
          rest(ck, 10 * 1000); // 400 khác (request lỗi...) → thử model/key khác
        }
        continue;
      }

      const text = (data.content || [])
        .filter((b) => b?.type === "text")
        .map((b) => b.text || "")
        .join("");
      if (text.trim()) {
        const u = data.usage;
        console.log(`Claude OK [${model}] (key ${keyObj.id})` + (u ? ` | token vào ${u.input_tokens ?? "?"}, ra ${u.output_tokens ?? "?"}` : ""));
        return { text, model: `claude:${model}`, errors };
      }
      console.warn(`Claude ${model} (key ${keyObj.id}) không trả nội dung. stop_reason=${data.stop_reason}`);
      errors.push(`Claude ${model} (key ${keyObj.id}): trả rỗng (stop_reason=${data.stop_reason})`);
    }
  }
  console.warn(`Claude: không có model nào trả lời được (model: ${textModels().join(", ")}).`);
  return { text: "", model: null, errors };
}
