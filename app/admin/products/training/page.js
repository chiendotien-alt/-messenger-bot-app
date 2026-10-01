"use client";
import { useEffect, useRef, useState } from "react";
import { BoxIcon, ChatIcon, navButtonStyle } from "../../icons";

const inputStyle = { padding: "10px 12px", border: "1px solid #ddd", borderRadius: 8, fontSize: 15, fontFamily: "inherit" };
const btn = { padding: "6px 12px", border: "1px solid #ccc", borderRadius: 6, background: "#fff", cursor: "pointer", fontSize: 14 };
const btnPrimary = { ...btn, background: "#0b6bcb", borderColor: "#0b6bcb", color: "#fff" };

let uid = 0;
const nextId = () => ++uid;

export default function TrainingPage() {
  const [products, setProducts] = useState([]);
  const [productId, setProductId] = useState("");
  const [turns, setTurns] = useState([]); // { id, from: "customer" | "bot", text?, messages?, note?, taught? }
  const [draft, setDraft] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [editing, setEditing] = useState(null); // { turnId, text }
  const [saving, setSaving] = useState(false);

  const [examples, setExamples] = useState([]);
  const [rowEdit, setRowEdit] = useState(null); // { id, customer, reply, productId }
  const [manual, setManual] = useState({ customer: "", reply: "", productId: "" });
  const [manualOpen, setManualOpen] = useState(false);
  const [tableError, setTableError] = useState("");

  const endRef = useRef(null);

  async function loadExamples() {
    try {
      const r = await fetch("/api/training", { cache: "no-store" });
      const data = await r.json();
      if (Array.isArray(data)) setExamples(data);
      else setTableError(data?.error || "Không tải được danh sách.");
    } catch {
      setTableError("Không tải được danh sách.");
    }
  }

  useEffect(() => {
    fetch("/api/products", { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => Array.isArray(d) && setProducts(d))
      .catch(() => {});
    loadExamples();
  }, []);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [turns, loading]);

  const productName = (id) => products.find((p) => String(p.id) === String(id))?.name || "";

  function flatten(list) {
    const out = [];
    for (const t of list) {
      if (t.from === "customer") out.push({ from: "customer", text: t.text });
      else for (const m of t.messages) out.push({ from: "bot", text: m });
    }
    return out;
  }

  async function send() {
    const text = draft.trim();
    if (!text || loading) return;
    setError("");
    const withCustomer = [...turns, { id: nextId(), from: "customer", text }];
    setTurns(withCustomer);
    setDraft("");
    setLoading(true);
    try {
      const r = await fetch("/api/training/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ history: flatten(withCustomer), productId }),
      });
      const data = await r.json();
      if (data.error) {
        setError(data.error);
      } else {
        setTurns([...withCustomer, { id: nextId(), from: "bot", messages: data.messages || [], note: data.note || "" }]);
      }
    } catch {
      setError("Không kết nối được. Kiểm tra mạng rồi gửi lại.");
    } finally {
      setLoading(false);
    }
  }

  function startEdit(turn) {
    setEditing({ turnId: turn.id, text: (turn.messages || []).join("\n") });
  }

  async function saveEdit() {
    if (!editing || saving) return;
    const idx = turns.findIndex((t) => t.id === editing.turnId);
    const lines = editing.text.split("\n").map((l) => l.trim()).filter(Boolean);
    const customerTurn = turns[idx - 1];
    if (idx < 1 || customerTurn?.from !== "customer") return;
    if (!lines.length) {
      setError("Câu trả lời chuẩn không được để trống.");
      return;
    }
    setSaving(true);
    setError("");
    const before = flatten(turns.slice(0, idx - 1)).slice(-4);
    const context = before.map((m) => `${m.from === "customer" ? "Khách" : "Shop"}: ${m.text}`).join("\n");
    try {
      const r = await fetch("/api/training", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ productId, context, customer: customerTurn.text, reply: lines.join("\n") }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || "Không lưu được.");
      setTurns((prev) => prev.map((t) => (t.id === editing.turnId ? { ...t, messages: lines, taught: true } : t)));
      setEditing(null);
      loadExamples();
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  }

  async function addManual() {
    setTableError("");
    try {
      const r = await fetch("/api/training", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(manual),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || "Không lưu được.");
      setManual({ customer: "", reply: "", productId: manual.productId });
      loadExamples();
    } catch (e) {
      setTableError(e.message);
    }
  }

  async function saveRow() {
    setTableError("");
    try {
      const r = await fetch("/api/training", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(rowEdit),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || "Không lưu được.");
      setRowEdit(null);
      loadExamples();
    } catch (e) {
      setTableError(e.message);
    }
  }

  async function removeRow(id) {
    if (!confirm("Xóa câu chuẩn này? Bot sẽ không học theo nó nữa.")) return;
    await fetch("/api/training", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    }).catch(() => {});
    loadExamples();
  }

  const productSelect = (value, onChange, style) => (
    <select value={value} onChange={(e) => onChange(e.target.value)} style={{ ...inputStyle, ...style }}>
      <option value="">Dùng chung (mọi sản phẩm)</option>
      {products.map((p) => (
        <option key={p.id} value={p.id}>
          {p.name}
        </option>
      ))}
    </select>
  );

  const bubble = (mine) => ({
    maxWidth: "78%",
    padding: "9px 13px",
    borderRadius: 16,
    fontSize: 15,
    lineHeight: 1.45,
    whiteSpace: "pre-wrap",
    wordBreak: "break-word",
    background: mine ? "#0b6bcb" : "#eef0f3",
    color: mine ? "#fff" : "#111",
    alignSelf: mine ? "flex-end" : "flex-start",
  });

  return (
    <main style={{ fontFamily: "sans-serif", padding: 24, maxWidth: 1180, margin: "0 auto" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
        <h1 style={{ margin: 0 }}>Dạy bot</h1>
        <div style={{ display: "flex", gap: 8 }}>
          <a href="/admin/products" title="Quản lý sản phẩm" aria-label="Quản lý sản phẩm" style={navButtonStyle}>
            <BoxIcon />
          </a>
          <a href="/admin" title="Hộp thoại khách hàng" aria-label="Hộp thoại khách hàng" style={navButtonStyle}>
            <ChatIcon />
          </a>
        </div>
      </div>
      <p style={{ color: "#666", marginTop: 8, maxWidth: 760 }}>
        Bạn đóng vai khách, bot trả lời đúng như khi chat thật (nhưng không gửi gì cho khách thật). Thấy bot trả lời chưa
        đúng ý thì bấm <b>Sửa &amp; dạy bot</b>, sửa lại câu cho đúng cách bạn muốn rồi lưu. Từ đó bot sẽ nhắn theo cách này
        khi gặp tình huống tương tự.
      </p>

      <div style={{ display: "flex", gap: 20, flexWrap: "wrap", alignItems: "flex-start" }}>
        {/* ---- Khung chat thử ---- */}
        <section style={{ flex: "1 1 420px", minWidth: 300, border: "1px solid #e2e2e2", borderRadius: 12, background: "#fff" }}>
          <div style={{ display: "flex", gap: 8, padding: 12, borderBottom: "1px solid #eee", flexWrap: "wrap" }}>
            {productSelect(productId, setProductId, { flex: 1, minWidth: 180, padding: "8px 10px", fontSize: 14 })}
            <button
              style={btn}
              onClick={() => {
                setTurns([]);
                setEditing(null);
                setError("");
              }}
            >
              Chat mới
            </button>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 8, padding: 14, height: 460, overflowY: "auto" }}>
            {!turns.length && (
              <div style={{ color: "#999", textAlign: "center", marginTop: 40, fontSize: 14 }}>
                Chọn sản phẩm khách đang hỏi (nếu muốn) rồi gõ tin nhắn như một khách hàng.
              </div>
            )}
            {turns.map((t) =>
              t.from === "customer" ? (
                <div key={t.id} style={bubble(true)}>
                  {t.text}
                </div>
              ) : (
                <div key={t.id} style={{ display: "flex", flexDirection: "column", gap: 4, alignItems: "flex-start" }}>
                  {editing?.turnId === t.id ? (
                    <div style={{ width: "100%", border: "1px solid #0b6bcb", borderRadius: 10, padding: 10, background: "#f5f9ff" }}>
                      <div style={{ fontSize: 13, color: "#555", marginBottom: 6 }}>
                        Sửa lại cho đúng ý bạn. Mỗi dòng là một tin nhắn (nên tối đa 2 dòng).
                      </div>
                      <textarea
                        autoFocus
                        value={editing.text}
                        onChange={(e) => setEditing({ ...editing, text: e.target.value })}
                        rows={Math.max(3, editing.text.split("\n").length + 1)}
                        style={{ ...inputStyle, width: "100%", boxSizing: "border-box", resize: "vertical" }}
                      />
                      <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                        <button style={btnPrimary} onClick={saveEdit} disabled={saving}>
                          {saving ? "Đang lưu..." : "Lưu & dạy bot"}
                        </button>
                        <button style={btn} onClick={() => setEditing(null)}>
                          Hủy
                        </button>
                      </div>
                    </div>
                  ) : (
                    <>
                      {t.messages.map((m, i) => (
                        <div key={i} style={bubble(false)}>
                          {m}
                        </div>
                      ))}
                      {t.note && <div style={{ fontSize: 12, color: "#8a6d00", background: "#fff8dc", borderRadius: 8, padding: "4px 8px" }}>{t.note}</div>}
                      {t.taught ? (
                        <span style={{ fontSize: 12, color: "#1e8449" }}>✓ Đã dạy bot câu này</span>
                      ) : (
                        t.messages.length > 0 && (
                          <button style={{ ...btn, fontSize: 12, padding: "3px 9px" }} onClick={() => startEdit(t)}>
                            Sửa &amp; dạy bot
                          </button>
                        )
                      )}
                    </>
                  )}
                </div>
              )
            )}
            {loading && <div style={{ ...bubble(false), color: "#888" }}>Bot đang soạn tin...</div>}
            <div ref={endRef} />
          </div>

          {error && <div style={{ color: "#c0392b", fontSize: 13, padding: "0 14px 8px" }}>{error}</div>}

          <div style={{ display: "flex", gap: 8, padding: 12, borderTop: "1px solid #eee" }}>
            <textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  send();
                }
              }}
              rows={2}
              placeholder="Gõ tin nhắn với vai khách... (Enter để gửi)"
              style={{ ...inputStyle, flex: 1, resize: "none" }}
            />
            <button style={{ ...btnPrimary, padding: "0 18px" }} onClick={send} disabled={loading || !draft.trim()}>
              Gửi
            </button>
          </div>
        </section>

        {/* ---- Bảng các câu đã dạy ---- */}
        <section style={{ flex: "1 1 460px", minWidth: 300 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
            <h2 style={{ margin: 0, fontSize: 18 }}>Các câu bot đã được dạy ({examples.length})</h2>
            <button style={btn} onClick={() => setManualOpen((v) => !v)}>
              {manualOpen ? "Đóng" : "+ Thêm thủ công"}
            </button>
          </div>

          {manualOpen && (
            <div style={{ border: "1px dashed #cfcfcf", borderRadius: 10, padding: 12, marginTop: 10, background: "#fafafa", display: "grid", gap: 8 }}>
              <input
                value={manual.customer}
                onChange={(e) => setManual({ ...manual, customer: e.target.value })}
                placeholder="Khách nói (vd: giảm chút được không shop)"
                style={inputStyle}
              />
              <textarea
                value={manual.reply}
                onChange={(e) => setManual({ ...manual, reply: e.target.value })}
                rows={3}
                placeholder={"Bot nên trả lời (mỗi dòng là 1 tin nhắn)"}
                style={{ ...inputStyle, resize: "vertical" }}
              />
              {productSelect(manual.productId, (v) => setManual({ ...manual, productId: v }))}
              <div>
                <button style={btnPrimary} onClick={addManual}>
                  Lưu câu chuẩn
                </button>
              </div>
            </div>
          )}

          {tableError && <div style={{ color: "#c0392b", fontSize: 13, marginTop: 8 }}>{tableError}</div>}

          <div style={{ marginTop: 10, border: "1px solid #e2e2e2", borderRadius: 10, overflow: "hidden", background: "#fff" }}>
            {!examples.length && (
              <div style={{ padding: 16, color: "#999", fontSize: 14 }}>
                Chưa có câu nào. Chat thử bên trái rồi sửa câu bot trả lời, hoặc thêm thủ công.
              </div>
            )}
            {examples.map((e) => (
              <div key={e.id} style={{ padding: 12, borderTop: "1px solid #f0f0f0" }}>
                {rowEdit?.id === e.id ? (
                  <div style={{ display: "grid", gap: 8 }}>
                    <input
                      value={rowEdit.customer}
                      onChange={(ev) => setRowEdit({ ...rowEdit, customer: ev.target.value })}
                      style={inputStyle}
                    />
                    <textarea
                      value={rowEdit.reply}
                      onChange={(ev) => setRowEdit({ ...rowEdit, reply: ev.target.value })}
                      rows={Math.max(3, rowEdit.reply.split("\n").length + 1)}
                      style={{ ...inputStyle, resize: "vertical" }}
                    />
                    {productSelect(rowEdit.productId, (v) => setRowEdit({ ...rowEdit, productId: v }))}
                    <div style={{ display: "flex", gap: 8 }}>
                      <button style={btnPrimary} onClick={saveRow}>
                        Lưu
                      </button>
                      <button style={btn} onClick={() => setRowEdit(null)}>
                        Hủy
                      </button>
                    </div>
                  </div>
                ) : (
                  <>
                    <div style={{ fontSize: 12, color: "#888", marginBottom: 4 }}>
                      {e.productId ? `Sản phẩm: ${productName(e.productId) || e.productId}` : "Dùng chung"}
                    </div>
                    <div style={{ fontSize: 14 }}>
                      <b>Khách:</b> {e.customer}
                    </div>
                    <div style={{ fontSize: 14, whiteSpace: "pre-wrap", marginTop: 2 }}>
                      <b>Bot:</b> {e.reply}
                    </div>
                    <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                      <button
                        style={{ ...btn, fontSize: 12, padding: "3px 9px" }}
                        onClick={() => setRowEdit({ id: e.id, customer: e.customer, reply: e.reply, productId: e.productId })}
                      >
                        Sửa
                      </button>
                      <button style={{ ...btn, fontSize: 12, padding: "3px 9px", color: "#c0392b" }} onClick={() => removeRow(e.id)}>
                        Xóa
                      </button>
                    </div>
                  </>
                )}
              </div>
            ))}
          </div>
          <p style={{ color: "#888", fontSize: 12, marginTop: 8 }}>
            Bot đọc tối đa 40 câu mới nhất (cùng sản phẩm hoặc dùng chung) mỗi khi trả lời khách thật.
          </p>
        </section>
      </div>
    </main>
  );
}
