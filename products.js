// lib/products.js
// Nguồn dữ liệu sản phẩm cho chatbot — lưu trong Vercel Blob (file JSON)
// để trang /admin có thể thêm/sửa/xóa mà không cần đụng vào code.

import { list } from "@vercel/blob";
import { getSql } from "./db";

const BLOB_PATH = "products.json";

// Sản phẩm giờ lưu trong Neon Postgres (nhanh, ghi xong là đọc thấy ngay).
// Dữ liệu cũ trong Vercel Blob được tự chuyển sang 1 lần duy nhất.
let tableReady = null;

async function ensureReady() {
  if (!tableReady) {
    tableReady = prepare().catch((err) => {
      tableReady = null;
      throw err;
    });
  }
  return tableReady;
}

async function readOldBlob() {
  const { blobs } = await list({ prefix: BLOB_PATH });
  const file = blobs.find((b) => b.pathname === BLOB_PATH);
  if (!file) return [];
  const res = await fetch(`${file.url}?t=${Date.now()}`, { cache: "no-store" });
  if (!res.ok) throw new Error("Không đọc được products.json cũ");
  const data = await res.json();
  return Array.isArray(data) ? data : [];
}

async function prepare() {
  const sql = await getSql();
  await sql`CREATE TABLE IF NOT EXISTS products (
    seq BIGSERIAL,
    id TEXT PRIMARY KEY,
    data JSONB NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT now()
  )`;
  const flag = await sql`SELECT 1 FROM settings WHERE key = 'products_migrated'`;
  if (flag.length) return sql;
  try {
    const old = await readOldBlob();
    for (const p of old) {
      if (!p?.id) continue;
      await sql`INSERT INTO products (id, data) VALUES (${String(p.id)}, ${JSON.stringify(p)}::jsonb)
                ON CONFLICT (id) DO NOTHING`;
    }
    await sql`INSERT INTO settings (key, value) VALUES ('products_migrated', 'true'::jsonb)
              ON CONFLICT (key) DO NOTHING`;
  } catch (err) {
    console.error("Chưa chuyển được sản phẩm cũ từ Blob (sẽ thử lại lần sau):", err);
  }
  return sql;
}

/** Lấy danh sách sản phẩm hiện tại. */
export async function getProducts() {
  try {
    await ensureReady();
    const sql = await getSql();
    const rows = await sql`SELECT data FROM products ORDER BY seq`;
    return rows.map((r) => r.data);
  } catch (err) {
    console.error("Lỗi đọc sản phẩm:", err);
    return [];
  }
}

/** Thêm sản phẩm mới, trả về id. Lỗi thì throw để giao diện báo cho người dùng. */
export async function addProduct(product) {
  await ensureReady();
  const sql = await getSql();
  const id = Date.now().toString() + Math.floor(Math.random() * 100).toString();
  const data = { ...product, id };
  await sql`INSERT INTO products (id, data) VALUES (${id}, ${JSON.stringify(data)}::jsonb)`;
  return id;
}

/** Sửa 1 sản phẩm. Trả về false nếu không tìm thấy. */
export async function updateProduct(product) {
  await ensureReady();
  const sql = await getSql();
  const rows = await sql`UPDATE products SET data = ${JSON.stringify(product)}::jsonb, updated_at = now()
                         WHERE id = ${String(product.id)} RETURNING id`;
  return rows.length > 0;
}

/** Xóa 1 sản phẩm. */
export async function deleteProduct(id) {
  await ensureReady();
  const sql = await getSql();
  await sql`DELETE FROM products WHERE id = ${String(id)}`;
}

/**
 * Ảnh gửi kèm câu mở đầu = những ảnh chủ shop đã TICK trong cài đặt sản phẩm (theo thứ tự tick).
 * Sản phẩm cũ chưa từng tick (chưa có openingImages) → giữ cách cũ: gửi các ảnh mẫu.
 */
export function openingImageList(p, max = 10) {
  const all = [...(p?.sampleImages || []), ...(p?.realImages || [])];
  const list = Array.isArray(p?.openingImages)
    ? p.openingImages.filter((u) => all.includes(u))
    : p?.sampleImages || [];
  return list.slice(0, max);
}

