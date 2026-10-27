import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { deriveOrderFacts } from "../lib/orderFacts.js";
import { buildOrderMessages, isOrderClosingMessage, looksLikeOrderBlock } from "../lib/priceLadder.js";

// Sản phẩm + hội thoại giống test orderFacts: có đủ màu/size/chiều dài để chốt đơn
const product = {
  name: "Chân váy 3 tầng",
  shipFee: 0,
  attributes: [
    { name: "Màu", values: "Đen, Kem, Trắng, Hồng", how: "" },
    { name: "Size", values: "S, M, L", how: "theo chiều cao cân nặng" },
    { name: "Chiều dài", values: "75cm, 85cm, 92cm", how: "theo chiều cao" },
  ],
  priceLadder: [{ qty: 1, list: "199k", steps: "199k", floor: "199k" }],
};
const chat = (...c) => c.map(([from, text]) => ({ from, text }));
const talk = chat(
  ["customer", "Chị cao 1m60 nặng 55kg"],
  ["bot", "Dạ chị mặc size M dài 85cm là vừa đẹp ạ. Chị chọn màu nào ạ?"],
  ["customer", "Màu kem"],
);
const info = { phone: "0912345678", address: "12 Lê Lợi, Quận 1, TP HCM" };
const build = (extra = {}) => {
  const f = deriveOrderFacts({ product, messages: talk, variantText: "" });
  return buildOrderMessages({ product, ctx: f.ctx, info, kh: "chị", tu: "em", detail: f.detail, hintQty: f.hintQty, ...extra });
};

test("Chốt đơn lần đầu: tin cuối là câu giao hàng 3-4 ngày và được nhận diện là câu chốt", () => {
  const out = build({ deliveryDays: { min: 3, max: 4 } });
  assert.equal(out.messages.length, 2);
  assert.equal(out.messages[1], "Đơn hàng giao trong khoảng từ 3-4 ngày chị để ý điện thoại giúp em nha.");
  assert.equal(isOrderClosingMessage(out.messages[1]), true);
  assert.equal(isOrderClosingMessage(out.messages[0]), false, "bảng đơn chưa phải câu chốt");
});

test("Giao đúng 1 mốc ngày ('2 ngày') và các cách xưng hô khác vẫn nhận diện", () => {
  assert.equal(isOrderClosingMessage(build({ deliveryDays: { min: 2, max: 2 } }).messages[1]), true);
  assert.equal(isOrderClosingMessage("Đơn hàng giao trong khoảng từ 3-4 ngày cô để ý điện thoại giúp con nha."), true);
  assert.equal(isOrderClosingMessage("Đơn hàng giao trong khoảng từ 3-4 ngày anh để ý điện thoại giúp em nha"), true);
});

test("Shop chưa ghi thời gian giao hàng → không có câu chốt (nên không tự tắt bot)", () => {
  const out = build({ deliveryDays: null });
  assert.equal(out.messages.some(isOrderClosingMessage), false);
});

test("Đơn chỉ được CẬP NHẬT (khách đổi màu...) → không gửi lại câu chốt, không tắt bot lần nữa", () => {
  const first = build({ deliveryDays: { min: 3, max: 4 } });
  const f = deriveOrderFacts({ product, messages: chat(...talk.map((m) => [m.from, m.text]), ["bot", "Dạ chị lấy màu nào ạ?"], ["customer", "đổi sang màu đen"]), variantText: "" });
  const updated = buildOrderMessages({ product, ctx: f.ctx, info, kh: "chị", tu: "em", detail: f.detail, hintQty: f.hintQty, deliveryDays: { min: 3, max: 4 }, sentBefore: first.messages });
  assert.equal(updated.messages.some(isOrderClosingMessage), false);
});

test("Câu do AI tự viết hoặc tin khác KHÔNG bị nhận nhầm là câu chốt", () => {
  for (const t of [
    "Dạ đơn hàng giao trong khoảng 3-4 ngày nha chị",
    "Ship khoảng 3-4 ngày là tới chị nhé",
    "Đơn hàng giao trong khoảng từ 3-4 ngày nha chị.",
    "Dạ em nhận được thông tin mới của chị rồi ạ, em cập nhật đơn cho chị nha.",
    "Em lên đơn ạ:\nChân váy 3 tầng\nMàu kem, SL:1\nSĐT 0912345678",
    "Chị để ý điện thoại giúp em nha",
    "",
    null,
    undefined,
  ]) assert.equal(isOrderClosingMessage(t), false, String(t));
});

test("Webhook: tắt bot chỉ khi câu chốt ĐÃ gửi thành công, và tôn trọng công tắc offAfterOrder", () => {
  const src = fs.readFileSync(new URL("../app/api/webhook/route.js", import.meta.url), "utf8");
  const mark = src.indexOf("else if (orderBlockSent && isOrderClosingMessage(messages[i])) closingSent = true;");
  const sendAt = src.indexOf("const delivered = await sendMessage(senderId, messages[i], pageToken);");
  assert.ok(mark > sendAt && sendAt > 0, "phải đánh dấu SAU khi sendMessage thành công");
  assert.match(src, /closingSent && settings\?\.offAfterOrder !== false/);
  assert.match(src, /setConversationBotOff\(senderId, true\)/);
});

test("Chuỗi chốt đơn: tin 1 là bảng đơn (có SĐT), tin 2 là câu chốt → đúng thứ tự 'lên đơn rồi mới tắt'", () => {
  const out = build({ deliveryDays: { min: 3, max: 4 } });
  assert.equal(looksLikeOrderBlock(out.messages[0]), true);
  assert.equal(isOrderClosingMessage(out.messages[1]), true);
});

test("Webhook: câu chốt chỉ tính khi bảng đơn đã gửi trước đó (orderBlockSent)", () => {
  const src = fs.readFileSync(new URL("../app/api/webhook/route.js", import.meta.url), "utf8");
  const blockAt = src.indexOf("if (looksLikeOrderBlock(messages[i])) orderBlockSent = true;");
  const closeAt = src.indexOf("else if (orderBlockSent && isOrderClosingMessage(messages[i])) closingSent = true;");
  assert.ok(blockAt > 0 && closeAt > blockAt, "phải đánh dấu bảng đơn trước, rồi mới xét câu chốt");
});
