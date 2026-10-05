// lib/nudge.js — bot nhắn thêm 1 câu xin thông tin còn thiếu (màu/size, SĐT, địa chỉ...) khi khách im lặng quá thời gian chủ shop cài.
//
// Luồng hoạt động (khớp với luật hỏi lại trong webhook, cùng 1 ô "Thời gian hỏi lại thông tin"):
//  1) Lần đầu hỏi → bot trả lời tư vấn + hỏi xin thông tin luôn (không chờ).
//  2) Khách hỏi sang chuyện khác khi tin cuối của bot chưa quá askGapSec → bot chỉ trả lời, CHƯA hỏi lại thông tin đã hỏi.
//  3) Đếm giờ TỪ TIN CUỐI CỦA BOT (mỗi tin bot nhắn là đếm lại từ đầu). Đủ askGapSec:
//     - khách vẫn đang chat: lượt trả lời kế tiếp trả lời xong rồi xin tiếp thông tin còn thiếu (webhook lo phần này);
//     - khách im lặng: file này nhắn thêm 1 câu xin thông tin còn thiếu, vd "Mình cho em xin số điện thoại và địa chỉ để em lên đơn nhé?".
//     Thứ tự xin: màu/size → SĐT → địa chỉ → tên người nhận (tối đa 2 mục/lần). Khách đã đưa mục nào thì không xin mục đó.
//
// Khách đủ điều kiện khi:
//  - tin cuối là của bot (khách im) và đã đủ askGapSec giây kể từ tin đó, chưa quá hạn NUDGE_LATE_SEC — quá hạn thì bỏ, KHÔNG nhắn trễ
//  - khách nhắn lần cuối chưa quá 22 giờ (Facebook chỉ cho bot nhắn trong 24 giờ sau tin cuối của khách)
//  - vẫn còn thông tin cần xin (đủ màu/size, SĐT, địa chỉ rồi thì không nhắn nữa), chưa có đơn, chủ shop chưa nhắn tay
//  - bot tổng + bot của Page đó đang bật
//  - chưa nhắn câu này kể từ lần khách nhắn gần nhất
import { getSql } from "./db";
import { getSettings } from "./settings";
import { getPageToken } from "./pages";
import { getAllRawKeys } from "./apiKeys";
import { getRecentMessages, getCustomerName, getCustomerInfo, addMessage, getRecentOutgoingWithAge, PHONE_SQL } from "./conversations";
import { nudgeDue, nextMissing, topicLabels } from "./replyDedupe";
import { getProducts } from "./products";
import { askGeminiJson } from "./gemini";

export const DEFAULT_ASK_GAP_SEC = 180;
// Chỉ nhắn trong NUDGE_LATE_SEC giây kể từ lúc đến giờ. Quá khoảng này coi như lỡ, không nhắn muộn.
export const NUDGE_LATE_SEC = 600;

/** Đọc cài đặt hỏi lại / nhắn bồi từ settings (có giá trị mặc định). Đơn vị GIÂY (bản cũ lưu bằng phút thì tự đổi). */
export function readAskConfig(settings) {
  let raw = settings?.askGapSec;
  if ((raw === undefined || raw === null || raw === "") && settings?.askGapMin !== undefined && settings?.askGapMin !== null && settings?.askGapMin !== "") {
    raw = Number(settings.askGapMin) * 60; // bản trước lưu bằng phút
  }
  const n = raw === undefined || raw === null || raw === "" ? DEFAULT_ASK_GAP_SEC : Number(raw);
  const askGapSec = Number.isFinite(n) ? Math.min(14400, Math.max(0, n)) : DEFAULT_ASK_GAP_SEC;
  const lines = String(settings?.nudgeText || "")
    .split(/\n+/)
    .map((x) => x.trim())
    .filter(Boolean)
    .slice(0, 10);
  return { askGapSec, askGapMs: askGapSec * 1000, nudgeEnabled: settings?.nudgeEnabled === true, nudgeLines: lines };
}

