export const dynamic = "force-dynamic";
export const revalidate = 0;
export const maxDuration = 60;

// app/api/followup/run/route.js
//  - GET  : Vercel Cron (1 lần/ngày, khai báo trong vercel.json) hoặc dịch vụ hẹn giờ ngoài (không bắt buộc) — chỉ gửi khi tính năng đang BẬT
//  - POST : nút trên trang quản trị — { dryRun: true } xem thử không gửi, { dryRun: false } gửi thật 1 nhóm ngay
import { NextResponse } from "next/server";
import { runFollowup } from "@/lib/followup";

export async function GET(req) {
  try {
    // Vercel Cron (chạy mỗi ngày 1 lần, không cần cài gì) → xử lý nhóm lớn hơn; cron-job.org (nếu bạn dùng) → nhóm nhỏ như cài đặt
    const fromVercel = (req.headers.get("user-agent") || "").startsWith("vercel-cron");
    return NextResponse.json(
      fromVercel ? await runFollowup({ deadlineMs: 52000, limit: 15 }) : await runFollowup({ deadlineMs: 24000 })
    );
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
