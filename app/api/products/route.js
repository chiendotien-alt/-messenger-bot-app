export const dynamic = "force-dynamic";
export const revalidate = 0;

// app/api/products/route.js
import { NextResponse } from "next/server";
import { getProducts, addProduct, updateProduct, deleteProduct } from "@/lib/products";

function fail(err) {
  console.error("Lỗi sản phẩm:", err);
  return NextResponse.json({ error: String(err?.message || err) }, { status: 500 });
}

export async function GET() {
  const products = await getProducts();
  return NextResponse.json(products, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(req) {
  try {
    const newProduct = await req.json();
    const id = await addProduct(newProduct);
    return NextResponse.json({ ok: true, id });
  } catch (err) {
    return fail(err);
  }
}

export async function PUT(req) {
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
  try {
    const { id } = await req.json();
    await deleteProduct(id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return fail(err);
  }
}
