export const dynamic = "force-dynamic";
export const revalidate = 0;

import { NextResponse } from "next/server";
import { listConversations } from "@/lib/conversations";
import { getScope } from "@/lib/auth";

export async function GET(req) {
  try {
    const params = new URL(req.url).searchParams;
    const pageId = params.get("pageId");
    const phoneOnly = params.get("phone") === "1";
    const okDate = (v) => (v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null);
    const from = okDate(params.get("from")); // YYYY-MM-DD (giờ Việt Nam)
    const to = okDate(params.get("to"));
    const scope = await getScope(req);
    if (!scope.isOwner) {
      // Member: chỉ thấy chat của các Page được cấp quyền
      if (pageId && !scope.pageIds.has(String(pageId))) return NextResponse.json([], { headers: { "Cache-Control": "no-store" } });
      const list = await listConversations(pageId, phoneOnly, from, to, [...scope.pageIds]);
      return NextResponse.json(list, { headers: { "Cache-Control": "no-store" } });
    }
    const list = await listConversations(pageId, phoneOnly, from, to);
    return NextResponse.json(list, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    console.error("Lỗi đọc danh sách hội thoại:", err);
    return NextResponse.json({ error: String(err.message || err) }, { status: 500 });
  }
}
