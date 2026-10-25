// lib/orderDraft.js — đọc đoạn chat rồi điền sẵn thông tin đơn (tên, SĐT, địa chỉ, sản phẩm, màu/size, SL, giá).
// Dùng chung cho: nút "Tạo đơn" ở khung chat (app/api/orders/draft) và việc TỰ TẠO ĐƠN khi khách để lại SĐT (lib/autoOrder.js).
import { extractPhone, getCustomerInfo } from "./conversations";
import { getAllRawKeys } from "./apiKeys";
import { callGemini } from "./gemini";
import { hasGroq } from "./groq";
import { hasMoney } from "./dealPrice";
import { deriveOrderFacts } from "./orderFacts";
import { productAttributes, sanitizeVariant } from "./attributes";

const WINDOW = 30; // số tin cuối AI được đọc (trước đây 20 → giá đã mặc cả ở đầu cuộc chat hay bị trôi mất)

/** Gemini trước; lỗi/hết hạn mức → Groq dự phòng (nếu có). Dùng chung hàm gọi ở lib/gemini.js. */
async function askGemini(prompt, keys, budgetMs, tryMs) {
  const r = await callGemini(
    "",
    [{ role: "user", parts: [{ text: prompt }] }],
    { temperature: 0, responseMimeType: "application/json", thinkingConfig: { thinkingLevel: "low" } },
    Date.now() + budgetMs,
    keys,
    {
      timeoutMs: tryMs,
      groqReserveMs: 8000,
      groqSystem: "Bạn trích thông tin đơn hàng từ đoạn chat. Chỉ trả về JSON hợp lệ.",
      groqMinMs: 5000,
      groqTimeoutMs: 12000,
    }
  );
  if (r.text && r.model && !/gemini/i.test(r.model)) console.log(`Gemini lỗi → dùng ${r.model} để lên đơn`);
  return r.text || "";
}

/** Tin cũ của chủ shop / bot có nhắc giá (cũ → mới), trong 3 ngày gần đây. Dạng "CHỦ SHOP: ..." / "BOT: ...". */
function olderPriceLines(messages, { max = 4, days = 3 } = {}) {
  const since = Date.now() - days * 86400000;
  return (messages || [])
    .filter((m) => {
      if (!m || (m.from !== "admin" && m.from !== "bot") || !hasMoney(m.text)) return false;
      const t = m.time ? new Date(m.time).getTime() : NaN;
      return Number.isNaN(t) || t >= since;
    })
    .slice(-max)
    .map((m) => `${m.from === "admin" ? "CHỦ SHOP" : "BOT"}: ${String(m.text || "").replace(/\s+/g, " ").trim().slice(0, 300)}`);
}

function parseJson(raw) {
  try {
    return JSON.parse(String(raw).replace(/```json|```/g, "").trim());
  } catch {
    return null;
  }
}

/**
 * conv = kết quả getConversation(); products = danh sách sản phẩm được phép chọn.
 * budgetMs = tổng thời gian chờ AI tối đa. Trả về { order, aiOk }.
 */
