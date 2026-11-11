import test from "node:test";
import assert from "node:assert/strict";
import { customerWantsLater, customerWantsLaterRecently } from "../lib/laterStop.js";

const C = (text) => ({ from: "customer", text });
const B = (text) => ({ from: "bot", text });

test("khách hẹn tham khảo thêm rồi hỏi chuyện khác (câu thật từ log): không bồi", () => {
  const recent = [
    B("Dạ chị nặng 52kg thì mặc size M ạ."),
    B("Chị cho em xin số điện thoại và địa chỉ nhận hàng để em lên đơn ạ?"),
    C("Chờ chị một chút chị tham khảo thêm rồi chị gửi"),
    B("dạ vâng ạ, khi nào tiện chị gửi em nhé ạ"),
    C("Chất liệu vải gì vậy"),
    B("Dạ váy bên em sử dụng chất vải tơ lụa mềm mại, không nhăn và bên trong có lớp lót bảo vệ ạ."),
  ];
  assert.equal(customerWantsLater(recent), false); // cách cũ chỉ xét tin cuối → bỏ sót
  assert.equal(customerWantsLaterRecently(recent), true);
});

test("khách không hẹn gì → vẫn bồi như cũ", () => {
  const recent = [
    B("Chị cho em xin số điện thoại và địa chỉ nhận hàng để em lên đơn ạ?"),
    C("Chất liệu vải gì vậy"),
    B("Dạ váy bên em sử dụng chất vải tơ lụa mềm mại ạ."),
  ];
  assert.equal(customerWantsLaterRecently(recent), false);
});

test("tin hẹn của BOT không tính, tin khách có dấu ? không tính", () => {
  assert.equal(customerWantsLaterRecently([B("chị cứ tham khảo thêm nha"), C("váy này có màu gì?")]), false);
});

test("khách hẹn hỏi bé / người nhà rồi mới đặt (câu thật từ log) → tính là hẹn, không bồi", async () => {
  const { saidLater } = await import("../lib/laterStop.js");
  const { analyzeHesitation } = await import("../lib/hesitate.js");
  for (const t of ["Để mình hỏi bé thích ko rồi đặt mua như!", "Để mình hỏi bé thích không rồi đặt mua nhé", "để mình hỏi ý kiến bé rồi đặt", "để chị hỏi người yêu đã", "để mình hỏi bạn gái thích không rồi mua"]) {
    assert.equal(saidLater(t), true, t);
    assert.equal(analyzeHesitation([t]).kind, "defer", t);
  }
  const recent = [B("Chân váy bên em có 8 màu không biết chị chọn được màu nào chưa ạ ?"), C("Để mình hỏi bé thích ko rồi đặt mua như!"), B("Dạ vâng ạ, khi nào tiện chị nhắn em nhé ạ.")];
  assert.equal(customerWantsLater(recent), true);
});

test("câu hỏi bình thường về bé / size / giá KHÔNG bị coi là hẹn", async () => {
  const { saidLater } = await import("../lib/laterStop.js");
  const { analyzeHesitation } = await import("../lib/hesitate.js");
  for (const t of ["cho mình hỏi bé 5 tuổi mặc size nào", "mình hỏi bé gái 20kg mặc size gì", "Để mình hỏi size rồi đặt", "để mình hỏi giá rồi đặt mua", "hỏi bé nặng 20kg lấy size mấy"]) {
    assert.equal(saidLater(t), false, t);
    assert.notEqual(analyzeHesitation([t]).kind, "defer", t);
  }
});
