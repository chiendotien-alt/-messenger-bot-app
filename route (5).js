export const dynamic = "force-dynamic";
export const revalidate = 0;

import { NextResponse } from "next/server";
import { listConversations } from "@/lib/conversations";

export async function GET(req) {
  try {
    const pageId = new URL(req.url).searchParams.get("pageId");
    const list = await listConversations(pageId);
    return NextResponse.json(list, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    console.error("Lỗi đọc danh sách hội thoại:", err);
    return NextResponse.json({ error: String(err.message || err) }, { status: 500 });
  }
}
