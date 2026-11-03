import test from "node:test";
import assert from "node:assert/strict";
import { productAttributes, attributeStatus, summaryDetail, fixTypos } from "../lib/attributes.js";
import { deriveOrderFacts } from "../lib/orderFacts.js";
import { buildSummaryText } from "../lib/priceLadder.js";

const B = (text) => ({ from: "bot", text });
const C = (text) => ({ from: "customer", text });
const product = {
  name: "Chân váy 3 tầng",
  description: "Chân váy 3 tầng, miễn phí ship",
  priceLadder: [
    { qty: 1, list: "185k", steps: "", floor: "185k" },
    { qty: 2, list: "350k", steps: "", floor: "350k" },
  ],
  attributes: [
    { name: "Màu", values: "Trắng, Đen, Kem, Vàng, Xanh, Hồng, Đỏ đô, Cam Đất", how: "" },
    { name: "Size", values: "S, M, L, XL, 2XL", how: "theo chiều cao cân nặng" },
    { name: "Chiều dài váy", values: "75cm, 85cm, 92cm", how: "theo chiều cao" },
  ],
};
const attrs = productAttributes(product);
const ask = [B("Chân váy bên em có 8 màu không biết chị chọn được màu nào chưa ạ ?")];
const status = (text, hist = ask) => attributeStatus(attrs, hist, [text], "");
const lineOf = (it) => [...it.parts, `SL:${it.qty}`].join(", ");

const REAL = "Cho 1 chân váy màu kem chiêu dài 75cm sai  m.   1 váy màu  chắng dài 92 cm sai xl"; // đúng tin trong ảnh chụp chat

test("Sửa lỗi gõ: 'sai m' = size M, 'chắng' = trắng; câu bình thường không bị đổi", () => {
  assert.equal(fixTypos("kem 75cm sai m"), "kem 75cm size m");
  assert.equal(fixTypos("sai xl"), "size xl");
  assert.equal(fixTypos("màu chắng"), "màu trắng");
  assert.equal(fixTypos("màu sanh"), "màu xanh");
  for (const t of ["sai rồi chị ạ", "sai mà", "em gửi sai size", "chị mặc sai size nha", "sai sót"]) assert.equal(fixTypos(t), t, t);
});

test("Lỗi thật: khách đặt 2 váy KHÁC NHAU (có gõ sai) → nhận đủ 2 món, mỗi món đúng cặp màu/size/dài", () => {
  const st = status(REAL);
  assert.equal(st.items.length, 2);
  assert.equal(lineOf(st.items[0]), "Màu kem, size M, dài 75cm, SL:1");
  assert.equal(lineOf(st.items[1]), "Màu trắng, size XL, dài 92cm, SL:1");
});

test("Nhắn đúng chính tả cũng ra đúng 2 món", () => {
  for (const t of [
    "Cho 1 chân váy màu kem dài 75cm size M, 1 váy màu trắng dài 92cm size XL",
    "1 váy kem 75cm size M\n1 váy trắng 92cm size XL",
    "lấy 2 váy: 1 màu kem dài 75 size M và 1 màu trắng dài 92 size XL",
  ]) {
    const st = status(t);
    assert.deepEqual(st.items.map(lineOf), ["Màu kem, size M, dài 75cm, SL:1", "Màu trắng, size XL, dài 92cm, SL:1"], t);
  }
});

