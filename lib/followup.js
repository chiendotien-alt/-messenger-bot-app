// lib/followup.js — nhắc khách quay lại (mỗi khách đúng 1 lần), chỉ với khách CHƯA để lại số điện thoại.
//
// Khách đủ điều kiện khi:
//  - tin cuối cùng là của bot (khách im lặng) và đã im quá `waitHours` giờ
//  - khách nhắn lần cuối chưa quá 22 giờ (Facebook chỉ cho bot nhắn trong 24 giờ sau tin cuối của khách)
//  - chưa có số điện thoại, chưa có đơn, chủ shop chưa nhắn tay, chưa từng được nhắc
//  - bot của Page đó đang bật
import { getSql } from "./db";
import { getSettings } from "./settings";
import { getPageToken } from "./pages";
import { getAllRawKeys } from "./apiKeys";
import { getRecentMessages, getCustomerName, getCustomerInfo, addMessage, PHONE_SQL } from "./conversations";
import { getProducts } from "./products";
import { askGeminiJson } from "./gemini";

export const DEFAULT_FALLBACKS = [
  "Dạ mình còn quan tâm sản phẩm bên shop không ạ? Cần shop tư vấn thêm gì mình cứ nhắn nhé.",
  "Shop nhắn hỏi thăm mình xíu, mình đã chọn được mẫu ưng ý chưa ạ? Cần hỗ trợ gì shop giúp liền nha.",
  "Dạ nếu mình còn phân vân thì cứ nhắn shop nhé, shop tư vấn kỹ hơn cho mình ạ.",
];

const DEFAULTS = {
  enabled: false, // mặc định TẮT — bật trên trang /admin/followup khi đã xem thử ổn
  waitHours: 3, // khách im lặng bao nhiêu giờ thì nhắc
  maxPerRun: 6, // mỗi lần chạy nhắc tối đa bao nhiêu khách
  startHour: 8, // chỉ nhắc trong khung giờ này (giờ Việt Nam)
  endHour: 21,
  fallbacks: DEFAULT_FALLBACKS,
};

const clampNum = (v, min, max, def) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : def;
};

export async function getFollowupConfig() {
  try {
    const sql = await getSql();
    const rows = await sql`SELECT value FROM settings WHERE key = 'followup'`;
    const v = rows[0]?.value || {};
    return normalizeConfig({ ...DEFAULTS, ...v });
  } catch (e) {
    console.error("Không đọc được cài đặt nhắc khách:", e.message);
    return { ...DEFAULTS };
  }
}

function normalizeConfig(c) {
  const fallbacks = (Array.isArray(c.fallbacks) ? c.fallbacks : [])
    .map((x) => String(x || "").trim())
    .filter(Boolean)
    .slice(0, 10);
  return {
    enabled: c.enabled === true,
    waitHours: clampNum(c.waitHours, 0.5, 20, DEFAULTS.waitHours),
    maxPerRun: Math.round(clampNum(c.maxPerRun, 1, 20, DEFAULTS.maxPerRun)),
    startHour: Math.round(clampNum(c.startHour, 0, 23, DEFAULTS.startHour)),
    endHour: Math.round(clampNum(c.endHour, 1, 24, DEFAULTS.endHour)),
    fallbacks: fallbacks.length ? fallbacks : DEFAULT_FALLBACKS,
  };
}

export async function saveFollowupConfig(patch) {
  const current = await getFollowupConfig();
  const next = normalizeConfig({ ...current, ...patch });
  const sql = await getSql();
  await sql`INSERT INTO settings (key, value) VALUES ('followup', ${JSON.stringify(next)}::jsonb)
            ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`;
  return next;
}

/** Giờ hiện tại ở Việt Nam (0-23). */
function vnHour() {
  const h = new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Ho_Chi_Minh", hour: "numeric", hour12: false }).format(new Date());
  return Number(h) % 24;
}

