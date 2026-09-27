// lib/conversations.js — lưu lịch sử chat với từng khách qua Vercel Blob
import { list, put } from "@vercel/blob";

const PATH = "conversations.json";
const MAX_MESSAGES_PER_CONV = 200;

export async function getAllConversations() {
  try {
    const { blobs } = await list({ prefix: PATH });
    const file = blobs.find((b) => b.pathname === PATH);
    if (!file) return {};
    const res = await fetch(file.url, { cache: "no-store" });
    if (!res.ok) return {};
    return await res.json();
  } catch (err) {
    console.error("Lỗi đọc hội thoại:", err);
    return {};
  }
}

async function saveAllConversations(data) {
  await put(PATH, JSON.stringify(data), {
    access: "public",
    contentType: "application/json",
    addRandomSuffix: false,
    allowOverwrite: true,
  });
}

/**
 * Thêm 1 tin nhắn vào hội thoại của 1 khách.
 * from: "customer" | "bot" | "admin"
 */
export async function addMessage(senderId, from, text, senderName) {
  const all = await getAllConversations();
  if (!all[senderId]) {
    all[senderId] = { name: senderName || senderId, messages: [] };
  }
  if (senderName) all[senderId].name = senderName;

  all[senderId].messages.push({ from, text, time: new Date().toISOString() });

  if (all[senderId].messages.length > MAX_MESSAGES_PER_CONV) {
    all[senderId].messages = all[senderId].messages.slice(-MAX_MESSAGES_PER_CONV);
  }

  await saveAllConversations(all);
}

export async function getConversation(senderId) {
  const all = await getAllConversations();
  return all[senderId] || null;
}
