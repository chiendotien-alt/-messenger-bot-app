// app/api/webhook/route.js
// Next.js App Router API route — endpoint webhook cho Facebook Messenger.
// Deploy lên Vercel cùng project Next.js hiện tại, URL webhook sẽ là:
//   https://your-domain.com/api/webhook

import { put } from "@vercel/blob";
import { getProducts, formatProductsForPrompt, norm, matchProduct } from "@/lib/products";
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
} from "@/lib/conversations";
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
        const messageId = await addMessage(senderId, "customer", text, savedImages).catch((e) =>
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

        // Khách bấm câu hỏi có sẵn nhiều lần / gửi trùng trong vài phút → chỉ trả lời 1 lần
        if (
          text &&
          !fbImages.length &&
          (await isRepeatedMessage(senderId, text, messageId).catch(() => false))
        ) {
          console.log("Bỏ qua tin trùng của khách:", text);
          continue;
        }

        await fbAction(senderId, "mark_seen");
        await fbAction(senderId, "typing_on");

        const reply = await generateReply(senderId, text, savedImages, settings);
        if (reply.skip) continue;
        const { messages, images, imageNote } = reply;
        openedProductId = reply.openingProductId || null;

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
          await addMessage(senderId, "bot", imageNote, images).catch(() => {});
        }
      } catch (err) {
        console.error("Lỗi xử lý tin nhắn:", err);
        if (openedProductId) await releaseOpening(senderId, openedProductId).catch(() => {});
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

// ---- Câu mở đầu quảng cáo: khách hỏi giá lần đầu → gửi câu soạn sẵn + ẢNH MẪU (không gửi ảnh thực tế) ----
const MAX_OPENING_IMAGES = 10;
const QUIET_AFTER_OPENING_MS = 2 * 60 * 1000; // vừa gửi mở đầu xong, khách hỏi giá tiếp → im lặng, khỏi trả lời trùng
const QUIET_AFTER_PRESET_MS = 10 * 60 * 1000; // khách bấm lại đúng câu hỏi quảng cáo có sẵn → im lặng lâu hơn

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

function openingAlreadySent(history, p) {
  const first = splitScript(p.openingScript)[0];
  return history.some((m) => m.from !== "customer" && m.text === first);
}

function openingReply(p) {
  // Mở đầu chỉ gửi ảnh mẫu. Ảnh thực tế để dành, khách hỏi mới gửi.
  const images = (p.sampleImages || []).slice(0, MAX_OPENING_IMAGES);
  return {
    messages: splitScript(p.openingScript),
    images,
    imageNote: images.length ? `📷 [Bot đã gửi ${images.length} ảnh mẫu của "${p.name}" cùng câu mở đầu]` : "",
    openingProductId: p.id,
  };
}

// ---- Gọi Google Gemini API: soạn câu trả lời + quyết định có gửi ảnh không ----
const MAX_IMAGES = 4;
// Câu dùng khi AI lỗi — không được đưa vào lịch sử để model không bắt chước
const FALLBACK_TEXT = "Dạ anh/chị chờ shop một chút, shop kiểm tra rồi phản hồi mình ngay ạ.";
const OLD_FALLBACK = "Dạ shop chưa rõ ý anh/chị lắm";

function buildSystemPrompt(catalogText, shopInfo, currentProduct) {
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
- Giá bán, size, màu, ưu đãi nằm trong phần "Nội dung" của từng sản phẩm; đọc kỹ để báo đúng giá theo số lượng khách hỏi.
- Chỉ dùng thông tin trong danh sách sản phẩm và thông tin shop bên dưới. Không bịa giá, tính năng, khuyến mãi, thời gian giao hàng. Nếu chưa có thông tin thì nói shop sẽ kiểm tra lại và mời khách để lại số điện thoại.

ẢNH KHÁCH GỬI
- Khách có thể gửi ảnh (mẫu muốn hỏi, ảnh chụp sản phẩm...). Hãy xem ảnh và đối chiếu với danh sách sản phẩm: nếu giống sản phẩm nào thì nói tên sản phẩm đó; nếu không chắc thì nói thật và hỏi lại khách.
- Nếu khách chỉ gửi ảnh mà chưa hỏi gì, xác nhận đã nhận ảnh bằng 1 câu ngắn và hỏi khách muốn biết gì về mẫu này.

CÂU MỞ ĐẦU QUẢNG CÁO
- Một số sản phẩm có "câu mở đầu quảng cáo soạn sẵn" (ghi CÓ trong danh sách). Khi khách nhắn lần đầu kiểu hỏi giá hoặc xin tư vấn chung về sản phẩm đó (vd: "giá sản phẩm bao nhiêu", "giá sao shop", "tư vấn giúp mình") và câu mở đầu chưa được gửi trong cuộc trò chuyện, hãy đặt use_opening_product là id sản phẩm và để messages là mảng rỗng. Hệ thống sẽ tự gửi đúng câu mở đầu kèm ảnh mẫu (không kèm ảnh thực tế).

GỬI ẢNH
- Không tự gửi ảnh thực tế khi khách chưa hỏi. Chỉ gửi ảnh khi khách xin xem ảnh, hình, "xem hàng", "ảnh thật", "ảnh feedback" — khi đó hãy đặt send_images.
- type "sample" = ảnh mẫu/giới thiệu sản phẩm; "real" = ảnh thực tế (chụp hàng thật, khách hàng thật); "both" = khi khách chỉ nói chung "ảnh".
- Mỗi ảnh có mã (S1, S2 là ảnh mẫu; R1, R2 là ảnh thực tế) và có thể có tên. Khi khách hỏi một mẫu/màu/kiểu cụ thể (vd "váy trắng", "mẫu trắng", "màu đen"), hãy chọn các ảnh có tên khớp nhất và điền image_ids (danh sách mã ảnh). Nếu không ảnh nào có tên khớp, nói thật là shop chưa có ảnh mẫu đó và hỏi khách muốn xem loại nào; không gửi ảnh không liên quan.
- product_id lấy đúng từ danh sách. Nếu chưa biết khách hỏi sản phẩm nào và shop có nhiều sản phẩm, đặt send_images là null và hỏi khách muốn xem sản phẩm nào.
- Chỉ gửi loại ảnh mà sản phẩm đang có (xem số ảnh trong danh sách). Nếu không có ảnh loại khách cần, nói thật và đề nghị gửi loại khác, hoặc để shop gửi sau. Không hứa gửi ảnh mà không có.
- Khi gửi ảnh, viết 1 tin ngắn dẫn vào (vd: "shop gửi anh xem ảnh nhé"). Không gửi lại ảnh đã gửi ở các tin trước.

ĐỊNH DẠNG TRẢ LỜI: chỉ trả về JSON hợp lệ, không thêm chữ nào khác:
{"messages": ["tin 1", "tin 2 (nếu cần)"], "send_images": null, "use_opening_product": null}
hoặc {"messages": ["..."], "send_images": {"product_id": "id sản phẩm", "type": "sample" | "real" | "both", "image_ids": ["S1"]}, "use_opening_product": null}
(image_ids chỉ điền khi khách hỏi mẫu/màu cụ thể; use_opening_product là id sản phẩm hoặc null)

SẢN PHẨM KHÁCH ĐANG QUAN TÂM
${
  currentProduct
    ? `Khách đang hỏi về sản phẩm [id: ${currentProduct.id}] ${currentProduct.name} (xác định từ câu hỏi quảng cáo khách bấm hoặc từ tên khách nhắc). Khi khách hỏi chung chung (giá, ảnh, còn hàng, size...) mà không nêu tên sản phẩm thì hiểu là hỏi sản phẩm này và dùng đúng id này cho send_images / use_opening_product. Chỉ chuyển sang sản phẩm khác khi khách nhắc rõ.`
    : "Chưa xác định được khách hỏi sản phẩm nào."
}

THÔNG TIN & QUY TẮC CỦA SHOP (do chủ shop cung cấp):
${shopInfo?.trim() || "(chủ shop chưa cung cấp thêm)"}

DANH SÁCH SẢN PHẨM:
${catalogText}`;
}

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

/** Đổi lịch sử chat trong DB thành contents của Gemini (xen kẽ user/model, kết thúc bằng user). */
async function buildContents(history, latestText, latestImages) {
  const items = [];
  for (const m of history) {
    const isCustomer = m.from === "customer";
    if (!isCustomer && (m.text.startsWith(OLD_FALLBACK) || m.text === FALLBACK_TEXT)) continue;
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

async function generateReply(senderId, customerMessage, customerImages, settings) {
  const fallback = { messages: [FALLBACK_TEXT], images: [], imageNote: "" };

  const products = await getProducts();

  let history = [];
  try {
    history = await getRecentMessages(senderId, 14);
  } catch (e) {
    console.error("Không đọc được lịch sử chat:", e.message);
  }

  // Suy ra sản phẩm khách đang hỏi: từ câu quảng cáo/tên sản phẩm trong tin nhắn → nhớ lại cho các tin sau
  const match = matchProduct(customerMessage, products);
  if (match) await setCurrentProduct(senderId, match.product.id).catch(() => {});
  let currentId = match?.product.id || (await getCurrentProduct(senderId).catch(() => null));
  if (!currentId && products.length === 1) currentId = products[0].id;
  const currentProduct = products.find((p) => String(p.id) === String(currentId)) || null;

  // Đường tắt (không cần gọi AI): khách bấm câu hỏi quảng cáo có sẵn, hoặc hỏi giá → câu mở đầu + ảnh mẫu
  if (!customerImages.length) {
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

  const systemPrompt = buildSystemPrompt(formatProductsForPrompt(products), settings.botPrompt, currentProduct);
  const contents = await buildContents(history, customerMessage, customerImages);

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GOOGLE_API_KEY}`;

  // Thử lần 1: JSON + suy nghĩ ít. Nếu lỗi/rỗng, thử lần 2 với cấu hình đơn giản nhất.
  const attempts = [
    { maxOutputTokens: 2048, temperature: 0.8, responseMimeType: "application/json", thinkingConfig: { thinkingLevel: "low" } },
    { maxOutputTokens: 4096, temperature: 0.8 },
  ];

  let raw = "";
  for (let i = 0; i < attempts.length && !raw.trim(); i++) {
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: systemPrompt }] },
          contents,
          generationConfig: attempts[i],
        }),
      });
      const data = await response.json();
      if (data.error) console.error(`Lỗi Gemini API (lần ${i + 1}):`, JSON.stringify(data.error));
      const cand = data.candidates?.[0];
      raw = cand?.content?.parts?.map((p) => p.text || "").join("") || "";
      if (!raw.trim()) {
        console.warn(
          `Gemini không trả nội dung (lần ${i + 1}). finishReason=${cand?.finishReason} promptFeedback=${JSON.stringify(data.promptFeedback || null)}`
        );
      }
    } catch (e) {
      console.error(`Lỗi gọi Gemini (lần ${i + 1}):`, e.message);
    }
  }
  console.log("---- Khách hỏi:", customerMessage);
  console.log("---- Bot trả lời:", raw || "(không có nội dung)");

  const parsed = parseModelJson(raw);

  // Lấy danh sách tin từ JSON (chịu được vài kiểu trả về lệch chuẩn); không phải JSON thì coi cả đoạn là câu trả lời
  let list = [];
  if (Array.isArray(parsed?.messages)) list = parsed.messages;
  else if (typeof parsed?.messages === "string") list = [parsed.messages];
  else if (typeof parsed?.reply === "string") list = [parsed.reply];
  else if (!parsed && raw.trim()) list = [raw.trim()];
  let messages = list.map((m) => String(m).trim()).filter(Boolean).slice(0, 2);

  // Model muốn dùng câu mở đầu quảng cáo (khách hỏi tương tự "giá bao nhiêu")
  if (parsed?.use_opening_product) {
    const p = products.find((x) => String(x.id) === String(parsed.use_opening_product));
    if (p && (p.openingScript || "").trim() && !openingAlreadySent(history, p)) return openingReply(p);
  }

  // Chọn ảnh cần gửi
  let images = [];
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
      if (images.length) {
        const names = picked.map((x) => x.label).filter(Boolean);
        imageNote = `📷 [Bot đã gửi ${images.length} ảnh của "${p.name}"${names.length ? ": " + names.join(", ") : ""}]`;
      }
    }
  }

  if (!messages.length) {
    // Model chỉ yêu cầu gửi ảnh mà quên viết câu dẫn → tự thêm 1 câu ngắn
    if (images.length) messages = ["Dạ shop gửi anh/chị xem ảnh nhé ạ."];
    else return fallback;
  }
  return { messages, images, imageNote };
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
