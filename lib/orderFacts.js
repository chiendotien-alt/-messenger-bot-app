// lib/orderFacts.js — DỮ LIỆU ĐƠN CHUẨN HÓA suy ra từ cuộc chat. Chỉ chứa luật thuần (không gọi mạng/CSDL) nên test riêng được.
//
// Dùng chung cho tin báo đơn gửi khách VÀ dữ liệu đơn lưu vào hệ thống (đơn tự tạo, nút "Tạo đơn"):
// cùng một cách tính màu / size / chiều dài / số lượng / giá → tin báo đơn và đơn lưu không thể lệch nhau.
import { productAttributes, attributeStatus, composeVariant, summaryDetail, colorCount, confirmItems, sanitizeVariant, applyItemsToStatus } from "./attributes";
import { savedItemsStillValid } from "./orderItems";
import { hasLadder, computePriceContext, detectQty, summaryQty } from "./priceLadder";

/** Số lượng khách nói trong các tin của khách (mới nhất trước). Không thấy → null. */
const QTY_ASK_RE = /(?:may|bao nhieu)\s*(?:cai|chiec|bo|vay)|lay may|mua may|so luong/;
const QTY_REPLY_RE = /^(?:lay |cho |mua |chot )?(\d{1,2}|mot|hai|ba|bon)(?: (?:cai|chiec|bo|vay|c))?(?: (?:nha|nhe|a|ak|shop|sop|em|nhen))*$/;
const QTY_WORD = { mot: 1, hai: 2, ba: 3, bon: 4 };
/** Shop vừa hỏi "chị lấy mấy cái ạ?" và khách trả lời trơn "2" / "lấy 2" → số lượng. msgs: [{ from, text }] cũ → mới. */
export function qtyFromReplies(msgs) {
  const plainTxt = (t) => String(t || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/đ/gi, "d").toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
  for (let i = (msgs || []).length - 1; i >= 1; i--) {
    if (msgs[i].from !== "customer") continue;
    const prev = (() => { for (let j = i - 1; j >= 0; j--) if (msgs[j].from !== "customer") return msgs[j]; return null; })();
    if (!prev || !QTY_ASK_RE.test(plainTxt(prev.text))) continue;
    const m = plainTxt(msgs[i].text).match(QTY_REPLY_RE);
    if (!m) continue;
    const q = /^\d/.test(m[1]) ? parseInt(m[1], 10) : QTY_WORD[m[1]];
    if (q >= 1 && q <= 50) return q;
  }
  return null;
}

export function customerQtyHint(customerTextsNewestFirst) {
  for (const t of customerTextsNewestFirst || []) {
    const q = detectQty(t);
    if (q) return q;
  }
  return null;
}

/**
 * messages: [{ from, text }] cũ → mới (from === "customer" là khách, còn lại là bot/chủ shop)
 * variantText: lựa chọn đã lưu trước đó (nếu có)
 * Trả về:
 *   variant      — "Màu Đen x2 + Kem, Chiều dài 75cm, Size S" (chỉ giá trị khách ĐÃ xác nhận và nằm trong danh sách của sản phẩm)
 *   quantity     — số lượng (cùng công thức với tin báo đơn)
 *   qtySource    — colors | ladder | customer | default
 *   lines        — mỗi dòng hàng: { color, specs, qty }
 *   unitPrice/dealTotal — theo bảng giá mặc cả nếu sản phẩm có
 *   issues       — [{ code, message }] thông tin thiếu / mâu thuẫn, cần hỏi lại khách hoặc chủ shop xác minh
 */
