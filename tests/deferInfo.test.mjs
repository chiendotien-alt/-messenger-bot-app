import test from "node:test";
import assert from "node:assert/strict";
import { analyzeDefer, saidLater, customerWantsLater, dropAsksForDeferred } from "../lib/laterStop.js";
import { pickAddressFromTexts } from "../lib/pickAddress.js";
import { looksLikeAddressStrict } from "../lib/replyDedupe.js";

const defers = (t) => analyzeDefer([t]);

test("Khách hẹn gửi địa chỉ / thông tin / SĐT sau → nhận ra là hẹn", () => {
  for (const t of [
    "Mai chị gửi địa chỉ cty nha y", // đúng câu trong ảnh chụp
    "mai chị gửi thông tin nha",
    "Mai chị gửi sđt nha",
    "tối chị gửi địa chỉ cho em nha",
    "để chị gửi địa chỉ sau nhé",
    "địa chỉ lát nữa chị nhắn",
    "mai chi gui dia chi nha", // gõ không dấu
    "chưa có địa chỉ cụ thể em ơi",
    "khi nào tiện chị gửi địa chỉ",
    "mai em tư vấn cho chị nhé",
    "mai ib em địa chỉ nha",
  ]) assert.equal(defers(t).defer, true, t);
});

test("Tin bình thường (chọn màu, đưa địa chỉ thật, hỏi ship...) KHÔNG bị coi là hẹn", () => {
  for (const t of [
    "Chị lấy một cái màu trắng",
    "mai gửi hàng cho chị nhé",
    "ship mai tới không em",
    "địa chỉ 12 Nguyễn Trãi, Thanh Xuân, Hà Nội",
    "mai chị nhận hàng ở công ty",
    "chị cao 1m60 nặng 60kg",
    "chiều dài váy chị gửi em",
    "mai chị gửi tiền cọc",
    "cứ gửi về địa chỉ cũ nhé",
    "Chị 1m60 60kg tối chị mặc size L",
  ]) assert.equal(defers(t).defer, false, t);
});

test("Chủ đề được hẹn: nói địa chỉ → địa chỉ; nói SĐT → SĐT; nói chung chung → cả hai", () => {
  assert.deepEqual([...defers("mai chị gửi địa chỉ nha").topics], ["dia chi"]);
  assert.deepEqual([...defers("mai chị gửi sđt nha").topics], ["so dien thoai"]);
  assert.deepEqual([...defers("mai chị gửi thông tin nha").topics].sort(), ["dia chi", "so dien thoai"]);
});

test("Câu hẹn KHÔNG được lưu làm địa chỉ giao hàng (lỗi cũ: bị nhận là địa chỉ → bot xin thêm SĐT)", () => {
  const t = "Mai chị gửi địa chỉ cty nha y";
  assert.equal(looksLikeAddressStrict(t), false); // luật cũ nhận nhầm là địa chỉ; nay đã nhận ra đây không phải địa chỉ khách đưa
  const d = defers(t);
  assert.equal(d.rest.some((x) => looksLikeAddressStrict(x)), false);
  assert.equal(pickAddressFromTexts(d.rest), "");
});

test("Vừa đưa địa chỉ thật vừa hẹn gửi SĐT sau → vẫn nhận địa chỉ thật", () => {
  const d = defers("Địa chỉ 12 Nguyễn Trãi Hà Nội mai chị gửi sđt");
  assert.equal(d.defer, true);
  assert.equal(d.topics.has("so dien thoai"), true);
  assert.equal(d.rest.some((x) => looksLikeAddressStrict(x)), true);
});

test("Đưa SĐT + hẹn địa chỉ sau → giữ phần SĐT, chỉ hẹn địa chỉ", () => {
  const d = defers("SĐT 0912345678, mai chị gửi địa chỉ");
  assert.equal(d.defer, true);
  assert.deepEqual([...d.topics], ["dia chi"]);
  assert.match(d.rest.join(" "), /0912345678/);
});

test("saidLater / customerWantsLater (tin bồi) cũng hiểu câu hẹn gửi sau, kể cả có dấu ?", () => {
  assert.equal(saidLater("Mai chị gửi địa chỉ cty nha y"), true);
  assert.equal(saidLater("mai chị gửi địa chỉ được không?"), true);
  assert.equal(saidLater("Chị lấy một cái màu trắng"), false);
  const msgs = [
    { from: "bot", text: "chị cho em xin số điện thoại và địa chỉ nhận hàng để em lên đơn nhé ạ" },
    { from: "customer", text: "Mai chị gửi địa chỉ cty nha y" },
  ];
  assert.equal(customerWantsLater(msgs), true);
});

test("Bot lỡ xin lại thông tin khách đã hẹn → bỏ câu xin, giữ câu đáp lời hẹn", () => {
  const topics = new Set(["dia chi", "so dien thoai"]);
  assert.deepEqual(
    dropAsksForDeferred(["dạ vâng ạ, mai chị gửi địa chỉ công ty cho em nhé ạ", "Em xin thêm số điện thoại nữa nha chị."], topics),
    ["dạ vâng ạ, mai chị gửi địa chỉ công ty cho em nhé ạ"],
  );
  assert.deepEqual(dropAsksForDeferred(["Dạ vâng ạ. Chị cho em xin số điện thoại và địa chỉ nhận hàng nha?"], topics), ["Dạ vâng ạ."]);
  assert.deepEqual(dropAsksForDeferred(["Chị cho em xin số điện thoại và địa chỉ nhận hàng để em lên đơn nha?"], topics), []);
  // câu hỏi về màu/size không bị đụng
  assert.deepEqual(dropAsksForDeferred(["Dạ vâng ạ. Chị lấy màu nào ạ?"], topics), ["Dạ vâng ạ. Chị lấy màu nào ạ?"]);
});
