// app/api/products/route.js
import { NextResponse } from "next/server";
import { getProducts, saveProducts } from "@/lib/products";

export async function GET() {
  const products = await getProducts();
  return NextResponse.json(products);
}

export async function POST(req) {
  const newProduct = await req.json();
  const products = await getProducts();
  const id = Date.now().toString();
  products.push({ id, ...newProduct });
  await saveProducts(products);
  return NextResponse.json({ ok: true, id });
}

export async function PUT(req) {
  const updated = await req.json();
  const products = await getProducts();
  const idx = products.findIndex((p) => p.id === updated.id);
  if (idx === -1) {
    return NextResponse.json({ error: "Không tìm thấy sản phẩm" }, { status: 404 });
  }
  products[idx] = updated;
  await saveProducts(products);
  return NextResponse.json({ ok: true });
}

export async function DELETE(req) {
  const { id } = await req.json();
  const products = await getProducts();
  const filtered = products.filter((p) => p.id !== id);
  await saveProducts(filtered);
  return NextResponse.json({ ok: true });
}
