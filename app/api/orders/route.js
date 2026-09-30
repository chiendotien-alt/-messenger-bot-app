export const dynamic = "force-dynamic";
export const revalidate = 0;

import { NextResponse } from "next/server";
import { listOrders, listAllOrders, saveOrder, deleteOrder } from "@/lib/orders";

export async function GET(req) {
  try {
    const sp = new URL(req.url).searchParams;
    if (sp.get("all") === "1") {
      return NextResponse.json(await listAllOrders(), { headers: { "Cache-Control": "no-store" } });
    }
    const cid = sp.get("conversationId");
    if (!cid) return NextResponse.json([]);
    return NextResponse.json(await listOrders(cid), { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    return NextResponse.json({ error: String(err.message || err) }, { status: 500 });
  }
}

// Lưu đơn (có id → sửa đơn cũ, không có id → tạo đơn mới)
export async function POST(req) {
  try {
    const { conversationId, pageId, id, order } = await req.json();
    if (!conversationId || !order) return NextResponse.json({ error: "Thiếu dữ liệu đơn" }, { status: 400 });
    const newId = await saveOrder(conversationId, pageId, order, id);
    return NextResponse.json({ ok: true, id: newId });
  } catch (err) {
    return NextResponse.json({ error: String(err.message || err) }, { status: 500 });
  }
}

export async function DELETE(req) {
  try {
    const { id } = await req.json();
    await deleteOrder(id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: String(err.message || err) }, { status: 500 });
  }
}
