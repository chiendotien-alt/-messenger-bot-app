// middleware.js — chặn truy cập /admin và API sản phẩm nếu chưa đăng nhập đúng
import { NextResponse } from "next/server";

export function middleware(req) {
  const auth = req.headers.get("authorization");
  const validUser = process.env.ADMIN_USER || "admin";
  const validPass = process.env.ADMIN_PASSWORD;

  if (auth) {
    const encoded = auth.split(" ")[1] || "";
    const decoded = Buffer.from(encoded, "base64").toString();
    const [user, pass] = decoded.split(":");
    if (user === validUser && pass === validPass && validPass) {
      return NextResponse.next();
    }
  }

  return new NextResponse("Cần đăng nhập để vào trang quản trị.", {
    status: 401,
    headers: { "WWW-Authenticate": 'Basic realm="Trang quan tri"' },
  });
}

export const config = {
  matcher: ["/admin/:path*", "/api/products/:path*", "/api/conversations/:path*", "/api/settings/:path*", "/api/pages/:path*", "/api/keys/:path*", "/api/upload"],
};
