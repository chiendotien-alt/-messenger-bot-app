// Hỏi bồi: khách đã nói số đo kiểu lạ (quy tắc bỏ sót) và AI đã ghi nhận → KHÔNG hỏi lại chiều cao / cân nặng.
import test from "node:test";
import assert from "node:assert/strict";
import { composeNudge } from "../lib/nudge.js";

const dress = { id: "1", name: "Chân váy xếp ly", description: "Váy xếp ly màu đen, kem, vàng. Size S M L.", notes: "", attributes: [] };
const dressAttr = { ...dress, attributes: [{ name: "Màu", values: "Đen, Kem", how: "" }, { name: "Size", values: "S, M, L", how: "theo chiều cao cân nặng" }] };
const C = (t) => ({ from: "customer", text: t });
const B = (t) => ({ from: "bot", text: t });

async function nudge(msgs, info = {}, product = dress) {
  const io = {
    getRecentMessages: async () => msgs,
    getCustomerInfo: async () => info,
    getRecentOutgoingWithAge: async () => msgs.filter((m) => m.from === "bot").map((m) => ({ text: m.text, ageMs: 200000 })).reverse(),
    getCustomerName: async () => "Lan",
    askGeminiJson: async () => "",
  };
  const r = await composeNudge({ id: "c", name: "Lan", pageId: "p", productId: "1", hasPhone: false }, [], [], [product], "", 5000, io);
  return r.message || "";
}
const asksBody = (m) => /chiều cao|cân nặng|chieu cao|can nang/i.test(m);
const askH = "dạ còn ạ, chị cho em xin chiều cao cân nặng để em chọn size nha?";

test("Khách gõ 'cn 50 cc 155', AI chỉ đáp 'dạ nhận rồi ạ' + đã báo nhận số đo → bồi KHÔNG hỏi lại", async () => {
  const msgs = [C("váy này còn ko"), B(askH), C("cn 50 cc 155"), B("dạ em nhận thông tin rồi ạ")];
  assert.equal(asksBody(await nudge(msgs, { body: "height,weight" })), false);
});

test("Khách gõ 'cao 1m55 nặg 5o kg', AI đã báo nhận cân nặng → bồi không hỏi lại cân nặng", async () => {
  const msgs = [C("váy này còn ko"), B(askH), C("cao 1m55 nặg 5o kg"), B("dạ vâng ạ")];
  assert.equal(asksBody(await nudge(msgs, { body: "weight" })), false);
});

test("AI mới báo nhận chiều cao → bồi chỉ hỏi nốt cân nặng, không hỏi lại chiều cao", async () => {
  const msgs = [C("váy này còn ko"), B(askH), C("mình cao mét năm lăm"), B("dạ vâng ạ")];
  const m = await nudge(msgs, { body: "height" });
  assert.match(m, /cân nặng/i);
  assert.doesNotMatch(m, /chiều cao/i);
});

test("Chưa có tín hiệu AI mà quy tắc cũng bỏ sót → vẫn hỏi lại như cũ (giữ nguyên hành vi)", async () => {
  const msgs = [C("váy này còn ko"), B(askH), C("cn 50 cc 155"), B("dạ em nhận thông tin rồi ạ")];
  assert.equal(asksBody(await nudge(msgs, {})), true);
});

test("Khách gõ chuẩn 'cao 1m55 nặng 50kg' → không hỏi lại (không phụ thuộc tín hiệu AI)", async () => {
  const msgs = [C("váy này còn ko"), B(askH), C("cao 1m55 nặng 50kg"), B("dạ vâng ạ")];
  assert.equal(asksBody(await nudge(msgs, {})), false);
});

test("Sản phẩm có bảng thuộc tính: AI đã báo nhận số đo → bồi không hỏi lại chiều cao cân nặng", async () => {
  const msgs = [C("váy này còn ko"), B("dạ còn ạ, chị lấy màu nào ạ, chị cho em xin chiều cao cân nặng để em chọn size nha?"), C("màu kem, cn 50 cc 155"), B("dạ vâng ạ")];
  assert.equal(asksBody(await nudge(msgs, { body: "height,weight", variant: "Màu Kem" }, dressAttr)), false);
});

test("Sản phẩm có bảng thuộc tính: chưa có tín hiệu AI → vẫn hỏi lại số đo như cũ", async () => {
  const msgs = [C("váy này còn ko"), B("dạ còn ạ, chị lấy màu nào ạ, chị cho em xin chiều cao cân nặng để em chọn size nha?"), C("màu kem, cn 50 cc 155"), B("dạ vâng ạ")];
  assert.equal(asksBody(await nudge(msgs, { variant: "Màu Kem" }, dressAttr)), true);
});
