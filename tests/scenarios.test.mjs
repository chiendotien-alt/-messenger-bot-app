import test from "node:test";
import assert from "node:assert/strict";
import { productAttributes, attributeStatus, composeVariant, summaryDetail, matchValues, reconcileWithReply } from "../lib/attributes.js";

const product = {
  name: "Chân váy 3 tầng",
  attributes: [
    { name: "Màu", values: "Đen, Kem, Trắng, Hồng", how: "" },
    { name: "Size", values: "S, M, L, XL", how: "theo chiều cao cân nặng" },
    { name: "Chiều dài", values: "75cm, 85cm, 92cm", how: "theo chiều cao" },
  ],
};
const attrs = productAttributes(product);
const by = (st, n) => st.list.find((x) => x.attr.name === n);
const C = (text) => ({ from: "customer", text });
const B = (text) => ({ from: "bot", text });
const st = (hist, cur = [], variant = "") => attributeStatus(attrs, hist, cur, variant);
const sizeAttr = attrs[1];

// ===== 1. Nhận size với nhiều kiểu gõ =====
test("Nhiều kiểu gõ size L đều nhận đúng L (không nhầm XL)", () => {
  for (const t of ["size L", "size l", "sz l", "Sz L nha", "zai l", "Zai L", "sai l", "cỡ L", "co L", "sâiz l", "chị lấy màu kem zai l dài váy 75 cm", "lấy cho chị l nha em", "size  L ạ", "size:L", "size-L"]) {
    assert.deepEqual(matchValues(sizeAttr, t), ["L"], t);
  }
});
test("XL không bị nhầm thành L, L không bị nhầm thành XL", () => {
  for (const t of ["size xl", "zai xl", "cỡ XL", "lấy xl"]) assert.deepEqual(matchValues(sizeAttr, t), ["XL"], t);
  assert.ok(!matchValues(sizeAttr, "size l").includes("XL"));
});
test("Không bịa size từ chữ thường gặp", () => {
  for (const t of ["chị lấy màu kem dài 75cm", "cho chị hỏi giá", "ship về Hà Nội mấy ngày", "em ơi giá sao", "ok em", "chị cao 1m60 nặng 55kg"]) {
    assert.deepEqual(matchValues(sizeAttr, t), [], t);
  }
});

// ===== 2. Kịch bản đơn lỗi gốc, đi hết luồng tới lúc gửi SĐT =====
test("Đơn lỗi gốc: khách gõ 'zai l' dài → hết luồng vẫn có đủ size/dài/màu trong variant và tin tóm tắt", () => {
  const h = [
    B("Chân váy bên em có 8 màu không biết chị chọn được màu nào chưa ạ"),
    C("Chị lấy Màu kem zai l dài váy 75 cm"),
    B("Dạ em lấy chị chân váy màu kem, size L dài 75cm ạ. Chị cho em xin số điện thoại và địa chỉ nhận hàng để em lên đơn ạ"),
  ];
  const s = st(h, ["Sđt 0904251427 Đc bệnh viện nội tiết trung ương đường Nguyễn bồ Ngọc hồi thanh trì Hà Nội"]);
  assert.equal(by(s, "Size").state, "chosen");
  assert.deepEqual(by(s, "Size").picked, ["L"]);
  assert.deepEqual(by(s, "Chiều dài").picked, ["75cm"]);
  assert.deepEqual(by(s, "Màu").picked, ["Kem"]);
  assert.equal(composeVariant(s), "Màu Kem, Size L, Chiều dài 75cm");
  const d = summaryDetail(s);
  assert.deepEqual(d.specs, ["size L", "dài 75cm"]);
  assert.deepEqual(d.colors, [{ name: "Kem", qty: 1 }]);
});
test("Địa chỉ/SĐT không bị đọc nhầm thành size hay chiều dài", () => {
  for (const addr of ["Sđt 0904251427 Đc số 75 ngõ 3 đường Láng Hạ Hà Nội", "0987654321 Lô 9 khu đô thị L Hà Đông", "Nguyễn Văn A 0912345678 số 85 Lê Lợi M Hà Nội"]) {
    const s = st([B("Chị cho em xin SĐT và địa chỉ nhận hàng ạ")], [addr]);
    assert.notEqual(by(s, "Chiều dài").state, "chosen", addr);
    assert.notEqual(by(s, "Size").state, "chosen", addr);
  }
});

