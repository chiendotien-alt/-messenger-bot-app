// app/api/webhook/route.js
// Next.js App Router API route — endpoint webhook cho Facebook Messenger.
// Deploy lên Vercel cùng project Next.js hiện tại, URL webhook sẽ là:
//   https://your-domain.com/api/webhook

import { getProducts, formatProductsForPrompt } from "@/lib/products";
import { addMessage, ensureProfile } from "@/lib/conversations";
import { getSettings } from "@/lib/settings";

const VERIFY_TOKEN = process.env.FB_VERIFY_TOKEN;
const PAGE_ACCESS_TOKEN = process.env.FB_PAGE_ACCESS_TOKEN;
const GOOGLE_API_KEY = process.env.GOOGLE_API_KEY;
const GEMINI_MODEL = "gemini-3.8-flash";

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
  const body = await req.json();

  if (body.object !== "page") {
    return new Response("Not a page event", { status: 404 });
  }

  for (const entry of body.entry ?? []) {
    for (const event of entry.messaging ?? []) {
      const senderId = event.sender?.id;
      const text = event.message?.text;

      // Bỏ qua echo, postback, tin nhắn không có text, v.v.
      if (!senderId || !text || event.message?.is_echo) continue;

      try {
        // Lưu lịch sử chỉ để xem lại; nếu kho dữ liệu lỗi thì bot vẫn phải trả lời khách
        await addMessage(senderId, "customer", text).catch((e) =>
          console.error("Không lưu được tin của khách:", e.message)
        );
        await ensureProfile(senderId).catch((e) =>
          console.error("Lỗi hồ sơ khách:", e.message)
        );

        const settings = await getSettings();
        if (settings.botEnabled === false) {
          // Bot đang tắt — chỉ lưu lại tin nhắn để chủ shop tự trả lời qua trang quản trị
          continue;
        }

        const reply = await generateReply(text);
        await sendMessage(senderId, reply);
        await addMessage(senderId, "bot", reply).catch((e) =>
          console.error("Không lưu được tin của bot:", e.message)
        );
      } catch (err) {
        console.error("Lỗi xử lý tin nhắn:", err);
        await sendMessage(
          senderId,
          "Dạ shop xin lỗi, hệ thống đang bận xíu, anh/chị nhắn lại giúp shop sau ít phút nha!"
        ).catch(() => {});
      }
    }
  }

  // Luôn trả 200 cho Facebook để nó không gửi lại (retry) sự kiện
  return new Response("EVENT_RECEIVED", { status: 200 });
}

// ---- Gọi Google Gemini API để soạn câu trả lời dựa trên dữ liệu sản phẩm ----
async function generateReply(customerMessage) {
  const products = await getProducts();
  const catalogText = formatProductsForPrompt(products);

  const systemPrompt = `Bạn là nhân viên tư vấn bán hàng qua Messenger của một shop đồ gia dụng.
Trả lời tự nhiên, thân thiện, ngắn gọn như người thật đang nhắn tin (không quá 4-5 câu),
xưng "shop", gọi khách là "anh/chị". Chỉ dùng thông tin sản phẩm dưới đây, không bịa giá
hay tính năng không có trong danh sách. Nếu khách hỏi thứ không có trong danh sách,
xin lỗi khéo và gợi ý sản phẩm gần nhất, hoặc mời để lại số điện thoại cho shop gọi tư vấn kỹ hơn.

Danh sách sản phẩm hiện có:
${catalogText}`;

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GOOGLE_API_KEY}`;

  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: systemPrompt }] },
      contents: [{ role: "user", parts: [{ text: customerMessage }] }],
      generationConfig: { maxOutputTokens: 400 },
    }),
  });

  const data = await response.json();

  if (data.error) {
    console.error("Lỗi Gemini API:", data.error);
  }

  const text = data.candidates?.[0]?.content?.parts?.[0]?.text;

  console.log("---- Khách hỏi:", customerMessage);
  console.log("---- Bot trả lời:", text || "(không có nội dung — xem lỗi phía trên)");

  return (
    text?.trim() ||
    "Dạ shop chưa rõ ý anh/chị lắm, anh/chị nói rõ hơn giúp shop được không ạ?"
  );
}

// ---- Gửi tin nhắn trả lời qua Facebook Send API ----
async function sendMessage(recipientId, text) {
  const url = `https://graph.facebook.com/v21.0/me/messages?access_token=${PAGE_ACCESS_TOKEN}`;
  await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      recipient: { id: recipientId },
      message: { text },
      messaging_type: "RESPONSE",
    }),
  });
}
