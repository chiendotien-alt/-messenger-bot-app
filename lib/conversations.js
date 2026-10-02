// lib/conversations.js — lưu lịch sử chat + hồ sơ khách (tên, ảnh) trong Neon Postgres
import { del } from "@vercel/blob";
import { getSql } from "./db";

const PROFILE_REFRESH_MS = 6 * 60 * 60 * 1000; // làm mới tên/ảnh mỗi 6 giờ (link ảnh có hạn)

/** from: "customer" | "bot" | "admin" */
export async function addMessage(senderId, from, text, images = [], pageId = null, sentAtMs = null) {
  const sql = await getSql();
  const imgs = images.length ? JSON.stringify(images) : null;
  const preview = text || (images.length ? "📷 Ảnh" : "");
  // sentAtMs = giờ khách THỰC SỰ gõ (event.timestamp của Facebook). Facebook có thể gửi webhook trễ vài giây,
  // nên không dùng giờ nhận (now()) để so sánh thứ tự tin. Không hợp lệ/ở tương lai → dùng now().
  const ms = Number(sentAtMs);
  const at = Number.isFinite(ms) && ms > 0 ? ms : null;
  const inserted = await sql`INSERT INTO messages (conversation_id, sender, text, images, created_at)
            VALUES (${senderId}, ${from}, ${text || ""}, ${imgs}::jsonb,
                    LEAST(COALESCE(to_timestamp(${at}::double precision / 1000.0), now()), now()))
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

/** Bot/admin vừa gửi đúng nội dung này cho khách trong vài chục giây? (để không lưu trùng tin echo) */
export async function isRecentOutgoingDuplicate(senderId, text, windowSec = 60) {
  if (!text) return false;
  const sql = await getSql();
  const rows = await sql`SELECT 1 FROM messages
                         WHERE conversation_id = ${senderId} AND sender IN ('bot', 'admin')
                           AND text = ${text}
                           AND created_at > now() - (${windowSec}::int * interval '1 second')
                         LIMIT 1`;
  return rows.length > 0;
}

/** Khách này đã từng được bot/chủ shop nhắn lại chưa? (chưa = khách mới, đang nhắn lần đầu) */
export async function hasOutgoingMessage(senderId) {
  const sql = await getSql();
  const rows = await sql`SELECT 1 FROM messages
                         WHERE conversation_id = ${senderId} AND sender IN ('bot', 'admin')
                         LIMIT 1`;
  return rows.length > 0;
}

/** Chủ shop đã tự nhắn cho khách này chưa? (có → coi như chủ shop đã mở lời hộ bot, không gửi lại câu mở đầu quảng cáo nữa) */
export async function hasAdminMessage(senderId) {
  const sql = await getSql();
  const rows = await sql`SELECT 1 FROM messages
                         WHERE conversation_id = ${senderId} AND sender = 'admin'
                         LIMIT 1`;
  return rows.length > 0;
}

/** id tin nhắn MỚI NHẤT của khách trong cuộc trò chuyện (để biết tin nào là tin cuối trong một loạt tin liền nhau). */
export async function getLatestCustomerMessageId(senderId) {
  const sql = await getSql();
  const rows = await sql`SELECT MAX(id) AS id FROM messages
                         WHERE conversation_id = ${senderId} AND sender = 'customer'`;
  return rows[0]?.id ?? null;
}

/** Các tin khách đã gửi kể từ lần cuối bot/chủ shop nhắn lại (cũ → mới). */
export async function getPendingCustomerMessages(senderId) {
  const sql = await getSql();
  return await sql`SELECT text, images FROM messages
                   WHERE conversation_id = ${senderId} AND sender = 'customer'
                     AND id > COALESCE((SELECT MAX(id) FROM messages
                                        WHERE conversation_id = ${senderId} AND sender IN ('bot', 'admin')), 0)
                   ORDER BY id ASC`;
}

/** Tin đầu tiên của khách (chưa ai trả lời) đã nhắn cách đây bao nhiêu mili giây? Không có → null. */
export async function getFirstPendingCustomerAgeMs(senderId) {
  const sql = await getSql();
  const rows = await sql`SELECT EXTRACT(EPOCH FROM (now() - MIN(created_at))) * 1000 AS age
                         FROM messages
                         WHERE conversation_id = ${senderId} AND sender = 'customer'
                           AND id > COALESCE((SELECT MAX(id) FROM messages
                                              WHERE conversation_id = ${senderId} AND sender IN ('bot', 'admin')), 0)`;
  const age = rows[0]?.age;
  return age === null || age === undefined ? null : Number(age);
}

/** Câu mở đầu gần nhất được gửi cho khách này cách đây bao nhiêu mili giây? Chưa gửi → null. */
export async function getLastOpeningAgeMs(senderId) {
  const sql = await getSql();
  const rows = await sql`SELECT EXTRACT(EPOCH FROM (now() - MAX(sent_at))) * 1000 AS age
                         FROM opening_sent WHERE conversation_id = ${senderId}`;
  const age = rows[0]?.age;
  return age === null || age === undefined ? null : Number(age);
}

/**
 * Tin khách này (tính theo GIỜ KHÁCH GÕ) có được gõ trước khi câu mở đầu gửi xong + burstMs không?
 * Có → là tin trong loạt đầu (gõ lúc bot đang chờ/đang gửi ảnh + mở đầu) → bot không trả lời riêng.
 * Dùng cho trường hợp Facebook gửi webhook trễ: tin đến sau khi mở đầu đã gửi nhưng thực ra khách gõ từ trước.
 */
export async function isInOpeningWindow(senderId, messageId, burstMs) {
  if (!messageId) return false;
  const sql = await getSql();
  const rows = await sql`SELECT 1 FROM messages m
                         JOIN opening_sent o ON o.conversation_id = m.conversation_id
                         WHERE m.id = ${messageId} AND m.conversation_id = ${senderId} AND m.sender = 'customer'
                           AND m.created_at <= o.sent_at + (${burstMs}::int * interval '1 millisecond')
                           AND NOT EXISTS (
                             SELECT 1 FROM messages x
                             WHERE x.conversation_id = m.conversation_id
                               AND x.sender IN ('bot', 'admin')
                               AND x.created_at > m.created_at
                               AND x.created_at < o.sent_at
                           )
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
// Số điện thoại Việt Nam trong tin nhắn khách: 0912345678, 0912 345 678, 0912.345.678, +84912345678, 84912345678, số bàn 02...
export const PHONE_SQL =
  "(^|[^0-9])(0|[+]?84)[[:space:].-]?([35789]([[:space:].-]?[0-9]){8}|2([[:space:].-]?[0-9]){9})([^0-9]|$)";
const PHONE_JS = /(?<![0-9])(?:0|\+?84)[\s.-]?(?:[35789](?:[\s.-]?[0-9]){8}|2(?:[\s.-]?[0-9]){9})(?![0-9])/;

/** Lấy số điện thoại (đã bỏ khoảng trắng/dấu chấm) từ 1 đoạn tin nhắn, không có thì trả null. */
export function extractPhone(text) {
  const m = String(text || "").match(PHONE_JS);
  return m ? m[0].replace(/[\s.-]/g, "") : null;
}

/**
 * Danh sách hội thoại. phoneOnly=true → chỉ giữ khách đã để lại số điện thoại (trong tin nhắn của khách).
 * Mỗi hội thoại trả thêm `phone` (số gần nhất khách để lại, hoặc null).
 */
/** from/to dạng "YYYY-MM-DD" (giờ Việt Nam): chỉ lấy cuộc chat có tin nhắn gần nhất trong khoảng đó. */
export async function listConversations(pageId = null, phoneOnly = false, from = null, to = null) {
  const sql = await getSql();
  const pid = pageId ? String(pageId) : null;
  const rows = await sql`SELECT c.id, c.name, c.avatar,
                          c.page_id AS "pageId",
                          c.last_message AS "lastMessage",
                          c.last_from AS "lastFrom",
                          c.last_time AS "lastTime",
                          ph.text AS "phoneText"
                   FROM conversations c
                   LEFT JOIN LATERAL (
                     SELECT m.text FROM messages m
                     WHERE m.conversation_id = c.id AND m.sender = 'customer'
                       AND m.text ~ ${PHONE_SQL}
                     ORDER BY m.id DESC LIMIT 1
                   ) ph ON true
                   WHERE (${pid}::text IS NULL OR c.page_id = ${pid})
                     AND (${phoneOnly}::boolean = false OR ph.text IS NOT NULL)
                     AND (${from}::date IS NULL OR c.last_time >= (${from}::date)::timestamp AT TIME ZONE 'Asia/Ho_Chi_Minh')
                     AND (${to}::date IS NULL OR c.last_time < ((${to}::date + 1)::timestamp AT TIME ZONE 'Asia/Ho_Chi_Minh'))
                   ORDER BY c.last_time DESC
                   LIMIT ${from || to ? 400 : 100}::int`;
  return rows.map(({ phoneText, ...c }) => ({ ...c, phone: extractPhone(phoneText) }));
}

export async function getConversation(senderId) {
  const sql = await getSql();
  const info = await sql`SELECT name, avatar, page_id AS "pageId", profile_error AS "profileError" FROM conversations WHERE id = ${senderId}`;
  const messages = await sql`SELECT sender AS "from", text, images, created_at AS time
                             FROM (
                               SELECT id, sender, text, images, created_at
                               FROM messages WHERE conversation_id = ${senderId}
                               ORDER BY created_at DESC, id DESC LIMIT 300
                             ) t
                             ORDER BY created_at ASC, id ASC`;
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
export async function getRecentMessages(senderId, limit = 22, burstMs = 0) {
  const sql = await getSql();
  // Bỏ các tin KHÁCH gõ trong "loạt tin đầu" (từ lúc khách mới nhắn tới hết burstMs sau khi bắt đầu gửi câu mở đầu).
  // Những tin đó chỉ dùng để kích hoạt ảnh mẫu + câu mở đầu, AI không đọc lại. Tin của bot/chủ shop vẫn giữ.
  return await sql`SELECT sender AS "from", text, images
                   FROM (
                     SELECT m.id, m.sender, m.text, m.images FROM messages m
                     WHERE m.conversation_id = ${senderId}
                       AND NOT (
                         m.sender = 'customer'
                         AND EXISTS (
                           SELECT 1 FROM opening_sent o
                           WHERE o.conversation_id = m.conversation_id
                             AND m.created_at <= o.sent_at + (${burstMs}::int * interval '1 millisecond')
                             AND NOT EXISTS (
                               SELECT 1 FROM messages x
                               WHERE x.conversation_id = m.conversation_id
                                 AND x.sender IN ('bot', 'admin')
                                 AND x.created_at > m.created_at
                                 AND x.created_at < o.sent_at
                             )
                         )
                       )
                     ORDER BY m.id DESC LIMIT ${limit}
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


/**
 * Sau khi chờ gom tin: còn tin NÀO MỚI HƠN của khách không (để tin mới nhất trả lời chung cho cả loạt)?
 * Tin mới giống hệt tin này (>= 8 ký tự, không ảnh) không tính — loại đó đã bị bỏ qua ở bước "tin trùng".
 */
export async function hasNewerDifferentCustomerMessage(senderId, messageId, text) {
  if (!messageId) return false;
  const sql = await getSql();
  const t = text || "";
  const rows = await sql`SELECT 1 FROM messages
                         WHERE conversation_id = ${senderId} AND sender = 'customer' AND id > ${messageId}
                           AND NOT (length(text) >= 8 AND text = ${t} AND images IS NULL)
                         LIMIT 1`;
  return rows.length > 0;
}

const INFO_KEYS = ["name", "phone", "address", "variant"];
const INFO_MAX = { name: 80, phone: 20, address: 300, variant: 120 };

/** Thông tin khách bot đã ghi nhớ: { name, phone, address, variant } (thiếu thì không có khóa). */
export async function getCustomerInfo(senderId) {
  const sql = await getSql();
  const rows = await sql`SELECT info FROM conversations WHERE id = ${senderId}`;
  const info = rows[0]?.info;
  return info && typeof info === "object" ? info : {};
}

/** Gộp thông tin mới vào thông tin cũ (chỉ ghi các ô có chữ; ô trống không xóa thông tin cũ). */
export async function mergeCustomerInfo(senderId, patch) {
  if (!patch || typeof patch !== "object") return;
  const clean = {};
  for (const k of INFO_KEYS) {
    const v = patch[k];
    if (typeof v !== "string") continue;
    const t = v.replace(/\s+/g, " ").trim().slice(0, INFO_MAX[k]);
    if (t) clean[k] = k === "phone" ? t.replace(/[\s.-]/g, "") : t;
  }
  if (!Object.keys(clean).length) return;
  const sql = await getSql();
  await sql`UPDATE conversations
            SET info = COALESCE(info, '{}'::jsonb) || ${JSON.stringify(clean)}::jsonb
            WHERE id = ${senderId}`;
}