// ===== 3. Luồng tư vấn → chốt =====
const adviceHist = [C("Chị cao 1m60 nặng 55kg"), B("Dạ chị cao 1m60 nặng 55kg thì mặc size M dài 85cm là vừa đẹp ạ. Chị chọn màu nào ạ?")];
test("Luồng đầy đủ: tư vấn → chọn màu → SĐT: mọi bước đều nhất quán", () => {
  assert.equal(by(st(adviceHist), "Size").state, "proposed");
  const afterColor = st(adviceHist, ["Màu kem"]);
  assert.equal(by(afterColor, "Size").state, "chosen");
  const afterPhone = st([...adviceHist, C("Màu kem"), B("Chị cho em xin SĐT và địa chỉ ạ")], ["0904251427 số 5 ngõ 3 Hà Nội"]);
  assert.equal(composeVariant(afterPhone), "Màu Kem, Size M, Chiều dài 85cm");
});
test("Khách đồng ý bằng nhiều cách khác nhau đều chốt", () => {
  for (const ok of ["ok em", "dạ", "được em", "vừa rồi em", "ừ lấy vậy đi"]) {
    const s = st(adviceHist, [ok]);
    assert.equal(by(s, "Size").state, "chosen", ok);
    assert.deepEqual(by(s, "Size").picked, ["M"], ok);
  }
});
test("Khách đổi ý sau khi đã chốt ngầm → lấy giá trị mới, không giữ giá trị cũ", () => {
  const h = [...adviceHist, C("Màu kem"), B("Chị cho em xin SĐT và địa chỉ ạ")];
  const s = st(h, ["Chị đổi lấy size L nha"]);
  assert.deepEqual(by(s, "Size").picked, ["L"]);
  const s2 = st(h, ["không lấy size M nữa, chị lấy L"]);
  assert.deepEqual(by(s2, "Size").picked, ["L"]);
});
test("Khách phản đối chiều dài nhưng không đụng size → size vẫn chốt, chiều dài không chốt số cũ", () => {
  const s = st(adviceHist, ["Màu kem nhưng chị không lấy dài 85cm"]);
  assert.notDeepEqual(by(s, "Chiều dài").picked, ["85cm"]);
  assert.equal(by(s, "Size").picked[0], "M");
});
test("Khách gõ giá trị chiều dài khác → lấy giá trị khách chọn", () => {
  const s = st(adviceHist, ["Màu kem, chị lấy dài 92cm"]);
  assert.deepEqual(by(s, "Chiều dài").picked, ["92cm"]);
  assert.deepEqual(by(s, "Size").picked, ["M"]);
});
test("Chiều dài ngoài danh sách (70cm) → không lưu 70cm, chờ xác nhận", () => {
  const s = st([B("Chị chọn dài mấy cm ạ")], ["Chị lấy dài 70cm"]);
  assert.notEqual(by(s, "Chiều dài").state, "chosen");
  assert.ok(!(by(s, "Chiều dài").picked || []).includes("70cm"));
});
test("Tin cuối là tin tư vấn của shop (khách chưa trả lời) → chưa chốt", () => {
  assert.equal(by(st(adviceHist), "Size").state, "proposed");
  assert.equal(by(st(adviceHist), "Chiều dài").state, "proposed");
});
test("Khách hỏi chuyện khác bằng câu hỏi → chưa chốt ngầm", () => {
  for (const q of ["Ship về Hà Nội mấy ngày vậy em?", "có freeship không em?", "giá bao nhiêu vậy em"]) {
    const s = st(adviceHist, [q]);
    assert.equal(by(s, "Size").state, "proposed", q);
  }
});
test("Tin trống / chỉ ảnh (không có chữ) không làm hỏng trạng thái", () => {
  const s = st([...adviceHist, C("")], []);
  assert.doesNotThrow(() => composeVariant(s));
});

