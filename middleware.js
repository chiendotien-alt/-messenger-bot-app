// middleware.js — chặn truy cập /admin và các API quản trị nếu chưa đăng nhập đúng.
// Hai cấp: chủ shop (ADMIN_USER / ADMIN_PASSWORD) thấy tất cả; member cấp dưới (tạo trong "Quản lý member")
// chỉ vào được phần chat + xem sản phẩm/Page được cấp quyền.
import { NextResponse } from "next/server";
import { authenticate } from "@/lib/auth";

// Member được gọi những đường dẫn nào (còn lại chỉ chủ shop). Lọc dữ liệu chi tiết nằm trong từng API.
function memberAllowed(path, method) {
  const m = method.toUpperCase();
  const read = m === "GET" || m === "HEAD";
  if (path === "/admin" || path === "/admin/") return true;
  if (path === "/admin/products" || path === "/admin/products/") return true; // chỉ xem, API chặn ghi
  if (path === "/api/me") return true;
  if (path === "/api/pages" || path === "/api/products" || path === "/api/settings") return read;
  if (path === "/api/conversations") return read;
  if (path === "/api/conversations/cleanup") return false;
  if (path.startsWith("/api/conversations/")) return true; // GET xem, POST trả lời (đã lọc theo Page); DELETE do API chặn
  if (path === "/api/orders" || path === "/api/orders/draft") return true;
  return false;
}

export async function middleware(req) {
  const who = await authenticate(req.headers.get("authorization"));

  if (!who) {
    return new NextResponse("Cần đăng nhập để vào trang quản trị.", {
      status: 401,
      headers: { "WWW-Authenticate": 'Basic realm="Trang quan tri"' },
    });
  }

  const path = req.nextUrl.pathname;
  if (who.role === "member" && !memberAllowed(path, req.method)) {
    if (path.startsWith("/api/")) {
      return NextResponse.json({ error: "Bạn không có quyền thực hiện thao tác này." }, { status: 403 });
    }
    return new NextResponse("Bạn không có quyền vào trang này.", { status: 403 });
  }

  // Gắn danh tính vào request (luôn ghi đè để client không giả header được)
  const headers = new Headers(req.headers);
  headers.set("x-auth-role", who.role);
  headers.set("x-auth-member", who.role === "member" ? String(who.id) : "");
  return NextResponse.next({ request: { headers } });
}

export const config = {
  matcher: ["/admin/:path*", "/api/products/:path*", "/api/conversations/:path*", "/api/settings/:path*", "/api/pages/:path*", "/api/keys/:path*", "/api/orders/:path*", "/api/training/:path*", "/api/members/:path*", "/api/me", "/api/upload"],
};
