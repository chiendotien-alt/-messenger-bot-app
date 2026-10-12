export const dynamic = "force-dynamic";
export const revalidate = 0;

// app/api/products/route.js
import { NextResponse } from "next/server";
import { getProducts, addProduct, updateProduct, deleteProduct } from "@/lib/products";
import { getScope } from "@/lib/auth";

const DENY = () => NextResponse.json({ error: "Bạn không có quyền với mục này." }, { status: 403 });


function fail(err) {
  console.error("Lỗi sản phẩm:", err);
  return NextResponse.json({ error: String(err?.message || err) }, { status: 500 });
}

export async function GET(req) {
  const scope = await getScope(req);
  const all = await getProducts();
  // Member chỉ thấy sản phẩm được cấp quyền
  const products = scope.isOwner ? all : all.filter((p) => scope.productIds.has(String(p.id)));
  return NextResponse.json(products, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(req) {
  if (!(await getScope(req)).isOwner) return DENY();
  try {
    const newProduct = await req.json();
    const id = await addProduct(newProduct);
    return NextResponse.json({ ok: true, id });
  } catch (err) {
    return fail(err);
  }
}

export async function PUT(req) {
  if (!(await getScope(req)).isOwner) return DENY();
  try {
    const updated = await req.json();
    const found = await updateProduct(updated);
    if (!found) {
      return NextResponse.json({ error: "Không tìm thấy sản phẩm" }, { status: 404 });
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    return fail(err);
  }
}

export async function DELETE(req) {
  if (!(await getScope(req)).isOwner) return DENY();
  try {
    const { id } = await req.json();
    await deleteProduct(id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return fail(err);
  }
}
