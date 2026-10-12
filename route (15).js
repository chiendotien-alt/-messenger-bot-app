// Ảnh gửi khách trong carousel: thu nhỏ lại + viền trắng xung quanh để KHÔNG bị cắt chân ảnh, ảnh nhìn nhỏ gọn hơn.
// Route này công khai (Facebook phải tải được), chỉ nhận link ảnh Vercel Blob / Facebook.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import sharp from "sharp";

const ALLOWED = [/\.public\.blob\.vercel-storage\.com$/i, /(^|\.)fbcdn\.net$/i, /(^|\.)fbsbx\.com$/i];

export async function GET(req) {
  try {
    const sp = new URL(req.url).searchParams;
    const u = sp.get("u") || "";
    const showArrow = sp.get("a") === "1"; // còn ảnh phía sau → vẽ mũi tên mờ bên phải
    const url = new URL(u);
    if (url.protocol !== "https:" || !ALLOWED.some((re) => re.test(url.hostname))) {
      return new Response("bad url", { status: 400 });
    }
    const res = await fetch(url.toString());
    if (!res.ok) return new Response("fetch fail", { status: 502 });
    const input = Buffer.from(await res.arrayBuffer());

    const SIZE = 640; // khung vuông
    // Ảnh phóng vừa khít khung vuông (thấy đủ cả ảnh, không mất chân/cạp), đặt giữa.
    // Phần thừa hai bên được kéo dài từ chính viền ảnh gốc nên liền mạch, không lộ khung.
    const photoBuf = await sharp(input)
      .rotate()
      .resize(SIZE, SIZE, { fit: "inside" })
      .toBuffer();
    const pm = await sharp(photoBuf).metadata();
    const padX = SIZE - pm.width, padY = SIZE - pm.height;
    let card = sharp(photoBuf);
    if (padX > 0 || padY > 0) {
      card = card.extend({
        left: Math.floor(padX / 2),
        right: Math.ceil(padX / 2),
        top: Math.floor(padY / 2),
        bottom: Math.ceil(padY / 2),
        extendWith: "copy",
      });
    }
    const layers = [];
    if (showArrow) {
      const cx = SIZE - 52, cy = Math.round(SIZE / 2);
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${SIZE}" height="${SIZE}">
        <circle cx="${cx}" cy="${cy}" r="30" fill="#ffffff" fill-opacity="0.5"/>
        <path d="M ${cx - 7} ${cy - 16} L ${cx + 9} ${cy} L ${cx - 7} ${cy + 16}" fill="none" stroke="#444444" stroke-opacity="0.5" stroke-width="7" stroke-linecap="round" stroke-linejoin="round"/>
      </svg>`;
      layers.push({ input: Buffer.from(svg), left: 0, top: 0 });
    }
    if (layers.length) card = sharp(await card.toBuffer()).composite(layers);
    const out = await card.jpeg({ quality: 82 }).toBuffer();

    return new Response(out, {
      headers: { "Content-Type": "image/jpeg", "Cache-Control": "public, max-age=31536000, immutable" },
    });
  } catch (e) {
    return new Response("error", { status: 500 });
  }
}
