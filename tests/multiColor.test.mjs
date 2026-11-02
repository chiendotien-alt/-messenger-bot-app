import test from "node:test";
import assert from "node:assert/strict";
import { productAttributes, attributeStatus, summaryDetail, colorCount } from "../lib/attributes.js";
import { buildSummaryText } from "../lib/priceLadder.js";

const B = (text) => ({ from: "bot", text });
const C = (text) => ({ from: "customer", text });
const product = {
  name: "Chân váy 3 tầng",
  description: "Chân váy 3 tầng, miễn phí ship",
  attributes: [
    { name: "Màu", values: "Trắng, Đen, Kem, Vàng, Xanh, Hồng, Đỏ đô, Cam Đất", how: "" },
    { name: "Size", values: "S, M, L, XL, 2XL", how: "theo chiều cao cân nặng" },
    { name: "Chiều dài váy", values: "75cm, 85cm, 92cm", how: "theo chiều cao" }, // tên có chữ "váy" trùng tên sản phẩm
  ],
};
const attrs = productAttributes(product);
const colorOf = (st) => st.list[0].picked.slice().sort();
const history = [
  B("Dạ chân váy bên em có các màu trắng, đen, kem, vàng, xanh, hồng, đỏ đô và cam đất ạ"),
  C("Chị cao 1m45 nặng 43 kg"),
  B("Dạ chị cao 1m45 nặng 43kg thì mình mặc size S và lấy chân váy dài 75cm là vừa đẹp ạ."),
  B("Chị lấy chân váy màu nào ạ?"),
];
const ORDER_MSG = "Chốt chị 2 váy =380 miễn phí ( màu đen và xanh ) Sđt  0974161328 . Hồi cù, Hoàng Sơn , nông cống, Thanh hóa";

test("Lỗi thật: khách chốt '2 váy (màu đen và xanh)' kèm SĐT → nhận ĐỦ 2 màu, không chỉ màu đen", () => {
  const st = attributeStatus(attrs, history, [ORDER_MSG], "");
  assert.deepEqual(colorOf(st), ["Xanh", "Đen"].sort());
  const d = summaryDetail(st, 2);
  assert.equal(d.colors.length, 2);
  assert.deepEqual(d.colors.map((c) => c.qty), [1, 1]);
  assert.ok(d.specs.includes("size S") && d.specs.includes("dài 75cm"));
});

test("Tin báo đơn ghi đúng 2 màu và SL:2 (không còn 'Màu đen, SL:2')", () => {
  const st = attributeStatus(attrs, history, [ORDER_MSG], "");
  const detail = summaryDetail(st, 2);
  const text = buildSummaryText({
    product,
    ctx: { row: { qty: 2 }, qty: 2, dealTotal: 380000 },
    info: { phone: "0974161328", address: "Hồi Cù, Hoàng Sơn, Nông Cống, Thanh Hóa" },
    detail,
    bare: true,
  });
  assert.match(text, /Màu xanh \+ đen, size S, dài 75cm, SL:2/);
  assert.match(text, /Tổng tiền: 380k/);
  assert.doesNotMatch(text, /Màu đen, size S, dài 75cm, SL:2/);
});

test("Chữ 'váy' trong tên thuộc tính 'Chiều dài váy' không làm bot tưởng đang hỏi chiều dài khi shop hỏi 'chân váy màu nào'", () => {
  const long = attrs[2];
  assert.deepEqual(long.generic, ["vay"]);
  assert.deepEqual(attrs[0].generic, []);
  // shop hỏi màu → khách trả lời màu (không bị bắt buộc phải có chữ 'màu')
  const st = attributeStatus(attrs, [B("Chị lấy chân váy màu nào ạ?")], ["trắng và đen nhé, sđt 0912345678 Hải Phòng"], "");
  assert.deepEqual(colorOf(st), ["Trắng", "Đen"].sort());
});

test("Tên thuộc tính chỉ có 1 từ trùng tên sản phẩm thì giữ nguyên (không bị bỏ từ)", () => {
  const a = productAttributes({ name: "Váy xòe", attributes: [{ name: "Váy", values: "Ngắn, Dài", how: "" }] });
  assert.deepEqual(a[0].generic, []);
});

test("Liệt kê màu trong tin có SĐT/địa chỉ: 'màu đen, trắng và kem', 'màu đen + cam đất'", () => {
  const cases = [
    ["lấy màu đen, trắng và kem sdt 0912345678 số 5 ngõ 3 Lê Lợi Hà Nội", ["Trắng", "Đen", "Kem"]],
    ["màu đen + cam đất sdt 0912345678 Hà Nội", ["Đen", "Cam Đất"]],
    ["lấy 2 váy màu trắng và đen nhé sđt 0912345678 Hải Phòng", ["Trắng", "Đen"]],
  ];
  for (const [msg, want] of cases) {
    const st = attributeStatus(attrs, [B("Dạ vâng ạ")], [msg], "");
    assert.deepEqual(colorOf(st), want.slice().sort(), msg);
  }
});

test("Tên đường / tên người trong địa chỉ KHÔNG bị đọc thành màu (màu đen, Lê Hồng Phong → chỉ Đen)", () => {
  for (const msg of ["màu đen, Lê Hồng Phong sđt 0912345678 quận 5 HCM", "màu đen sđt 0912345678 Nguyễn Thị Hồng, Cam Ranh Khánh Hòa"]) {
    const st = attributeStatus(attrs, [B("Dạ vâng ạ")], [msg], "");
    assert.deepEqual(colorOf(st), ["Đen"], msg);
  }
});

test("2 màu thì số lượng tối thiểu của đơn là 2 (bảng giá tính theo 2 cái)", () => {
  const st = attributeStatus(attrs, history, [ORDER_MSG], "");
  assert.equal(colorCount(st), 2);
});
