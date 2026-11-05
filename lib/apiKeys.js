// lib/apiKeys.js — quản lý nhiều API key Gemini (biến môi trường + key thêm từ trang quản trị) trong Neon Postgres
import { getSql } from "./db";

let tableReady = null;
async function ensureTable() {
  if (!tableReady) {
    tableReady = (async () => {
      const sql = await getSql();
      await sql`CREATE TABLE IF NOT EXISTS api_keys (
        id BIGSERIAL PRIMARY KEY,
        label TEXT,
        key TEXT NOT NULL UNIQUE,
        created_at TIMESTAMPTZ DEFAULT now()
      )`;
      // Cột provider: 'gemini' (mặc định, key cũ giữ nguyên), 'claude' (dự phòng trả phí) hoặc 'groq' (dự phòng miễn phí)
      await sql`ALTER TABLE api_keys ADD COLUMN IF NOT EXISTS provider TEXT NOT NULL DEFAULT 'gemini'`;
      return sql;
    })().catch((e) => {
      tableReady = null;
      throw e;
    });
  }
  return tableReady;
}

const mask = (k) => (k.length <= 10 ? "••••" : `${k.slice(0, 4)}••••${k.slice(-4)}`);

/** Danh sách key đầy đủ cho webhook dùng: [{ id, key }]. Không bao giờ trả ra ngoài trình duyệt. */
export async function getAllRawKeys() {
  const keys = [];
  const envKey = process.env.GOOGLE_API_KEY;
  if (envKey) keys.push({ id: "env", key: envKey });
  try {
    const sql = await ensureTable();
    const rows = await sql`SELECT id, key FROM api_keys WHERE provider = 'gemini' ORDER BY id`;
    for (const r of rows) {
      if (r.key !== envKey) keys.push({ id: String(r.id), key: r.key });
    }
  } catch (e) {
    console.error("Không đọc được API key từ database:", e.message);
  }
  return keys;
}

/** Key Groq (dự phòng): biến môi trường GROQ_API_KEY + key thêm từ trang quản trị. [{ id, key }] */
export async function getGroqRawKeys() {
  const keys = [];
  const envKeys = String(process.env.GROQ_API_KEY || "").split(/[,\s]+/).filter((k) => k.length > 10);
  envKeys.forEach((k, i) => keys.push({ id: i === 0 ? "env" : `env${i}`, key: k }));
  try {
    const sql = await ensureTable();
    const rows = await sql`SELECT id, key FROM api_keys WHERE provider = 'groq' ORDER BY id`;
    for (const r of rows) {
      if (!envKeys.includes(r.key)) keys.push({ id: String(r.id), key: r.key });
    }
  } catch (e) {
    console.error("Không đọc được key Groq từ database:", e.message);
  }
  return keys;
}

/** Key Claude (dự phòng trả phí): biến môi trường ANTHROPIC_API_KEY + key thêm từ trang quản trị. [{ id, key }] */
export async function getClaudeRawKeys() {
  const keys = [];
  const envKeys = String(process.env.ANTHROPIC_API_KEY || "").split(/[,\s]+/).filter((k) => k.length > 10);
  envKeys.forEach((k, i) => keys.push({ id: i === 0 ? "env" : `env${i}`, key: k }));
  try {
    const sql = await ensureTable();
    const rows = await sql`SELECT id, key FROM api_keys WHERE provider = 'claude' ORDER BY id`;
    for (const r of rows) {
      if (!envKeys.includes(r.key)) keys.push({ id: String(r.id), key: r.key });
    }
  } catch (e) {
    console.error("Không đọc được key Claude từ database:", e.message);
  }
  return keys;
}

const normProvider = (p) => (p === "groq" ? "groq" : p === "claude" ? "claude" : "gemini");

/** Danh sách key đã che bớt để hiện trên trang quản trị. provider: "gemini" (mặc định) | "claude" | "groq" */
export async function listKeys(provider = "gemini") {
  provider = normProvider(provider);
  const out = [];
  const fromEnv = (value, label) =>
    String(value || "")
      .split(/[,\s]+/)
      .filter((k) => k.length > 10)
      .forEach((k, i) => out.push({ id: i === 0 ? "env" : `env${i}`, label, masked: mask(k), removable: false, provider }));
  if (provider === "groq") fromEnv(process.env.GROQ_API_KEY, "Biến môi trường GROQ_API_KEY");
  else if (provider === "claude") fromEnv(process.env.ANTHROPIC_API_KEY, "Biến môi trường ANTHROPIC_API_KEY");
  else if (process.env.GOOGLE_API_KEY) {
    out.push({ id: "env", label: "Biến môi trường GOOGLE_API_KEY", masked: mask(process.env.GOOGLE_API_KEY), removable: false, provider });
  }
  const sql = await ensureTable();
  const rows = await sql`SELECT id, label, key FROM api_keys WHERE provider = ${provider} ORDER BY id`;
  for (const r of rows) {
    out.push({ id: String(r.id), label: r.label || "", masked: mask(r.key), removable: true, provider });
  }
  return out;
}

