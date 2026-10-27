import test from "node:test";
import assert from "node:assert/strict";
import { productAttributes, attributeStatus, composeVariant, summaryDetail, reconcileWithReply } from "../lib/attributes.js";

const product = {
  name: "Chân váy 3 tầng",
  attributes: [
    { name: "Màu", values: "Đen, Kem, Trắng, Hồng", how: "" },
    { name: "Size", values: "S, M, L", how: "theo chiều cao cân nặng" },
    { name: "Chiều dài", values: "75cm, 85cm, 92cm", how: "theo chiều cao" },
  ],
};
const attrs = productAttributes(product);
const by = (st, n) => st.list.find((x) => x.attr.name === n);

test("Kịch bản đơn lỗi: khách gõ kiểu lạ 'sâiz l', AI nói size L → đối chiếu bổ sung, đơn có size L", () => {
  const cust = "Chị lấy Màu kem sâiz l dài váy 75 cm";
  const st = attributeStatus(attrs, [], [cust], "");
  const fixed = reconcileWithReply(st, {
    replyTexts: ["Dạ em lấy chị chân váy màu kem, size L dài 75cm nha."],
    customerTexts: [cust],
  });
  // nếu regex đã nhận được size thì không cần bổ sung; nếu chưa thì phải bổ sung đúng L
  assert.equal(by(st, "Size").state, "chosen");
  assert.deepEqual(by(st, "Size").picked, ["L"]);
  assert.ok(fixed.length === 0 || fixed[0].value === "L");
  assert.ok(composeVariant(st).includes("Size L"));
  assert.ok(summaryDetail(st).specs.includes("size L"));
});

test("Bộ nhận diện bỏ sót (missing) nhưng AI nói size L và khách có nhắn 'L' → bổ sung", () => {
  const st = { list: [{ attr: attrs[1], state: "missing", picked: [] }], body: {} };
  const fixed = reconcileWithReply(st, {
    replyTexts: ["Dạ em lấy chị size L nha."],
    customerTexts: ["chị lấy kem xx l dài váy 75 cm cho chị nhé em ơi"],
  });
  assert.deepEqual(fixed, [{ name: "Size", value: "L" }]);
  assert.equal(st.list[0].state, "chosen");
  assert.deepEqual(st.list[0].picked, ["L"]);
});

test("AI tự nói size nhưng khách không hề nhắn → KHÔNG ghi vào đơn", () => {
  const st = { list: [{ attr: attrs[1], state: "missing", picked: [] }], body: {} };
  const fixed = reconcileWithReply(st, {
    replyTexts: ["Dạ chị cao 1m60 thì mặc size M là vừa ạ."],
    customerTexts: ["chị cao 1m60 nặng 55kg"],
  });
  assert.deepEqual(fixed, []);
  assert.equal(st.list[0].state, "missing");
});

test("AI liệt kê nhiều size hoặc hỏi lại → không ghi nhận", () => {
  for (const reply of ["Dạ bên em có size S, M, L ạ.", "Ý chị là size L đúng không ạ?"]) {
    const st = { list: [{ attr: attrs[1], state: "missing", picked: [] }], body: {} };
    assert.deepEqual(reconcileWithReply(st, { replyTexts: [reply], customerTexts: ["chị lấy l nha"] }), [], reply);
  }
});

test("Khách phủ định 'không lấy size L' → không ghi nhận", () => {
  const st = { list: [{ attr: attrs[1], state: "missing", picked: [] }], body: {} };
  assert.deepEqual(reconcileWithReply(st, { replyTexts: ["Dạ size L nha chị."], customerTexts: ["chị không lấy size L"] }), []);
});

test("Mục đã chosen/confirm không bị đụng", () => {
  const st = { list: [{ attr: attrs[1], state: "chosen", picked: ["M"] }, { attr: attrs[2], state: "confirm", picked: ["75cm"] }], body: {} };
  assert.deepEqual(reconcileWithReply(st, { replyTexts: ["size L dài 85cm"], customerTexts: ["l 85"] }), []);
  assert.deepEqual(st.list[0].picked, ["M"]);
});
