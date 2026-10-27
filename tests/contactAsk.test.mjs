import test from "node:test";
import assert from "node:assert/strict";
import { missingContactAsk } from "../lib/contactAsk.js";

const base = { kh: "chị", tu: "em" };

test("khách mới đưa địa chỉ, chưa có SĐT, AI chỉ nói đã nhận → thêm câu xin SĐT", () => {
  const r = missingContactAsk({ ...base, messages: ["da em nhận được thông tin rồi ạ"], gaveAddress: true, gavePhone: false, havePhone: false, haveAddress: true });
  assert.ok(r);
  assert.equal(r.need, "phone");
  assert.deepEqual(r.messages, ["da em nhận được thông tin rồi ạ", "Em xin thêm số điện thoại nữa nha chị."]);
});

test("đã có SĐT từ trước → không xin", () => {
  assert.equal(missingContactAsk({ ...base, messages: ["dạ em nhận rồi ạ"], gaveAddress: true, gavePhone: false, havePhone: true, haveAddress: true }), null);
});

test("AI đã tự xin SĐT → không thêm lần nữa", () => {
  assert.equal(missingContactAsk({ ...base, messages: ["Dạ em nhận rồi ạ, chị cho em xin số điện thoại nhé"], gaveAddress: true, gavePhone: false, havePhone: false, haveAddress: true }), null);
});

test("khách mới đưa SĐT, chưa có địa chỉ → xin địa chỉ", () => {
  const r = missingContactAsk({ ...base, messages: ["Dạ em nhận được số rồi ạ"], gaveAddress: false, gavePhone: true, havePhone: true, haveAddress: false });
  assert.equal(r.need, "address");
  assert.equal(r.messages[1], "Em xin thêm địa chỉ nhận hàng nữa nha chị.");
});

test("đưa cả hai cùng lúc hoặc không đưa gì → không làm gì", () => {
  assert.equal(missingContactAsk({ ...base, messages: ["ok"], gaveAddress: true, gavePhone: true, havePhone: true, haveAddress: true }), null);
  assert.equal(missingContactAsk({ ...base, messages: ["ok"], gaveAddress: false, gavePhone: false, havePhone: false, haveAddress: false }), null);
});

test("đã có 2 tin → nối câu xin vào tin cuối (tối đa 2 tin); sản phẩm trung tính dùng câu không xưng hô", () => {
  const r = missingContactAsk({ ...base, neutral: true, messages: ["Dạ ạ", "Shop nhận được địa chỉ rồi ạ"], gaveAddress: true, gavePhone: false, havePhone: false, haveAddress: true });
  assert.equal(r.messages.length, 2);
  assert.equal(r.messages[1], "Shop nhận được địa chỉ rồi ạ Shop xin thêm số điện thoại nữa nha ạ.");
});

import { looksLikeAddress } from "../lib/replyDedupe.js";

test("tin số đo không có chữ kg/cm ('Chiều cao 55 cân nặng 54') KHÔNG bị đọc nhầm là địa chỉ", () => {
  for (const t of ["Chiều cao 55 cân nặng 54", "chieu cao 155 can nang 54", "cao 155 nặng 54"]) {
    assert.equal(looksLikeAddress(t), false, t);
  }
});

test("địa chỉ thật vẫn nhận ra (kể cả có chữ 'Cao' trong tên đường)", () => {
  for (const t of ["12 Cao Thắng Hà Nội Việt Nam", "số 5 ngõ 12 Cầu Giấy Hà Nội", "12 Nguyễn Trãi Hà Nội"]) {
    assert.equal(looksLikeAddress(t), true, t);
  }
});

import { isCatalogQuestion } from "../lib/products.js";

test("khách xin tư vấn màu hợp ('53 tuổi mặc màu nào chị') KHÔNG bị coi là xin xem ảnh các màu", () => {
  for (const t of ["53 tuổi mặc màu nào chị", "Da ngăm mặc màu nào đẹp shop", "màu nào hợp với em"]) {
    assert.equal(isCatalogQuestion(t), false, t);
  }
});

test("khách hỏi chung các màu / xin bảng màu vẫn là xin ảnh tổng hợp", () => {
  for (const t of ["có mấy màu vậy shop", "Có những màu nào", "xin bảng màu", "shop có màu nào", "cho xem các mẫu"]) {
    assert.equal(isCatalogQuestion(t), true, t);
  }
});
