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

test("modelsForTurn: tin khó → 3.6-flash đứng đầu, vẫn giữ model thường làm dự phòng, không trùng", () => {
  delete process.env.GEMINI_COMPLEX_MODEL;
  const chain = ["gemini-3.5-flash-lite", "gemini-3.5-flash"];
  assert.deepEqual(modelsForTurn(true, chain), ["gemini-3.6-flash", "gemini-3.5-flash-lite", "gemini-3.5-flash"]);
  assert.deepEqual(modelsForTurn(true, ["gemini-3.6-flash", "gemini-3.5-flash-lite"]), ["gemini-3.6-flash", "gemini-3.5-flash-lite"]);
  assert.equal(modelsForTurn(false, chain), null);
});

test("GEMINI_COMPLEX_MODEL: đổi model / tắt", () => {
  process.env.GEMINI_COMPLEX_MODEL = "gemini-3.5-flash";
  assert.equal(modelsForTurn(true, ["gemini-3.5-flash-lite"])[0], "gemini-3.5-flash");
  process.env.GEMINI_COMPLEX_MODEL = "off";
  assert.equal(modelsForTurn(true, ["gemini-3.5-flash-lite"]), null);
  delete process.env.GEMINI_COMPLEX_MODEL;
});
