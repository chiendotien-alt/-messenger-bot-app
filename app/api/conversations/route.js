export const dynamic = "force-dynamic";
export const revalidate = 0;

import { NextResponse } from "next/server";
import { listConversations } from "@/lib/conversations";

export async function GET(req) {
  try {
    const params = new URL(req.url).searchParams;
    const pageId = params.get("pageId");
    const phoneOnly = params.get("phone") === "1";
    const list = await listConversations(pageId, phoneOnly);
    return NextResponse.json(list, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    console.error("Lỗi đọc danh sách hội thoại:", err);
    return NextResponse.json({ error: String(err.message || err) }, { status: 500 });
  }
}
