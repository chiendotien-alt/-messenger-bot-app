// lib/conversations.js — lưu lịch sử chat + hồ sơ khách (tên, ảnh) trong Neon Postgres
import { del } from "@vercel/blob";
import { getSql } from "./db";

const PROFILE_REFRESH_MS = 6 * 60 * 60 * 1000; // làm mới tên/ảnh mỗi 6 giờ (link ảnh có hạn)

/** from: "customer" | "bot" | "admin" */
export async function addMessage(senderId, from, text, images = [], pageId = null) {
  const sql = await getSql();
  const imgs = images.length ? JSON.stringify(images) : null;
  const preview = text || (images.length ? "📷 Ảnh" : "");
  const inserted = await sql`INSERT INTO messages (conversation_id, sender, text, images)
            VALUES (${senderId}, ${from}, ${text || ""}, ${imgs}::jsonb)
            RETURNING id`;
  const pid = pageId ? String(pageId) : null;
  await sql`INSERT INTO conversations (id, last_message, last_from, last_time, page_id)
            VALUES (${senderId}, ${preview}, ${from}, now(), ${pid})
            ON CONFLICT (id) DO UPDATE
            SET last_message = EXCLUDED.last_message,
                last_from = EXCLUDED.last_from,
                last_time = now(),
                page_id = COALESCE(EXCLUDED.page_id, conversations.page_id)`;
  return inserted[0]?.id ?? null;
}

/**
 * Đánh dấu đã xử lý sự kiện Facebook (mid). Trả về false nếu sự kiện này đã được xử lý rồi
 * (Facebook gửi lại khi webhook phản hồi chậm).
 */
export async function claimEvent(mid) {
  if (!mid) return true;
  const sql = await getSql();
  const rows = await sql`INSERT INTO processed_events (mid) VALUES (${mid})
                         ON CONFLICT (mid) DO NOTHING RETURNING mid`;
  if (Math.random() < 0.02) {
    await sql`DELETE FROM processed_events WHERE created_at < now() - interval '2 days'`.catch(() => {});
  }
  return rows.length > 0;
}

/**
 * Khách bấm/gửi lại đúng câu đó trong vài phút? Chỉ tính khi đã có tin GIỐNG HỆT, gửi TRƯỚC tin này
 * (so theo id nên khi 2 tin đến cùng lúc, chỉ tin thứ 2 bị coi là trùng, tin đầu vẫn được trả lời).
 * Tin quá ngắn ("ok", "có") không tính vì có thể là câu trả lời hợp lệ cho 2 câu hỏi khác nhau.
 */
export async function isRepeatedMessage(senderId, text, messageId, windowSec = 120) {
  if (!messageId || !text || text.trim().length < 8) return false;
  const sql = await getSql();
  const rows = await sql`SELECT 1 FROM messages
                         WHERE conversation_id = ${senderId} AND sender = 'customer'
                           AND text = ${text} AND id < ${messageId}
                           AND created_at > now() - (${windowSec}::int * interval '1 second')
                         LIMIT 1`;
  return rows.length > 0;
}

/**
 * Giữ chỗ để gửi câu mở đầu của 1 sản phẩm cho 1 khách (an toàn khi 2 tin đến cùng lúc).
 * claimed=true → được phép gửi. claimed=false → đã gửi từ ageMs mili giây trước.
 */
export async function claimOpening(senderId, productId) {
  const sql = await getSql();
  const rows = await sql`INSERT INTO opening_sent (conversation_id, product_id)
                         VALUES (${senderId}, ${String(productId)})
                         ON CONFLICT DO NOTHING RETURNING sent_at`;
  if (rows.length) return { claimed: true, ageMs: 0 };
  const cur = await sql`SELECT EXTRACT(EPOCH FROM (now() - sent_at)) * 1000 AS age
                        FROM opening_sent
                        WHERE conversation_id = ${senderId} AND product_id = ${String(productId)}`;
  return { claimed: false, ageMs: Number(cur[0]?.age ?? Infinity) };
}

/** Trả lại chỗ đã giữ khi gửi thất bại, để lần sau còn gửi lại được. */
export async function releaseOpening(senderId, productId) {
  const sql = await getSql();
  await sql`DELETE FROM opening_sent
            WHERE conversation_id = ${senderId} AND product_id = ${String(productId)}`;
}

