export const dynamic = "force-dynamic";
export const revalidate = 0;

import { NextResponse } from "next/server";
import { getConversation, addMessage, deleteConversation } from "@/lib/conversations";

export async function GET(req, { params }) {
  try {
    const conv = await getConversation(params.id);
    return NextResponse.json(conv, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    console.error("Lỗi đọc hội thoại:", err);
    return NextResponse.json({ error: String(err.message || err) }, { status: 500 });
  }
}

// Chủ shop tự gửi trả lời (dùng được cả khi bot đang bật hoặc tắt)
export async function POST(req, { params }) {
  const { text } = await req.json();
  if (!text || !text.trim()) {
    return NextResponse.json({ error: "Tin nhắn trống" }, { status: 400 });
  }

  const PAGE_ACCESS_TOKEN = process.env.FB_PAGE_ACCESS_TOKEN;
  const fbRes = await fetch(
    `https://graph.facebook.com/v21.0/me/messages?access_token=${PAGE_ACCESS_TOKEN}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        recipient: { id: params.id },
        message: { text },
        messaging_type: "RESPONSE",
      }),
    }
  );

  const fbData = await fbRes.json();
  if (!fbRes.ok || fbData.error) {
    return NextResponse.json(
      { error: fbData.error?.message || "Facebook từ chối gửi tin nhắn" },
      { status: 502 }
    );
  }

  await addMessage(params.id, "admin", text);
  return NextResponse.json({ ok: true });
}

// Xóa cuộc trò chuyện (để test lại từ đầu hoặc ẩn khách không tiềm năng)
export async function DELETE(req, { params }) {
  try {
    await deleteConversation(params.id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("Lỗi xóa hội thoại:", err);
    return NextResponse.json({ error: String(err.message || err) }, { status: 500 });
  }
}
