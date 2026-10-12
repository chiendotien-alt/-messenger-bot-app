export const dynamic = "force-dynamic";
export const revalidate = 0;

// app/api/training/match/route.js — "Thử khớp": tin khách này sẽ khớp những tình huống đã dạy nào (không gọi AI)
import { NextResponse } from "next/server";
import { matchTraining } from "@/lib/training";

export async function POST(req) {
  try {
    const { text, productId } = await req.json();
    if (!String(text || "").trim()) return NextResponse.json([]);
    return NextResponse.json(await matchTraining({ text, productId }), { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    return NextResponse.json({ error: String(err?.message || err) }, { status: 500 });
  }
}