/** Các Page mà sản phẩm áp dụng. Rỗng = dùng chung cho mọi Page. (Vẫn đọc được dữ liệu cũ chỉ có pageId.) */
export function productPageIds(p) {
  if (Array.isArray(p?.pageIds)) return p.pageIds.map(String).filter(Boolean);
  return p?.pageId ? [String(p.pageId)] : [];
}

/**
 * Lọc sản phẩm theo Fanpage.
 *  - Sản phẩm có chọn Page (1 hoặc nhiều) → chỉ dùng cho đúng các Page đó.
 *  - Sản phẩm không chọn Page nào (dữ liệu cũ / "Tất cả Page") → dùng chung cho mọi Page.
 */
export function filterProductsForPage(products, pageId) {
  const pid = pageId ? String(pageId) : "";
  return (products || []).filter((p) => {
    const ids = productPageIds(p);
    return ids.length === 0 || ids.includes(pid);
  });
}

/** Bỏ dấu, chữ thường, gọn khoảng trắng — để so khớp tiếng Việt không phân biệt dấu. */
export const norm = (t) =>
  String(t || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d")
    .replace(/\s+/g, " ")
    .trim();

/** Như norm nhưng bỏ luôn dấu câu/emoji — để so câu hỏi sẵn không bị lệch vì "?" hay emoji. */
export const normKey = (t) => norm(t).replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();

/** Các câu hỏi quảng cáo soạn sẵn của 1 sản phẩm (mỗi dòng 1 câu). */
function triggerList(p) {
  return String(p.triggerQuestions || "")
    .split(/\n+/)
    .map(normKey)
    .filter((x) => x.length >= 4);
}

/**
 * Đoán khách đang hỏi sản phẩm nào từ nội dung tin nhắn.
 *  - exact=true : tin khớp đúng 1 câu hỏi quảng cáo soạn sẵn của sản phẩm (khách bấm câu hỏi có sẵn)
 *  - exact=false: tin có nhắc tên sản phẩm (hoặc chứa nguyên câu hỏi soạn sẵn)
 * Không khớp sản phẩm nào → null.
 */
export function matchProduct(text, products) {
  const t = normKey(text);
  if (!t || !products?.length) return null;

  for (const p of products) {
    if (triggerList(p).includes(t)) return { product: p, exact: true };
  }

  let best = null;
  for (const p of products) {
    const names = [normKey(p.name), ...triggerList(p).filter((x) => x.length >= 8 && t.includes(x))];
    for (const n of names) {
      if (n.length < 3) continue;
      if (` ${t} `.includes(` ${n} `) && (!best || n.length > best.len)) best = { product: p, len: n.length };
    }
  }
  return best ? { product: best.product, exact: false } : null;
}

function describeImages(urls, prefix, labels) {
  if (!urls?.length) return "không có";
  return urls
    .map((u, i) => `${prefix}${i + 1} ${labels[u] ? `"${labels[u]}"` : "(chưa đặt tên)"}`)
    .join("; ");
}

/**
 * Gói danh sách sản phẩm thành đoạn text để nhét vào system prompt.
 * Mỗi sản phẩm có id; mỗi ảnh có mã (S = ảnh mẫu, R = ảnh thực tế) và tên do chủ shop đặt,
 * để bot chọn đúng ảnh khi khách hỏi một mẫu/màu cụ thể.
 */
export function formatProductsForPrompt(products) {
  if (!products.length) {
    return "Hiện shop chưa cập nhật sản phẩm nào trong hệ thống.";
  }
  return products
    .map((p, i) => {
      const labels = p.imageLabels || {};
      return (
        `${i + 1}. [id: ${p.id}] ${p.name} — Tình trạng: ${p.stock || "Còn hàng"}\n` +
        `   Nội dung: ${p.description || "(chưa có)"}\n` +
        ((p.notes || "").trim() ? `   LƯU Ý CỦA CHỦ SHOP về sản phẩm này (bắt buộc tuân theo): ${p.notes.trim()}\n` : "") +
        `   Ảnh mẫu: ${describeImages(p.sampleImages, "S", labels)}\n` +
        `   Ảnh thực tế: ${describeImages(p.realImages, "R", labels)}\n` +
        `   Câu mở đầu quảng cáo soạn sẵn: ${(p.openingScript || "").trim() ? "CÓ" : "không"}`
      );
    })
    .join("\n\n");
}
