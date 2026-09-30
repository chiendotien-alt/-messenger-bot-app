export const dynamic = "force-dynamic";
export const revalidate = 0;
export const maxDuration = 30;

import { NextResponse } from "next/server";
import { getConversation, extractPhone } from "@/lib/conversations";
import { getProducts, filterProductsForPage } from "@/lib/products";
import { getAllRawKeys } from "@/lib/apiKeys";

const MODELS = ["gemini-3.6-flash", "gemini-3.5-flash", "gemini-3.5-flash-lite"];

async function askGemini(prompt, keys) {
  for (const model of MODELS) {
    for (const k of keys) {
      try {
        const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-goog-api-key": k.key },
          body: JSON.stringify({
            contents: [{ role: "user", parts: [{ text: prompt }] }],
            generationConfig: { temperature: 0, responseMimeType: "application/json" },
          }),
          signal: AbortSignal.timeout(12000),
        });
        if (!res.ok) continue;
        const data = await res.json();
        const text = data?.candidates?.[0]?.content?.parts?.map((p) => p.text || "").join("") || "";
        if (text.trim()) return text;
      } catch {}
    }
  }
  return "";
}

function parseJson(raw) {
  try {
    return JSON.parse(String(raw).replace(/```json|```/g, "").trim());
  } catch {
    return null;
  }
}

/** Tự điền đơn từ nội dung chat: tên, SĐT, địa chỉ, sản phẩm, màu/size, số lượng, giá. */
export async function POST(req) {
  try {
    const { conversationId } = await req.json();
    const conv = await getConversation(conversationId);
    const all = await getProducts();
    const products = filterProductsForPage(all, conv.pageId);

    const chat = conv.messages
      .filter((m) => m.text && !/^📷/.test(m.text))
      .slice(-60)
      .map((m) => `${m.from === "customer" ? "KHÁCH" : "SHOP"}: ${m.text}`)
      .join("\n");

    // Phần tự điền không cần AI (luôn có, kể cả khi AI lỗi)
    const customerText = conv.messages.filter((m) => m.from === "customer").map((m) => m.text).reverse();
    let phone = "";
    for (const t of customerText) {
      const p = extractPhone(t);
      if (p) {
        phone = p;
        break;
      }
    }
    const order = {
      customerName: conv.name || "",
      phone,
      address: "",
      productId: "",
      productName: "",
      variant: "",
      quantity: 1,
      unitPrice: 0,
      shipFee: 0,
      note: "",
    };

    const keys = await getAllRawKeys();
    let aiOk = false;
    if (keys.length && chat) {
      const productText = products
        .map((p) => `[id: ${p.id}] ${p.name}\n   ${(p.description || "").slice(0, 700)}`)
        .join("\n");
      const prompt = `Bạn là trợ lý lên đơn cho shop thời trang. Đọc đoạn chat giữa KHÁCH và SHOP, rồi trích thông tin để lên đơn.

DANH SÁCH SẢN PHẨM CỦA SHOP:
${productText || "(chưa có)"}

ĐOẠN CHAT:
${chat}

Trả về DUY NHẤT 1 JSON đúng dạng:
{"customerName":"tên người nhận","phone":"số điện thoại","address":"địa chỉ nhận hàng đầy đủ (số nhà, đường, phường/xã, quận/huyện, tỉnh/thành)","productId":"id sản phẩm khách chốt mua, lấy đúng từ danh sách","variant":"màu/size khách chọn, vd: đỏ, size M","quantity":số lượng,"unitPrice":giá 1 sản phẩm bằng số (VNĐ, không dấu chấm),"shipFee":phí ship bằng số hoặc 0,"note":"ghi chú khác của khách nếu có"}

Quy tắc: chỉ lấy thông tin có trong chat hoặc danh sách sản phẩm, KHÔNG bịa. Không có thì để chuỗi rỗng hoặc 0 (quantity mặc định 1). Nếu giá phụ thuộc số lượng (vd mua 2 giá rẻ hơn) thì tính unitPrice theo số lượng khách chốt. Địa chỉ lấy theo lần khách gửi mới nhất.`;
      const parsed = parseJson(await askGemini(prompt, keys));
      if (parsed && typeof parsed === "object") {
        aiOk = true;
        if (parsed.customerName) order.customerName = String(parsed.customerName);
        if (parsed.phone) order.phone = String(parsed.phone).replace(/[\s.-]/g, "");
        if (parsed.address) order.address = String(parsed.address);
        const p = products.find((x) => String(x.id) === String(parsed.productId));
        if (p) {
          order.productId = String(p.id);
          order.productName = p.name;
        }
        if (parsed.variant) order.variant = String(parsed.variant);
        order.quantity = Math.max(1, Number(parsed.quantity) || 1);
        order.unitPrice = Math.max(0, Number(parsed.unitPrice) || 0);
        order.shipFee = Math.max(0, Number(parsed.shipFee) || 0);
        if (parsed.note) order.note = String(parsed.note);
      }
    }
    return NextResponse.json({
      order,
      aiOk,
      products: products.map((p) => ({ id: String(p.id), name: p.name })),
    });
  } catch (err) {
    console.error("Lỗi tạo đơn nháp:", err);
    return NextResponse.json({ error: String(err.message || err) }, { status: 500 });
  }
}
