// lib/orderReading.js — lưu danh sách món đã chốt + nhật ký đối chiếu AI/hệ thống, và thống kê cho chủ shop.
import { createHash } from "crypto";
import { getSql } from "./db";
import { scrub, notifyOwner } from "./alert";
import { adminUrl } from "./unanswered";
import { inQuietHours } from "./nudge";
import { toNamed, describeItems } from "./orderItems";

/** Danh sách món đã lưu của khách: { items (theo tên mục), src, at } hoặc null. */
export async function getSavedItems(conversationId, sqlOverride) {
  try {
    const sql = sqlOverride || (await getSql());
    const r = await sql`SELECT order_items FROM conversations WHERE id = ${String(conversationId)}`;
    const v = r[0]?.order_items;
    return v && typeof v === "object" ? v : null;
  } catch (e) {
    console.error("Lỗi đọc danh sách món đã lưu:", e.message);
    return null;
  }
}

/** Lưu danh sách món đã chốt (null = xóa). `src` = tin khách cuối cùng lúc đọc (để biết khách có nhắn đổi gì sau đó không). */
export async function saveItems(conversationId, attrs, items, src, sqlOverride) {
  try {
    const sql = sqlOverride || (await getSql());
    const v = items && items.length ? { items: toNamed(attrs, items), src: String(src || "").slice(0, 500), at: Date.now() } : null;
    await sql`UPDATE conversations SET order_items = ${v === null ? null : JSON.stringify(v)}::jsonb WHERE id = ${String(conversationId)}`;
  } catch (e) {
    console.error("Lỗi lưu danh sách món:", e.message);
  }
}

const VERDICT_TEXT = {
  agree: "AI và hệ thống đọc giống nhau",
  ai_filled: "AI đọc được thêm điều hệ thống bỏ sót (đã dùng bản AI)",
  conflict: "AI và hệ thống đọc KHÁC nhau (đã dùng bản hệ thống) — cần bạn xem",
  ai_invalid: "AI ghi giá trị không hợp lệ (đã bỏ bản AI)",
  ai_none: "AI không ghi món nào",
};
export const verdictText = (v) => VERDICT_TEXT[v] || v;

/** Ghi nhật ký (mỗi cặp khách + kết quả đọc chỉ ghi 1 lần). Không bao giờ throw. */
export async function logReading({ conversationId, product, attrs, reading, customerText, sql: sqlOverride }) {
  try {
    if (!reading || reading.verdict === "none") return false;
    const ai = reading.ai?.items?.length ? describeItems(attrs, reading.ai.items) : "";
    const sys = reading.sys?.items ? describeItems(attrs, reading.sys.items) : attrs.map((a, i) => [...(reading.sys?.union?.[i] || [])].join("+")).filter(Boolean).join(" ") || "";
    const fin = reading.final ? describeItems(attrs, reading.final) : "";
    const rowKey = createHash("sha1").update([reading.verdict, ai, sys, fin].join("|")).digest("hex").slice(0, 16);
    const sql = sqlOverride || (await getSql());
    const r = await sql`INSERT INTO order_reading_log (conversation_id, product, verdict, notes, customer_text, ai_reading, system_reading, final_reading, row_key)
                        VALUES (${String(conversationId)}, ${String(product || "").slice(0, 120)}, ${reading.verdict}, ${(reading.notes || []).join("; ").slice(0, 300)},
                                ${scrub(String(customerText || "").replace(/\s+/g, " ").trim(), 300, { phone: true })}, ${ai.slice(0, 300)}, ${sys.slice(0, 300)}, ${fin.slice(0, 300)}, ${rowKey})
                        ON CONFLICT (conversation_id, row_key) DO NOTHING RETURNING id`;
    return r.length > 0;
  } catch (e) {
    console.error("Lỗi ghi nhật ký đọc đơn:", e.message);
    return false;
  }
}

/** Báo chủ shop khi AI và hệ thống mâu thuẫn (không hỏi khách). Cùng khách chỉ báo 1 lần / 10 phút; đêm 23h-6h không báo. */
export async function alertConflict({ conversationId, name, attrs, reading }) {
  try {
    if (inQuietHours()) return false;
    const url = adminUrl();
    const text = [
      `⚠️ Đơn của ${name || "khách"} cần bạn xem: AI và hệ thống đọc khác nhau (bot đã dùng bản hệ thống).`,
      `Hệ thống đọc: ${reading.sys?.items ? describeItems(attrs, reading.sys.items) : attrs.map((a, i) => [...(reading.sys?.union?.[i] || [])].join("+")).filter(Boolean).join(" ") || "(chưa rõ)"}`,
      `AI đọc: ${describeItems(attrs, reading.ai?.items)}`,
      reading.notes?.length ? `Lý do: ${reading.notes.join("; ")}` : "",
      url ? `👉 Mở trang chat: ${url}` : "",
    ].filter(Boolean).join("\n");
    return await notifyOwner(`reading:${conversationId}`, text, { gapMs: 10 * 60 * 1000 });
  } catch (e) {
    console.error("Lỗi báo mâu thuẫn đọc đơn:", e.message);
    return false;
  }
}

/** Thống kê N ngày gần nhất + các lượt cần xem. */
export async function readingStats(days = 7, sqlOverride) {
  const sql = sqlOverride || (await getSql());
  const n = Math.max(1, Math.min(90, Number(days) || 7));
  const counts = await sql`SELECT verdict, COUNT(*)::int AS n FROM order_reading_log WHERE created_at >= now() - (${n}::int * interval '1 day') GROUP BY verdict`;
  const by = Object.fromEntries(counts.map((r) => [r.verdict, r.n]));
  const recent = await sql`SELECT l.id, l.created_at AS "createdAt", l.conversation_id AS "conversationId", c.name, l.verdict, l.notes, l.customer_text AS "customerText",
                                  l.ai_reading AS "aiReading", l.system_reading AS "systemReading", l.final_reading AS "finalReading"
                           FROM order_reading_log l LEFT JOIN conversations c ON c.id = l.conversation_id
                           WHERE l.created_at >= now() - (${n}::int * interval '1 day') AND l.verdict IN ('conflict', 'ai_invalid', 'ai_filled')
                           ORDER BY l.created_at DESC LIMIT 40`;
  return { days: n, ...summarize(by), recent };
}

/** Từ số lượt theo từng kết quả → các tỉ lệ dễ hiểu. */
export function summarize(by) {
  const g = (k) => by[k] || 0;
  const judged = g("agree") + g("ai_filled") + g("conflict") + g("ai_invalid"); // các lượt AI có ghi món để so
  const pct = (x) => (judged ? Math.round((x / judged) * 1000) / 10 : null);
  return {
    total: judged + g("ai_none"),
    judged,
    counts: { agree: g("agree"), ai_filled: g("ai_filled"), conflict: g("conflict"), ai_invalid: g("ai_invalid"), ai_none: g("ai_none") },
    agreeRate: pct(g("agree")), // hai bên giống nhau
    usableRate: pct(g("agree") + g("ai_filled")), // giống nhau hoặc AI bổ sung điều hệ thống bỏ sót
    needCheckRate: pct(g("conflict")), // mâu thuẫn, cần chủ shop xem
    invalidRate: pct(g("ai_invalid")),
  };
}
