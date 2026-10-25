export const dynamic = "force-dynamic";
export const revalidate = 0;
export const maxDuration = 60;

// app/api/nudge/run/route.js — chạy 1 lượt "nhắn bồi" cho khách im lặng.
// Gọi định kỳ mỗi 1 phút bằng dịch vụ hẹn giờ (vd cron-job.org) để bồi đúng giờ;
// không hẹn giờ thì bot vẫn tự bồi kèm mỗi khi có tin nhắn mới về.
import { NextResponse } from "next/server";
import { runNudge } from "@/lib/nudge";

export async function GET(req) {
  // Tuỳ chọn: đặt biến NUDGE_SECRET trên Vercel rồi gọi .../api/nudge/run?key=<NUDGE_SECRET> để người lạ không gọi bừa được.
  // Chưa đặt NUDGE_SECRET thì chạy như cũ (không cần key).
  const secret = process.env.NUDGE_SECRET;
  if (secret && new URL(req.url).searchParams.get("key") !== secret) {
    return NextResponse.json({ error: "Thiếu hoặc sai key" }, { status: 401 });
  }
  try {
    return NextResponse.json(await runNudge({ deadlineMs: 50000, limit: 15 }));
  } catch (err) {
    console.error("Lỗi chạy nhắn bồi:", err);
    return NextResponse.json({ error: String(err.message || err) }, { status: 500 });
  }
}
