// app/api/upload/route.js — tải ảnh sản phẩm lên Vercel Blob, trả về link công khai
import { NextResponse } from "next/server";
import { put } from "@vercel/blob";

export const dynamic = "force-dynamic";

const MAX_BYTES = 4 * 1024 * 1024; // Vercel giới hạn body ~4.5MB; trang admin đã tự nén ảnh trước khi gửi

export async function POST(req) {
  try {
    const form = await req.formData();
    const file = form.get("file");
    if (!file || typeof file === "string") {
      return NextResponse.json({ error: "Không có file" }, { status: 400 });
    }
    if (!file.type?.startsWith("image/")) {
      return NextResponse.json({ error: "Chỉ nhận file ảnh" }, { status: 400 });
    }
    if (file.size > MAX_BYTES) {
      return NextResponse.json({ error: "Ảnh quá lớn (tối đa 4MB)" }, { status: 413 });
    }
    const safeName = (file.name || "image").replace(/[^a-zA-Z0-9._-]/g, "_");
    const blob = await put(`product-images/${safeName}`, file, {
      access: "public",
      addRandomSuffix: true,
      contentType: file.type,
    });
    return NextResponse.json({ url: blob.url });
  } catch (err) {
    console.error("Lỗi upload ảnh:", err);
    return NextResponse.json({ error: String(err.message || err) }, { status: 500 });
  }
}
