import test from "node:test";
import assert from "node:assert/strict";
import { packConfig, detectPackQty } from "../lib/packQty.js";
import { computePriceContext, buildSummaryText, buildOrderMessages, finalizePriceReply, qtyHintFromTexts, guardPriceMessages, priceVerdictText } from "../lib/priceLadder.js";
import { deriveOrderFacts } from "../lib/orderFacts.js";

// Sản phẩm bán theo vỉ (Pin CR2032, 1 vỉ = 5 viên) + sản phẩm thường (chân váy) để chắc phần cũ không đổi.
const pin = {
  name: "Pin CR2032",
  unitName: "vỉ",
  unitSize: "5",
  description: "Miễn phí vận chuyển toàn quốc",
  priceLadder: [
    { qty: "1", list: "39k", steps: "39k", floor: "39k" },
    { qty: "2", list: "69k", steps: "", floor: "" },
    { qty: "3", list: "79k", steps: "75k", floor: "75k" },
  ],
};
const skirt = {
  name: "Chân váy",
  priceLadder: [
    { qty: "1", list: "199k", steps: "199k, 195k", floor: "195k" },
    { qty: "2", list: "350k", steps: "350k", floor: "350k" },
  ],
};
const cfg = packConfig(pin);
const info = { phone: "0912345678", address: "12 Lê Lợi, Quận 1, TP HCM" };
const C = (text) => ({ from: "customer", text });
const B = (text) => ({ from: "bot", text });

// ---------------------------------------------------------------------------------------------
// Lỗi 1: chữ "vì / vị / vĩ" (địa chỉ Ba Vì...) bị đọc thành "vỉ"
// ---------------------------------------------------------------------------------------------
test("địa chỉ Ba Vì / chữ 'vì', 'vị' KHÔNG bị đọc thành số vỉ", () => {
  for (const t of [
    "Địa chỉ nhà mình xã Ba Vì, Hà Nội",
    "Giao về huyện Ba Vì giúp mình",
    "12 ngõ 3, Ba Vì, Hà Nội, sđt 0912345678",
    "Mình ở Ba Vì ship mấy ngày vậy",
    "ba vi ha noi", // gõ không dấu hẳn: số bằng chữ + 'vi' không dấu → không nhận (có thể là địa chỉ)
    "cho mình 2 vì thấy rẻ",
    "có hai vị khách cần mua",
    "Bốn vị trí này đều ok",
    "nhà mình ở Tam Vì",
    "5 vĩ", // sai dấu
  ]) assert.equal(detectPackQty(t, cfg), null, t);
});

test("cách khách nói số vỉ / số viên thật vẫn đọc đúng (không bị siết quá tay)", () => {
  const want = (t, packs) => assert.equal(detectPackQty(t, cfg)?.packs, packs, t);
  want("2 vỉ", 2);
  want("2 vi", 2); // gõ không dấu bằng chữ số
  want("2vỉ", 2);
  want("2 VỈ", 2);
  want("hai vỉ nhé", 2);
  want("lấy ba vỉ", 3);
  want("lấy bốn vỉ", 4);
  want("Cho 10 viên", 2);
  want("cho anh 20 vien", 4);
  want("cho 15 viên nha", 3);
  want("2 vỉ 10 viên", 2);
  want("2 vỉ".normalize("NFD"), 2); // bàn phím gõ dấu rời
});

test("tin có cả số lượng lẫn địa chỉ Ba Vì: lấy đúng số lượng khách nói", () => {
  const r = detectPackQty("Cho 10 viên, 12 ngõ 3 Ba Vì Hà Nội 0912345678", cfg);
  assert.deepEqual(r, { packs: 2, pieces: 10, exact: true });
  const ctx = computePriceContext({ product: pin, customerNow: ["Cho 10 viên, 12 ngõ 3 Ba Vì Hà Nội 0912345678"] });
  assert.equal(ctx.qty, 2);
  assert.equal(ctx.dealTotal, 69000);
});

test("địa chỉ Ba Vì gửi riêng sau khi khách đã chọn 2 vỉ → số lượng vẫn là 2 vỉ, giá 69k", () => {
  const messages = [C("cho 10 viên"), B("Dạ 2 vỉ 69k, anh cho em xin SĐT và địa chỉ nha"), C("0912345678 xã Ba Vì, Hà Nội")];
  const f = deriveOrderFacts({ product: pin, messages });
  assert.equal(f.quantity, 2);
  assert.equal(f.dealTotal, 69000);
});

// ---------------------------------------------------------------------------------------------
// Lỗi 2: số viên không tròn vỉ → hệ thống tự ghép đơn "1 vỉ" dù bot hứa hỏi lại
// ---------------------------------------------------------------------------------------------
test("số viên không tròn vỉ: KHÔNG ghép tin chốt đơn (bot hỏi lại, không tự chọn 1 vỉ)", () => {
  const ctx = computePriceContext({ product: pin, customerNow: ["cho 7 viên"] });
  assert.deepEqual([ctx.packAmbig.low, ctx.packAmbig.high], [1, 2]);
  assert.equal(buildSummaryText({ product: pin, ctx, info }), "");
  assert.equal(buildOrderMessages({ product: pin, ctx, info }), null);
  // đường webhook: đủ SĐT + địa chỉ (ready) mà vẫn mơ hồ → giữ nguyên câu của AI, không chèn bảng đơn
  const fin = finalizePriceReply({ product: pin, ctx, messages: ["Dạ anh lấy 1 vỉ (5 viên) hay 2 vỉ (10 viên) ạ?"], info, ready: true, sentBefore: [] });
  assert.equal(fin.summary, "");
  assert.deepEqual(fin.messages, ["Dạ anh lấy 1 vỉ (5 viên) hay 2 vỉ (10 viên) ạ?"]);
});

