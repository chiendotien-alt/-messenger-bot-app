// lib/orders.js — lưu đơn hàng nháp tạo từ khung chat (Neon Postgres)
import { getSql } from "./db";

export async function listOrders(conversationId) {
  const sql = await getSql();
  const rows = await sql`SELECT id, status, data, created_at AS "createdAt"
                         FROM orders WHERE conversation_id = ${conversationId}
                         ORDER BY id DESC LIMIT 20`;
  return rows.map((r) => ({ ...r.data, id: String(r.id), status: r.status || "draft", createdAt: r.createdAt }));
}

export const ORDER_STATUSES = ["draft", "shipped", "delivered", "returned"];

/** Tick tình trạng đơn bằng tay: draft (mới tạo) / shipped (đã gửi hàng) / delivered (đã giao) / returned (hoàn-hủy). */
export async function setOrderStatus(id, status) {
  if (!ORDER_STATUSES.includes(status)) throw new Error("Tình trạng đơn không hợp lệ");
  const sql = await getSql();
  // Đổi sang tình trạng khác "Mới tạo" = chủ shop đã xử lý đơn → không còn là đơn nháp tự tạo
  await sql`UPDATE orders
            SET status = ${status},
                data = CASE WHEN ${status} <> 'draft' THEN data - 'auto' ELSE data END,
                updated_at = now()
            WHERE id = ${Number(id)}`;
  // Khách hủy đơn → nếu họ đặt lại và để SĐT lần nữa thì cho phép tự tạo đơn mới (bỏ giữ chỗ 72 giờ)
  if (status === "returned") {
    await sql`DELETE FROM auto_order_claims WHERE conversation_id = (SELECT conversation_id FROM orders WHERE id = ${Number(id)})`;
  }
}

/** Đơn do hệ thống TỰ TẠO khi khách để lại SĐT và chủ shop chưa xem/xác nhận. Bot không coi đây là "khách đã đặt hàng". */
export const isUnconfirmedAuto = (o) => o?.auto === true && (o.status || "draft") === "draft";

/** Xác nhận đơn tự tạo (vd: đã ghi vào doanh thu): bỏ nhãn "tự tạo" để bot coi là khách đã đặt hàng. */
export async function confirmOrder(id) {
  const sql = await getSql();
  await sql`UPDATE orders SET data = data - 'auto', updated_at = now() WHERE id = ${Number(id)}`;
}

/** Đơn tự tạo chưa xác nhận của cuộc chat này (nếu có). */
export async function findUnconfirmedAuto(conversationId) {
  const list = await listOrders(conversationId);
  return list.find(isUnconfirmedAuto) || null;
}

export async function saveOrder(conversationId, pageId, data, id = null) {
  const sql = await getSql();
  const { id: _i, status: _s, createdAt: _c, conversationId: _cv, ...clean } = data || {};
  const json = JSON.stringify(clean);
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

/** Toàn bộ đơn (mới → cũ) để hiện trạng thái đơn ở danh sách khách bên trái. */
export async function listAllOrders(allowedPageIds = null) {
  const sql = await getSql();
  const allowed = Array.isArray(allowedPageIds) ? allowedPageIds.map(String) : null;
  const rows = await sql`SELECT id, conversation_id AS "conversationId", page_id AS "pageId", status, data, created_at AS "createdAt"
                         FROM orders
                         WHERE (${allowed}::text[] IS NULL OR page_id = ANY(${allowed}::text[]))
                         ORDER BY id DESC LIMIT 1000`;
  return rows.map((r) => ({ ...r.data, id: String(r.id), conversationId: r.conversationId, pageId: r.pageId, status: r.status || "draft", createdAt: r.createdAt }));
}

/** Đơn này thuộc Page nào (để kiểm tra quyền của member). */
export async function getOrderPageId(id) {
  const sql = await getSql();
  const rows = await sql`SELECT page_id AS "pageId" FROM orders WHERE id = ${Number(id)}`;
  return rows[0]?.pageId || null;
}
