export const dynamic = "force-dynamic";
export const revalidate = 0;

import { NextResponse } from "next/server";
import { getConversation, addMessage } from "@/lib/conversations";

export async function GET(req, { params }) {
  const conv = await getConversation(params.id);
  return NextResponse.json(conv || { name: params.id, messages: [] });
}

// Chủ shop tự gửi trả lời (hữu ích khi bot đang tắt)
export async function POST(req, { params }) {
  const { text } = await req.json();
  await addMessage(params.id, "admin", text);

  const PAGE_ACCESS_TOKEN = process.env.FB_PAGE_ACCESS_TOKEN;
  await fetch(`https://graph.facebook.com/v21.0/me/messages?access_token=${PAGE_ACCESS_TOKEN}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      recipient: { id: params.id },
      message: { text },
      messaging_type: "RESPONSE",
    }),
  });

  return NextResponse.json({ ok: true });
}