/** Danh sách khách đủ điều kiện nhắc (khách nhắn lâu nhất trước, vì sắp hết hạn 24 giờ). */
export async function findCandidates(cfg, limit = 100) {
  const sql = await getSql();
  const waitSec = Math.round(cfg.waitHours * 3600);
  return await sql`SELECT c.id, c.name, c.page_id AS "pageId", c.current_product_id AS "productId"
                   FROM conversations c
                   LEFT JOIN pages p ON p.id = c.page_id
                   WHERE c.followup_sent_at IS NULL
                     AND c.last_from = 'bot'
                     AND c.last_time <= now() - (${waitSec}::int * interval '1 second')
                     AND COALESCE(p.bot_enabled, TRUE) = TRUE
                     AND COALESCE(c.bot_off, FALSE) = FALSE
                     AND (SELECT MAX(m.created_at) FROM messages m
                          WHERE m.conversation_id = c.id AND m.sender = 'customer') > now() - interval '22 hours'
                     AND NOT EXISTS (SELECT 1 FROM messages m WHERE m.conversation_id = c.id AND m.sender = 'admin')
                     AND NOT EXISTS (SELECT 1 FROM messages m
                                     WHERE m.conversation_id = c.id AND m.sender = 'customer' AND m.text ~ ${PHONE_SQL})
                     AND COALESCE(c.info->>'phone', '') = ''
                     AND NOT EXISTS (SELECT 1 FROM orders o WHERE o.conversation_id = c.id)
                   ORDER BY (SELECT MAX(m.created_at) FROM messages m
                             WHERE m.conversation_id = c.id AND m.sender = 'customer') ASC
                   LIMIT ${limit}`;
}

export async function getFollowupStats() {
  const sql = await getSql();
  const sent = await sql`SELECT count(*)::int AS n FROM conversations WHERE followup_status = 'sent'`;
  const recent = await sql`SELECT id, name, followup_status AS status, followup_text AS text, followup_sent_at AS "at"
                           FROM conversations WHERE followup_status IS NOT NULL
                           ORDER BY followup_sent_at DESC LIMIT 10`;
  return { sentTotal: sent[0]?.n || 0, recent };
}

function stripNotes(t) {
  return String(t || "")
    .replace(/📷?\s*\[\s*(Bot|Shop|Hệ thống|Khách)\s+đã\s+gửi[^\]]*\]?/gi, "")
    .replace(/📷/g, "")
    .replace(/\s+\n/g, "\n")
    .trim();
}

function parseJson(raw) {
  const cleaned = String(raw || "").replace(/```json|```/g, "").trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    const m = cleaned.match(/\{[\s\S]*\}/);
    if (m) {
      try {
        return JSON.parse(m[0]);
      } catch {}
    }
    return null;
  }
}

const pickFallback = (cfg) => cfg.fallbacks[Math.floor(Math.random() * cfg.fallbacks.length)];

