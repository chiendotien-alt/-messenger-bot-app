import test from "node:test";
import assert from "node:assert/strict";
import { acceptRewrite, pickRewrites, ruleRows, applyRewritesToTexts, rewriteTurnNote, fixOforZero } from "../lib/customerRewrite.js";
import { productAttributes, attributeStatus } from "../lib/attributes.js";
import { bodyInfoGiven } from "../lib/replyDedupe.js";
import { dropKnownBodyAsks } from "../lib/bodyCross.js";

const C = (text, text_norm) => ({ from: "customer", text, ...(text_norm ? { text_norm } : {}) });
const B = (text) => ({ from: "bot", text });

const product = {
  name: "Chân váy 3 tầng",
  attributes: [
    { name: "Màu", values: "Trắng, Đen, Cam đất", how: "" },
    { name: "Size", values: "S, M, L, XL", how: "theo cân nặng" },
    { name: "Chiều dài váy", values: "75cm, 85cm, 92cm", how: "theo chiều cao" },
  ],
};
const attrs = productAttributes(product);
const body = (rows, cur = []) => attributeStatus(attrs, rows, cur, "").body;

// ---------- Đúng đoạn chat trong ảnh khách gửi ----------
const chatRaw = [
  B("dạ em lấy chân váy màu cam đất nha chị"),
  B("chị cho em xin chiều cao cân nặng để em chọn váy nha?"),
  C("M61"),
  B("Chị cho em biết cân nặng nha?"),
  C("5ok nha"),
];

test("TRƯỚC khi sửa: tin thô 'M61' + '5ok nha' → hệ thống tưởng khách chưa nói số đo (nguyên nhân bot hỏi lại cân)", () => {
  assert.deepEqual(bodyInfoGiven(["M61", "5ok nha"]), { height: false, weight: false });
  const b = body(chatRaw);
  assert.equal(b.weight, false);
});

test("SAU khi sửa: có bản AI dịch lại → hệ thống biết khách đã đưa đủ chiều cao + cân nặng", () => {
  const chatNorm = [
    B("dạ em lấy chân váy màu cam đất nha chị"),
    B("chị cho em xin chiều cao cân nặng để em chọn váy nha?"),
    C("M61", "cao 1m61"),
    B("Chị cho em biết cân nặng nha?"),
    C("5ok nha", "nặng 50kg nha"),
  ];
  const rows = ruleRows(chatNorm);
  assert.deepEqual(bodyInfoGiven(rows.filter((m) => m.from === "customer").map((m) => m.text)), { height: true, weight: true });
  assert.deepEqual(body(rows), { height: true, weight: true });
  // tin thô vẫn giữ để chủ shop xem đúng chữ khách gõ
  assert.equal(rows[2].rawText, "M61");
  assert.equal(rows[2].text, "cao 1m61");
});

test("Lượt hiện tại: tin mới chưa lưu DB thì áp bản dịch lên danh sách chữ rồi tính lại trạng thái", () => {
  const hist = ruleRows([B("chị cho em xin chiều cao cân nặng nha?"), C("M61", "cao 1m61"), B("Chị cho em biết cân nặng nha?")]);
  const targets = [{ id: 7, text: "5ok nha" }];
  const rewrites = pickRewrites({ khach_viet_lai: ["nặng 50kg nha"] }, targets);
  assert.equal(rewrites.length, 1);
  const cur = applyRewritesToTexts(["5ok nha"], rewrites, targets);
  assert.deepEqual(cur, ["nặng 50kg nha"]);
  assert.equal(attributeStatus(attrs, hist, ["5ok nha"], "").body.weight, false); // không dịch → thiếu
  assert.equal(attributeStatus(attrs, hist, cur, "").body.weight, true); // có dịch → đủ
});

test("Câu xin lại cân nặng bị bỏ khi bản dịch cho thấy khách đã đưa", () => {
  const known = bodyInfoGiven(["cao 1m61", "nặng 50kg nha"]);
  const r = dropKnownBodyAsks(["dạ chị cao 1m61 nặng 50kg thì mặc size M là vừa nha chị", "Chị tầm bao cân ạ?"], known);
  assert.equal(r.messages.length, 1);
  assert.match(r.messages[0], /size M/);
});

