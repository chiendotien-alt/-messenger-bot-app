import test from "node:test";
import assert from "node:assert/strict";
import { pickAddressFromTexts } from "../lib/pickAddress.js";
import { looksLikeAddressStrict } from "../lib/replyDedupe.js";

// Tin khách nào là ĐỊA CHỈ nhận hàng, tin nào chỉ là câu chat bình thường (không được lưu nhầm thành địa chỉ giao hàng).
const YES = [
  "Qt tấn tài cà sáng hàm tân trà cú Trà Vinh", "Chợ gốt sã phú ngĩa hà nội", "12 ngõ 5 Trần Duy Hưng", "số 2 ngõ 5 Trần Duy Hưng Hà Nội",
  "xóm 3 thôn Đen xã Cam Hòa Hà Nam", "Hồi cù, Hoàng Sơn , nông cống, Thanh hóa", "thôn 4 xã Tân Lập huyện Đắk Mil Đắk Nông", "Cty abc 123 Nguyễn Trãi Thanh Xuân HN",
  "đc: 45 Lê Lợi, quận 1, HCM", "địa chỉ nhà chị ở 12 Phạm Văn Đồng Cầu Giấy", "Kí túc xá ĐH Bách Khoa Hà Nội", "Hẻm 25 đường 3/2 quận 10", "Tổ 5 phường Quang Trung Thái Bình",
  "số 5 ngõ 3 Kim Mã HN", "Xóm 3 thôn Đen xã Cam Hòa HP", "45 Lê Lợi quận 1 HCM", "Cty abc 123 Nguyễn Trãi HN", "Tổ 5 phường Hòa Khánh Liên Chiểu DN",
];
const NO = [
  "ở Hải Phòng ạ", "Hà Nội", "ok em", "màu đen", "Chị cao 1m6 nặng 55kg", "lấy 2 cái", "75", "để chị suy nghĩ thêm rồi nhắn lại nha", "ship về Hà Nội mấy ngày vậy em",
  "cho chị xem hàng trước khi nhận nha", "giao giờ hành chính giúp chị", "shipper gọi điện trước khi giao nhé", "bao giờ nhận được hàng em", "chị ở xa lắm", "đơn hàng của chị đâu rồi",
  "Màu đen size L dài 85cm", "freeship đúng không em", "chị lấy 1 cái màu kem, ship Hà Nội",
  "ship hn bao lâu em", "chị ở hn", "giao hn nhé", "chị lấy màu đen ship hn", "mình ở dn", "đi hp chơi", "chị cần gấp ship về hcm nhé", "lấy màu đen giao về sg giúp chị", "nhà chị ở hn", "cho chị đơn ship dn nha", "ok em ship hp", "màu đen size L ship hn",
];
for (const t of YES) test(`Là địa chỉ: "${t}"`, () => assert.ok(pickAddressFromTexts([t]), t));
for (const t of NO) test(`KHÔNG phải địa chỉ: "${t}"`, () => assert.equal(pickAddressFromTexts([t]), "", t));
test("Địa chỉ viết tắt tỉnh (HN, HCM, HP, DN, SG) được nhận", () => {
  for (const t of ["12 Lê Lợi HN", "99 Nguyễn Huệ HCM", "5 Lạch Tray HP", "7 Bạch Đằng DN"]) assert.equal(looksLikeAddressStrict(t), true, t);
});
