export const dynamic = "force-dynamic";
export const revalidate = 0;

import { NextResponse } from "next/server";
import { getScope } from "@/lib/auth";

// Giao diện hỏi "tôi là ai" để ẩn các nút chủ shop (member vẫn bị chặn thật ở server)
export async function GET(req) {
  const s = await getScope(req);
  return NextResponse.json({ role: s.role, isOwner: s.isOwner }, { headers: { "Cache-Control": "no-store" } });
}
