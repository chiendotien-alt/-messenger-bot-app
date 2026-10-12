export const dynamic = "force-dynamic";
export const revalidate = 0;

import { NextResponse } from "next/server";
import { listKeys, addKey, deleteKey } from "@/lib/apiKeys";

export async function GET() {
  try {
    return NextResponse.json({ keys: await listKeys() });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

export async function POST(req) {
  try {
    const { key, label } = await req.json();
    await addKey(key, label);
    return NextResponse.json({ keys: await listKeys() });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 400 });
  }
}

export async function DELETE(req) {
  try {
    const { id } = await req.json();
    await deleteKey(id);
    return NextResponse.json({ keys: await listKeys() });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 400 });
  }
}
