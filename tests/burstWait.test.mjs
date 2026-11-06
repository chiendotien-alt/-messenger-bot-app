import test from "node:test";
import assert from "node:assert/strict";
import { isLongMessage, burstWaitApplies } from "../lib/shortMessage.js";

const LONG = "Chị cao 1m60 nặng 55kg mặc váy dài bao nhiêu";

test("tin dài (>= 5 chữ) không chờ gom dù khách nhắn dồn hoặc vừa được bot trả lời", () => {
  assert.equal(isLongMessage(LONG), true);
  assert.equal(burstWaitApplies({ text: LONG, pendCount: 3, outAgeMs: 2000 }), false);
  assert.equal(burstWaitApplies({ text: LONG, pendCount: 1, outAgeMs: 2000 }), false);
});

test("tin ngắn vẫn chờ gom khi nhắn dồn hoặc bot vừa trả lời", () => {
  assert.equal(burstWaitApplies({ text: "1m60", pendCount: 2, outAgeMs: null }), true);
  assert.equal(burstWaitApplies({ text: "size M", pendCount: 1, outAgeMs: 3000 }), true);
});

test("tin ngắn, không nhắn dồn, bot trả lời đã lâu → không chờ", () => {
  assert.equal(burstWaitApplies({ text: "size M", pendCount: 1, outAgeMs: 60000 }), false);
  assert.equal(burstWaitApplies({ text: "size M", pendCount: 1, outAgeMs: null }), false);
});

test("tin dài kèm ảnh vẫn theo luật cũ (không miễn chờ)", () => {
  assert.equal(isLongMessage(LONG, true), false);
  assert.equal(burstWaitApplies({ text: LONG, hasImages: true, pendCount: 2 }), true);
});

test("đúng ngưỡng: 4 chữ là ngắn, 5 chữ là dài", () => {
  assert.equal(isLongMessage("giá sao vậy shop"), false);
  assert.equal(isLongMessage("giá sao vậy shop ơi"), true);
});