/** Nhờ Gemini soạn 1 tin nhắc dựa trên đoạn chat của khách đó. Trả { skip, message, usedFallback }. */
async function composeMessage(cand, cfg, keys, products, shopInfo, budgetMs) {
  const history = await getRecentMessages(cand.id, 14).catch(() => []);
  const chat = history
    .filter((m) => m.text && !/^📷/.test(m.text))
    .map((m) => `${m.from === "customer" ? "KHÁCH" : "SHOP"}: ${m.text}`)
    .join("\n");
  const fb = { skip: false, message: pickFallback(cfg), usedFallback: true };
  if (!keys.length || !chat) return fb;

  const name = cand.name || (await getCustomerName(cand.id).catch(() => null));
  const info = await getCustomerInfo(cand.id).catch(() => ({}));
  const product = products.find((p) => String(p.id) === String(cand.productId));

  const system = `Bạn là nhân viên bán hàng của shop, đang nhắn tin Messenger. Khách đã im lặng một lúc sau tin cuối của shop. Nhiệm vụ: viết ĐÚNG 1 tin nhắn ngắn để hỏi thăm nhẹ nhàng xem khách còn quan tâm không.

QUY TẮC
- 1 đến 2 câu, tối đa 220 ký tự. Chữ thường như nhắn tin, không markdown, không gạch đầu dòng, tối đa 1 emoji.
- Dựa vào đoạn chat: nhắc đúng thứ khách đang quan tâm (sản phẩm, màu/size, câu khách hỏi dở) rồi hỏi 1 câu nhẹ nhàng, cụ thể. Không ép mua, không dọa hết hàng, không tạo áp lực.
- Giữ ĐÚNG cách xưng hô shop đã dùng với khách trong đoạn chat (anh/chị/mình); chưa rõ thì dùng "mình". Xưng "shop".
- Không bịa giá, khuyến mãi, thời gian giao. Không lặp nguyên văn câu shop đã nói. Không nói "nhắc lại", "thấy bạn im lặng".
- Không xin số điện thoại ngay trong tin này, trừ khi khách đang muốn mua và chưa đưa thông tin.
- Nếu khách đã từ chối rõ ràng ("thôi", "không cần", "đã mua rồi"), đã nói lời tạm biệt/cảm ơn kết thúc, hoặc cuộc trò chuyện không phải về mua hàng → đặt skip = true.

TRẢ VỀ DUY NHẤT JSON: {"skip": false, "message": "nội dung tin nhắn"}  (skip = true thì message để rỗng)`;

  const text = `Tên khách trên Facebook: ${name || "(không có)"}
Sản phẩm khách đang quan tâm: ${product ? `${product.name} — ${(product.description || "").slice(0, 500)}` : "(chưa rõ)"}
Thông tin khách đã đưa: ${Object.keys(info).length ? JSON.stringify(info) : "(chưa có)"}
Thông tin & quy tắc của shop: ${(shopInfo || "").trim().slice(0, 1200) || "(không có)"}

ĐOẠN CHAT GẦN NHẤT:
${chat}`;

  const raw = await askGeminiJson({ system, text, keys, budgetMs });
  const parsed = parseJson(raw);
  if (!parsed) return fb;
  if (parsed.skip === true) return { skip: true, message: "", usedFallback: false };
  const msg = stripNotes(parsed.message);
  if (msg.length < 5 || msg.length > 400) return fb;
  return { skip: false, message: msg, usedFallback: false };
}

