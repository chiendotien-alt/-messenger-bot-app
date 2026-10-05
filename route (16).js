export const dynamic = "force-dynamic";
export const revalidate = 0;
export const maxDuration = 60;

import { NextResponse } from "next/server";
import { countStaleNoPhone, deleteStaleNoPhone } from "@/lib/conversations";
import { getScope } from "@/lib/auth";

// Xem trước: có bao nhiêu cuộc chat sẽ bị xóa (không có SĐT, không có đơn, quá 48 giờ không có tin mới)
export async function GET(req) {
  if (!(await getScope(req)).isOwner) return NextResponse.json({ error: "Bạn không có quyền với mục này." }, { status: 403 });
  try {
    const pageId = new URL(req.url).searchParams.get("pageId") || null;
    const count = await countStaleNoPhone(pageId);
    return NextResponse.json({ count }, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    return NextResponse.json({ error: String(err.message || err) }, { status: 500 });
  }
}

// Xóa thật
export async function POST(req) {
  if (!(await getScope(req)).isOwner) return NextResponse.json({ error: "Bạn không có quyền với mục này." }, { status: 403 });
  try {
    const body = await req.json().catch(() => ({}));
    const deleted = await deleteStaleNoPhone(body.pageId || null);
    return NextResponse.json({ deleted });
  } catch (err) {
    console.error("Lỗi dọn chat:", err);
    return NextResponse.json({ error: String(err.message || err) }, { status: 500 });
  }
}
