import test from "node:test";
import assert from "node:assert/strict";
import { addressInTexts, phoneInTexts } from "../lib/contactGiven.js";
import { missingContactAsk } from "../lib/contactAsk.js";

// Đoạn chat thật: khách đã gửi địa chỉ từ lượt trước, bot đã xin SĐT; lượt này khách chỉ trả lời chiều dài.
const AI_ADDR = "127 Trần Mai Ninh, Phường 11, Tân Bình, TP.HCM"; // AI lượt nào cũng trích lại địa chỉ từ lịch sử

test("khách chỉ nhắn chiều dài (địa chỉ gửi từ trước) → KHÔNG tính là vừa đưa địa chỉ", () => {
  assert.equal(addressInTexts(["Vay 75cm di nhe"], AI_ADDR), false);
});

test("khách chỉ nhắn chiều dài → không thêm câu xin SĐT nữa (không hỏi dồn)", () => {
  const r = missingContactAsk({
    messages: ["dạ em lấy chân váy dài 75cm cho chị nha"],
    gaveAddress: addressInTexts(["Vay 75cm di nhe"], AI_ADDR),
    gavePhone: phoneInTexts(["Vay 75cm di nhe"]),
    havePhone: false,
    haveAddress: true,
    kh: "chị",
    tu: "em",
  });
  assert.equal(r, null);
});

test("khách VỪA gửi địa chỉ (chưa có SĐT) → vẫn được xin nốt SĐT", () => {
  const texts = ["127 tran mai ninh f11 tan binh tphcm"];
  assert.equal(addressInTexts(texts, AI_ADDR), true);
  const r = missingContactAsk({ messages: ["dạ em nhận rồi ạ"], gaveAddress: true, gavePhone: phoneInTexts(texts), havePhone: false, haveAddress: true, kh: "chị", tu: "em" });
  assert.equal(r.need, "phone");
});

test("AI trích địa chỉ mà tin khách vừa nhắn có đủ các từ của địa chỉ đó → tính là vừa đưa", () => {
  assert.equal(addressInTexts(["so 5 ngo 12 doan thi diem dong da ha noi"], "5 ngõ 12 Đoàn Thị Điểm, Đống Đa, Hà Nội"), true);
});

test("khách vừa gửi SĐT → phoneInTexts đúng; tin không có SĐT → sai", () => {
  assert.equal(phoneInTexts(["0912 345 678"]), true);
  assert.equal(phoneInTexts(["sdt 0912.345.678 nha"]), true);
  assert.equal(phoneInTexts(["Mau kem 150 nang 53"]), false);
  assert.equal(phoneInTexts([]), false);
});

test("không có tin nào / không có địa chỉ AI → không tính", () => {
  assert.equal(addressInTexts([], AI_ADDR), false);
  assert.equal(addressInTexts(["ok chị lấy nha"], ""), false);
});