// ===== 4. Màu & số lượng =====
test("Thêm màu vào đơn cũ: cộng dồn, không ghi đè", () => {
  const h = [B("Chị chọn màu nào ạ"), C("Màu kem"), B("Dạ em ghi màu kem nha chị")];
  const s = st(h, ["thêm màu đen nữa"]);
  assert.deepEqual(by(s, "Màu").picked.sort(), ["Đen", "Kem"].sort());
});
test("Màu khách tự chọn, shop khen màu khác thì không bị ghi màu của shop", () => {
  const h = [C("Chị cao 1m60 nặng 55kg"), B("Dạ màu đen rất hợp với chị đó ạ, mặc size M là vừa nha.")];
  const s = st(h, ["Chị lấy màu kem"]);
  assert.deepEqual(by(s, "Màu").picked, ["Kem"]);
});

// ===== 5. Sản phẩm không có thuộc tính / chỉ có màu =====
test("Sản phẩm chỉ có màu: không lỗi, không đòi size", () => {
  const onlyColor = productAttributes({ name: "Áo thun", attributes: [{ name: "Màu", values: "Đen, Trắng", how: "" }] });
  const s = attributeStatus(onlyColor, [B("Chị chọn màu nào ạ")], ["Chị lấy màu trắng"], "");
  assert.deepEqual(s.list.map((x) => x.state), ["chosen"]);
  assert.equal(composeVariant(s), "Màu Trắng");
});
test("Sản phẩm không có thuộc tính nào: không throw", () => {
  const none = productAttributes({ name: "Phụ kiện", attributes: [] });
  assert.doesNotThrow(() => attributeStatus(none, [C("alo")], ["lấy 1 cái"], ""));
});

// ===== 6. Đối chiếu tin AI: các chốt chặn =====
const missing = () => ({ list: [{ attr: sizeAttr, state: "missing", picked: [] }], body: {} });
test("Đối chiếu: bù khi AI nói, khách nhắn trơn; không bù khi khách không nhắn", () => {
  const a = missing();
  assert.equal(reconcileWithReply(a, { replyTexts: ["Dạ em lấy chị size L nha"], customerTexts: ["xx l nha em"] }).length, 1);
  const b = missing();
  assert.equal(reconcileWithReply(b, { replyTexts: ["Dạ em lấy chị size L nha"], customerTexts: ["chị lấy màu kem"] }).length, 0);
});
test("Đối chiếu: AI nói hai size khác nhau → không chọn bừa", () => {
  const a = missing();
  assert.deepEqual(reconcileWithReply(a, { replyTexts: ["Dạ size M hoặc size L đều được ạ."], customerTexts: ["l"] }), []);
});
test("Đối chiếu: chạy lặp nhiều lần không đổi kết quả (idempotent)", () => {
  const a = missing();
  const args = { replyTexts: ["Dạ size L nha chị."], customerTexts: ["zz l nhé"] };
  reconcileWithReply(a, args);
  const again = reconcileWithReply(a, args);
  assert.deepEqual(again, []);
  assert.deepEqual(a.list[0].picked, ["L"]);
});
test("Đối chiếu: đầu vào rỗng/undefined không throw", () => {
  assert.doesNotThrow(() => reconcileWithReply({ list: [] }));
  assert.doesNotThrow(() => reconcileWithReply(null, {}));
  assert.doesNotThrow(() => reconcileWithReply(missing(), { replyTexts: [null, undefined, ""], customerTexts: [null] }));
});

