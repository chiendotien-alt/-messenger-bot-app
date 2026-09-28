// lib/conversations.js — lưu lịch sử chat + hồ sơ khách (tên, ảnh) trong Neon Postgres
import { getSql } from "./db";

const PROFILE_REFRESH_MS = 6 * 60 * 60 * 1000; // làm mới tên/ảnh mỗi 6 giờ (link ảnh có hạn)

/** from: "customer" | "bot" | "admin" */
export async function addMessage(senderId, from, text) {
  const sql = await getSql();
  await sql`INSERT INTO messages (conversation_id, sender, text)
            VALUES (${senderId}, ${from}, ${text})`;
  await sql`INSERT INTO conversations (id, last_message, last_from, last_time)
            VALUES (${senderId}, ${text}, ${from}, now())
            ON CONFLICT (id) DO UPDATE
            SET last_message = EXCLUDED.last_message,
                last_from = EXCLUDED.last_from,
                last_time = now()`;
}

/** Lấy tên + ảnh đại diện của khách từ Facebook (thử nhiều cách, ghi lại lý do nếu thất bại). */
export async function ensureProfile(senderId) {
  const token = process.env.FB_PAGE_ACCESS_TOKEN;
  if (!token) return;

  const sql = await getSql();
  const rows = await sql`SELECT name, profile_updated_at FROM conversations WHERE id = ${senderId}`;
  const row = rows[0];
  const age = row?.profile_updated_at
    ? Date.now() - new Date(row.profile_updated_at).getTime()
    : Infinity;

  if (row?.name && age < PROFILE_REFRESH_MS) return; // đã có tên, còn mới
  if (!row?.name && age < 5 * 60 * 1000) return; // chưa có tên: thử lại sau mỗi 5 phút

  const g = (path) => `https://graph.facebook.com/v21.0/${path}`;
  let name = null;
  let avatar = null;
  const errors = [];

  // Cách 1: User Profile API
  try {
    const d = await (
      await fetch(g(`${senderId}?fields=name,first_name,last_name,profile_pic&access_token=${token}`))
    ).json();
    if (d.error) {
      errors.push("Profile API: " + d.error.message);
    } else {
      name = d.name || [d.first_name, d.last_name].filter(Boolean).join(" ") || null;
      avatar = d.profile_pic || null;
      if (!name) errors.push("Profile API trả về rỗng (app chưa được cấp quyền xem hồ sơ khách)");
    }
  } catch (e) {
    errors.push("Profile API: " + e.message);
  }

  // Cách 2: lấy tên từ danh sách cuộc trò chuyện của Page
  if (!name) {
    try {
      const me = await (await fetch(g(`me?fields=id&access_token=${token}`))).json();
      const d = await (
        await fetch(
          g(`me/conversations?platform=messenger&user_id=${senderId}&fields=participants&access_token=${token}`)
        )
      ).json();
      if (d.error) {
        errors.push("Conversations API: " + d.error.message);
      } else {
        const parts = d.data?.[0]?.participants?.data || [];
        const p = parts.find((x) => x.id === senderId) || parts.find((x) => x.id !== me.id);
        if (p?.name) name = p.name;
        else errors.push("Conversations API: không thấy tên khách");
      }
    } catch (e) {
      errors.push("Conversations API: " + e.message);
    }
  }

  // Ảnh đại diện dự phòng (lấy link, không lộ token)
  if (!avatar) {
    try {
      const d = await (
        await fetch(g(`${senderId}/picture?redirect=false&type=large&access_token=${token}`))
      ).json();
      if (d.data?.url && !d.data.is_silhouette) avatar = d.data.url;
    } catch {}
  }

  const errText = name ? null : errors.join(" | ") || "Không rõ lý do";
  if (errText) console.error("Không lấy được tên khách:", errText);

  await sql`UPDATE conversations
            SET name = COALESCE(${name}, name),
                avatar = COALESCE(${avatar}, avatar),
                profile_error = ${errText},
                profile_updated_at = now()
            WHERE id = ${senderId}`;
}

export async function listConversations() {
  const sql = await getSql();
  return await sql`SELECT id, name, avatar,
                          last_message AS "lastMessage",
                          last_from AS "lastFrom",
                          last_time AS "lastTime"
                   FROM conversations
                   ORDER BY last_time DESC
                   LIMIT 100`;
}

export async function getConversation(senderId) {
  const sql = await getSql();
  const info = await sql`SELECT name, avatar, profile_error AS "profileError" FROM conversations WHERE id = ${senderId}`;
  const messages = await sql`SELECT sender AS "from", text, created_at AS time
                             FROM (
                               SELECT id, sender, text, created_at
                               FROM messages WHERE conversation_id = ${senderId}
                               ORDER BY id DESC LIMIT 300
                             ) t
                             ORDER BY id ASC`;
  return {
    name: info[0]?.name || null,
    avatar: info[0]?.avatar || null,
    profileError: info[0]?.profileError || null,
    messages,
  };
}

/** Lấy N tin gần nhất của một khách (cũ → mới) để bot nhớ ngữ cảnh. */
export async function getRecentMessages(senderId, limit = 14) {
  const sql = await getSql();
  return await sql`SELECT sender AS "from", text
                   FROM (
                     SELECT id, sender, text FROM messages
                     WHERE conversation_id = ${senderId}
                     ORDER BY id DESC LIMIT ${limit}
                   ) t
                   ORDER BY id ASC`;
}
