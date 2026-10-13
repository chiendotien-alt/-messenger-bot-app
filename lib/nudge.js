// lib/nudge.js — bot nhắn "bồi" 1 lần khi khách im lặng quá thời gian chủ shop cài (hỏi lại thông tin còn thiếu / chốt đơn).
// Không bồi khi tin cuối của bot là một câu hỏi (kết thúc bằng dấu "?") — khách đang được chờ trả lời.
// Chỉ bồi 1 lần: sau tin bồi này khách vẫn im thì bot dừng hẳn, khách nhắn lại thì tính lại từ đầu.
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
import { askedTopics, buildShortAsk, buildLightNudge, buildCloseFallback, notesForbidPronouns, bodyInfoGiven, pickOneTopic, asksMultipleGroups, shopRecommendedSize, sizeOptionsFrom } from "./replyDedupe";
import { getProducts, filterProductsForPage, norm, isBodySizedProduct } from "./products";
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
  return {
    askGapSec,
    askGapMs: askGapSec * 1000,
    nudgeEnabled: settings?.nudgeEnabled === true,
    nudgeLines: lines,
  };
}

const FALLBACK = "Mình chọn được mẫu ưng ý chưa ạ?";

/** Tin kết thúc bằng câu hỏi? (chấp nhận emoji/dấu câu theo sau, vd "mình lấy mẫu nào ạ? 😊") */
export function endsWithQuestion(text) {
  const t = String(text || "").trim();
  return /[?？][^\p{L}\p{N}]*$/u.test(t);
}

