// Câu hỏi/than phiền về sản phẩm có chữ "k" (không) KHÔNG được đọc nhầm là địa chỉ — nếu nhầm thì bot tưởng khách mới đưa "một nửa" thông tin nhận hàng và chờ 30 giây.
import test from "node:test";
import assert from "node:assert/strict";
import { looksLikeAddress } from "../lib/replyDedupe.js";

test("Tình huống thật: 'Mà mặc 85 dài quá k em' là câu hỏi, không phải địa chỉ", () => {
  assert.equal(looksLikeAddress("Mà mặc 85 dài quá k em"), false);
});

test("Các cách gõ tắt / không dấu của 'không', 'chưa' đều là câu hỏi", () => {
  for (const t of [
    "Mặc 85 dài quá kh em ơi",
    "Mặc 85 dài quá khong em nhỉ",
    "Mặc 85 dài quá hok em ơi",
    "Mặc 85 dài quá hông em ơi",
    "Chị mặc 85 là dài quá em ơi, em có size ngắn hơn chưa",
  ]) assert.equal(looksLikeAddress(t), false, t);
});

test("Địa chỉ thật vẫn được nhận ra (không bị luật mới làm hỏng)", () => {
  for (const t of [
    "12 Nguyễn Trãi Hà Nội",
    "Phòng 302 nhà B5 ngõ 12 Nguyễn Trãi Hà Nội",
    "Số 5 đường Lê Hồng Phong phường 3 quận 10 TPHCM",
    "Văn phòng phẩm Văn Sinh Đông Khúc Nghĩa Trụ Hưng Yên",
    "Thôn 3 xã Hòa Bình huyện Tam Nông Phú Thọ",
  ]) assert.equal(looksLikeAddress(t), true, t);
});

test("Địa chỉ có chữ 'k' đứng riêng nhưng có từ khóa địa chỉ vẫn là địa chỉ", () => {
  assert.equal(looksLikeAddress("Số 5 ngõ 12 khu K Nguyễn Trãi Hà Nội"), true);
});
