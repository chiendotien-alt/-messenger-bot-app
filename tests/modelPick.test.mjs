import test from "node:test";
import assert from "node:assert/strict";
import { isComplexTurn, modelsForTurn } from "../lib/modelPick.js";

test("tư vấn size / hỏi giá / hỏi ship bình thường → không phải tin khó", () => {
  for (const label of ["hoi_size", "hoi_gia", "hoi_hang", "hoi_anh", "ship", "khac", "dong_y_ngan"]) {
    assert.equal(isComplexTurn({ label }), false, label);
  }
});

test("phân vân, mặc cả, đổi trả, phàn nàn, chốt đơn → tin khó", () => {
  for (const label of ["phan_van", "mac_ca", "doi_tra", "phan_nan", "chot_don"]) assert.equal(isComplexTurn({ label }), true, label);
});

test("khách lo lắng / đưa SĐT-địa chỉ / đang ở bước xin SĐT-địa chỉ → tin khó dù nhãn là hỏi size", () => {
  assert.equal(isComplexTurn({ label: "hoi_size", worry: true }), true);
  assert.equal(isComplexTurn({ label: "khac", gaveContact: true }), true);
  assert.equal(isComplexTurn({ label: "ship", botAskedContact: true }), true);
});

test("modelsForTurn: mặc định TẮT → tin khó cũng dùng danh sách mặc định (flash-lite đứng đầu)", () => {
  delete process.env.GEMINI_COMPLEX_MODEL;
  const chain = ["gemini-3.5-flash-lite", "gemini-3.8-flash", "gemini-3.6-flash"];
  assert.equal(modelsForTurn(true, chain), null);
  assert.equal(modelsForTurn(false, chain), null);
});

test("GEMINI_COMPLEX_MODEL đặt tên model → tin khó thử model đó trước, không trùng", () => {
  process.env.GEMINI_COMPLEX_MODEL = "gemini-3.6-flash";
  const chain = ["gemini-3.5-flash-lite", "gemini-3.8-flash", "gemini-3.6-flash"];
  assert.deepEqual(modelsForTurn(true, chain), ["gemini-3.6-flash", "gemini-3.5-flash-lite", "gemini-3.8-flash"]);
  delete process.env.GEMINI_COMPLEX_MODEL;
});

test("GEMINI_COMPLEX_MODEL: đổi model / tắt", () => {
  process.env.GEMINI_COMPLEX_MODEL = "gemini-3.5-flash";
  assert.equal(modelsForTurn(true, ["gemini-3.5-flash-lite"])[0], "gemini-3.5-flash");
  process.env.GEMINI_COMPLEX_MODEL = "off";
  assert.equal(modelsForTurn(true, ["gemini-3.5-flash-lite"]), null);
  delete process.env.GEMINI_COMPLEX_MODEL;
});

test("danh sách model mặc định: 3.5-flash-lite → 3.8-flash → 3.6-flash", async () => {
  const { MODEL_CHAIN } = await import("../lib/gemini.js");
  if (!process.env.GEMINI_MODEL && !process.env.GEMINI_FALLBACK_MODELS) {
    assert.deepEqual(MODEL_CHAIN, ["gemini-3.5-flash-lite", "gemini-3.8-flash", "gemini-3.6-flash"]);
  }
});
