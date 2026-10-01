"use client";
// app/admin/TeachChat.js — chế độ "Dạy bot" ngay trong trang chat chính.
// Giao diện y hệt chat với khách thật: bạn đóng vai khách, bot trả lời như thật (không gửi gì cho khách thật).
// Bot trả lời chưa đúng ý → bấm "Sửa" để viết lại cho đúng. Xong thì "Lưu đoạn chat", rồi chat mới để dạy tình huống khác.
import { useEffect, useRef, useState } from "react";

let uid = 0;
const nextId = () => ++uid;

function Dot({ size, label, bg = "#c7d2fe", color = "#3730a3" }) {
  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: "50%",
        background: bg,
        color,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontWeight: 700,
        fontSize: size * 0.42,
        flexShrink: 0,
      }}
    >
      {label}
    </div>
  );
}

const fmtTime = (d) => {
  if (!d) return "";
  const dt = new Date(d);
  if (isNaN(dt)) return "";
  return dt.toLocaleString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
};

const smallBtn = { border: "1px solid #ddd", background: "#fff", borderRadius: 6, padding: "3px 9px", fontSize: 12, cursor: "pointer" };

// turns: [{ id, from: "customer", text } | { id, from: "bot", messages: [..], note, edited }]
function flatten(turns) {
  const out = [];
  for (const t of turns) {
    if (t.from === "customer") out.push({ from: "customer", text: t.text });
    else for (const m of t.messages) out.push({ from: "bot", text: m });
  }
  return out;
}

function regroup(messages) {
  const turns = [];
  for (const m of messages || []) {
    if (m.from === "customer") turns.push({ id: nextId(), from: "customer", text: m.text });
    else {
      const last = turns[turns.length - 1];
      if (last && last.from === "bot") last.messages.push(m.text);
      else turns.push({ id: nextId(), from: "bot", messages: [m.text], note: "", edited: false });
    }
  }
  return turns;
}

