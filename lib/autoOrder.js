// lib/autoOrder.js — TỰ TẠO ĐƠN khi khách để lại số điện thoại trong chat.
//
// Cách chạy:
//  1) Khách nhắn tin có SĐT → tạo ngay 1 đơn nháp (bảng orders, đánh dấu auto: true) từ thông tin đã biết:
//     tên, SĐT, địa chỉ, màu/size bot đã ghi nhớ + sản phẩm khách đang hỏi.
//  2) Sau khi bot trả lời xong → điền thêm chỗ còn thiếu (địa chỉ, tên nhận hàng...). Nếu còn thiếu sản phẩm/địa chỉ
//     thì nhờ AI đọc chat điền (tối đa 3 lần cho mỗi đơn, để không tốn hạn mức AI).
//  3) Đơn hiện ở web Quản lý bán hàng (tab "Đơn chat") và ở cột đơn của khung chat, gắn nhãn "🤖 tự tạo".
//
// Đơn tự tạo mà chủ shop CHƯA xác nhận thì bot KHÔNG coi là "khách đã đặt hàng" (xem isUnconfirmedAuto),
// nên cách bot chat với khách không thay đổi gì. Chủ shop sửa đơn / đổi tình trạng / ghi vào doanh thu = xác nhận.
import { getSql } from "./db";
import { listOrders, saveOrder, isUnconfirmedAuto } from "./orders";
import { getCustomerInfo, getCustomerName, getCurrentProduct, getConversation, getOutgoingTexts, getRecentMessages } from "./conversations";
import { getProducts, filterProductsForPage } from "./products";
import { buildOrderDraft } from "./orderDraft";
import { deriveOrderFacts } from "./orderFacts";

const CLAIM_HOURS = 72; // mỗi khách chỉ tự tạo 1 đơn trong 72 giờ
const MAX_AI_TRIES = 3; // mỗi đơn tối đa 3 lần nhờ AI đọc chat
const MIN_AI_BUDGET_MS = 9000; // còn ít hơn ngần này thời gian thì bỏ qua bước AI

/** Bật mặc định; chủ shop tắt bằng nút ở tab "Đơn chat" (settings.autoOrder = false). */
export const autoOrderEnabled = (settings) => settings?.autoOrder !== false;

async function claim(senderId) {
  const sql = await getSql();
  const rows = await sql`INSERT INTO auto_order_claims (conversation_id, claimed_at) VALUES (${senderId}, now())
                         ON CONFLICT (conversation_id) DO UPDATE SET claimed_at = now()
                         WHERE auto_order_claims.claimed_at < now() - (${CLAIM_HOURS}::int * interval '1 hour')
                         RETURNING conversation_id`;
  return rows.length > 0;
}

async function releaseClaim(senderId) {
  const sql = await getSql();
  await sql`DELETE FROM auto_order_claims WHERE conversation_id = ${senderId}`;
}

const totalOf = (o) => {
  const qty = Number(o.quantity) || 1;
  // Giá do bảng giá mặc cả tính (tổng tiền chính xác, tránh lệch vài đồng khi chia cho số lượng) — chủ shop sửa tay đơn thì dùng công thức thường
  if (Number(o.dealTotal) > 0 && Number(o.unitPrice) === Math.round(Number(o.dealTotal) / qty)) return Number(o.dealTotal) + (Number(o.shipFee) || 0);
  return (Number(o.unitPrice) || 0) * qty + (Number(o.shipFee) || 0);
};

/**
 * Điền màu/size/chiều dài + SỐ LƯỢNG + giá của đơn từ chính cuộc chat, bằng ĐÚNG công thức đã dùng để soạn tin báo đơn gửi khách
 * (lib/orderFacts.js) → số lượng/chiều dài trong đơn lưu không thể lệch tin đã báo cho khách.
 * Trước đây đơn tự tạo mặc định SL = 1 và chỉ đổi khi sản phẩm có bảng giá mặc cả, lại bỏ qua số màu khách chọn → báo SL:2 nhưng lưu 1.
 * Thứ tự tin: nhiều màu / bảng giá / số khách nói > số AI đọc chat > mặc định 1 (chỉ khi không có gì mâu thuẫn).
 */