export async function addKey(key, label = "", provider = "gemini") {
  const clean = String(key || "").trim();
  provider = normProvider(provider);
  if (clean.length < 20) throw new Error("API key không hợp lệ");
  const isGroqKey = clean.startsWith("gsk_");
  const isClaudeKey = clean.startsWith("sk-ant-");
  if (provider === "groq" && !isGroqKey) throw new Error("Key Groq phải bắt đầu bằng gsk_ (lấy ở console.groq.com/keys)");
  if (provider === "claude" && !isClaudeKey) throw new Error("Key Claude phải bắt đầu bằng sk-ant- (lấy ở console.anthropic.com/settings/keys)");
  if (provider === "gemini" && isGroqKey) throw new Error("Đây là key Groq — hãy dán vào ô \"Groq (dự phòng)\" bên dưới.");
  if (provider === "gemini" && isClaudeKey) throw new Error("Đây là key Claude — hãy dán vào ô \"Claude (dự phòng)\" bên dưới.");
  const sql = await ensureTable();
  await sql`INSERT INTO api_keys (label, key, provider) VALUES (${String(label || "").trim()}, ${clean}, ${provider})
            ON CONFLICT (key) DO NOTHING`;
}

export async function deleteKey(id) {
  const sql = await ensureTable();
  await sql`DELETE FROM api_keys WHERE id = ${Number(id)}`;
}

/**
 * Kiểm tra 1 key Gemini còn dùng được không.
 * Gemini không có endpoint "xem hạn mức còn lại", nên:
 *  1) GET /models        → xác nhận key hợp lệ (không tốn quota)
 *  2) generateContent 1 token → nếu 429 tức là đã hết hạn mức (phút/ngày)
 * Trả về { status: "ok" | "quota" | "invalid" | "error", message, retryAfterSec?, httpStatus?, ms }
 */
const CHECK_MODEL = "gemini-3.5-flash-lite";

