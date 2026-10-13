// lib/nudge.js — bot nhắn "bồi" khi khách im lặng quá thời gian chủ shop cài: LẦN 1 (hỏi lại thông tin còn thiếu / chốt đơn)
// và LẦN 2 (nhẹ nhàng mời khách nhắn khi cần, chỉ gửi nếu khách vẫn im sau lần 1 một khoảng chủ shop cài; sau lần 2 thì dừng hẳn).
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
//  - chưa có đơn THẬT (đơn nháp tự tạo khi khách để lại SĐT chưa tính là đơn), chủ shop chưa nhắn tay
//  - khách đã có SĐT thì chỉ bồi khi shop đã hỏi thông tin (vd địa chỉ) mà khách chưa trả lời; không còn gì thiếu thì thôi, không bồi
//  - bot tổng + bot của Page đó đang bật
//  - chưa nhắn câu chốt này kể từ lần khách nhắn gần nhất
import { getSql } from "./db";
import { getSettings } from "./settings";
import { getPageToken } from "./pages";
import { getAllRawKeys } from "./apiKeys";
import { getRecentMessages, getCustomerName, getCustomerInfo, addMessage, getRecentOutgoingWithAge, PHONE_SQL } from "./conversations";
import { askedTopics, buildShortAsk, buildLightNudge, notesForbidPronouns, bodyInfoGiven } from "./replyDedupe";
import { getProducts, filterProductsForPage, norm } from "./products";
import { askGeminiJson } from "./gemini";

export const DEFAULT_ASK_GAP_SEC = 180;
// Chỉ nhắn trong khoảng [askGapSec, askGapSec + NUDGE_LATE_SEC] kể từ tin cuối của bot. Quá khoảng này coi như lỡ, không nhắn muộn.
export const NUDGE_LATE_SEC = 600;
// Bồi lần 2: mặc định cách lần 1 bao lâu (giây), và lỡ giờ bao lâu thì bỏ
export const DEFAULT_NUDGE2_GAP_SEC = 1800;
export const NUDGE2_LATE_SEC = 1800;

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
  // Bồi lần 2 (mặc định BẬT khi tính năng bồi bật): cách lần 1 nudge2GapSec giây
  const g2raw = settings?.nudge2GapSec;
  const g2 = g2raw === undefined || g2raw === null || g2raw === "" ? DEFAULT_NUDGE2_GAP_SEC : Number(g2raw);
  const nudge2GapSec = Number.isFinite(g2) ? Math.min(64800, Math.max(30, g2)) : DEFAULT_NUDGE2_GAP_SEC;
  return {
    askGapSec,
    askGapMs: askGapSec * 1000,
    nudgeEnabled: settings?.nudgeEnabled === true,
    nudgeLines: lines,
    nudge2Enabled: settings?.nudge2Enabled !== false,
    nudge2GapSec,
  };
}

const FALLBACK = "Mình chọn được mẫu ưng ý chưa ạ, để shop lên đơn cho mình nhé?";

export async function findNudgeCandidates(askGapSec, limit = 20) {
  const sql = await getSql();
  const waitSec = Math.max(30, Math.round(askGapSec)); // bồi sớm nhất sau 30 giây
  return await sql`SELECT c.id, c.name, c.page_id AS "pageId", c.current_product_id AS "productId",
                          (COALESCE(c.info->>'phone', '') <> ''
                           OR EXISTS (SELECT 1 FROM messages m
                                      WHERE m.conversation_id = c.id AND m.sender = 'customer' AND m.text ~ ${PHONE_SQL})) AS "hasPhone"
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
                     AND NOT EXISTS (SELECT 1 FROM orders o
                                     WHERE o.conversation_id = c.id
                                       AND NOT (COALESCE(o.status, 'draft') = 'draft' AND COALESCE(o.data->>'auto', '') = 'true'))
                   ORDER BY c.last_time ASC
                   LIMIT ${limit}`;
}

