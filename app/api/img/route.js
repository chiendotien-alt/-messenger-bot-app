// Ảnh gửi khách trong carousel: thu nhỏ lại + viền trắng xung quanh để KHÔNG bị cắt chân ảnh, ảnh nhìn nhỏ gọn hơn.
// Route này công khai (Facebook phải tải được), chỉ nhận link ảnh Vercel Blob / Facebook.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import sharp from "sharp";

const ALLOWED = [/\.public\.blob\.vercel-storage\.com$/i, /(^|\.)fbcdn\.net$/i, /(^|\.)fbsbx\.com$/i];

export async function GET(req) {
  try {
    const u = new URL(req.url).searchParams.get("u") || "";
    const url = new URL(u);
    if (url.protocol !== "https:" || !ALLOWED.some((re) => re.test(url.hostname))) {
      return new Response("bad url", { status: 400 });
    }
    const res = await fetch(url.toString());
    if (!res.ok) return new Response("fetch fail", { status: 502 });
    const input = Buffer.from(await res.arrayBuffer());

    const SIZE = 640; // khung vuông
    const INNER = Math.round(SIZE * 0.82); // ảnh chiếm 82% khung, còn lại là viền trắng
    const photo = await sharp(input)
      .rotate()
      .resize(INNER, INNER, { fit: "inside", background: "#ffffff" })
      .toBuffer();
    const out = await sharp({ create: { width: SIZE, height: SIZE, channels: 3, background: "#ffffff" } })
      .composite([{ input: photo, gravity: "center" }])
      .jpeg({ quality: 82 })
      .toBuffer();

    return new Response(out, {
      headers: { "Content-Type": "image/jpeg", "Cache-Control": "public, max-age=31536000, immutable" },
    });
  } catch (e) {
    return new Response("error", { status: 500 });
  }
}
