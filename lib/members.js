// lib/members.js — quản lý member cấp dưới (chỉ chủ shop dùng)
import { getSql } from "./db";
import { hashPassword } from "./auth";

const clean = (arr) => [...new Set((Array.isArray(arr) ? arr : []).map(String).filter(Boolean))];

function normUsername(u) {
  const v = String(u || "").trim().toLowerCase();
  if (!/^[a-z0-9._-]{3,30}$/.test(v)) throw new Error("Tên đăng nhập 3–30 ký tự, chỉ gồm chữ thường, số, dấu . _ -");
  return v;
}

const shape = (r) => ({
  id: r.id,
  username: r.username,
  name: r.name,
  active: r.active,
  pageIds: r.page_ids || [],
  productIds: r.product_ids || [],
});

export async function listMembers() {
  const sql = await getSql();
  const rows = await sql`SELECT id, username, name, active, page_ids, product_ids FROM members ORDER BY id`;
  return rows.map(shape);
}

export async function addMember({ username, name, password, pageIds, productIds }) {
  const u = normUsername(username);
  if (u === String(process.env.ADMIN_USER || "admin").toLowerCase()) throw new Error("Tên đăng nhập này trùng tài khoản chủ shop");
  if (String(password || "").length < 6) throw new Error("Mật khẩu tối thiểu 6 ký tự");
  const { salt, hash } = await hashPassword(String(password));
  const sql = await getSql();
  try {
    await sql`INSERT INTO members (username, name, salt, hash, page_ids, product_ids)
              VALUES (${u}, ${String(name || "").trim()}, ${salt}, ${hash},
                      ${JSON.stringify(clean(pageIds))}::jsonb, ${JSON.stringify(clean(productIds))}::jsonb)`;
  } catch (e) {
    if (String(e.message).includes("duplicate")) throw new Error("Tên đăng nhập đã có người dùng");
    throw e;
  }
}

/** Sửa quyền / tên / bật-tắt / đổi mật khẩu (chỉ field nào được gửi lên mới đổi). */
export async function updateMember(id, patch) {
  const sql = await getSql();
  const mid = Number(id);
  if (!Number.isFinite(mid)) throw new Error("Thiếu id member");
  if (patch.name !== undefined) await sql`UPDATE members SET name = ${String(patch.name).trim()} WHERE id = ${mid}`;
  if (patch.active !== undefined) await sql`UPDATE members SET active = ${Boolean(patch.active)} WHERE id = ${mid}`;
  if (patch.pageIds !== undefined) await sql`UPDATE members SET page_ids = ${JSON.stringify(clean(patch.pageIds))}::jsonb WHERE id = ${mid}`;
  if (patch.productIds !== undefined) await sql`UPDATE members SET product_ids = ${JSON.stringify(clean(patch.productIds))}::jsonb WHERE id = ${mid}`;
  if (patch.password) {
    if (String(patch.password).length < 6) throw new Error("Mật khẩu tối thiểu 6 ký tự");
    const { salt, hash } = await hashPassword(String(patch.password));
    await sql`UPDATE members SET salt = ${salt}, hash = ${hash} WHERE id = ${mid}`;
  }
}

export async function deleteMember(id) {
  const sql = await getSql();
  await sql`DELETE FROM members WHERE id = ${Number(id)}`;
}
