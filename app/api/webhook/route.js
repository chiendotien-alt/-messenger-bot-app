// app/api/webhook/route.js
// Next.js App Router API route — endpoint webhook cho Facebook Messenger.
// Deploy lên Vercel cùng project Next.js hiện tại, URL webhook sẽ là:
//   https://your-domain.com/api/webhook

import { put } from "@vercel/blob";
import { getProducts, filterProductsForPage, formatProductsForPrompt, norm, normKey, matchProduct, openingImageList } from "@/lib/products";
import {
  addMessage,
  ensureProfile,
  getRecentMessages,
  claimEvent,
  isRepeatedMessage,
  claimOpening,
  releaseOpening,
  getCurrentProduct,
  setCurrentProduct,
  getCustomerName,
  isRecentOutgoingDuplicate,
  hasOutgoingMessage,
  getLatestCustomerMessageId,
  getMaxOutgoingId,
  getPendingCustomerMessages,
  getLastOpeningAgeMs,
  isInOpeningWindow,
  getFirstPendingCustomerAgeMs,
  hasAdminMessage,
  hasNewerDifferentCustomerMessage,
  getCustomerInfo,
  getLastOutgoingAgeMs,
  getRecentOutgoingTexts,
  mergeCustomerInfo,
  extractPhone,
} from "@/lib/conversations";
import { isRepeatedQuestion } from "@/lib/replyDedupe";
import { getSettings } from "@/lib/settings";
import { getPageToken, isPageBotEnabled } from "@/lib/pages";
import { getAllRawKeys } from "@/lib/apiKeys";
import { buildSystemPrompt } from "@/lib/botPrompt";
import { getTrainingForPrompt } from "@/lib/training";

const VERIFY_TOKEN = process.env.FB_VERIFY_TOKEN;
// GOOGLE_API_KEY (biến môi trường) + các key thêm bằng nút 🔑 trên trang quản trị — xem lib/apiKeys.js
// Vercel cho hàm chạy tối đa 60s (mặc định có thể chỉ 10-15s → dễ bị cắt giữa chừng khi AI chậm)
export const maxDuration = 60;

