export const dynamic = "force-dynamic";
export const revalidate = 0;

// app/api/training/route.js — danh sách / thêm / sửa / xóa câu trả lời chuẩn đã dạy bot
import { NextResponse } from "next/server";
import { listTraining, addTraining, updateTraining, deleteTraining } from "@/lib/training";

function fail(err, status = 400) {
  return NextResponse.json({ error: String(err?.message || err) }, { status });
}

export async function GET() {
  try {
    return NextResponse.json(await listTraining(), { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    return fail(err, 500);
  }
}

export async function POST(req) {
  try {
    const id = await addTraining(await req.json());
    return NextResponse.json({ ok: true, id });
  } catch (err) {
    return fail(err);
  }
}

export async function PUT(req) {
  try {
    await updateTraining(await req.json());
    return NextResponse.json({ ok: true });
  } catch (err) {
    return fail(err);
  }
}

export async function DELETE(req) {
  try {
    const { id } = await req.json();
    await deleteTraining(id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return fail(err);
  }
}
