import test from "node:test";
import assert from "node:assert/strict";
import { aiSaysNotAddress } from "../lib/addressNet.js";
import { addressInTexts } from "../lib/contactGiven.js";

test("AI ghi tình huống là hỏi giá/ship/chất vải/lo lắng → không tự nhặt địa chỉ (câu thật từ log)", () => {
  for (const t of [
    "khách hỏi xác nhận giá và phí ship, shop xác nhận đúng thông tin giá 195k kèm miễn phí ship theo đúng nội dung sản phẩm",
    "Khách hỏi lại chất vải của lớp lót vày. Trả lời đúng chất vải tơ lụa mềm mại, không lặp lại ý trước.",
    "khach hoi ve chat lieu lop lot cua chan vay, shop can tra loi dung thong tin, co chu ngu vi ngu va ket thuc bang 'a'",
    "khách lo lắng về việc kiểm tra hàng và thanh toán, cần trấn an ngắn gọn và lịch sự",
    "khách hỏi lại chất liệu và giá, cần báo rõ chất tơ lụa và bảng giá niêm yết",
  ]) assert.equal(aiSaysNotAddress(t), true, t);
});

test("AI nói khách đưa địa chỉ/SĐT/chốt đơn, hoặc không ghi gì → lưới an toàn vẫn chạy", () => {
  for (const t of [
    "",
    undefined,
    "khách đưa địa chỉ giao hàng, shop xin thêm số điện thoại",
    "khách chốt đơn 1 váy size M",
    "khách hỏi giá và đưa địa chỉ",
    "khách đưa số điện thoại, hỏi ship",
    "Khách gửi 12 Nguyễn Trãi Hà Nội",
  ]) assert.equal(aiSaysNotAddress(t), false, String(t));
});

test("ruleOff: bỏ luật đoán mẫu chữ, chỉ tính địa chỉ AI đã trích", () => {
  assert.equal(addressInTexts(["12 Nguyễn Trãi Hà Nội"], "", { ruleOff: true }), false);
  assert.equal(addressInTexts(["12 Nguyễn Trãi Hà Nội"], "12 Nguyễn Trãi, Hà Nội", { ruleOff: true }), true);
  assert.equal(addressInTexts(["12 Nguyễn Trãi Hà Nội"], ""), true);
});
