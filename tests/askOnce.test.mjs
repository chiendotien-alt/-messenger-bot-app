// Luật chủ shop chốt: MỖI MỤC (size, màu, SĐT, địa chỉ...) hỏi MỘT lần, hỏi luôn lần đầu. Khách hỏi chuyện khác thì chỉ trả lời, không hỏi lại.
// Hỏi lại là việc của tin bồi sau "Thời gian hỏi lại". Các test dưới đây chạy lại những tình huống thật bằng các hàm của webhook.
import test from "node:test";
import assert from "node:assert/strict";
import { askedTopics, recentAskedTopics, removeInfoAsks, isWorryText } from "../lib/replyDedupe.js";
import { missingContactAsk } from "../lib/contactAsk.js";
import { addressInTexts, phoneInTexts } from "../lib/contactGiven.js";

const rows = (...texts) => texts.map((text, i) => ({ text, ageMs: (i + 1) * 30000 })); // mới nhất trước
const blockedFrom = (outgoing) => new Set(recentAskedTopics(rows(...outgoing), Infinity).topics);

test("Nhận diện chủ đề bot đã hỏi: SĐT, địa chỉ, size, màu", () => {
  assert.deepEqual([...askedTopics("chị cho em xin số điện thoại để em lên đơn nhé ạ")], ["so dien thoai"]);
  assert.deepEqual([...askedTopics("chị cho em xin số điện thoại và địa chỉ nhận hàng nha?")].sort(), ["dia chi", "so dien thoai"]);
  assert.deepEqual([...askedTopics("chị cho em xin chiều cao cân nặng để em chọn váy nha?")], ["size"]);
  assert.deepEqual([...askedTopics("chị lấy màu nào ạ?")], ["mau"]);
});

test("Lần ĐẦU hỏi: chưa hỏi gì trước đó → giữ nguyên câu hỏi, hỏi luôn", () => {
  const msg = "Dạ vải cotton mát lắm chị. Chị cho em xin chiều cao cân nặng nha?";
  assert.equal(removeInfoAsks(msg, blockedFrom([])), msg);
});

test("Đã hỏi size, khách hỏi sang chuyện khác → chỉ trả lời, bỏ câu hỏi size", () => {
  const blocked = blockedFrom(["chị cho em xin chiều cao cân nặng để em chọn váy nha?"]);
  assert.equal(removeInfoAsks("Dạ vải cotton mát lắm chị. Chị cho em xin chiều cao cân nặng nha?", blocked), "Dạ vải cotton mát lắm chị.");
});

test("Đã hỏi màu, khách hỏi ship → chỉ trả lời ship, bỏ câu hỏi màu", () => {
  const blocked = blockedFrom(["chị lấy màu nào ạ?"]);
  assert.equal(removeInfoAsks("Dạ ship 3-4 ngày chị nhé, chị lấy màu nào ạ?", blocked), "Dạ ship 3-4 ngày chị nhé.");
});

test("Hỏi mục KHÁC chưa từng hỏi thì vẫn được hỏi (đã hỏi size, giờ xin SĐT)", () => {
  const blocked = blockedFrom(["chị cho em xin chiều cao cân nặng nha?"]);
  const msg = "Dạ chị mặc size L là vừa ạ. Chị cho em xin số điện thoại để em lên đơn nhé?";
  assert.equal(removeInfoAsks(msg, blocked), msg);
});

test("Khách đang lo lắng (đổi trả, mất ship) → chỉ trấn an, không hỏi thêm", () => {
  assert.equal(isWorryText("chị sợ mất tiền ship, lỡ không vừa có đổi được không"), true);
  assert.equal(isWorryText("giá bao nhiêu em"), false);
});

// ---- Đoạn chat thật: bot xin SĐT dồn dập ----
const ADDR_AI = "127 Trần Mai Ninh, Phường 11, Tân Bình, TP.HCM";
const outgoing = ["Em xin thêm số điện thoại nữa nha chị.", "chị cho em xin số điện thoại và địa chỉ nhận hàng để em lên đơn nha"];

test("Chat thật, lượt 1: khách gửi địa chỉ (chưa có SĐT) → bot xin nốt SĐT (đúng 1 lần)", () => {
  const turn = ["127 tran mai ninh f11 tan binh tphcm", "Co sia ngan hon o shop"];
  const r = missingContactAsk({
    messages: ["dạ chiều dài chân váy bên em có 75cm, 85cm và 92cm là ngắn nhất rồi ạ"],
    gaveAddress: addressInTexts(turn, ADDR_AI), gavePhone: phoneInTexts(turn), havePhone: false, haveAddress: true, kh: "chị", tu: "em",
  });
  assert.equal(r.need, "phone");
  assert.equal(r.ask, "Em xin thêm số điện thoại nữa nha chị.");
});

test("Chat thật, lượt 2: khách chỉ nhắn 'Vay 75cm di nhe' → KHÔNG xin SĐT lại (cả câu hệ thống thêm lẫn câu AI viết)", () => {
  const turn = ["Vay 75cm di nhe"];
  // 1) hệ thống không tự thêm câu xin
  assert.equal(missingContactAsk({ messages: ["dạ em lấy chân váy dài 75cm cho chị nha"], gaveAddress: addressInTexts(turn, ADDR_AI), gavePhone: phoneInTexts(turn), havePhone: false, haveAddress: true, kh: "chị", tu: "em" }), null);
  // 2) AI lỡ viết câu xin SĐT → bị cắt, chỉ còn phần trả lời
  const cleaned = removeInfoAsks("dạ em lấy chân váy dài 75cm cho chị nha, chị cho em xin số điện thoại để em lên đơn nhé ạ", blockedFrom(outgoing));
  assert.equal(cleaned, "dạ em lấy chân váy dài 75cm cho chị nha.");
  // 3) AI chỉ viết mỗi câu xin SĐT → cắt hết (webhook sẽ xử lý riêng, không gửi lại câu xin)
  assert.equal(removeInfoAsks("chị cho em xin số điện thoại để em lên đơn nhé ạ", blockedFrom(outgoing)), "");
});

test("Khách gửi SĐT trước (chưa có địa chỉ) → xin nốt địa chỉ; lượt sau khách nói chuyện khác thì không xin nữa", () => {
  const t1 = ["0912345678"];
  const r1 = missingContactAsk({ messages: ["dạ em nhận được số rồi ạ"], gaveAddress: addressInTexts(t1, ""), gavePhone: phoneInTexts(t1), havePhone: true, haveAddress: false, kh: "chị", tu: "em" });
  assert.equal(r1.need, "address");
  const t2 = ["vải này có mát không em"];
  assert.equal(missingContactAsk({ messages: ["dạ vải cotton mát lắm ạ"], gaveAddress: addressInTexts(t2, ""), gavePhone: phoneInTexts(t2), havePhone: true, haveAddress: false, kh: "chị", tu: "em" }), null);
});

test("Khách gửi SĐT + địa chỉ cùng lúc → không thêm câu xin gì", () => {
  const t = ["0912345678 127 tran mai ninh f11 tan binh tphcm"];
  assert.equal(missingContactAsk({ messages: ["dạ em nhận rồi ạ"], gaveAddress: addressInTexts(t, ADDR_AI), gavePhone: phoneInTexts(t), havePhone: true, haveAddress: true, kh: "chị", tu: "em" }), null);
});
