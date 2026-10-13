export const dynamic = "force-dynamic";
export const revalidate = 0;

import { NextResponse } from "next/server";
import { checkKeys } from "@/lib/apiKeys";

// POST { id?, provider? } — kiểm tra 1 key (id) hoặc tất cả key. Chỉ chủ shop gọi được (middleware chặn member).
export async function POST(req) {
  try {
    const { id, provider } = await req.json().catch(() => ({}));
    return NextResponse.json({ results: await checkKeys(id, provider === "groq" ? "groq" : "gemini") });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 400 });
  }
}
