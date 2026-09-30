export const dynamic = "force-dynamic";
export const revalidate = 0;

import { NextResponse } from "next/server";
import { listPages, addPage, removePage, setPageBot } from "@/lib/pages";

// Danh sách Page (id, tên, ảnh) — không bao giờ trả token
export async function GET() {
  try {
    return NextResponse.json(await listPages(), { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    console.error("Lỗi đọc danh sách Page:", err);
    return NextResponse.json({ error: String(err.message || err) }, { status: 500 });
  }
}

// Thêm Page: { token }
export async function POST(req) {
  try {
    const { token } = await req.json();
    return NextResponse.json(await addPage(token));
  } catch (err) {
    return NextResponse.json({ error: String(err.message || err) }, { status: 400 });
  }
}

// Gỡ Page: /api/pages?id=...
export async function DELETE(req) {
  try {
    const id = new URL(req.url).searchParams.get("id");
    if (!id) return NextResponse.json({ error: "Thiếu id Page" }, { status: 400 });
    await removePage(id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: String(err.message || err) }, { status: 400 });
  }
}

// Bật/tắt bot riêng cho 1 Page: { id, botEnabled }
export async function PATCH(req) {
  try {
    const { id, botEnabled } = await req.json();
    if (!id || typeof botEnabled !== "boolean") {
      return NextResponse.json({ error: "Thiếu thông tin Page" }, { status: 400 });
    }
    await setPageBot(id, botEnabled);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: String(err.message || err) }, { status: 400 });
  }
}
