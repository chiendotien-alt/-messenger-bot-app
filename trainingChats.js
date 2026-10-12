// lib/trainingChats.js — cả đoạn chat chuẩn do chủ shop dạy bot (lưu trong Neon Postgres)
import { getSql } from "./db";

const MAX_MESSAGES = 60;
const clean = (t, max) => String(t || "").replace(/\r/g, "").trim().slice(0, max);

function cleanMessages(messages) {
  const out = [];
  for (const m of Array.isArray(messages) ? messages : []) {
    const text = clean(m?.text, 1500);
    if (!text) continue;
    out.push({ from: m.from === "customer" ? "customer" : "bot", text });
  }
  return out.slice(0, MAX_MESSAGES);
}

function mapRow(r) {
  return {
    id: r.id,
    title: r.title || "",
    productId: r.product_id || "",
    messages: Array.isArray(r.messages) ? r.messages : [],
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export async function listTrainingChats() {
  const sql = await getSql();
  const rows = await sql`SELECT * FROM bot_training_chats ORDER BY updated_at DESC LIMIT 200`;
  return rows.map(mapRow);
}

export async function saveTrainingChat({ id, title, productId, messages }) {
  const list = cleanMessages(messages);
  if (!list.some((m) => m.from === "customer") || !list.some((m) => m.from === "bot")) {
    throw new Error("Đoạn chat cần có ít nhất 1 tin của khách và 1 câu trả lời của bot.");
  }
  const firstCustomer = list.find((m) => m.from === "customer")?.text || "";
  const finalTitle = clean(title, 80) || clean(firstCustomer, 60);
  const sql = await getSql();
  const json = JSON.stringify(list);
  if (id) {
    await sql`UPDATE bot_training_chats SET title = ${finalTitle}, product_id = ${productId ? String(productId) : null},
      messages = ${json}::jsonb, updated_at = now() WHERE id = ${Number(id)}`;
    return Number(id);
  }
  const rows = await sql`INSERT INTO bot_training_chats (title, product_id, messages)
    VALUES (${finalTitle}, ${productId ? String(productId) : null}, ${json}::jsonb) RETURNING id`;
  return rows[0].id;
}

export async function deleteTrainingChat(id) {
  const sql = await getSql();
  await sql`DELETE FROM bot_training_chats WHERE id = ${Number(id)}`;
}
