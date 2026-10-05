// lib/botPlayground.js — chạy bot thử trong trang "Dạy bot" (chủ shop đóng vai khách).
// Mô phỏng ĐÚNG luồng của webhook thật với một khách mới:
//   - khách nhắn lần đầu → bot gửi câu mở đầu quảng cáo + ảnh mẫu (không qua AI)
//   - các tin sau → AI trả lời, thấy lịch sử y như bot thật (có dòng giữ chỗ "khách mới nhắn hỏi thông tin sản phẩm")
//   - sản phẩm tự nhận biết từ tin khách (không biết trước), tên khách + thông tin khách đã nói được nhớ trong đoạn chat
// KHÔNG gửi gì cho Facebook và KHÔNG lưu vào hộp thoại khách hàng.
import { getProducts, formatProductsForPrompt, norm, matchProduct, openingImageList } from "./products";
import { getSettings } from "./settings";
import { getAllRawKeys } from "./apiKeys";
import { buildSystemPrompt } from "./botPrompt";
import { getTrainingForPrompt } from "./training";

const MAX_OPENING_IMAGES = 10; // giống webhook
const OPENING_MARK = "[Shop đã gửi câu mở đầu quảng cáo + ảnh mẫu]";
const PLACEHOLDER_FIRST = "(khách mới nhắn hỏi thông tin sản phẩm)"; // giống dòng giữ chỗ trong webhook

