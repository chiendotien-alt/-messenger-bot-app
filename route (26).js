export const dynamic = "force-dynamic";
export const revalidate = 0;

import { NextResponse } from "next/server";
import { getSalesState, putSalesState } from "@/lib/salesState";
import { getScope } from "@/lib/auth";

const DENY = () => NextResponse.json({ error: "Chỉ chủ shop mới xem được phần bán hàng." }, { status: 403 });
const NO_STORE = { "Cache-Control": "no-store" };

// Đọc toàn bộ dữ liệu bán hàng
export async function GET(req) {
  if (!(await getScope(req)).isOwner) return DENY();
  try {
    return NextResponse.json(await getSalesState(), { headers: NO_STORE });
  } catch (err) {
    return NextResponse.json({ error: String(err.message || err) }, { status: 500 });
  }
}

// Lưu toàn bộ dữ liệu bán hàng: { state, rev } — rev là số phiên bản trang đang giữ
export async function PUT(req) {
  if (!(await getScope(req)).isOwner) return DENY();
  try {
    const { state, rev } = await req.json();
    if (!state || !Array.isArray(state.products) || !Array.isArray(state.sales)) {
      return NextResponse.json({ error: "Dữ liệu không hợp lệ" }, { status: 400 });
    }
    const r = await putSalesState(state, rev);
    if (!r.ok) {
      return NextResponse.json({ error: "Dữ liệu đã được lưu từ máy/tab khác, hãy tải lại trang.", rev: r.rev }, { status: 409 });
    }
    return NextResponse.json({ ok: true, rev: r.rev }, { headers: NO_STORE });
  } catch (err) {
    return NextResponse.json({ error: String(err.message || err) }, { status: 500 });
  }
}
