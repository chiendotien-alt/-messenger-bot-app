import test from "node:test";
import assert from "node:assert/strict";
import { productAttributes, attributeStatus, colorCount } from "../lib/attributes.js";
import { readOrder, explicitTotalQty } from "../lib/orderItems.js";

const B = (text) => ({ from: "bot", text });
const product = {
  name: "Chân váy 3 tầng", description: "x",
  priceLadder: [{ qty: 1, list: "195k", steps: "", floor: "195k" }, { qty: 2, list: "360k", steps: "", floor: "360k" }],
  attributes: [
    { name: "Màu", values: "Trắng, Đen, Kem, Vàng, Xanh, Hồng, Đỏ đô, Cam Đất", how: "" },
    { name: "Size", values: "S, M, L, XL, 2XL", how: "theo chiều cao cân nặng" },
    { name: "Chiều dài váy", values: "75cm, 85cm, 92cm", how: "theo chiều cao" },
  ],
};
const attrs = productAttributes(product);
const ask = [B("Chân váy bên em có 8 màu không biết chị chọn được màu nào chưa ạ ?")];
const colors = (text) => attributeStatus(attrs, ask, [text], "").list[0];

test("'2 cái màu kem vs màu hồng' = 2 cái tổng, mỗi màu 1 (câu thật của khách)", () => {
  const x = colors("Lấy e 2 cái màu kem vs màu hồng Ak");
  assert.deepEqual(x.qtys, { Hồng: 1, Kem: 1 });
  assert.equal(colorCount(attributeStatus(attrs, ask, ["Lấy e 2 cái màu kem vs màu hồng Ak"], "")), 2);
});

test("khách ghi số riêng từng màu thì giữ nguyên", () => {
  assert.deepEqual(colors("lấy 2 cái màu kem và 1 màu hồng").qtys, { Hồng: 1, Kem: 2 });
  assert.deepEqual(colors("2 trắng 1 vàng").qtys, { Trắng: 2, Vàng: 1 });
  assert.deepEqual(colors("1 đen 1 trắng").qtys, { Đen: 1, Trắng: 1 });
});

test("explicitTotalQty: chỉ nhận khi có đúng một con số kèm đơn vị", () => {
  assert.equal(explicitTotalQty(["Lấy e 2 cái màu kem vs màu hồng Ak"]), 2);
  assert.equal(explicitTotalQty(["lấy 2 cái màu kem và 1 màu hồng"]), 0);
  assert.equal(explicitTotalQty(["em nặng 52kg cao 1m6 lấy màu kem"]), 0);
  assert.equal(explicitTotalQty(["0375731628", "Khu công nghiệp Tam thăng xã Tam thăng tp Tam Kỳ Ak"]), 0);
});

test("AI đọc kem x2 + hồng x1 (tổng 3) trong khi khách nói 2 cái → sửa thành mỗi màu 1 cái", () => {
  const text = "Lấy e 2 cái màu kem vs màu hồng Ak";
  const shop = "Dạ chị nặng 52kg thì mặc size M, chiều dài váy 75cm vừa đẹp nha chị.";
  const st = attributeStatus(attrs, [B(shop), ...ask], [text], "");
  const aiRaw = [
    { qty: 2, values: { Màu: "Kem", Size: "M", "Chiều dài váy": "75cm" } },
    { qty: 1, values: { Màu: "Hồng", Size: "M", "Chiều dài váy": "75cm" } },
  ];
  const r = readOrder({ attrs, status: st, aiRaw, customerTexts: [text], shopTexts: [shop], sysQty: Math.max(2, colorCount(st)) });
  assert.equal(r.verdict, "agree");
  assert.deepEqual(r.final.map((it) => it.qty), [1, 1]);
});

test("khách nói rõ 2 kem + 1 hồng thì AI ghi tổng 3 là đúng, không bị sửa", () => {
  const text = "lấy 2 cái màu kem và 1 màu hồng";
  const st = attributeStatus(attrs, ask, [text], "");
  const aiRaw = [{ qty: 2, values: { Màu: "Kem" } }, { qty: 1, values: { Màu: "Hồng" } }];
  const r = readOrder({ attrs, status: st, aiRaw, customerTexts: [text], shopTexts: [], sysQty: colorCount(st) });
  assert.ok(!r.final || r.final.reduce((n, it) => n + it.qty, 0) === 3);
});