/** Khách cần BỒI LẦN 2: đã nhận tin bồi lần 1, vẫn im, và đã qua gap2Sec giây kể từ tin bồi lần 1 (lỡ quá NUDGE2_LATE_SEC thì bỏ). */
export async function findNudge2Candidates(gap2Sec, limit = 20) {
  const sql = await getSql();
  const gap = Math.max(30, Math.round(gap2Sec));
  return await sql`SELECT c.id, c.name, c.page_id AS "pageId", c.current_product_id AS "productId",
                          (COALESCE(c.info->>'phone', '') <> ''
                           OR EXISTS (SELECT 1 FROM messages m
                                      WHERE m.conversation_id = c.id AND m.sender = 'customer' AND m.text ~ ${PHONE_SQL})) AS "hasPhone"
                   FROM conversations c
                   LEFT JOIN pages p ON p.id = c.page_id
                   WHERE c.last_from = 'bot'
                     AND c.nudge_done_at IS NOT NULL
                     AND c.nudge_done_at >= (SELECT MAX(m.created_at) FROM messages m
                                             WHERE m.conversation_id = c.id AND m.sender = 'customer')
                     AND c.nudge_done_at <= now() - (${gap}::int * interval '1 second')
                     AND c.nudge_done_at >= now() - ((${gap}::int + ${NUDGE2_LATE_SEC}::int) * interval '1 second')
                     AND (c.nudge2_sent_at IS NULL OR c.nudge2_sent_at < (SELECT MAX(m.created_at) FROM messages m
                                                                          WHERE m.conversation_id = c.id AND m.sender = 'customer'))
                     AND COALESCE(p.bot_enabled, TRUE) = TRUE
                     AND COALESCE(c.bot_off, FALSE) = FALSE
                     AND (SELECT MAX(m.created_at) FROM messages m
                          WHERE m.conversation_id = c.id AND m.sender = 'customer') > now() - interval '22 hours'
                     AND NOT EXISTS (SELECT 1 FROM messages m WHERE m.conversation_id = c.id AND m.sender = 'admin')
                     AND NOT EXISTS (SELECT 1 FROM orders o
                                     WHERE o.conversation_id = c.id
                                       AND NOT (COALESCE(o.status, 'draft') = 'draft' AND COALESCE(o.data->>'auto', '') = 'true'))
                   ORDER BY c.nudge_done_at ASC
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
// Khách đã chọn màu/mẫu (info.variant) thì không hỏi lại màu. Nếu variant chỉ là size (S, M, L, size M...) thì màu vẫn có thể chưa chọn.
function variantHasColor(info) {
  const v = String(info?.variant || "").trim();
  if (!v) return false;
  return !/^(size\s*)?(xxs|xs|s|m|l|xl|xxl|xxxl|\d{2,3})$/i.test(v);
}

async function resolveProduct(cand, products) {
  let product = products.find((p) => String(p.id) === String(cand.productId));
  // Chưa lưu được "sản phẩm khách đang hỏi" (vd khách mới nhắn 1 chữ, bot gửi câu mở đầu) → tự tìm để vẫn đọc được "Lưu ý cho bot"
  if (!product) {
    const pageProducts = filterProductsForPage(products, cand.pageId);
    if (pageProducts.length === 1) product = pageProducts[0];
    else if (pageProducts.length > 1) {
      const msgs = await getRecentMessages(cand.id, 30).catch(() => []);
      const blob = norm(msgs.map((m) => m.text || "").join("\n"));
      product = pageProducts.find((p) => p.name && blob.includes(norm(p.name)));
    }
  }
  return product;
}

async function composeNudge(cand, lines, keys, products, shopInfo, budgetMs) {
  const product = await resolveProduct(cand, products);
  const info = await getCustomerInfo(cand.id).catch(() => ({}));
  // "Lưu ý của chủ shop" của sản phẩm khách đang hỏi — BẮT BUỘC làm theo (kể cả cách xưng hô, có gọi tên khách hay không)
  const notes = String(product?.notes || "").trim();
  const hasNotes = notes.length > 0;
  const noPronoun = notesForbidPronouns(notes); // chỉ khi lưu ý YÊU CẦU RÕ nói trống không mới bỏ xưng hô

  // Thông tin shop đã hỏi ở các tin gần nhất (khách im nên có thể chưa trả lời)
  // Các chủ đề shop đã hỏi khách trong các tin gần đây (kể cả câu hỏi mồi ở đầu cuộc chat). Khách đã trả lời chưa thì AI đối chiếu đoạn chat để quyết định.
  const outRows = await getRecentOutgoingWithAge(cand.id, 8).catch(() => []);
  const pending = new Set();
  for (const r of outRows) for (const t of askedTopics(r.text)) pending.add(t);
  if (info?.address) pending.delete("dia chi");
  if (info?.name) pending.delete("ten nguoi nhan");
  if (info?.phone || cand.hasPhone) pending.delete("so dien thoai");
  if (variantHasColor(info)) pending.delete("mau");
  // Khách ĐÃ nói chiều cao / cân nặng → không hỏi lại (chỉ hỏi phần còn thiếu nếu mới nói một nửa)
  const allMsgs = await getRecentMessages(cand.id, 40).catch(() => []);
  const body = bodyInfoGiven(allMsgs.filter((m) => m.from === "customer").map((m) => m.text || ""));
  let sizeNeed = "";
  if (pending.has("size")) {
    if (body.height && body.weight) pending.delete("size");
    else if (body.height) sizeNeed = "weight";
    else if (body.weight) sizeNeed = "height";
  }
  const needReask = pending.size > 0;
  // Khách ĐÃ có SĐT (đơn nháp tự tạo): chỉ bồi để xin nốt phần còn thiếu; không còn gì thiếu thì không nhắn câu chốt
  if (cand.hasPhone && !needReask) return { skip: true, message: "" };
  const lastAsk = outRows.find((r) => askedTopics(r.text).size)?.text || "";
  const avoid = outRows.map((r) => r.text);
  const shortFallback = () => buildShortAsk(pending, { refText: lastAsk, avoid, neutral: noPronoun, sizeNeed });

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
  const notesRule = hasNotes
    ? `\n\nƯU TIÊN TUYỆT ĐỐI: phần "LƯU Ý CỦA CHỦ SHOP" ở dưới là chỉ dẫn riêng của chủ shop cho sản phẩm này. PHẢI làm đúng từng ý, kể cả cách xưng hô, cách gọi khách, giọng điệu. Lưu ý này cao hơn MỌI quy tắc và ví dụ mẫu ở trên (nếu ví dụ mẫu trái với lưu ý thì bỏ ví dụ). Nếu lưu ý không nói gì về xưng hô thì giữ ĐÚNG cách xưng hô shop đã dùng trong đoạn chat. LUÔN viết câu lễ phép, đủ chủ ngữ + vị ngữ (vd "Chị gửi em chiều cao cân nặng để em chọn size nha?"), KHÔNG nói cộc lốc thiếu chủ ngữ kiểu "Cho xin chiều cao cân nặng nha?".`
    : "";

  const reaskSystem = `Bạn là nhân viên bán hàng của shop, đang nhắn tin Messenger. Khách đã im lặng một lúc sau tin cuối của shop. Trong đoạn chat shop đã hỏi khách xin: [${[...pending].join(", ")}].

NHIỆM VỤ: đọc đoạn chat xem khách đã trả lời các thông tin đó chưa. Một mục coi là ĐÃ TRẢ LỜI nếu khách đã cung cấp, hoặc shop đã tư vấn/chốt xong mục đó từ thông tin khách đưa (vd khách đã nói chiều cao cân nặng và shop đã tư vấn size thì KHÔNG hỏi lại size). Chỉ hỏi lại mục khách thật sự chưa trả lời.
- Khách CHƯA trả lời (hoặc mới trả lời một phần) → type = "reask": viết ĐÚNG 1 câu hỏi lại phần còn thiếu, NGẮN GỌN HƠN và KHÁC CÁCH DIỄN ĐẠT các câu shop đã hỏi, nội dung vẫn tương tự. NỐI THEO điều khách quan tâm/hỏi gần nhất trong đoạn chat cho tự nhiên (vd khách vừa hỏi về ship rồi im → "chị yên tâm vụ ship rồi thì gửi em chiều cao cân nặng để chọn size nha?"; khách vừa hỏi về màu → hỏi tiếp về màu theo hướng khác). Mỗi lần viết một kiểu khác nhau, KHÔNG chép lại các câu ví dụ này và không chép lại câu cũ. Chỉ hỏi phần còn thiếu, không giải thích dài, không nhắc lại sản phẩm.
- Khách đã trả lời ĐỦ → type = "close": viết 1 câu chốt đơn ngắn, vd "Em lên đơn váy vàng nhé chị?" (nhắc đúng sản phẩm + màu/size khách đã chọn).
- Khách đã từ chối rõ ràng ("thôi", "không cần", "đã mua rồi"), đã chào tạm biệt/cảm ơn kết thúc, hoặc không phải chuyện mua hàng → skip = true.

QUY TẮC CHUNG: đúng 1 câu, tối đa 100 ký tự, kết thúc bằng dấu "?", chữ thường như nhắn tin, không markdown, tối đa 1 emoji. KHÔNG gọi tên khách trên Facebook. Giữ ĐÚNG cách xưng hô shop đã dùng với khách (anh/chị/mình; xưng em hoặc shop), trừ khi có LƯU Ý CỦA CHỦ SHOP nói khác. Không bịa giá/khuyến mãi/thời gian giao, không ép mua, không nói "nhắc lại", "thấy bạn im lặng".

TRẢ VỀ DUY NHẤT JSON: {"skip": false, "type": "reask" | "close", "message": "nội dung tin nhắn"}  (skip = true thì message để rỗng)`;

  const system = (needReask ? reaskSystem : `Bạn là nhân viên bán hàng của shop, đang nhắn tin Messenger. Khách đã im lặng một lúc sau tin cuối của shop. Nhiệm vụ: viết ĐÚNG 1 câu CHỐT ĐƠN thật ngắn, hỏi khách xác nhận để shop lên đơn.

QUY TẮC
- Mẫu câu: "Em lên đơn váy vàng nhé chị?" / "Em lên đơn màu vàng size M cho mình nhé ạ?". Nhắc đúng sản phẩm + màu/size khách ĐÃ CHỌN hoặc đang hỏi trong đoạn chat (gọi ngắn gọn như khách hay gọi, vd "váy vàng", không đọc nguyên tên sản phẩm dài).
- Khách CHƯA chọn màu/size (sản phẩm có lựa chọn) → chỉ nhắc sản phẩm và hỏi khách lấy màu/size nào, KHÔNG tự chọn thay khách. Không xin số điện thoại/địa chỉ ở câu này.
- Đúng 1 câu, tối đa 90 ký tự, kết thúc bằng dấu "?". Chữ thường như nhắn tin, không markdown, không gạch đầu dòng, tối đa 1 emoji.
- KHÔNG gọi tên khách trên Facebook. Giữ ĐÚNG cách xưng hô shop đã dùng với khách trong đoạn chat (anh/chị/mình; xưng em hoặc shop); chưa rõ thì dùng "mình", trừ khi có LƯU Ý CỦA CHỦ SHOP nói khác. 
- Không lặp nguyên văn câu shop vừa gửi cuối, không bịa giá/khuyến mãi/thời gian giao, không ép mua, không dọa hết hàng, không nói "nhắc lại", "thấy bạn im lặng".
- Nếu khách đã từ chối rõ ràng ("thôi", "không cần", "đã mua rồi"), đã nói lời tạm biệt/cảm ơn kết thúc, hoặc cuộc trò chuyện không phải về mua hàng → đặt skip = true.

TRẢ VỀ DUY NHẤT JSON: {"skip": false, "message": "nội dung tin nhắn"}  (skip = true thì message để rỗng)`) + notesRule;

  const text = `Sản phẩm khách đang quan tâm: ${product ? `${product.name} — ${(product.description || "").slice(0, 400)}` : "(chưa rõ)"}
${hasNotes ? `LƯU Ý CỦA CHỦ SHOP về sản phẩm này (BẮT BUỘC tuân theo, cao hơn mọi quy tắc khác): ${notes}\n` : ""}
Thông tin khách đã đưa: ${Object.keys(info).length ? JSON.stringify(info) : "(chưa có)"}${body.height ? "\nKhách ĐÃ nói chiều cao." : ""}${body.weight ? "\nKhách ĐÃ nói cân nặng." : ""}
Thông tin & quy tắc của shop: ${(shopInfo || "").trim().slice(0, 3000) || "(không có)"}

ĐOẠN CHAT GẦN NHẤT:
${chat}`;

  const failMsg = () => (needReask && shortFallback() ? shortFallback() : lines.length ? pickOwnLine() : FALLBACK);
  const parsed = parseJson(await askGeminiJson({ system, text, keys, budgetMs }));
  if (!parsed) return { skip: false, message: failMsg() };
  if (parsed.skip === true) return { skip: true, message: "" };
  if (cand.hasPhone && parsed.type === "close") return { skip: true, message: "" }; // khách đã trả lời đủ + đã có SĐT → không nhắn chốt nữa
  let msg = stripNotes(parsed.message);
  if (msg.length < 5 || msg.length > 200) return { skip: false, message: failMsg() };
  // AI lỡ hỏi lại chiều cao/cân nặng khi khách đã nói đủ (hoặc hỏi thừa phần khách đã nói) → dùng câu dự phòng
  if (askedTopics(msg).has("size") && (!pending.has("size") || sizeNeed)) {
    const p = msg.toLowerCase();
    const asksH = /chiều cao|cao bao nhiêu|cao bao nhieu/.test(p), asksW = /cân nặng|nặng bao nhiêu|bao nhiêu kg|bao nhiêu cân/.test(p);
    if (!pending.has("size") || (sizeNeed === "weight" && asksH) || (sizeNeed === "height" && asksW)) return { skip: false, message: failMsg() };
  }
  // Lưu ý của chủ shop nói khách là "chị" mà AI lỡ viết "bạn" → đổi thành "chị"
  if (hasNotes && /\bchị\b/i.test(notes) && !/\banh\b/i.test(notes)) msg = msg.replace(/\bbạn\b/gi, (m) => (m[0] === "B" ? "Chị" : "chị"));
  // Tin có gọi tên khách (vd "Bạn Như ...", "Chị Lan ...") → bỏ, dùng câu dự phòng không gọi tên
  const esc = (t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const nameTokens = String(name || "").split(/\s+/).filter((t) => t.length >= 2);
  const callsName = nameTokens.some((t) => new RegExp("(?:^|\\s)(?:bạn|chị|anh|em|cô|bác|chú)\\s+" + esc(t) + "(?=$|[\\s,.!?])", "iu").test(msg));
  if (callsName) return { skip: false, message: failMsg() };
  // Câu thiếu chủ ngữ/xưng hô (vd "Cho xin chiều cao cân nặng nha?") mà lưu ý không yêu cầu nói trống không → dùng câu dự phòng lễ phép
  const hasPronoun = /(?:^|[\s,.!?])(chị|anh|bạn|em|shop|mình|cô|chú|bác)(?=$|[\s,.!?])/iu.test(msg);
  if (!noPronoun && !hasPronoun) return { skip: false, message: failMsg() };
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

/** Soạn tin BỒI LẦN 2: nhẹ nhàng, nối theo điều khách quan tâm, mời khách nhắn khi cần. KHÔNG hỏi lại thông tin, KHÔNG giục chốt, KHÔNG lặp tin bồi lần 1. */
async function composeNudge2(cand, keys, products, shopInfo, budgetMs) {
  const product = await resolveProduct(cand, products);
  const info = await getCustomerInfo(cand.id).catch(() => ({}));
  const notes = String(product?.notes || "").trim();
  const hasNotes = notes.length > 0;
  const noPronoun = notesForbidPronouns(notes);

  const outRows = await getRecentOutgoingWithAge(cand.id, 8).catch(() => []);
  const avoid = outRows.map((r) => r.text);
  const refText = outRows.map((r) => r.text).join("\n");

  // Khách đã có SĐT (đơn nháp tự tạo) mà không còn thiếu gì thì không bồi nữa
  const pending = new Set();
  for (const r of outRows) for (const t of askedTopics(r.text)) pending.add(t);
  if (info?.address) pending.delete("dia chi");
  if (info?.name) pending.delete("ten nguoi nhan");
  if (info?.phone || cand.hasPhone) pending.delete("so dien thoai");
  if (variantHasColor(info)) pending.delete("mau");
  if (cand.hasPhone && pending.size === 0) return { skip: true, message: "" };

  const fallback = () => buildLightNudge({ refText, avoid, neutral: noPronoun });

  const history = await getRecentMessages(cand.id, 14).catch(() => []);
  const chat = history
    .filter((m) => m.text && !/^📷/.test(m.text))
    .map((m) => `${m.from === "customer" ? "KHÁCH" : "SHOP"}: ${m.text}`)
    .join("\n");
  if (!keys.length || !chat) return { skip: false, message: fallback() };

  const name = cand.name || (await getCustomerName(cand.id).catch(() => null));
  const notesRule = hasNotes
    ? `\n\nƯU TIÊN TUYỆT ĐỐI: phần "LƯU Ý CỦA CHỦ SHOP" ở dưới là chỉ dẫn riêng của chủ shop cho sản phẩm này. PHẢI làm đúng từng ý, kể cả cách xưng hô, cách gọi khách, giọng điệu; cao hơn mọi quy tắc khác. Nếu lưu ý không nói gì về xưng hô thì giữ ĐÚNG cách xưng hô shop đã dùng trong đoạn chat. Viết câu lễ phép, đủ chủ ngữ + vị ngữ.`
    : "";

  const system =
    `Bạn là nhân viên bán hàng của shop, đang nhắn tin Messenger. Khách đã im lặng khá lâu dù shop đã nhắn bồi 1 lần. Nhiệm vụ: viết ĐÚNG 1 tin nhắn nhẹ nhàng, tự nhiên như người thật, để khách thấy shop vẫn sẵn sàng hỗ trợ.

QUY TẮC
- NỐI THEO điều khách quan tâm/hỏi gần nhất trong đoạn chat (vd ship, đổi trả, size, màu, giá) rồi mời khách nhắn thêm nếu cần. Vd (chỉ để hiểu kiểu, KHÔNG chép lại): "chị còn băn khoăn vụ size thì cứ nhắn em nha".
- TUYỆT ĐỐI KHÔNG hỏi lại thông tin (màu, size, chiều cao, cân nặng, số điện thoại, địa chỉ), KHÔNG giục chốt đơn, KHÔNG lặp lại câu hỏi hay nội dung các tin shop đã gửi, KHÔNG nhắc "vừa hỏi".
- Đúng 1 câu, tối đa 90 ký tự. Chữ thường như nhắn tin, không markdown, không gạch đầu dòng, tối đa 1 emoji.
- KHÔNG gọi tên khách trên Facebook. Giữ ĐÚNG cách xưng hô shop đã dùng với khách trong đoạn chat (anh/chị/mình; xưng em hoặc shop), trừ khi có LƯU Ý CỦA CHỦ SHOP nói khác.
- Không bịa giá/khuyến mãi/thời gian giao, không dọa hết hàng, không ép mua, không nói "nhắc lại", "thấy bạn im lặng".
- Nếu khách đã từ chối rõ ràng ("thôi", "không cần", "đã mua rồi"), đã chào tạm biệt/cảm ơn kết thúc, hoặc cuộc trò chuyện không phải về mua hàng → skip = true.

TRẢ VỀ DUY NHẤT JSON: {"skip": false, "message": "nội dung tin nhắn"}  (skip = true thì message để rỗng)` + notesRule;

  const text = `Sản phẩm khách đang quan tâm: ${product ? `${product.name} — ${(product.description || "").slice(0, 300)}` : "(chưa rõ)"}
${hasNotes ? `LƯU Ý CỦA CHỦ SHOP về sản phẩm này (BẮT BUỘC tuân theo): ${notes}\n` : ""}
Thông tin & quy tắc của shop: ${(shopInfo || "").trim().slice(0, 2000) || "(không có)"}

ĐOẠN CHAT GẦN NHẤT (tin cuối là tin bồi lần 1 của shop):
${chat}`;

  const parsed = parseJson(await askGeminiJson({ system, text, keys, budgetMs }));
  if (!parsed) return { skip: false, message: fallback() };
  if (parsed.skip === true) return { skip: true, message: "" };
  let msg = stripNotes(parsed.message);
  if (msg.length < 5 || msg.length > 160) return { skip: false, message: fallback() };
  // AI lỡ hỏi lại thông tin / giục chốt → dùng câu dự phòng nhẹ nhàng
  if (askedTopics(msg).size || /chốt|lên đơn|đặt (hàng|luôn)/i.test(msg)) return { skip: false, message: fallback() };
  if (hasNotes && /\bchị\b/i.test(notes) && !/\banh\b/i.test(notes)) msg = msg.replace(/\bbạn\b/gi, (m) => (m[0] === "B" ? "Chị" : "chị"));
  // Gọi tên khách trên Facebook → bỏ
  const esc = (t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const nameTokens = String(name || "").split(/\s+/).filter((t) => t.length >= 2);
  const callsName = nameTokens.some((t) => new RegExp("(?:^|\\s)(?:bạn|chị|anh|em|cô|bác|chú)\\s+" + esc(t) + "(?=$|[\\s,.!?])", "iu").test(msg));
  if (callsName) return { skip: false, message: fallback() };
  // Thiếu xưng hô (mà lưu ý không yêu cầu nói trống không) → câu dự phòng
  const hasPronoun = /(?:^|[\s,.!?])(chị|anh|bạn|em|shop|mình|cô|chú|bác)(?=$|[\s,.!?])/iu.test(msg);
  if (!noPronoun && !hasPronoun) return { skip: false, message: fallback() };
  // Trùng y tin shop đã gửi → câu dự phòng
  const nrm = (t) => String(t || "").toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
  if (avoid.some((t) => nrm(t) && (nrm(t).includes(nrm(msg)) || nrm(msg).includes(nrm(t))))) return { skip: false, message: fallback() };
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

/** Chạy 1 lượt nhắn bồi (lần 1 + lần 2). force = bỏ qua kiểm tra bật/tắt (không dùng ngoài thử nghiệm). */
export async function runNudge({ deadlineMs = 24000, limit = 10 } = {}) {
  const t0 = Date.now();
  const settings = await getSettings();
  const cfg = readAskConfig(settings);
  if (!cfg.nudgeEnabled) return { ok: true, skipped: "Tính năng nhắn bồi đang TẮT", results: [] };
  if (settings.botEnabled === false) return { ok: true, skipped: "Bot tổng đang tắt", results: [] };
  if (cfg.askGapSec <= 0) return { ok: true, skipped: "Thời gian hỏi lại đang là 0 giây", results: [] };

  const candidates = await findNudgeCandidates(cfg.askGapSec, limit);
  const candidates2 = cfg.nudge2Enabled ? await findNudge2Candidates(cfg.nudge2GapSec, limit) : [];
  if (!candidates.length && !candidates2.length) return { ok: true, skipped: "Không có khách nào cần nhắn bồi lúc này", results: [] };

  const keys = await getAllRawKeys();
  const products = await getProducts();
  const sql = await getSql();
  const results = [];

  // ---- Bồi lần 1 ----
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
        results.push({ id: cand.id, stage: 1, status: "skipped" });
        continue;
      }
      // Soạn xong mà khách vừa nhắn thêm (hoặc bot/chủ shop vừa trả lời) → bỏ câu bồi, để tin mới được trả lời bình thường
      const still = await sql`SELECT last_from FROM conversations WHERE id = ${cand.id}`;
      if (still[0]?.last_from !== "bot") {
        results.push({ id: cand.id, stage: 1, status: "skipped", message: "(khách vừa nhắn thêm — không bồi)" });
        continue;
      }
      const token = await getPageToken(cand.pageId);
      if (!token) throw new Error("Không có token của Page");
      const sent = await sendText(token, cand.id, out.message);
      if (!sent.ok) {
        results.push({ id: cand.id, stage: 1, status: "error", message: sent.error });
        continue;
      }
      await addMessage(cand.id, "bot", out.message, [], cand.pageId).catch((e) => console.error("Không lưu tin bồi:", e.message));
      // Đánh dấu ĐÃ gửi bồi lần 1 (để tính giờ bồi lần 2)
      await sql`UPDATE conversations SET nudge_done_at = now() WHERE id = ${cand.id}`.catch((e) => console.error("Không lưu mốc bồi lần 1:", e.message));
      results.push({ id: cand.id, stage: 1, status: "sent", message: out.message });
      await new Promise((r) => setTimeout(r, 800));
    } catch (e) {
      console.error("Lỗi nhắn bồi:", cand.id, e.message);
      results.push({ id: cand.id, stage: 1, status: "error", message: String(e.message) });
    }
  }

  // ---- Bồi lần 2 (khách im sau tin bồi lần 1; mỗi lần khách nhắn chỉ bồi tối đa 2 lần) ----
  for (const cand of candidates2) {
    const left = deadlineMs - (Date.now() - t0);
    if (left < 6000) break;

    const claimed = await sql`UPDATE conversations SET nudge2_sent_at = now()
                              WHERE id = ${cand.id}
                                AND nudge_done_at IS NOT NULL
                                AND (nudge2_sent_at IS NULL OR nudge2_sent_at < (SELECT MAX(m.created_at) FROM messages m
                                                                                WHERE m.conversation_id = ${cand.id} AND m.sender = 'customer'))
                              RETURNING id`;
    if (!claimed.length) continue;

    try {
      const out = await composeNudge2(cand, keys, products, settings.botPrompt, Math.min(15000, left - 3000));
      if (out.skip) {
        results.push({ id: cand.id, stage: 2, status: "skipped" });
        continue;
      }
      const still = await sql`SELECT last_from FROM conversations WHERE id = ${cand.id}`;
      if (still[0]?.last_from !== "bot") {
        results.push({ id: cand.id, stage: 2, status: "skipped", message: "(khách vừa nhắn thêm — không bồi)" });
        continue;
      }
      const token = await getPageToken(cand.pageId);
      if (!token) throw new Error("Không có token của Page");
      const sent = await sendText(token, cand.id, out.message);
      if (!sent.ok) {
        results.push({ id: cand.id, stage: 2, status: "error", message: sent.error });
        continue;
      }
      await addMessage(cand.id, "bot", out.message, [], cand.pageId).catch((e) => console.error("Không lưu tin bồi lần 2:", e.message));
      results.push({ id: cand.id, stage: 2, status: "sent", message: out.message });
      await new Promise((r) => setTimeout(r, 800));
    } catch (e) {
      console.error("Lỗi nhắn bồi lần 2:", cand.id, e.message);
      results.push({ id: cand.id, stage: 2, status: "error", message: String(e.message) });
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