export async function checkKeyStatus(rawKey) {
  const t0 = Date.now();
  const done = (o) => ({ ...o, ms: Date.now() - t0, checkedAt: new Date().toISOString() });
  const headers = { "Content-Type": "application/json", "x-goog-api-key": rawKey };

  try {
    // Bước 1: key có hợp lệ không
    const list = await fetch("https://generativelanguage.googleapis.com/v1beta/models?pageSize=1", {
      headers,
      signal: AbortSignal.timeout(8000),
    });
    if (list.status === 400 || list.status === 401 || list.status === 403) {
      const d = await list.json().catch(() => ({}));
      return done({ status: "invalid", httpStatus: list.status, message: d?.error?.message || "Key sai hoặc bị khóa" });
    }

    // Bước 2: thử gọi thật với 1 token để biết còn quota không
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${CHECK_MODEL}:generateContent`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: "hi" }] }],
        generationConfig: { maxOutputTokens: 1, temperature: 0 },
      }),
      signal: AbortSignal.timeout(10000),
    });
    const data = await res.json().catch(() => ({}));

    if (res.ok) return done({ status: "ok", httpStatus: 200, message: "Còn hạn mức, dùng bình thường" });

    const err = data.error || {};
    if (res.status === 429) {
      const retry = (err.details || []).find((d) => d?.retryDelay)?.retryDelay; // vd "32s"
      const retryAfterSec = retry ? parseInt(String(retry), 10) || undefined : undefined;
      return done({
        status: "quota",
        httpStatus: 429,
        retryAfterSec,
        message: "Đã hết hạn mức (quota) hoặc đang bị giới hạn tốc độ",
      });
    }
    if (res.status === 400 || res.status === 401 || res.status === 403) {
      return done({ status: "invalid", httpStatus: res.status, message: err.message || "Key không hợp lệ" });
    }
    return done({ status: "error", httpStatus: res.status, message: err.message || `Lỗi HTTP ${res.status}` });
  } catch (e) {
    return done({ status: "error", message: `Lỗi mạng/timeout: ${e.message}` });
  }
}

/**
 * Kiểm tra 1 key Groq: GET /models (xác nhận key) rồi gọi thật 1 token để biết còn hạn mức không.
 * Trả về cùng dạng với checkKeyStatus.
 */
export async function checkGroqKeyStatus(rawKey) {
  const t0 = Date.now();
  const done = (o) => ({ ...o, ms: Date.now() - t0, checkedAt: new Date().toISOString() });
  const headers = { "Content-Type": "application/json", Authorization: `Bearer ${rawKey}` };
  const model = String(process.env.GROQ_MODELS || "openai/gpt-oss-20b").split(",")[0].trim() || "openai/gpt-oss-20b";
  try {
    const list = await fetch("https://api.groq.com/openai/v1/models", { headers, signal: AbortSignal.timeout(8000) });
    if (list.status === 401 || list.status === 403) {
      const d = await list.json().catch(() => ({}));
      return done({ status: "invalid", httpStatus: list.status, message: d?.error?.message || "Key sai hoặc bị khóa" });
    }
    const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers,
      body: JSON.stringify({ model, messages: [{ role: "user", content: "hi" }], max_tokens: 16 }),
      signal: AbortSignal.timeout(10000),
    });
    const data = await res.json().catch(() => ({}));
    if (res.ok) return done({ status: "ok", httpStatus: 200, message: "Còn hạn mức, dùng bình thường" });
    const err = data.error || {};
    if (res.status === 429) {
      const ra = Number(res.headers.get("retry-after")) || undefined;
      return done({ status: "quota", httpStatus: 429, retryAfterSec: ra, message: "Đã hết hạn mức (phút/ngày) hoặc đang bị giới hạn tốc độ" });
    }
    if (res.status === 401 || res.status === 403) {
      return done({ status: "invalid", httpStatus: res.status, message: err.message || "Key không hợp lệ" });
    }
    // Key hợp lệ nhưng model mặc định bị gỡ/không có quyền → vẫn coi là key dùng được, báo rõ lý do
    if (res.status === 400 || res.status === 404) {
      return done({ status: "ok", httpStatus: res.status, message: `Key hợp lệ (model "${model}" không dùng được: ${err.message || res.status}) — kiểm tra GROQ_MODELS` });
    }
    return done({ status: "error", httpStatus: res.status, message: err.message || `Lỗi HTTP ${res.status}` });
  } catch (e) {
    return done({ status: "error", message: `Lỗi mạng/timeout: ${e.message}` });
  }
}

/**
 * Kiểm tra 1 key Claude: gọi thật 1 token (rẻ, ~vài phần nghìn đồng) vì Anthropic không có endpoint "xem số dư".
 * Trả về cùng dạng với checkKeyStatus. Hết tiền trong tài khoản → status "quota".
 */
export async function checkClaudeKeyStatus(rawKey) {
  const t0 = Date.now();
  const done = (o) => ({ ...o, ms: Date.now() - t0, checkedAt: new Date().toISOString() });
  const model = String(process.env.CLAUDE_MODELS || "claude-haiku-5-5").split(",")[0].trim() || "claude-haiku-5-5";
  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": rawKey, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({ model, max_tokens: 1, messages: [{ role: "user", content: "hi" }] }),
      signal: AbortSignal.timeout(10000),
    });
    const data = await res.json().catch(() => ({}));
    if (res.ok) return done({ status: "ok", httpStatus: 200, message: "Key dùng được, tài khoản còn tiền" });
    const err = data.error || {};
    const msg = String(err.message || "");
    if (res.status === 402 || /credit balance/i.test(msg)) return done({ status: "quota", httpStatus: res.status, message: "Tài khoản HẾT TIỀN — vào console.anthropic.com → Plans & Billing để nạp thêm" });
    if (res.status === 401 || res.status === 403) return done({ status: "invalid", httpStatus: res.status, message: msg || "Key sai hoặc bị khóa" });
    if (res.status === 429) {
      const ra = Number(res.headers.get("retry-after")) || undefined;
      return done({ status: "quota", httpStatus: 429, retryAfterSec: ra, message: "Đang bị giới hạn tốc độ / hạn mức" });
    }
    // Key hợp lệ nhưng model mặc định không dùng được → vẫn coi là key dùng được, báo rõ lý do
    if (res.status === 400 || res.status === 404) {
      return done({ status: "ok", httpStatus: res.status, message: `Key hợp lệ (model "${model}" không dùng được: ${msg || res.status}) — kiểm tra CLAUDE_MODELS` });
    }
    return done({ status: "error", httpStatus: res.status, message: msg || `Lỗi HTTP ${res.status}` });
  } catch (e) {
    return done({ status: "error", message: `Lỗi mạng/timeout: ${e.message}` });
  }
}

/** Kiểm tra 1 key theo id ("env" hoặc id DB), hoặc tất cả nếu không truyền id. provider: "gemini" | "claude" | "groq" */
export async function checkKeys(id, provider = "gemini") {
  provider = normProvider(provider);
  const all = provider === "groq" ? await getGroqRawKeys() : provider === "claude" ? await getClaudeRawKeys() : await getAllRawKeys();
  const checker = provider === "groq" ? checkGroqKeyStatus : provider === "claude" ? checkClaudeKeyStatus : checkKeyStatus;
  const targets = id ? all.filter((k) => k.id === String(id)) : all;
  if (id && !targets.length) throw new Error("Không tìm thấy key");
  const results = await Promise.all(targets.map(async (k) => ({ id: k.id, ...(await checker(k.key)) })));
  return results;
}
