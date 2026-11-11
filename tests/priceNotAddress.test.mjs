import test from "node:test";
import assert from "node:assert/strict";
import { looksLikeAddressStrict } from "../lib/replyDedupe.js";
import { pickAddressFromTexts } from "../lib/pickAddress.js";

test("giá / số lượng không phải địa chỉ", () => {
  for (const t of ["195k miễn ship à", "2 lớp đều tơ lụa", "195 k bớt ko nếu OK mua cho hội lớp", "3 cái được giảm không", "200k bớt không shop", "2 lop deu to lua", "2 váy 300k nhé", "2 vay 300k nhe", "1 váy 150k nha chị", "bớt 20k được không"]) {
    assert.equal(looksLikeAddressStrict(t), false, t);
    assert.equal(pickAddressFromTexts([t]), "", t);
  }
});

test("địa chỉ thật vẫn nhận", () => {
  for (const t of ["12 Nguyễn Trãi Hà Nội", "số 5 ngõ 20 Láng Hạ", "45 Lê Lợi Quận 1 TP HCM"]) {
    assert.equal(looksLikeAddressStrict(t), true, t);
  }
});

test("AI chính đã trả lời: chỉ nhận tin có dấu hiệu địa chỉ rõ ràng", async () => {
  const { hasClearAddressSignal } = await import("../lib/replyDedupe.js");
  const { addressInTexts } = await import("../lib/contactGiven.js");
  const strict = { requireClearSignal: true };
  for (const t of ["195k miễn ship à", "2 lớp đều tơ lụa", "12 Hoa Hồng Thanh Xuân"]) {
    assert.equal(pickAddressFromTexts([t], strict), "", t);
    assert.equal(addressInTexts([t], "", strict), false, t);
  }
  for (const t of ["12 Nguyễn Trãi Hà Nội", "số 5 ngõ 20 Láng Hạ", "xóm 3 thôn Đông xã Tân Lập"]) {
    assert.equal(hasClearAddressSignal(t), true, t);
    assert.notEqual(pickAddressFromTexts([t], strict), "", t);
    assert.equal(addressInTexts([t], "", strict), true, t);
  }
});

test("AI dự phòng Groq: luật cũ vẫn giữ (không bắt buộc dấu hiệu rõ ràng)", () => {
  assert.equal(pickAddressFromTexts(["12 Hoa Hồng Thanh Xuân"]), "12 Hoa Hồng Thanh Xuân");
});

test("tin trộn giá + địa chỉ: chỉ lấy phần địa chỉ", async () => {
  const { addressInTexts } = await import("../lib/contactGiven.js");
  const strict = { requireClearSignal: true };
  assert.equal(pickAddressFromTexts(["2 váy 350k ship về 12 Nguyễn Trãi Hà Nội"]), "12 Nguyễn Trãi Hà Nội");
  assert.equal(pickAddressFromTexts(["2 váy 350k giao về xã Hoài Đức Hà Nội"], strict), "xã Hoài Đức Hà Nội");
  assert.equal(pickAddressFromTexts(["1 váy đen 195k về Thuận Thành Bắc Ninh"], strict), "Thuận Thành Bắc Ninh");
  assert.equal(addressInTexts(["1 váy đen 195k về Thuận Thành Bắc Ninh"], "", strict), true);
  // không có dấu hiệu địa chỉ rõ ràng → để AI tự điền, hệ thống không đoán
  assert.equal(pickAddressFromTexts(["2 váy 350k về âu cơ thuận thành"], strict), "");
});
