// lib/alert.js — BÁO LỖI TỰ ĐỘNG về Telegram của chủ shop.
// Khi bot gặp lỗi (AI không trả lời, Facebook từ chối gửi tin, key hết hạn, lỗi hệ thống...) → gửi 1 tin Telegram có đủ thông tin.
// Chủ shop chỉ việc copy nguyên tin đó gửi cho Claude là biết sửa chỗ nào.
//
// Cài đặt (2 biến môi trường trên Vercel):
//   TELEGRAM_BOT_TOKEN   token bot tạo ở @BotFather
//   TELEGRAM_CHAT_ID     ID Telegram của bạn (hỏi @userinfobot) — hoặc ID nhóm
// Chưa cài → mọi hàm ở đây im lặng, bot chạy như cũ.
//
// Chống spam: cùng một "mã lỗi" chỉ báo 1 lần / khoảng nghỉ (mặc định 10 phút), nhớ chung giữa các máy chủ Vercel qua Neon (bảng alert_throttle).
// Bảo mật: tự che key/token và số điện thoại trong tin khách trước khi gửi.

const VN_TZ = "Asia/Ho_Chi_Minh";
const mem = new Map(); // mã lỗi → thời điểm được báo lại (RAM của máy chủ này)
let tableReady = null;

const withTimeout = (p, ms, fallback) => Promise.race([p, new Promise((r) => setTimeout(() => r(fallback), ms))]);

async function sqlOrNull() {
  try {
    const { getSql } = await import("./db");
    return await getSql();
  } catch {
    return null;
  }
}

async function ensureTable(sql) {
  if (!tableReady) {
    tableReady = sql`CREATE TABLE IF NOT EXISTS alert_throttle (k TEXT PRIMARY KEY, until_ms BIGINT NOT NULL)`.catch((e) => {
      tableReady = null;
      throw e;
    });
  }
  return tableReady;
}

/** Che key/token (và số điện thoại nếu phone=true), cắt bớt độ dài. */
export function scrub(s, max = 1200, { phone = false } = {}) {
  let t = String(s ?? "");
  t = t
    .replace(/AIza[0-9A-Za-z_-]{20,}/g, "[KEY]")
    .replace(/gsk_[0-9A-Za-z]{10,}/g, "[KEY]")
    .replace(/EAA[0-9A-Za-z]{20,}/g, "[TOKEN]")
    .replace(/access_token=[^&\s"']+/gi, "access_token=[TOKEN]")
    .replace(/\b\d{6,}:[A-Za-z0-9_-]{30,}\b/g, "[TOKEN]");
  if (phone) t = t.replace(/(?:\+?84|0)\d[\d .-]{7,11}\d/g, "[SĐT]");
  return t.length > max ? t.slice(0, max) + "…" : t;
}

/** Biến lỗi (Error hoặc chữ) thành đoạn chữ ngắn gọn có vị trí lỗi. */
export function errText(e) {
  if (!e) return "";
  const s = e.stack || e.message || String(e);
  return scrub(s, 1500);
}

async function allow(code, gapMs) {
  if (gapMs <= 0) return true;
  const now = Date.now();
  if ((mem.get(code) || 0) > now) return false;
  mem.set(code, now + gapMs);
  try {
    const sql = await sqlOrNull();
    if (!sql) return true;
    await ensureTable(sql);
    const rows = await sql`INSERT INTO alert_throttle (k, until_ms) VALUES (${code}, ${now + gapMs})
      ON CONFLICT (k) DO UPDATE SET until_ms = EXCLUDED.until_ms WHERE alert_throttle.until_ms < ${now} RETURNING k`;
    return rows.length > 0;
  } catch {
    return true;
  }
}

/** Gửi 1 tin Telegram. Không bao giờ throw. Trả { ok, description }. */
export async function sendTelegram(text) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chat = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chat) return { ok: false, description: "Chưa đặt TELEGRAM_BOT_TOKEN hoặc TELEGRAM_CHAT_ID" };
  try {
    const res = await fetch(`https://api.telegram.org/bot${token.trim()}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: String(chat).trim(), text: String(text).slice(0, 4000), disable_web_page_preview: true }),
      signal: AbortSignal.timeout(5000),
    });
    const d = await res.json().catch(() => ({}));
    return { ok: res.ok, description: res.ok ? "" : d.description || `HTTP ${res.status}` };
  } catch (e) {
    return { ok: false, description: scrub(e.message, 200) };
  }
}

/**
 * Báo lỗi về Telegram.
 *  code   mã lỗi ngắn (dùng để chống spam: cùng mã chỉ báo 1 lần / gapMs)
 *  title  tiêu đề dễ hiểu
 *  fields { "Tên mục": "giá trị" } — các thông tin kèm theo
 *  opts   { gapMs } khoảng nghỉ giữa 2 lần báo cùng mã (mặc định 10 phút; 0 = luôn báo)
 */
export async function reportError(code, title, fields = {}, opts = {}) {
  try {
    if (!process.env.TELEGRAM_BOT_TOKEN || !process.env.TELEGRAM_CHAT_ID) return false;
    if (!(await withTimeout(allow(code, opts.gapMs ?? 10 * 60 * 1000), 2000, true))) return false;

    const when = new Date().toLocaleString("vi-VN", { timeZone: VN_TZ });
    const ver = String(process.env.VERCEL_GIT_COMMIT_SHA || "").slice(0, 7);
    const lines = [`🚨 ${title}`, `Mã lỗi: ${code}`, `Giờ: ${when} (giờ VN)${ver ? `  |  Bản: ${ver}` : ""}`];
    for (const [label, value] of Object.entries(fields)) {
      if (value === undefined || value === null || value === "") continue;
      lines.push(`${label}: ${scrub(value, 1200, { phone: /tin khách/i.test(label) })}`);
    }
    lines.push("", "👉 Copy nguyên tin này gửi cho Claude để sửa.");
    const r = await sendTelegram(lines.join("\n"));
    if (!r.ok) console.error("Không gửi được báo lỗi Telegram:", r.description);
    return r.ok;
  } catch (e) {
    console.error("Lỗi hệ thống báo lỗi:", e.message);
    return false;
  }
}
