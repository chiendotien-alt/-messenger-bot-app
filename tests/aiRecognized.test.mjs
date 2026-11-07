// Khách gõ số đo kiểu lạ ("cn 50 cc 155", "nặg 5o kg", "cao mét năm lăm") → quy tắc (regex) bỏ sót nhưng AI hiểu.
// AI báo thêm trường khach_da_cho; code kiểm tra rồi lưu vào hồ sơ khách (info.body) để hỏi bồi / các lượt sau không hỏi lại.
import test from "node:test";
import assert from "node:assert/strict";
import { parseKhachDaCho, bodyFlagsToInfo, bodyFlagsFromInfo, mergeBodyFlags, bodyUpdateFromReply } from "../lib/aiRecognized.js";
import { bodyInfoGiven } from "../lib/replyDedupe.js";
import { productAttributes, attributeStatus, nextAttrToAsk } from "../lib/attributes.js";

const TYPO_TEXTS = ["cn 50 cc 155", "cao 1m55 nặg 5o kg", "1,55 50k", "cao mét năm lăm nặng năm mươi"];

test("Ghi lại lý do cần tín hiệu của AI: quy tắc vẫn bỏ sót các kiểu gõ lạ", () => {
  for (const t of ["cn 50 cc 155", "1,55 50k"]) {
    const r = bodyInfoGiven([t]);
    assert.equal(r.height && r.weight, false, t);
  }
});

test("parseKhachDaCho: nhận true / 'true' / 'có' cho chiều cao và cân nặng", () => {
  assert.deepEqual(parseKhachDaCho({ chieu_cao: true, can_nang: true }, ["cn 50 cc 155"]), { height: true, weight: true });
  assert.deepEqual(parseKhachDaCho({ chieu_cao: "true", can_nang: "có" }, ["cn 50 cc 155"]), { height: true, weight: true });
  assert.deepEqual(parseKhachDaCho({ chieu_cao: false, can_nang: true }, ["nặng 50"]), { height: false, weight: true });
});

test("parseKhachDaCho: khách chưa hề nói con số nào thì AI báo 'đã nhận' cũng KHÔNG tin (chống AI nói bừa)", () => {
  for (const texts of [["dạ vâng ạ"], ["váy này còn không shop"], [], ["chị lấy màu vàng"]]) {
    assert.deepEqual(parseKhachDaCho({ chieu_cao: true, can_nang: true }, texts), { height: false, weight: false }, JSON.stringify(texts));
  }
});

test("parseKhachDaCho: khách viết số đo bằng chữ vẫn được tin", () => {
  assert.deepEqual(parseKhachDaCho({ chieu_cao: true, can_nang: true }, ["cao mét năm lăm nặng năm mươi"]), { height: true, weight: true });
});

test("parseKhachDaCho: dữ liệu rác không làm lỗi", () => {
  for (const raw of [null, undefined, "abc", 5, [], { chieu_cao: "xyz" }, {}]) {
    assert.deepEqual(parseKhachDaCho(raw, TYPO_TEXTS), { height: false, weight: false }, JSON.stringify(raw));
  }
});

test("bodyFlags <-> chuỗi lưu trong hồ sơ khách", () => {
  assert.equal(bodyFlagsToInfo({ height: true, weight: true }), "height,weight");
  assert.equal(bodyFlagsToInfo({ height: true, weight: false }), "height");
  assert.equal(bodyFlagsToInfo({ height: false, weight: false }), "");
  assert.deepEqual(bodyFlagsFromInfo({ body: "height,weight" }), { height: true, weight: true });
  assert.deepEqual(bodyFlagsFromInfo({ body: "weight" }), { height: false, weight: true });
  assert.deepEqual(bodyFlagsFromInfo({}), { height: false, weight: false });
  assert.deepEqual(bodyFlagsFromInfo(null), { height: false, weight: false });
  assert.deepEqual(bodyFlagsFromInfo({ body: "linh tinh" }), { height: false, weight: false });
});

test("mergeBodyFlags: quy tắc HOẶC AI — có một bên nhận là đã có", () => {
  assert.deepEqual(mergeBodyFlags({ height: true, weight: false }, { height: false, weight: true }), { height: true, weight: true });
  assert.deepEqual(mergeBodyFlags({ height: false, weight: false }, null), { height: false, weight: false });
  assert.deepEqual(mergeBodyFlags(undefined, { height: true, weight: false }), { height: true, weight: false });
});

