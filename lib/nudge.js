// lib/nudge.js — bot nhắn thêm 1 câu CHỐT ĐƠN ngắn khi khách im lặng quá thời gian chủ shop cài.
//
// Luồng hoạt động (khớp với luật hỏi lại trong webhook):
//  1) Khách hỏi → bot trả lời tư vấn + hỏi chốt luôn (lần đầu hỏi không chờ).
//  2) Khách hỏi sang chuyện khác → bot trả lời ngay, chưa hỏi lại câu chốt (webhook lo phần này).
//  3) Khách im quá askGapSec giây (cùng 1 ô "Thời gian hỏi lại thông tin") → bot nhắn thêm 1 câu:
//     - shop đang hỏi xin thông tin (size, màu, địa chỉ...) mà khách chưa trả lời → HỎI LẠI câu NGẮN hơn, ĐỔI cách nói
//       (vd "Chị cho em xin chiều cao cân nặng nha?"), không chép lại câu cũ;
//     - không có gì còn thiếu → câu chốt ngắn, vd "Em lên đơn váy vàng nhé chị?". Mỗi lần khách nhắn chỉ có 1 câu.
//
// Khách đủ điều kiện khi:
//  - tin cuối cùng là của bot (khách im) và đã im từ askGapSec giây (tối thiểu 30 giây)
//  - VÀ chưa im quá lâu so với mốc đó (NUDGE_LATE_SEC) — quá hạn thì bỏ, KHÔNG nhắn trễ giờ sau
//  - khách nhắn lần cuối chưa quá 22 giờ (Facebook chỉ cho bot nhắn trong 24 giờ sau tin cuối của khách)
//  - chưa có số điện thoại, chưa có đơn, chủ shop chưa nhắn tay
//  - bot tổng + bot của Page đó đang bật
//  - chưa nhắn câu chốt này kể từ lần khách nhắn gần nhất
import { getSql } from "./db";
import { getSettings } from "./settings";
import { getPageToken } from "./pages";
import { getAllRawKeys } from "./apiKeys";
import { getRecentMessages, getCustomerName, getCustomerInfo, addMessage, getRecentOutgoingWithAge, PHONE_SQL } from "./conversations";
import { askedTopics, buildShortAsk } from "./replyDedupe";
import { getProducts } from "./products";
import { askGeminiJson } from "./gemini";

export const DEFAULT_ASK_GAP_SEC = 180;
// Chỉ nhắn trong khoảng [askGapSec, askGapSec + NUDGE_LATE_SEC] kể từ tin cuối của bot. Quá khoảng này coi như lỡ, không nhắn muộn.
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

const FALLBACK = "Mình chọn được mẫu ưng ý chưa ạ, để shop lên đơn cho mình nhé?";

