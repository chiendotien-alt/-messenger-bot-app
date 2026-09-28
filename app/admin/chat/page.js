"use client";
import { useEffect, useRef, useState, useCallback } from "react";

function displayName(name, id) {
  return name || `Khách ${String(id || "").slice(-4)}`;
}

function Avatar({ src, name, size = 40 }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [src]);

  if (src && !failed) {
    return (
      <img
        src={src}
        alt=""
        referrerPolicy="no-referrer"
        onError={() => setFailed(true)}
        style={{ width: size, height: size, borderRadius: "50%", objectFit: "cover", flexShrink: 0 }}
      />
    );
  }
  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: "50%",
        background: "#c7d2fe",
        color: "#3730a3",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontWeight: 700,
        fontSize: size * 0.42,
        flexShrink: 0,
      }}
    >
      {(name || "?").trim().charAt(0).toUpperCase()}
    </div>
  );
}

function timeAgo(iso) {
  if (!iso) return "";
  const diff = Date.now() - new Date(iso).getTime();
  const min = Math.floor(diff / 60000);
  if (min < 1) return "Vừa xong";
  if (min < 60) return `${min} phút`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h} giờ`;
  return new Date(iso).toLocaleDateString("vi-VN");
}

export default function ChatAdminPage() {
  const [conversations, setConversations] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [current, setCurrent] = useState({ name: null, avatar: null, messages: [] });
  const [botEnabled, setBotEnabled] = useState(true);
  const [replyText, setReplyText] = useState("");
  const [sending, setSending] = useState(false);
  const bottomRef = useRef(null);

  const loadConversations = useCallback(async () => {
    try {
      const res = await fetch("/api/conversations", { cache: "no-store" });
      if (!res.ok) return; // lỗi tạm thời: giữ nguyên danh sách cũ
      const data = await res.json();
      if (Array.isArray(data)) setConversations(data);
    } catch {}
  }, []);

  const loadSettings = useCallback(async () => {
    try {
      const res = await fetch("/api/settings", { cache: "no-store" });
      if (!res.ok) return;
      const data = await res.json();
      setBotEnabled(data.botEnabled !== false);
    } catch {}
  }, []);

  const loadMessages = useCallback(async (id) => {
    if (!id) return;
    try {
      const res = await fetch(`/api/conversations/${id}`, { cache: "no-store" });
      if (!res.ok) return;
      const data = await res.json();
      if (Array.isArray(data.messages)) setCurrent(data);
    } catch {}
  }, []);

  useEffect(() => {
    loadConversations();
    loadSettings();
    const t = setInterval(loadConversations, 3000);
    return () => clearInterval(t);
  }, [loadConversations, loadSettings]);

  useEffect(() => {
    if (!selectedId) return;
    setCurrent({ name: null, avatar: null, messages: [] });
    loadMessages(selectedId);
    const t = setInterval(() => loadMessages(selectedId), 3000);
    return () => clearInterval(t);
  }, [selectedId, loadMessages]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [current.messages.length, selectedId]);

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
    const res = await fetch(`/api/conversations/${selectedId}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: replyText }),
    });
    setSending(false);
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      alert("Không gửi được: " + (err.error || "lỗi không rõ"));
      return;
    }
    setReplyText("");
    loadMessages(selectedId);
    loadConversations();
  }

  const selected = conversations.find((c) => c.id === selectedId);
  const headName = displayName(current.name || selected?.name, selectedId);
  const headAvatar = current.avatar || selected?.avatar;

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
        <aside style={{ width: 320, borderRight: "1px solid #eee", overflowY: "auto" }}>
          {conversations.length === 0 && (
            <p style={{ padding: 16, color: "#888" }}>Chưa có khách nào nhắn tin.</p>
          )}
          {conversations.map((c) => (
            <div
              key={c.id}
              onClick={() => setSelectedId(c.id)}
              style={{
                display: "flex",
                gap: 12,
                alignItems: "center",
                padding: "12px 16px",
                cursor: "pointer",
                background: selectedId === c.id ? "#eef2ff" : "transparent",
                borderBottom: "1px solid #f5f5f5",
              }}
            >
              <Avatar src={c.avatar} name={displayName(c.name, c.id)} size={44} />
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                  <span
                    style={{
                      fontWeight: 600,
                      fontSize: 14,
                      whiteSpace: "nowrap",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                    }}
                  >
                    {displayName(c.name, c.id)}
                  </span>
                  <span style={{ fontSize: 11, color: "#aaa", flexShrink: 0 }}>{timeAgo(c.lastTime)}</span>
                </div>
                <div
                  style={{
                    fontSize: 13,
                    color: c.lastFrom === "customer" ? "#111" : "#777",
                    fontWeight: c.lastFrom === "customer" ? 600 : 400,
                    whiteSpace: "nowrap",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                  }}
                >
                  {c.lastFrom === "bot" ? "🤖 " : c.lastFrom === "admin" ? "Bạn: " : ""}
                  {c.lastMessage}
                </div>
              </div>
            </div>
          ))}
        </aside>

        {/* Khung chat */}
        <section style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0 }}>
          {!selectedId ? (
            <div style={{ margin: "auto", color: "#888" }}>Chọn một hội thoại để xem</div>
          ) : (
            <>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 12,
                  padding: "10px 20px",
                  borderBottom: "1px solid #eee",
                }}
              >
                <Avatar src={headAvatar} name={headName} size={40} />
                <div style={{ minWidth: 0 }}>
                  <strong>{headName}</strong>
                  {!current.name && current.profileError && (
                    <div style={{ fontSize: 11, color: "#b45309" }}>
                      Chưa lấy được tên từ Facebook: {current.profileError}
                    </div>
                  )}
                </div>
              </div>

              <div style={{ flex: 1, overflowY: "auto", padding: 20, background: "#f8f9fb" }}>
                {current.messages.map((m, i) => {
                  const isCustomer = m.from === "customer";
                  return (
                    <div
                      key={i}
                      style={{
                        display: "flex",
                        alignItems: "flex-end",
                        gap: 8,
                        justifyContent: isCustomer ? "flex-start" : "flex-end",
                        marginBottom: 10,
                      }}
                    >
                      {isCustomer && <Avatar src={headAvatar} name={headName} size={28} />}
                      <div
                        style={{
                          maxWidth: "70%",
                          padding: "8px 12px",
                          borderRadius: 16,
                          background: isCustomer ? "#fff" : m.from === "bot" ? "#dbeafe" : "#dcfce7",
                          boxShadow: "0 1px 1px rgba(0,0,0,0.06)",
                          whiteSpace: "pre-wrap",
                          wordBreak: "break-word",
                        }}
                      >
                        <div style={{ fontSize: 15 }}>{m.text}</div>
                        <div style={{ fontSize: 10, color: "#888", marginTop: 2 }}>
                          {m.from === "bot" ? "🤖 Bot · " : m.from === "admin" ? "Bạn · " : ""}
                          {timeAgo(m.time)}
                        </div>
                      </div>
                    </div>
                  );
                })}
                <div ref={bottomRef} />
              </div>

              <form
                onSubmit={handleSend}
                style={{ display: "flex", gap: 8, padding: 16, borderTop: "1px solid #eee" }}
              >
                <input
                  value={replyText}
                  onChange={(e) => setReplyText(e.target.value)}
                  placeholder="Nhập tin nhắn trả lời thủ công..."
                  style={{ flex: 1, padding: "10px 14px", borderRadius: 20, border: "1px solid #ddd" }}
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
                  {sending ? "Đang gửi..." : "Gửi"}
                </button>
              </form>
            </>
          )}
        </section>
      </div>
    </main>
  );
}