export async function buildOrderDraft(conversationId, conv, products, { budgetMs = 40000, tryMs = 15000 } = {}) {
  // Chỉ quét WINDOW tin nhắn cuối cùng (tính chung cả khách lẫn bot/shop)
  const last20 = conv.messages.slice(-WINDOW);
  const chat = last20
    .filter((m) => m.text && !/^📷/.test(m.text))
    .map((m) => `${m.from === "customer" ? "KHÁCH" : m.from === "admin" ? "CHỦ SHOP" : "BOT"}: ${m.text}`)
    .join("\n");

  // Tin của CHỦ SHOP và của BOT có nhắc giá nhưng đã cũ hơn WINDOW tin cuối → vẫn đưa cho AI đọc (giá đã mặc cả/thỏa thuận không được trôi mất)
  const olderOwnerPrices = olderPriceLines(conv.messages.slice(0, -WINDOW), { max: 4 }).filter((t) => !chat.includes(t.replace(/^[^:]+: /, "")));

  // Phần tự điền không cần AI (luôn có, kể cả khi AI lỗi)
  const customerText = last20.filter((m) => m.from === "customer").map((m) => m.text).reverse();
  let phone = "";
  for (const t of customerText) {
    const p = extractPhone(t);
    if (p) {
      phone = p;
      break;
    }
  }
  // Thông tin bot đã ghi nhớ trong lúc chat (tên nhận hàng, SĐT, địa chỉ, màu/size) — dùng làm nền, AI đọc chat sẽ ghi đè nếu có mới hơn
  const saved = await getCustomerInfo(conversationId).catch(() => ({}));
  if (!phone && saved.phone) phone = saved.phone;
  const order = {
    customerName: saved.name || conv.name || "",
    phone,
    address: saved.address || "",
    productId: "",
    productName: "",
    variant: saved.variant || "",
    quantity: 1,
    unitPrice: 0,
    shipFee: 0,
    note: "",
  };

  const keys = await getAllRawKeys();
  let aiOk = false;
  let aiQty = 0; // số lượng AI đọc được từ chat (0 = AI không ra số → KHÔNG được coi là 1)
  let aiVariant = "";
  if ((keys.length || (await hasGroq())) && chat) {
    const productText = products
      .map((p) => `[id: ${p.id}] ${p.name}\n   ${(p.description || "").slice(0, 1500)}`)
      .join("\n");
    const prompt = `Bạn là trợ lý lên đơn cho shop thời trang. Đọc đoạn chat giữa KHÁCH và SHOP, rồi trích thông tin để lên đơn.

DANH SÁCH SẢN PHẨM CỦA SHOP:
${productText || "(chưa có)"}

ĐOẠN CHAT (nhãn KHÁCH = khách; BOT = trợ lý tự động của shop; CHỦ SHOP = chủ shop tự nhắn tay):
${chat}
${olderOwnerPrices.length ? `\nTIN CŨ HƠN CÓ NHẮC GIÁ (ngoài ${WINDOW} tin cuối; xếp từ cũ đến mới, giá nhắc SAU CÙNG là giá hiện hành nếu khách chưa đổi ý):\n${olderOwnerPrices.join("\n")}\n` : ""}
Trả về DUY NHẤT 1 JSON đúng dạng:
{"customerName":"tên người nhận","phone":"số điện thoại","address":"địa chỉ nhận hàng đầy đủ (số nhà, đường, phường/xã, quận/huyện, tỉnh/thành)","productId":"id sản phẩm khách chốt mua, lấy đúng từ danh sách","variant":"màu/size khách chọn, vd: đỏ, size M","quantity":số lượng,"unitPrice":giá 1 sản phẩm bằng số (VNĐ, không dấu chấm),"shipFee":phí ship bằng số hoặc 0,"note":"ghi chú khác của khách nếu có"}

QUY TẮC GIÁ: unitPrice là giá 1 sản phẩm theo GIÁ CHỐT CUỐI CÙNG giữa shop và khách, KHÔNG phải giá niêm yết. Giá chốt là giá cuối cùng mà BOT hoặc CHỦ SHOP đã nói và khách đồng ý hoặc không phản đối (khách nói "320 chứ", "ok", hoặc tiếp tục chốt màu/size/địa chỉ là đồng ý). Nếu giá của BOT và của CHỦ SHOP khác nhau thì lấy giá của CHỦ SHOP. Nếu giá chốt là TỔNG tiền cho N sản phẩm (vd "2 váy 320k") thì quantity = N và unitPrice = tổng chia N (vd 160000). Chỉ dùng giá trong danh sách sản phẩm khi chưa ai thỏa thuận giá khác.
Quy tắc: chỉ lấy thông tin có trong chat hoặc danh sách sản phẩm, KHÔNG bịa. Không có thì để chuỗi rỗng hoặc 0 (quantity mặc định 1). Nếu giá phụ thuộc số lượng (vd mua 2 giá rẻ hơn) thì tính unitPrice theo số lượng khách chốt. Địa chỉ lấy theo lần khách gửi mới nhất. Chỉ có tối đa ${WINDOW} tin nhắn cuối của cuộc trò chuyện (kèm vài tin giá cũ hơn nếu có), hãy dùng đúng những tin này.`;
    const parsed = parseJson(await askGemini(prompt, keys, budgetMs, tryMs));
    if (parsed && typeof parsed === "object") {
      aiOk = true;
      if (parsed.customerName) order.customerName = String(parsed.customerName);
      if (parsed.phone) order.phone = String(parsed.phone).replace(/[\s.-]/g, "");
      if (parsed.address) order.address = String(parsed.address);
      const p = products.find((x) => String(x.id) === String(parsed.productId));
      if (p) {
        order.productId = String(p.id);
        order.productName = p.name;
      }
      if (parsed.variant) {
        aiVariant = String(parsed.variant);
        order.variant = aiVariant;
      }
      aiQty = Math.max(0, Math.round(Number(parsed.quantity)) || 0);
      if (aiQty >= 1) order.quantity = aiQty;
      order.unitPrice = Math.max(0, Number(parsed.unitPrice) || 0);
      order.shipFee = Math.max(0, Number(parsed.shipFee) || 0);
      if (parsed.note) order.note = String(parsed.note);
    }
  }

  // Màu/size/chiều dài + SỐ LƯỢNG + giá: tính bằng đúng công thức đã dùng để soạn tin báo đơn cho khách (lib/orderFacts.js),
  // không để AI tự ghi số lượng/chiều dài làm lệch với những gì bot đã báo.
  const warnings = [];
  try {
    const lp = products.find((x) => String(x.id) === String(order.productId));
    if (lp) {
      const facts = deriveOrderFacts({ product: lp, messages: conv.messages.slice(-60), variantText: saved.variant || "" });
      if (facts.attrMode) {
        // Chỉ nhận lựa chọn khách ĐÃ xác nhận và nằm trong danh sách của sản phẩm; chữ AI tự ghi chỉ giữ phần hợp lệ
        const attrs = productAttributes(lp);
        order.variant = facts.variant || sanitizeVariant(attrs, aiVariant || saved.variant || "");
        if (aiVariant && sanitizeVariant(attrs, aiVariant) !== aiVariant.trim()) warnings.push(`AI ghi lựa chọn "${aiVariant}" có phần không nằm trong danh sách của sản phẩm — đã bỏ phần đó.`);
        order.lines = facts.lines;
      }
      if (facts.qtySource === "default" && aiQty >= 1) {
        order.qtySource = "ai"; // khách không nói rõ, AI đọc chat ra số lượng → dùng số AI
      } else {
        order.quantity = facts.quantity;
        order.qtySource = facts.qtySource;
      }
      if (facts.dealTotal) {
        order.unitPrice = Math.round(facts.dealTotal / Math.max(1, Number(order.quantity) || 1));
        order.dealTotal = facts.dealTotal;
      }
      for (const i of facts.issues) warnings.push(i.message);
    }
  } catch (e) {
    console.error("Lỗi suy ra số lượng/lựa chọn từ chat:", e.message);
  }
  if (!order.qtySource) {
    // Không có sản phẩm để đối chiếu: số lượng chỉ là mặc định nếu AI cũng không đọc được
    order.qtySource = aiQty >= 1 ? "ai" : "default";
  }
  if (order.qtySource === "default") warnings.push("Chưa thấy khách nói số lượng nên tạm ghi 1 — hãy kiểm tra lại trước khi chốt.");
  return { order, aiOk, warnings };
}
