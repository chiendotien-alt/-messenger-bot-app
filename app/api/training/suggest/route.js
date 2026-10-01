export const dynamic = "force-dynamic";
export const revalidate = 0;
export const maxDuration = 60;

// app/api/training/suggest/route.js — AI gợi ý vài câu khách có thể nhắn tiếp (để chủ shop luyện nhiều tình huống)
import { NextResponse } from "next/server";
import { suggestCustomerLines } from "@/lib/botPlayground";

export async function POST(req) {
  try {
    const { history, productId, persona } = await req.json();
    const result = await suggestCustomerLines({ history, productId, persona });
    return NextResponse.json(result, { status: 200 });
  } catch (err) {
    console.error("Lỗi gợi ý tình huống:", err);
    return NextResponse.json({ error: String(err?.message || err) }, { status: 500 });
  }
}
