export const dynamic = "force-dynamic";
export const revalidate = 0;

import { NextResponse } from "next/server";
import { getConversationPageId, getConversationNote, setConversationNote } from "@/lib/conversations";
import { getScope, canSeePage } from "@/lib/auth";

const NOT_FOUND = () => NextResponse.json({ error: "Không tìm thấy cuộc trò chuyện" }, { status: 404 });

// Đọc ghi chú của khách
export async function GET(req, { params }) {
  try {
    const pageId = await getConversationPageId(params.id);
    if (!canSeePage(await getScope(req), pageId)) return NOT_FOUND();
    const note = await getConversationNote(params.id);
    return NextResponse.json({ note }, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    console.error("Lỗi đọc ghi chú khách:", err);
    return NextResponse.json({ error: String(err.message || err) }, { status: 500 });
  }
}

// Lưu ghi chú của khách: { note: "..." }
export async function PUT(req, { params }) {
  try {
    const { note } = await req.json();
    if (typeof note !== "string") {
      return NextResponse.json({ error: "Thiếu note" }, { status: 400 });
    }
    const pageId = await getConversationPageId(params.id);
    if (!canSeePage(await getScope(req), pageId)) return NOT_FOUND();
    await setConversationNote(params.id, note);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("Lỗi lưu ghi chú khách:", err);
    return NextResponse.json({ error: String(err.message || err) }, { status: 500 });
  }
}
