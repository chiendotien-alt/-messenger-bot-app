// Thứ tự dự phòng: Gemini → Claude (trả phí) → Groq. Dùng fetch giả, không gọi mạng thật, không cần database.
import test from "node:test";
import assert from "node:assert/strict";

process.env.GEMINI_CIRCUIT_MS = "0"; // tắt cầu dao để các test không ảnh hưởng nhau
process.env.GEMINI_HEDGE_MS = "0";
process.env.GROQ_API_KEY = "gsk_testtesttesttest";
process.env.ANTHROPIC_API_KEY = "sk-ant-testtesttesttest";

const { callGemini } = await import("../lib/gemini.js");
const { toClaudeMessages, resetClaudeCooldowns } = await import("../lib/claude.js");

const GEM_OK = (t) => ({ ok: true, status: 200, headers: new Headers(), json: async () => ({ candidates: [{ content: { parts: [{ text: t }] } }] }) });
const CLAUDE_OK = (t) => ({ ok: true, status: 200, headers: new Headers(), json: async () => ({ content: [{ type: "text", text: t }], usage: { input_tokens: 10, output_tokens: 5 } }) });
const GROQ_OK = (t) => ({ ok: true, status: 200, headers: new Headers(), json: async () => ({ choices: [{ message: { content: t } }] }) });
const BAD = (status, msg = "x") => ({ ok: false, status, headers: new Headers(), json: async () => ({ error: { message: msg } }) });

function installFetch({ gemini, claude, groq }) {
  const calls = [];
  const bodies = [];
  globalThis.fetch = async (url, init = {}) => {
    const u = String(url);
    if (u.includes("generativelanguage.googleapis.com")) { calls.push("gemini"); return gemini(); }
    if (u.includes("api.anthropic.com")) { calls.push("claude"); bodies.push(JSON.parse(init.body)); return claude(); }
    if (u.includes("api.groq.com")) { calls.push("groq"); return groq(); }
    throw new Error("URL lạ: " + u);
  };
  return { calls, bodies };
}

let n = 0;
const run = (cfg = { responseMimeType: "application/json" }) => {
  resetClaudeCooldowns();
  return callGemini("system", [{ role: "user", parts: [{ text: "hi" }] }], cfg, Date.now() + 30000, [{ id: `k${++n}`, key: `key${n}` }], { models: [`m${n}`] });
};

test("Gemini còn dùng được → KHÔNG đụng tới Claude và Groq", async () => {
  const { calls } = installFetch({ gemini: () => GEM_OK("gemini-ok"), claude: () => CLAUDE_OK("c"), groq: () => GROQ_OK("g") });
  const r = await run();
  assert.equal(r.text, "gemini-ok");
  assert.deepEqual([...new Set(calls)], ["gemini"]);
});

test("Gemini 503 hết → Claude trả lời, Groq KHÔNG được gọi", async () => {
  const { calls, bodies } = installFetch({ gemini: () => BAD(503, "high demand"), claude: () => CLAUDE_OK('{"messages":["ok"]}'), groq: () => GROQ_OK("g") });
  const r = await run();
  assert.equal(r.text, '{"messages":["ok"]}');
  assert.match(r.model, /^claude:/);
  assert.ok(!calls.includes("groq"), calls.join(","));
  assert.ok(r.errors.some((e) => e.includes("503")), "phải giữ lỗi Gemini để báo chủ shop");
  assert.match(bodies[0].system, /JSON/); // đã nhắc Claude chỉ trả JSON
  assert.equal(bodies[0].messages[0].role, "user");
  assert.ok(!("temperature" in bodies[0]), "Claude mới từ chối tham số temperature (HTTP 400)");
  assert.ok(!("top_p" in bodies[0]) && !("top_k" in bodies[0]));
});

test("Gemini + Claude đều lỗi → mới sang Groq (đúng thứ tự)", async () => {
  const { calls } = installFetch({ gemini: () => BAD(503), claude: () => BAD(529, "overloaded"), groq: () => GROQ_OK("groq-tra-loi") });
  const r = await run();
  assert.equal(r.text, "groq-tra-loi");
  assert.ok(calls.indexOf("claude") >= 0 && calls.indexOf("groq") > calls.lastIndexOf("claude"), calls.join(","));
  assert.ok(r.errors.some((e) => e.includes("Claude")), JSON.stringify(r.errors));
});

test("Claude hết tiền (credit balance) → bỏ qua Claude, sang Groq, lỗi được ghi lại", async () => {
  const { calls } = installFetch({
    gemini: () => BAD(429),
    claude: () => BAD(400, "Your credit balance is too low to access the Anthropic API"),
    groq: () => GROQ_OK("groq-ok"),
  });
  const r = await run();
  assert.equal(r.text, "groq-ok");
  assert.ok(r.errors.some((e) => /credit balance/i.test(e)), JSON.stringify(r.errors));
  assert.ok(calls.includes("groq"));
});

test("Cả 3 đều lỗi → text rỗng, có đủ lỗi của cả 3", async () => {
  installFetch({ gemini: () => BAD(503), claude: () => BAD(500), groq: () => BAD(500) });
  const r = await run();
  assert.equal(r.text, "");
  assert.ok(r.errors.some((e) => e.includes("Claude")) && r.errors.some((e) => e.includes("Groq")), JSON.stringify(r.errors));
});

test("toClaudeMessages: vai xen kẽ, tin đầu là của khách, không có khối chữ rỗng, ảnh gửi dạng base64", () => {
  const msgs = toClaudeMessages([
    { role: "model", parts: [{ text: "chào" }] },
    { role: "user", parts: [{ text: "a" }] },
    { role: "user", parts: [{ text: "b" }, { inlineData: { mimeType: "image/png", data: "AAAA" } }] },
    { role: "model", parts: [{ text: "" }, { text: "dạ" }] },
  ]);
  assert.equal(msgs[0].role, "user");
  assert.equal(msgs.at(-1).role, "user"); // Claude không nhận tin cuối của assistant
  for (let i = 1; i < msgs.length; i++) assert.notEqual(msgs[i].role, msgs[i - 1].role);
  assert.ok(msgs[0].content.some((b) => b.type === "image" && b.source.media_type === "image/png"));
  assert.ok(msgs.every((m) => m.content.every((b) => b.type !== "text" || b.text.trim())));
});

test("Claude: mặc định gửi effort=low; CLAUDE_EFFORT rỗng thì không gửi", async () => {
  const a = installFetch({ gemini: () => BAD(503), claude: () => CLAUDE_OK("{}"), groq: () => GROQ_OK("g") });
  await run();
  assert.deepEqual(a.bodies[0].output_config, { effort: "low" });
  process.env.CLAUDE_EFFORT = "";
  const b = installFetch({ gemini: () => BAD(503), claude: () => CLAUDE_OK("{}"), groq: () => GROQ_OK("g") });
  await run();
  assert.ok(!("output_config" in b.bodies[0]));
  delete process.env.CLAUDE_EFFORT;
});

test("Claude từ chối effort (400) → tự gọi lại KHÔNG có effort, khách vẫn nhận câu trả lời của Claude", async () => {
  let first = true;
  const { bodies } = installFetch({
    gemini: () => BAD(503),
    claude: () => (first ? ((first = false), BAD(400, "output_config.effort: not supported for this model")) : CLAUDE_OK('{"messages":["ok"]}')),
    groq: () => GROQ_OK("g"),
  });
  const r = await run();
  assert.match(r.model, /^claude:/);
  assert.equal(r.text, '{"messages":["ok"]}');
  assert.ok("output_config" in bodies[0] && !("output_config" in bodies[1]));
});
