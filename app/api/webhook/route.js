// app/api/webhook/route.js
// Next.js App Router API route — endpoint webhook cho Facebook Messenger.
// Deploy lên Vercel cùng project Next.js hiện tại, URL webhook sẽ là:
//   https://your-domain.com/api/webhook

import { getProducts, formatProductsForPrompt } from "@/lib/products";
import { addMessage, ensureProfile, getRecentMessages } from "@/lib/conversations";
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

        await fbAction(senderId, "mark_seen");
        await fbAction(senderId, "typing_on");

        const { messages, images, imageNote } = await generateReply(senderId, text, settings);

        for (let i = 0; i < messages.length; i++) {
          if (i > 0) {
            await fbAction(senderId, "typing_on");
          }
          await sleep(Math.min(1800, 500 + messages[i].length * 15)); // nghỉ tí như người đang gõ
          await sendMessage(senderId, messages[i]);
          await addMessage(senderId, "bot", messages[i]).catch((e) =>
            console.error("Không lưu được tin của bot:", e.message)
          );
        }

        if (images.length) {
          for (const url of images) {
            await sendImage(senderId, url);
          }
          await addMessage(senderId, "bot", imageNote).catch(() => {});
        }
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

// ---- Gọi Google Gemini API: soạn câu trả lời + quyết định có gửi ảnh không ----
const MAX_IMAGES = 4;

function buildSystemPrompt(catalogText, shopInfo) {
  return `Bạn là nhân viên tư vấn bán hàng của shop, đang nhắn tin với khách qua Messenger.
Mục tiêu: tư vấn đúng nhu cầu và giúp khách chốt đơn, nhưng cảm giác như một người thật nhắn tin, không phải máy trả lời tự động.

CÁCH NHẮN TIN
- Xưng "shop", gọi khách là "anh/chị" (nếu tên hoặc cách khách xưng hô cho biết giới tính thì gọi "anh" hoặc "chị").
- Mỗi tin ngắn 1-3 câu. Được tách thành tối đa 2 tin nhắn liên tiếp khi tự nhiên, không viết một khối văn dài.
- Chữ thường như nhắn tin: không markdown, không gạch đầu dòng, không in đậm. Tối đa 1 emoji mỗi lượt, có thể không dùng.
- Không mở đầu mọi câu bằng "Dạ". Không lặp lại lời chào nếu cuộc trò chuyện đã chào rồi. Không lặp lại câu đã nói ở tin trước.
- Hiểu tiếng Việt viết tắt, không dấu, sai chính tả (vd: "sp", "k", "dc", "bn", "ship"). Dựa vào các tin trước để đoán khách đang nói về sản phẩm nào.

CÁCH TƯ VẤN
- Trả lời đúng câu khách vừa hỏi trước, rồi mới gợi ý thêm. Khách hỏi giá thì báo giá luôn.
- Mỗi lượt chỉ hỏi lại tối đa 1 câu, và là câu cụ thể giúp tư vấn (vd: nhà mấy người, dùng để làm gì, cần màu/size nào).
- Chỉ nói "chưa rõ ý" khi thật sự không đoán được từ ngữ cảnh; khi đó hỏi lại đúng 1 điểm cụ thể.
- Khi khách có dấu hiệu muốn mua, xin nhẹ nhàng số điện thoại, địa chỉ, số lượng để lên đơn. Không ép mua.
- Chỉ dùng thông tin trong danh sách sản phẩm và thông tin shop bên dưới. Không bịa giá, tính năng, khuyến mãi, thời gian giao hàng. Nếu chưa có thông tin thì nói shop sẽ kiểm tra lại và mời khách để lại số điện thoại.

GỬI ẢNH
- Khi khách xin xem ảnh, hình, "xem hàng", "ảnh thật", "ảnh feedback", hãy đặt send_images.
- type "sample" = ảnh mẫu/giới thiệu sản phẩm; "real" = ảnh thực tế (chụp hàng thật, khách hàng thật); "both" = khi khách chỉ nói chung "ảnh".
- product_id lấy đúng từ danh sách. Nếu chưa biết khách hỏi sản phẩm nào và shop có nhiều sản phẩm, đặt send_images là null và hỏi khách muốn xem sản phẩm nào.
- Chỉ gửi loại ảnh mà sản phẩm đang có (xem số ảnh trong danh sách). Nếu không có ảnh loại khách cần, nói thật và đề nghị gửi loại khác, hoặc để shop gửi sau. Không hứa gửi ảnh mà không có.
- Khi gửi ảnh, viết 1 tin ngắn dẫn vào (vd: "shop gửi anh xem ảnh nhé"). Không gửi lại ảnh đã gửi ở các tin trước.

ĐỊNH DẠNG TRẢ LỜI: chỉ trả về JSON hợp lệ, không thêm chữ nào khác:
{"messages": ["tin 1", "tin 2 (nếu cần)"], "send_images": null}
hoặc {"messages": ["..."], "send_images": {"product_id": "id sản phẩm", "type": "sample" | "real" | "both"}}

THÔNG TIN & QUY TẮC CỦA SHOP (do chủ shop cung cấp):
${shopInfo?.trim() || "(chủ shop chưa cung cấp thêm)"}

DANH SÁCH SẢN PHẨM:
${catalogText}`;
}

