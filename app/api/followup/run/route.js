export const dynamic = "force-dynamic";
export const revalidate = 0;
export const maxDuration = 60;

// app/api/followup/run/route.js
//  - GET  : dịch vụ hẹn giờ (cron-job.org) gọi mỗi ~5 phút — chạy ngắn (~24s), chỉ gửi khi tính năng đang BẬT
//  - POST : nút trên trang quản trị — { dryRun: true } xem thử không gửi, { dryRun: false } gửi thật 1 nhóm ngay
import { NextResponse } from "next/server";
import { runFollowup } from "@/lib/followup";

export async function GET() {
  try {
    return NextResponse.json(await runFollowup({ deadlineMs: 24000 }));
  } catch (err) {
    console.error("Lỗi chạy nhắc khách:", err);
    return NextResponse.json({ error: String(err.message || err) }, { status: 500 });
  }
}

export async function POST(req) {
  try {
    const { dryRun } = await req.json().catch(() => ({}));
    const out = await runFollowup({ dryRun: dryRun !== false, force: dryRun === false, deadlineMs: 50000 });
    return NextResponse.json(out);
  } catch (err) {
    console.error("Lỗi chạy nhắc khách:", err);
    return NextResponse.json({ error: String(err.message || err) }, { status: 500 });
  }
}