test("bodyUpdateFromReply: có thông tin mới → trả chuỗi cần lưu; không có gì mới → null (khỏi ghi DB)", () => {
  const khachDaCho = { chieu_cao: true, can_nang: true };
  assert.equal(bodyUpdateFromReply({ khachDaCho, customerTexts: ["cn 50 cc 155"], savedInfo: {} }), "height,weight");
  assert.equal(bodyUpdateFromReply({ khachDaCho, customerTexts: ["cn 50 cc 155"], savedInfo: { body: "height,weight" } }), null);
  assert.equal(bodyUpdateFromReply({ khachDaCho: null, customerTexts: ["cn 50 cc 155"], savedInfo: {} }), null);
  assert.equal(bodyUpdateFromReply({ khachDaCho, customerTexts: ["dạ vâng"], savedInfo: {} }), null);
});

test("bodyUpdateFromReply: chỉ cộng thêm, không bao giờ xóa cái đã lưu", () => {
  // đã lưu chiều cao; lượt này AI báo thêm cân nặng → lưu cả hai
  assert.equal(bodyUpdateFromReply({ khachDaCho: { chieu_cao: false, can_nang: true }, customerTexts: ["nặg 5o kg"], savedInfo: { body: "height" } }), "height,weight");
  // AI lượt này báo false hết thì không xóa bản đã lưu
  assert.equal(bodyUpdateFromReply({ khachDaCho: { chieu_cao: false, can_nang: false }, customerTexts: ["nặg 5o kg"], savedInfo: { body: "height,weight" } }), null);
});

// ---- Sản phẩm CÓ bảng thuộc tính: AI báo đã nhận số đo → mục Size không còn bị coi là "chưa có" ----
const product = {
  name: "Chân váy 3 tầng",
  attributes: [
    { name: "Màu", values: "Đen, Kem", how: "" },
    { name: "Size", values: "S, M, L", how: "theo chiều cao cân nặng" },
  ],
};
const attrs = productAttributes(product);
const sizeOf = (st) => st.list.find((x) => x.attr.name === "Size");

test("Bảng thuộc tính: 'cn 50 cc 155' quy tắc bỏ sót → hệ thống hỏi lại số đo (lỗi khách đang gặp)", () => {
  const st = attributeStatus(attrs, [], ["chị lấy màu kem", "cn 50 cc 155"], "");
  assert.equal(sizeOf(st).state, "missing");
  assert.equal(nextAttrToAsk(st)?.attr.name, "Size");
});

test("Bảng thuộc tính: có tín hiệu AI đã nhận số đo → Size ở trạng thái 'đã đo', không hỏi lại số đo", () => {
  const st = attributeStatus(attrs, [], ["chị lấy màu kem", "cn 50 cc 155"], "", { body: { height: true, weight: true } });
  assert.deepEqual(st.body, { height: true, weight: true });
  assert.equal(sizeOf(st).state, "measured");
  assert.equal(nextAttrToAsk(st), null);
});

test("Bảng thuộc tính: AI chỉ báo cân nặng, quy tắc đọc được chiều cao → ghép lại thành đủ", () => {
  const st = attributeStatus(attrs, [], ["chị lấy màu kem", "cao 1m55 nặg 5o kg"], "", { body: { height: false, weight: true } });
  assert.deepEqual(st.body, { height: true, weight: true });
  assert.equal(nextAttrToAsk(st), null);
});

test("Bảng thuộc tính: không truyền tín hiệu AI thì chạy y như cũ (không làm hỏng chỗ đang dùng)", () => {
  const a = attributeStatus(attrs, [], ["chị lấy màu kem", "mình 1m55 50kg"], "");
  const b = attributeStatus(attrs, [], ["chị lấy màu kem", "mình 1m55 50kg"], "", undefined);
  assert.deepEqual(a.body, { height: true, weight: true });
  assert.deepEqual(b.body, a.body);
});

// ---- Prompt dặn AI báo trường khach_da_cho ----
import { readFileSync } from "node:fs";
test("Prompt có dặn AI trả trường khach_da_cho", () => {
  const src = readFileSync(new URL("../lib/botPrompt.js", import.meta.url), "utf8");
  assert.ok(src.includes("khach_da_cho"));
  assert.ok(/chieu_cao/.test(src) && /can_nang/.test(src));
});
