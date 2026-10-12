export const dynamic = "force-dynamic";
export const revalidate = 0;

// app/api/followup/route.js — xem/lưu cài đặt nhắc khách quay lại
import { NextResponse } from "next/server";
import { getFollowupConfig, saveFollowupConfig, findCandidates, getFollowupStats } from "@/lib/followup";

export async function GET() {
  try {
    const config = await getFollowupConfig();
    const eligible = (await findCandidates(config, 200)).length;
    const stats = await getFollowupStats();
    return NextResponse.json({ config, eligible, ...stats });
  } catch (err) {
    console.error("Lỗi đọc nhắc khách:", err);
    return NextResponse.json({ error: String(err.message || err) }, { status: 500 });
  }
}

export async function POST(req) {
  try {
    const body = await req.json();
    const config = await saveFollowupConfig(body);
    return NextResponse.json({ ok: true, config });
  } catch (err) {
    console.error("Lỗi lưu nhắc khách:", err);
    return NextResponse.json({ error: String(err.message || err) }, { status: 500 });
  }
}
