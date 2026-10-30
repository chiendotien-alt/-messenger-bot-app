// lib/gemini.js — MỘT nơi duy nhất gọi Gemini cho cả bot (chat, câu bồi, tạo đơn, phân loại, dạy bot).
//
// BẢN CHỐNG TIMEOUT (26/10/2026). Khác bản cũ ở 5 điểm:
//  1) GỌI DỰ PHÒNG SONG SONG ("hedge"): gọi Gemini lần 1; nếu sau HEDGE_MS (mặc định 5s) chưa có chữ thì gọi THÊM 1 key/model khác
//     ngay (không hủy lần 1). Cái nào về trước thì dùng, cái còn lại bị hủy. Trước đây phải chờ hết 10s mới thử cái khác, lần lượt từng cái.
//  2) Mỗi lần gọi được chờ lâu hơn (20s) — vì đã có nhánh dự phòng chạy song song nên không còn phải cắt sớm (cắt 10s làm hỏng cả câu trả lời đang chạy bình thường).
//  3) TRÍ NHỚ DÙNG CHUNG qua Neon (bảng ai_health): máy chủ Vercel nào biết "model/key này đang lỗi" thì mọi máy khác cũng biết,
//     không còn cảnh mỗi máy mới tự đâm đầu vào cái đang hỏng rồi chờ timeout.
//  4) Có Groq thì Gemini chỉ được chạy tối đa GEMINI_PHASE_MAX_MS (mặc định 22s) rồi sang Groq (trước đây có thể chờ tới ~40s mới sang Groq).
//  5) "Cầu dao": Gemini hỏng/timeout cả loạt → 30s kế tiếp đi thẳng Groq, khách không phải chờ từng người một.
//  Ngoài ra: xoay vòng key (không dồn hết vào key đầu → đỡ dính 429), log rõ từng lần gọi mất bao lâu + bao nhiêu token suy nghĩ.
//
// KEY TRẢ PHÍ (30/10/2026): thứ tự là  key Gemini miễn phí (xoay vòng)  →  1 key Gemini TRẢ PHÍ (model gemini-3.6-flash)  →  Groq.
//  TIN KHÓ (30/10/2026): model mạnh được thử trên MỌI key miễn phí → key trả phí → rồi mới xuống model thường (xem callGemini).
//  Key trả phí dán ở nút 🔑 → "Gemini key trả phí" (hoặc biến GOOGLE_PAID_API_KEY). Chỉ được gọi khi MỌI key miễn phí đều lỗi/hết quota/timeout,
//  nên key miễn phí còn dùng được thì không tốn đồng nào. Key trả phí cũng lỗi → mới sang Groq. Không dán key trả phí thì chạy y như cũ.
//
// Quy tắc nghỉ khi lỗi (giữ như cũ):
//  - 429 (hết quota)      → nghỉ key đó (hết quota NGÀY thì nghỉ 30 phút, hết quota PHÚT thì theo thời gian Google báo, mặc định 60s)
//  - 503 (model quá tải)  → nghỉ cả model 45s, sang model kế tiếp
//  - 404 (model không có) → bỏ hẳn model đó 30 phút
//  - 401/403 (key sai)    → bỏ hẳn key đó 30 phút (mọi model)
//  - timeout              → nghỉ cặp model+key đó 20s; 2 key timeout liên tiếp → nghỉ cả model 30s
//  - 400 do thinkingConfig → gọi lại không kèm thinkingConfig (và nhớ model đó không nhận)
//  - Gemini hỏng hết      → Groq dự phòng (nếu có key Groq)
//
// Biến môi trường (KHÔNG bắt buộc, không đặt cũng chạy tốt):
//  GEMINI_MODEL, GEMINI_FALLBACK_MODELS="model-a,model-b"  danh sách model
//  GEMINI_ATTEMPT_TIMEOUT_MS (20000)  mỗi lần gọi chờ tối đa
//  GEMINI_HEDGE_MS (5000)             chờ bao lâu thì gọi thêm nhánh dự phòng song song; 0 = tắt
//  GEMINI_MAX_PARALLEL (3)            tối đa mấy lần gọi chạy cùng lúc
//  GEMINI_PHASE_MAX_MS (22000)        (khi có Groq) Gemini được chạy tối đa ngần này rồi sang Groq
//  GEMINI_CIRCUIT_MS (30000)          Gemini hỏng cả loạt thì nghỉ ngần này, đi thẳng Groq; 0 = tắt
//  GEMINI_THINKING_LEVEL              ép mức suy nghĩ (minimal / low / medium / high) — thường không cần
//  GEMINI_429_TRY_ALL_KEYS=0, GEMINI_TIMEOUT_MAX_KEYS (2)
//  GOOGLE_PAID_API_KEY                key trả phí (nếu không dán ở trang quản trị)
//  GEMINI_PAID_MODELS ("gemini-3.6-flash")  model dùng cho key trả phí (nhiều model thì ngăn cách bằng dấu phẩy)
//  GEMINI_FREE_PHASE_MS (14000)       (khi có key trả phí) key miễn phí được thử tối đa ngần này rồi sang key trả phí
//  GEMINI_PAID_PHASE_MS (16000)       key trả phí được thử tối đa ngần này rồi sang Groq
//  GEMINI_PAID_TIMEOUT_MS (14000)     mỗi lần gọi key trả phí chờ tối đa
//  GEMINI_PAID_RETRIES (1)            key trả phí gặp lỗi 503/timeout thì thử lại thêm mấy lần
import { callGroq, hasGroq } from "./groq";