// ---------- Kiểm tra chặn AI bịa ----------
test("Nhận các bản viết lại đúng", () => {
  for (const [o, r] of [
    ["M61", "cao 1m61"],
    ["5ok nha", "nặng 50kg nha"],
    ["50k", "50kg"],
    ["1 62 58kg", "cao 1m62 58kg"],
    ["162/58", "cao 1m62 58kg"],
    ["M62 5o", "cao 1m62 50kg"],
    ["zai l", "size L"],
  ]) assert.ok(acceptRewrite(o, r), `${o} → ${r}`);
});

test("Từ chối khi AI đổi / bịa số", () => {
  assert.equal(acceptRewrite("5ok nha", "nặng 55kg nha"), ""); // đổi số
  assert.equal(acceptRewrite("M61", "cao 1m71"), "");
  assert.equal(acceptRewrite("M61", "cao 1m61 nặng 48kg"), ""); // thêm số khách không nói
  assert.equal(acceptRewrite("0972985918 ngõ 75 Kim Mã", "0972985919 ngõ 75 Kim Mã"), ""); // đổi SĐT
  assert.equal(acceptRewrite("0972985918 ngõ 75 Kim Mã", "ngõ 75 Kim Mã"), ""); // mất SĐT
});

test("Từ chối khi AI viết thêm cả đoạn / không đổi gì / rỗng", () => {
  assert.equal(acceptRewrite("M61", "cao 1m61 và chị muốn lấy size M màu cam đất dài 92cm nha shop"), "");
  assert.equal(acceptRewrite("Cho mình màu cam đất nha", "cho mình màu cam đất nha"), ""); // giống hệt (chỉ khác hoa thường)
  assert.equal(acceptRewrite("M61", ""), "");
  assert.equal(acceptRewrite("", "cao 1m61"), "");
});

test("o ↔ 0 chỉ dùng để so số", () => {
  assert.equal(fixOforZero("5ok"), "50k");
  assert.equal(fixOforZero("1m5o"), "1m50");
  assert.equal(fixOforZero("ok nha"), "ok nha");
  assert.equal(fixOforZero("áo 2 cái"), "áo 2 cái");
});

// ---------- Ghép bản dịch với tin khách ----------
test("pickRewrites: đúng số tin thì ghép theo thứ tự; lệch thì bỏ; 1 chuỗi cho cả cụm thì gắn vào tin cuối", () => {
  const t = [{ id: 1, text: "M61" }, { id: 2, text: "5ok nha" }];
  const ok = pickRewrites({ khach_viet_lai: ["cao 1m61", "nặng 50kg nha"] }, t);
  assert.deepEqual(ok.map((r) => [r.id, r.norm]), [[1, "cao 1m61"], [2, "nặng 50kg nha"]]);
  // tin nào không đổi (AI chép y nguyên) thì không ghi
  const part = pickRewrites({ khach_viet_lai: ["M61", "nặng 50kg nha"] }, t);
  assert.deepEqual(part.map((r) => r.id), [2]);
  // lệch số lượng (3 ≠ 2) → bỏ
  assert.deepEqual(pickRewrites({ khach_viet_lai: ["a", "b", "c"] }, t), []);
  // 1 chuỗi cho cả cụm
  const joined = pickRewrites({ khach_viet_lai: "cao 1m61 nặng 50kg" }, t);
  assert.equal(joined.length, 1);
  assert.equal(joined[0].id, 2);
  assert.equal(joined[0].joined, true);
  // thiếu trường / sai kiểu
  assert.deepEqual(pickRewrites({}, t), []);
  assert.deepEqual(pickRewrites(null, t), []);
  assert.deepEqual(pickRewrites({ khach_viet_lai: 5 }, t), []);
});

test("ruleRows chỉ đổi tin KHÁCH có bản dịch; tin bot giữ nguyên", () => {
  const rows = ruleRows([B("chị cao bao nhiêu ạ?"), C("M61", "cao 1m61"), C("ok")]);
  assert.equal(rows[0].text, "chị cao bao nhiêu ạ?");
  assert.equal(rows[1].text, "cao 1m61");
  assert.equal(rows[2].text, "ok");
  assert.deepEqual(ruleRows(null), []);
});

test("rewriteTurnNote ghi đúng số tin; không có tin thì rỗng", () => {
  const n = rewriteTurnNote(["M61", "5ok nha"]);
  assert.match(n, /đúng 2 phần tử/);
  assert.match(n, /1\. M61/);
  assert.equal(rewriteTurnNote([]), "");
});