async function applyChatFacts(senderId, order) {
  if (!order.productId) return order;
  const all = await getProducts().catch(() => []);
  const product = all.find((p) => String(p.id) === String(order.productId));
  if (!product) return order;
  // Cùng khoảng tin (22 tin gần nhất) và cùng thông tin đã lưu mà bot dùng khi soạn tin báo đơn
  const [recent, info] = await Promise.all([getRecentMessages(senderId, 22).catch(() => []), getCustomerInfo(senderId).catch(() => ({}))]);
  const facts = deriveOrderFacts({ product, messages: recent, variantText: info?.variant || "" });
  const next = { ...order };
  if (facts.attrMode) next.variant = facts.variant; // chỉ lựa chọn khách đã xác nhận và nằm trong danh sách của sản phẩm (không còn giá trị lạ như 70cm)
  if (facts.qtySource === "default" && next.qtySource === "ai" && Number(next.quantity) >= 1) {
    // khách không nói rõ số lượng nhưng AI đọc chat ra số lượng → giữ số AI, không ghi đè bằng mặc định 1
  } else {
    next.quantity = facts.quantity;
    next.qtySource = facts.qtySource;
  }
  if (facts.dealTotal) {
    next.unitPrice = Math.round(facts.dealTotal / Math.max(1, Number(next.quantity) || 1));
    next.dealTotal = facts.dealTotal;
  }
  if (facts.attrMode) next.lines = facts.lines;
  const review = facts.issues.filter((i) => i.code === "qty_conflict" || i.code === "needs_confirm").map((i) => i.message);
  if (review.length) next.review = review;
  else delete next.review;
  return next;
}

async function findCurrentProduct(senderId, pageId) {
  const curId = await getCurrentProduct(senderId).catch(() => null);
  if (!curId) return null;
  const all = await getProducts().catch(() => []);
  return filterProductsForPage(all, pageId).find((p) => String(p.id) === String(curId)) || null;
}

/** Nhờ AI đọc chat điền đơn. Trả về { order, used } — chỉ ghi đè các ô AI thật sự có giá trị. */
async function enrichWithAI(senderId, order, budgetMs) {
  if ((order.aiTries || 0) >= MAX_AI_TRIES || budgetMs < MIN_AI_BUDGET_MS) return { order, used: false };
  const conv = await getConversation(senderId);
  const products = filterProductsForPage(await getProducts().catch(() => []), conv.pageId);
  const { order: d, aiOk } = await buildOrderDraft(senderId, conv, products, { budgetMs: Math.min(25000, budgetMs), tryMs: 12000 });
  const next = { ...order, aiTries: (order.aiTries || 0) + 1 };
  // Tên: nếu AI chỉ trả lại tên Facebook của khách thì coi là tạm, tên người nhận thật (từ chat) mới ghi đè
  if (d.customerName) {
    const isProfileName = d.customerName === conv.name;
    if (!isProfileName) {
      next.customerName = d.customerName;
      delete next.nameFromProfile;
    } else if (!next.customerName) {
      next.customerName = d.customerName;
      next.nameFromProfile = true;
    }
  }
  if (d.phone) next.phone = d.phone;
  if (d.address) next.address = d.address;
  if (d.variant) next.variant = d.variant;
  if (d.productId) {
    next.productId = d.productId;
    next.productName = d.productName;
  }
  if (aiOk) {
    // Chỉ nhận số lượng AI đọc được; AI không ra số thì GIỮ số đang có (không ghi đè bằng mặc định 1)
    const aq = Math.round(Number(d.quantity));
    if (aq >= 1) {
      next.quantity = aq;
      next.qtySource = "ai";
    }
    if (Number(d.unitPrice) > 0) next.unitPrice = Number(d.unitPrice);
    if (Number(d.shipFee) > 0) next.shipFee = Number(d.shipFee);
    if (d.note) next.note = d.note;
  }
  return { order: next, used: true };
}

const WATCH = ["customerName", "phone", "address", "productId", "productName", "variant", "quantity", "qtySource", "lines", "review", "unitPrice", "dealTotal", "shipFee", "note", "aiTries", "nameFromProfile"];
const same = (a, b) => WATCH.every((k) => JSON.stringify(a[k] ?? null) === JSON.stringify(b[k] ?? null));