test("số viên không tròn vỉ: đơn lưu được gắn cờ cần xác minh (qty_ambiguous)", () => {
  const f = deriveOrderFacts({ product: pin, messages: [C("lấy 7 viên"), C("0912345678 12 Lê Lợi Quận 1")] });
  const i = f.issues.find((x) => x.code === "qty_ambiguous");
  assert.ok(i, "phải có cờ qty_ambiguous");
  assert.match(i.message, /7 viên/);
  assert.match(i.message, /1 vỉ \(5 viên\) hay 2 vỉ \(10 viên\)/);
  // khách nói tròn vỉ thì không có cờ; sản phẩm thường cũng không bao giờ có
  assert.equal(deriveOrderFacts({ product: pin, messages: [C("cho 10 viên")] }).issues.some((x) => x.code === "qty_ambiguous"), false);
  assert.equal(deriveOrderFacts({ product: skirt, messages: [C("cho 7 viên")] }).issues.some((x) => x.code === "qty_ambiguous"), false);
});

test("sau khi bot hỏi lại, khách trả lời ngắn kiểu nào cũng gỡ được (không bị kẹt hỏi hoài)", () => {
  const older = "cho 7 viên";
  const cases = { "2 vỉ": 2, "hai vỉ": 2, "10 viên": 2, "1 vỉ": 1, "5 viên": 1, "2": 2, "vỉ 2": 2, "hai": 2, "lấy 2 nha": 2, "1": 1, "lấy 1": 1 };
  for (const [reply, qty] of Object.entries(cases)) {
    const r = qtyHintFromTexts([reply, older], pin); // mới nhất trước
    assert.equal(r.qty, qty, reply);
    assert.equal(r.ambig, null, reply);
    const ctx = computePriceContext({ product: pin, customerNow: [], customerRecent: [reply, older] });
    assert.equal(ctx.qty, qty, reply);
    assert.match(buildSummaryText({ product: pin, ctx, info }), new RegExp(`SL:${qty} vỉ`), reply);
  }
  // số trả lời không nằm trong 2 phương án bot hỏi → vẫn mơ hồ, tiếp tục hỏi
  assert.equal(qtyHintFromTexts(["3", older], pin).qty, null);
  assert.ok(qtyHintFromTexts(["3", older], pin).ambig);
  // số trơn đứng TRƯỚC câu mơ hồ (khách nói "2" rồi mới nói "7 viên") thì tin mơ hồ là tin mới nhất → vẫn hỏi lại
  assert.ok(qtyHintFromTexts([older, "2"], pin).ambig);
});

test("sản phẩm thường: số trơn / chữ 'vì, vị' không đổi gì", () => {
  // không bật bán theo vỉ: số trơn "2" không được dùng để gỡ gì cả, "7 viên" vẫn đọc như cũ (7 cái)
  assert.deepEqual(qtyHintFromTexts(["2", "cho 7 viên"], skirt), { qty: 7, ambig: null });
  const a = computePriceContext({ product: skirt, customerNow: ["xã Ba Vì, lấy 2 cái"] });
  assert.equal(a.qty, 2);
  assert.equal(a.pack, undefined);
  const b = computePriceContext({ product: skirt, customerNow: ["Địa chỉ xã Ba Vì Hà Nội"] });
  assert.equal(b.qty, 1);
});

// ---------------------------------------------------------------------------------------------
// Nhãn đơn vị: sản phẩm bán theo vỉ không được ghi "cái" ở câu thay thế / dòng ghi chú
// ---------------------------------------------------------------------------------------------
test("chốt chặn giá + dòng ghi chú trang Dạy bot: ghi đúng '2 vỉ (10 viên)' với sản phẩm bán theo vỉ, '2 cái' với sản phẩm thường", () => {
  const ctxPin = computePriceContext({ product: pin, customerNow: ["cho 10 viên"] });
  const g = guardPriceMessages(["Dạ 10 viên em báo 20k thôi ạ"], ctxPin, { tu: "em" }); // thấp hơn giá sàn → bị cắt
  assert.equal(g.changed, true);
  assert.match(g.messages[0], /cho 2 vỉ \(10 viên\) ạ/);
  assert.match(priceVerdictText({ ...ctxPin, decision: { type: "step", amount: 69000 } }), /cho 2 vỉ \(10 viên\)/);

  const ctxSkirt = computePriceContext({ product: skirt, customerNow: ["lấy 2 cái"] });
  const g2 = guardPriceMessages(["Dạ 2 cái em báo 150k ạ"], ctxSkirt, { tu: "em" });
  assert.equal(g2.changed, true);
  assert.match(g2.messages[0], /cho 2 cái ạ/);
  assert.match(priceVerdictText({ ...ctxSkirt, decision: { type: "step", amount: 350000 } }), /cho 2 cái\./);
});
