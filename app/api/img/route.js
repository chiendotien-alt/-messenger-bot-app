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
    const INNER = Math.round(SIZE * 0.82); // ảnh thật chiếm 82% khung
    // Nền = màu của viền ảnh gốc (ảnh chụp nền xám/trắng thì liền mạch) → thẻ nhìn đầy đặn,
    // khung chữ dưới ảnh bằng đúng bề ngang thẻ, ảnh không bị cắt.
    const base = sharp(input).rotate();
    const rot = await base.clone().toBuffer();
    const info = await sharp(rot).metadata();
    const W = info.width, H = info.height;
    const t = Math.max(2, Math.round(Math.min(W, H) * 0.02));
    const strips = [
      { left: 0, top: 0, width: W, height: t },
      { left: 0, top: H - t, width: W, height: t },
      { left: 0, top: 0, width: t, height: H },
      { left: W - t, top: 0, width: t, height: H },
    ];
    let r = 0, g = 0, b = 0;
    for (const e of strips) {
      const piece = await sharp(rot).extract(e).toBuffer(); // cắt ra trước rồi mới đo
      const st = await sharp(piece).stats();
      r += st.channels[0].mean; g += st.channels[1].mean; b += st.channels[2].mean;
    }
    const bgColor = { r: Math.round(r / 4), g: Math.round(g / 4), b: Math.round(b / 4) };
    const photo = await sharp(rot).resize(INNER, INNER, { fit: "inside" }).toBuffer();
    const out = await sharp({ create: { width: SIZE, height: SIZE, channels: 3, background: bgColor } })
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