/** Cập nhật đơn tự tạo đang chờ chủ shop xác nhận bằng thông tin mới nhất khách vừa cho. */
async function refreshOpen(senderId, open, { pageId, ai, budgetMs }) {
  const info = await getCustomerInfo(senderId).catch(() => ({}));
  let next = { ...open };
  // Đơn này chưa ai sửa tay (sửa tay là mất nhãn auto) nên được phép lấy thông tin mới nhất của khách
  if (info.name) {
    next.customerName = info.name;
    delete next.nameFromProfile;
  }
  if (info.phone) next.phone = info.phone;
  if (info.address) next.address = info.address;
  if (info.variant) next.variant = info.variant;
  if (!next.productId) {
    const p = await findCurrentProduct(senderId, pageId);
    if (p) {
      next.productId = String(p.id);
      next.productName = p.name;
    }
  }
  // Còn thiếu sản phẩm, địa chỉ hoặc GIÁ (đơn đang 0đ) → nhờ AI đọc chat (có giới hạn số lần)
  if (ai && (!next.productId || !next.address || !(Number(next.unitPrice) > 0))) {
    const r = await enrichWithAI(senderId, next, budgetMs).catch((e) => {
      console.error("Lỗi AI điền đơn tự tạo:", e.message);
      return { order: next, used: false };
    });
    next = r.order;
  }
  next = await applyChatFacts(senderId, next).catch((e) => {
    console.error("Lỗi áp giá từ bảng giá mặc cả:", e.message);
    return next;
  });
  next.total = totalOf(next);
  if (same(next, open) && next.total === open.total) return open;
  await saveOrder(senderId, open.pageId || pageId, next, open.id);
  return next;
}

/**
 * Gọi mỗi khi khách nhắn tin.
 *  - phone: số điện thoại có trong tin khách VỪA nhắn (không có thì thôi, chỉ cập nhật đơn đang chờ nếu có).
 *  - ai: cho phép nhờ AI đọc chat (chỉ bật ở lượt sau khi bot đã trả lời, để không làm bot trả lời chậm).
 *  - budgetMs: thời gian còn dư của lần webhook này.
 * Trả về đơn (đã tạo/cập nhật) hoặc null.
 */
export async function syncAutoOrder(senderId, { pageId = null, phone = null, settings = null, ai = false, budgetMs = 0 } = {}) {
  if (!senderId || !autoOrderEnabled(settings)) return null;
  const orders = await listOrders(senderId);

  // 1) Đã có đơn tự tạo đang chờ xác nhận → cập nhật thêm thông tin
  const open = orders.find(isUnconfirmedAuto);
  if (open) return await refreshOpen(senderId, open, { pageId, ai, budgetMs });

  // 2) Chưa có → chỉ tạo mới khi tin vừa rồi của khách có SĐT
  if (!phone) return null;
  const now = Date.now();
  if (orders.some((o) => o.status !== "returned" && now - new Date(o.createdAt).getTime() < CLAIM_HOURS * 3600 * 1000)) return null; // khách vừa có đơn rồi (đơn đã hủy thì không tính)
  if (!(await claim(senderId))) return null; // luồng khác vừa tạo hoặc chủ shop đã xóa đơn tự tạo trong 72 giờ qua

  try {
    const [info, fbName, product] = await Promise.all([
      getCustomerInfo(senderId).catch(() => ({})),
      getCustomerName(senderId).catch(() => null),
      findCurrentProduct(senderId, pageId),
    ]);
    let order = {
      customerName: info.name || fbName || "",
      phone: phone || info.phone || "",
      address: info.address || "",
      productId: product ? String(product.id) : "",
      productName: product ? product.name : "",
      variant: info.variant || "",
      quantity: 1,
      unitPrice: 0,
      shipFee: 0,
      note: "",
      auto: true,
      source: "auto",
      aiTries: 0,
    };
    if (!info.name && fbName) order.nameFromProfile = true;
    order = await applyChatFacts(senderId, order).catch(() => order);
    order.total = totalOf(order);
    const id = await saveOrder(senderId, pageId, order);
    order = { ...order, id };
    if (ai && (!order.productId || !order.address || !(Number(order.unitPrice) > 0))) {
      const r = await enrichWithAI(senderId, order, budgetMs).catch((e) => {
        console.error("Lỗi AI điền đơn tự tạo:", e.message);
        return { order, used: false };
      });
      if (r.used) {
        r.order = await applyChatFacts(senderId, r.order).catch(() => r.order);
        r.order.total = totalOf(r.order);
        await saveOrder(senderId, pageId, r.order, id);
        order = r.order;
      }
    }
    return order;
  } catch (e) {
    await releaseClaim(senderId).catch(() => {}); // lỗi → trả lại chỗ giữ để lần sau tạo lại được
    throw e;
  }
}