/** Sản phẩm khách đang quan tâm (nhớ từ câu hỏi quảng cáo họ bấm). */
export async function getCurrentProduct(senderId) {
  const sql = await getSql();
  const rows = await sql`SELECT current_product_id AS id FROM conversations WHERE id = ${senderId}`;
  return rows[0]?.id || null;
}

export async function setCurrentProduct(senderId, productId) {
  const sql = await getSql();
  await sql`UPDATE conversations SET current_product_id = ${String(productId)} WHERE id = ${senderId}`;
}

/** Tên khách đã lưu (từ hồ sơ Facebook) — để bot đoán cách xưng hô anh/chị. */
export async function getCustomerName(senderId) {
  const sql = await getSql();
  const rows = await sql`SELECT name FROM conversations WHERE id = ${senderId}`;
  return rows[0]?.name || null;
}

/** Lấy tên + ảnh đại diện của khách từ Facebook (thử nhiều cách, ghi lại lý do nếu thất bại). */
export async function ensureProfile(senderId, pageToken) {
  const token = pageToken || process.env.FB_PAGE_ACCESS_TOKEN;
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

/** pageId để trống → lấy hội thoại của tất cả các Page. */
export async function listConversations(pageId = null) {
  const sql = await getSql();
  const pid = pageId ? String(pageId) : null;
  return await sql`SELECT id, name, avatar,
                          page_id AS "pageId",
                          last_message AS "lastMessage",
                          last_from AS "lastFrom",
                          last_time AS "lastTime"
                   FROM conversations
                   WHERE (${pid}::text IS NULL OR page_id = ${pid})
                   ORDER BY last_time DESC
                   LIMIT 100`;
}

export async function getConversation(senderId) {
  const sql = await getSql();
  const info = await sql`SELECT name, avatar, page_id AS "pageId", profile_error AS "profileError" FROM conversations WHERE id = ${senderId}`;
  const messages = await sql`SELECT sender AS "from", text, images, created_at AS time
                             FROM (
                               SELECT id, sender, text, images, created_at
                               FROM messages WHERE conversation_id = ${senderId}
                               ORDER BY id DESC LIMIT 300
                             ) t
                             ORDER BY id ASC`;
  return {
    name: info[0]?.name || null,
    avatar: info[0]?.avatar || null,
    profileError: info[0]?.profileError || null,
    pageId: info[0]?.pageId || null,
    messages,
  };
}

/** Cuộc trò chuyện này thuộc Page nào (để biết dùng token nào khi chủ shop tự trả lời). */
export async function getConversationPageId(senderId) {
  const sql = await getSql();
  const rows = await sql`SELECT page_id AS "pageId" FROM conversations WHERE id = ${senderId}`;
  return rows[0]?.pageId || null;
}

/** Lấy N tin gần nhất của một khách (cũ → mới) để bot nhớ ngữ cảnh. */
export async function getRecentMessages(senderId, limit = 14) {
  const sql = await getSql();
  return await sql`SELECT sender AS "from", text, images
                   FROM (
                     SELECT id, sender, text, images FROM messages
                     WHERE conversation_id = ${senderId}
                     ORDER BY id DESC LIMIT ${limit}
                   ) t
                   ORDER BY id ASC`;
}

/** Xóa toàn bộ tin nhắn và hồ sơ của một khách. */
export async function deleteConversation(senderId) {
  const sql = await getSql();
  // Xóa ảnh khách gửi đã lưu trong Blob (KHÔNG đụng vào ảnh sản phẩm mà bot đã gửi)
  try {
    const rows = await sql`SELECT images FROM messages
                           WHERE conversation_id = ${senderId} AND sender = 'customer' AND images IS NOT NULL`;
    const urls = rows.flatMap((r) => r.images || []).filter((u) => u.includes("/chat-images/"));
    if (urls.length) await del(urls);
  } catch (e) {
    console.error("Không dọn được ảnh khách:", e.message);
  }
  await sql`DELETE FROM messages WHERE conversation_id = ${senderId}`;
  await sql`DELETE FROM opening_sent WHERE conversation_id = ${senderId}`;
  await sql`DELETE FROM conversations WHERE id = ${senderId}`;
}
