export const dynamic = "force-dynamic";
export const revalidate = 0;

import { NextResponse } from "next/server";
import { getConversation, addMessage, deleteConversation, getConversationPageId, setConversationBotOff } from "@/lib/conversations";
import { getPageToken } from "@/lib/pages";
import { getScope, canSeePage } from "@/lib/auth";

const NOT_FOUND = () => NextResponse.json({ error: "Không tìm thấy cuộc trò chuyện" }, { status: 404 });

export async function GET(req, { params }) {
  try {
    const conv = await getConversation(params.id);
    const scope = await getScope(req);
    if (!canSeePage(scope, conv.pageId)) return NOT_FOUND();
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

  // Trả lời bằng đúng token của Page mà khách này đã nhắn tới
  const pageId = await getConversationPageId(params.id);
  if (!canSeePage(await getScope(req), pageId)) return NOT_FOUND();
  const PAGE_ACCESS_TOKEN = await getPageToken(pageId);
  if (!PAGE_ACCESS_TOKEN) {
    return NextResponse.json({ error: "Chưa có token cho Page của cuộc trò chuyện này" }, { status: 400 });
  }
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

// Bật/tắt bot riêng cho 1 khách: { botOff: true | false }
export async function PATCH(req, { params }) {
  try {
    const { botOff } = await req.json();
    if (typeof botOff !== "boolean") {
      return NextResponse.json({ error: "Thiếu botOff (true/false)" }, { status: 400 });
    }
    const pageId = await getConversationPageId(params.id);
    if (!canSeePage(await getScope(req), pageId)) return NOT_FOUND();
    await setConversationBotOff(params.id, botOff);
    return NextResponse.json({ ok: true, botOff });
  } catch (err) {
    console.error("Lỗi đổi bot của khách:", err);
    return NextResponse.json({ error: String(err.message || err) }, { status: 500 });
  }
}

// Xóa cuộc trò chuyện (để test lại từ đầu hoặc ẩn khách không tiềm năng)
export async function DELETE(req, { params }) {
  if (!(await getScope(req)).isOwner) return NextResponse.json({ error: "Chỉ chủ shop mới được xóa cuộc trò chuyện." }, { status: 403 });
  try {
    await deleteConversation(params.id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("Lỗi xóa hội thoại:", err);
    return NextResponse.json({ error: String(err.message || err) }, { status: 500 });
  }
}