// ---- Chọn model Gemini ổn định ----
// Thứ tự thử: model chính (đặt qua biến môi trường GEMINI_MODEL nếu muốn đổi mà không sửa code)
// → các model dự phòng. Model nào lỗi (hết quota, quá tải, không tồn tại) sẽ tự chuyển sang model kế tiếp.
// Thêm/bớt model dự phòng bằng GEMINI_FALLBACK_MODELS="model-a,model-b" (không bắt buộc).
const DEFAULT_MODEL_CHAIN = [
  "gemini-3.6-flash", // bản stable — thử đầu tiên (bỏ gemini-3.8-flash vì hạn mức thấp)
  "gemini-3.5-flash", // bản stable
  "gemini-3.5-flash-lite", // nhẹ, quota rộng — chốt chặn cuối
];
const MODEL_CHAIN = [
  ...new Set(
    [
      process.env.GEMINI_MODEL,
      ...(process.env.GEMINI_FALLBACK_MODELS ? process.env.GEMINI_FALLBACK_MODELS.split(",") : DEFAULT_MODEL_CHAIN),
    ]
      .map((m) => (m || "").trim().replace(/^models\//, ""))
      .filter(Boolean)
  ),
];
// Có thể đổi bằng biến môi trường trên Vercel (GEMINI_TIMEOUT_MS, REPLY_BUDGET_MS) mà không cần sửa code.
const GEMINI_TIMEOUT_MS = Number(process.env.GEMINI_TIMEOUT_MS) || 18000; // mỗi lần gọi chờ tối đa 18s (Gemini đang chậm thì 9s là quá ngắn)
const REPLY_BUDGET_MS = Number(process.env.REPLY_BUDGET_MS) || 45000; // tổng thời gian dành cho AI trong 1 tin nhắn
// ---- Khách MỚI nhắn liền mấy tin: chỉ gửi ảnh mẫu + câu mở đầu, các tin còn lại chờ khách nhắn tiếp ----
// Khách mới (chưa ai trả lời) → chờ ngần này ms KỂ TỪ TIN ĐẦU TIÊN (12s), hết giờ mới gửi ảnh mẫu + câu mở đầu.
// Mọi tin khách gõ trong lúc chờ đều bỏ qua (AI không đọc), bot chỉ gửi mở đầu 1 lần.
const FIRST_CONTACT_WAIT_MS = process.env.FIRST_CONTACT_WAIT_MS !== undefined ? Number(process.env.FIRST_CONTACT_WAIT_MS) : 12000;
// Chốt an toàn: trong ngần này ms (5s) kể từ lúc bắt đầu gửi câu mở đầu, tin khách gõ thêm không trả lời riêng
// (tránh AI trả lời chồng lên lúc ảnh + mở đầu đang gửi). Hết thời gian này bot hoạt động bình thường.
const OPENING_BURST_MS = process.env.OPENING_BURST_MS !== undefined ? Number(process.env.OPENING_BURST_MS) : 5000;
// Khách mới mà bot chưa đoán được họ hỏi sản phẩm nào → vẫn chỉ gửi ảnh mẫu + câu mở đầu của sản phẩm đầu tiên có câu mở đầu
// (thay vì để AI trả lời dài dòng). Đặt FIRST_CONTACT_DEFAULT_OPENING=0 để tắt.
const FIRST_CONTACT_DEFAULT_OPENING = process.env.FIRST_CONTACT_DEFAULT_OPENING !== "0";
// ---- Khách ĐÃ CÓ cuộc trò chuyện nhắn liền mấy tin ngắn: chờ ngần này ms cho khách gõ xong rồi trả lời MỘT lần ----
// (tin cuối cùng của loạt sẽ trả lời chung cho cả loạt; các tin trước tự dừng). Đặt REPLY_DEBOUNCE_MS=0 để tắt.
const REPLY_DEBOUNCE_MS = process.env.REPLY_DEBOUNCE_MS !== undefined ? Number(process.env.REPLY_DEBOUNCE_MS) : 0; // 2.5 giây chờ khách gõ tiếp (mỗi tin mới của khách sẽ tính lại từ đầu)
// Bot trả lời 2 tin liên tiếp: giữ tin thứ 2 ngần này ms (hiện "đang gõ"); trong lúc giữ mà khách nhắn thêm → hủy tin thứ 2, trả lời tin mới.
// Khách nhắn dồn dập (tin thứ 2, 3... khi tin trước chưa được trả lời, hoặc nhắn tiếp ngay sau khi bot vừa trả lời):
// chờ ngần này ms cho khách gõ xong rồi trả lời MỘT lần. Tin ĐẦU của khách vẫn trả lời nhanh, không chờ. Đặt 0 để tắt.
const BURST_WAIT_MS = process.env.BURST_WAIT_MS !== undefined ? Number(process.env.BURST_WAIT_MS) : 2500;
const BURST_RECENT_MS = process.env.BURST_RECENT_MS !== undefined ? Number(process.env.BURST_RECENT_MS) : 10000;
// Bot không hỏi lại câu hỏi gần giống 1 trong N tin chữ gần nhất của bot/shop gửi cho khách này (mặc định 3). Đặt 0 để tắt.
const NO_REPEAT_QUESTION_LAST = process.env.NO_REPEAT_QUESTION_LAST !== undefined ? Number(process.env.NO_REPEAT_QUESTION_LAST) : 3;
const SECOND_MSG_HOLD_MS = process.env.SECOND_MSG_HOLD_MS !== undefined ? Number(process.env.SECOND_MSG_HOLD_MS) : 1000;
// Tin đầu tiên: giả gõ từ lúc nhận tin của khách, gửi sau 1s (câu ngắn) đến 1,5s (câu dài). AI soạn lâu hơn thì gửi ngay khi soạn xong.
const TYPING_MIN_MS = process.env.TYPING_MIN_MS !== undefined ? Number(process.env.TYPING_MIN_MS) : 1000;
const TYPING_MAX_MS = process.env.TYPING_MAX_MS !== undefined ? Number(process.env.TYPING_MAX_MS) : 1500;
// Khách nhắn thêm trong ngần này ms sau tin bot vừa gửi → dặn AI: câu trước trả lời hơi sớm, chỉ trả lời phần mới, không hỏi lại/lặp lại.
const FOLLOWUP_AFTER_BOT_MS = process.env.FOLLOWUP_AFTER_BOT_MS !== undefined ? Number(process.env.FOLLOWUP_AFTER_BOT_MS) : 10000;
// AI lỗi (hết quota, quá tải...) → KHÔNG gửi câu xin lỗi/chờ cho khách, để chủ shop tự nhắn tay hoặc đợi khách nhắn tiếp.
// Muốn bot vẫn gửi câu "chờ shop một chút" khi lỗi thì đặt biến môi trường SILENT_ON_ERROR=0 trên Vercel.
const SILENT_ON_ERROR = process.env.SILENT_ON_ERROR !== "0";
const modelDown = new Map(); // model → thời điểm được thử lại (model đang quá tải 503 với MỌI key → bỏ qua ngay, khỏi tốn thời gian)
const modelCooldown = new Map(); // `${model}::${keyId}` → thời điểm được thử lại (bỏ qua cặp model+key vừa lỗi)

// ---- 1. Facebook gọi GET để xác minh webhook khi bạn cấu hình trên Meta ----
export async function GET(req) {
  const { searchParams } = new URL(req.url);
  const mode = searchParams.get("hub.mode");
  const token = searchParams.get("hub.verify_token");
  const challenge = searchParams.get("hub.challenge");

  if (mode === "subscribe" && token === VERIFY_TOKEN) {
    return new Response(challenge, { status: 200 });
  }
  return new Response("Forbidden", { status: 403 });
}

// ---- 2. Facebook gọi POST mỗi khi có tin nhắn mới từ khách ----
export async function POST(req) {
  const startedAt = Date.now();
  const body = await req.json();

  if (body.object !== "page") {
    return new Response("Not a page event", { status: 404 });
  }

  for (const entry of body.entry ?? []) {
    // entry.id = ID của Fanpage nhận tin → dùng đúng token của Page đó để trả lời
    const pageId = entry.id ? String(entry.id) : null;
    const pageToken = await getPageToken(pageId);
    for (const event of entry.messaging ?? []) {
      // Tin do CHỦ PAGE gửi (từ điện thoại / Messenger / Business Suite) → Facebook gửi về dạng "echo".
      // Lưu lại để hiện trên trang quản trị, KHÔNG cho bot trả lời.
      if (event.message?.is_echo) {
        await handleEcho(event, pageId, pageToken).catch((e) => console.error("Lỗi lưu tin echo:", e.message));
        continue;
      }

      const senderId = event.sender?.id;
      // Khách gõ chữ, hoặc bấm câu hỏi có sẵn/nút (Facebook gửi dạng postback, "title" chính là câu hỏi)
      const text = event.message?.text || event.postback?.title || "";
      const mid = event.message?.mid || event.postback?.mid || "";
      // Ảnh khách gửi (bỏ qua sticker/like)
      const fbImages = (event.message?.attachments || [])
        .filter((a) => a.type === "image" && a.payload?.url && !a.payload?.sticker_id)
        .map((a) => a.payload.url);

      // Bỏ qua echo, tin nhắn không có chữ lẫn ảnh, v.v.
      if (!senderId || event.message?.is_echo || (!text && !fbImages.length)) continue;

      let openedProductId = null; // sản phẩm vừa giữ chỗ gửi câu mở đầu (để trả lại nếu gửi lỗi)
      try {
        // Facebook có thể gửi lại đúng sự kiện này (khi webhook chậm) → chỉ xử lý 1 lần
        if (!(await claimEvent(mid).catch(() => true))) continue;

        // Lưu lịch sử chỉ để xem lại; nếu kho dữ liệu lỗi thì bot vẫn phải trả lời khách
        const savedImages = await persistCustomerImages(senderId, fbImages);
        const messageId = await addMessage(senderId, "customer", text, savedImages, pageId, event.timestamp).catch((e) =>
          console.error("Không lưu được tin của khách:", e.message)
        );
        await ensureProfile(senderId, pageToken).catch((e) =>
          console.error("Lỗi hồ sơ khách:", e.message)
        );
        // Khách để lại số điện thoại → ghi nhớ ngay (không tốn AI)
        const phoneInMsg = extractPhone(text);
        if (phoneInMsg) await mergeCustomerInfo(senderId, { phone: phoneInMsg }).catch(() => {});

        const settings = await getSettings();
        if (settings.botEnabled === false) {
          // Bot đang tắt — chỉ lưu lại tin nhắn để chủ shop tự trả lời qua trang quản trị
          continue;
        }
        if (!(await isPageBotEnabled(pageId))) {
          // Bot của riêng Page này đang tắt — chỉ lưu tin nhắn
          continue;
        }

        // Khách MỚI nhắn liền mấy tin: chờ một chút cho khách gõ xong, chỉ tin CUỐI CÙNG của loạt mới đi tiếp
        // (các tin trước tự dừng) → bot chỉ trả lời 1 lần duy nhất.
        const firstWaitMs = Number.isFinite(Number(settings.firstContactWaitSec)) && settings.firstContactWaitSec !== "" && settings.firstContactWaitSec !== undefined && settings.firstContactWaitSec !== null
          ? Math.max(0, Number(settings.firstContactWaitSec)) * 1000
          : FIRST_CONTACT_WAIT_MS;
        const firstContact =
          firstWaitMs > 0 &&
          !!messageId &&
          !(await hasOutgoingMessage(senderId).catch(() => true)) &&
          (await getLastOpeningAgeMs(senderId).catch(() => 0)) === null;
        if (firstContact) {
          // Chờ đủ FIRST_CONTACT_WAIT_MS tính từ tin ĐẦU TIÊN của khách (không phải từ tin vừa nhận)
          const firstAge = (await getFirstPendingCustomerAgeMs(senderId).catch(() => 0)) || 0;
          await sleep(Math.max(0, firstWaitMs - firstAge));
          const latestId = await getLatestCustomerMessageId(senderId).catch(() => messageId);
          if (latestId && Number(latestId) > Number(messageId)) {
            console.log("Khách mới nhắn liền nhiều tin → để tin cuối cùng trả lời:", text);
            continue;
          }
        }

        // Tin này do khách gõ TRƯỚC khi câu mở đầu gửi xong (+ chốt an toàn) → thuộc loạt tin đầu, không trả lời riêng.
        // So theo GIỜ KHÁCH GÕ (event.timestamp), không phải giờ webhook đến — Facebook hay gửi webhook trễ vài giây,
        // nên "Xin màu", "Có size k" có thể đến sau khi mở đầu đã gửi dù khách gõ từ trước.
        if (OPENING_BURST_MS > 0 && (await isInOpeningWindow(senderId, messageId, OPENING_BURST_MS).catch(() => false))) {
          console.log("Tin khách gõ trong loạt tin đầu, bỏ qua:", text);
          continue;
        }

        // Khách cũ nhắn liền mấy tin ngắn ("giá sao" / "có ship k" / "size L"): chờ vài giây, chỉ tin cuối trả lời cho cả loạt.
        // Bấm nút/câu hỏi có sẵn (postback) thì trả lời ngay, không chờ.
        if (!firstContact && !event.postback && messageId) {
          let waitMs = REPLY_DEBOUNCE_MS;
          if (BURST_WAIT_MS > 0) {
            const pend = await getPendingCustomerMessages(senderId).catch(() => []);
            const outAge = await getLastOutgoingAgeMs(senderId).catch(() => null);
            if (pend.length >= 2 || (outAge !== null && outAge < BURST_RECENT_MS)) waitMs = Math.max(waitMs, BURST_WAIT_MS);
          }
          if (waitMs > 0) await sleep(waitMs);
          if (waitMs > 0 && await hasNewerDifferentCustomerMessage(senderId, messageId, text).catch(() => false)) {
            console.log("Khách nhắn tiếp tin mới → để tin cuối cùng trả lời chung:", text);
            continue;
          }
        }

        // Khách bấm câu hỏi có sẵn nhiều lần / gửi trùng trong vài phút → chỉ trả lời 1 lần
        // (khách mới đã được gom ở bước trên nên không cần kiểm tra trùng)
        if (
          !firstContact &&
          text &&
          !fbImages.length &&
          (await isRepeatedMessage(senderId, text, messageId).catch(() => false))
        ) {
          console.log("Bỏ qua tin trùng của khách:", text);
          continue;
        }

        // Hiện "đã xem" + "đang gõ" ngay lập tức (gửi song song cho nhanh)
        let typingStartedAt = Date.now();
        await Promise.all([
          fbAction(senderId, "mark_seen", pageToken),
          fbAction(senderId, "typing_on", pageToken),
        ]);

        // Soạn câu trả lời. Nếu trong lúc soạn mà có tin khác của bot/chủ shop vừa được gửi (do 2 luồng chạy song song),
        // soạn lại 1 lần với lịch sử mới để không lặp lại/xác nhận lại điều đã nói.
        let reply;
        for (let pass = 0; pass < 2; pass++) {
          const outBefore = await getMaxOutgoingId(senderId).catch(() => null);
          reply = await generateReply(senderId, text, savedImages, settings, pageId, firstContact, startedAt + 50000);
          if (reply.skip) break;
          const outAfter = await getMaxOutgoingId(senderId).catch(() => outBefore);
          if (String(outAfter ?? "") === String(outBefore ?? "")) break;
          console.log("Có tin khác của bot/chủ shop vừa gửi trong lúc soạn → soạn lại với lịch sử mới:", text);
          if (reply.openingProductId) await releaseOpening(senderId, reply.openingProductId).catch(() => {});
          if (pass === 1) reply = { skip: true }; // vẫn bị đổi lần nữa → dừng, tránh trả lời lặp
        }
        if (reply.skip) {
          await fbAction(senderId, "typing_off", pageToken);
          continue;
        }

        // Trong lúc AI soạn câu trả lời (vài giây), khách có thể đã nhắn thêm tin mới →
        // bỏ câu trả lời cũ này, để tin mới nhất trả lời gộp cho cả loạt (tránh bot trả lời lặp lại từng tin).
        if (
          !firstContact &&
          !event.postback &&
          messageId &&
          (await hasNewerDifferentCustomerMessage(senderId, messageId, text).catch(() => false))
        ) {
          console.log("Khách nhắn thêm trong lúc bot soạn → bỏ câu trả lời cũ, chờ tin mới nhất:", text);
          if (reply.openingProductId) await releaseOpening(senderId, reply.openingProductId).catch(() => {});
          continue;
        }
        const { messages, images, imageItems, imageNote } = reply;
        openedProductId = reply.openingProductId || null;

        // Khách vừa nhắn thêm tin mới (sau tin đang xử lý) → không gửi nữa, để tin mới nhất trả lời gộp
        const superseded = async () =>
          !firstContact &&
          !event.postback &&
          !!messageId &&
          (await hasNewerDifferentCustomerMessage(senderId, messageId, text).catch(() => false));

        const sendTexts = async () => {
          for (let i = 0; i < messages.length; i++) {
            if (i > 0) {
              await fbAction(senderId, "typing_on", pageToken);
              typingStartedAt = Date.now();
            }
            // Tin đầu: giả gõ 1-1,5s tính từ lúc bắt đầu "đang gõ" (AI soạn lâu rồi thì gửi ngay).
            // Tin thứ 2: giả soạn ~1s; trong lúc đó khách nhắn thêm → hủy tin này, trả lời tin mới.
            const typingMs = Math.min(TYPING_MAX_MS, TYPING_MIN_MS + messages[i].length * 5);
            const waitMs = i > 0 ? SECOND_MSG_HOLD_MS : Math.max(0, typingMs - (Date.now() - typingStartedAt));
            await sleep(waitMs);
            // Kiểm tra lần cuối ngay trước khi gửi từng tin
            if (await superseded()) {
              console.log("Khách nhắn thêm ngay trước lúc gửi → dừng, chờ tin mới nhất:", text);
              if (i === 0 && openedProductId) await releaseOpening(senderId, openedProductId).catch(() => {});
              return false;
            }
            // Câu hỏi này gần giống câu bot/shop vừa hỏi (vd 2 luồng trả lời chồng nhau) → bỏ câu này, gửi tiếp các câu khác
            if (NO_REPEAT_QUESTION_LAST > 0 && !reply.openingProductId) {
              const recent = await getRecentOutgoingTexts(senderId, 0, NO_REPEAT_QUESTION_LAST).catch(() => []);
              if (isRepeatedQuestion(messages[i], recent)) {
                console.log("Bỏ câu hỏi lặp lại câu đã hỏi:", messages[i]);
                continue;
              }
            }
            const delivered = await sendMessage(senderId, messages[i], pageToken);
            if (!delivered) {
              // Facebook từ chối (quá 24 giờ, token hết hạn...) → KHÔNG lưu như đã gửi, để bot/shop không tưởng khách đã nhận
              if (i === 0) throw new Error("Facebook từ chối tin đầu tiên");
              break;
            }
            await addMessage(senderId, "bot", messages[i], [], pageId).catch((e) =>
              console.error("Không lưu được tin của bot:", e.message)
            );
          }
          return true;
        };

        const sendImages = async () => {
          if (!images.length) return;
          if (await superseded()) return; // khách đã nhắn thêm → không gửi ảnh cũ
          // Gửi từng ảnh một (mỗi ảnh 1 tin), theo đúng thứ tự
          for (let i = 0; i < images.length; i++) {
            if (i > 0) await sleep(600);
            await sendImage(senderId, images[i], pageToken);
          }
          await addMessage(senderId, "bot", imageNote, images, pageId).catch(() => {});
        };

        if (openedProductId) {
          // Câu mở đầu quảng cáo: gửi ẢNH MẪU trước, rồi mới gửi câu mở đầu (giá, ưu đãi...)
          await sendImages();
          if (images.length) {
            await fbAction(senderId, "typing_on", pageToken);
            typingStartedAt = Date.now();
          }
          await sendTexts();
        } else {
          const sent = await sendTexts();
          if (sent) await sendImages();
        }
      } catch (err) {
        console.error("Lỗi xử lý tin nhắn:", err);
        if (openedProductId) await releaseOpening(senderId, openedProductId).catch(() => {});
        if (!SILENT_ON_ERROR) {
          await sendMessage(
            senderId,
            "Dạ shop xin lỗi, hệ thống đang bận xíu, anh/chị nhắn lại giúp shop sau ít phút nha!",
            pageToken
          ).catch(() => {});
        }
      }
    }
  }

  // Luôn trả 200 cho Facebook để nó không gửi lại (retry) sự kiện
  return new Response("EVENT_RECEIVED", { status: 200 });
}

// ---- Tin nhắn chủ Page tự gửi bằng điện thoại: lưu vào lịch sử để hiện trên web quản lý ----
// Với echo: sender.id = ID của Page, recipient.id = ID của khách.
// app_id = app đã gửi tin. Tin do chính bot/trang quản trị này gửi thì app_id trùng FB_APP_ID
// (những tin đó đã được lưu ngay lúc gửi nên phải bỏ qua để không bị lưu 2 lần).
// Tin gửi từ điện thoại/Page Inbox thì không có app_id, hoặc là app khác của Facebook.
// ID của chính app bot này (để phân biệt tin bot gửi với tin chủ shop nhắn bằng điện thoại / Business Suite).
// Ưu tiên biến FB_APP_ID; nếu chưa khai báo thì hỏi Facebook bằng token của Page (nhớ lại, chỉ hỏi 1 lần).
let cachedOwnAppId = null;
async function getOwnAppId(pageToken) {
  if (process.env.FB_APP_ID) return String(process.env.FB_APP_ID);
  if (cachedOwnAppId) return cachedOwnAppId;
  if (!pageToken) return null;
  try {
    const res = await fetch(`https://graph.facebook.com/v19.0/app?access_token=${encodeURIComponent(pageToken)}`);
    const d = await res.json().catch(() => ({}));
    if (d && d.id) cachedOwnAppId = String(d.id);
  } catch {}
  return cachedOwnAppId;
}

async function handleEcho(event, pageId, pageToken) {
  const customerId = event.recipient?.id;
  const msg = event.message || {};
  if (!customerId || !msg.mid) return;

  const ownAppId = await getOwnAppId(pageToken);
  const echoAppId = msg.app_id ? String(msg.app_id) : null;
  // Chỉ bỏ qua khi CHẮC CHẮN là tin do chính bot này gửi (đã được lưu lúc gửi).
  // Tin gửi từ điện thoại / Messenger / Business Suite có app_id khác hoặc không có → luôn lưu để hiện trên web.
  console.log("Echo từ chủ Page:", { echoAppId, ownAppId, hasText: Boolean(msg.text), attachments: (msg.attachments || []).length });
  if (ownAppId && echoAppId === ownAppId) return;

  const text = msg.text || "";
  const images = (msg.attachments || [])
    .filter((a) => a.type === "image" && a.payload?.url && !a.payload?.sticker_id)
    .map((a) => a.payload.url);
  if (!text && !images.length) return;

  // Facebook có thể gửi lại cùng 1 echo → chỉ xử lý 1 lần
  if (!(await claimEvent("echo:" + msg.mid).catch(() => true))) return;

  // Phòng khi FB_APP_ID chưa khai báo: nếu bot/admin vừa gửi đúng câu này thì không lưu lại lần nữa
  if (text && (await isRecentOutgoingDuplicate(customerId, text).catch(() => false))) return;

  await addMessage(customerId, "admin", text, images, pageId);
}

// ---- Câu mở đầu quảng cáo: khách hỏi giá lần đầu → gửi câu soạn sẵn + ẢNH MẪU (không gửi ảnh thực tế) ----
const MAX_OPENING_IMAGES = 10;
const QUIET_AFTER_OPENING_MS = OPENING_BURST_MS; // hết thời gian chốt an toàn sau câu mở đầu thì khách hỏi giá tiếp → AI trả lời bình thường (trong 15s đầu thì im lặng)
const QUIET_AFTER_PRESET_MS = OPENING_BURST_MS; // giống trên: chỉ im lặng trong khoảng chốt an toàn ngắn, sau đó khách nhắn gì AI cũng trả lời

/** Tin ngắn hỏi giá kiểu "Giá sản phẩm bao nhiêu?", "giá sao shop", "bn vậy"... */
function isPriceInquiry(text, maxLen = 50) {
  const t = norm(text);
  if (!t || t.length > maxLen) return false;
  if (/gia dinh|gia toc|gia dung/.test(t)) return false;
  return /\b(gia|bao nhieu|bao nhiu|bn|bao tien|nhieu tien|price)\b/.test(t);
}

function splitScript(script) {
  const chunks = [];
  let cur = "";
  for (const para of script.trim().split(/\n{2,}/)) {
    if (cur && (cur + "\n\n" + para).length > 1900) {
      chunks.push(cur);
      cur = para;
    } else {
      cur = cur ? cur + "\n\n" + para : para;
    }
  }
  if (cur) chunks.push(cur.slice(0, 2000));
  return chunks;
}

/** Các tin nhắn mở đầu: câu mở đầu chính + các tin phụ (nút "+" trong cài đặt sản phẩm), gửi lần lượt theo thứ tự. */
function openingMessages(p) {
  const extras = (Array.isArray(p.openingExtras) ? p.openingExtras : [])
    .map((t) => String(t || "").trim())
    .filter(Boolean)
    .map((t) => t.slice(0, 2000));
  return [...splitScript(p.openingScript), ...extras];
}

function openingAlreadySent(history, p) {
  const first = splitScript(p.openingScript)[0];
  return history.some((m) => m.from !== "customer" && m.text === first);
}

function openingReply(p) {
  // Mở đầu chỉ gửi những ảnh chủ shop đã tick. Ảnh không tick để dành, khách hỏi mới gửi.
  const images = openingImageList(p, MAX_OPENING_IMAGES);
  const labels = p.imageLabels || {};
  return {
    messages: openingMessages(p),
    images,
    imageItems: images.map((url) => ({ url, title: labels[url] || p.name })),
    imageNote: images.length ? `📷 [Bot đã gửi ${images.length} ảnh mẫu của "${p.name}" cùng câu mở đầu]` : "",
    openingProductId: p.id,
  };
}

// ---- Gọi Google Gemini API: soạn câu trả lời + quyết định có gửi ảnh không ----
const MAX_IMAGES = 10;
// Câu dùng khi AI lỗi — không được đưa vào lịch sử để model không bắt chước
const FALLBACK_TEXT = "Dạ anh/chị chờ shop một chút, shop kiểm tra rồi phản hồi mình ngay ạ.";
const OLD_FALLBACK = "Dạ shop chưa rõ ý anh/chị lắm";

/** Tải ảnh (link Blob/Facebook) về dạng base64 để đưa cho Gemini xem. Lỗi thì bỏ qua. */
async function fetchImagePart(url) {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > 4 * 1024 * 1024) return null;
    const mimeType = (res.headers.get("content-type") || "image/jpeg").split(";")[0];
    return { inlineData: { mimeType, data: buf.toString("base64") } };
  } catch {
    return null;
  }
}