/** Tin bot/shop gần nhất có chữ thật (bỏ các ghi chú kiểu "📷 [Bot đã gửi ảnh]"). */
async function lastRealBotText(conversationId) {
  const rows = await getRecentOutgoingWithAge(conversationId, 5).catch(() => []);
  for (const r of rows) {
    const t = stripNotes(r.text).trim();
    if (t) return t;
  }
  return "";
}

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
                     AND COALESCE(c.last_message, '') !~ '[?？][^[:alnum:]]*$' -- tin cuối của bot là câu hỏi → không bồi
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
  const bodyKind = isBodySizedProduct(product); // chỉ quần áo/giày... mới hỏi/đếm chiều cao cân nặng; vòi nước, chậu... thì "size" là kích thước/loại
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
  // Shop đã gợi ý 1 size cụ thể rồi (vd "chị dùng size 25cm là hợp nha") → không hỏi lại size, chuyển sang chốt / hỏi mục còn thiếu
  if (shopRecommendedSize(outRows)) pending.delete("size");
  // Khách ĐÃ nói chiều cao / cân nặng → không hỏi lại (chỉ hỏi phần còn thiếu nếu mới nói một nửa)
  const allMsgs = await getRecentMessages(cand.id, 40).catch(() => []);
  const body = bodyInfoGiven(allMsgs.filter((m) => m.from === "customer").map((m) => m.text || ""));
  let sizeNeed = "";
  if (bodyKind && pending.has("size")) {
    if (body.height && body.weight) pending.delete("size");
    else if (body.height) sizeNeed = "weight";
    else if (body.weight) sizeNeed = "height";
  }
  const needReask = pending.size > 0;
  // Khách ĐÃ có SĐT (đơn nháp tự tạo): chỉ bồi để xin nốt phần còn thiếu; không còn gì thiếu thì không nhắn câu chốt
  if (cand.hasPhone && !needReask) return { skip: true, message: "" };
  const lastAsk = outRows.find((r) => askedTopics(r.text).size)?.text || "";
  const avoid = outRows.map((r) => r.text);
  // CHỈ hỏi lại 1 nhóm thông tin mỗi lần (không ghép "cân nặng và màu"): ưu tiên nhóm shop vừa hỏi gần nhất
  const focus = pickOneTopic(pending, outRows);
  const focusList = [...focus];
  const pronounText = outRows.map((r) => r.text).join("\n"); // mới nhất trước → giữ đúng kiểu tự xưng (em/shop) shop đang dùng
  const prodText = [product?.description, product?.notes, product?.openingScript].filter(Boolean).join("\n");
  const sizeOptions = sizeOptionsFrom(prodText); // vd ["25cm","30cm"] → hỏi "chị lấy 25cm hay 30cm ạ?"
  const FALLBACK = buildCloseFallback({ pronounText });
  const shortFallback = () => buildShortAsk(focus, { refText: lastAsk, avoid, neutral: noPronoun, sizeNeed, pronounText, bodyKind, sizeOptions });

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

  const reaskSystem = `Bạn là nhân viên bán hàng của shop, đang nhắn tin Messenger. Khách đã im lặng một lúc sau tin cuối của shop. Trong đoạn chat shop đã hỏi khách xin: [${[...pending].join(", ")}]. Lần này CHỈ hỏi lại ĐÚNG 1 mục: [${focusList.join(", ")}]. TUYỆT ĐỐI không ghép 2 loại thông tin vào 1 câu (vd "cân nặng và màu" là SAI). Nếu mục này khách đã trả lời rồi thì chọn đúng 1 mục khác còn thiếu trong danh sách trên.

NHIỆM VỤ: đọc đoạn chat xem khách đã trả lời các thông tin đó chưa. Một mục coi là ĐÃ TRẢ LỜI nếu khách đã cung cấp, hoặc shop đã tư vấn/chốt xong mục đó từ thông tin khách đưa (vd khách đã nói chiều cao cân nặng và shop đã tư vấn size thì KHÔNG hỏi lại size). Chỉ hỏi lại mục khách thật sự chưa trả lời.
- Khách CHƯA trả lời (hoặc mới trả lời một phần) → type = "reask": viết ĐÚNG 1 câu hỏi lại phần còn thiếu, NGẮN GỌN HƠN và KHÁC CÁCH DIỄN ĐẠT các câu shop đã hỏi, nội dung vẫn tương tự. NỐI THEO điều khách quan tâm/hỏi gần nhất trong đoạn chat cho tự nhiên (vd khách vừa hỏi về ship rồi im → "chị yên tâm vụ ship rồi thì gửi em chiều cao cân nặng để chọn size nha?"; khách vừa hỏi về màu → hỏi tiếp về màu theo hướng khác). Mỗi lần viết một kiểu khác nhau, KHÔNG chép lại các câu ví dụ này và không chép lại câu cũ. Chỉ hỏi phần còn thiếu, không giải thích dài, không nhắc lại sản phẩm.
- Khách đã trả lời ĐỦ → type = "close": viết 1 câu chốt đơn ngắn, vd "Em lên đơn váy vàng nhé chị?" (nhắc đúng sản phẩm + màu/size khách đã chọn).
- Khách đã từ chối rõ ràng ("thôi", "không cần", "đã mua rồi"), đã chào tạm biệt/cảm ơn kết thúc, hoặc không phải chuyện mua hàng → skip = true.

LỊCH SỰ: kết câu bằng "ạ", "nha" hoặc "nhé", KHÔNG dùng "nè", "nhen", "hen". CHƯA CHỐT: khách chưa chọn xong màu/size thì TUYỆT ĐỐI không viết "lên đơn", "chốt đơn", "đặt hàng" — chỉ hỏi khách thích/lấy loại nào. Chỉ nhắc lên đơn khi khách đã chọn đủ hoặc đã nói muốn mua. HỢP VỚI SẢN PHẨM: dùng đúng cách gọi của sản phẩm trong phần Nội dung. "size" của đồ vật/đồ gia dụng là KÍCH THƯỚC (vd 25cm, 30cm) nên KHÔNG hỏi chiều cao cân nặng; chiều cao cân nặng chỉ dành cho quần áo/giày/đồ mặc. Biết các lựa chọn thì hỏi kiểu CHỌN cụ thể (vd "chị lấy 25cm hay 30cm ạ?", "chị lấy màu nào: kem, xanh hay đỏ ạ?") thay vì xin chung chung ("gửi em size"). Nếu shop đã gợi ý một lựa chọn (vd khách hỏi "rửa mặt dùng size nào" và shop đã nói size 25cm hợp) mà khách chưa xác nhận thì hỏi xác nhận lựa chọn đó hoặc hỏi nốt mục còn thiếu kế tiếp (vd màu), không hỏi lại từ đầu.

QUY TẮC CHUNG: đúng 1 câu, tối đa 100 ký tự, kết thúc bằng dấu "?", chữ thường như nhắn tin, không markdown, tối đa 1 emoji. KHÔNG gọi tên khách trên Facebook. Giữ ĐÚNG cách xưng hô shop đã dùng với khách (anh/chị/mình; tự xưng GIỮ ĐÚNG kiểu shop đã dùng ở tin gần nhất (em hoặc shop), không đổi qua lại), trừ khi có LƯU Ý CỦA CHỦ SHOP nói khác. Không bịa giá/khuyến mãi/thời gian giao, không ép mua, không nói "nhắc lại", "thấy bạn im lặng".

TRẢ VỀ DUY NHẤT JSON: {"skip": false, "type": "reask" | "close", "message": "nội dung tin nhắn"}  (skip = true thì message để rỗng)`;

  const system = (needReask ? reaskSystem : `Bạn là nhân viên bán hàng của shop, đang nhắn tin Messenger. Khách đã im lặng một lúc sau tin cuối của shop. Nhiệm vụ: viết ĐÚNG 1 câu CHỐT ĐƠN thật ngắn, hỏi khách xác nhận để shop lên đơn.

QUY TẮC
- LỊCH SỰ: kết câu bằng "ạ", "nha" hoặc "nhé", KHÔNG dùng "nè", "nhen", "hen".
- Khách CHƯA chọn xong màu/size thì KHÔNG viết "lên đơn", "chốt đơn", "đặt hàng"; chỉ hỏi khách thích/lấy loại nào.
- HỢP VỚI SẢN PHẨM: dùng đúng cách gọi của sản phẩm; đồ vật thì "size" là kích thước/loại (vd 25cm, 30cm), không nhắc chiều cao cân nặng; quần áo mới nhắc size theo người mặc.
- Mẫu câu: "Em lên đơn váy vàng nhé chị?" / "Em lên đơn màu vàng size M cho mình nhé ạ?". Nhắc đúng sản phẩm + màu/size khách ĐÃ CHỌN hoặc đang hỏi trong đoạn chat (gọi ngắn gọn như khách hay gọi, vd "váy vàng", không đọc nguyên tên sản phẩm dài).
- Khách CHƯA chọn màu/size (sản phẩm có lựa chọn) → chỉ nhắc sản phẩm và hỏi khách lấy màu/size nào, KHÔNG tự chọn thay khách. Không xin số điện thoại/địa chỉ ở câu này.
- Đúng 1 câu, tối đa 90 ký tự, kết thúc bằng dấu "?". Chữ thường như nhắn tin, không markdown, không gạch đầu dòng, tối đa 1 emoji.
- KHÔNG gọi tên khách trên Facebook. Giữ ĐÚNG cách xưng hô shop đã dùng với khách trong đoạn chat (anh/chị/mình; tự xưng GIỮ ĐÚNG kiểu shop đã dùng ở tin gần nhất (em hoặc shop), không đổi qua lại); chưa rõ thì dùng "mình", trừ khi có LƯU Ý CỦA CHỦ SHOP nói khác. 
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
  // AI lỡ hỏi gộp 2 loại thông tin (vd "cân nặng và màu") → dùng câu dự phòng chỉ hỏi 1 mục
  if (needReask && parsed.type !== "close" && asksMultipleGroups(msg)) return { skip: false, message: failMsg() };
  // Khách còn thiếu thông tin (chưa chọn xong) mà câu bồi đã nói "lên đơn/chốt đơn" → quá sớm, dùng câu hỏi thường
  if (needReask && /lên đơn|chốt đơn|đặt (hàng|luôn)/i.test(msg)) return { skip: false, message: failMsg() };
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

/** Giờ nghỉ đêm (giờ Việt Nam): người bán thật không nhắn bồi lúc nửa đêm. Mặc định 23h-6h; đổi bằng NUDGE_QUIET_START / NUDGE_QUIET_END, tắt bằng NUDGE_QUIET=off. */
export function inQuietHours(now = new Date()) {
  if (process.env.NUDGE_QUIET === "off") return false;
  const start = process.env.NUDGE_QUIET_START !== undefined ? Number(process.env.NUDGE_QUIET_START) : 23;
  const end = process.env.NUDGE_QUIET_END !== undefined ? Number(process.env.NUDGE_QUIET_END) : 6;
  const h = (now.getUTCHours() + 7) % 24;
  return start > end ? h >= start || h < end : h >= start && h < end;
}

/** Chạy 1 lượt nhắn bồi (chỉ 1 lần). force = bỏ qua kiểm tra bật/tắt (không dùng ngoài thử nghiệm). */
export async function runNudge({ deadlineMs = 24000, limit = 10 } = {}) {
  const t0 = Date.now();
  const settings = await getSettings();
  const cfg = readAskConfig(settings);
  if (!cfg.nudgeEnabled) return { ok: true, skipped: "Tính năng nhắn bồi đang TẮT", results: [] };
  if (settings.botEnabled === false) return { ok: true, skipped: "Bot tổng đang tắt", results: [] };
  if (cfg.askGapSec <= 0) return { ok: true, skipped: "Thời gian hỏi lại đang là 0 giây", results: [] };
  if (inQuietHours()) return { ok: true, skipped: "Đang trong giờ nghỉ đêm (23h-6h) — không nhắn bồi", results: [] };

  const candidates = await findNudgeCandidates(cfg.askGapSec, limit);
  if (!candidates.length) return { ok: true, skipped: "Không có khách nào cần nhắn bồi lúc này", results: [] };

  const keys = await getAllRawKeys();
  const products = await getProducts();
  const sql = await getSql();
  const results = [];

  // ---- Bồi (1 lần) ----
  for (const cand of candidates) {
    const left = deadlineMs - (Date.now() - t0);
    if (left < 6000) break; // hết giờ — khách còn lại để lần chạy sau

    // Tin cuối của bot đã là câu hỏi → để khách tự trả lời, không bồi
    if (endsWithQuestion(await lastRealBotText(cand.id))) {
      results.push({ id: cand.id, stage: 1, status: "skipped", message: "(tin cuối của bot là câu hỏi — không bồi)" });
      continue;
    }

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
      // Đánh dấu ĐÃ gửi tin bồi
      await sql`UPDATE conversations SET nudge_done_at = now() WHERE id = ${cand.id}`.catch((e) => console.error("Không lưu mốc bồi lần 1:", e.message));
      results.push({ id: cand.id, stage: 1, status: "sent", message: out.message });
      await new Promise((r) => setTimeout(r, 800));
    } catch (e) {
      console.error("Lỗi nhắn bồi:", cand.id, e.message);
      results.push({ id: cand.id, stage: 1, status: "error", message: String(e.message) });
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