const MODELS = [
  ...new Set(
    [
      process.env.GEMINI_MODEL,
      ...(process.env.GEMINI_FALLBACK_MODELS
        ? process.env.GEMINI_FALLBACK_MODELS.split(",")
        : ["gemini-3.6-flash", "gemini-3.5-flash", "gemini-3.5-flash-lite"]),
    ]
      .map((m) => (m || "").trim().replace(/^models\//, ""))
      .filter(Boolean)
  ),
];

async function callModel(systemPrompt, contents, keys, { budgetMs = 40000, maxOutputTokens = 2048, temperature = 0.8 } = {}) {
  const t0 = Date.now();
  for (const model of MODELS) {
    for (const k of keys) {
      const remaining = budgetMs - (Date.now() - t0);
      if (remaining < 3000) return "";
      for (const withThinking of [true, false]) {
        try {
          const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
            method: "POST",
            headers: { "Content-Type": "application/json", "x-goog-api-key": k.key || "" },
            body: JSON.stringify({
              systemInstruction: { parts: [{ text: systemPrompt }] },
              contents,
              generationConfig: {
                maxOutputTokens,
                temperature,
                responseMimeType: "application/json",
                ...(withThinking ? { thinkingConfig: { thinkingLevel: "low" } } : {}),
              },
            }),
            signal: AbortSignal.timeout(Math.min(18000, remaining)),
          });
          if (!res.ok) {
            const data = await res.json().catch(() => ({}));
            // model không nhận thinkingConfig → thử lại không kèm; lỗi khác → đổi key/model
            if (res.status === 400 && withThinking && /think/i.test(data?.error?.message || "")) continue;
            break;
          }
          const data = await res.json();
          const out = data?.candidates?.[0]?.content?.parts?.map((p) => p.text || "").join("") || "";
          if (out.trim()) return out;
          break;
        } catch {
          break;
        }
      }
    }
  }
  return "";
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

// ---- Các hàm dưới đây sao y từ webhook để chat thử hành xử giống bot thật ----
function isPriceInquiry(text, maxLen = 50) {
  const t = norm(text);
  if (!t || t.length > maxLen) return false;
  if (/gia dinh|gia toc|gia dung/.test(t)) return false;
  return /\b(gia|bao nhieu|bao nhiu|bn|bao tien|nhieu tien|price)\b/.test(t);
}

function splitScript(script) {
  const chunks = [];
  let cur = "";
  for (const para of String(script || "").trim().split(/\n{2,}/)) {
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

function stripBotNotes(t) {
  return String(t || "")
    .replace(/📷?\s*\[\s*(Bot|Shop|Hệ thống|Khách)\s+đã\s+gửi[^\]]*\]?/gi, "")
    .replace(/\[\s*(Bot|Shop)\s+đã\s+gửi[^\]]*\]/gi, "")
    .replace(/📷/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function verifyCustomerInfo(info, customerTexts) {
  const blob = norm(customerTexts.join(" \n "));
  const digits = customerTexts.join(" ").replace(/\D/g, "");
  const out = {};
  for (const k of ["name", "phone", "address", "variant"]) {
    const v = typeof info?.[k] === "string" ? info[k].trim() : "";
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

function openingMessages(p) {
  const extras = (Array.isArray(p?.openingExtras) ? p.openingExtras : [])
    .map((t) => String(t || "").trim())
    .filter(Boolean)
    .map((t) => t.slice(0, 2000));
  return [...splitScript(p.openingScript), ...extras];
}

const hasOpening = (p) => !!(p?.openingScript || "").trim();

function openingResult(p, customerInfo) {
  const n = openingImageList(p, MAX_OPENING_IMAGES).length;
  return {
    messages: openingMessages(p),
    opening: true,
    productId: p.id,
    customerInfo,
    note: n ? `📷 Bot thật gửi kèm ${n} ảnh mẫu của "${p.name}" cùng câu mở đầu này.` : "",
  };
}

function extractMessages(parsed, raw) {
  let list = [];
  if (Array.isArray(parsed?.messages)) list = parsed.messages;
  else if (typeof parsed?.messages === "string") list = [parsed.messages];
  else if (typeof parsed?.reply === "string") list = [parsed.reply];
  else if (!parsed && String(raw || "").trim()) list = [raw];
  return list.map((m) => stripBotNotes(m).slice(0, 1900)).filter(Boolean).slice(0, 2);
}

/**
 * history: [{ from: "customer" | "bot", text, opening? }] — kết thúc bằng tin của khách.
 *   opening=true: lượt bot gửi câu mở đầu quảng cáo (text chỉ là ghi chú, câu thật lấy từ sản phẩm).
 * Trả về { messages, note, opening, productId, customerInfo } hoặc { error }.
 */
export async function runPlayground({ history, productId, customerName, customerInfo }) {
  const products = await getProducts();
  const settings = await getSettings();

  const rows = [];
  for (const m of Array.isArray(history) ? history : []) {
    const from = m?.from === "customer" ? "customer" : "bot";
    const text = String(m?.text || "").trim();
    const opening = from === "bot" && !!m?.opening;
    if (!text && !opening) continue;
    rows.push({ from, text, opening });
  }
  if (!rows.length || rows[rows.length - 1].from !== "customer") {
    return { error: "Hãy gõ một tin nhắn với vai khách trước." };
  }

  const customerTexts = rows.filter((r) => r.from === "customer").map((r) => r.text);
  const lastCustomer = customerTexts[customerTexts.length - 1];
  const info = {};
  for (const k of ["name", "phone", "address", "variant"]) {
    if (typeof customerInfo?.[k] === "string" && customerInfo[k].trim()) info[k] = customerInfo[k].trim();
  }

  // 1) Sản phẩm khách đang hỏi: nhận biết từ tin khách (như bot thật) → không có thì dùng cái đã chọn/đã nhận biết trước đó
  let match = null;
  for (const t of customerTexts) {
    const mm = matchProduct(t, products);
    if (mm && (!match || mm.exact || !match.exact)) match = mm;
  }
  let currentId = match?.product.id || (productId ? String(productId) : null);
  if (!currentId && products.length === 1) currentId = products[0].id;
  const currentProduct = products.find((p) => String(p.id) === String(currentId)) || null;

  const openingSent = rows.some((r) => r.opening);
  const firstContact = !rows.some((r) => r.from === "bot");

  // 2) Khách MỚI: bot thật chỉ gửi câu mở đầu + ảnh mẫu, chưa gọi AI
  if (firstContact) {
    const target = match?.product || currentProduct || products.find(hasOpening) || null;
    if (hasOpening(target)) return openingResult(target, info);
  }

  // 3) Đường tắt giống webhook: khách bấm câu hỏi quảng cáo có sẵn / hỏi giá mà chưa gửi mở đầu
  if (!openingSent) {
    const lm = matchProduct(lastCustomer, products);
    const target = lm?.exact ? lm.product : isPriceInquiry(lastCustomer, lm ? 120 : 50) ? lm?.product || currentProduct : null;
    if (hasOpening(target)) return openingResult(target, info);
  }

  // 4) Dựng câu lệnh + lịch sử như bot thật
  const trainingText = await getTrainingForPrompt(currentProduct?.id, [lastCustomer, ...customerTexts.slice(-4, -1).reverse()]).catch(() => "");
  const systemPrompt = buildSystemPrompt(
    formatProductsForPrompt(products),
    settings.botPrompt,
    currentProduct,
    (customerName || "").trim() || null,
    info,
    trainingText
  );

  const openingProduct = hasOpening(currentProduct) ? currentProduct : products.find(hasOpening) || null;
  let list = rows.map((r) => ({
    from: r.from,
    text: r.opening && openingProduct ? openingMessages(openingProduct).join("\n") : r.text,
    opening: r.opening,
  }));
  // Webhook bỏ các tin khách gõ trước câu mở đầu và thêm 1 dòng giữ chỗ → làm y như vậy
  const firstOpening = list.findIndex((r) => r.opening);
  if (firstOpening >= 0) {
    list = list.slice(firstOpening);
    list.unshift({ from: "customer", text: PLACEHOLDER_FIRST, opening: false });
  }

  // Webhook chỉ nhớ 22 tin gần nhất → làm y như vậy; nếu cắt xong mà đầu là tin bot thì thêm dòng giữ chỗ
  if (list.length > 22) {
    list = list.slice(-22);
    if (list[0].from !== "customer") list.unshift({ from: "customer", text: PLACEHOLDER_FIRST, opening: false });
  }

  const contents = [];
  for (const m of list) {
    const role = m.from === "customer" ? "user" : "model";
    const last = contents[contents.length - 1];
    if (last && last.role === role) last.parts[0].text += "\n" + m.text;
    else contents.push({ role, parts: [{ text: m.text }] });
  }
  while (contents.length && contents[0].role !== "user") contents.shift();
  if (!contents.length || contents[contents.length - 1].role !== "user") {
    return { error: "Hãy gõ một tin nhắn với vai khách trước." };
  }

  const keys = await getAllRawKeys();
  if (!keys.length) return { error: "Chưa có API key Gemini. Thêm bằng nút 🔑 ở trang quản trị." };

  let raw = await callModel(systemPrompt, contents, keys);
  if (!raw) return { error: "AI không trả lời được (quá tải hoặc hết hạn mức). Thử gửi lại sau ít giây." };
  let parsed = parseJson(raw);

  // Model muốn dùng câu mở đầu quảng cáo (khách hỏi kiểu "giá bao nhiêu") và chưa gửi → gửi như bot thật
  if (parsed?.use_opening_product && !openingSent) {
    const p = products.find((x) => String(x.id) === String(parsed.use_opening_product));
    if (hasOpening(p)) return openingResult(p, info);
  }

  let messages = extractMessages(parsed, raw);

  // Model đặt use_opening_product nhưng câu mở đầu đã gửi → messages rỗng: ép trả lời bằng chữ (như bot thật)
  if (!messages.length && parsed?.use_opening_product) {
    const retryRaw = await callModel(
      systemPrompt +
        "\n\nLƯU Ý BẮT BUỘC: mảng messages KHÔNG được rỗng. Câu mở đầu quảng cáo đã gửi rồi nên use_opening_product phải là null. Hãy trả lời trực tiếp câu khách vừa nhắn bằng chữ.",
      contents,
      keys,
      { budgetMs: 25000 }
    );
    if (retryRaw) {
      parsed = parseJson(retryRaw) || parsed;
      messages = extractMessages(parsed, retryRaw);
    }
  }

  // Nhớ thông tin khách vừa nói (chỉ giữ cái khách THỰC SỰ đã nhắn)
  const mergedInfo = { ...info };
  if (parsed?.customer_info && typeof parsed.customer_info === "object") {
    Object.assign(mergedInfo, verifyCustomerInfo(parsed.customer_info, customerTexts));
  }

  // Những việc bot thật sẽ làm thêm nhưng trang thử không gửi: ảnh
  const notes = [];
  if (parsed?.send_images?.product_id) {
    const p = products.find((x) => String(x.id) === String(parsed.send_images.product_id));
    notes.push(`Bot thật sẽ gửi ảnh${p ? ` của "${p.name}"` : ""} (${parsed.send_images.type || "ảnh"}) kèm tin này.`);
  }
  if (!messages.length && !notes.length) return { error: "Bot trả về rỗng, thử gửi lại." };
  return { messages, note: notes.join(" "), productId: currentProduct?.id || "", customerInfo: mergedInfo };
}

const PERSONAS = {
  normal: "khách bình thường, hỏi tự nhiên",
  haggle: "khách hay mặc cả, đòi giảm giá, so sánh với shop khác",
  doubt: "khách hay phân vân, nghi ngờ chất lượng, sợ mua phải hàng không giống hình, sợ bị lừa",
  rush: "khách vội, muốn chốt nhanh, hỏi ngắn cộc lốc",
  chatty: "khách hỏi dồn nhiều ý một lúc, viết tắt, thiếu dấu, sai chính tả",
};

/**
 * Gợi ý vài câu khách có thể nhắn tiếp theo (để chủ shop bấm chọn thay vì tự nghĩ tình huống).
 * Trả về { suggestions: [{ label, text }] } hoặc { error }.
 */
export async function suggestCustomerLines({ history, productId, persona }) {
  const products = await getProducts();
  const currentProduct =
    products.find((p) => String(p.id) === String(productId)) || (products.length === 1 ? products[0] : null);
  const keys = await getAllRawKeys();
  if (!keys.length) return { error: "Chưa có API key Gemini. Thêm bằng nút 🔑 ở trang quản trị." };

  const recent = (Array.isArray(history) ? history : [])
    .filter((m) => m?.text)
    .slice(-10)
    .map((m) => `${m.from === "customer" ? "Khách" : "Shop"}: ${m.text === OPENING_MARK ? "(đã gửi câu mở đầu quảng cáo + ảnh mẫu)" : String(m.text).slice(0, 300)}`)
    .join("\n");

  const system = `Bạn giúp chủ shop bán hàng online ở Việt Nam luyện bot chăm sóc khách bằng cách nghĩ ra các tình huống khách hay nhắn.
Hãy đóng vai khách Messenger thật: ${PERSONAS[persona] || PERSONAS.normal}.
Viết đúng kiểu người Việt nhắn tin: ngắn, hay viết tắt (k, dc, bn, ship, sp), nhiều khi không dấu, không văn vẻ.
Đề xuất đúng 5 câu khách có thể nhắn TIẾP THEO, mỗi câu thuộc một tình huống khác nhau (vd: hỏi giá, mặc cả, chọn mẫu/size/màu/công suất tuỳ loại sản phẩm, chất lượng/chất liệu, ship/COD/thời gian nhận, nghi ngờ hàng, bảo hành/đổi trả, xin xem ảnh thật, phân vân để hỏi chồng/người nhà, chốt đơn...). Chọn tình huống hợp với đoạn chat đang có và đúng với sản phẩm bên dưới; không lặp lại điều khách đã hỏi.
Chỉ trả về JSON hợp lệ: {"suggestions":[{"label":"tên tình huống 2-4 chữ","text":"câu khách nhắn"}]}

SẢN PHẨM:
${currentProduct ? formatProductsForPrompt([currentProduct]).slice(0, 3500) : formatProductsForPrompt(products).slice(0, 3500)}`;

  const contents = [{ role: "user", parts: [{ text: recent ? `Đoạn chat hiện tại:\n${recent}\n\nGợi ý 5 câu khách nhắn tiếp.` : "Chưa có đoạn chat nào. Gợi ý 5 câu khách có thể nhắn đầu tiên." }] }];
  const raw = await callModel(system, contents, keys, { budgetMs: 25000, maxOutputTokens: 1024, temperature: 1 });
  if (!raw) return { error: "AI không gợi ý được lúc này. Thử lại sau ít giây." };
  const parsed = parseJson(raw);
  const suggestions = (Array.isArray(parsed?.suggestions) ? parsed.suggestions : [])
    .map((s) => ({ label: String(s?.label || "").trim().slice(0, 30), text: String(s?.text || "").trim().slice(0, 300) }))
    .filter((s) => s.text)
    .slice(0, 6);
  if (!suggestions.length) return { error: "AI không gợi ý được lúc này. Thử lại sau ít giây." };
  return { suggestions };
}