/**
 * Gemini/máy chủ đôi khi trả về câu báo lỗi tiếng Anh (vd "An error occurred.") như thể là câu trả lời.
 * Những câu này TUYỆT ĐỐI không được gửi cho khách → coi như AI chưa trả lời, để hệ thống thử lại.
 */
function isErrorText(t) {
  const x = String(t || "").trim();
  if (!x) return false;
  if (/^[\[{]/.test(x)) return false; // JSON thật thì để phần phân tích JSON xử lý
  const hasVietnamese = /[àáảãạăằắẳẵặâầấẩẫậèéẻẽẹêềếểễệìíỉĩịòóỏõọôồốổỗộơờớởỡợùúủũụưừứửữựỳýỷỹỵđ]/i.test(x);
  if (hasVietnamese) return false;
  if (/\b(error|errors|exception|failed|failure|something went wrong|internal server|unavailable|overloaded|quota|rate limit|try again|unable to|cannot|can't|sorry)\b/i.test(x)) return true;
  // Câu ngắn hoàn toàn tiếng Anh, không có chữ có dấu → nhiều khả năng không phải câu trả lời cho khách
  return x.length < 80 && /^[\x00-\x7F]+$/.test(x) && /\b(the|an|a|is|was|occurred|please)\b/i.test(x);
}

/** Xoá mọi ghi chú nội bộ kiểu "📷 [Bot đã gửi ...]" mà AI lỡ bắt chước viết vào tin gửi khách. */
function stripBotNotes(t) {
  return String(t || "")
    .replace(/📷?\s*\[\s*(Bot|Shop|Hệ thống|Khách)\s+đã\s+gửi[^\]]*\]?/gi, "")
    .replace(/\[\s*(Bot|Shop)\s+đã\s+gửi[^\]]*\]/gi, "")
    .replace(/📷/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Đổi lịch sử chat trong DB thành contents của Gemini (xen kẽ user/model, kết thúc bằng user). */
async function buildContents(history, latestText, latestImages) {
  const items = [];
  for (const m of history) {
    const isCustomer = m.from === "customer";
    if (!isCustomer && (m.text.startsWith(OLD_FALLBACK) || m.text === FALLBACK_TEXT || isErrorText(m.text))) continue;
    const imgs = isCustomer ? m.images || [] : [];
    const text = m.text || (imgs.length ? `[Khách gửi ${imgs.length} ảnh]` : "");
    if (text) items.push({ role: isCustomer ? "user" : "model", text, images: imgs });
  }
  const last = history[history.length - 1];
  if (!last || last.from !== "customer" || (last.text || "") !== (latestText || "")) {
    // phòng khi chưa lưu kịp tin mới nhất vào DB
    const imgs = latestImages || [];
    items.push({ role: "user", text: latestText || `[Khách gửi ${imgs.length} ảnh]`, images: imgs });
  }

  // Chỉ cho bot "nhìn" tối đa 2 ảnh gần nhất của khách
  let budget = 2;
  for (let i = items.length - 1; i >= 0 && budget > 0; i--) {
    if (items[i].role !== "user") continue;
    const urls = items[i].images.slice(0, budget);
    budget -= urls.length;
    items[i].parts = (await Promise.all(urls.map(fetchImagePart))).filter(Boolean);
  }

  const contents = [];
  for (const it of items) {
    const last = contents[contents.length - 1];
    const extra = it.parts || [];
    if (last && last.role === it.role) {
      last.parts[0].text += "\n" + it.text;
      last.parts.push(...extra);
    } else {
      contents.push({ role: it.role, parts: [{ text: it.text }, ...extra] });
    }
  }
  while (contents.length && contents[0].role !== "user") contents.shift();
  return contents;
}

/**
 * AI trả về JSON bị cắt dở / hỏng → vớt lấy phần chữ trả lời, TUYỆT ĐỐI không gửi nguyên đoạn JSON cho khách.
 * Không phải JSON (AI trả chữ thường) thì dùng luôn. Không vớt được gì → trả mảng rỗng (hệ thống sẽ gọi AI lại).
 */
function salvageMessages(raw) {
  const t = String(raw || "").replace(/```json|```/g, "").trim();
  if (!t || isErrorText(t)) return [];
  if (!/^[\[{]/.test(t) && !/"messages"\s*:/.test(t) && !/"use_opening_product"|"send_images"|"customer_info"/.test(t)) {
    return [t]; // chữ bình thường, không phải JSON
  }
  const out = [];
  const m = t.match(/"messages"\s*:\s*\[([\s\S]*)/);
  if (m) {
    const re = /"((?:[^"\\]|\\.)*)"/g;
    let x;
    while ((x = re.exec(m[1])) && out.length < 2) {
      try {
        out.push(JSON.parse(`"${x[1]}"`));
      } catch {}
    }
  }
  return out;
}

/**
 * Chỉ giữ thông tin mà khách THỰC SỰ đã nhắn (chống AI đoán bừa/bịa rồi lưu làm thật):
 * SĐT phải có đúng dãy số trong tin khách; tên/địa chỉ/màu-size phải có phần lớn từ xuất hiện trong tin khách.
 */
function verifyCustomerInfo(info, history, latestText) {
  const customerTexts = (history || []).filter((m) => m.from === "customer").map((m) => m.text || "");
  customerTexts.push(latestText || "");
  const blob = norm(customerTexts.join(" \n "));
  const digits = customerTexts.join(" ").replace(/\D/g, "");
  const out = {};
  for (const k of ["name", "phone", "address", "variant"]) {
    const v = typeof info[k] === "string" ? info[k].trim() : "";
    if (!v) continue;
    if (k === "phone") {
      const d = v.replace(/\D/g, "");
      if (d.length >= 9 && digits.includes(d.replace(/^84/, "0").replace(/^0/, ""))) out.phone = v;
      continue;
    }
    const tokens = norm(v).split(/\s+/).filter(Boolean);
    if (!tokens.length) continue;
    const hit = tokens.filter((tk) => blob.includes(tk)).length;
    if (hit / tokens.length >= 0.6) out[k] = v;
  }
  return out;
}

function parseModelJson(raw) {
  if (!raw) return null;
  const cleaned = raw.replace(/```json|```/g, "").trim();
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

// Từ đệm cuối câu — bỏ đi khi so sánh ("màu đen nha" = "màu đen")
const FILLER_WORDS = new Set(["da", "a", "nha", "nhe", "nhen", "ha", "hen", "oi", "vang", "ok", "oke", "roi", "do", "di", "chi", "anh", "em"]);
// Dấu hiệu khách đang HỎI (không phải chỉ nhắc lại thông tin)
const QUESTION_RE = /(^| )(k|ko|khong|chua|sao|nao|dau|gi|may|bao nhieu|bao lau|the nao|duoc khong|co khong)( |$)/;

/**
 * Tin khách chỉ NHẮC LẠI thông tin mà bot/chủ shop vừa nói SAU tin đó (vd khách nhắn "Màu đen" cùng lúc với địa chỉ,
 * bot trả lời gộp "lên đơn màu đen..." xong, tin "Màu đen" lại được xử lý riêng → không cần trả lời thêm).
 * Kiểm tra bằng code, không phụ thuộc AI tuân thủ prompt.
 */
function isEchoOfShopReply(history, customerMessage) {
  const raw = String(customerMessage || "");
  if (!raw.trim() || raw.includes("?")) return false;
  let words = normKey(raw).split(" ").filter(Boolean);
  while (words.length && FILLER_WORDS.has(words[words.length - 1])) words.pop();
  while (words.length && FILLER_WORDS.has(words[0])) words.shift();
  if (!words.length || words.length > 5) return false;
  const key = words.join(" ");
  if (key.length < 3 || QUESTION_RE.test(key)) return false;

  // Vị trí tin khách này trong lịch sử; sau nó chỉ được có tin bot/chủ shop (không có tin khách mới hơn)
  let idx = -1;
  for (let i = history.length - 1; i >= 0; i--) {
    if (history[i].from === "customer" && normKey(history[i].text || "") === normKey(raw)) {
      idx = i;
      break;
    }
  }
  if (idx < 0) return false;
  const after = history.slice(idx + 1);
  if (!after.length || after.some((m) => m.from === "customer")) return false;
  return after.some((m) => (" " + normKey(m.text || "") + " ").includes(" " + key + " "));
}

async function generateReply(senderId, customerMessage, customerImages, settings, pageId, firstContact = false, hardDeadline = Date.now() + 50000) {
  const fallback = { messages: [FALLBACK_TEXT], images: [], imageItems: [], imageNote: "" };

  // Chỉ lấy sản phẩm của đúng Page đang nhận tin (+ sản phẩm dùng chung cho mọi Page)
  const products = filterProductsForPage(await getProducts(), pageId);

  let history = [];
  try {
    // Bộ nhớ 22 tin gần nhất, nhưng bỏ các tin khách gõ trong loạt tin đầu (chỉ để kích hoạt ảnh + câu mở đầu)
    history = await getRecentMessages(senderId, 22, OPENING_BURST_MS);
    // Lịch sử bắt đầu bằng tin của bot (câu mở đầu) → thêm 1 dòng giữ chỗ để AI biết bot đã gửi mở đầu rồi
    if (history.length && history[0].from !== "customer") {
      history.unshift({ from: "customer", text: "(khách mới nhắn hỏi thông tin sản phẩm)", images: [] });
    }
  } catch (e) {
    console.error("Không đọc được lịch sử chat:", e.message);
  }

  // Suy ra sản phẩm khách đang hỏi: từ câu quảng cáo/tên sản phẩm trong tin nhắn → nhớ lại cho các tin sau
  let match = matchProduct(customerMessage, products);
  if (firstContact) {
    // Khách mới nhắn nhiều tin: tìm sản phẩm trong CẢ loạt tin (câu quảng cáo có sẵn ưu tiên nhất)
    const pending = await getPendingCustomerMessages(senderId).catch(() => []);
    for (const m of pending) {
      const mm = m.text ? matchProduct(m.text, products) : null;
      if (mm && (!match || (mm.exact && !match.exact))) match = mm;
    }
  }
  if (match) await setCurrentProduct(senderId, match.product.id).catch(() => {});
  let currentId = match?.product.id || (await getCurrentProduct(senderId).catch(() => null));
  if (!currentId && products.length === 1) currentId = products[0].id;
  const currentProduct = products.find((p) => String(p.id) === String(currentId)) || null;
  // Chủ shop đã tự nhắn hỏi khách hộ bot → khách trả lời thì AI trả lời luôn, không gửi câu mở đầu quảng cáo nữa
  const adminHandled = firstContact ? false : await hasAdminMessage(senderId).catch(() => false);

  // Khách MỚI (dù nhắn 1 hay nhiều tin, nội dung gì cũng được): chỉ gửi ảnh mẫu + câu mở đầu của sản phẩm.
  // Những gì khách hỏi thêm sẽ được trả lời ở lần khách nhắn tiếp theo.
  if (firstContact) {
    let target = match?.product || currentProduct;
    let usedDefault = false;
    if (!target && FIRST_CONTACT_DEFAULT_OPENING) {
      target = products.find((p) => (p.openingScript || "").trim()) || null;
      usedDefault = !!target;
    }
    if (target && (target.openingScript || "").trim()) {
      const sentBefore = openingAlreadySent(history, target);
      const claim = await claimOpening(senderId, target.id).catch(() => ({ claimed: true, ageMs: 0 }));
      if (claim.claimed && !sentBefore) {
        // Nhớ sản phẩm vừa gửi để các câu hỏi tiếp theo của khách hiểu đúng đang nói về sản phẩm nào
        if (usedDefault) await setCurrentProduct(senderId, target.id).catch(() => {});
        return openingReply(target);
      }
      if (!claim.claimed && claim.ageMs < OPENING_BURST_MS) return { skip: true };
    }
  }

  // Đường tắt (không cần gọi AI): khách bấm câu hỏi quảng cáo có sẵn, hoặc hỏi giá → câu mở đầu + ảnh mẫu
  if (!customerImages.length && !adminHandled) {
    const isPreset = !!match?.exact;
    const target = isPreset
      ? match.product
      : isPriceInquiry(customerMessage, match ? 120 : 50)
        ? match?.product || currentProduct
        : null;

    if (target && (target.openingScript || "").trim()) {
      // Cuộc trò chuyện cũ (trước khi có bảng theo dõi) thì dò trong lịch sử xem đã gửi mở đầu chưa
      const sentBefore = openingAlreadySent(history, target);
      const claim = await claimOpening(senderId, target.id).catch(() => ({ claimed: true, ageMs: 0 }));
      if (claim.claimed && !sentBefore) return openingReply(target);
      // Đã gửi mở đầu rồi: khách bấm lại/hỏi lại ngay sau đó thì im lặng, hết khoảng đó mới để AI trả lời
      if (!claim.claimed && claim.ageMs < (isPreset ? QUIET_AFTER_PRESET_MS : QUIET_AFTER_OPENING_MS)) {
        return { skip: true };
      }
    }
  }

  // Khách chỉ nhắc lại đúng thông tin shop vừa nói ngay sau tin đó (race giữa 2 luồng xử lý) → không trả lời thêm
  if (!firstContact && !customerImages.length && isEchoOfShopReply(history, customerMessage)) {
    console.log("Tin khách chỉ lặp lại thông tin bot vừa chốt → không trả lời:", customerMessage);
    return { skip: true };
  }

  const customerName = await getCustomerName(senderId).catch(() => null);
  const customerInfo = await getCustomerInfo(senderId).catch(() => ({}));
  // Các câu trả lời chuẩn chủ shop đã dạy ở trang "Dạy bot" (lỗi thì bỏ qua, không ảnh hưởng việc trả lời khách)
  // Các tin khách chưa được trả lời (khách nhắn liên tiếp) — dùng cho cả việc tìm tình huống giống + gom trả lời 1 lần
  const pendingMsgs = firstContact ? [] : await getPendingCustomerMessages(senderId).catch(() => []);
  const trainQueries = [customerMessage, ...pendingMsgs.map((m) => (m.text || "").trim()).filter(Boolean).slice(-4).reverse()];
  const trainingText = await getTrainingForPrompt(currentProduct?.id, trainQueries).catch(() => "");
  const systemPrompt = buildSystemPrompt(
    formatProductsForPrompt(products),
    settings.botPrompt,
    currentProduct,
    customerName,
    customerInfo,
    trainingText
  );
  const contents = await buildContents(history, customerMessage, customerImages);

  // Khách vừa nhắn LIÊN TIẾP nhiều tin (chưa ai trả lời) → dặn AI đọc hết rồi trả lời gộp 1 lần
  let burstNote = "";
  if (!firstContact) {
    const lines = pendingMsgs.map((m) => (m.text || "").trim() || "[ảnh]").filter(Boolean).slice(-8);
    if (lines.length >= 2) {
      burstNote =
        "\n\nKHÁCH VỪA NHẮN LIÊN TIẾP " + lines.length + " TIN (shop chưa trả lời tin nào):\n" +
        lines.map((l, i) => `${i + 1}. ${l}`).join("\n") +
        "\nHãy đọc HẾT các tin này rồi trả lời MỘT lần, gộp gọn: trả lời các câu khách hỏi, ghi nhận thông tin khách vừa đưa (SĐT, địa chỉ, tên...) " +
        "và chỉ hỏi thêm đúng phần còn thiếu để lên đơn (tối đa 1 câu hỏi). Không trả lời từng tin một.";
    }
  }
  // Khách nhắn thêm NGAY SAU tin bot vừa gửi (câu trước trả lời hơi sớm) → chỉ trả lời phần mới
  let followupNote = "";
  if (!firstContact && pendingMsgs.length) {
    const outAge = await getLastOutgoingAgeMs(senderId).catch(() => null);
    if (outAge !== null && outAge < FOLLOWUP_AFTER_BOT_MS) {
      followupNote =
        "\n\nLƯU Ý: khách vừa nhắn thêm chỉ vài giây sau tin shop vừa gửi, có thể khách nhắn tiếp khi chưa nói hết ý (tin shop vừa rồi có thể trả lời hơi sớm). " +
        "Hãy đọc kỹ các tin MỚI của khách và chỉ trả lời phần mới đó. Nếu tin mới là câu trả lời cho câu shop vừa hỏi thì cứ ghi nhận và đi tiếp bình thường. " +
        "Không lặp lại ý đã nói ở tin shop vừa gửi, không hỏi lại điều khách vừa trả lời (vd khách đã nói màu thì đừng hỏi màu nữa), không chào lại.";
    }
  }
  const finalPrompt = systemPrompt + burstNote + followupNote;

  // Không cho AI chạy quá lâu: hàm Vercel bị cắt ở 60s, phải chừa thời gian gửi tin cho khách
  const deadline = Math.min(Date.now() + REPLY_BUDGET_MS, hardDeadline);
  const apiKeys = await getAllRawKeys();

  // Thử lần 1: JSON + suy nghĩ ít. Nếu lỗi/rỗng, thử lần 2 với cấu hình đơn giản hơn.
  // Mỗi lần thử đều tự chạy qua danh sách model dự phòng (xem callGemini).
  const attempts = [
    { maxOutputTokens: 2048, temperature: 0.8, responseMimeType: "application/json", thinkingConfig: { thinkingLevel: "low" } },
    { maxOutputTokens: 4096, temperature: 0.8, thinkingConfig: { thinkingLevel: "low" } },
  ];

  let raw = "";
  let usedModel = null;
  for (let i = 0; i < attempts.length && !raw.trim(); i++) {
    const r = await callGemini(finalPrompt, contents, attempts[i], deadline, apiKeys);
    raw = r.text;
    usedModel = r.model;
    if (isErrorText(raw)) {
      console.warn("AI trả về câu báo lỗi, bỏ qua và thử lại:", raw);
      raw = "";
    }
  }
  console.log("---- Khách hỏi:", customerMessage);
  console.log(`---- Bot trả lời (${usedModel || "không có model nào trả lời"}):`, raw || "(không có nội dung)");

  const parsed = parseModelJson(raw);

  // Lấy danh sách tin từ JSON (chịu được vài kiểu trả về lệch chuẩn); không phải JSON thì coi cả đoạn là câu trả lời
  let list = [];
  if (Array.isArray(parsed?.messages)) list = parsed.messages;
  else if (typeof parsed?.messages === "string") list = [parsed.messages];
  else if (typeof parsed?.reply === "string") list = [parsed.reply];
  else if (!parsed && raw.trim()) list = salvageMessages(raw);
  let messages = list.map((m) => stripBotNotes(m).slice(0, 1900)).filter((m) => m && !isErrorText(m)).slice(0, 2);
  // Khách nhắn liền nhiều tin → gộp thành MỘT tin trả lời (không gửi 2 tin rời làm khách rối)
  if (burstNote && messages.length > 1) {
    const joined = messages.join("\n\n");
    if (joined.length <= 1900) messages = [joined];
  }
  const openingRequested = !!parsed?.use_opening_product;

  // Ghi nhớ thông tin khách vừa nói (tên, SĐT, địa chỉ, màu/size) — lần sau bot không hỏi lại
  if (parsed?.customer_info && typeof parsed.customer_info === "object") {
    const verified = verifyCustomerInfo(parsed.customer_info, history, customerMessage);
    await mergeCustomerInfo(senderId, verified).catch((e) =>
      console.error("Không lưu được thông tin khách:", e.message)
    );
  }

  // AI thấy tin khách chỉ lặp lại/xác nhận thông tin shop vừa chốt → không trả lời thêm (tránh "dạ em ghi nhận màu đen" lần nữa)
  if (parsed?.no_reply === true && !messages.length && !parsed?.send_images && !parsed?.use_opening_product) {
    console.log("AI quyết định không trả lời (tin khách chỉ lặp lại thông tin đã chốt):", customerMessage);
    return { skip: true };
  }

  // Model muốn dùng câu mở đầu quảng cáo (khách hỏi tương tự "giá bao nhiêu")
  if (parsed?.use_opening_product) {
    const p = products.find((x) => String(x.id) === String(parsed.use_opening_product));
    if (!adminHandled && p && (p.openingScript || "").trim() && !openingAlreadySent(history, p)) return openingReply(p);
  }

  // Chọn ảnh cần gửi
  let images = [];
  let imageItems = [];
  let imageNote = "";
  const req = parsed?.send_images;
  if (req?.product_id) {
    const p = products.find((x) => String(x.id) === String(req.product_id));
    if (p) {
      const labels = p.imageLabels || {};
      const sample = p.sampleImages || [];
      const real = p.realImages || [];
      const all = [
        ...sample.map((url, i) => ({ code: `S${i + 1}`, url, label: labels[url] || "" })),
        ...real.map((url, i) => ({ code: `R${i + 1}`, url, label: labels[url] || "" })),
      ];

      let picked = [];
      // 1) Khách hỏi mẫu/màu cụ thể → chọn theo mã hoặc tên ảnh
      if (Array.isArray(req.image_ids) && req.image_ids.length) {
        for (const id of req.image_ids) {
          const key = String(id).trim();
          const hit =
            all.find((x) => x.code.toLowerCase() === key.toLowerCase()) ||
            all.find((x) => x.label && norm(x.label) === norm(key));
          if (hit && !picked.includes(hit)) picked.push(hit);
        }
      }
      // 2) Khách xin ảnh chung → theo loại
      if (!picked.length && !(Array.isArray(req.image_ids) && req.image_ids.length)) {
        const sm = all.filter((x) => x.code.startsWith("S"));
        const rl = all.filter((x) => x.code.startsWith("R"));
        picked = req.type === "real" ? rl : req.type === "sample" ? sm : [...sm.slice(0, 2), ...rl.slice(0, 2)];
      }

      picked = picked.slice(0, MAX_IMAGES);
      images = picked.map((x) => x.url);
      imageItems = picked.map((x) => ({ url: x.url, title: x.label || p.name }));
      if (images.length) {
        const names = picked.map((x) => x.label).filter(Boolean);
        imageNote = `📷 [Bot đã gửi ${images.length} ảnh của "${p.name}"${names.length ? ": " + names.join(", ") : ""}]`;
      }
    }
  }

  if (!messages.length) {
    // Model chỉ yêu cầu gửi ảnh mà quên viết câu dẫn → tự thêm 1 câu ngắn
    if (images.length) messages = ["Dạ shop gửi anh/chị xem ảnh nhé ạ."];
    else {
      // Trường hợp hay gặp: khách hỏi kiểu "giảm k", model đặt use_opening_product + messages rỗng,
      // nhưng câu mở đầu đã gửi rồi nên hệ thống không gửi lại → không còn gì để trả. Gọi lại AI, ép phải viết câu trả lời.
      console.warn("AI trả về messages rỗng.", { openingRequested, raw: (raw || "").slice(0, 300) });
      const retried = await retryForcedText(finalPrompt, contents, deadline, apiKeys, hardDeadline);
      if (retried.length) return { messages: retried, images: [], imageItems: [], imageNote: "" };
      // AI lỗi hẳn: im lặng, không gửi gì cho khách (chủ shop tự nhắn tay; khách nhắn tiếp thì bot thử lại bình thường)
      if (SILENT_ON_ERROR) {
        console.warn("AI không trả lời được → im lặng, chờ chủ shop hoặc tin tiếp theo của khách.");
        return { skip: true };
      }
      return fallback;
    }
  }
  return { messages, images, imageItems, imageNote };
}

/**
 * Gọi Gemini, thử lần lượt: mỗi model × mỗi API key (nhiều key = nhiều hạn mức/phút cộng lại).
 *  - 429 (hết quota key này) → thử NGAY key khác với cùng model đó (không đổi model vội, giữ chất lượng)
 *  - 404 (model không tồn tại) → bỏ hẳn model đó, sang model kế tiếp
 *  - 401/403 (key này sai/bị khoá) → bỏ hẳn key đó, thử key khác
 *  - 500/503/timeout (quá tải) → nghỉ ngắn rồi thử key khác của model đó
 *  - 400 do thinkingConfig (model không hỗ trợ) → gọi lại không kèm thinkingConfig
 * Trả về { text, model }; text rỗng nếu tất cả model + key đều lỗi.
 */
async function callGemini(systemPrompt, contents, generationConfig, deadline, apiKeys) {
  const keys = apiKeys && apiKeys.length ? apiKeys : [{ id: "__none__", key: "" }];

  for (const model of MODEL_CHAIN) {
    // Model vừa báo quá tải (503) → nhảy thẳng sang model kế tiếp; riêng model cuối luôn được thử
    if ((modelDown.get(model) || 0) > Date.now() && model !== MODEL_CHAIN[MODEL_CHAIN.length - 1]) continue;

    let config = generationConfig;
    let stripped = false;

    const now = Date.now();
    let keyChain = keys.filter((k) => (modelCooldown.get(`${model}::${k.id}`) || 0) <= now);
    if (!keyChain.length) keyChain = keys; // toàn bộ key đang "nghỉ" với model này thì thử lại hết

    for (const keyObj of keyChain) {
      const cooldownKey = `${model}::${keyObj.id}`;
      const remaining = deadline - Date.now();
      if (remaining < 3000) {
        console.warn("Hết thời gian dành cho AI, dừng thử.");
        return { text: "", model: null };
      }

      let res;
      try {
        res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-goog-api-key": keyObj.key || "" },
          body: JSON.stringify({
            systemInstruction: { parts: [{ text: systemPrompt }] },
            contents,
            generationConfig: config,
          }),
          signal: AbortSignal.timeout(Math.min(GEMINI_TIMEOUT_MS, remaining)),
        });
      } catch (e) {
        console.error(`Gemini ${model} (key ${keyObj.id}) timeout/lỗi mạng:`, e.message);
        modelCooldown.set(cooldownKey, Date.now() + 20 * 1000);
        continue; // thử key khác cùng model
      }

      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        const err = data.error || {};
        console.error(`Lỗi Gemini API [${model}] (key ${keyObj.id}) HTTP ${res.status}:`, JSON.stringify(err));

        if (res.status === 401 || res.status === 403) {
          // Key này sai/bị khoá — nghỉ lâu, thử key khác
          modelCooldown.set(cooldownKey, Date.now() + 30 * 60 * 1000);
          continue;
        }
        if (res.status === 400 && config.thinkingConfig && !stripped && /think/i.test(err.message || "")) {
          const { thinkingConfig, ...rest } = config; // model này không nhận thinkingConfig
          config = rest;
          stripped = true;
          continue; // thử lại đúng key này với cấu hình mới, không tính là lỗi
        }
        if (res.status === 404) {
          // Tên model sai/đã tắt — không liên quan tới key, nghỉ hẳn model này rồi sang model kế tiếp
          for (const k of keys) modelCooldown.set(`${model}::${k.id}`, Date.now() + 30 * 60 * 1000);
          break;
        }
        if (res.status === 429) {
          modelCooldown.set(cooldownKey, Date.now() + 60 * 1000); // key này hết hạn mức/phút → nghỉ 1 phút, thử key khác
          continue;
        }
        if (res.status === 503) {
          // "Model đang quá tải" là lỗi của CẢ model (đổi key không giúp) → nghỉ model này 45s, sang model kế tiếp ngay
          modelDown.set(model, Date.now() + 45 * 1000);
          break;
        }
        if (res.status >= 500) {
          modelCooldown.set(cooldownKey, Date.now() + 15 * 1000);
          continue; // lỗi máy chủ khác → thử key khác
        }
        continue; // 400 khác → thử key khác của model này
      }

      const cand = data.candidates?.[0];
      const text = cand?.content?.parts?.map((p) => p.text || "").join("") || "";
      if (text.trim()) return { text, model };

      console.warn(
        `Gemini ${model} (key ${keyObj.id}) không trả nội dung. finishReason=${cand?.finishReason} promptFeedback=${JSON.stringify(data.promptFeedback || null)}`
      );
      break; // rỗng → thử model kế tiếp (không phải lỗi key, đổi key không ích gì)
    }
  }
  return { text: "", model: null };
}

/** Gọi lại Gemini lần nữa, nhắc bắt buộc phải có câu trả lời bằng chữ (không được để messages rỗng). */
async function retryForcedText(systemPrompt, contents, deadline, apiKeys, hardDeadline = Date.now() + 50000) {
  try {
    const extra =
      "\n\nLƯU Ý BẮT BUỘC: mảng messages KHÔNG được rỗng. Câu mở đầu quảng cáo đã gửi rồi nên use_opening_product phải là null. " +
      "Hãy trả lời trực tiếp câu vừa rồi của khách bằng chữ (1-2 câu).";
    const { text: raw, model } = await callGemini(
      systemPrompt + extra,
      contents,
      {
        maxOutputTokens: 2048,
        temperature: 0.8,
        responseMimeType: "application/json",
        thinkingConfig: { thinkingLevel: "low" },
      },
      Math.min(Math.max(deadline, Date.now() + 15000), hardDeadline), // chừa tới 15s cho lần thử lại, nhưng không vượt giới hạn 60s của Vercel
      apiKeys
    );
    console.log(`---- Bot trả lời (thử lại, ${model || "lỗi"}):`, raw || "(không có nội dung)");
    const parsed = parseModelJson(raw);
    const list = Array.isArray(parsed?.messages) ? parsed.messages : parsed?.reply ? [parsed.reply] : [];
    return list.map((m) => stripBotNotes(m)).filter((m) => m && !isErrorText(m)).slice(0, 2);
  } catch (e) {
    console.error("Lỗi thử lại Gemini:", e.message);
    return [];
  }
}

// ---- Lưu ảnh khách gửi vào Blob (link Facebook sẽ hết hạn) ----
async function persistCustomerImages(senderId, urls) {
  const out = [];
  for (const [i, url] of urls.slice(0, 4).entries()) {
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error("HTTP " + res.status);
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.length > 6 * 1024 * 1024) throw new Error("ảnh quá lớn");
      const type = (res.headers.get("content-type") || "image/jpeg").split(";")[0];
      const blob = await put(`chat-images/${senderId}-${Date.now()}-${i}`, buf, {
        access: "public",
        addRandomSuffix: true,
        contentType: type,
      });
      out.push(blob.url);
    } catch (e) {
      console.error("Không lưu được ảnh khách vào Blob, dùng link gốc:", e.message);
      out.push(url);
    }
  }
  return out;
}

// ---- Gửi qua Facebook Send API ----
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const FB_URL = (token) => `https://graph.facebook.com/v21.0/me/messages?access_token=${token}`;

async function fbPost(payload, token) {
  const res = await fetch(FB_URL(token), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    console.error("Facebook từ chối:", JSON.stringify(err.error || err));
    return false;
  }
  return true;
}

async function fbAction(recipientId, action, token) {
  await fbPost({ recipient: { id: recipientId }, sender_action: action }, token).catch(() => {});
}

async function sendMessage(recipientId, text, token) {
  return await fbPost({
    recipient: { id: recipientId },
    message: { text },
    messaging_type: "RESPONSE",
  }, token);
}

async function sendImage(recipientId, imageUrl, token) {
  await fbPost({
    recipient: { id: recipientId },
    message: { attachment: { type: "image", payload: { url: imageUrl, is_reusable: true } } },
    messaging_type: "RESPONSE",
  }, token);
}
