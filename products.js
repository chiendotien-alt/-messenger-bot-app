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
    const res = await fetch(`${file.url}?t=${Date.now()}`, { cache: "no-store" });
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
        `   Ảnh mẫu: ${describeImages(p.sampleImages, "S", labels)}\n` +
        `   Ảnh thực tế: ${describeImages(p.realImages, "R", labels)}\n` +
        `   Câu mở đầu quảng cáo soạn sẵn: ${(p.openingScript || "").trim() ? "CÓ" : "không"}`
      );
    })
    .join("\n\n");
}
