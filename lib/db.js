// lib/db.js — kết nối Neon Postgres, tự tạo bảng nếu chưa có
import { neon } from "@neondatabase/serverless";

let sqlInstance = null;
let readyPromise = null;

export function getSql() {
  if (!readyPromise) {
    const url = process.env.DATABASE_URL || process.env.POSTGRES_URL;
    if (!url) {
      throw new Error("Chưa có DATABASE_URL — hãy kết nối Neon trong Vercel → Storage.");
    }
    sqlInstance = neon(url);
    readyPromise = init(sqlInstance).catch((err) => {
      readyPromise = null;
      throw err;
    });
  }
  return readyPromise.then(() => sqlInstance);
}

async function init(sql) {
  await sql`CREATE TABLE IF NOT EXISTS conversations (
    id TEXT PRIMARY KEY,
    name TEXT,
    avatar TEXT,
    profile_updated_at TIMESTAMPTZ,
    last_message TEXT,
    last_from TEXT,
    last_time TIMESTAMPTZ DEFAULT now()
  )`;
  await sql`ALTER TABLE conversations ADD COLUMN IF NOT EXISTS profile_error TEXT`;
  // Sản phẩm khách đang hỏi (suy ra từ câu hỏi quảng cáo họ bấm) — để các câu sau không nêu tên vẫn hiểu
  await sql`ALTER TABLE conversations ADD COLUMN IF NOT EXISTS current_product_id TEXT`;
  await sql`CREATE TABLE IF NOT EXISTS messages (
    id BIGSERIAL PRIMARY KEY,
    conversation_id TEXT NOT NULL,
    sender TEXT NOT NULL,
    text TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT now()
  )`;
  await sql`ALTER TABLE messages ADD COLUMN IF NOT EXISTS images JSONB`;
  await sql`CREATE INDEX IF NOT EXISTS idx_messages_conv ON messages (conversation_id, id)`;
  // Mỗi sự kiện Facebook (mid) chỉ xử lý 1 lần — Facebook có thể gửi lại (retry) cùng 1 tin
  await sql`CREATE TABLE IF NOT EXISTS processed_events (
    mid TEXT PRIMARY KEY,
    created_at TIMESTAMPTZ DEFAULT now()
  )`;
  // Câu mở đầu quảng cáo của mỗi sản phẩm chỉ gửi 1 lần cho mỗi khách
  await sql`CREATE TABLE IF NOT EXISTS opening_sent (
    conversation_id TEXT NOT NULL,
    product_id TEXT NOT NULL,
    sent_at TIMESTAMPTZ DEFAULT now(),
    PRIMARY KEY (conversation_id, product_id)
  )`;
  // Nhiều Fanpage: mỗi Page có token riêng; mỗi cuộc trò chuyện thuộc về 1 Page
  await sql`CREATE TABLE IF NOT EXISTS pages (
    id TEXT PRIMARY KEY,
    name TEXT,
    token TEXT NOT NULL,
    source TEXT DEFAULT 'manual',
    created_at TIMESTAMPTZ DEFAULT now()
  )`;
  await sql`ALTER TABLE pages ADD COLUMN IF NOT EXISTS bot_enabled BOOLEAN DEFAULT TRUE`;
  await sql`ALTER TABLE conversations ADD COLUMN IF NOT EXISTS page_id TEXT`;
  await sql`CREATE INDEX IF NOT EXISTS idx_conversations_page ON conversations (page_id, last_time DESC)`;
  // Đơn hàng nháp tạo từ khung chat (trang giao hàng sau này đọc bảng này)
  await sql`CREATE TABLE IF NOT EXISTS orders (
    id BIGSERIAL PRIMARY KEY,
    conversation_id TEXT NOT NULL,
    page_id TEXT,
    data JSONB NOT NULL,
    status TEXT DEFAULT 'draft',
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
  )`;
  await sql`CREATE INDEX IF NOT EXISTS idx_orders_conv ON orders (conversation_id, id DESC)`;
  // Thông tin khách bot đã ghi nhớ (tên nhận hàng, SĐT, địa chỉ, màu/size) — bot không hỏi lại
  await sql`ALTER TABLE conversations ADD COLUMN IF NOT EXISTS info JSONB`;
  await sql`CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value JSONB NOT NULL
  )`;
  // Câu trả lời chuẩn do chủ shop dạy bot (trang Quản lý sản phẩm → Dạy bot)
  await sql`CREATE TABLE IF NOT EXISTS bot_training (
    id SERIAL PRIMARY KEY,
    product_id TEXT,
    context TEXT DEFAULT '',
    customer_text TEXT NOT NULL,
    reply_text TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT now()
  )`;
  // Cả đoạn chat chuẩn do chủ shop dạy bot (nút "Dạy bot" ở trang chat chính)
  await sql`CREATE TABLE IF NOT EXISTS bot_training_chats (
    id SERIAL PRIMARY KEY,
    title TEXT DEFAULT '',
    product_id TEXT,
    messages JSONB NOT NULL,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
  )`;
}
