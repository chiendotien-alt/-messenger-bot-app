// lib/replyLock.js — khóa theo TỪNG KHÁCH (mỗi cuộc chat 1 khóa riêng, khách này không làm khách khác phải chờ).
//
// Khi bot đang soạn/gửi trả lời cho 1 khách mà khách nhắn thêm, tin mới sẽ XẾP HÀNG chờ lượt trước xong
// rồi mới soạn. Nhờ vậy lượt sau thấy đủ những gì bot vừa nói (không hỏi lặp, không trả lời chồng nhau).
// Khóa nằm trong database (không phải trong bộ nhớ) vì Vercel chạy mỗi tin ở 1 máy riêng.
//
// An toàn: khóa tự hết hạn sau `leaseMs`; chờ quá `waitMs` hoặc database lỗi thì vẫn cho chạy luôn (không bao giờ để khách bị bỏ rơi).
import { getSql } from "./db";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Giành khóa của khách. Trả về mã khóa (token) nếu giành được, null nếu hết thời gian chờ / lỗi (khi đó cứ chạy không khóa). */
export async function acquireReplyLock(conversationId, { waitMs = 25000, leaseMs = 65000 } = {}) {
  if (!conversationId || !(waitMs > 0)) return null;
  const token = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  const deadline = Date.now() + waitMs;
  try {
    const sql = await getSql();
    for (;;) {
      const rows = await sql`INSERT INTO reply_locks (conversation_id, token, expires_at)
                             VALUES (${String(conversationId)}, ${token}, now() + (${leaseMs}::int * interval '1 millisecond'))
                             ON CONFLICT (conversation_id) DO UPDATE
                               SET token = EXCLUDED.token, expires_at = EXCLUDED.expires_at
                               WHERE reply_locks.expires_at < now()
                             RETURNING token`;
      if (rows.length) return token;
      if (Date.now() + 400 > deadline) {
        console.log("Chờ khóa trả lời quá lâu → cứ chạy:", conversationId);
        return null;
      }
      await sleep(350);
    }
  } catch (e) {
    console.error("Không lấy được khóa trả lời (bỏ qua, vẫn chạy):", e.message);
    return null;
  }
}

/** Trả khóa (chỉ trả được khóa của chính mình). */
export async function releaseReplyLock(conversationId, token) {
  if (!conversationId || !token) return;
  try {
    const sql = await getSql();
    await sql`DELETE FROM reply_locks WHERE conversation_id = ${String(conversationId)} AND token = ${token}`;
  } catch (e) {
    console.error("Không trả được khóa trả lời:", e.message);
  }
}
