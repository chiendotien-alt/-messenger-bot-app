export const dynamic = "force-dynamic";
export const revalidate = 0;

import { NextResponse } from "next/server";
import { getScope } from "@/lib/auth";
import { listMembers, addMember, updateMember, deleteMember } from "@/lib/members";

// Tất cả thao tác ở đây CHỈ dành cho chủ shop
async function ownerOnly(req) {
  const scope = await getScope(req);
  return scope.isOwner ? null : NextResponse.json({ error: "Chỉ chủ shop mới quản lý member." }, { status: 403 });
}
const fail = (e, status = 400) => NextResponse.json({ error: String(e?.message || e) }, { status });

export async function GET(req) {
  const deny = await ownerOnly(req);
  if (deny) return deny;
  try {
    return NextResponse.json(await listMembers(), { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return fail(e, 500);
  }
}

// Thêm member: { username, name, password, pageIds: [], productIds: [] }
export async function POST(req) {
  const deny = await ownerOnly(req);
  if (deny) return deny;
  try {
    await addMember(await req.json());
    return NextResponse.json({ ok: true, members: await listMembers() });
  } catch (e) {
    return fail(e);
  }
}

// Sửa member: { id, name?, active?, password?, pageIds?, productIds? }
export async function PATCH(req) {
  const deny = await ownerOnly(req);
  if (deny) return deny;
  try {
    const { id, ...patch } = await req.json();
    await updateMember(id, patch);
    return NextResponse.json({ ok: true, members: await listMembers() });
  } catch (e) {
    return fail(e);
  }
}

export async function DELETE(req) {
  const deny = await ownerOnly(req);
  if (deny) return deny;
  try {
    const { id } = await req.json();
    await deleteMember(id);
    return NextResponse.json({ ok: true, members: await listMembers() });
  } catch (e) {
    return fail(e);
  }
}
