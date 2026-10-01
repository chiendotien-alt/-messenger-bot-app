"use client";
import { useEffect, useState } from "react";
import { ChatIcon, BoxIcon, navButtonStyle } from "../icons";

const card = { border: "1px solid #e2e2e2", borderRadius: 10, padding: "14px 16px", marginBottom: 16, background: "#fff" };
const input = { padding: "8px 10px", border: "1px solid #ddd", borderRadius: 6, fontSize: 15, width: 80 };
const btn = { padding: "9px 16px", border: "1px solid #ccc", borderRadius: 8, background: "#fff", cursor: "pointer", fontSize: 15 };
const btnMain = { ...btn, background: "#2563eb", color: "#fff", border: "1px solid #2563eb" };

const STATUS = { sent: "✅ Đã nhắc", skipped: "⏭ Bỏ qua", error: "⚠️ Lỗi", preview: "👀 Xem thử", sending: "… đang gửi" };

export default function FollowupPage() {
  const [cfg, setCfg] = useState(null);
  const [fallbackText, setFallbackText] = useState("");
  const [eligible, setEligible] = useState(0);
  const [sentTotal, setSentTotal] = useState(0);
  const [recent, setRecent] = useState([]);
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const [results, setResults] = useState(null);
  const [origin, setOrigin] = useState("");

  async function load() {
    try {
      const res = await fetch("/api/followup", { cache: "no-store" });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || "lỗi");
      setCfg(d.config);
      setFallbackText((d.config.fallbacks || []).join("\n"));
      setEligible(d.eligible || 0);
      setSentTotal(d.sentTotal || 0);
      setRecent(d.recent || []);
    } catch (e) {
      setMsg("Không tải được cài đặt: " + e.message);
    }
  }

  useEffect(() => {
    setOrigin(window.location.origin);
    load();
  }, []);

  async function save(patch) {
    setMsg("Đang lưu...");
    try {
      const res = await fetch("/api/followup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || "lỗi");
      setCfg(d.config);
      setMsg("Đã lưu ✓");
      load();
    } catch (e) {
      setMsg("Lưu CHƯA được: " + e.message);
    }
    setTimeout(() => setMsg(""), 2500);
  }

  function saveAll() {
    save({
      waitHours: Number(cfg.waitHours),
      startHour: Number(cfg.startHour),
      endHour: Number(cfg.endHour),
      maxPerRun: Number(cfg.maxPerRun),
      fallbacks: fallbackText.split("\n"),
    });
  }

  async function run(dryRun) {
    if (!dryRun && !confirm("Gửi tin nhắc THẬT cho một nhóm khách ngay bây giờ?")) return;
    setBusy(true);
    setResults(null);
    try {
      const res = await fetch("/api/followup/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dryRun }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || "lỗi");
      setResults(d);
      if (!dryRun) load();
    } catch (e) {
      setResults({ error: e.message });
    }
    setBusy(false);
  }

  if (!cfg) {
    return <main style={{ fontFamily: "sans-serif", padding: 24 }}>{msg || "Đang tải..."}</main>;
  }

  return (
    <main style={{ fontFamily: "sans-serif", padding: 24, maxWidth: 820, margin: "0 auto" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
        <h1 style={{ margin: 0 }}>Nhắc khách quay lại</h1>
        <div style={{ display: "flex", gap: 8 }}>
          <a href="/admin" title="Hộp thoại khách hàng" style={navButtonStyle}><ChatIcon /></a>
          <a href="/admin/products" title="Quản lý sản phẩm" style={navButtonStyle}><BoxIcon /></a>
        </div>
      </div>
      <p style={{ color: "#666", marginTop: 8 }}>
        Bot nhắn hỏi thăm <b>1 lần duy nhất</b> với khách đã im lặng và <b>chưa để lại số điện thoại</b>. Nội dung do bot tự viết theo đoạn chat của từng khách.
      </p>

      <div style={card}>
        <label style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 17, fontWeight: 600, cursor: "pointer" }}>
          <input
            type="checkbox"
            checked={cfg.enabled}
            onChange={(e) => save({ enabled: e.target.checked })}
            style={{ width: 20, height: 20 }}
          />
          {cfg.enabled ? "ĐANG BẬT — bot sẽ tự nhắc khách" : "Đang TẮT — chưa nhắc ai cả"}
        </label>
        <p style={{ color: "#666", fontSize: 14, margin: "8px 0 0" }}>
          Hiện có <b>{eligible}</b> khách đủ điều kiện nhắc · Đã nhắc tổng cộng <b>{sentTotal}</b> khách.
          Nên bấm “Xem thử” bên dưới trước khi bật.
        </p>
      </div>

      <div style={card}>
        <b>Cài đặt</b>
        <div style={{ display: "grid", gap: 10, marginTop: 10 }}>
          <label>
            Khách im lặng quá{" "}
            <input style={input} type="number" min="0.5" max="20" step="0.5" value={cfg.waitHours}
              onChange={(e) => setCfg({ ...cfg, waitHours: e.target.value })} />{" "}
            giờ thì nhắc (tối đa 20 giờ vì Facebook chỉ cho nhắn trong 24 giờ)
          </label>
          <label>
            Chỉ nhắc từ{" "}
            <input style={input} type="number" min="0" max="23" value={cfg.startHour}
              onChange={(e) => setCfg({ ...cfg, startHour: e.target.value })} />{" "}
            giờ đến{" "}
            <input style={input} type="number" min="1" max="24" value={cfg.endHour}
              onChange={(e) => setCfg({ ...cfg, endHour: e.target.value })} />{" "}
            giờ (giờ Việt Nam) — tránh nhắn ban đêm
          </label>
          <label>
            Mỗi lần chạy nhắc tối đa{" "}
            <input style={input} type="number" min="1" max="20" value={cfg.maxPerRun}
              onChange={(e) => setCfg({ ...cfg, maxPerRun: e.target.value })} />{" "}
            khách (nhiều khách thì bot nhắc dần qua các lần chạy, không dồn một lúc)
          </label>
          <div>
            <div style={{ marginBottom: 4 }}>
              Câu dự phòng (mỗi dòng 1 câu) — dùng khi AI bận/lỗi, bot chọn ngẫu nhiên:
            </div>
            <textarea
              rows={5}
              value={fallbackText}
              onChange={(e) => setFallbackText(e.target.value)}
              style={{ width: "100%", boxSizing: "border-box", padding: 10, border: "1px solid #ddd", borderRadius: 6, fontSize: 15 }}
            />
          </div>
          <div>
            <button style={btnMain} onClick={saveAll}>Lưu cài đặt</button>{" "}
            <span style={{ color: "#555" }}>{msg}</span>
          </div>
        </div>
      </div>

      <div style={card}>
        <b>Thử và gửi</b>
        <p style={{ color: "#666", fontSize: 14, margin: "6px 0 10px" }}>
          “Xem thử” chỉ cho bạn thấy bot định nhắn gì (tối đa 5 khách), <b>không gửi gì cả</b>.
        </p>
        <button style={btn} disabled={busy} onClick={() => run(true)}>
          {busy ? "Đang chạy..." : "👀 Xem thử (không gửi)"}
        </button>{" "}
        <button style={btn} disabled={busy} onClick={() => run(false)}>
          Gửi thật 1 nhóm ngay
        </button>
        {results && (
          <div style={{ marginTop: 12 }}>
            {results.error && <div style={{ color: "#b91c1c" }}>Lỗi: {results.error}</div>}
            {results.skipped && <div style={{ color: "#555" }}>{results.skipped}</div>}
            {(results.results || []).map((r) => (
              <div key={r.id} style={{ borderTop: "1px solid #eee", padding: "8px 0" }}>
                <div style={{ fontWeight: 600 }}>{r.name} — {STATUS[r.status] || r.status}{r.usedFallback ? " (câu dự phòng)" : ""}</div>
                <div style={{ color: "#333" }}>{r.message}</div>
              </div>
            ))}
          </div>
        )}
      </div>

      {recent.length > 0 && (
        <div style={card}>
          <b>Đã nhắc gần đây</b>
          {recent.map((r) => (
            <div key={r.id} style={{ borderTop: "1px solid #eee", padding: "8px 0", marginTop: 8 }}>
              <div style={{ fontWeight: 600 }}>
                {r.name || `Khách ${String(r.id).slice(-4)}`} — {STATUS[r.status] || r.status}
                {r.at ? ` · ${new Date(r.at).toLocaleString("vi-VN")}` : ""}
              </div>
              {r.text && <div style={{ color: "#333" }}>{r.text}</div>}
            </div>
          ))}
        </div>
      )}

      <details style={card}>
        <summary style={{ cursor: "pointer", fontWeight: 600 }}>Cách để bot tự chạy định kỳ (làm 1 lần)</summary>
        <ol style={{ lineHeight: 1.7, paddingLeft: 20 }}>
          <li>Vào <b>cron-job.org</b>, tạo tài khoản miễn phí, bấm <b>Create cronjob</b>.</li>
          <li>Ô <b>URL</b> dán: <code style={{ background: "#f3f4f6", padding: "2px 6px", borderRadius: 4 }}>{origin}/api/followup/run</code></li>
          <li>Chọn lịch: <b>Every 5 minutes</b> (mỗi 5 phút).</li>
          <li>Mở mục <b>Advanced</b> → bật <b>HTTP authentication</b> → nhập đúng tên đăng nhập và mật khẩu bạn dùng vào trang quản trị này.</li>
          <li>Bấm <b>Create</b>. Xong. Chỉ khi nút ở trên đang BẬT thì bot mới nhắn.</li>
        </ol>
      </details>
    </main>
  );
}
