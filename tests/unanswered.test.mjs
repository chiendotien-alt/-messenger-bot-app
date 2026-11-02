import test from "node:test";
import assert from "node:assert/strict";
import { isClosingText, alertSettings, adminUrl, buildBotOffMessage, buildWatchMessage } from "../lib/unanswered.js";

test("Tin chỉ là cảm ơn / ok / dạ / emoji thì KHÔNG cần báo chủ shop", () => {
  for (const t of ["cảm ơn shop", "Cảm ơn em nhé", "ok", "Ok em", "dạ", "Dạ vâng ạ", "thanks", "👍", "❤️❤️", "okie nha", "chào shop", "tạm biệt", "", "   "]) {
    assert.equal(isClosingText(t), true, JSON.stringify(t));
  }
});

test("Tin có câu hỏi / yêu cầu thật thì PHẢI báo", () => {
  for (const t of [
    "Ship về Hải Phòng mấy ngày vậy shop",
    "bao giờ giao hàng vậy em",
    "chị muốn đổi địa chỉ nhận hàng",
    "Có màu đen không em",
    "cảm ơn shop nhưng chị muốn đổi size",
    "ok vậy hủy đơn giúp chị",
    "mai chị gửi địa chỉ nha",
  ]) assert.equal(isClosingText(t), false, t);
});

test("Cài đặt: mặc định nhắc sau 10 phút; tắt được; đổi được số phút", () => {
  assert.deepEqual(alertSettings({}), { enabled: true, minutes: 10 });
  assert.deepEqual(alertSettings({ UNANSWERED_ALERT: "off" }), { enabled: false, minutes: 0 });
  assert.deepEqual(alertSettings({ UNANSWERED_ALERT_MIN: "5" }), { enabled: true, minutes: 5 });
  assert.deepEqual(alertSettings({ UNANSWERED_ALERT_MIN: "0" }), { enabled: true, minutes: 0 }); // chỉ báo ngay, không nhắc lại
  assert.deepEqual(alertSettings({ UNANSWERED_ALERT_MIN: "abc" }), { enabled: true, minutes: 10 });
  assert.equal(alertSettings({ UNANSWERED_ALERT_MIN: "9999" }).minutes, 180);
});

test("Link trang quản trị lấy từ biến Vercel, không có thì bỏ qua", () => {
  assert.equal(adminUrl({ VERCEL_PROJECT_PRODUCTION_URL: "bot-abc.vercel.app" }), "https://bot-abc.vercel.app/admin");
  assert.equal(adminUrl({ VERCEL_URL: "https://x.vercel.app" }), "https://x.vercel.app/admin");
  assert.equal(adminUrl({}), "");
});

test("Tin báo NGAY khi khách nhắn lúc bot tắt", () => {
  const m = buildBotOffMessage({ name: "Đào Thị Hà", text: "Ship về Hải Phòng mấy ngày vậy shop", url: "https://x.vercel.app/admin" });
  assert.match(m, /bot đang TẮT/);
  assert.match(m, /Đào Thị Hà: "Ship về Hải Phòng mấy ngày vậy shop"/);
  assert.match(m, /https:\/\/x\.vercel\.app\/admin/);
  assert.doesNotMatch(buildBotOffMessage({ name: "", text: "hi", url: "" }), /undefined|null/);
});

test("Tin nhắc lại gom nhiều khách, ghi rõ lý do, ẩn số điện thoại trong tin khách", () => {
  const m = buildWatchMessage(
    [
      { name: "Hà", lastMessage: "bao giờ giao vậy em", waitMin: 14, botOff: true },
      { name: "", lastMessage: "sđt chị 0912345678 nhé", waitMin: 11, botOff: false },
    ],
    "https://x.vercel.app/admin",
  );
  assert.match(m, /2 khách đang chờ/);
  assert.match(m, /1\) Hà — chờ 14 phút \(bot đang tắt với khách này\)/);
  assert.match(m, /2\) Khách — chờ 11 phút \(bot chưa trả lời\)/);
  assert.doesNotMatch(m, /0912345678/);
  const many = buildWatchMessage(Array.from({ length: 13 }, (_, i) => ({ name: `K${i}`, lastMessage: "hỏi giá", waitMin: 10, botOff: false })));
  assert.match(many, /và 3 khách nữa/);
});
