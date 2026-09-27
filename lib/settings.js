// lib/settings.js — cài đặt hệ thống (vd: bật/tắt bot tự động trả lời)
import { list, put } from "@vercel/blob";

const PATH = "settings.json";

export async function getSettings() {
  try {
    const { blobs } = await list({ prefix: PATH });
    const file = blobs.find((b) => b.pathname === PATH);
    if (!file) return { botEnabled: true };
    const res = await fetch(file.url, { cache: "no-store" });
    if (!res.ok) return { botEnabled: true };
    return await res.json();
  } catch (err) {
    console.error("Lỗi đọc cài đặt:", err);
    return { botEnabled: true };
  }
}

export async function saveSettings(settings) {
  await put(PATH, JSON.stringify(settings), {
    access: "public",
    contentType: "application/json",
    addRandomSuffix: false,
    allowOverwrite: true,
  });
}