// Khi AI soạn lỗi: KHÔNG gửi câu chung chung. Có thông tin còn thiếu → hỏi lại đúng phần đó; không thì ghép câu chốt từ sản phẩm/màu khách đã chọn. Không có gì để ghép thì bỏ qua, không nhắn.
function templateNudge(product, info, missing = []) {
  if (missing.length) return { skip: false, message: `Mình cho em xin ${topicLabels(missing)} để em lên đơn nhé?` };
  const raw = String(product?.name || "").replace(/\s+/g, " ").trim();
  if (!raw) return { skip: true, message: "" };
  const sp = raw.charAt(0).toLowerCase() + raw.slice(1);
  const mau = String(info?.variant || "").trim();
  return { skip: false, message: `Em lên đơn ${sp}${mau ? " " + mau : ""} cho mình nhé?` };
}

/**
 * Lọc thô bằng SQL (khách im, chưa có đơn, chưa bồi...), rồi lọc kỹ bằng JS:
 *  - đủ askGapSec kể từ TIN CUỐI CỦA BOT (nudgeDue)
 *  - còn thiếu thông tin cần xin (nextMissing) — đã đủ màu/size, SĐT, địa chỉ thì không bồi nữa
 */
export async function findNudgeCandidates(askGapSec, limit = 20) {
  const sql = await getSql();
  const gap = Math.max(30, Math.round(askGapSec));
  const rough = await sql`SELECT c.id, c.name, c.page_id AS "pageId", c.current_product_id AS "productId",
                          EXISTS (SELECT 1 FROM messages m WHERE m.conversation_id = c.id AND m.sender = 'customer' AND m.text ~ ${PHONE_SQL}) AS "phoneInMsg"
                   FROM conversations c
                   LEFT JOIN pages p ON p.id = c.page_id
                   WHERE c.last_from = 'bot'
                     AND c.last_time <= now() - (${gap}::int * interval '1 second')
                     AND c.last_time >= now() - ((${gap}::int + ${NUDGE_LATE_SEC}::int) * interval '1 second')
                     AND COALESCE(p.bot_enabled, TRUE) = TRUE
                     AND (SELECT MAX(m.created_at) FROM messages m
                          WHERE m.conversation_id = c.id AND m.sender = 'customer') > now() - interval '22 hours'
                     AND (c.nudge_sent_at IS NULL OR c.nudge_sent_at < (SELECT MAX(m.created_at) FROM messages m
                                                                       WHERE m.conversation_id = c.id AND m.sender = 'customer'))
                     AND NOT EXISTS (SELECT 1 FROM messages m WHERE m.conversation_id = c.id AND m.sender = 'admin')
                     AND NOT EXISTS (SELECT 1 FROM orders o WHERE o.conversation_id = c.id)
                   ORDER BY c.last_time ASC
                   LIMIT ${Math.max(limit * 4, 40)}`;

  const out = [];
  for (const c of rough) {
    if (out.length >= limit) break;
    const rows = await getRecentOutgoingWithAge(c.id, 15).catch(() => []);
    const d = nudgeDue(rows, { askGapMs: gap * 1000, lateMs: NUDGE_LATE_SEC * 1000 });
    if (!d.due) continue;
    const info = await getCustomerInfo(c.id).catch(() => ({}));
    if (c.phoneInMsg && !String(info.phone || "").trim()) info.phone = "(khách đã nhắn SĐT)";
    const need = nextMissing(info, rows);
    if (need.length) out.push({ ...c, need });
  }
  return out;
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

/** Soạn câu chốt: ưu tiên câu chủ shop tự viết (mỗi dòng 1 câu, hỗ trợ {sp} = tên sản phẩm, {mau} = màu/size đã chọn), không có thì nhờ Gemini soạn theo đoạn chat. */
async function composeNudge(cand, lines, keys, products, shopInfo, budgetMs) {
  const product = products.find((p) => String(p.id) === String(cand.productId));
  const info = await getCustomerInfo(cand.id).catch(() => ({}));
  // Thông tin tiếp theo còn thiếu (màu/size → SĐT → địa chỉ → tên) → câu nhắn xin đúng phần này
  const missing = cand.need || [];

  if (lines.length) {
    const line = lines[Math.floor(Math.random() * lines.length)];
    const msg = line
      .replace(/\{sp\}/gi, product?.name || "sản phẩm")
      .replace(/\{mau\}/gi, info?.variant || "")
      .replace(/\s{2,}/g, " ")
      .replace(/\s+([?!.,])/g, "$1")
      .trim();
    return { skip: false, message: msg };
  }

  const history = await getRecentMessages(cand.id, 14).catch(() => []);
  const chat = history
    .filter((m) => m.text && !/^📷/.test(m.text))
    .map((m) => `${m.from === "customer" ? "KHÁCH" : "SHOP"}: ${m.text}`)
    .join("\n");
  if (!keys.length || !chat) return templateNudge(product, info, missing);

  const name = cand.name || (await getCustomerName(cand.id).catch(() => null));

  const system = `Bạn là nhân viên bán hàng của shop, đang nhắn tin Messenger. Khách đã im lặng một lúc sau tin cuối của shop. Nhiệm vụ: viết ĐÚNG 1 câu thật ngắn để HỎI LẠI thông tin còn thiếu, giúp shop lên đơn.

QUY TẮC
- Nếu có mục "THÔNG TIN CÒN THIẾU CẦN XIN" → hỏi ĐÚNG các mục đó (tối đa 2 mục), nói khác câu shop đã hỏi trước đó, KHÔNG xin thêm mục nào khác. Vd: "Mình cho em xin số điện thoại và địa chỉ để em lên đơn nhé?" / "Chị lấy màu nào để em lên đơn ạ?".
- Nếu KHÔNG có mục đó → viết câu chốt đơn: "Em lên đơn váy vàng nhé chị?" / "Em lên đơn màu vàng size M cho mình nhé ạ?". Nhắc đúng sản phẩm + màu/size khách ĐÃ CHỌN hoặc đang hỏi trong đoạn chat (gọi ngắn gọn như khách hay gọi, vd "váy vàng", không đọc nguyên tên sản phẩm dài). Khách CHƯA chọn màu/size (sản phẩm có lựa chọn) → chỉ nhắc sản phẩm và hỏi khách lấy màu/size nào, KHÔNG tự chọn thay khách; không xin số điện thoại/địa chỉ.
- Đúng 1 câu, tối đa 90 ký tự, kết thúc bằng dấu "?". Chữ thường như nhắn tin, không markdown, không gạch đầu dòng, tối đa 1 emoji.
- Giữ ĐÚNG cách xưng hô shop đã dùng với khách trong đoạn chat (anh/chị/mình; xưng em hoặc shop); chưa rõ thì dùng "mình". 
- Không lặp nguyên văn câu shop vừa gửi cuối, không bịa giá/khuyến mãi/thời gian giao, không ép mua, không dọa hết hàng, không nói "nhắc lại", "thấy bạn im lặng".
- Nếu khách đã từ chối rõ ràng ("thôi", "không cần", "đã mua rồi"), đã nói lời tạm biệt/cảm ơn kết thúc, hoặc cuộc trò chuyện không phải về mua hàng → đặt skip = true.

TRẢ VỀ DUY NHẤT JSON: {"skip": false, "message": "nội dung tin nhắn"}  (skip = true thì message để rỗng)`;

  const text = `Tên khách trên Facebook: ${name || "(không có)"}
Sản phẩm khách đang quan tâm: ${product ? `${product.name} — ${(product.description || "").slice(0, 400)}` : "(chưa rõ)"}
Thông tin khách đã đưa: ${Object.keys(info).length ? JSON.stringify(info) : "(chưa có)"}
THÔNG TIN CÒN THIẾU CẦN XIN: ${missing.length ? topicLabels(missing) : "(không có)"}
Thông tin & quy tắc của shop: ${(shopInfo || "").trim().slice(0, 800) || "(không có)"}

ĐOẠN CHAT GẦN NHẤT:
${chat}`;

  const parsed = parseJson(await askGeminiJson({ system, text, keys, budgetMs }));
  if (!parsed) {
    console.error("Nhắn bồi: AI không trả về JSON hợp lệ (hết quota/key lỗi/quá giờ?), dùng câu ghép sẵn:", cand.id);
    return templateNudge(product, info, missing);
  }
  if (parsed.skip === true) return { skip: true, message: "" };
  const msg = stripNotes(parsed.message);
  if (msg.length < 5 || msg.length > 200) return templateNudge(product, info, missing);
  return { skip: false, message: msg };
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

/** Chạy 1 lượt nhắn bồi. force = bỏ qua kiểm tra bật/tắt (không dùng ngoài thử nghiệm). */
export async function runNudge({ deadlineMs = 24000, limit = 10 } = {}) {
  const t0 = Date.now();
  const settings = await getSettings();
  const cfg = readAskConfig(settings);
  if (!cfg.nudgeEnabled) return { ok: true, skipped: "Tính năng nhắn bồi đang TẮT", results: [] };
  if (settings.botEnabled === false) return { ok: true, skipped: "Bot tổng đang tắt", results: [] };
  if (cfg.askGapSec <= 0) return { ok: true, skipped: "Thời gian hỏi lại đang là 0 giây", results: [] };

  const candidates = await findNudgeCandidates(cfg.askGapSec, limit);
  if (!candidates.length) return { ok: true, skipped: "Không có khách nào cần nhắn bồi lúc này", results: [] };

  const keys = await getAllRawKeys();
  const products = await getProducts();
  const sql = await getSql();
  const results = [];

  for (const cand of candidates) {
    const left = deadlineMs - (Date.now() - t0);
    if (left < 6000) break; // hết giờ — khách còn lại để lần chạy sau

    // Giữ chỗ trước (chỉ 1 lần chạy được giữ chỗ cho 1 khách) để 2 lần chạy trùng nhau không bồi 2 lần
    const claimed = await sql`UPDATE conversations SET nudge_sent_at = now()
                              WHERE id = ${cand.id}
                                AND (nudge_sent_at IS NULL OR nudge_sent_at < (SELECT MAX(m.created_at) FROM messages m
                                                                              WHERE m.conversation_id = ${cand.id} AND m.sender = 'customer'))
                              RETURNING id`;
    if (!claimed.length) continue;

    try {
      const out = await composeNudge(cand, cfg.nudgeLines, keys, products, settings.botPrompt, Math.min(15000, left - 3000));
      if (out.skip) {
        results.push({ id: cand.id, status: "skipped" });
        continue;
      }
      // Soạn xong mà khách vừa nhắn thêm (hoặc bot/chủ shop vừa trả lời) → bỏ câu bồi, để tin mới được trả lời bình thường
      const still = await sql`SELECT last_from FROM conversations WHERE id = ${cand.id}`;
      if (still[0]?.last_from !== "bot") {
        results.push({ id: cand.id, status: "skipped", message: "(khách vừa nhắn thêm — không bồi)" });
        continue;
      }
      const token = await getPageToken(cand.pageId);
      if (!token) throw new Error("Không có token của Page");
      const sent = await sendText(token, cand.id, out.message);
      if (!sent.ok) {
        results.push({ id: cand.id, status: "error", message: sent.error });
        continue;
      }
      await addMessage(cand.id, "bot", out.message, [], cand.pageId).catch((e) => console.error("Không lưu tin bồi:", e.message));
      results.push({ id: cand.id, status: "sent", message: out.message });
      await new Promise((r) => setTimeout(r, 800));
    } catch (e) {
      console.error("Lỗi nhắn bồi:", cand.id, e.message);
      results.push({ id: cand.id, status: "error", message: String(e.message) });
    }
  }
  return { ok: true, results };
}

/**
 * Chạy kèm mỗi khi có tin nhắn về webhook (không cần dịch vụ hẹn giờ): chỉ chạy khi tính năng BẬT
 * và lần chạy trước cách đây >= 60 giây. Mỗi lần bồi tối đa 3 khách trong ~12 giây để không làm chậm webhook.
 */
const THROTTLE_MS = 60 * 1000;
export async function maybeRunNudge(settings) {
  const cfg = readAskConfig(settings);
  if (!cfg.nudgeEnabled || cfg.askGapSec <= 0) return null;
  const sql = await getSql();
  const now = Date.now();
  const claimed = await sql`INSERT INTO settings (key, value)
                            VALUES ('nudge_lastrun', ${JSON.stringify({ t: now })}::jsonb)
                            ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value
                            WHERE (settings.value->>'t')::bigint < ${now - THROTTLE_MS}
                            RETURNING key`;
  if (!claimed.length) return null;
  return await runNudge({ deadlineMs: 14000, limit: 3 });
}
