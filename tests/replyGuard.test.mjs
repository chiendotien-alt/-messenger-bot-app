import test from "node:test";
import assert from "node:assert/strict";
import { cleanReplyList, stripForeignScript, looksLikeLeak } from "../lib/replyGuard.js";

const LEAK = `ক্ষমতার / Bước phân tích tình huống:
- Theo trạng thái thuộc tính và quy tắc sản phẩm: Chiều cao 1m45 dưới 1m50 nên chọn chiều dài 75cm; cân nặng 61kg nằm trong khoảng XL (61-67kg).
- Cần tư vấn size XL, chiều dài 75cm, sau đó hỏi màu vì màu chưa chọn.
- Xưng hô: "chị", cuối câu dùng "ạ", có chủ ngữ vị ngữ, không dùng icon, không dùng "nha".
Tin nhắn:
1. Dạ chị cao 1m45 nặng 61kg thì mình mặc size XL và chiều dài 75cm là vừa ạ.
2. Chị lấy chân váy màu nào ạ?`;

test("Ca lỗi thật: phân tích bị lộ → chỉ còn 2 tin gửi khách", () => {
  const out = cleanReplyList([LEAK]);
  assert.deepEqual(out, [
    "Dạ chị cao 1m45 nặng 61kg thì mình mặc size XL và chiều dài 75cm là vừa ạ.",
    "Chị lấy chân váy màu nào ạ?",
  ]);
});

test("Chỉ có phần phân tích, không có 'Tin nhắn:' → bỏ hết (để hệ thống gọi AI lại)", () => {
  const out = cleanReplyList(["Bước phân tích tình huống:\n- Khách hỏi giá\n- Cần báo giá"]);
  assert.deepEqual(out, []);
});

test("Chữ lạ (Bengali/Thái/Hindi...) bị gỡ khỏi tin bình thường", () => {
  assert.equal(stripForeignScript("ক্ষমতার Dạ chị lấy màu đen nha"), "Dạ chị lấy màu đen nha");
  assert.deepEqual(cleanReplyList(["สวัสดี Dạ em chào chị ạ"]), ["Dạ em chào chị ạ"]);
});

test("Tin bình thường không bị đụng; tiếng Việt có dấu giữ nguyên", () => {
  const msgs = ["Dạ váy này 199k chị nha", "Chị cao bao nhiêu, nặng bao nhiêu để em xem size nha?"];
  assert.deepEqual(cleanReplyList(msgs), msgs);
  assert.equal(looksLikeLeak("Dạ em gửi chị ảnh tin nhắn mẫu nha"), false);
});

test("Tối đa 2 tin và bỏ tin trùng", () => {
  assert.deepEqual(cleanReplyList(["a ạ", "a ạ", "b ạ", "c ạ"]), ["a ạ", "b ạ"]);
});
