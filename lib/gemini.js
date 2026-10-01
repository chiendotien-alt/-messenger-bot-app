// lib/gemini.js — gọi Gemini đơn giản (dùng cho việc nhắc khách quay lại).
// Thử lần lượt từng model × từng API key, hết thời gian thì trả chuỗi rỗng.

const MODELS = ["gemini-3.6-flash", "gemini-3.5-flash", "gemini-3.5-flash-lite"];

export async function askGeminiJson({ system, text, keys, budgetMs = 15000 }) {
  const t0 = Date.now();
  for (const model of MODELS) {
    for (const k of keys || []) {
      const remaining = budgetMs - (Date.now() - t0);
      if (remaining < 2500) return "";
      try {
        const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-goog-api-key": k.key },
          body: JSON.stringify({
            systemInstruction: { parts: [{ text: system }] },
            contents: [{ role: "user", parts: [{ text }] }],
            generationConfig: { temperature: 0.9, maxOutputTokens: 1024, responseMimeType: "application/json" },
          }),
          signal: AbortSignal.timeout(Math.min(9000, remaining)),
        });
        if (!res.ok) continue;
        const data = await res.json();
        const out = data?.candidates?.[0]?.content?.parts?.map((p) => p.text || "").join("") || "";
        if (out.trim()) return out;
      } catch {}
    }
  }
  return "";
}
