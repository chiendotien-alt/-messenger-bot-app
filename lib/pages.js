// lib/pages.js — quản lý nhiều Fanpage (mỗi Page có Page Access Token riêng) trong Neon Postgres
import { getSql } from "./db";

const GRAPH = "https://graph.facebook.com/v21.0";

/** Ảnh đại diện Page (link công khai của Facebook, không cần token, không hết hạn). */
export const pageAvatarUrl = (id) => `${GRAPH}/${id}/picture?type=large`;

/** Hỏi Facebook token này thuộc Page nào (lấy id + tên). */
async function fetchPageInfo(token) {
  const res = await fetch(`${GRAPH}/me?fields=id,name,category&access_token=${encodeURIComponent(token)}`);
  const d = await res.json().catch(() => ({}));
  if (!res.ok || d.error || !d.id) {
    throw new Error(d.error?.message || "Token không hợp lệ hoặc đã hết hạn");
  }
  return { id: String(d.id), name: d.name || `Page ${d.id}`, looksLikePage: Boolean(d.category) };
}

/** Đăng ký Page nhận tin nhắn về webhook của app (không bắt buộc thành công). */
async function subscribeApp(pageId, token) {
  try {
    const res = await fetch(`${GRAPH}/${pageId}/subscribed_apps`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        subscribed_fields: "messages,messaging_postbacks,message_echoes",
        access_token: token,
      }),
    });
    const d = await res.json().catch(() => ({}));
    if (!res.ok || d.error) return { ok: false, error: d.error?.message || "lỗi không rõ" };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

// Page đang dùng biến môi trường FB_PAGE_ACCESS_TOKEN (cách cũ) → tự nhập vào danh sách để không mất gì
let envImported = false;
async function ensureEnvPage() {
  const envToken = process.env.FB_PAGE_ACCESS_TOKEN;
  if (!envToken || envImported) return;
  try {
    const info = await fetchPageInfo(envToken);
    const sql = await getSql();
    await sql`INSERT INTO pages (id, name, token, source)
              VALUES (${info.id}, ${info.name}, ${envToken}, 'env')
              ON CONFLICT (id) DO NOTHING`;
    // Các cuộc trò chuyện cũ (từ trước khi có nhiều Page) đều thuộc Page này
    await sql`UPDATE conversations SET page_id = ${info.id} WHERE page_id IS NULL`;
    envImported = true;
  } catch (e) {
    console.error("Không nhập được Page từ biến môi trường:", e.message);
  }
}

/** Danh sách Page — KHÔNG bao giờ trả token ra ngoài. */
export async function listPages() {
  await ensureEnvPage();
  const sql = await getSql();
  const rows = await sql`SELECT id, name, source, COALESCE(bot_enabled, TRUE) AS "botEnabled" FROM pages ORDER BY created_at ASC`;
  return rows.map((r) => ({ ...r, avatar: pageAvatarUrl(r.id) }));
}

/** Thêm Page bằng Page Access Token. */
export async function addPage(rawToken) {
  const token = String(rawToken || "").trim();
  if (!token) throw new Error("Chưa nhập token");

  const info = await fetchPageInfo(token);
  if (!info.looksLikePage) {
    throw new Error(
      "Đây có vẻ là token của tài khoản cá nhân, không phải Page Access Token. Hãy lấy token của đúng Page."
    );
  }

  const sql = await getSql();
  await sql`INSERT INTO pages (id, name, token, source)
            VALUES (${info.id}, ${info.name}, ${token}, 'manual')
            ON CONFLICT (id) DO UPDATE
            SET name = EXCLUDED.name, token = EXCLUDED.token, source = 'manual'`;

  // Chưa từng có Page nào (và không dùng biến môi trường) → các chat cũ thuộc Page đầu tiên này
  if (!process.env.FB_PAGE_ACCESS_TOKEN) {
    const n = await sql`SELECT count(*)::int AS n FROM pages`;
    if (n[0].n === 1) await sql`UPDATE conversations SET page_id = ${info.id} WHERE page_id IS NULL`;
  }

  const sub = await subscribeApp(info.id, token);
  return {
    page: { id: info.id, name: info.name, avatar: pageAvatarUrl(info.id), source: "manual", botEnabled: true },
    subscribed: sub.ok,
    subscribeError: sub.ok ? null : sub.error,
  };
}

/** Gỡ Page (lịch sử chat vẫn được giữ). Page lấy từ biến môi trường thì phải xóa biến đó ở Vercel. */
export async function removePage(id) {
  const sql = await getSql();
  const rows = await sql`SELECT source FROM pages WHERE id = ${String(id)}`;
  if (rows[0]?.source === "env" && process.env.FB_PAGE_ACCESS_TOKEN) {
    throw new Error("Page này lấy từ biến môi trường FB_PAGE_ACCESS_TOKEN — xóa biến đó trong Vercel để gỡ hẳn.");
  }
  await sql`DELETE FROM pages WHERE id = ${String(id)}`;
}

/** Token của 1 Page. Không tìm thấy thì dùng biến môi trường (tương thích cách cũ). */
export async function getPageToken(pageId) {
  const envToken = process.env.FB_PAGE_ACCESS_TOKEN || null;
  if (pageId) {
    try {
      const sql = await getSql();
      const rows = await sql`SELECT token, source FROM pages WHERE id = ${String(pageId)}`;
      const r = rows[0];
      if (r) return r.source === "env" && envToken ? envToken : r.token;
    } catch (e) {
      console.error("Không đọc được token Page:", e.message);
    }
  }
  return envToken;
}

/** Bật/tắt bot riêng cho 1 Page (Page tắt thì chỉ lưu tin nhắn, bot không trả lời). */
export async function setPageBot(id, enabled) {
  const sql = await getSql();
  await sql`UPDATE pages SET bot_enabled = ${Boolean(enabled)} WHERE id = ${String(id)}`;
}

/** Bot của Page này có đang bật không. Page chưa có trong danh sách thì coi như bật. */
export async function isPageBotEnabled(pageId) {
  if (!pageId) return true;
  try {
    const sql = await getSql();
    const rows = await sql`SELECT bot_enabled FROM pages WHERE id = ${String(pageId)}`;
    return rows[0] ? rows[0].bot_enabled !== false : true;
  } catch (e) {
    console.error("Không đọc được trạng thái bot của Page:", e.message);
    return true;
  }
}