// Free tier: 3.6-flash chỉ ~20 request/ngày → hết thì tự rơi xuống 3.5-flash, rồi 3.5-flash-lite.
const DEFAULT_MODEL_CHAIN = ["gemini-3.6-flash", "gemini-3.5-flash", "gemini-3.5-flash-lite"];
export const MODEL_CHAIN = [
  ...new Set(
    [
      process.env.GEMINI_MODEL,
      ...(process.env.GEMINI_FALLBACK_MODELS ? process.env.GEMINI_FALLBACK_MODELS.split(",") : DEFAULT_MODEL_CHAIN),
    ]
      .map((m) => (m || "").trim().replace(/^models\//, ""))
      .filter(Boolean)
  ),
];

const envNum = (name, def) => {
  const v = process.env[name];
  if (v === undefined || v === "") return def;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : def;
};
const TRY_ALL_KEYS_ON_429 = process.env.GEMINI_429_TRY_ALL_KEYS !== "0";
const MAX_TIMEOUT_KEYS = Math.max(1, envNum("GEMINI_TIMEOUT_MAX_KEYS", 2));
const ATTEMPT_TIMEOUT_MS = envNum("GEMINI_ATTEMPT_TIMEOUT_MS", 20000);
const HEDGE_MS = envNum("GEMINI_HEDGE_MS", 5000);
const MAX_PARALLEL = Math.max(1, envNum("GEMINI_MAX_PARALLEL", 3));
const PHASE_MAX_MS = envNum("GEMINI_PHASE_MAX_MS", 22000);
const CIRCUIT_MS = envNum("GEMINI_CIRCUIT_MS", 30000);
const THINKING_LEVEL = (process.env.GEMINI_THINKING_LEVEL || "").trim();

// ---- Key TRẢ PHÍ (dự phòng thứ 2, sau key miễn phí, trước Groq) ----
const PAID_MODELS = (process.env.GEMINI_PAID_MODELS || "gemini-3.6-flash")
  .split(",")
  .map((m) => m.trim().replace(/^models\//, ""))
  .filter(Boolean);
const FREE_PHASE_WITH_PAID_MS = envNum("GEMINI_FREE_PHASE_MS", 14000);
const PAID_PHASE_MAX_MS = envNum("GEMINI_PAID_PHASE_MS", 16000);
const PAID_TIMEOUT_MS = envNum("GEMINI_PAID_TIMEOUT_MS", 14000);
const PAID_RETRIES = Math.floor(envNum("GEMINI_PAID_RETRIES", 1));
const PAID_CACHE_MS = envNum("GEMINI_PAID_CACHE_MS", 20000);
const PAID_MIN_MS = 6000; // chừa tối thiểu cho key trả phí khi chia thời gian

// ---------------------------------------------------------------------------------------------
// Trí nhớ "đang lỗi": 1 lớp trong RAM của máy chủ này + 1 lớp dùng chung qua Neon (bảng ai_health).
// Khoá: m:<model> (model quá tải) | c:<model>::<keyId> (cặp model+key nghỉ) | b:<keyId> (key sai) | circuit (Gemini hỏng cả loạt)
// ---------------------------------------------------------------------------------------------
const local = new Map(); // khoá → thời điểm (ms) được thử lại
let shared = { at: 0, map: new Map() }; // bản chụp từ Neon, làm mới tối đa 2s/lần
let tableReady = null;
const noThinking = new Set(); // model từng báo "không nhận thinkingConfig"
const rr = new Map(); // model → số lần đã xoay key

const until = (k) => Math.max(local.get(k) || 0, shared.map.get(k) || 0);

const withTimeout = (p, ms, fallback) =>
  Promise.race([p, new Promise((r) => setTimeout(() => r(fallback), ms))]);

async function sqlOrNull() {
  try {
    const { getSql } = await import("./db");
    return await getSql();
  } catch {
    return null; // không có database → chạy bằng trí nhớ trong RAM như cũ
  }
}

async function ensureHealthTable(sql) {
  if (!tableReady) {
    tableReady = (async () => {
      await sql`CREATE TABLE IF NOT EXISTS ai_health (k TEXT PRIMARY KEY, until_ms BIGINT NOT NULL)`;
      await sql`DELETE FROM ai_health WHERE until_ms < ${Date.now() - 3600 * 1000}`;
    })().catch((e) => {
      tableReady = null;
      throw e;
    });
  }
  return tableReady;
}

/** Đọc trạng thái dùng chung từ Neon (tối đa chờ 1.2s, lỗi thì bỏ qua — không bao giờ làm chậm bot). */
async function loadShared() {
  if (Date.now() - shared.at < 2000) return;
  const job = (async () => {
    const sql = await sqlOrNull();
    if (!sql) return null;
    await ensureHealthTable(sql);
    const rows = await sql`SELECT k, until_ms FROM ai_health WHERE until_ms > ${Date.now()}`;
    return new Map(rows.map((r) => [r.k, Number(r.until_ms)]));
  })().catch(() => null);
  const map = await withTimeout(job, 1200, null);
  shared = { at: Date.now(), map: map || shared.map };
}

/** Ghi nhớ "k nghỉ tới thời điểm t" (RAM ngay, Neon thì đẩy vào danh sách chờ ghi). */
function setHealth(k, untilMs, writes) {
  local.set(k, Math.max(local.get(k) || 0, untilMs));
  shared.map.set(k, Math.max(shared.map.get(k) || 0, untilMs));
  writes.push(
    (async () => {
      const sql = await sqlOrNull();
      if (!sql) return;
      await ensureHealthTable(sql);
      await sql`INSERT INTO ai_health (k, until_ms) VALUES (${k}, ${untilMs})
                ON CONFLICT (k) DO UPDATE SET until_ms = GREATEST(ai_health.until_ms, EXCLUDED.until_ms)`;
    })().catch(() => {})
  );
}

const flushWrites = (writes) => withTimeout(Promise.allSettled(writes), 1500, null);

/** Nghỉ bao lâu sau lỗi 429: hết quota ngày → 30 phút; Google báo retryDelay → theo đó; không có thì 60 giây. */
function cooldownFor429(err) {
  const s = JSON.stringify(err || {});
  if (/PerDay/i.test(s)) return 30 * 60 * 1000;
  const m = s.match(/"retryDelay"\s*:\s*"(\d+(?:\.\d+)?)s"/);
  if (m) return Math.min(5 * 60 * 1000, Math.max(5000, Math.ceil(Number(m[1]) * 1000) + 1000));
  return 60 * 1000;
}

function adjustConfig(model, config) {
  if (!config?.thinkingConfig) return config;
  if (noThinking.has(model)) {
    const { thinkingConfig, ...rest } = config;
    return rest;
  }
  if (THINKING_LEVEL) return { ...config, thinkingConfig: { ...config.thinkingConfig, thinkingLevel: THINKING_LEVEL } };
  return config;
}

/**
 * MỘT lần gọi Gemini (1 model + 1 key). Không bao giờ throw. Trả về một trong:
 *  { kind: "ok", text, ms, usage } | { kind: "timeout" } | { kind: "net", message } | { kind: "cancelled" }
 *  { kind: "http", status, err } | { kind: "empty", finish, feedback }
 */
async function runAttempt(model, keyObj, systemPrompt, contents, generationConfig, timeoutMs, ctl) {
  let config = adjustConfig(model, generationConfig);
  for (let round = 0; round < 2; round++) {
    const t0 = Date.now();
    const ac = new AbortController();
    let timedOut = false;
    ctl.abort = () => ac.abort();
    const timer = setTimeout(() => {
      timedOut = true;
      ac.abort();
    }, timeoutMs);
    let res;
    let data;
    try {
      res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": keyObj.key || "" },
        body: JSON.stringify({
          ...(systemPrompt ? { systemInstruction: { parts: [{ text: systemPrompt }] } } : {}),
          contents,
          generationConfig: config,
        }),
        signal: ac.signal,
      });
      data = await res.json().catch(() => ({}));
    } catch (e) {
      if (ctl.cancelled) return { kind: "cancelled" };
      if (timedOut) return { kind: "timeout" };
      return { kind: "net", message: e.message };
    } finally {
      clearTimeout(timer);
    }
    if (ctl.cancelled) return { kind: "cancelled" };

    if (!res.ok) {
      const err = data.error || {};
      // Model này không nhận thinkingConfig → gọi lại ngay không kèm, không tính là lỗi
      if (res.status === 400 && config?.thinkingConfig && /think/i.test(err.message || "")) {
        noThinking.add(model);
        const { thinkingConfig, ...rest } = config;
        config = rest;
        continue;
      }
      return { kind: "http", status: res.status, err };
    }

    const cand = data.candidates?.[0];
    const text = cand?.content?.parts?.map((p) => p.text || "").join("") || "";
    if (text.trim()) return { kind: "ok", text, ms: Date.now() - t0, usage: data.usageMetadata || null };
    return { kind: "empty", finish: cand?.finishReason, feedback: data.promptFeedback || null };
  }
  return { kind: "http", status: 400, err: { message: "thinkingConfig" } };
}

/**
 * Gọi Gemini (KHÔNG có Groq). Trả { text, model }; text rỗng nếu mọi model + key đều lỗi (kèm slowFails = số lần timeout/lỗi mạng/5xx).
 * opts: models (danh sách model riêng), maxKeys (chỉ dùng N key đầu), timeoutMs (mỗi lần gọi), minRemainingMs (còn ít hơn thì dừng, mặc định 3000),
 *       hedgeMs (chờ bao lâu thì gọi thêm nhánh dự phòng; 0 = tắt),
 *       respectCooldown (true: key/model đang nghỉ thì bỏ qua hẳn, kể cả khi đó là model cuối — dùng cho bước "thử model mạnh trên mọi key")
 */
export async function callGeminiOnly(systemPrompt, contents, generationConfig, deadline, apiKeys, opts = {}) {
  const allKeys = apiKeys && apiKeys.length ? apiKeys : [{ id: "__none__", key: "" }];
  const keys = opts.maxKeys ? allKeys.slice(0, opts.maxKeys) : allKeys;
  const models = opts.models && opts.models.length ? opts.models : MODEL_CHAIN;
  const lastModel = models[models.length - 1];
  const perCallMs = opts.timeoutMs || ATTEMPT_TIMEOUT_MS;
  const minRemaining = opts.minRemainingMs ?? 3000;
  const hedgeMs = opts.hedgeMs ?? HEDGE_MS;

  await loadShared();
  const writes = [];

  // ---- Lập danh sách "model + key" sẽ thử, theo thứ tự ưu tiên ----
  const t = Date.now();
  let queue = [];
  models.forEach((model, mi) => {
    // Model vừa báo quá tải → bỏ qua; riêng model cuối luôn được thử (trừ khi opts.respectCooldown: tôn trọng thời gian nghỉ kể cả model cuối)
    if (until(`m:${model}`) > t && (model !== lastModel || opts.respectCooldown)) return;
    const usable = keys.filter((k) => until(`b:${k.id}`) <= t);
    let chain = usable.filter((k) => until(`c:${model}::${k.id}`) <= t);
    if (!chain.length) {
      if (model !== lastModel || opts.respectCooldown) return; // mọi key đang nghỉ với model này → sang model kế
      chain = usable.length ? usable : keys; // model cuối: thử lại hết
    }
    // Xoay vòng key để tải chia đều (không dồn hết vào key đầu → đỡ dính 429)
    const n = rr.get(model) || 0;
    rr.set(model, n + 1);
    const start = n % chain.length;
    const rotated = [...chain.slice(start), ...chain.slice(0, start)];
    rotated.forEach((keyObj, ki) => queue.push({ model, keyObj, mi, ki }));
  });
  // Thứ tự: (model tốt nhất, key 1) → (model tốt nhất, key 2) → (model 2, key 1) → ... — nhánh dự phòng luôn khác key hoặc khác model
  queue.sort((a, b) => a.ki + a.mi - (b.ki + b.mi) || a.mi - b.mi);

  const dropModel = (model) => {
    queue = queue.filter((c) => c.model !== model);
  };

  let slowFails = 0;
  const errs = []; // mô tả ngắn từng lỗi (để báo về Telegram)
  const alertPs = []; // việc báo lỗi đang chạy
  const timeoutsByModel = new Map();

  const result = await new Promise((resolve) => {
    let inflight = 0;
    let done = false;
    let hedgeTimer = null;
    const ctls = new Set();
    let launched = 0;

    const finish = (r) => {
      if (done) return;
      done = true;
      clearTimeout(hedgeTimer);
      for (const c of ctls) {
        c.cancelled = true;
        try {
          c.abort?.();
        } catch {}
      }
      resolve(r);
    };

    const scheduleHedge = () => {
      clearTimeout(hedgeTimer);
      if (done || !queue.length || hedgeMs <= 0) return;
      hedgeTimer = setTimeout(() => {
        if (done) return;
        if (inflight < MAX_PARALLEL) launch(true);
        else scheduleHedge();
      }, hedgeMs);
    };

    const launch = (isHedge) => {
      if (done) return;
      const cand = queue.shift();
      if (!cand) {
        if (inflight === 0) finish({ text: "", model: null, slowFails, errors: errs });
        return;
      }
      const remaining = deadline - Date.now();
      if (remaining < minRemaining) {
        console.warn("Hết thời gian dành cho AI, dừng thử.");
        queue = [];
        if (inflight === 0) finish({ text: "", model: null, slowFails, errors: errs });
        return;
      }
      const { model, keyObj } = cand;
      const ctl = { cancelled: false, abort: null };
      ctls.add(ctl);
      inflight++;
      launched++;
      if (isHedge) console.warn(`Gemini chậm → gọi thêm nhánh dự phòng song song: ${model} (key ${keyObj.id})`);
      runAttempt(model, keyObj, systemPrompt, contents, generationConfig, Math.min(perCallMs, remaining), ctl)
        .then((r) => onResult(cand, r, isHedge, ctl))
        .catch((e) => onResult(cand, { kind: "net", message: e.message }, isHedge, ctl));
      scheduleHedge();
    };

    const onResult = (cand, r, isHedge, ctl) => {
      inflight--;
      ctls.delete(ctl);
      if (done) return;
      const { model, keyObj } = cand;
      const ck = `c:${model}::${keyObj.id}`;
      const now = Date.now();

      if (r.kind === "ok") {
        const u = r.usage;
        console.log(
          `Gemini OK [${model}] (key ${keyObj.id}) ${(r.ms / 1000).toFixed(1)}s${isHedge ? " (nhánh dự phòng thắng)" : ""}` +
            (u ? ` | token vào ${u.promptTokenCount ?? "?"}, suy nghĩ ${u.thoughtsTokenCount ?? 0}, ra ${u.candidatesTokenCount ?? "?"}` : "")
        );
        finish({ text: r.text, model, slowFails, errors: errs });
        return;
      }

      if (r.kind === "timeout" || r.kind === "net") {
        slowFails++;
        const why = r.kind === "timeout" ? `timeout sau ${(perCallMs / 1000).toFixed(0)}s` : `lỗi mạng: ${r.message}`;
        console.error(`Gemini ${model} (key ${keyObj.id}) ${why}`);
        errs.push(`${model} (key ${keyObj.id}): ${why}`);
        setHealth(ck, now + 20 * 1000, writes);
        const n = (timeoutsByModel.get(model) || 0) + 1;
        timeoutsByModel.set(model, n);
        if (n >= MAX_TIMEOUT_KEYS) {
          setHealth(`m:${model}`, now + 30 * 1000, writes);
          dropModel(model);
        }
      } else if (r.kind === "http") {
        const { status, err } = r;
        console.error(`Lỗi Gemini API [${model}] (key ${keyObj.id}) HTTP ${status}:`, JSON.stringify(err));
        errs.push(`${model} (key ${keyObj.id}): HTTP ${status} ${String(err.message || "").slice(0, 160)}`);
        if (status === 401 || status === 403) {
          // Key sai/bị khoá → báo về Telegram (mỗi key tối đa 6 giờ / lần)
          alertPs.push(
            import("./alert")
              .then((m) =>
                m.reportError(`gemini_key_bad_${keyObj.id}`, "Key Gemini bị từ chối (sai hoặc bị khoá)", {
                  "Key": keyObj.id === "env" ? "GOOGLE_API_KEY (biến môi trường)" : `key thêm ở trang quản trị, id ${keyObj.id}`,
                  "Model": model,
                  "Google báo": `HTTP ${status} ${String(err.message || "").slice(0, 200)}`,
                  "Cách xử lý": "Vào trang quản trị → nút 🔑 kiểm tra/đổi key này.",
                }, { gapMs: 6 * 60 * 60 * 1000 })
              )
              .catch(() => {})
          );
          setHealth(`b:${keyObj.id}`, now + 30 * 60 * 1000, writes); // key sai/bị khoá — nghỉ lâu, mọi model
          queue = queue.filter((c) => c.keyObj.id !== keyObj.id);
        } else if (status === 404) {
          setHealth(`m:${model}`, now + 30 * 60 * 1000, writes); // tên model sai/đã tắt
          dropModel(model);
        } else if (status === 429) {
          const wait = cooldownFor429(err);
          setHealth(ck, now + wait, writes);
          if (!TRY_ALL_KEYS_ON_429) {
            for (const k of keys) setHealth(`c:${model}::${k.id}`, now + wait, writes);
            dropModel(model);
          }
        } else if (status === 503) {
          slowFails++;
          setHealth(`m:${model}`, now + 45 * 1000, writes); // "quá tải" là lỗi của CẢ model — đổi key không giúp
          dropModel(model);
        } else if (status >= 500) {
          slowFails++;
          setHealth(ck, now + 15 * 1000, writes);
        }
      } else if (r.kind === "empty") {
        console.warn(
          `Gemini ${model} (key ${keyObj.id}) không trả nội dung. finishReason=${r.finish} promptFeedback=${JSON.stringify(r.feedback || null)}`
        );
        errs.push(`${model} (key ${keyObj.id}): trả rỗng (finishReason=${r.finish})`);
        dropModel(model); // rỗng → thử model kế tiếp (không phải lỗi key)
      }
      // r.kind === "cancelled": không làm gì

      // Hết nhánh nào đang chạy → thử ngay cái kế tiếp (không chờ); còn nhánh khác đang chạy thì giữ nhịp dự phòng
      if (inflight === 0) launch(false);
      else scheduleHedge();
    };

    launch(false);
  });

  await flushWrites(writes);
  if (alertPs.length) await withTimeout(Promise.allSettled(alertPs), 4500, null);
  return result;
}

// Key trả phí: đọc từ database (cache ngắn để không truy vấn mỗi tin). null = chưa có key trả phí.
let paidCache = { at: 0, key: null };

/** @returns {Promise<{id: string, key: string} | null>} id luôn bắt đầu bằng "paid-" để sổ "key đang nghỉ" không lẫn với key miễn phí (cũng có id "env"). */
export async function getPaidKey() {
  if (PAID_CACHE_MS > 0 && Date.now() - paidCache.at < PAID_CACHE_MS) return paidCache.key;
  let keys = null;
  try {
    const m = await import("./apiKeys");
    keys = await withTimeout(m.getPaidRawKeys(), 2000, null);
  } catch {
    keys = null; // không đọc được DB → thử biến môi trường
  }
  let first = keys && keys[0] ? keys[0] : null;
  if (!first && keys === null) {
    const envKey = String(process.env.GOOGLE_PAID_API_KEY || "").trim();
    if (envKey.length > 10) first = { id: "env", key: envKey };
  }
  const key = first ? { id: `paid-${first.id}`, key: first.key } : null;
  // đọc DB hỏng/chậm thì chỉ nhớ 3s để lần sau đọc lại sớm
  paidCache = { at: keys === null ? Date.now() - Math.max(0, PAID_CACHE_MS - 3000) : Date.now(), key };
  return key;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Gọi Gemini bằng key TRẢ PHÍ (chỉ 1 key, model trong GEMINI_PAID_MODELS, mặc định gemini-3.6-flash).
 * Trả null nếu chưa có key trả phí; còn lại trả { text, model, errors } (text rỗng nếu lỗi).
 * Lỗi tạm thời (503 quá tải / timeout / 5xx) thì thử lại GEMINI_PAID_RETRIES lần; hết quota / key sai thì không thử lại.
 * opts: groqOn (có Groq chờ phía sau → chừa thời gian cho nó), groqReserveMs, paidMaxMs
 */
export async function callGeminiPaid(systemPrompt, contents, generationConfig, deadline, opts = {}) {
  const paid = await getPaidKey();
  if (!paid) return null;
  const reserve = opts.groqOn ? opts.groqReserveMs ?? 4000 : 0;
  const errors = [];
  const end = Math.min(deadline - reserve, Date.now() + (opts.paidMaxMs ?? PAID_PHASE_MAX_MS)); // mốc kết thúc cho CẢ giai đoạn key trả phí (kể cả thử lại)
  for (let i = 0; i <= PAID_RETRIES; i++) {
    if (end - Date.now() < 3000) {
      errors.push("[key trả phí] không còn đủ thời gian để thử");
      break;
    }
    const r = await callGeminiOnly(systemPrompt, contents, generationConfig, end, [paid], {
      models: PAID_MODELS,
      maxKeys: 1,
      timeoutMs: Math.min(PAID_TIMEOUT_MS, end - Date.now()),
      hedgeMs: 0, // chỉ 1 key + 1 model, không có nhánh song song để gọi thêm
    });
    if ((r.text || "").trim()) return { text: r.text, model: r.model, errors };
    errors.push(...(r.errors || []).map((e) => `[key trả phí] ${e}`));
    if (!(r.slowFails > 0)) break; // hết quota / key sai / trả rỗng: thử lại cũng vô ích
    if (i < PAID_RETRIES) await sleep(800);
  }
  return { text: "", model: null, errors };
}

/** Báo Telegram (tối đa 1 lần / giờ) để chủ shop biết bot đang tốn tiền key trả phí. */
async function alertPaidUsed(model, freeErrors) {
  try {
    const m = await import("./alert");
    await withTimeout(
      m.reportError(
        "ai_paid_key_used",
        "Bot đang dùng key Gemini TRẢ PHÍ (các key miễn phí đều lỗi/hết hạn mức)",
        { "Model": model, "Lỗi của các key miễn phí": (freeErrors || []).join("\n") || "(không có chi tiết)" },
        { gapMs: 60 * 60 * 1000 }
      ),
      4000,
      null
    );
  } catch {
    /* không báo được thì thôi, không ảnh hưởng việc trả lời khách */
  }
}

/** Cầu dao: Gemini vừa hỏng/timeout cả loạt → còn hiệu lực thì đi thẳng Groq. */
async function circuitOpen() {
  if (CIRCUIT_MS <= 0) return false;
  await loadShared();
  return until("circuit") > Date.now();
}

/**
 * Thứ tự: key Gemini miễn phí → (nếu có) 1 key Gemini TRẢ PHÍ → Groq dự phòng (nếu có). Trả { text, model, errors }.
 *
 * TIN KHÓ (opts.strongFirst + opts.models = [model mạnh, ...model thường]): model mạnh (3.6-flash) được thử trên TẤT CẢ key miễn phí,
 *   rồi tới key trả phí (cũng 3.6-flash), rồi MỚI xuống model thường trên key miễn phí, cuối cùng Groq.
 *   (Trước đây thứ tự xen kẽ: 3.6/key1 → 3.6/key2 → model thường/key1 ... nên chỉ thử 2 key 3.6 rồi tụt xuống model yếu dù các key còn lại còn quota.)
 * TIN DỄ: giữ nguyên như cũ (danh sách model mặc định, xen kẽ key/model).
 *
 * opts (ngoài các opts của callGeminiOnly): groqReserveMs (chừa cho Groq, mặc định 4000), groqSystem (system riêng cho Groq),
 * groqMinMs (Groq được ít nhất ngần này ms, mặc định 3500), groqTimeoutMs (mặc định 9000), geminiMaxMs (key miễn phí được chạy tối đa, mặc định GEMINI_PHASE_MAX_MS
 * hoặc GEMINI_FREE_PHASE_MS khi có key trả phí), strongFirst (xem trên)
 */
export async function callGemini(systemPrompt, contents, generationConfig, deadline, apiKeys, opts = {}) {
  const groqOn = await hasGroq();
  const paid = await getPaidKey();
  const reserveMs = opts.groqReserveMs ?? 4000;
  const strongFirst = !!opts.strongFirst && Array.isArray(opts.models) && opts.models.length > 1;
  const { strongFirst: _sf, ...baseOpts } = opts;

  let r = { text: "", model: null, errors: [], slowFails: 0 };
  let lastFree = null; // kết quả bước key miễn phí gần nhất
  const skipFree = (groqOn || !!paid) && (await circuitOpen());
  if (skipFree) {
    console.warn(`Gemini miễn phí đang hỏng cả loạt (cầu dao) → đi thẳng ${paid ? "key trả phí" : "Groq"} cho nhanh.`);
    r.errors = [`Key Gemini miễn phí vừa hỏng cả loạt ở tin trước nên bot tạm bỏ qua chúng (cầu dao, tối đa ${Math.round(CIRCUIT_MS / 1000)} giây)`];
  } else {
    // Cửa sổ thời gian cho các key miễn phí
    let phaseEnd = deadline;
    if (paid) {
      // Chia thời gian: key miễn phí tối đa FREE_PHASE (hoặc ~55% thời gian còn lại), phần còn lại dành cho key trả phí + Groq
      const avail = deadline - Date.now() - (groqOn ? reserveMs : 0);
      phaseEnd = Date.now() + Math.max(2500, Math.min(opts.geminiMaxMs ?? FREE_PHASE_WITH_PAID_MS, avail - PAID_MIN_MS, avail * 0.55));
    } else if (groqOn) {
      phaseEnd = Math.min(deadline - reserveMs, Date.now() + (opts.geminiMaxMs ?? PHASE_MAX_MS));
    }

    if (strongFirst) {
      // Bước A: model mạnh trên mọi key miễn phí (key/model đang nghỉ thì bỏ qua, khỏi gọi lại cái vừa báo hết quota)
      const strong = opts.models[0];
      lastFree = await callGeminiOnly(systemPrompt, contents, generationConfig, phaseEnd, apiKeys, { ...baseOpts, models: [strong], respectCooldown: true });
    } else {
      lastFree = await callGeminiOnly(systemPrompt, contents, generationConfig, phaseEnd, apiKeys, baseOpts);
    }
    r = { ...lastFree, errors: [...(lastFree.errors || [])], slowFails: lastFree.slowFails || 0 };
    if ((r.text || "").trim()) return r;
    if (!groqOn && !paid && !strongFirst) return r;

    // Key miễn phí hỏng cả loạt vì chậm/lỗi mạng/quá tải (không phải chỉ hết quota) → bật cầu dao ít giây để khách sau khỏi chờ
    if ((groqOn || paid) && CIRCUIT_MS > 0 && (r.slowFails || 0) >= 2) {
      const writes = [];
      setHealth("circuit", Date.now() + CIRCUIT_MS, writes);
      await flushWrites(writes);
    }
  }

  // ---- Bước B: key Gemini TRẢ PHÍ (3.6-flash) ----
  if (paid) {
    console.warn("Key Gemini miễn phí không trả lời được → thử key TRẢ PHÍ.");
    const p = await callGeminiPaid(systemPrompt, contents, generationConfig, deadline, { groqOn, groqReserveMs: reserveMs });
    if (p && (p.text || "").trim()) {
      console.warn(`💰 Câu trả lời này dùng key Gemini TRẢ PHÍ (${p.model}).`);
      await alertPaidUsed(p.model, r.errors);
      return { text: p.text, model: p.model, errors: r.errors || [], paid: true };
    }
    if (p) r = { ...r, errors: [...(r.errors || []), ...p.errors] };
  }

  // ---- Bước C (chỉ tin khó): model mạnh hết đường → model thường trên key miễn phí ----
  // Bỏ qua nếu key miễn phí đang hỏng cả loạt (chậm/quá tải) — gọi tiếp cũng vô ích, đi Groq cho nhanh.
  if (strongFirst && !skipFree && (lastFree?.slowFails || 0) < 2) {
    const weaker = opts.models.slice(1);
    const end = groqOn ? Math.min(deadline - reserveMs, Date.now() + (opts.geminiMaxMs ?? PHASE_MAX_MS)) : deadline;
    if (weaker.length && end - Date.now() >= 3000) {
      console.warn(`Tin khó: ${opts.models[0]} hết đường → thử model thường (${weaker.join(", ")}).`);
      const w = await callGeminiOnly(systemPrompt, contents, generationConfig, end, apiKeys, { ...baseOpts, models: weaker });
      if ((w.text || "").trim()) return { ...w, errors: [...(r.errors || []), ...(w.errors || [])] };
      r = { ...r, errors: [...(r.errors || []), ...(w.errors || [])] };
    }
  }
  if (!groqOn) return { text: "", model: null, errors: r.errors || [] };

  // ---- Bước D: Groq dự phòng ----
  console.warn(paid ? "Key trả phí cũng không trả lời được → thử Groq dự phòng." : "Gemini không trả lời được → thử Groq dự phòng.");
  const g = await callGroq({
    system: opts.groqSystem ?? systemPrompt,
    contents,
    json: generationConfig?.responseMimeType === "application/json",
    maxTokens: generationConfig?.maxOutputTokens || 2048,
    temperature: generationConfig?.temperature ?? 0.8,
    deadline: Math.max(deadline, Date.now() + (opts.groqMinMs ?? 3500)),
    timeoutMs: opts.groqTimeoutMs ?? 9000,
  });
  const errors = [...(r.errors || [])];
  if (!g.text) errors.push("Groq cũng không trả lời được (kiểm tra key Groq / model Groq)");
  return g.text ? { text: g.text, model: g.model, errors } : { text: "", model: null, errors };
}

/** Gọi nhanh trả JSON dạng chữ (dùng cho câu bồi...). Giữ tên cũ để nơi gọi không phải sửa. */
export async function askGeminiJson({ system, text, keys, budgetMs = 15000 }) {
  const r = await callGemini(
    system,
    [{ role: "user", parts: [{ text }] }],
    { temperature: 0.9, maxOutputTokens: 1024, responseMimeType: "application/json", thinkingConfig: { thinkingLevel: "low" } },
    Date.now() + budgetMs,
    keys,
    { timeoutMs: 9000, groqReserveMs: 4500, groqTimeoutMs: 8000 }
  );
  return r.text || "";
}
