// lib/unanswered.js — BÁO CHỦ SHOP khi có khách nhắn mà chưa ai trả lời (qua Telegram, dùng chung cài đặt với lib/alert.js).
//
// Hai kiểu báo:
//  1) BÁO NGAY: khách nhắn lúc bot đang TẮT với khách đó (vd sau khi chốt đơn bot tự tắt) → bot im, chủ shop cần biết liền.
//  2) NHẮC LẠI: khách nhắn xong quá UNANSWERED_ALERT_MIN phút (mặc định 10) mà tin cuối vẫn là của khách (bot lỗi, bot tắt, chưa ai rep...).
//     Gom nhiều khách vào 1 tin Telegram, mỗi tin khách chỉ báo 1 lần.
// Không báo: tin chỉ là "cảm ơn / ok / dạ / emoji", các lần bot CHỦ Ý im lặng, giờ nghỉ đêm 23h-6h (sáng 6h báo gộp).
// Chưa cài TELEGRAM_BOT_TOKEN + TELEGRAM_CHAT_ID thì mọi thứ ở đây im lặng.
// Tắt hẳn: UNANSWERED_ALERT=off. Đổi số phút: UNANSWERED_ALERT_MIN (0 = chỉ báo NGAY, không nhắc lại).
import { getSql } from "./db";
import { notifyOwner, sendTelegram, scrub } from "./alert";
import { inQuietHours } from "./nudge";

