export const dynamic = "force-dynamic";
export const revalidate = 0;

import { NextResponse } from "next/server";
import { listPages, addPage, removePage, setPageBot } from "@/lib/pages";
import { getScope } from "@/lib/auth";

const DENY = () => NextResponse.json({ error: "Bạn không có quyền với mục này." }, { status: 403 });


// Danh sách Page (id, tên, ảnh) — không bao giờ trả token
export async function GET(req) {
  try {
    const scope = await getScope(req);
    const all = await listPages();
    // Member chỉ thấy Page được cấp quyền
    const list = scope.isOwner ? all : all.filter((p) => scope.pageIds.has(String(p.id)));
    return NextResponse.json(list, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    console.error("Lỗi đọc danh sách Page:", err);
    return NextResponse.json({ error: String(err.message || err) }, { status: 500 });
  }
}

// Thêm Page: { token }
export async function POST(req) {
  if (!(await getScope(req)).isOwner) return DENY();
  try {
    const { token } = await req.json();
    return NextResponse.json(await addPage(token));
  } catch (err) {
    return NextResponse.json({ error: String(err.message || err) }, { status: 400 });
  }
}

// Gỡ Page: /api/pages?id=...
export async function DELETE(req) {
  if (!(await getScope(req)).isOwner) return DENY();
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
  if (!(await getScope(req)).isOwner) return DENY();
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
