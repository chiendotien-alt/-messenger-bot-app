// lib/salesState.js — dữ liệu của web Quản lý bán hàng (sản phẩm, đơn bán, quảng cáo...) lưu trong Neon
import { getSql } from "./db";

/** { state: object|null, rev: number } — rev = 0 nghĩa là chưa từng lưu. */
export async function getSalesState() {
  const sql = await getSql();
  const rows = await sql`SELECT value, rev FROM sales_state WHERE key = 'main'`;
  if (!rows.length) return { state: null, rev: 0 };
  return { state: rows[0].value, rev: Number(rows[0].rev) };
}

/**
 * Lưu bản mới. Chỉ lưu được khi `rev` bằng với bản đang có trên máy chủ
 * (nếu máy/tab khác đã lưu trước thì từ chối để không ghi đè mất dữ liệu).
 * Trả về { ok: true, rev } hoặc { ok: false, rev: số-hiện-tại }.
 */
export async function putSalesState(state, rev) {
  const sql = await getSql();
  const json = JSON.stringify(state);
  const base = Number(rev) || 0;
  let rows;
  if (base === 0) {
    rows = await sql`INSERT INTO sales_state (key, value, rev) VALUES ('main', ${json}::jsonb, 1)
                     ON CONFLICT (key) DO NOTHING RETURNING rev`;
  } else {
    rows = await sql`UPDATE sales_state SET value = ${json}::jsonb, rev = rev + 1, updated_at = now()
                     WHERE key = 'main' AND rev = ${base} RETURNING rev`;
  }
  if (rows.length) return { ok: true, rev: Number(rows[0].rev) };
  const cur = await sql`SELECT rev FROM sales_state WHERE key = 'main'`;
  return { ok: false, rev: Number(cur[0]?.rev || 0) };
}
