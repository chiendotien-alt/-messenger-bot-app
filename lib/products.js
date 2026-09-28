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

/**
 * Lọc sản phẩm theo Fanpage.
 *  - Sản phẩm có pageId  → chỉ dùng cho đúng Page đó.
 *  - Sản phẩm không có pageId (dữ liệu cũ / chọn "Tất cả Page") → dùng chung cho mọi Page.
 */
export function filterProductsForPage(products, pageId) {
  const pid = pageId ? String(pageId) : "";
  return (products || []).filter((p) => !p.pageId || String(p.pageId) === pid);
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
