// lib/settings.js — cài đặt hệ thống (vd: bật/tắt bot) lưu trong Neon Postgres
import { getSql } from "./db";

export async function getSettings() {
  try {
    const sql = await getSql();
    const rows = await sql`SELECT value FROM settings WHERE key = 'main'`;
    return rows[0]?.value || { botEnabled: true };
  } catch (err) {
    console.error("Lỗi đọc cài đặt:", err);
    return { botEnabled: true };
  }
}

export async function saveSettings(settings) {
  const sql = await getSql();
  await sql`INSERT INTO settings (key, value)
            VALUES ('main', ${JSON.stringify(settings)}::jsonb)
            ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`;
}
