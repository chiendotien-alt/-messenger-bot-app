// lib/products.js
// Nguồn dữ liệu sản phẩm cho chatbot — lưu trong Vercel Blob (file JSON)
// để trang /admin có thể thêm/sửa/xóa mà không cần đụng vào code.

import { list, put } from "@vercel/blob";

const BLOB_PATH = "products.json";

/**
 * Lấy danh sách sản phẩm hiện tại.
 */
export async function getProducts() {
  try {
    const { blobs } = await list({ prefix: BLOB_PATH });
    const file = blobs.find((b) => b.pathname === BLOB_PATH);
    if (!file) return [];
    const res = await fetch(file.url, { cache: "no-store" });
    if (!res.ok) return [];
    return await res.json();
  } catch (err) {
    console.error("Lỗi đọc sản phẩm:", err);
    return [];
  }
}

/**
 * Ghi đè toàn bộ danh sách sản phẩm.
 */
export async function saveProducts(products) {
  await put(BLOB_PATH, JSON.stringify(products, null, 2), {
    access: "public",
    contentType: "application/json",
    addRandomSuffix: false,
    allowOverwrite: true,
  });
}

/**
 * Gói danh sách sản phẩm thành đoạn text ngắn gọn để nhét vào system prompt.
 */
export function formatProductsForPrompt(products) {
  if (!products.length) {
    return "Hiện shop chưa cập nhật sản phẩm nào trong hệ thống.";
  }
  return products
    .map(
      (p, i) =>
        `${i + 1}. ${p.name} — Giá: ${p.price} — Tình trạng: ${p.stock || "Còn hàng"}\n   Mô tả: ${p.description || ""}`
    )
    .join("\n\n");
}

