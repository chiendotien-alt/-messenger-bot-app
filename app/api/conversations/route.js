import { NextResponse } from "next/server";
import { getAllConversations } from "@/lib/conversations";

export async function GET() {
  const all = await getAllConversations();

  const list = Object.entries(all).map(([id, conv]) => {
    const last = conv.messages[conv.messages.length - 1];
    return {
      id,
      name: conv.name || id,
      lastMessage: last?.text || "",
      lastTime: last?.time || "",
      lastFrom: last?.from || "",
    };
  });

  list.sort((a, b) => new Date(b.lastTime) - new Date(a.lastTime));

  return NextResponse.json(list);
}
