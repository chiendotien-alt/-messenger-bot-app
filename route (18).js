export const dynamic = "force-dynamic";
export const revalidate = 0;
export const maxDuration = 60;

import { NextResponse } from "next/server";
import { countSilent, sendToSilent, SILENT_HOURS } from "@/lib/broadcast";
import { getScope } from "@/lib/auth";

const DENY = () => NextResponse.json({ error: "Bạn không có quyền với mục này." }, { status: 403 });

// Xem trước: có bao nhiêu khách sẽ nhận tin
export async function GET(req) {
  if (!(await getScope(req)).isOwner) return DENY();
  try {
    const u = new URL(req.url);
    const count = await countSilent(u.searchParams.get("pageId") || null, u.searchParams.get("text") || "");
    return NextResponse.json({ count, hours: SILENT_HOURS }, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    return NextResponse.json({ error: String(err.message || err) }, { status: 500 });
  }
}

// Gửi thật 1 lượt (giao diện gọi lặp lại tới khi hết khách)
export async function POST(req) {
  if (!(await getScope(req)).isOwner) return DENY();
  try {
    const body = await req.json().catch(() => ({}));
    const out = await sendToSilent({
      pageId: body.pageId || null,
      text: body.text,
      excludeIds: body.excludeIds || [],
    });
    return NextResponse.json(out);
  } catch (err) {
    console.error("Lỗi nhắn khách im lặng:", err);
    return NextResponse.json({ error: String(err.message || err) }, { status: 500 });
  }
}