async function sendText(token, recipientId, text) {
  const res = await fetch(`https://graph.facebook.com/v21.0/me/messages?access_token=${token}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ recipient: { id: recipientId }, message: { text }, messaging_type: "RESPONSE" }),
  });
  if (res.ok) return { ok: true };
  const err = await res.json().catch(() => ({}));
  return { ok: false, error: err?.error?.message || `HTTP ${res.status}` };
}

/**
 * Chạy 1 lượt nhắc.
 *  - dryRun=true : chỉ soạn thử, KHÔNG gửi, KHÔNG đánh dấu (để chủ shop xem trước)
 *  - bỏ qua kiểm tra bật/tắt + khung giờ khi dryRun hoặc force
 */
export async function runFollowup({ dryRun = false, force = false, deadlineMs = 24000, limit: limitOverride = null } = {}) {
  const t0 = Date.now();
  const cfg = await getFollowupConfig();

  if (!dryRun && !force) {
    if (!cfg.enabled) return { ok: true, skipped: "Tính năng nhắc khách đang TẮT", results: [] };
    const settings = await getSettings();
    if (settings.botEnabled === false) return { ok: true, skipped: "Bot tổng đang tắt", results: [] };
    const h = vnHour();
    if (h < cfg.startHour || h >= cfg.endHour) {
      return { ok: true, skipped: `Ngoài khung giờ nhắc (${cfg.startHour}h–${cfg.endHour}h)`, results: [] };
    }
  }

  const limit = dryRun ? Math.min(5, cfg.maxPerRun) : limitOverride || cfg.maxPerRun;
  const candidates = await findCandidates(cfg, limit);
  if (!candidates.length) return { ok: true, skipped: "Không có khách nào cần nhắc lúc này", results: [] };

  const keys = await getAllRawKeys();
  const products = await getProducts();
  const settings = await getSettings();
  const sql = await getSql();
  const results = [];

  for (const cand of candidates) {
    const left = deadlineMs - (Date.now() - t0);
    if (left < 6000) break; // hết giờ — các khách còn lại để lần chạy sau

    // Giữ chỗ trước để 2 lần chạy trùng nhau không nhắc 1 khách 2 lần
    if (!dryRun) {
      const claimed = await sql`UPDATE conversations SET followup_sent_at = now(), followup_status = 'sending'
                                WHERE id = ${cand.id} AND followup_sent_at IS NULL RETURNING id`;
      if (!claimed.length) continue;
    }

    try {
      const out = await composeMessage(cand, cfg, keys, products, settings.botPrompt, Math.min(15000, left - 3000));
      const label = cand.name || `Khách ${String(cand.id).slice(-4)}`;

      if (out.skip) {
        if (!dryRun) await sql`UPDATE conversations SET followup_status = 'skipped' WHERE id = ${cand.id}`;
        results.push({ id: cand.id, name: label, status: "skipped", message: "(khách đã từ chối/kết thúc — không nhắc)" });
        continue;
      }
      if (dryRun) {
        results.push({ id: cand.id, name: label, status: "preview", message: out.message, usedFallback: out.usedFallback });
        continue;
      }

      const token = await getPageToken(cand.pageId);
      if (!token) throw new Error("Không có token của Page");
      const sent = await sendText(token, cand.id, out.message);
      if (!sent.ok) {
        await sql`UPDATE conversations SET followup_status = 'error', followup_text = ${sent.error} WHERE id = ${cand.id}`;
        results.push({ id: cand.id, name: label, status: "error", message: sent.error });
        continue;
      }
      await addMessage(cand.id, "bot", out.message, [], cand.pageId).catch((e) => console.error("Không lưu tin nhắc:", e.message));
      await sql`UPDATE conversations SET followup_status = 'sent', followup_text = ${out.message} WHERE id = ${cand.id}`;
      results.push({ id: cand.id, name: label, status: "sent", message: out.message, usedFallback: out.usedFallback });
      await new Promise((r) => setTimeout(r, 800)); // nghỉ chút giữa các khách
    } catch (e) {
      console.error("Lỗi nhắc khách:", cand.id, e.message);
      if (!dryRun) {
        await sql`UPDATE conversations SET followup_status = 'error', followup_text = ${String(e.message).slice(0, 200)} WHERE id = ${cand.id}`.catch(() => {});
      }
      results.push({ id: cand.id, name: cand.name || cand.id, status: "error", message: String(e.message) });
    }
  }
  return { ok: true, results };
}

/**
 * Tự chạy nhắc khách mà KHÔNG cần dịch vụ hẹn giờ bên ngoài: được gọi mỗi khi có tin nhắn về webhook.
 * Chỉ thật sự chạy nếu tính năng đang BẬT và lần chạy trước cách đây >= 5 phút (giữ chỗ bằng 1 câu SQL nên không chạy trùng).
 * Mỗi lần chỉ nhắc tối đa 3 khách trong ~18 giây để không làm chậm webhook.
 */
const THROTTLE_MS = 5 * 60 * 1000;
export async function maybeRunFollowup() {
  const cfg = await getFollowupConfig();
  if (!cfg.enabled) return null;
  const sql = await getSql();
  const now = Date.now();
  const claimed = await sql`INSERT INTO settings (key, value)
                            VALUES ('followup_lastrun', ${JSON.stringify({ t: now })}::jsonb)
                            ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value
                            WHERE (settings.value->>'t')::bigint < ${now - THROTTLE_MS}
                            RETURNING key`;
  if (!claimed.length) return null;
  return await runFollowup({ deadlineMs: 18000, limit: Math.min(3, cfg.maxPerRun) });
}
