// lib/orders.js — lưu đơn hàng nháp tạo từ khung chat (Neon Postgres)
import { getSql } from "./db";

export async function listOrders(conversationId) {
  const sql = await getSql();
  const rows = await sql`SELECT id, status, data, created_at AS "createdAt"
                         FROM orders WHERE conversation_id = ${conversationId}
                         ORDER BY id DESC LIMIT 20`;
  return rows.map((r) => ({ id: String(r.id), status: r.status, createdAt: r.createdAt, ...r.data }));
}

export async function saveOrder(conversationId, pageId, data, id = null) {
  const sql = await getSql();
  const json = JSON.stringify(data);
  if (id) {
    await sql`UPDATE orders SET data = ${json}::jsonb, updated_at = now() WHERE id = ${Number(id)}`;
    return String(id);
  }
  const rows = await sql`INSERT INTO orders (conversation_id, page_id, data)
                         VALUES (${conversationId}, ${pageId || null}, ${json}::jsonb) RETURNING id`;
  return String(rows[0].id);
}

export async function deleteOrder(id) {
  const sql = await getSql();
  await sql`DELETE FROM orders WHERE id = ${Number(id)}`;
}
