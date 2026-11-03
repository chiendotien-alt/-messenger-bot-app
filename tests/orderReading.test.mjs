import test from "node:test";
import assert from "node:assert/strict";
import { productAttributes, attributeStatus, applyItemsToStatus, summaryDetail, colorCount } from "../lib/attributes.js";
import { readOrder, normalizeAiItems, valueSupport, toNamed, fromNamed, savedItemsStillValid, describeItems, editDistance } from "../lib/orderItems.js";
import { summarize } from "../lib/orderReading.js";
import { deriveOrderFacts } from "../lib/orderFacts.js";

const B = (text) => ({ from: "bot", text });
const C = (text) => ({ from: "customer", text });
const product = {
  name: "Chân váy 3 tầng",
  description: "Chân váy 3 tầng, miễn phí ship",
  priceLadder: [
    { qty: 1, list: "185k", steps: "", floor: "185k" },
    { qty: 2, list: "350k", steps: "", floor: "350k" },
  ],
  attributes: [
    { name: "Màu", values: "Trắng, Đen, Kem, Vàng, Xanh, Hồng, Đỏ đô, Cam Đất", how: "" },
    { name: "Size", values: "S, M, L, XL, 2XL", how: "theo chiều cao cân nặng" },
    { name: "Chiều dài váy", values: "75cm, 85cm, 92cm", how: "theo chiều cao" },
  ],
};
const attrs = productAttributes(product);
const ask = [B("Chân váy bên em có 8 màu không biết chị chọn được màu nào chưa ạ ?")];
const REAL = "Cho 1 chân váy màu kem chiêu dài 75cm sai  m.   1 váy màu  chắng dài 92 cm sai xl";
const aiItem = (qty, color, size, len) => ({ qty, values: { ...(color ? { Màu: color } : {}), ...(size ? { Size: size } : {}), ...(len ? { "Chiều dài váy": len } : {}) } });
const read = (text, aiRaw, sysQty = 1, hist = ask) => {
  const st = attributeStatus(attrs, hist, [text], "");
  return { st, r: readOrder({ attrs, status: st, aiRaw, customerTexts: [text], sysQty }) };
};

test("AI ghi đúng 2 váy (khách gõ sai chính tả) → hai bên giống nhau", () => {
  const { r } = read(REAL, [aiItem(1, "Kem", "M", "75cm"), aiItem(1, "Trắng", "XL", "92cm")]);
  assert.equal(r.verdict, "agree");
});

test("AI ghép cặp sai (kem XL / trắng M) → mâu thuẫn: giữ bản hệ thống, không dùng bản AI", () => {
  const { r } = read(REAL, [aiItem(1, "Kem", "XL", "75cm"), aiItem(1, "Trắng", "M", "92cm")]);
  assert.equal(r.verdict, "conflict");
  assert.equal(r.final, null);
});

test("AI bịa màu khách không nói / ghi giá trị ngoài danh sách → bỏ bản AI", () => {
  assert.equal(read(REAL, [aiItem(1, "Kem"), aiItem(1, "Đen")]).r.verdict, "ai_invalid");
  assert.equal(read(REAL, [aiItem(1, "Kem", "3XL")]).r.verdict, "ai_invalid");
  assert.equal(read(REAL, [aiItem(1, "Kem", "M", "70cm")]).r.verdict, "ai_invalid");
  assert.equal(read(REAL, [{ qty: 1, values: { "Chất liệu": "Cotton" } }]).r.verdict, "ai_invalid");
});

test("Khách gõ sai mà luật không đọc được, AI đọc ra → dùng bản AI (ai_filled)", () => {
  const a = read("lấy 1 váy màu trăng size M", [aiItem(1, "Trắng", "M")]);
  assert.equal(a.r.verdict, "ai_filled");
  assert.equal(a.r.mode, "fill");
  applyItemsToStatus(attrs, a.st, a.r.final, { mode: "fill" });
  assert.deepEqual(a.st.list[0].picked, ["Trắng"]);
  assert.deepEqual(a.st.list[1].picked, ["M"]);
});

test("Giá trị AI điền thêm KHÔNG ghi đè mục hệ thống đã đọc chắc (chế độ fill)", () => {
  const st = attributeStatus(attrs, ask, ["lấy váy màu đen size M"], "");
  applyItemsToStatus(attrs, st, [{ qty: 1, values: { 0: "Trắng", 1: "M" } }], { mode: "fill" });
  assert.deepEqual(st.list[0].picked, ["Đen"]);
});

test("Khách chọn 2 màu: hai bên giống nhau, nhận cách ghép cặp của AI (mỗi món 1 dòng)", () => {
  const text = "lấy 2 váy màu đen và xanh size M dài 75cm";
  const { st, r } = read(text, [aiItem(1, "Đen", "M", "75cm"), aiItem(1, "Xanh", "M", "75cm")], 2);
  assert.equal(r.verdict, "agree");
  assert.equal(r.mode, "multi");
  applyItemsToStatus(attrs, st, r.final, { mode: "multi" });
  assert.equal(st.items.length, 2);
  assert.equal(colorCount(st), 2);
});