export default function TeachChat({ onExit }) {
  const [products, setProducts] = useState([]);
  const [productId, setProductId] = useState("");
  const [title, setTitle] = useState("");
  const [turns, setTurns] = useState([]);
  const [draft, setDraft] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [editing, setEditing] = useState(null); // { turnId, text }
  const [saving, setSaving] = useState(false);
  const [savedId, setSavedId] = useState(null); // đang mở lại đoạn đã lưu → lưu sẽ ghi đè đoạn đó
  const [dirty, setDirty] = useState(false); // có thay đổi chưa lưu
  const [chats, setChats] = useState([]);
  const endRef = useRef(null);

  async function loadChats() {
    try {
      const r = await fetch("/api/training/chats", { cache: "no-store" });
      const data = await r.json();
      if (Array.isArray(data)) setChats(data);
    } catch {}
  }

  useEffect(() => {
    fetch("/api/products", { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => {
        const list = Array.isArray(d) ? d : d?.products || [];
        setProducts(list.map((p) => ({ id: p.id, name: p.name })));
      })
      .catch(() => {});
    loadChats();
  }, []);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [turns, loading]);

  const productName = (id) => products.find((p) => String(p.id) === String(id))?.name || "";

  function resetChat() {
    setTurns([]);
    setDraft("");
    setTitle("");
    setEditing(null);
    setError("");
    setSavedId(null);
    setDirty(false);
  }

  function newChat() {
    if (dirty && !confirm("Đoạn chat này chưa lưu. Bắt đầu chat mới và bỏ đoạn này?")) return;
    setNotice("");
    resetChat();
  }

  function openChat(c) {
    if (dirty && !confirm("Đoạn chat đang mở chưa lưu. Mở đoạn khác và bỏ đoạn này?")) return;
    setNotice("");
    setError("");
    setEditing(null);
    setDraft("");
    setTurns(regroup(c.messages));
    setProductId(c.productId || "");
    setTitle(c.title || "");
    setSavedId(c.id);
    setDirty(false);
  }

  async function send(e) {
    e?.preventDefault();
    const text = draft.trim();
    if (!text || loading) return;
    setError("");
    setNotice("");
    const withCustomer = [...turns, { id: nextId(), from: "customer", text }];
    setTurns(withCustomer);
    setDraft("");
    setDirty(true);
    setLoading(true);
    try {
      const r = await fetch("/api/training/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ history: flatten(withCustomer), productId }),
      });
      const data = await r.json();
      if (data.error) setError(data.error);
      else setTurns([...withCustomer, { id: nextId(), from: "bot", messages: data.messages || [], note: data.note || "", edited: false }]);
    } catch {
      setError("Không kết nối được. Kiểm tra mạng rồi gửi lại.");
    } finally {
      setLoading(false);
    }
  }

  function applyEdit() {
    if (!editing) return;
    const lines = editing.text.split("\n").map((l) => l.trim()).filter(Boolean);
    if (!lines.length) {
      setError("Câu trả lời không được để trống.");
      return;
    }
    setError("");
    setTurns((prev) => prev.map((t) => (t.id === editing.turnId ? { ...t, messages: lines, edited: true } : t)));
    setEditing(null);
    setDirty(true);
  }

  function removeTurnsFrom(turnId) {
    if (!confirm("Xóa tin này và các tin phía sau nó?")) return;
    const idx = turns.findIndex((t) => t.id === turnId);
    if (idx < 0) return;
    setTurns(turns.slice(0, idx));
    setEditing(null);
    setDirty(true);
  }

  async function save(thenNew) {
    if (saving) return;
    const messages = flatten(turns);
    if (!messages.some((m) => m.from === "customer") || !messages.some((m) => m.from === "bot")) {
      setError("Hãy chat thử ít nhất 1 lượt (khách hỏi, bot trả lời) rồi mới lưu.");
      return;
    }
    setSaving(true);
    setError("");
    try {
      const r = await fetch("/api/training/chats", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: savedId, title, productId, messages }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || "Không lưu được.");
      await loadChats();
      if (thenNew) {
        resetChat();
        setNotice("✓ Đã lưu đoạn chat. Bạn có thể chat tiếp tình huống khác từ đầu.");
      } else {
        setSavedId(data.id);
        setDirty(false);
        setNotice("✓ Đã lưu đoạn chat. Bot sẽ học theo đoạn này.");
      }
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  }

  async function removeChat(c) {
    if (!confirm(`Xóa đoạn chat "${c.title || "(không tên)"}"? Bot sẽ không học theo đoạn này nữa.`)) return;
    try {
      await fetch("/api/training/chats", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: c.id }),
      });
    } catch {}
    if (savedId === c.id) {
      setSavedId(null);
      setDirty(true);
    }
    loadChats();
  }

  return (
    <>
      {/* Khung chat (giống khung chat với khách thật) */}
      <section style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 20px", borderBottom: "1px solid #eee", flexWrap: "wrap" }}>
          <Dot size={40} label="🎓" bg="#fef3c7" />
          <div style={{ minWidth: 0, flex: 1 }}>
            <strong>Dạy bot — chat thử với khách mới</strong>
            <div style={{ fontSize: 11, color: "#888" }}>
              Bạn gõ như khách, bot trả lời như thật. Không gửi gì cho khách thật.
              {savedId ? " · Đang sửa đoạn đã lưu." : ""}
            </div>
          </div>
          <select
            value={productId}
            onChange={(e) => {
              setProductId(e.target.value);
              setDirty(true);
            }}
            title="Sản phẩm khách đang hỏi"
            style={{ padding: "7px 10px", borderRadius: 8, border: "1px solid #ddd", maxWidth: 200, fontSize: 13 }}
          >
            <option value="">Sản phẩm: không chọn</option>
            {products.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
          <button onClick={onExit} style={{ ...smallBtn, padding: "7px 12px", fontSize: 13 }}>
            ✕ Thoát
          </button>
        </div>

        <div style={{ display: "flex", gap: 8, padding: "8px 20px", borderBottom: "1px solid #f0f0f0", flexWrap: "wrap", alignItems: "center" }}>
          <input
            value={title}
            onChange={(e) => {
              setTitle(e.target.value);
              setDirty(true);
            }}
            placeholder="Tên tình huống (không bắt buộc), vd: khách mặc cả"
            style={{ flex: 1, minWidth: 180, padding: "7px 10px", borderRadius: 8, border: "1px solid #ddd", fontSize: 13 }}
          />
          <button
            onClick={() => save(false)}
            disabled={saving}
            style={{ padding: "7px 14px", borderRadius: 8, border: "1px solid #16a34a", background: "#16a34a", color: "#fff", fontWeight: 600, fontSize: 13, cursor: "pointer" }}
          >
            {saving ? "Đang lưu..." : "💾 Lưu đoạn chat"}
          </button>
          <button
            onClick={() => save(true)}
            disabled={saving}
            style={{ padding: "7px 14px", borderRadius: 8, border: "1px solid #16a34a", background: "#e8f7ee", color: "#166534", fontWeight: 600, fontSize: 13, cursor: "pointer" }}
          >
            💾 Lưu &amp; chat mới
          </button>
          <button onClick={newChat} style={{ padding: "7px 14px", borderRadius: 8, border: "1px solid #ddd", background: "#fff", fontSize: 13, cursor: "pointer" }}>
            ➕ Chat mới
          </button>
        </div>

        <div style={{ flex: 1, overflowY: "auto", padding: 20, background: "#f8f9fb" }}>
          {!turns.length && (
            <div style={{ color: "#999", textAlign: "center", marginTop: 40, fontSize: 14 }}>
              {notice || "Đây là đoạn chat mới. Gõ tin nhắn bên dưới như một khách hàng vừa nhắn tới shop."}
            </div>
          )}
          {turns.map((t) =>
            t.from === "customer" ? (
              <div key={t.id} style={{ display: "flex", alignItems: "flex-end", gap: 8, justifyContent: "flex-start", marginBottom: 10 }}>
                <Dot size={28} label="K" />
                <div style={{ maxWidth: "70%", padding: "8px 12px", borderRadius: 16, background: "#fff", boxShadow: "0 1px 1px rgba(0,0,0,0.06)", whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
                  <div style={{ fontSize: 15 }}>{t.text}</div>
                  <div style={{ fontSize: 10, color: "#888", marginTop: 2 }}>Khách (bạn đóng vai)</div>
                </div>
                <button
                  onClick={() => removeTurnsFrom(t.id)}
                  title="Xóa tin này và các tin sau"
                  aria-label="Xóa tin này và các tin sau"
                  style={{ border: "none", background: "transparent", cursor: "pointer", fontSize: 13, opacity: 0.4 }}
                >
                  🗑
                </button>
              </div>
            ) : (
              <div key={t.id} style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 4, marginBottom: 10 }}>
                {editing?.turnId === t.id ? (
                  <div style={{ width: "70%", border: "1px solid #0b6bcb", borderRadius: 12, padding: 10, background: "#f5f9ff" }}>
                    <div style={{ fontSize: 12, color: "#555", marginBottom: 6 }}>
                      Viết lại cho đúng ý bạn. Mỗi dòng là một tin nhắn (nên tối đa 2 dòng).
                    </div>
                    <textarea
                      autoFocus
                      value={editing.text}
                      onChange={(e) => setEditing({ ...editing, text: e.target.value })}
                      rows={Math.max(3, editing.text.split("\n").length + 1)}
                      style={{ width: "100%", boxSizing: "border-box", padding: "8px 10px", border: "1px solid #ddd", borderRadius: 8, fontSize: 14, fontFamily: "inherit", resize: "vertical" }}
                    />
                    <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                      <button onClick={applyEdit} style={{ ...smallBtn, background: "#0b6bcb", borderColor: "#0b6bcb", color: "#fff" }}>
                        Xong
                      </button>
                      <button onClick={() => setEditing(null)} style={smallBtn}>
                        Hủy
                      </button>
                    </div>
                  </div>
                ) : (
                  <>
                    {t.messages.map((m, i) => (
                      <div key={i} style={{ maxWidth: "70%", padding: "8px 12px", borderRadius: 16, background: "#dbeafe", boxShadow: "0 1px 1px rgba(0,0,0,0.06)", whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
                        <div style={{ fontSize: 15 }}>{m}</div>
                        {i === t.messages.length - 1 && <div style={{ fontSize: 10, color: "#888", marginTop: 2 }}>🤖 Bot{t.edited ? " · đã sửa" : ""}</div>}
                      </div>
                    ))}
                    {t.note && <div style={{ maxWidth: "70%", fontSize: 12, color: "#8a6d00", background: "#fff8dc", borderRadius: 8, padding: "4px 8px" }}>{t.note}</div>}
                    {t.messages.length > 0 && (
                      <button onClick={() => setEditing({ turnId: t.id, text: t.messages.join("\n") })} style={smallBtn}>
                        ✏️ Sửa câu này
                      </button>
                    )}
                  </>
                )}
              </div>
            )
          )}
          {loading && (
            <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 10 }}>
              <div style={{ padding: "8px 12px", borderRadius: 16, background: "#dbeafe", color: "#888", fontSize: 14 }}>Bot đang soạn tin...</div>
            </div>
          )}
          <div ref={endRef} />
        </div>

        {(error || (notice && turns.length > 0)) && (
          <div style={{ padding: "6px 16px", fontSize: 13, color: error ? "#c0392b" : "#166534", borderTop: "1px solid #eee" }}>{error || notice}</div>
        )}

        <form onSubmit={send} style={{ display: "flex", gap: 8, padding: 16, borderTop: "1px solid #eee" }}>
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="Gõ tin nhắn với vai khách..."
            style={{ flex: 1, padding: "10px 14px", borderRadius: 20, border: "1px solid #ddd" }}
          />
          <button
            type="submit"
            disabled={loading || !draft.trim()}
            style={{ padding: "10px 20px", borderRadius: 20, border: "none", background: "#111", color: "#fff", cursor: "pointer" }}
          >
            Gửi
          </button>
        </form>
      </section>

      {/* Cột bên phải: các đoạn chat đã dạy */}
      <aside style={{ width: 360, flexShrink: 0, borderLeft: "1px solid #eee", display: "flex", flexDirection: "column", background: "#fff" }}>
        <div style={{ padding: "12px 16px", borderBottom: "1px solid #eee" }}>
          <strong style={{ fontSize: 14 }}>Các đoạn chat đã dạy ({chats.length})</strong>
          <div style={{ fontSize: 12, color: "#888", marginTop: 2 }}>Bot đọc các đoạn này khi trả lời khách thật.</div>
        </div>
        <div style={{ flex: 1, overflowY: "auto", padding: "8px 16px" }}>
          {!chats.length && <p style={{ color: "#999", fontSize: 13 }}>Chưa có đoạn nào. Chat thử, sửa câu bot chưa đúng, rồi bấm Lưu.</p>}
          {chats.map((c) => (
            <div
              key={c.id}
              style={{
                border: savedId === c.id ? "1px solid #0b6bcb" : "1px solid #eee",
                background: savedId === c.id ? "#f5f9ff" : "#fff",
                borderRadius: 10,
                padding: "8px 10px",
                marginTop: 8,
              }}
            >
              <div style={{ fontWeight: 600, fontSize: 14 }}>{c.title || "(không tên)"}</div>
              <div style={{ fontSize: 12, color: "#888", marginTop: 2 }}>
                {c.productId ? `Sản phẩm: ${productName(c.productId) || c.productId} · ` : "Dùng chung · "}
                {c.messages.length} tin · {fmtTime(c.updatedAt)}
              </div>
              <div style={{ fontSize: 12, color: "#555", marginTop: 4, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                Khách: {c.messages.find((m) => m.from === "customer")?.text || ""}
              </div>
              <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                <button onClick={() => openChat(c)} style={smallBtn}>
                  Mở / sửa
                </button>
                <button onClick={() => removeChat(c)} style={{ ...smallBtn, color: "#c0392b" }}>
                  Xóa
                </button>
              </div>
            </div>
          ))}
        </div>
      </aside>
    </>
  );
}
