export const dynamic = "force-dynamic";
export const revalidate = 0;

import { NextResponse } from "next/server";
import { listKeys, addKey, deleteKey, normProvider } from "@/lib/apiKeys";

const prov = normProvider;

// provider: "gemini" (mặc định, key miễn phí) | "gemini_paid" (1 key trả phí) | "groq" (AI dự phòng)
export async function GET(req) {
  try {
    const provider = prov(new URL(req.url).searchParams.get("provider"));
    return NextResponse.json({ keys: await listKeys(provider) });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

export async function POST(req) {
  try {
    const { key, label, provider } = await req.json();
    await addKey(key, label, prov(provider));
    return NextResponse.json({ keys: await listKeys(prov(provider)) });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 400 });
  }
}

export async function DELETE(req) {
  try {
    const { id, provider } = await req.json();
    await deleteKey(id);
    return NextResponse.json({ keys: await listKeys(prov(provider)) });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 400 });
  }
}
