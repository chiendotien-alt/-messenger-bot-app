export const dynamic = "force-dynamic";
export const revalidate = 0;

import { NextResponse } from "next/server";
import { getSettings, saveSettings } from "@/lib/settings";
import { getScope } from "@/lib/auth";

export async function GET(req) {
  const settings = await getSettings();
  if (!(await getScope(req)).isOwner) return NextResponse.json({ botEnabled: settings.botEnabled !== false });
  return NextResponse.json(settings);
}

export async function POST(req) {
  if (!(await getScope(req)).isOwner) return NextResponse.json({ error: "Bạn không có quyền với mục này." }, { status: 403 });
  const body = await req.json();
  const current = await getSettings();
  const updated = { ...current, ...body };
  await saveSettings(updated);
  return NextResponse.json(updated);
}
