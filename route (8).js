export const dynamic = "force-dynamic";
export const revalidate = 0;

// app/api/training/chats/route.js — danh sách / lưu / xóa các đoạn chat đã dạy bot
import { NextResponse } from "next/server";
import { listTrainingChats, saveTrainingChat, deleteTrainingChat } from "@/lib/trainingChats";

function fail(err, status = 400) {
  return NextResponse.json({ error: String(err?.message || err) }, { status });
}

export async function GET() {
  try {
    return NextResponse.json(await listTrainingChats(), { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    return fail(err, 500);
  }
}

// Có id → cập nhật đoạn chat cũ; không có id → tạo đoạn mới
export async function POST(req) {
  try {
    const id = await saveTrainingChat(await req.json());
    return NextResponse.json({ ok: true, id });
  } catch (err) {
    return fail(err);
  }
}

export async function DELETE(req) {
  try {
    const { id } = await req.json();
    await deleteTrainingChat(id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return fail(err);
  }
}
