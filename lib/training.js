// lib/training.js — câu trả lời chuẩn do chủ shop dạy bot (lưu trong Neon Postgres)
import { getSql } from "./db";

const MAX_EXAMPLES_IN_PROMPT = 40; // bot chỉ đọc tối đa ngần này ví dụ mới nhất (giữ tin nhắn nhanh + tiết kiệm)
const MAX_PROMPT_CHARS = 7000;

const clean = (t, max) => String(t || "").replace(/\r/g, "").trim().slice(0, max);

function mapRow(r) {
  return {
    id: r.id,
    productId: r.product_id || "",
    context: r.context || "",
    customer: r.customer_text,
    reply: r.reply_text,
    createdAt: r.created_at,
  };
}

export async function listTraining() {
  const sql = await getSql();
  const rows = await sql`SELECT * FROM bot_training ORDER BY id DESC LIMIT 500`;
  return rows.map(mapRow);
}

export async function addTraining({ productId, context, customer, reply }) {
  const c = clean(customer, 1000);
  const r = clean(reply, 2000);
  if (!c || !r) throw new Error("Cần có cả câu khách hỏi và câu bot trả lời chuẩn.");
  const sql = await getSql();
  const rows = await sql`INSERT INTO bot_training (product_id, context, customer_text, reply_text)
    VALUES (${productId ? String(productId) : null}, ${clean(context, 1500)}, ${c}, ${r}) RETURNING id`;
  return rows[0].id;
}

export async function updateTraining({ id, productId, customer, reply }) {
  const c = clean(customer, 1000);
  const r = clean(reply, 2000);
  if (!id || !c || !r) throw new Error("Thiếu nội dung cần sửa.");
  const sql = await getSql();
  await sql`UPDATE bot_training SET customer_text = ${c}, reply_text = ${r},
    product_id = ${productId ? String(productId) : null} WHERE id = ${Number(id)}`;
}

export async function deleteTraining(id) {
  const sql = await getSql();
  await sql`DELETE FROM bot_training WHERE id = ${Number(id)}`;
}

/**
 * Biến các ví dụ đã dạy thành một đoạn chữ đưa vào câu lệnh của bot.
 * Lấy ví dụ dùng chung + ví dụ của đúng sản phẩm khách đang hỏi (chưa biết sản phẩm thì lấy hết).
 * Không có ví dụ nào → trả chuỗi rỗng (bot chạy y như cũ).
 */
export async function getTrainingForPrompt(currentProductId) {
  const sql = await getSql();
  const rows = await sql`SELECT * FROM bot_training ORDER BY id DESC LIMIT 200`;
  const pid = currentProductId ? String(currentProductId) : "";
  const picked = rows
    .map(mapRow)
    .filter((e) => !e.productId || !pid || e.productId === pid)
    .slice(0, MAX_EXAMPLES_IN_PROMPT)
    .reverse(); // cũ → mới

  const blocks = [];
  let total = 0;
  for (const e of picked) {
    const replyLines = e.reply.split("\n").map((l) => l.trim()).filter(Boolean);
    const block =
      (e.context ? `(trước đó)\n${e.context}\n` : "") +
      `Khách: ${e.customer}\n` +
      replyLines.map((l, i) => (i === 0 ? `Shop: ${l}` : `Shop (tin kế tiếp): ${l}`)).join("\n");
    total += block.length;
    if (total > MAX_PROMPT_CHARS) break;
    blocks.push(block);
  }
  if (!blocks.length) return "";

  return `CÁCH TRẢ LỜI CHUẨN (chủ shop đã dạy — đây là cách nhắn ĐÚNG, ưu tiên hơn các quy tắc về phong cách ở trên)
Khi khách nói tình huống giống các ví dụ dưới đây, hãy trả lời theo đúng giọng điệu, cách dùng từ, độ dài và cách dẫn dắt của chủ shop. Không chép máy móc nếu hoàn cảnh khác, và vẫn phải đúng giá/thông tin theo danh sách sản phẩm. Mỗi dòng "Shop:" là một tin nhắn riêng.

${blocks.map((b, i) => `Ví dụ ${i + 1}:\n${b}`).join("\n\n")}`;
}
