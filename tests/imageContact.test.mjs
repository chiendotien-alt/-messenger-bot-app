// Lỗi 26/11/2026: khách gửi ẢNH CHỤP có địa chỉ + SĐT; AI đọc được nhưng hệ thống bỏ vì "chữ khách nhắn không có"
// → hồ sơ khách không có số, không tự tạo đơn, chủ shop phải lên đơn bằng tay.
import test from "node:test";
import assert from "node:assert/strict";
import { acceptImageContact, normalizeVnMobile, shopAskedContactRecently, addressPlausible } from "../lib/imageContact.js";

const B = (text) => ({ from: "bot", text });
const C = (text) => ({ from: "customer", text });
const asked = [C("Ok"), B("Chị bổ sung giúp em số điện thoại và địa chỉ nhận hàng nha?"), C("Vậy em gửi chị"), B("Chị cho em biết số điện thoại và địa chỉ nhận hàng nha?")];

test("LỖI THẬT: ảnh chụp 'Số 163 Đg Phạm Khắc Vinh, P Nam Cường, Tp Yên Bái, 0818686370' → nhận cả SĐT và địa chỉ", () => {
  const r = acceptImageContact({ name: "", phone: "0818686370", address: "Số 163 Đường Phạm Khắc Vinh, Phường Nam Cường, Thành phố Yên Bái" }, asked);
  assert.equal(r.phone, "0818686370");
  assert.match(r.address, /163.*Phạm Khắc Vinh.*Yên Bái/);
});

test("shop chưa hề xin SĐT/địa chỉ → không nhận gì từ ảnh (tránh đọc nhầm số trên ảnh hàng / feedback)", () => {
  const r = acceptImageContact({ phone: "0818686370", address: "Số 163 Đường Phạm Khắc Vinh, Phường Nam Cường" }, [C("Cho xem ảnh"), B("Dạ em gửi chị xem nha.")]);
  assert.deepEqual(r, {});
});

test("SĐT sai dạng thì bỏ; nhận số +84 / 84 và đổi về 0xxxxxxxxx", () => {
  assert.equal(normalizeVnMobile("+84 818 686 370"), "0818686370");
  assert.equal(normalizeVnMobile("84818686370"), "0818686370");
  assert.equal(normalizeVnMobile("0818686370"), "0818686370");
  assert.equal(normalizeVnMobile("123456789"), "");
  assert.equal(normalizeVnMobile("0218686370"), ""); // đầu 02 là số bàn, không nhận
  assert.equal(normalizeVnMobile("08186863701"), ""); // 11 số
  assert.deepEqual(acceptImageContact({ phone: "12345", address: "" }, asked), {});
});

test("chỉ có tên tỉnh/thành thì không phải địa chỉ nhận hàng", () => {
  assert.equal(addressPlausible("Yên Bái"), false);
  assert.equal(addressPlausible("Tp Yên Bái"), false);
  assert.equal(addressPlausible("Số 163 Đường Phạm Khắc Vinh Phường Nam Cường"), true);
  assert.equal(addressPlausible("thôn 3 xã Hòa Bình huyện Lục Yên"), true);
  assert.deepEqual(acceptImageContact({ phone: "", address: "Tp Yên Bái" }, asked), {});
});

test("nhận biết shop vừa xin thông tin nhận hàng", () => {
  assert.equal(shopAskedContactRecently(asked), true);
  assert.equal(shopAskedContactRecently([B("Dạ em gửi ảnh chị xem nha")]), false);
  assert.equal(shopAskedContactRecently([]), false);
});
