export const dynamic = "force-dynamic";
export const revalidate = 0;
export const maxDuration = 60;

// app/api/training/chat/route.js — chat thử: chủ shop đóng vai khách, bot trả lời như thật (không gửi Facebook)
import { NextResponse } from "next/server";
import { runPlayground } from "@/lib/botPlayground";

export async function POST(req) {
  try {
    const { history, productId, customerName, customerInfo } = await req.json();
    const result = await runPlayground({ history, productId, customerName, customerInfo });
    if (result.error) return NextResponse.json({ error: result.error }, { status: 200 });
    return NextResponse.json(result);
  } catch (err) {
    console.error("Lỗi chat thử:", err);
    return NextResponse.json({ error: String(err?.message || err) }, { status: 500 });
  }
}
