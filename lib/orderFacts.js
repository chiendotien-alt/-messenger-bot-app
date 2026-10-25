// lib/orderFacts.js — DỮ LIỆU ĐƠN CHUẨN HÓA suy ra từ cuộc chat. Chỉ chứa luật thuần (không gọi mạng/CSDL) nên test riêng được.
//
// Dùng chung cho tin báo đơn gửi khách VÀ dữ liệu đơn lưu vào hệ thống (đơn tự tạo, nút "Tạo đơn"):
// cùng một cách tính màu / size / chiều dài / số lượng / giá → tin báo đơn và đơn lưu không thể lệch nhau.
import { productAttributes, attributeStatus, composeVariant, summaryDetail, colorCount, confirmItems, sanitizeVariant } from "./attributes";
import { hasLadder, computePriceContext, detectQty, summaryQty } from "./priceLadder";

/** Số lượng khách nói trong các tin của khách (mới nhất trước). Không thấy → null. */
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
export function deriveOrderFacts({ product, messages, variantText = "" }) {
  const msgs = (messages || [])
    .filter((m) => m && String(m.text || "").trim())
    .map((m) => ({ from: m.from === "customer" ? "customer" : m.from || "bot", text: String(m.text) }));
  const customerNewest = msgs.filter((m) => m.from === "customer").map((m) => m.text).reverse();
  const outgoing = msgs.filter((m) => m.from !== "customer");
  const attrs = productAttributes(product);
  const attrMode = attrs.length > 0;
  const status = attrMode ? attributeStatus(attrs, msgs, [], variantText) : null;

  let ctx = null;
  if (product && hasLadder(product)) {
    ctx = computePriceContext({
      product,
      outgoing,
      customerNow: [],
      customerRecent: customerNewest,
      lastShopText: (outgoing[outgoing.length - 1] || {}).text || "",
      minQty: attrMode ? colorCount(status) : 0,
    });
  }
  const hint = customerQtyHint(customerNewest);
  const detail = attrMode ? summaryDetail(status, (ctx && ctx.qty) || hint || 1) : null;
  const quantity = summaryQty({ detail, ctx, hintQty: hint });
  const colors = detail?.colors || [];
  const hasPrice = !!(ctx && ctx.row && ctx.dealTotal);

  let qtySource = "default";
  if (colors.length > 1) qtySource = "colors";
  else if (hasPrice && !ctx.qtyGuess) qtySource = "ladder";
  else if (hint) qtySource = "customer";

  const specs = detail?.specs || [];
  const lines = colors.length ? colors.map((c) => ({ color: c.name, specs, qty: c.qty || 1 })) : [{ color: "", specs, qty: quantity }];

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
