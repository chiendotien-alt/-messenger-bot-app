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

// ===== 9. Hồi quy từ hội thoại thật: chữ "ko/không" không phải lúc nào cũng là từ chối =====
const realAttrs = productAttributes({
  name: "Chân váy 3 tầng",
  attributes: [
    { name: "Màu", values: "Đen, Kem, Trắng, Hồng", how: "" },
    { name: "Size", values: "S, M, L, XL", how: "theo chiều cao cân nặng" },
    { name: "Chiều dài váy", values: "75cm, 85cm, 92cm", how: "theo chiều cao" },
  ],
});
const realConvo = [
  B("Dạ chân váy bên em giá 185k 1 chiếc và được miễn phí giao hàng toàn quốc"),
  B("Chị cho em xin chiều cao cân nặng để em chọn váy nhé"),
  C("Cao 1 m62"),
  B("Dạ chị cao 1m62 thì mình mặc chân váy dài 92cm là vừa đẹp ạ"),
  B("Chị cho em xin thêm cân nặng để em chọn size váy cho mình nhé"),
  C("Nặng 55-56 gì đó lâu ko cân lại"),
  B("dạ chị nặng 55 đến 56kg thì mình mặc size L ạ"),
  B("chị lấy chân váy màu nào ạ?"),
  C("Lấy màu trắng"),
  B("Dạ chị cao 1m62 mặc chân váy dài 92cm là đẹp ạ"),
  C("Kết hợp áo màu đỏ được ko sóp"),
  B("dạ chân váy màu trắng rất dễ phối đồ nên mình kết hợp với áo màu đỏ là rất nổi bật và xinh xắn nha chị"),
  C("Cho kiểm tra hàng trước khi thanh toán ko sop"),
  B("Dạ chị được kiểm tra hàng thoải mái trước khi thanh toán ạ"),
  C("Xóm 3 thôn 2 xã Bắc ruộng huyện tánh linh tĩnh bình (củ)"),
  B("Dạ em nhận được địa chỉ rồi ạ. Chị cho em xin thêm số điện thoại để em lên đơn gửi hàng nha."),
];
test("Hội thoại thật: tới lúc khách gửi SĐT, đơn có đủ màu Trắng, size L, dài 92cm", () => {
  const s = attributeStatus(realAttrs, realConvo, ["0395969950"], "");
  const get = (n) => s.list.find((x) => x.attr.name === n);
  assert.deepEqual(get("Màu").picked, ["Trắng"]);
  assert.deepEqual(get("Size").picked, ["L"]);
  assert.deepEqual(get("Chiều dài váy").picked, ["92cm"]);
  assert.equal(get("Chiều dài váy").state, "chosen");
  assert.equal(composeVariant(s), "Màu Trắng, Size L, Chiều dài váy 92cm");
  assert.deepEqual(summaryDetail(s).specs, ["size L", "dài 92cm"]);
});
test("Hội thoại thật: không có tin nào của khách làm mất lời tư vấn chiều dài", () => {
  let lost = null;
  let seenAdvice = false;
  for (let n = 1; n <= realConvo.length; n++) {
    const h = realConvo.slice(0, n);
    const s = attributeStatus(realAttrs, h, [], "");
    const len = s.list.find((x) => x.attr.name === "Chiều dài váy");
    if (len.state === "proposed" || len.state === "chosen") seenAdvice = true;
    else if (seenAdvice && !lost) lost = `${n}: ${h[h.length - 1].text} → ${len.state}`;
  }
  assert.ok(seenAdvice);
  assert.equal(lost, null, `lời tư vấn bị mất ở tin ${lost}`);
});
test("Những câu có 'ko/k/chưa' nhưng KHÔNG phải từ chối → giữ lời tư vấn", () => {
  for (const t of ["lâu ko cân lại", "cho kiểm tra hàng ko sop", "chưa cần gấp đâu em", "giờ chưa có tiền, mai chị chuyển", "k biết cân nặng chính xác", "ko biết mặc cái nào đẹp"]) {
    const s = attributeStatus(realAttrs, realConvo.slice(0, 4), [t], "");
    const len = s.list.find((x) => x.attr.name === "Chiều dài váy");
    assert.ok(["proposed", "chosen"].includes(len.state) && len.picked[0] === "92cm", `${t} → ${len.state} ${len.picked}`);
  }
});
test("Khách từ chối thật sự → bỏ lời tư vấn, không chốt số cũ", () => {
  for (const t of ["không", "ko", "thôi", "không vừa", "không hợp", "chị không lấy dài 92cm", "k lấy đâu", "chưa ưng", "dài hơn nữa đi em", "đổi cái khác"]) {
    const s = attributeStatus(realAttrs, realConvo.slice(0, 4), [t], "");
    const len = s.list.find((x) => x.attr.name === "Chiều dài váy");
    assert.notEqual(len.picked[0], "92cm", `${t} → ${len.state} ${len.picked}`);
  }
});
test("Câu hỏi nghi ngờ kết thúc bằng 'không em/ko ạ' → coi là câu hỏi, chưa chốt", () => {
  const adv = [C("Chị cao 1m60 nặng 55kg"), B("Dạ chị mặc size M dài 85cm là vừa đẹp ạ. Chị chọn màu nào ạ?")];
  for (const q of ["dài 85cm có dài quá không em", "mặc vậy ổn không em", "vậy có vừa không ạ"]) {
    const s = attributeStatus(attrs, adv, [q], "");
    assert.notEqual(by(s, "Size").state, "chosen", q);
    assert.notEqual(by(s, "Chiều dài").state, "chosen", q);
  }
});

