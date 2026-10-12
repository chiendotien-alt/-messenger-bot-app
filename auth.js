// lib/auth.js — đăng nhập 2 cấp: chủ shop (biến môi trường) và member cấp dưới (bảng members)
// Dùng được cả ở middleware (Edge) lẫn API route: chỉ dùng Web Crypto + atob.
import { getSql } from "./db";

const ITER = 20000;
const enc = new TextEncoder();

const toHex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
const fromHex = (hex) => new Uint8Array(hex.match(/.{2}/g).map((h) => parseInt(h, 16)));

async function derive(password, saltHex) {
  const key = await crypto.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt: fromHex(saltHex), iterations: ITER },
    key,
    256
  );
  return toHex(bits);
}

/** Tạo salt + hash cho mật khẩu mới. */
export async function hashPassword(password) {
  const salt = toHex(crypto.getRandomValues(new Uint8Array(16)));
  return { salt, hash: await derive(password, salt) };
}

function safeEqual(a, b) {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

function parseBasic(header) {
  if (!header || !/^basic /i.test(header)) return null;
  try {
    const raw = atob(header.split(" ")[1] || "");
    const bytes = Uint8Array.from(raw, (c) => c.charCodeAt(0));
    const text = new TextDecoder().decode(bytes);
    const i = text.indexOf(":");
    if (i < 0) return null;
    return { user: text.slice(0, i), pass: text.slice(i + 1) };
  } catch {
    return null;
  }
}

// Nhớ kết quả đăng nhập đúng trong 30 giây để không phải băm mật khẩu ở mỗi request
const cache = new Map();
const CACHE_MS = 30000;

/**
 * Kiểm tra header Authorization.
 * Trả về { role: "owner" } | { role: "member", id, name } | null (sai/không có).
 */
export async function authenticate(authHeader) {
  const cred = parseBasic(authHeader);
  if (!cred) return null;

  const ownerUser = process.env.ADMIN_USER || "admin";
  const ownerPass = process.env.ADMIN_PASSWORD;
  if (ownerPass && cred.user === ownerUser && safeEqual(cred.pass, ownerPass)) {
    return { role: "owner" };
  }

  const hit = cache.get(authHeader);
  if (hit && hit.exp > Date.now()) return hit.who;

  try {
    const sql = await getSql();
    const rows = await sql`SELECT id, name, salt, hash, active FROM members WHERE username = ${cred.user.toLowerCase()}`;
    const m = rows[0];
    if (!m || !m.active) return null;
    const h = await derive(cred.pass, m.salt);
    if (!safeEqual(h, m.hash)) return null;
    const who = { role: "member", id: m.id, name: m.name || cred.user };
    cache.set(authHeader, { who, exp: Date.now() + CACHE_MS });
    if (cache.size > 200) cache.clear();
    return who;
  } catch (e) {
    console.error("Lỗi kiểm tra member:", e);
    return null;
  }
}

/**
 * Dùng trong API route: ai đang gọi và họ được xem những gì.
 * (middleware đã xác thực và gắn header x-auth-role / x-auth-member — client không giả được vì bị ghi đè)
 * Owner → { role: "owner", isOwner: true }. Member → thêm pageIds, productIds (Set).
 */
export async function getScope(req) {
  const role = req.headers.get("x-auth-role");
  if (role === "owner") return { role, isOwner: true };
  const id = Number(req.headers.get("x-auth-member"));
  if (role !== "member" || !Number.isFinite(id)) return { role: "none", isOwner: false, pageIds: new Set(), productIds: new Set() };
  const sql = await getSql();
  const rows = await sql`SELECT page_ids, product_ids, active FROM members WHERE id = ${id}`;
  const m = rows[0];
  if (!m || !m.active) return { role: "none", isOwner: false, pageIds: new Set(), productIds: new Set() };
  return {
    role: "member",
    isOwner: false,
    id,
    pageIds: new Set((m.page_ids || []).map(String)),
    productIds: new Set((m.product_ids || []).map(String)),
  };
}

export const canSeePage = (scope, pageId) => scope.isOwner || (!!pageId && scope.pageIds.has(String(pageId)));