test("Đơn lưu / tin báo đơn: SL:2, 350k, mỗi váy một dòng (không còn 1 váy 185k)", () => {
  const messages = [
    ...ask,
    C(REAL),
    B("Dạ em đã ghi nhận 2 chân váy gồm 1 váy màu kem dài 75cm size M và 1 váy màu trắng dài 92cm size XL ạ."),
    B("Chị cho em xin số điện thoại và địa chỉ nhận hàng để em lên đơn nhé ạ."),
    C("0972114816"),
    B("dạ em xin thêm địa chỉ nhận hàng để em lên đơn giao cho chị ạ."),
    C("Chợ gốt sã phú ngĩa hà nội"),
  ];
  const f = deriveOrderFacts({ product, messages });
  assert.equal(f.quantity, 2);
  assert.equal(f.dealTotal, 350000);
  assert.equal(f.qtySource, "items");
  assert.deepEqual(f.lines, [
    { color: "Kem", specs: ["size M", "dài 75cm"], qty: 1 },
    { color: "Trắng", specs: ["size XL", "dài 92cm"], qty: 1 },
  ]);
  assert.deepEqual(f.issues, []);
  const text = buildSummaryText({ product, ctx: f.ctx, info: { phone: "0972114816", address: "Chợ Gốt, xã Phú Nghĩa, Hà Nội" }, detail: f.detail, hintQty: f.hintQty, bare: true });
  assert.match(text, /Màu kem, size M, dài 75cm, SL:1\nMàu trắng, size XL, dài 92cm, SL:1\nTổng tiền: 350k \(freeship\)/);
  // khách nhắn tiếp "2 cái mà" → vẫn đúng 2 cái, không báo mâu thuẫn
  const f2 = deriveOrderFacts({ product, messages: [...messages, C("2 cái mà")] });
  assert.equal(f2.quantity, 2);
  assert.equal(f2.dealTotal, 350000);
  assert.deepEqual(f2.issues, []);
});

test("Đơn 1 váy vẫn như cũ (1 dòng, giá 1 váy)", () => {
  const messages = [...ask, C("Cho 1 váy màu kem dài 75cm size M"), C("0972114816 Hà Nội")];
  const f = deriveOrderFacts({ product, messages });
  assert.equal(f.quantity, 1);
  assert.equal(f.dealTotal, 185000);
  assert.equal(f.detail.items, undefined);
});

test("Không đoán bừa: món thiếu thông tin, nhiều giá trị, hoặc chỉ 1 món → dùng luồng cũ (không có items)", () => {
  for (const t of [
    "1 váy màu kem, 1 cái size M", // món 1 chỉ có màu, món 2 chỉ có size
    "1 váy màu đen hoặc trắng, 1 váy size M", // mơ hồ
    "lấy 2 váy màu đen và xanh", // 1 điểm bắt đầu → luồng cũ (màu đen + xanh, SL:2)
    "Chị cao 1m60 nặng 50kg lấy 1 váy size M",
  ]) assert.equal(status(t).items, null, t);
});

test("Hai màu cho 2 váy kiểu cũ vẫn chạy: 'lấy 2 váy màu đen và xanh' → Màu đen + xanh, SL:2", () => {
  const st = status("lấy 2 váy màu đen và xanh size M dài 75cm");
  const d = summaryDetail(st, 2);
  assert.equal(d.items, undefined);
  assert.equal(d.colors.length, 2);
});

test("Khách nhắn tiếp ĐỔI / THÊM món thì không dùng danh sách món cũ (tránh ghi sai đơn)", () => {
  const first = [...ask, C(REAL)];
  const changed = attributeStatus(attrs, [...first, B("Dạ vâng ạ")], ["đổi cái trắng thành màu đen nha"], "");
  assert.equal(changed.items, null);
  const more = attributeStatus(attrs, [...first, B("Dạ vâng ạ")], ["lấy thêm 1 cái nữa"], "");
  assert.equal(more.items, null);
  const same = attributeStatus(attrs, [...first, B("Dạ vâng ạ")], ["2 cái mà"], "");
  assert.equal(same.items.length, 2);
});

test("Hai món cùng màu nhưng khác size/dài vẫn tách thành 2 dòng", () => {
  const st = status("1 váy màu kem dài 75cm size M, 1 váy màu kem dài 85cm size L");
  assert.deepEqual(st.items.map(lineOf), ["Màu kem, size M, dài 75cm, SL:1", "Màu kem, size L, dài 85cm, SL:1"]);
  const d = summaryDetail(st, 2);
  assert.equal(d.colors.length, 1);
  assert.equal(d.colors[0].qty, 2);
});
