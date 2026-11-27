// Lỗi 27/11/2026: khách hỏi đi hỏi lại về chất vải và phí ship khi hoàn hàng; bot mỗi lần giải thích bằng một cách khác.
import test from "node:test";
import assert from "node:assert/strict";
import { repeatedConcerns, repeatConcernNote } from "../lib/repeatConcern.js";

const keys = (prev, cur) => repeatedConcerns(prev, cur).map((c) => `${c.key}:${c.count}`);

test("LỖI THẬT (chất vải): 'Vãi mềm ko zậy' → 'Chưa shop kia gởi zề vãi ko xinh' → 'Thô' đếm 1 → 2 → 3", () => {
  assert.deepEqual(keys([], ["Vãi mềm ko zậy"]), []); // lần đầu: trả lời bình thường
  assert.deepEqual(keys(["Vãi mềm ko zậy"], ["Chưa shop kia gởi zề vãi ko xinh"]), ["chat_vai:2"]);
  assert.deepEqual(keys(["Vãi mềm ko zậy", "Chưa shop kia gởi zề vãi ko xinh"], ["Thô"]), ["chat_vai:3"]);
});

test("LỖI THẬT (ship/hoàn hàng): 'C trả lại mất lòng nha' → 'Trả zề ko trả ship đâu đó' → 'Ko đc mấy 30k ship'", () => {
  const p1 = ["Cho kiểm tra hàng trước khi nhận kh"];
  assert.deepEqual(keys(p1, ["C trả lại mất lòng nha"]), ["ship_hoan:2"]);
  assert.deepEqual(keys([...p1, "C trả lại mất lòng nha"], ["Trả zề ko trả ship đâu đó"]), ["ship_hoan:3"]);
  assert.deepEqual(keys([...p1, "C trả lại mất lòng nha", "Trả zề ko trả ship đâu đó"], ["Ko đc mấy 30k ship"]), ["ship_hoan:4"]);
});

test("KHÔNG kích hoạt: lần đầu, chuyện khác, 'vài ngày', khách đã chuyển chủ đề", () => {
  assert.deepEqual(keys([], ["Có kiểm tra hàng trước khi nhận kh"]), []);
  assert.deepEqual(keys(["Vãi mềm ko zậy"], ["Lấy màu đen"]), []);
  assert.deepEqual(keys(["Vãi mềm ko zậy"], ["Vài ngày nữa mình nhận hàng"]), []);
  assert.deepEqual(keys(["Vãi mềm ko zậy", "Thô"], ["Cao 1m50 nặng 53kg"]), []); // lượt này không nhắc mối lo nào
});

test("size vừa không: khách lo 2 lần thì đếm; chủ đề ship KHÔNG lẫn vào", () => {
  assert.deepEqual(keys(["M sợ k vừa ruigf", "M eo 100 bạn ơi"], ["2xl sợ vẫn chật ý"]), ["size_vua:2"]);
});

test("lời dặn: chủ đề khách ĐÒI (ship) được 'Dạ vâng', chủ đề khách CHÊ (vải) thì KHÔNG đáp 'vâng'", () => {
  const ship = repeatConcernNote(repeatedConcerns(["C trả lại mất lòng nha"], ["Ko đc mấy 30k ship"]));
  assert.match(ship, /Dạ vâng,/);
  assert.match(ship, /miễn phí hoàn toàn.*khi Nội dung/);
  const vai = repeatConcernNote(repeatedConcerns(["Vãi mềm ko zậy"], ["Thô"]));
  assert.match(vai, /KHÔNG đáp "vâng"/);
  assert.equal(repeatConcernNote([]), "");
});
