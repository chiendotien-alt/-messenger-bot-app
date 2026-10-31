// Nhánh dự phòng song song phải đổi sang MODEL KHÁC khi model đầu bị treo (log 31/10: 3.5-flash treo ở cả 3 key cùng lúc).
// Dùng fetch giả, không gọi mạng thật, không cần database.
import test from "node:test";
import assert from "node:assert/strict";

process.env.GEMINI_HEDGE_MS = "60";
process.env.GEMINI_CIRCUIT_MS = "0";
process.env.GEMINI_ATTEMPT_TIMEOUT_MS = "5000";

const { callGeminiOnly } = await import("../lib/gemini.js");

const GOOD = (t) => ({ ok: true, status: 200, headers: new Headers(), json: async () => ({ candidates: [{ content: { parts: [{ text: t }] } }] }) });
const hang = (init) =>
  new Promise((_, rej) => init.signal.addEventListener("abort", () => rej(new Error("aborted"))));

function installFetch(rule) {
  const calls = [];
  globalThis.fetch = async (url, init = {}) => {
    const model = String(url).match(/models\/([^:]+):/)[1];
    const key = init.headers["x-goog-api-key"];
    calls.push(`${model}:${key}`);
    return rule(model, key, init);
  };
  return calls;
}

const keys = [1, 2, 3].map((i) => ({ id: "k" + i, key: "key" + i }));

test("model đầu treo ở mọi key → nhánh dự phòng đổi sang model KHÁC và thắng nhanh", async () => {
  const calls = installFetch((model, key, init) => (model === "model-A" ? hang(init) : GOOD("tu-model-B")));
  const t0 = Date.now();
  const r = await callGeminiOnly("sys", [{ role: "user", parts: [{ text: "hi" }] }], {}, Date.now() + 30000, keys, { models: ["model-A", "model-B"] });
  assert.equal(r.text, "tu-model-B");
  assert.equal(r.model, "model-B");
  assert.ok(Date.now() - t0 < 2000, "phải trả lời trong ~vài trăm ms, không chờ timeout");
  assert.equal(calls.length, 2, calls.join(","));
  assert.ok(calls[0].startsWith("model-A:"), calls.join(","));
  assert.ok(calls[1].startsWith("model-B:"), "nhánh dự phòng phải là model khác: " + calls.join(","));
});

test("chỉ có MỘT model → nhánh dự phòng vẫn dùng key khác của model đó", async () => {
  let n = 0;
  const calls = installFetch((model, key, init) => (++n === 1 ? hang(init) : GOOD("key-khac-ok")));
  const r = await callGeminiOnly("sys", [{ role: "user", parts: [{ text: "hi" }] }], {}, Date.now() + 30000, keys, { models: ["model-solo"] });
  assert.equal(r.text, "key-khac-ok");
  assert.equal(calls.length, 2, calls.join(","));
  assert.notEqual(calls[0], calls[1], "phải là key khác: " + calls.join(","));
});

test("model đầu chạy bình thường (nhanh hơn hedge) → KHÔNG gọi thêm nhánh nào", async () => {
  const calls = installFetch(() => GOOD("ok-ngay"));
  const r = await callGeminiOnly("sys", [{ role: "user", parts: [{ text: "hi" }] }], {}, Date.now() + 30000, keys, { models: ["model-A", "model-B"] });
  assert.equal(r.text, "ok-ngay");
  assert.equal(calls.length, 1, calls.join(","));
});