// ===== 10. Hồi quy: khách gọi tắt màu nhiều từ ("màu cam" = "Cam Đất", "màu đỏ" = "Đỏ đô") =====
const colorAttrs = productAttributes({
  name: "Chân váy 3 tầng",
  attributes: [
    { name: "Màu", values: "Trắng, Đen, Kem, Vàng, Xanh, Hồng, Đỏ đô, Cam Đất", how: "" },
    { name: "Size", values: "S, M, L, XL, 2XL", how: "theo chiều cao cân nặng" },
    { name: "Chiều dài váy", values: "75cm, 85cm, 92cm", how: "theo chiều cao" },
  ],
});
test("Gọi tắt màu: 'màu cam' → Cam Đất, 'màu đỏ' → Đỏ đô", () => {
  const color = colorAttrs[0];
  for (const t of ["Màu cam", "màu cam nha", "lấy cam", "chọn màu cam đất", "Lấy màu cam em ơi"]) assert.deepEqual(matchValues(color, t), ["Cam Đất"], t);
  for (const t of ["màu đỏ", "Lấy màu đỏ nha", "chọn đỏ"]) assert.deepEqual(matchValues(color, t), ["Đỏ đô"], t);
});
test("Gọi tắt màu KHÔNG nhầm với chữ thường gặp (cảm ơn, cam kết, lấy đồ, đo...)", () => {
  const color = colorAttrs[0];
  for (const t of ["cảm ơn shop", "cam on shop nha", "Cam kết nhận hàng không ưng hoàn hàng", "chị lấy đồ này", "để em đo lại", "mua đồ cho con", "chị muốn xem màu khác", "do chị cao 1m50"]) {
    assert.deepEqual(matchValues(color, t), [], t);
  }
});
test("Nhiều màu cùng đầu từ ('Xanh', 'Xanh lá') thì KHÔNG đoán", () => {
  const a = productAttributes({ name: "Áo", attributes: [{ name: "Màu", values: "Xanh lá, Xanh dương, Trắng", how: "" }] })[0];
  assert.deepEqual(matchValues(a, "màu xanh"), []);
  assert.deepEqual(matchValues(a, "màu xanh lá"), ["Xanh lá"]);
});
test("Khách nhắn trơn 'cam' khi shop vừa hỏi màu → nhận Cam Đất; nhắn trơn 'cam' lúc khác thì không", () => {
  const asked = attributeStatus(colorAttrs, [B("Chị chọn màu nào ạ?")], ["cam"], "");
  assert.deepEqual(asked.list.find((x) => x.attr.name === "Màu").picked, ["Cam Đất"]);
  const notAsked = attributeStatus(colorAttrs, [B("Dạ váy giá 185k ạ")], ["cam"], "");
  assert.notEqual(notAsked.list.find((x) => x.attr.name === "Màu").state, "chosen");
});
test("Số lượng theo từng màu có màu gọi tắt: '2 cam 1 trắng' → Cam Đất x2, Trắng x1", () => {
  const s = attributeStatus(colorAttrs, [B("Chị chọn màu nào ạ?")], ["Chị lấy 2 cam 1 trắng"], "");
  const colors = summaryDetail(s).colors;
  assert.deepEqual(colors.find((c) => c.name === "Cam Đất"), { name: "Cam Đất", qty: 2 });
  assert.deepEqual(colors.find((c) => c.name === "Trắng"), { name: "Trắng", qty: 1 });
});
test("Hội thoại thật (màu cam): đơn có đủ Màu Cam Đất, size L, dài 75cm", () => {
  const h = [
    B("Chân váy bên em có 8 màu không biết chị chọn được màu nào chưa ạ ?"),
    C("Màu cam"),
    B("Dạ em lấy chân váy màu cam nha chị."),
    B("Chị cho em xin chiều cao cân nặng để em chọn váy nha."),
    C("Cao 1m50, nặng 55, eo 78, ngực 90, có bụng"),
    B("Dạ chị cao 1m50 nặng 55kg thì mặc size L và lấy váy dài 75cm là vừa đẹp nha chị."),
    B("Chị cho em xin số điện thoại và địa chỉ nhận hàng để em lên đơn nha."),
  ];
  const s = attributeStatus(colorAttrs, h, ["01 hoàng hoa thám, kh phố 1, phường phước hội , thị xã lagi, bình thuận-0977488660"], "");
  assert.equal(composeVariant(s), "Màu Cam Đất, Size L, Chiều dài váy 75cm");
  const d = summaryDetail(s);
  assert.deepEqual(d.specs, ["size L", "dài 75cm"]);
  assert.deepEqual(d.colors, [{ name: "Cam Đất", qty: 1 }]);
});
