// lib/gemini.js — MỘT nơi duy nhất gọi Gemini cho cả bot (chat, câu bồi, tạo đơn, phân loại, dạy bot).
//
// BẢN CHỐNG TIMEOUT (26/10/2026, sửa thêm 31/10/2026: nhánh dự phòng luôn đổi sang MODEL KHÁC — xem mục 6). Khác bản cũ ở 5 điểm:
//  1) GỌI DỰ PHÒNG SONG SONG ("hedge"): gọi Gemini lần 1; nếu sau HEDGE_MS (mặc định 5s) chưa có chữ thì gọi THÊM 1 key/model khác
//     ngay (không hủy lần 1). Cái nào về trước thì dùng, cái còn lại bị hủy. Trước đây phải chờ hết 10s mới thử cái khác, lần lượt từng cái.
//  2) Mỗi lần gọi được chờ lâu hơn (20s) — vì đã có nhánh dự phòng chạy song song nên không còn phải cắt sớm (cắt 10s làm hỏng cả câu trả lời đang chạy bình thường).
//  3) TRÍ NHỚ DÙNG CHUNG qua Neon (bảng ai_health): máy chủ Vercel nào biết "model/key này đang lỗi" thì mọi máy khác cũng biết,
//     không còn cảnh mỗi máy mới tự đâm đầu vào cái đang hỏng rồi chờ timeout.
//  4) Có Groq thì Gemini chỉ được chạy tối đa GEMINI_PHASE_MAX_MS (mặc định 22s) rồi sang Groq (trước đây có thể chờ tới ~40s mới sang Groq).
//  5) "Cầu dao": Gemini hỏng/timeout cả loạt → 30s kế tiếp đi thẳng Groq, khách không phải chờ từng người một.
//  6) (31/10) Nhánh dự phòng song song ƯU TIÊN MODEL KHÁC model đang bị treo. Log 31/10: gemini-3.5-flash treo ở cả 3 key (key env, 6, 7) cùng lúc → treo là lỗi của CẢ model
//     phía Google, đổi key không cứu được; trước đây nhánh dự phòng vẫn đâm vào đúng model đó bằng key khác nên cả 3 cùng treo tới 20s rồi mới sang Groq.
//  Ngoài ra: xoay vòng key (không dồn hết vào key đầu → đỡ dính 429), log rõ từng lần gọi mất bao lâu + bao nhiêu token suy nghĩ.
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
import { callGroq, hasGroq } from "./groq";

// Mọi tin dùng 3.5-flash-lite trước (500 lượt/ngày, nhanh). Lỗi/hết quota/quá tải → 3.8-flash → 3.6-flash (hai model này free chỉ ~20 lượt/ngày nên để cuối).
const DEFAULT_MODEL_CHAIN = ["gemini-3.5-flash-lite", "gemini-3.8-flash", "gemini-3.6-flash"];
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
      if (timedOut) return { kind: "timeout", ms: timeoutMs };
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
 *       hedgeMs (chờ bao lâu thì gọi thêm nhánh dự phòng; 0 = tắt)
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
    // Model vừa báo quá tải → bỏ qua; riêng model cuối luôn được thử
    if (until(`m:${model}`) > t && model !== lastModel) return;
    const usable = keys.filter((k) => until(`b:${k.id}`) <= t);
    let chain = usable.filter((k) => until(`c:${model}::${k.id}`) <= t);
    if (!chain.length) {
      if (model !== lastModel) return; // mọi key đang nghỉ với model này → sang model kế
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
    const inflightModels = new Map(); // model → số lần gọi đang chạy (để nhánh dự phòng chọn model KHÁC)
    const addFlight = (m) => inflightModels.set(m, (inflightModels.get(m) || 0) + 1);
    const delFlight = (m) => {
      const n = (inflightModels.get(m) || 0) - 1;
      if (n > 0) inflightModels.set(m, n);
      else inflightModels.delete(m);
    };
    // Nhánh dự phòng: ưu tiên (model, key) có MODEL chưa đang chạy; không còn model nào khác thì mới dùng key khác của cùng model
    const pickNext = (isHedge) => {
      if (isHedge && inflightModels.size) {
        const i = queue.findIndex((c) => !inflightModels.has(c.model));
        if (i >= 0) return queue.splice(i, 1)[0];
      }
      return queue.shift();
    };

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
      const cand = pickNext(isHedge);
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
      addFlight(model);
      if (isHedge) console.warn(`Gemini chậm → gọi thêm nhánh dự phòng song song: ${model} (key ${keyObj.id})`);
      runAttempt(model, keyObj, systemPrompt, contents, generationConfig, Math.min(perCallMs, remaining), ctl)
        .then((r) => onResult(cand, r, isHedge, ctl))
        .catch((e) => onResult(cand, { kind: "net", message: e.message }, isHedge, ctl));
      scheduleHedge();
    };

    const onResult = (cand, r, isHedge, ctl) => {
      inflight--;
      delFlight(cand.model);
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
        const why = r.kind === "timeout" ? `timeout sau ${((r.ms || perCallMs) / 1000).toFixed(0)}s` : `lỗi mạng: ${r.message}`;
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

/** Cầu dao: Gemini vừa hỏng/timeout cả loạt → còn hiệu lực thì đi thẳng Groq. */
async function circuitOpen() {
  if (CIRCUIT_MS <= 0) return false;
  await loadShared();
  return until("circuit") > Date.now();
}

/**
 * Gemini trước; hỏng hết → Groq dự phòng (nếu có). Trả { text, model }.
 * opts (ngoài các opts của callGeminiOnly): groqReserveMs (chừa cho Groq, mặc định 4000), groqSystem (system riêng cho Groq),
 * groqMinMs (Groq được ít nhất ngần này ms, mặc định 3500), groqTimeoutMs (mặc định 9000), geminiMaxMs (Gemini được chạy tối đa, mặc định GEMINI_PHASE_MAX_MS)
 */
export async function callGemini(systemPrompt, contents, generationConfig, deadline, apiKeys, opts = {}) {
  const groqOn = await hasGroq();

  let r = { text: "", model: null, errors: [] };
  const skipGemini = groqOn && (await circuitOpen());
  if (skipGemini) {
    console.warn("Gemini đang hỏng cả loạt (cầu dao) → đi thẳng Groq cho nhanh.");
    r.errors = ["Gemini vừa hỏng cả loạt ở tin trước nên bot tạm đi thẳng Groq (cầu dao, tối đa 30 giây)"];
  } else {
    const phaseEnd = groqOn
      ? Math.min(deadline - (opts.groqReserveMs ?? 4000), Date.now() + (opts.geminiMaxMs ?? PHASE_MAX_MS))
      : deadline;
    r = await callGeminiOnly(systemPrompt, contents, generationConfig, phaseEnd, apiKeys, opts);
    if ((r.text || "").trim() || !groqOn) return r;

    // Gemini hỏng cả loạt vì chậm/lỗi mạng/quá tải (không phải chỉ hết quota) → bật cầu dao ít giây để khách sau khỏi chờ
    if (CIRCUIT_MS > 0 && (r.slowFails || 0) >= 2) {
      const writes = [];
      setHealth("circuit", Date.now() + CIRCUIT_MS, writes);
      await flushWrites(writes);
    }
  }

  console.warn("Gemini không trả lời được → thử Groq dự phòng.");
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
