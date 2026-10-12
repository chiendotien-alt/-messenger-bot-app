// lib/broadcast.js — nhắn 1 câu do chủ shop tự viết cho các khách CHƯA có số điện thoại mà đã im lặng quá N giờ.
//
// Khách đủ điều kiện khi:
//  - chưa để lại số điện thoại
//  - cả khách lẫn shop (bot hoặc chủ shop) đều không nhắn gì trong `SILENT_HOURS` giờ gần nhất
//  - khách nhắn lần cuối chưa quá 23 giờ (Facebook chỉ cho Page nhắn trong 24 giờ sau tin cuối của khách)
//  - chưa nhận đúng câu này kể từ lần khách nhắn gần nhất (bấm 2 lần không bị gửi trùng)
import { getSql } from "./db";
import { getPageToken } from "./pages";
import { addMessage, PHONE_SQL } from "./conversations";

export const SILENT_HOURS = 3;

async function findSilent(pageId, text, excludeIds, limit) {
  const sql = await getSql();
  const pid = pageId ? String(pageId) : null;
  const secs = SILENT_HOURS * 3600;
  const skip = Array.isArray(excludeIds) ? excludeIds.map(String).slice(0, 5000) : [];
  return await sql`SELECT c.id, c.page_id AS "pageId"
                   FROM conversations c
                   WHERE (${pid}::text IS NULL OR c.page_id = ${pid})
                     AND c.last_time <= now() - (${secs}::int * interval '1 second')
                     AND (SELECT MAX(m.created_at) FROM messages m
                          WHERE m.conversation_id = c.id AND m.sender = 'customer') > now() - interval '23 hours'
                     AND COALESCE(c.info->>'phone', '') = ''
                     AND NOT EXISTS (SELECT 1 FROM messages m
                                     WHERE m.conversation_id = c.id AND m.sender = 'customer' AND m.text ~ ${PHONE_SQL})
                     AND NOT (c.id = ANY(${skip}::text[]))
                     AND NOT EXISTS (
                       SELECT 1 FROM messages b
                       WHERE b.conversation_id = c.id AND b.sender = 'bot' AND b.text = ${text || ""}
                         AND b.created_at > COALESCE((SELECT MAX(m.created_at) FROM messages m
                                                      WHERE m.conversation_id = c.id AND m.sender = 'customer'), 'epoch'::timestamptz)
                     )
                   ORDER BY c.last_time ASC
                   LIMIT ${limit}`;
}

export async function countSilent(pageId, text = "") {
  return (await findSilent(pageId, text, [], 5000)).length;
}

async function sendText(token, recipientId, text) {
  const res = await fetch(`https://graph.facebook.com/v21.0/me/messages?access_token=${token}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ recipient: { id: recipientId }, message: { text }, messaging_type: "RESPONSE" }),
  });
  if (res.ok) return { ok: true };
  const err = await res.json().catch(() => ({}));
  return { ok: false, error: err?.error?.message || `HTTP ${res.status}` };
}

/**
 * Gửi 1 lượt (tối đa ~45 giây). Trả { sent, failed, failedIds, remaining }.
 * Giao diện gọi lặp lại cho tới khi remaining = 0.
 */
export async function sendToSilent({ pageId = null, text, excludeIds = [], deadlineMs = 45000 }) {
  const t0 = Date.now();
  const message = String(text || "").trim().slice(0, 2000);
  if (!message) throw new Error("Chưa có nội dung tin nhắn");

  const list = await findSilent(pageId, message, excludeIds, 200);
  let sent = 0;
  const failedIds = [];
  const errors = [];
  let handled = 0;

  for (const c of list) {
    if (Date.now() - t0 > deadlineMs) break;
    handled++;
    try {
      const token = await getPageToken(c.pageId);
      if (!token) throw new Error("Không có token của Page");
      const r = await sendText(token, c.id, message);
      if (!r.ok) throw new Error(r.error);
      await addMessage(c.id, "bot", message, [], c.pageId).catch((e) => console.error("Không lưu tin:", e.message));
      sent++;
    } catch (e) {
      failedIds.push(c.id);
      if (errors.length < 3) errors.push(String(e.message || e).slice(0, 150));
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  return { sent, failed: failedIds.length, failedIds, errors, remaining: Math.max(0, list.length - handled) };
}