export async function findNudgeCandidates(askGapSec, limit = 20) {
  const sql = await getSql();
  const waitSec = Math.max(30, Math.round(askGapSec)); // bồi sớm nhất sau 30 giây
  return await sql`SELECT c.id, c.name, c.page_id AS "pageId", c.current_product_id AS "productId"
                   FROM conversations c
                   LEFT JOIN pages p ON p.id = c.page_id
                   WHERE c.last_from = 'bot'
                     AND c.last_time <= now() - (${waitSec}::int * interval '1 second')
                     AND c.last_time >= now() - ((${waitSec}::int + ${NUDGE_LATE_SEC}::int) * interval '1 second')
                     AND COALESCE(p.bot_enabled, TRUE) = TRUE
                     AND COALESCE(c.bot_off, FALSE) = FALSE
                     AND (SELECT MAX(m.created_at) FROM messages m
                          WHERE m.conversation_id = c.id AND m.sender = 'customer') > now() - interval '22 hours'
                     AND (c.nudge_sent_at IS NULL OR c.nudge_sent_at < (SELECT MAX(m.created_at) FROM messages m
                                                                       WHERE m.conversation_id = c.id AND m.sender = 'customer'))
                     AND NOT EXISTS (SELECT 1 FROM messages m WHERE m.conversation_id = c.id AND m.sender = 'admin')
                     AND NOT EXISTS (SELECT 1 FROM messages m
                                     WHERE m.conversation_id = c.id AND m.sender = 'customer' AND m.text ~ ${PHONE_SQL})
                     AND COALESCE(c.info->>'phone', '') = ''
                     AND NOT EXISTS (SELECT 1 FROM orders o WHERE o.conversation_id = c.id)
                   ORDER BY c.last_time ASC
                   LIMIT ${limit}`;
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

  // Thông tin shop đã hỏi ở các tin gần nhất (khách im nên có thể chưa trả lời)
  const outRows = await getRecentOutgoingWithAge(cand.id, 4).catch(() => []);
  const pending = new Set();
  for (const r of outRows) for (const t of askedTopics(r.text)) pending.add(t);
  if (info?.address) pending.delete("dia chi");
  if (info?.name) pending.delete("ten nguoi nhan");
  if (info?.phone) pending.delete("so dien thoai");
  const needReask = pending.size > 0;
  const lastAsk = outRows.find((r) => askedTopics(r.text).size)?.text || "";
  const avoid = outRows.map((r) => r.text);
  const shortFallback = () => buildShortAsk(pending, { refText: lastAsk, avoid });

  const pickOwnLine = () => {
    const line = lines[Math.floor(Math.random() * lines.length)];
    return line
      .replace(/\{sp\}/gi, product?.name || "sản phẩm")
      .replace(/\{mau\}/gi, info?.variant || "")
      .replace(/\s{2,}/g, " ")
      .replace(/\s+([?!.,])/g, "$1")
      .trim();
  };

  // Chủ shop tự viết câu chốt và không có thông tin nào còn thiếu → dùng câu của chủ shop
  if (lines.length && !needReask) return { skip: false, message: pickOwnLine() };

  const history = await getRecentMessages(cand.id, 14).catch(() => []);
  const chat = history
    .filter((m) => m.text && !/^📷/.test(m.text))
    .map((m) => `${m.from === "customer" ? "KHÁCH" : "SHOP"}: ${m.text}`)
    .join("\n");
  if (!keys.length || !chat) return { skip: false, message: needReask && shortFallback() ? shortFallback() : lines.length ? pickOwnLine() : FALLBACK };

  const name = cand.name || (await getCustomerName(cand.id).catch(() => null));

  const reaskSystem = `Bạn là nhân viên bán hàng của shop, đang nhắn tin Messenger. Khách đã im lặng một lúc sau tin cuối của shop. Trong đoạn chat shop đã hỏi khách xin: [${[...pending].join(", ")}].

NHIỆM VỤ: đọc đoạn chat xem khách đã trả lời các thông tin đó chưa.
- Khách CHƯA trả lời (hoặc mới trả lời một phần) → type = "reask": viết ĐÚNG 1 câu hỏi lại phần còn thiếu, NGẮN GỌN HƠN và KHÁC CÁCH DIỄN ĐẠT các câu shop đã hỏi, nội dung vẫn tương tự. Vd câu cũ "Chị cho shop xin chiều cao và cân nặng để em chọn size vừa cho mình nha." → câu mới "Chị cho em xin chiều cao cân nặng nha?". Chỉ hỏi phần còn thiếu, không giải thích dài, không nhắc lại sản phẩm, không chép lại câu cũ.
- Khách đã trả lời ĐỦ → type = "close": viết 1 câu chốt đơn ngắn, vd "Em lên đơn váy vàng nhé chị?" (nhắc đúng sản phẩm + màu/size khách đã chọn).
- Khách đã từ chối rõ ràng ("thôi", "không cần", "đã mua rồi"), đã chào tạm biệt/cảm ơn kết thúc, hoặc không phải chuyện mua hàng → skip = true.

QUY TẮC CHUNG: đúng 1 câu, tối đa 80 ký tự, kết thúc bằng dấu "?", chữ thường như nhắn tin, không markdown, tối đa 1 emoji. Giữ ĐÚNG cách xưng hô shop đã dùng với khách (anh/chị/mình; xưng em hoặc shop). Không bịa giá/khuyến mãi/thời gian giao, không ép mua, không nói "nhắc lại", "thấy bạn im lặng".

TRẢ VỀ DUY NHẤT JSON: {"skip": false, "type": "reask" | "close", "message": "nội dung tin nhắn"}  (skip = true thì message để rỗng)`;

  const system = needReask ? reaskSystem : `Bạn là nhân viên bán hàng của shop, đang nhắn tin Messenger. Khách đã im lặng một lúc sau tin cuối của shop. Nhiệm vụ: viết ĐÚNG 1 câu CHỐT ĐƠN thật ngắn, hỏi khách xác nhận để shop lên đơn.

QUY TẮC
- Mẫu câu: "Em lên đơn váy vàng nhé chị?" / "Em lên đơn màu vàng size M cho mình nhé ạ?". Nhắc đúng sản phẩm + màu/size khách ĐÃ CHỌN hoặc đang hỏi trong đoạn chat (gọi ngắn gọn như khách hay gọi, vd "váy vàng", không đọc nguyên tên sản phẩm dài).
- Khách CHƯA chọn màu/size (sản phẩm có lựa chọn) → chỉ nhắc sản phẩm và hỏi khách lấy màu/size nào, KHÔNG tự chọn thay khách. Không xin số điện thoại/địa chỉ ở câu này.
- Đúng 1 câu, tối đa 90 ký tự, kết thúc bằng dấu "?". Chữ thường như nhắn tin, không markdown, không gạch đầu dòng, tối đa 1 emoji.
- Giữ ĐÚNG cách xưng hô shop đã dùng với khách trong đoạn chat (anh/chị/mình; xưng em hoặc shop); chưa rõ thì dùng "mình". 
- Không lặp nguyên văn câu shop vừa gửi cuối, không bịa giá/khuyến mãi/thời gian giao, không ép mua, không dọa hết hàng, không nói "nhắc lại", "thấy bạn im lặng".
- Nếu khách đã từ chối rõ ràng ("thôi", "không cần", "đã mua rồi"), đã nói lời tạm biệt/cảm ơn kết thúc, hoặc cuộc trò chuyện không phải về mua hàng → đặt skip = true.

TRẢ VỀ DUY NHẤT JSON: {"skip": false, "message": "nội dung tin nhắn"}  (skip = true thì message để rỗng)`;

  const text = `Tên khách trên Facebook: ${name || "(không có)"}
Sản phẩm khách đang quan tâm: ${product ? `${product.name} — ${(product.description || "").slice(0, 400)}` : "(chưa rõ)"}
Thông tin khách đã đưa: ${Object.keys(info).length ? JSON.stringify(info) : "(chưa có)"}
Thông tin & quy tắc của shop: ${(shopInfo || "").trim().slice(0, 800) || "(không có)"}

ĐOẠN CHAT GẦN NHẤT:
${chat}`;

  const failMsg = () => (needReask && shortFallback() ? shortFallback() : lines.length ? pickOwnLine() : FALLBACK);
  const parsed = parseJson(await askGeminiJson({ system, text, keys, budgetMs }));
  if (!parsed) return { skip: false, message: failMsg() };
  if (parsed.skip === true) return { skip: true, message: "" };
  const msg = stripNotes(parsed.message);
  if (msg.length < 5 || msg.length > 200) return { skip: false, message: failMsg() };
  if (needReask) {
    // Khách đã trả lời đủ → câu chốt (ưu tiên câu chủ shop tự viết nếu có)
    if (parsed.type === "close" && lines.length) return { skip: false, message: pickOwnLine() };
    // Câu hỏi lại y hệt câu shop đã gửi → đổi sang câu rút gọn
    const norm = (t) => String(t || "").toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
    if (parsed.type !== "close" && avoid.some((t) => norm(t).includes(norm(msg)) || norm(msg).includes(norm(t)))) {
      const alt = shortFallback();
      if (alt) return { skip: false, message: alt };
    }
  }
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