/** Đổi lịch sử chat trong DB thành định dạng contents của Gemini (xen kẽ user/model, kết thúc bằng user). */
function toGeminiContents(history, latestText) {
  const contents = [];
  const push = (role, text) => {
    const last = contents[contents.length - 1];
    if (last && last.role === role) last.parts[0].text += "\n" + text;
    else contents.push({ role, parts: [{ text }] });
  };
  for (const m of history) {
    push(m.from === "customer" ? "user" : "model", m.text);
  }
  const last = history[history.length - 1];
  if (!last || last.from !== "customer" || last.text !== latestText) {
    push("user", latestText); // phòng khi chưa lưu kịp tin mới nhất vào DB
  }
  while (contents.length && contents[0].role !== "user") contents.shift();
  return contents;
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

async function generateReply(senderId, customerMessage, settings) {
  const fallback = {
    messages: ["Dạ shop chưa rõ ý anh/chị lắm, anh/chị nói rõ hơn giúp shop được không ạ?"],
    images: [],
    imageNote: "",
  };

  const products = await getProducts();
  const systemPrompt = buildSystemPrompt(formatProductsForPrompt(products), settings.botPrompt);

  let history = [];
  try {
    history = await getRecentMessages(senderId, 14);
  } catch (e) {
    console.error("Không đọc được lịch sử chat:", e.message);
  }
  const contents = toGeminiContents(history, customerMessage);

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GOOGLE_API_KEY}`;
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: systemPrompt }] },
      contents,
      generationConfig: {
        maxOutputTokens: 1500, // đủ chỗ cho cả phần "suy nghĩ" của model, tránh bị cắt cụt câu
        temperature: 0.8,
        responseMimeType: "application/json",
      },
    }),
  });

  const data = await response.json();
  if (data.error) console.error("Lỗi Gemini API:", data.error);

  const cand = data.candidates?.[0];
  const raw = cand?.content?.parts?.map((p) => p.text || "").join("") || "";
  if (cand?.finishReason && cand.finishReason !== "STOP") {
    console.warn("Gemini kết thúc bất thường:", cand.finishReason);
  }
  console.log("---- Khách hỏi:", customerMessage);
  console.log("---- Bot trả lời:", raw || "(không có nội dung)");

  const parsed = parseModelJson(raw);

  // Nếu model không trả JSON, coi cả đoạn là câu trả lời thường
  let messages = Array.isArray(parsed?.messages)
    ? parsed.messages.map((m) => String(m).trim()).filter(Boolean)
    : parsed
    ? []
    : raw.trim()
    ? [raw.trim()]
    : [];
  messages = messages.slice(0, 2);
  if (!messages.length) return fallback;

  // Chọn ảnh cần gửi
  let images = [];
  let imageNote = "";
  const req = parsed?.send_images;
  if (req?.product_id) {
    const p = products.find((x) => String(x.id) === String(req.product_id));
    if (p) {
      const sample = p.sampleImages || [];
      const real = p.realImages || [];
      let picked = [];
      let label = "";
      if (req.type === "real") {
        picked = real;
        label = "ảnh thực tế";
      } else if (req.type === "sample") {
        picked = sample;
        label = "ảnh mẫu";
      } else {
        picked = [...sample.slice(0, 2), ...real.slice(0, 2)];
        label = "ảnh mẫu và ảnh thực tế";
      }
      images = picked.slice(0, MAX_IMAGES);
      if (images.length) imageNote = `📷 [Bot đã gửi ${images.length} ${label} của "${p.name}"]`;
    }
  }

  return { messages, images, imageNote };
}

// ---- Gửi qua Facebook Send API ----
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const FB_URL = () => `https://graph.facebook.com/v21.0/me/messages?access_token=${PAGE_ACCESS_TOKEN}`;

async function fbPost(payload) {
  const res = await fetch(FB_URL(), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    console.error("Facebook từ chối:", JSON.stringify(err.error || err));
  }
}

async function fbAction(recipientId, action) {
  await fbPost({ recipient: { id: recipientId }, sender_action: action }).catch(() => {});
}

async function sendMessage(recipientId, text) {
  await fbPost({
    recipient: { id: recipientId },
    message: { text },
    messaging_type: "RESPONSE",
  });
}

async function sendImage(recipientId, imageUrl) {
  await fbPost({
    recipient: { id: recipientId },
    message: { attachment: { type: "image", payload: { url: imageUrl, is_reusable: true } } },
    messaging_type: "RESPONSE",
  });
}