export function deriveOrderFacts({ product, messages, variantText = "", savedItems = null }) {
  const msgs = (messages || [])
    .filter((m) => m && String(m.text || "").trim())
    .map((m) => ({ from: m.from === "customer" ? "customer" : m.from || "bot", text: String(m.text) }));
  const customerNewest = msgs.filter((m) => m.from === "customer").map((m) => m.text).reverse();
  const outgoing = msgs.filter((m) => m.from !== "customer");
  const attrs = productAttributes(product);
  const attrMode = attrs.length > 0;
  const status = attrMode ? attributeStatus(attrs, msgs, [], variantText) : null;
  // Danh sách món AI+hệ thống đã chốt ở lượt trước (khách chưa nhắn đổi gì) → đơn lưu ghi đúng từng món như tin báo đơn
  if (status && !status.items && savedItems) {
    const still = savedItemsStillValid(attrs, savedItems, msgs.filter((m) => m.from === "customer").map((m) => m.text));
    if (still && still.length >= 2) applyItemsToStatus(attrs, status, still, { mode: "multi" });
  }

  let ctx = null;
  if (product && hasLadder(product)) {
    ctx = computePriceContext({
      product,
      outgoing,
      customerNow: [],
      customerRecent: customerNewest,
      lastShopText: (outgoing[outgoing.length - 1] || {}).text || "",
      minQty: Math.max(attrMode ? colorCount(status) : 0, qtyFromReplies(msgs) || 0), // khách trả lời trơn "2" sau câu hỏi "lấy mấy cái"
    });
  }
  const itemsQty = status?.items?.length >= 2 ? status.items.reduce((a, it) => a + (it.qty || 1), 0) : 0; // khách liệt kê nhiều món khác nhau → tổng số lượng các món
  const hint = itemsQty || customerQtyHint(customerNewest) || qtyFromReplies(msgs);
  const detail = attrMode ? summaryDetail(status, (ctx && ctx.qty) || hint || 1) : null;
  const quantity = summaryQty({ detail, ctx, hintQty: hint });
  const colors = detail?.colors || [];
  const hasPrice = !!(ctx && ctx.row && ctx.dealTotal);

  let qtySource = "default";
  if (itemsQty) qtySource = "items";
  else if (colors.length > 1) qtySource = "colors";
  else if (hasPrice && !ctx.qtyGuess) qtySource = "ladder";
  else if (hint) qtySource = "customer";

  const specs = detail?.specs || [];
  const lines = detail?.items?.length >= 2
    ? detail.items.map((it) => ({ color: it.color || "", specs: it.specs || [], qty: it.qty || 1 })) // mỗi món 1 dòng, đúng cặp màu/size/dài
    : colors.length ? colors.map((c) => ({ color: c.name, specs, qty: c.qty || 1 })) : [{ color: "", specs, qty: quantity }];

  const issues = [];
  if (attrMode) {
    for (const x of confirmItems(status)) {
      issues.push({ code: "needs_confirm", message: `${x.attr.name}: khách nói "${x.pending?.raw}" không có trong danh sách (${x.attr.values.join(", ")}), chưa xác nhận` });
    }
    for (const x of status.list) {
      if (x.state === "missing" || x.state === "measured") issues.push({ code: "missing_attr", message: `Chưa chọn ${x.attr.name}` });
    }
  }
  // Khách nói tổng N cái nhưng số lượng ghi theo từng màu cộng lại ra số khác → mâu thuẫn, không tự chọn một số
  if (hint && colors.length > 1 && quantity !== hint) {
    issues.push({ code: "qty_conflict", message: `Khách nói ${hint} cái nhưng các màu cộng lại là ${quantity}` });
  }
  const conflict = issues.some((i) => i.code === "qty_conflict");

  return {
    attrMode,
    status,
    ctx,
    detail,
    hintQty: hint,
    variant: attrMode ? composeVariant(status) : String(variantText || "").trim(),
    quantity: Math.max(1, Math.round(Number(quantity) || 1)),
    qtySource,
    qtyConflict: conflict,
    lines,
    dealTotal: hasPrice ? ctx.dealTotal : 0,
    unitPrice: hasPrice ? Math.round(ctx.dealTotal / Math.max(1, quantity)) : 0,
    ready: attrMode ? status.list.every((x) => x.state === "chosen") : true,
    issues,
  };
}

/**
 * Kiểm tra đơn trước khi lưu/chốt. Trả về { errors, warnings }:
 *  errors   — dữ liệu sai hẳn (số lượng không phải số nguyên ≥ 1) → không được lưu
 *  warnings — thông tin lạ so với dữ liệu sản phẩm (vd chiều dài không có trong danh sách) → báo cho người xác minh
 */
export function validateOrder(order, product) {
  const errors = [];
  const warnings = [];
  const q = Number(order?.quantity);
  if (!Number.isInteger(q) || q < 1) errors.push("Số lượng phải là số nguyên từ 1 trở lên.");
  const attrs = productAttributes(product);
  const variant = String(order?.variant || "").trim();
  if (attrs.length && variant) {
    const clean = sanitizeVariant(attrs, variant);
    if (clean.replace(/\s+/g, "").toLowerCase() !== variant.replace(/\s+/g, "").toLowerCase()) {
      warnings.push(`Có lựa chọn không nằm trong danh sách của sản phẩm "${product?.name || ""}": "${variant}". Chỉ hợp lệ: ${attrs.filter((a) => a.values.length).map((a) => `${a.name} (${a.values.join(", ")})`).join("; ")}.`);
    }
  }
  return { errors, warnings };
}
