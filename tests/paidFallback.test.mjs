// Thứ tự dự phòng: key Gemini miễn phí → key Gemini TRẢ PHÍ (gemini-3.6-flash) → Groq.
// Dùng fetch giả, không gọi mạng thật, không cần database.
import test from "node:test";
import assert from "node:assert/strict";

// Cấu hình TRƯỚC khi nạp lib/gemini.js (các hằng số đọc env lúc nạp)
process.env.GEMINI_CIRCUIT_MS = "0"; // tắt cầu dao để các test không ảnh hưởng nhau
process.env.GEMINI_HEDGE_MS = "0";
process.env.GEMINI_PAID_CACHE_MS = "0"; // đọc lại key trả phí mỗi lần để test bật/tắt được
process.env.GROQ_API_KEY = "gsk_testtesttesttest";
delete process.env.GOOGLE_PAID_API_KEY;

const { callGemini } = await import("../lib/gemini.js");

const PAID = "AIzaPAIDKEYPAIDKEYPAIDKEY0001";
const GOOD = (t) => ({ ok: true, status: 200, headers: new Headers(), json: async () => ({ candidates: [{ content: { parts: [{ text: t }] } }] }) });
const BAD = (status, msg = "x") => ({ ok: false, status, headers: new Headers(), json: async () => ({ error: { message: msg } }) });

/** Cài fetch giả. rules: { free(key,model) -> res, paid(model, n) -> res, groq() -> res } */
function installFetch(rules) {
  const calls = [];
  const paidCalls = { n: 0 };
  globalThis.fetch = async (url, init = {}) => {
    const u = String(url);
    const key = init.headers?.["x-goog-api-key"];
    if (u.includes("generativelanguage.googleapis.com")) {
      const model = u.match(/models\/([^:]+):/)[1];
      if (key === PAID) {
        paidCalls.n++;
        calls.push(`paid:${model}`);
        return rules.paid(model, paidCalls.n);
      }
      calls.push(`free:${key}`);
      return rules.free(key, model);
    }
    if (u.includes("api.groq.com")) {
      calls.push("groq");
      return rules.groq ? rules.groq() : { ok: true, status: 200, headers: new Headers(), json: async () => ({ choices: [{ message: { content: "groq-tra-loi" } }] }) };
    }
    throw new Error("URL lạ: " + u);
  };
  return calls;
}

const run = (freeIds, extra = {}) =>
  callGemini(
    "system",
    [{ role: "user", parts: [{ text: "hi" }] }],
    { maxOutputTokens: 100 },
    Date.now() + 30000,
    freeIds.map((id) => ({ id, key: id + "-key" })),
    { models: ["gemini-3.6-flash"], ...extra }
  );

test("key miễn phí còn dùng được → KHÔNG đụng tới key trả phí", async () => {
  process.env.GOOGLE_PAID_API_KEY = PAID;
  const calls = installFetch({ free: () => GOOD("free-ok"), paid: () => GOOD("paid-ok") });
  const r = await run(["a1"]);
  assert.equal(r.text, "free-ok");
  assert.ok(!calls.some((c) => c.startsWith("paid")), calls.join(","));
});

test("mọi key miễn phí 429/503/timeout → chuyển sang key trả phí, model gemini-3.6-flash", async () => {
  process.env.GOOGLE_PAID_API_KEY = PAID;
  const calls = installFetch({ free: () => BAD(429), paid: () => GOOD("paid-ok") });
  const r = await run(["b1", "b2"]);
  assert.equal(r.text, "paid-ok");
  assert.equal(r.paid, true);
  assert.ok(calls.includes("paid:gemini-3.6-flash"), calls.join(","));
  assert.ok(!calls.includes("groq"));
});

test("key trả phí cũng lỗi (hết quota) → mới sang Groq, và lỗi của key trả phí có trong danh sách lỗi", async () => {
  process.env.GOOGLE_PAID_API_KEY = PAID;
  const calls = installFetch({ free: () => BAD(429), paid: () => BAD(429, "spend cap") });
  const r = await run(["c1"]);
  assert.match(r.text, /groq-tra-loi/);
  assert.ok(calls.indexOf("groq") > calls.findIndex((c) => c.startsWith("paid")), calls.join(","));
  assert.ok((r.errors || []).some((e) => e.includes("[key trả phí]")), JSON.stringify(r.errors));
});

test("key trả phí gặp 503 một lần rồi ổn → thử lại và vẫn dùng được (không rơi xuống Groq)", async () => {
  process.env.GOOGLE_PAID_API_KEY = PAID;
  const calls = installFetch({ free: () => BAD(503), paid: (m, n) => (n === 1 ? BAD(503) : GOOD("paid-retry-ok")) });
  const r = await run(["d1"]);
  assert.equal(r.text, "paid-retry-ok");
  assert.ok(!calls.includes("groq"));
});

test("chưa dán key trả phí → chạy y như cũ: key miễn phí lỗi thì sang Groq", async () => {
  delete process.env.GOOGLE_PAID_API_KEY;
  const calls = installFetch({ free: () => BAD(429), paid: () => GOOD("không được gọi") });
  const r = await run(["e1"]);
  assert.match(r.text, /groq-tra-loi/);
  assert.ok(!calls.some((c) => c.startsWith("paid")), calls.join(","));
});

