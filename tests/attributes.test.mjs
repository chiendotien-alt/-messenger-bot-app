// Chạy: node --import ./tests/register.mjs --test tests/
import test from "node:test";
import assert from "node:assert/strict";
import { productAttributes, attributeStatus, composeVariant, summaryDetail, confirmItems, buildConfirmAsk, sanitizeVariant } from "../lib/attributes.js";

const product = {
  name: "Chân váy 3 tầng",
  attributes: [
    { name: "Màu", values: "Đen + kem, Đen, Kem, Trắng, Hồng, Xanh, Vàng, Nâu", how: "" },
    { name: "Size", values: "S, M, L", how: "theo chiều cao cân nặng" },
    { name: "Chiều dài", values: "75cm, 85cm, 92cm", how: "theo chiều cao" },
  ],
};
const attrs = productAttributes(product);
const base = [
  { from: "customer", text: "Chân váy bên em có 8 màu không biết chị chọn được màu nào chưa ạ?" },
  { from: "bot", text: "Dạ chị cho em xin chiều cao cân nặng để em chọn váy nha." },
  { from: "customer", text: "S nhỏ nhất." },
  { from: "bot", text: "Dạ chị chọn size S, thế chị cao tầm mét mấy ạ?" },
];
const by = (st, name) => st.list.find((x) => x.attr.name === name);
const askText = "Dạ chiều dài bên em có 75cm, 85cm và 92cm ạ. Ý chị là chọn chiều dài 75cm đúng không chị?";

test("A: 70cm không thuộc danh sách → hỏi xác nhận, không ghi nhận 70cm", () => {
  const st = attributeStatus(attrs, base, ["70cm"], "");
  const len = by(st, "Chiều dài");
  assert.equal(len.state, "confirm");
  assert.equal(len.pending.suggested, "75cm");
  assert.equal(len.fresh, true);
  assert.equal(composeVariant(st).includes("70"), false);
  assert.equal(composeVariant(st).includes("75"), false); // chưa chốt 75cm
  assert.equal(summaryDetail(st).specs.some((x) => /75|70/.test(x)), false);
  assert.equal(buildConfirmAsk(len, { kh: "chị", tu: "em" }), askText);
});

test("B: khách xác nhận 'Đúng rồi' → lưu 75cm và giữ xuyên suốt", () => {
  const hist = [...base, { from: "customer", text: "70cm" }, { from: "bot", text: askText }];
  for (const yes of ["Đúng rồi", "ok", "dạ đúng"]) {
    const st = attributeStatus(attrs, hist, [yes], "");
    assert.equal(by(st, "Chiều dài").state, "chosen", yes);
    assert.deepEqual(by(st, "Chiều dài").picked, ["75cm"]);
  }
  // tin tiếp theo (màu, SĐT...) không làm mất lựa chọn
  const h2 = [...hist, { from: "customer", text: "Đúng rồi" }, { from: "bot", text: "Dạ chị chọn màu nào ạ?" }, { from: "customer", text: "màu đen" }];
  const st2 = attributeStatus(attrs, h2, ["0912345678"], "");
  assert.deepEqual(by(st2, "Chiều dài").picked, ["75cm"]);
  assert.ok(composeVariant(st2).includes("75cm"));
});

test("C: khách từ chối 75cm và chọn 85cm → cập nhật 85cm", () => {
  const hist = [...base, { from: "customer", text: "70cm" }, { from: "bot", text: askText }];
  for (const t of ["Không, chị muốn 85cm", "không, 85", "ko chị lấy 85cm"]) {
    const st = attributeStatus(attrs, hist, [t], "");
    assert.equal(by(st, "Chiều dài").state, "chosen", t);
    assert.deepEqual(by(st, "Chiều dài").picked, ["85cm"], t);
  }
});

test("C2: khách chỉ nói 'không' → bỏ gợi ý 75cm, hỏi lại, không tự chốt", () => {
  const hist = [...base, { from: "customer", text: "70cm" }, { from: "bot", text: askText }];
  const st = attributeStatus(attrs, hist, ["không"], "");
  assert.equal(by(st, "Chiều dài").state, "missing");
  assert.equal(composeVariant(st).includes("75"), false);
});

test("khách trả lời chuyện khác thì vẫn chờ xác nhận, KHÔNG tự chốt", () => {
  const hist = [...base, { from: "customer", text: "70cm" }, { from: "bot", text: askText }];
  const st = attributeStatus(attrs, hist, ["ship bao lâu vậy shop"], "");
  assert.equal(by(st, "Chiều dài").state, "confirm");
  assert.equal(by(st, "Chiều dài").fresh, false);
  // gửi SĐT cũng không được coi là đồng ý 75cm
  const st2 = attributeStatus(attrs, hist, ["0912345678"], "");
  assert.equal(by(st2, "Chiều dài").state, "confirm");
});

test("số đo người / giá tiền / SĐT không bị nhầm là chiều dài lạ", () => {
  for (const t of ["chị cao 1m65 nặng 55kg", "165cm", "giá 350k đúng không", "0912345678", "lấy 2 cái"]) {
    const st = attributeStatus(attrs, base, [t], "");
    assert.notEqual(by(st, "Chiều dài").state, "confirm", t);
  }
});

test("giá trị hợp lệ vẫn nhận bình thường (hồi quy)", () => {
  const st = attributeStatus(attrs, base, ["dài 85cm"], "");
  assert.deepEqual(by(st, "Chiều dài").picked, ["85cm"]);
  assert.equal(by(st, "Chiều dài").state, "chosen");
});

test("AI ghi variant 'Chiều dài 70cm' → bị loại khi làm sạch", () => {
  assert.equal(sanitizeVariant(attrs, "Màu đen, Chiều dài 70cm, Size S"), "Màu đen, Size S");
  assert.equal(sanitizeVariant(attrs, "Màu đen, Chiều dài 75cm, Size S"), "Màu đen, Chiều dài 75cm, Size S");
  assert.equal(sanitizeVariant(attrs, "Chiều dài 70cm"), "");
  assert.equal(confirmItems(attributeStatus(attrs, base, ["70cm"], "")).length, 1);
});

test("sản phẩm khác không bị áp danh sách chiều dài của chân váy", () => {
  const other = productAttributes({ name: "Áo", attributes: [{ name: "Size", values: "S, M, L", how: "" }, { name: "Chiều dài", values: "60cm, 70cm, 80cm", how: "" }] });
  const st = attributeStatus(other, [], ["70cm"], "");
  assert.deepEqual(st.list.find((x) => x.attr.name === "Chiều dài").picked, ["70cm"]);
});
