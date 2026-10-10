export const dynamic = "force-dynamic";
export const revalidate = 0;

import html from "@/lib/banHang.html";
import { getScope } from "@/lib/auth";

// Trang web Quản lý bán hàng: /admin/ban-hang (chỉ chủ shop; đăng nhập chung với trang chat)
export async function GET(req) {
  if (!(await getScope(req)).isOwner) {
    return new Response("Chỉ chủ shop mới vào được trang này.", { status: 403 });
  }
  return new Response(html, {
    headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" },
  });
}