test("key trả phí sai (401) → không thử lại vô ích, sang Groq", async () => {
  process.env.GOOGLE_PAID_API_KEY = PAID;
  const calls = installFetch({ free: () => BAD(429), paid: () => BAD(401, "API key not valid") });
  const r = await run(["f1"]);
  assert.match(r.text, /groq-tra-loi/);
  assert.equal(calls.filter((c) => c.startsWith("paid")).length, 1, calls.join(","));
});

// ---------------- TIN KHÓ: model mạnh thử hết key miễn phí → key trả phí → rồi mới xuống model thường ----------------
// Mỗi test dùng TÊN model riêng (trạng thái "model đang nghỉ" được nhớ chung trong cả tiến trình test); key trả phí luôn dùng gemini-3.6-flash.
const hard = (ids, strong, weak) => run(ids, { models: [strong, weak], strongFirst: true });
const PER_DAY = "Quota exceeded GenerateRequestsPerDayPerProjectPerModel-FreeTier";

test("tin khó, 3.6 hết ở 2 key đầu nhưng 3 key sau còn → vẫn trả lời bằng model mạnh (không tụt xuống model yếu)", async () => {
  process.env.GOOGLE_PAID_API_KEY = PAID;
  const S = "strong-A";
  const calls = installFetch({
    free: (key, model) => (model === S && /^(h1|h2)-/.test(key) ? BAD(429) : GOOD(`ok-${model}`)),
    paid: () => GOOD("paid-ok"),
  });
  const r = await hard(["h1", "h2", "h3", "h4", "h5"], S, "weak-A");
  assert.equal(r.text, `ok-${S}`);
  assert.ok(!calls.some((c) => c.startsWith("paid")), "chưa cần tới key trả phí: " + calls.join(","));
});

test("tin khó, 3.6 hết ở CẢ 5 key miễn phí → thử đủ 5 key, rồi key trả phí (3.6), KHÔNG xuống model yếu", async () => {
  process.env.GOOGLE_PAID_API_KEY = PAID;
  const S = "strong-B";
  const calls = installFetch({ free: (key, model) => (model === S ? BAD(429) : GOOD("weak-ok")), paid: () => GOOD("paid-3.6") });
  const r = await hard(["i1", "i2", "i3", "i4", "i5"], S, "weak-B");
  assert.equal(r.text, "paid-3.6");
  assert.equal(calls.filter((c) => c.startsWith("free:i")).length, 5, calls.join(","));
  assert.ok(calls.includes("paid:gemini-3.6-flash"));
  assert.ok(!calls.some((c) => c.includes("weak")));
});

test("tin khó, không có key trả phí: thử đủ 5 key model mạnh rồi mới xuống model thường", async () => {
  delete process.env.GOOGLE_PAID_API_KEY;
  const S = "strong-C";
  const calls = installFetch({ free: (key, model) => (model === S ? BAD(429) : GOOD("weak-ok")), paid: () => GOOD("không gọi") });
  const r = await hard(["j1", "j2", "j3", "j4", "j5"], S, "weak-C");
  assert.equal(r.text, "weak-ok");
  assert.equal(calls.length, 6, calls.join(","));
  assert.ok(calls.every((c) => c.startsWith("free:j")));
});

test("tin khó: key vừa báo hết quota NGÀY thì tin sau không gọi lại model mạnh trên key đó, đi thẳng key trả phí", async () => {
  process.env.GOOGLE_PAID_API_KEY = PAID;
  const S = "strong-D";
  installFetch({ free: (key, model) => (model === S ? BAD(429, PER_DAY) : GOOD("weak-ok")), paid: () => GOOD("paid-3.6") });
  await hard(["k1", "k2"], S, "weak-D"); // tin 1: 2 key đều báo hết quota ngày → bị cho nghỉ
  const calls = installFetch({ free: (key, model) => (model === S ? BAD(429, PER_DAY) : GOOD("weak-ok")), paid: () => GOOD("paid-3.6") });
  const r = await hard(["k1", "k2"], S, "weak-D"); // tin 2
  assert.equal(r.text, "paid-3.6");
  assert.deepEqual(calls, ["paid:gemini-3.6-flash"], calls.join(","));
});

test("tin khó: model mạnh hết quota ở mọi key, key trả phí cũng lỗi → rồi mới xuống model thường trên key miễn phí", async () => {
  process.env.GOOGLE_PAID_API_KEY = PAID;
  const S = "strong-E";
  const calls = installFetch({ free: (key, model) => (model === S ? BAD(429) : GOOD("weak-ok")), paid: () => BAD(429, "spend cap") });
  const r = await hard(["m1", "m2"], S, "weak-E");
  assert.equal(r.text, "weak-ok");
  const paidAt = calls.findIndex((c) => c.startsWith("paid"));
  assert.ok(paidAt >= 2, "key trả phí phải được thử SAU khi model mạnh đã thử hết key miễn phí: " + calls.join(","));
  assert.ok(calls.length > paidAt + 1 && calls[calls.length - 1].startsWith("free:"), "model thường chỉ chạy sau key trả phí: " + calls.join(","));
});

test("tin DỄ (không strongFirst) giữ nguyên cách cũ", async () => {
  delete process.env.GOOGLE_PAID_API_KEY;
  const S = "strong-F";
  const calls = installFetch({ free: (key, model) => (model === S ? BAD(429) : GOOD("weak-ok")), paid: () => GOOD("không gọi") });
  const r = await run(["l1", "l2", "l3"], { models: [S, "weak-F"] });
  assert.equal(r.text, "weak-ok");
  assert.ok(calls.length <= 4, calls.join(","));
});
