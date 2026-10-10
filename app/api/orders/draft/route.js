export const dynamic = "force-dynamic";
export const revalidate = 0;
export const maxDuration = 60;

import { NextResponse } from "next/server";
import { getConversation } from "@/lib/conversations";
import { getProducts, filterProductsForPage } from "@/lib/products";
import { getScope, canSeePage } from "@/lib/auth";
import { buildOrderDraft } from "@/lib/orderDraft";

// Tổng thời gian chờ AI tối đa (ms) — luôn trả JSON về cho trang, không để Vercel cắt ngang.
const AI_BUDGET_MS = 40000;
const AI_TRY_MS = 15000;

/** Tự điền đơn từ nội dung chat: tên, SĐT, địa chỉ, sản phẩm, màu/size, số lượng, giá. */
export async function POST(req) {
  try {
    const { conversationId } = await req.json();
    const conv = await getConversation(conversationId);
    const scope = await getScope(req);
    if (!canSeePage(scope, conv.pageId)) return NextResponse.json({ error: "Bạn không có quyền với cuộc chat này." }, { status: 403 });
    const all = await getProducts();
    let products = filterProductsForPage(all, conv.pageId);
    // Member chỉ được chọn trong các sản phẩm được cấp quyền
    if (!scope.isOwner) products = products.filter((p) => scope.productIds.has(String(p.id)));

    const { order, aiOk } = await buildOrderDraft(conversationId, conv, products, { budgetMs: AI_BUDGET_MS, tryMs: AI_TRY_MS });
    return NextResponse.json({
      order,
      aiOk,
      products: products.map((p) => ({ id: String(p.id), name: p.name })),
    });
  } catch (err) {
    console.error("Lỗi tạo đơn nháp:", err);
    return NextResponse.json({ error: String(err.message || err) }, { status: 500 });
  }
}
