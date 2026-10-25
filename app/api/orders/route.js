export const dynamic = "force-dynamic";
export const revalidate = 0;

import { NextResponse } from "next/server";
import { listOrders, listAllOrders, saveOrder, deleteOrder, setOrderStatus, setOrderRefund, confirmOrder, findUnconfirmedAuto, getOrderPageId } from "@/lib/orders";
import { getConversationPageId } from "@/lib/conversations";
import { getScope, canSeePage } from "@/lib/auth";
import { getProducts } from "@/lib/products";
import { validateOrder } from "@/lib/orderFacts";

const DENY = () => NextResponse.json({ error: "Bạn không có quyền với đơn này." }, { status: 403 });

export async function GET(req) {
  try {
    const sp = new URL(req.url).searchParams;
    const scope = await getScope(req);
    if (sp.get("all") === "1") {
      return NextResponse.json(await listAllOrders(scope.isOwner ? null : [...scope.pageIds]), { headers: { "Cache-Control": "no-store" } });
    }
    const cid = sp.get("conversationId");
    if (!cid) return NextResponse.json([]);
    if (!canSeePage(scope, await getConversationPageId(cid))) return NextResponse.json([]);
    return NextResponse.json(await listOrders(cid), { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    return NextResponse.json({ error: String(err.message || err) }, { status: 500 });
  }
}

// Lưu đơn (có id → sửa đơn cũ, không có id → tạo đơn mới)
export async function POST(req) {
  try {
    const { conversationId, pageId, id: givenId, order } = await req.json();
    if (!conversationId || !order) return NextResponse.json({ error: "Thiếu dữ liệu đơn" }, { status: 400 });
    // Quyền kiểm tra theo Page THẬT của cuộc chat, không tin pageId client gửi lên
    const realPageId = await getConversationPageId(conversationId);
    const scope = await getScope(req);
    if (!canSeePage(scope, realPageId)) return DENY();
    if (givenId && !scope.isOwner && (await getOrderPageId(givenId)) !== realPageId) return DENY();
    // Khách này đã có đơn TỰ TẠO (khi khách để lại SĐT) mà chưa ai xác nhận → "Tạo đơn" mới sẽ ghi đè lên đơn đó, không tạo thêm đơn trùng
    let id = givenId;
    if (!id) id = (await findUnconfirmedAuto(conversationId))?.id || null;
    // Kiểm tra trước khi lưu: số lượng phải là số nguyên ≥ 1; lựa chọn lạ so với dữ liệu sản phẩm (vd chiều dài không có trong danh sách) chỉ cảnh báo
    const product = (await getProducts().catch(() => [])).find((p) => String(p.id) === String(order.productId));
    const { errors, warnings } = validateOrder({ ...order, quantity: Number(order.quantity) }, product);
    if (errors.length) return NextResponse.json({ error: errors.join(" ") }, { status: 400 });
    // Chủ shop/nhân viên tự lưu = đã xem và xác nhận → bỏ nhãn "tự tạo" và các cảnh báo cần xác minh
    const { auto: _auto, aiTries: _t, nameFromProfile: _n, review: _r, ...rest } = order;
    const clean = { ...rest, quantity: Math.round(Number(order.quantity)) };
    // Chủ shop đã sửa số lượng tay làm "lines" (số lượng từng dòng) không còn khớp → bỏ lines, giữ variant + quantity để không có hai nguồn mâu thuẫn
    if (Array.isArray(clean.lines) && clean.lines.reduce((a, l) => a + (Number(l?.qty) || 0), 0) !== clean.quantity) delete clean.lines;
    const newId = await saveOrder(conversationId, scope.isOwner ? pageId : realPageId, clean, id);
    return NextResponse.json({ ok: true, id: newId, warnings });
  } catch (err) {
    return NextResponse.json({ error: String(err.message || err) }, { status: 500 });
  }
}

// Tick tình trạng đơn bằng tay
export async function PATCH(req) {
  try {
    const { id, status, confirm, refund } = await req.json();
    if (!id || (!status && !confirm && refund === undefined)) return NextResponse.json({ error: "Thiếu dữ liệu" }, { status: 400 });
    if (!canSeePage(await getScope(req), await getOrderPageId(id))) return DENY();
    if (status) await setOrderStatus(id, status);
    if (refund !== undefined) await setOrderRefund(id, refund);
    if (confirm) await confirmOrder(id); // xác nhận đơn tự tạo (vd: đã ghi vào doanh thu)
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: String(err.message || err) }, { status: 500 });
  }
}

export async function DELETE(req) {
  try {
    const { id } = await req.json();
    if (!canSeePage(await getScope(req), await getOrderPageId(id))) return DENY();
    await deleteOrder(id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: String(err.message || err) }, { status: 500 });
  }
}
