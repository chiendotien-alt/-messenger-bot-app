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
  await sql`CREATE TABLE IF NOT EXISTS messages (
    id BIGSERIAL PRIMARY KEY,
    conversation_id TEXT NOT NULL,
    sender TEXT NOT NULL,
    text TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT now()
  )`;
  await sql`CREATE INDEX IF NOT EXISTS idx_messages_conv ON messages (conversation_id, id)`;
  await sql`CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value JSONB NOT NULL
  )`;
}
