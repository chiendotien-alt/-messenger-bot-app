// Lỗi 25/11/2026: khách nhắn "Gửi bản màu" (gõ thiếu g) → bot chặn ảnh nhưng vẫn hứa "em gửi chị xem bảng màu" → chủ shop phải gửi tay.
import test from "node:test";
import assert from "node:assert/strict";
import { isCatalogQuestion } from "../lib/products.js";
import { catalogAskByAi, dropImagePromises } from "../lib/imageAsk.js";

test("LỖI THẬT: 'Gửi bản màu' (gõ thiếu g) được nhận là xin xem bảng màu", () => {
  for (const t of ["Gửi bản màu", "gửi bản màu đi shop", "cho xem bản màu", "bản màu", "gửi bản mầu", "Gửi bảng màu"]) {
    assert.equal(isCatalogQuestion(t), true, t);
  }
});

test("không nhầm các câu thường: chọn màu, hỏi màu cụ thể, tư vấn màu hợp", () => {
  for (const t of ["Lấy màu đen", "Cho chị màu đen", "màu đen có không shop", "Chiều cao 1m5 có bị dài hog", "Cân nặng 48ki", "53 tuổi mặc màu nào hợp"]) {
    assert.equal(isCatalogQuestion(t), false, t);
  }
});

test("AI đã đặt send_catalog + khách nhắc màu kèm chữ gửi/xem → không chặn; thiếu một trong hai thì không", () => {
  assert.equal(catalogAskByAi({ sendCatalog: true, text: "Gửi bản màu" }), true);
  assert.equal(catalogAskByAi({ sendCatalog: true, text: "gui mau cho minh xem voi" }), true);
  assert.equal(catalogAskByAi({ sendCatalog: false, text: "Gửi bản màu" }), false); // AI không muốn gửi
  assert.equal(catalogAskByAi({ sendCatalog: true, text: "Lấy màu đen" }), false); // không có chữ gửi/xem/xin/cho
  assert.equal(catalogAskByAi({ sendCatalog: true, text: "Cân nặng 48ki" }), false);
  assert.equal(catalogAskByAi({ sendCatalog: true, text: "Gửi màu đen 0912345678 Hà Nội", hasPhone: true }), false); // đang chốt đơn
});

test("ảnh bị chặn: bỏ câu hứa 'em gửi chị xem bảng màu', giữ phần còn lại", () => {
  const r = dropImagePromises(["Dạ em gửi chị xem bảng màu váy bên shop nhé."]);
  assert.deepEqual(r.messages, []);
  assert.equal(r.dropped.length, 1);
  const r2 = dropImagePromises(["Dạ chị cao 1m5 thì mặc dài 75cm là vừa đẹp ạ. Em gửi chị xem ảnh nha."]);
  assert.deepEqual(r2.messages, ["Dạ chị cao 1m5 thì mặc dài 75cm là vừa đẹp ạ."]);
  const r3 = dropImagePromises(["Dạ chị nặng 48kg thì mình mặc size M ạ.", "Chị đã chọn được màu chân váy nào bên em chưa ạ?"]);
  assert.deepEqual(r3.dropped, []);
  assert.equal(r3.messages.length, 2);
});
