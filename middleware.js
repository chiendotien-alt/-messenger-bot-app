// middleware.js — chặn truy cập /admin và API sản phẩm nếu chưa đăng nhập đúng
import { NextResponse } from "next/server";

export function middleware(req) {
  // Vercel Cron gọi /api/followup/run mỗi ngày (khai báo trong vercel.json) — không gửi được mật khẩu admin.
  // Có CRON_SECRET thì bắt buộc đúng; chưa đặt thì chấp nhận request mang dấu hiệu của Vercel Cron.
  // (Endpoint này chỉ chạy việc nhắc khách theo đúng cài đặt, mỗi khách 1 lần, nên rủi ro rất thấp.)
  if (req.method === "GET" && req.nextUrl.pathname === "/api/followup/run") {
    const secret = process.env.CRON_SECRET;
    const ua = req.headers.get("user-agent") || "";
    if (secret ? req.headers.get("authorization") === `Bearer ${secret}` : ua.startsWith("vercel-cron")) {
      return NextResponse.next();
    }
  }

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
  matcher: ["/admin/:path*", "/api/products/:path*", "/api/conversations/:path*", "/api/settings/:path*", "/api/pages/:path*", "/api/keys/:path*", "/api/orders/:path*", "/api/followup/:path*", "/api/upload"],
};