test("AI không ghi món nào: nếu luật thấy khách đã chọn thì ghi nhận 'ai_none'; chưa đặt gì thì bỏ qua", () => {
  assert.equal(read("Cho 1 váy màu kem dài 75cm size M", null).r.verdict, "ai_none");
  assert.equal(read("shop ơi giá bao nhiêu", null).r.verdict, "none");
  assert.equal(read("shop ơi giá bao nhiêu", []).r.verdict, "none");
});

test("Số lượng AI ít hơn luật (luật thấy 2, AI ghi 1) → mâu thuẫn, không giảm số lượng", () => {
  const { r } = read("lấy 2 váy màu đen size M", [aiItem(1, "Đen", "M")], 2);
  assert.equal(r.verdict, "conflict");
});

test("Kiểm giá trị AI: phải trùng danh sách; 'màu kem', 'size m', '75' được chấp nhận; khách không nhắc thì loại", () => {
  const ok = normalizeAiItems(attrs, [{ qty: "1", values: { màu: "màu kem", size: "size m", "chiều dài": "75" } }], ["Cho 1 váy màu kem 75 size m"]);
  assert.equal(ok.ok, true);
  assert.deepEqual(ok.items[0].values, { 0: "Kem", 1: "M", 2: "75cm" });
  assert.equal(normalizeAiItems(attrs, [aiItem(1, "Vàng")], ["lấy váy màu kem"]).ok, false);
  assert.equal(normalizeAiItems(attrs, "không phải mảng", []).ok, false);
  assert.equal(normalizeAiItems(attrs, Array.from({ length: 11 }, () => aiItem(1, "Kem")), ["kem"]).ok, false);
});

test("Gõ sai 1-2 chữ cái vẫn được coi là khách có nhắc ('trăng' → Trắng); chữ không liên quan thì không", () => {
  assert.equal(valueSupport(attrs[0], "Trắng", "lấy màu trăng nhé"), "fuzzy");
  assert.equal(valueSupport(attrs[0], "Trắng", "lấy màu chang nhé"), "exact"); // luật sửa được
  assert.equal(valueSupport(attrs[0], "Vàng", "lấy màu kem nhé"), "none");
  assert.equal(valueSupport(attrs[1], "XL", "lấy màu kem nhé"), "none"); // cỡ ngắn: không so gần giống
  assert.equal(editDistance("trang", "trăng".normalize("NFD").replace(/[\u0300-\u036f]/g, "")), 0);
});

test("Lưu / đọc lại danh sách món theo tên mục; khách nhắn đổi món sau đó thì không dùng nữa", () => {
  const items = [{ qty: 1, values: { 0: "Kem", 1: "M", 2: "75cm" } }, { qty: 1, values: { 0: "Trắng", 1: "XL", 2: "92cm" } }];
  const named = toNamed(attrs, items);
  assert.deepEqual(named[0].values, { Màu: "Kem", Size: "M", "Chiều dài váy": "75cm" });
  assert.deepEqual(fromNamed(attrs, named), items);
  assert.equal(describeItems(attrs, items), "1x Kem M 75cm + 1x Trắng XL 92cm");
  const saved = { items: named, src: REAL };
  assert.equal(savedItemsStillValid(attrs, saved, [REAL, "0972114816", "Hà Nội"]).length, 2);
  assert.equal(savedItemsStillValid(attrs, saved, [REAL, "đổi cái trắng thành màu đen nha"]), null);
  assert.equal(savedItemsStillValid(attrs, saved, [REAL, "lấy thêm 1 cái nữa"]), null);
  assert.deepEqual(fromNamed(attrs, [{ qty: 1, values: { Màu: "Tím" } }]), []); // giá trị không còn trong danh sách → bỏ
});

test("Đơn lưu dùng danh sách món đã chốt (kể cả khi luật không tự tách được): SL 2, 350k, đúng từng món", () => {
  // khách viết liền một câu mà luật không có chữ báo bắt đầu món → chỉ AI ghi nhận được
  const text = "chị lấy váy kem 75 size M với cái nữa trắng 92 XL";
  const messages = [...ask, C(text), B("Chị cho em xin SĐT ạ"), C("0972114816 Hà Nội")];
  const none = deriveOrderFacts({ product, messages });
  assert.equal(none.detail.items, undefined); // chưa có danh sách món → không ghép được cặp màu/size/dài cho từng món
  const saved = { items: toNamed(attrs, [{ qty: 1, values: { 0: "Kem", 1: "M", 2: "75cm" } }, { qty: 1, values: { 0: "Trắng", 1: "XL", 2: "92cm" } }]), src: text };
  const f = deriveOrderFacts({ product, messages, savedItems: saved });
  assert.equal(f.quantity, 2);
  assert.equal(f.dealTotal, 350000);
  assert.deepEqual(f.lines.map((l) => `${l.color}/${l.specs.join("+")}/${l.qty}`), ["Kem/size M+dài 75cm/1", "Trắng/size XL+dài 92cm/1"]);
});

test("Tỉ lệ: chỉ tính các lượt AI có ghi món; 'ai_none' không tính", () => {
  const s = summarize({ agree: 90, ai_filled: 4, conflict: 4, ai_invalid: 2, ai_none: 30 });
  assert.equal(s.judged, 100);
  assert.equal(s.total, 130);
  assert.equal(s.agreeRate, 90);
  assert.equal(s.usableRate, 94);
  assert.equal(s.needCheckRate, 4);
  assert.equal(s.invalidRate, 2);
  assert.equal(summarize({}).agreeRate, null);
});