const strip = (t) =>
  String(t || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d");

// Các từ chỉ có trong lời cảm ơn / đồng ý / chào tạm biệt (đã bỏ dấu). Tin chỉ gồm những từ này → không cần chủ shop trả lời.
const CLOSING_WORDS = new Set(
  ("da vang a ok oke okie okay okela oki cam on thanks thank tks thankyou you nhieu qua nha nhe nhen em chi anh co chu shop ban minh oi " +
    "chao bye tam biet hen gap lai duoc roi um uh u hihi haha hi vay").split(" ")
);

/** Tin chỉ là "cảm ơn / ok / dạ / emoji" → khách không chờ ai trả lời. */
export function isClosingText(text) {
  const raw = String(text || "").trim();
  if (!raw) return true;
  const words = strip(raw).replace(/[^a-z0-9\s]+/g, " ").split(/\s+/).filter(Boolean);
  if (!words.length) return true; // chỉ có emoji / dấu câu
  return words.length <= 6 && words.every((w) => CLOSING_WORDS.has(w));
}

export function alertSettings(env = process.env) {
  if (String(env.UNANSWERED_ALERT || "").toLowerCase() === "off") return { enabled: false, minutes: 0 };
  const n = env.UNANSWERED_ALERT_MIN !== undefined && env.UNANSWERED_ALERT_MIN !== "" ? Number(env.UNANSWERED_ALERT_MIN) : 10;
  return { enabled: true, minutes: Number.isFinite(n) ? Math.max(0, Math.min(180, n)) : 10 };
}

/** Link trang quản trị (Vercel tự có biến VERCEL_PROJECT_PRODUCTION_URL, không cần cài). */
export function adminUrl(env = process.env) {
  const host = String(env.VERCEL_PROJECT_PRODUCTION_URL || env.VERCEL_URL || "").trim();
  return host ? `https://${host.replace(/^https?:\/\//, "")}/admin` : "";
}

const snippet = (t) => scrub(String(t || "").replace(/\s+/g, " ").trim(), 120, { phone: true }) || "(ảnh / tin không có chữ)";

/** Tin báo NGAY: khách nhắn lúc bot đang tắt với khách đó. */
export function buildBotOffMessage({ name, text, url }) {
  return [
    "🔔 Khách nhắn nhưng bot đang TẮT với khách này (đã chốt đơn hoặc bạn tắt bot) — cần bạn trả lời:",
    `${name || "Khách"}: "${snippet(text)}"`,
    url ? `👉 Mở trang chat: ${url}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

/** Tin NHẮC LẠI: danh sách khách chờ quá lâu. rows: [{ name, lastMessage, waitMin, botOff }] */
export function buildWatchMessage(rows, url = "") {
  const lines = [`⏰ ${rows.length} khách đang chờ trả lời:`];
  rows.slice(0, 10).forEach((r, i) => {
    const why = r.botOff ? "bot đang tắt với khách này" : "bot chưa trả lời";
    lines.push(`${i + 1}) ${r.name || "Khách"} — chờ ${r.waitMin} phút (${why}): "${snippet(r.lastMessage)}"`);
  });
  if (rows.length > 10) lines.push(`… và ${rows.length - 10} khách nữa`);
  if (url) lines.push(`👉 Mở trang chat: ${url}`);
  return lines.join("\n");
}

/**
 * LẤY VÀ ĐÁNH DẤU luôn (một câu lệnh duy nhất, nên 2 lượt chạy cùng lúc không báo trùng) các khách:
 * tin cuối cùng là của KHÁCH, đã chờ từ `minutes` phút, chưa quá 22 giờ (Facebook chỉ cho trả lời trong 24 giờ),
 * và chưa được báo cho tin đó. `sql` = hàm tagged-template của Neon (truyền vào để test được).
 */
export async function claimUnanswered(sql, { minutes = 10, limit = 20 } = {}) {
  return await sql`WITH due AS (
                     SELECT c.id FROM conversations c
                     WHERE c.last_from = 'customer'
                       AND c.last_time <= now() - (${minutes}::int * interval '1 minute')
                       AND c.last_time >= now() - interval '22 hours'
                       AND (c.unanswered_alert_at IS NULL OR c.unanswered_alert_at < c.last_time)
                     ORDER BY c.last_time ASC
                     LIMIT ${limit}
                     FOR UPDATE SKIP LOCKED
                   )
                   UPDATE conversations c SET unanswered_alert_at = now()
                   FROM due WHERE c.id = due.id
                   RETURNING c.id, c.name, c.last_message AS "lastMessage",
                             COALESCE(c.bot_off, FALSE) AS "botOff",
                             FLOOR(EXTRACT(EPOCH FROM (now() - c.last_time)) / 60)::int AS "waitMin"`;
}

/** Gửi Telegram lỗi → trả lại trạng thái "chưa báo" để phút sau thử lại. */
export async function releaseClaim(sql, ids) {
  if (!ids.length) return;
  await sql`UPDATE conversations SET unanswered_alert_at = NULL WHERE id = ANY(${ids}::text[])`;
}

/** Đánh dấu đã báo / đã xử lý cho các cuộc chat này. */
export async function markAlerted(sql, ids) {
  if (!ids.length) return;
  await sql`UPDATE conversations SET unanswered_alert_at = now() WHERE id = ANY(${ids}::text[])`;
}

/** Bot CHỦ Ý im lặng với tin này (khách chỉ lặp lại thông tin đã chốt, tin gửi trùng...) → đừng nhắc "khách chưa được trả lời". */
export async function markHandled(conversationId) {
  const sql = await getSql();
  await markAlerted(sql, [String(conversationId)]);
}

/** Khách vừa nhắn lúc bot TẮT với khách đó → báo chủ shop ngay (cùng khách chỉ báo 1 lần / 5 phút). */
export async function notifyBotOffMessage({ conversationId, name, text }) {
  try {
    const cfg = alertSettings();
    if (!cfg.enabled || inQuietHours() || isClosingText(text)) return false;
    return await notifyOwner(`botoff:${conversationId}`, buildBotOffMessage({ name, text, url: adminUrl() }), { gapMs: 5 * 60 * 1000 });
  } catch (e) {
    console.error("Lỗi báo khách nhắn lúc bot tắt:", e.message);
    return false;
  }
}

/**
 * Nhắc chủ shop các khách đang chờ. Gọi mỗi phút (từ /api/nudge/run) và kèm theo mỗi lần webhook chạy (có giới hạn 1 lần / 60 giây).
 * Trả về { skipped } hoặc { alerted: số khách }.
 */
export async function runUnansweredWatch({ throttle = true } = {}) {
  const cfg = alertSettings();
  if (!cfg.enabled || cfg.minutes <= 0) return { skipped: "Tính năng nhắc khách chờ đang tắt" };
  if (!process.env.TELEGRAM_BOT_TOKEN || !process.env.TELEGRAM_CHAT_ID) return { skipped: "Chưa cài Telegram" };
  if (inQuietHours()) return { skipped: "Giờ nghỉ đêm — sáng sẽ báo gộp" }; // kiểm tra trước khi đọc database để ban đêm không đánh thức Neon
  const sql = await getSql();
  if (throttle) {
    const now = Date.now();
    const claimed = await sql`INSERT INTO settings (key, value)
                              VALUES ('unanswered_lastrun', ${JSON.stringify({ t: now })}::jsonb)
                              ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value
                              WHERE (settings.value->>'t')::bigint < ${now - 60 * 1000}
                              RETURNING key`;
    if (!claimed.length) return { skipped: "Mới chạy cách đây chưa tới 1 phút" };
  }
  const rows = await claimUnanswered(sql, { minutes: cfg.minutes, limit: 20 }); // đã đánh dấu "đã báo" luôn, kể cả tin "cảm ơn/ok" (khỏi xét lại)
  if (!rows.length) return { alerted: 0 };
  const waiting = rows.filter((r) => !isClosingText(r.lastMessage)).sort((a, b) => b.waitMin - a.waitMin); // chờ lâu nhất lên đầu
  if (waiting.length) {
    const sent = await sendTelegram(buildWatchMessage(waiting, adminUrl()));
    if (!sent.ok) {
      console.error("Không gửi được nhắc khách chờ:", sent.description);
      await releaseClaim(sql, rows.map((r) => String(r.id))).catch(() => {}); // phút sau thử lại
      return { error: sent.description };
    }
  }
  return { alerted: waiting.length };
}