// ===== 7. Độ ổn định: tin ngẫu nhiên không làm sập =====
test("Fuzz: 3000 tổ hợp tin ngẫu nhiên không throw, trạng thái luôn hợp lệ và kết quả lặp lại y hệt", () => {
  const pool = ["size L", "zai m", "dài 85cm", "75", "màu kem", "màu đen", "ok em", "không lấy", "thôi", "chị cao 1m60 nặng 55kg", "0904251427", "số 5 ngõ 3 Hà Nội", "có freeship không?", "👍", "L", "XL", "92cm", "lấy 2 cái", "thêm màu hồng", "", "?", "ship mấy ngày", "70cm", "đổi size S",
    "Dạ chị mặc size M dài 85cm là vừa ạ", "Chị chọn màu nào ạ?", "Chị cho em xin SĐT và địa chỉ ạ"];
  let seed = 12345;
  const rnd = (n) => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed % n; };
  const VALID = new Set(["missing", "measured", "proposed", "confirm", "chosen"]);
  for (let i = 0; i < 3000; i++) {
    const len = 1 + rnd(7);
    const hist = Array.from({ length: len }, () => ({ from: rnd(2) ? "customer" : "bot", text: pool[rnd(pool.length)] }));
    const cur = rnd(2) ? [pool[rnd(pool.length)]] : [];
    const a = attributeStatus(attrs, hist, cur, "");
    const b = attributeStatus(attrs, hist, cur, "");
    for (const x of a.list) assert.ok(VALID.has(x.state), `state lạ: ${x.state}`);
    assert.deepEqual(a.list.map((x) => [x.state, x.picked]), b.list.map((x) => [x.state, x.picked]));
    assert.doesNotThrow(() => { composeVariant(a); summaryDetail(a); });
    // thuộc tính đã chốt thì luôn là giá trị nằm trong danh sách shop cho phép
    for (const x of a.list) if (x.state === "chosen") for (const v of x.picked) assert.ok(x.attr.values.includes(v), `${x.attr.name}=${v} ngoài danh sách`);
  }
});
test("Hiệu năng: hội thoại 60 tin tính trạng thái dưới 200ms", () => {
  const hist = Array.from({ length: 60 }, (_, i) => (i % 2 ? B("Dạ chị mặc size M dài 85cm là vừa ạ. Chị chọn màu nào ạ?") : C("chị cao 1m60 nặng 55kg màu kem nha")));
  const t0 = performance.now();
  attributeStatus(attrs, hist, ["ok em"], "");
  assert.ok(performance.now() - t0 < 200, `chậm: ${(performance.now() - t0).toFixed(1)}ms`);
});

// ===== 8. Hồi quy: lúc bot vừa xin SĐT, khách nói rõ lựa chọn bằng cụm có 2 từ khóa liền nhau =====
test("Lúc bot xin SĐT: 'đổi lấy size L', 'chọn lấy size L' vẫn đọc được size", () => {
  const h = [...adviceHist, C("Màu kem"), B("Chị cho em xin SĐT và địa chỉ ạ")];
  for (const t of ["Chị đổi lấy size L nha", "chọn lấy size L nhé em", "đổi lấy size L"]) {
    assert.deepEqual(by(st(h, [t]), "Size").picked, ["L"], t);
  }
});
test("Tin gửi SĐT kèm 'màu hồng dài 92' vẫn đọc được cả màu lẫn chiều dài", () => {
  const h = [B("Chị cho em xin SĐT và địa chỉ nhận hàng ạ")];
  const s = st(h, ["0904251427 số 5 ngõ 3 Láng Hạ Hà Nội, màu hồng dài 92"]);
  assert.deepEqual(by(s, "Màu").picked, ["Hồng"]);
  assert.deepEqual(by(s, "Chiều dài").picked, ["92cm"]);
});
test("Tên đường/tên người có chữ giống màu không bị đọc thành màu (Lê Hồng Phong, Nguyễn Thị Hồng)", () => {
  const h = [B("Chị cho em xin SĐT và địa chỉ nhận hàng ạ")];
  for (const a of ["0904251427 số 5 Lê Hồng Phong Hà Nội", "Nguyễn Thị Hồng 0912345678 số 9 Cầu Giấy Hà Nội"]) {
    assert.notEqual(by(st(h, [a]), "Màu").state, "chosen", a);
  }
});
