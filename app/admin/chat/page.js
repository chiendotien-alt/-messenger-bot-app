"use client";
import { useEffect, useState, useCallback } from "react";

export default function ChatAdminPage() {
  const [conversations, setConversations] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [messages, setMessages] = useState([]);
  const [botEnabled, setBotEnabled] = useState(true);
  const [replyText, setReplyText] = useState("");
  const [sending, setSending] = useState(false);

  const loadConversations = useCallback(async () => {
    const res = await fetch("/api/conversations", { cache: "no-store" });
    setConversations(await res.json());
  }, []);

  const loadSettings = useCallback(async () => {
    const res = await fetch("/api/settings", { cache: "no-store" });
    const data = await res.json();
    setBotEnabled(data.botEnabled !== false);
  }, []);

  const loadMessages = useCallback(async (id) => {
    if (!id) return;
    const res = await fetch(`/api/conversations/${id}`, { cache: "no-store" });
    const data = await res.json();
    setMessages(data.messages || []);
  }, []);

  useEffect(() => {
    loadConversations();
    loadSettings();
    const t = setInterval(loadConversations, 5000);
    return () => clearInterval(t);
  }, [loadConversations, loadSettings]);

  useEffect(() => {
    if (!selectedId) return;
    loadMessages(selectedId);
    const t = setInterval(() => loadMessages(selectedId), 4000);
    return () => clearInterval(t);
  }, [selectedId, loadMessages]);

  async function toggleBot() {
    const next = !botEnabled;
    setBotEnabled(next);
    await fetch("/api/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ botEnabled: next }),
    });
  }

  async function handleSend(e) {
    e.preventDefault();
    if (!replyText.trim() || !selectedId) return;
    setSending(true);
    await fetch(`/api/conversations/${selectedId}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: replyText }),
    });
    setReplyText("");
    setSending(false);
    loadMessages(selectedId);
    loadConversations();
  }

  function timeAgo(iso) {
    if (!iso) return "";
    const diff = Date.now() - new Date(iso).getTime();
    const min = Math.floor(diff / 60000);
    if (min < 1) return "Vừa xong";
    if (min < 60) return `${min} phút trước`;
    const h = Math.floor(min / 60);
    if (h < 24) return `${h} giờ trước`;
    return new Date(iso).toLocaleDateString("vi-VN");
  }

  return (
    <main style={{ fontFamily: "sans-serif", height: "100vh", display: "flex", flexDirection: "column" }}>
      <header
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          padding: "12px 20px",
          borderBottom: "1px solid #eee",
        }}
      >
        <div>
          <strong style={{ fontSize: 18 }}>Hộp thoại khách hàng</strong>
          <a href="/admin" style={{ marginLeft: 16, fontSize: 13, color: "#555" }}>
            ← Quản lý sản phẩm
          </a>
        </div>
        <button
          onClick={toggleBot}
          style={{
            padding: "8px 16px",
            borderRadius: 20,
            border: "none",
            cursor: "pointer",
            fontWeight: 600,
            background: botEnabled ? "#16a34a" : "#9ca3af",
            color: "#fff",
          }}
        >
          {botEnabled ? "🤖 Bot đang BẬT" : "⏸ Bot đang TẮT"}
        </button>
      </header>

      <div style={{ flex: 1, display: "flex", overflow: "hidden" }}>
        {/* Danh sách hội thoại */}
        <aside style={{ width: 280, borderRight: "1px solid #eee", overflowY: "auto" }}>
          {conversations.length === 0 && (
            <p style={{ padding: 16, color: "#888" }}>Chưa có khách nào nhắn tin.</p>
          )}
          {conversations.map((c) => (
            <div
              key={c.id}
              onClick={() => setSelectedId(c.id)}
              style={{
                padding: "12px 16px",
                cursor: "pointer",
                background: selectedId === c.id ? "#f0f0f0" : "transparent",
                borderBottom: "1px solid #f5f5f5",
              }}
            >
              <div style={{ fontWeight: 600, fontSize: 14 }}>{c.name}</div>
              <div
                style={{
                  fontSize: 12,
                  color: "#777",
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                }}
              >
                {c.lastFrom === "customer" ? "" : c.lastFrom === "bot" ? "🤖 " : "👤 "}
                {c.lastMessage}
              </div>
              <div style={{ fontSize: 11, color: "#aaa" }}>{timeAgo(c.lastTime)}</div>
            </div>
          ))}
        </aside>

        {/* Khung chat */}
        <section style={{ flex: 1, display: "flex", flexDirection: "column" }}>
          {!selectedId ? (
            <div style={{ margin: "auto", color: "#888" }}>Chọn một hội thoại để xem</div>
          ) : (
            <>
              <div style={{ flex: 1, overflowY: "auto", padding: 20 }}>
                {messages.map((m, i) => (
                  <div
                    key={i}
                    style={{
                      display: "flex",
                      justifyContent: m.from === "customer" ? "flex-start" : "flex-end",
                      marginBottom: 10,
                    }}
                  >
                    <div
                      style={{
                        maxWidth: "70%",
                        padding: "8px 12px",
                        borderRadius: 14,
                        background:
                          m.from === "customer" ? "#f1f1f1" : m.from === "bot" ? "#dbeafe" : "#dcfce7",
                      }}
                    >
                      <div style={{ fontSize: 15 }}>{m.text}</div>
                      <div style={{ fontSize: 10, color: "#888", marginTop: 2 }}>
                        {m.from === "bot" ? "🤖 Bot" : m.from === "admin" ? "👤 Bạn" : ""}{" "}
                        {timeAgo(m.time)}
                      </div>
                    </div>
                  </div>
                ))}
              </div>

              <form
                onSubmit={handleSend}
                style={{ display: "flex", gap: 8, padding: 16, borderTop: "1px solid #eee" }}
              >
                <input
                  value={replyText}
                  onChange={(e) => setReplyText(e.target.value)}
                  placeholder="Nhập tin nhắn trả lời thủ công..."
                  style={{
                    flex: 1,
                    padding: "10px 14px",
                    borderRadius: 20,
                    border: "1px solid #ddd",
                  }}
                />
                <button
                  type="submit"
                  disabled={sending}
                  style={{
                    padding: "10px 20px",
                    borderRadius: 20,
                    border: "none",
                    background: "#111",
                    color: "#fff",
                    cursor: "pointer",
                  }}
                >
                  Gửi
                </button>
              </form>
            </>
          )}
        </section>
      </div>
    </main>
  );
}
