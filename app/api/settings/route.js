import { NextResponse } from "next/server";
import { getSettings, saveSettings } from "@/lib/settings";

export async function GET() {
  const settings = await getSettings();
  return NextResponse.json(settings);
}

export async function POST(req) {
  const body = await req.json();
  const current = await getSettings();
  const updated = { ...current, ...body };
  await saveSettings(updated);
  return NextResponse.json(updated);
}
