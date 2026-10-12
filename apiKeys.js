// lib/apiKeys.js — quản lý nhiều API key Gemini (biến môi trường + key thêm từ trang quản trị) trong Neon Postgres
import { getSql } from "./db";

let tableReady = null;
async function ensureTable() {
  if (!tableReady) {
    tableReady = (async () => {
      const sql = await getSql();
      await sql`CREATE TABLE IF NOT EXISTS api_keys (
        id BIGSERIAL PRIMARY KEY,
        label TEXT,
        key TEXT NOT NULL UNIQUE,
        created_at TIMESTAMPTZ DEFAULT now()
      )`;
      return sql;
    })().catch((e) => {
      tableReady = null;
      throw e;
    });
  }
  return tableReady;
}

const mask = (k) => (k.length <= 10 ? "••••" : `${k.slice(0, 4)}••••${k.slice(-4)}`);

/** Danh sách key đầy đủ cho webhook dùng: [{ id, key }]. Không bao giờ trả ra ngoài trình duyệt. */
export async function getAllRawKeys() {
  const keys = [];
  const envKey = process.env.GOOGLE_API_KEY;
  if (envKey) keys.push({ id: "env", key: envKey });
  try {
    const sql = await ensureTable();
    const rows = await sql`SELECT id, key FROM api_keys ORDER BY id`;
    for (const r of rows) {
      if (r.key !== envKey) keys.push({ id: String(r.id), key: r.key });
    }
  } catch (e) {
    console.error("Không đọc được API key từ database:", e.message);
  }
  return keys;
}

/** Danh sách key đã che bớt để hiện trên trang quản trị. */
export async function listKeys() {
  const out = [];
  if (process.env.GOOGLE_API_KEY) {
    out.push({ id: "env", label: "Biến môi trường GOOGLE_API_KEY", masked: mask(process.env.GOOGLE_API_KEY), removable: false });
  }
  const sql = await ensureTable();
  const rows = await sql`SELECT id, label, key FROM api_keys ORDER BY id`;
  for (const r of rows) {
    out.push({ id: String(r.id), label: r.label || "", masked: mask(r.key), removable: true });
  }
  return out;
}

export async function addKey(key, label = "") {
  const clean = String(key || "").trim();
  if (clean.length < 20) throw new Error("API key không hợp lệ");
  const sql = await ensureTable();
  await sql`INSERT INTO api_keys (label, key) VALUES (${String(label || "").trim()}, ${clean})
            ON CONFLICT (key) DO NOTHING`;
}

export async function deleteKey(id) {
  const sql = await ensureTable();
  await sql`DELETE FROM api_keys WHERE id = ${Number(id)}`;
}
