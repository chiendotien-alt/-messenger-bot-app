"use client";
import { useEffect, useRef, useState, useCallback } from "react";
import { BoxIcon, KeyIcon, SettingsIcon, UsersIcon, navButtonStyle } from "./icons";
import MembersModal from "./MembersModal";
import TeachChat from "./TeachChat";

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

// Bộ chọn Fanpage ở đầu cột hội thoại: thấy tên + ảnh Page đang xem, bấm để đổi sang Page khác
function PageSwitcher({ pages, value, onChange, onManage, onToggleBot, globalBotEnabled }) {
  const [open, setOpen] = useState(false);
  const boxRef = useRef(null);

  useEffect(() => {
    function close(e) {
      if (boxRef.current && !boxRef.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);

  const current = pages.find((p) => p.id === value);
  const switchBtn = (p) => (
    <button
      onClick={() => onToggleBot(p)}
      title={p.botEnabled ? "Bot đang BẬT — bấm để tắt Page này" : "Bot đang TẮT — bấm để bật lại"}
      aria-label={p.botEnabled ? "Tắt bot Page này" : "Bật bot Page này"}
      style={{
        width: 40,
        height: 22,
        borderRadius: 11,
        border: "none",
        background: p.botEnabled ? "#16a34a" : "#c4c4c4",
        position: "relative",
        cursor: "pointer",
        flexShrink: 0,
        padding: 0,
        margin: "0 12px 0 4px",
      }}
    >
      <span
        style={{
          position: "absolute",
          top: 2,
          left: p.botEnabled ? 20 : 2,
          width: 18,
          height: 18,
          borderRadius: "50%",
          background: "#fff",
          transition: "left 0.15s",
        }}
      />
    </button>
  );
  const wrapStyle = { padding: "10px 12px", borderBottom: "1px solid #eee", position: "relative" };
  const allBadge = (
    <div
      style={{
        width: 32,
        height: 32,
        borderRadius: "50%",
        background: "#e5e7eb",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontSize: 16,
        flexShrink: 0,
      }}
    >
      🗂
    </div>
  );

  if (pages.length === 0 && !onManage) {
    return (
      <div style={wrapStyle}>
        <div style={{ padding: "9px 10px", fontSize: 13, color: "#6b7280" }}>Bạn chưa được cấp quyền Page nào. Liên hệ chủ shop.</div>
      </div>
    );
  }

  if (pages.length === 0) {
    return (
      <div style={wrapStyle}>
        <button
          onClick={onManage}
          style={{
            width: "100%",
            padding: "9px 10px",
            borderRadius: 10,
            border: "1px dashed #c7c7c7",
            background: "#fafafa",
            cursor: "pointer",
            color: "#555",
            fontSize: 13,
          }}
        >
          + Thêm Fanpage (mở Cài đặt)
        </button>
      </div>
    );
  }

  const itemStyle = (active) => ({
    display: "flex",
    alignItems: "center",
    gap: 10,
    width: "100%",
    padding: "9px 12px",
    border: "none",
    background: active ? "#eef2ff" : "#fff",
    cursor: "pointer",
    textAlign: "left",
    fontSize: 14,
  });
  const nameStyle = { flex: 1, minWidth: 0, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" };

  return (
    <div ref={boxRef} style={wrapStyle}>
      <button
        onClick={() => setOpen((o) => !o)}
        style={{
          width: "100%",
          display: "flex",
          alignItems: "center",
          gap: 10,
          padding: "8px 10px",
          borderRadius: 10,
          border: "1px solid #e2e2e2",
          background: "#fff",
          cursor: "pointer",
          textAlign: "left",
        }}
      >
        {current ? <Avatar src={current.avatar} name={current.name} size={32} /> : allBadge}
        <span style={{ ...nameStyle, fontWeight: 600, fontSize: 14 }}>
          {current ? current.name : "Tất cả các Page"}
        </span>
        {current && !current.botEnabled && (
          <span style={{ fontSize: 11, fontWeight: 600, color: "#fff", background: "#9ca3af", borderRadius: 8, padding: "2px 7px" }}>
            TẮT
          </span>
        )}
        <span style={{ color: "#888", fontSize: 11 }}>{open ? "▲" : "▼"}</span>
      </button>

      {open && (
        <div
          style={{
            position: "absolute",
            left: 12,
            right: 12,
            top: "calc(100% - 4px)",
            zIndex: 20,
            background: "#fff",
            border: "1px solid #e2e2e2",
            borderRadius: 10,
            boxShadow: "0 6px 20px rgba(0,0,0,0.12)",
            maxHeight: 340,
            overflowY: "auto",
          }}
        >
          <button
            style={itemStyle(value === "all")}
            onClick={() => {
              onChange("all");
              setOpen(false);
            }}
          >
            {allBadge}
            <span style={nameStyle}>Tất cả các Page</span>
          </button>
          {!globalBotEnabled && (
            <div style={{ padding: "8px 12px", fontSize: 12, color: "#b45309", background: "#fffbeb", borderTop: "1px solid #eee" }}>
              Nút “Bot” ở góc trên đang TẮT nên mọi Page đều không tự trả lời.
            </div>
          )}
          {pages.map((p) => (
            <div key={p.id} style={{ display: "flex", alignItems: "center", background: value === p.id ? "#eef2ff" : "#fff" }}>
              <button
                style={{ ...itemStyle(false), background: "transparent", flex: 1, minWidth: 0 }}
                onClick={() => {
                  onChange(p.id);
                  setOpen(false);
                }}
              >
                <Avatar src={p.avatar} name={p.name} size={32} />
                <span style={{ ...nameStyle, color: p.botEnabled ? "#111" : "#999" }}>{p.name}</span>
              </button>
              {onToggleBot ? switchBtn(p) : null}
            </div>
          ))}
          {onManage && (
          <button
            style={{ ...itemStyle(false), borderTop: "1px solid #eee", color: "#4f46e5" }}
            onClick={() => {
              setOpen(false);
              onManage();
            }}
          >
            ⚙ Quản lý Page
          </button>
          )}
        </div>
      )}
    </div>
  );
}

// Hộp thoại Cài đặt: thêm/gỡ Fanpage bằng Page Access Token
function SettingsModal({ pages, onClose, onChanged }) {
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  async function handleAdd(e) {
    e.preventDefault();
    if (!token.trim() || busy) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const res = await fetch("/api/pages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || "Không thêm được Page");
      } else {
        setToken("");
        setNotice(
          `Đã thêm Page “${data.page.name}”.` +
            (data.subscribed
              ? ""
              : ` Chưa tự đăng ký nhận tin nhắn được (${data.subscribeError}) — kiểm tra lại Webhook của Page này trong Meta App.`)
        );
        onChanged();
      }
    } catch {
      setError("Lỗi mạng, thử lại nhé.");
    }
    setBusy(false);
  }

  async function handleRemove(p) {
    if (!confirm(`Gỡ Page “${p.name}”?\nBot sẽ ngừng trả lời Page này. Lịch sử chat vẫn được giữ.`)) return;
    setError("");
    setNotice("");
    const res = await fetch(`/api/pages?id=${encodeURIComponent(p.id)}`, { method: "DELETE" });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.error || "Không gỡ được Page");
      return;
    }
    onChanged(p.id);
  }

  return (
    <div
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.4)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 50,
        padding: 16,
      }}
    >
      <div
        style={{
          background: "#fff",
          borderRadius: 14,
          width: "100%",
          maxWidth: 520,
          maxHeight: "90vh",
          overflowY: "auto",
          padding: 22,
          boxShadow: "0 12px 40px rgba(0,0,0,0.25)",
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
          <strong style={{ fontSize: 18 }}>Cài đặt Fanpage</strong>
          <button
            onClick={onClose}
            aria-label="Đóng"
            style={{ border: "none", background: "transparent", fontSize: 22, cursor: "pointer", color: "#666" }}
          >
            ×
          </button>
        </div>

        <div style={{ fontSize: 13, color: "#666", marginBottom: 8 }}>Các Page đang kết nối ({pages.length})</div>
        <div style={{ border: "1px solid #eee", borderRadius: 10, marginBottom: 20 }}>
          {pages.length === 0 && <div style={{ padding: 14, color: "#888", fontSize: 14 }}>Chưa có Page nào.</div>}
          {pages.map((p, i) => (
            <div
              key={p.id}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 12,
                padding: "10px 12px",
                borderTop: i ? "1px solid #f0f0f0" : "none",
              }}
            >
              <Avatar src={p.avatar} name={p.name} size={40} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 600, fontSize: 14, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {p.name}
                </div>
                <div style={{ fontSize: 11, color: "#999" }}>
                  ID: {p.id}
                  {p.source === "env" ? " · từ biến môi trường" : ""}
                </div>
              </div>
              {p.source !== "env" && (
                <button
                  onClick={() => handleRemove(p)}
                  style={{
                    padding: "6px 12px",
                    borderRadius: 8,
                    border: "1px solid #f3c0c0",
                    background: "#fff5f5",
                    color: "#c0392b",
                    cursor: "pointer",
                    fontSize: 13,
                  }}
                >
                  Gỡ
                </button>
              )}
            </div>
          ))}
        </div>

        <form onSubmit={handleAdd}>
          <label style={{ fontSize: 13, color: "#666", display: "block", marginBottom: 6 }}>
            Thêm Page mới — dán Page Access Token
          </label>
          <div style={{ display: "flex", gap: 8 }}>
            <input
              type="password"
              autoComplete="off"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              placeholder="EAAB..."
              style={{ flex: 1, padding: "10px 12px", borderRadius: 8, border: "1px solid #ddd", minWidth: 0 }}
            />
            <button
              type="submit"
              disabled={busy || !token.trim()}
              style={{
                padding: "10px 18px",
                borderRadius: 8,
                border: "none",
                background: busy || !token.trim() ? "#9ca3af" : "#111",
                color: "#fff",
                cursor: busy || !token.trim() ? "default" : "pointer",
                whiteSpace: "nowrap",
              }}
            >
              {busy ? "Đang kiểm tra..." : "Thêm"}
            </button>
          </div>
          <p style={{ fontSize: 12, color: "#888", margin: "8px 0 0" }}>
            Lấy token: Meta for Developers → App của bạn → Messenger → Cài đặt API → chọn Page → Tạo token. Tên và ảnh
            Page sẽ tự lấy từ Facebook.
          </p>
          {error && <p style={{ fontSize: 13, color: "#c0392b", margin: "10px 0 0" }}>{error}</p>}
          {notice && <p style={{ fontSize: 13, color: "#15803d", margin: "10px 0 0" }}>{notice}</p>}
        </form>
      </div>
    </div>
  );
}

// Hộp thoại API key AI (Gemini): thêm nhiều key, bot tự xoay vòng khi 1 key hết hạn mức
function ApiKeysModal({ onClose }) {
  const [keys, setKeys] = useState([]);
  const [loading, setLoading] = useState(true);
  const [keyValue, setKeyValue] = useState("");
  const [label, setLabel] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/keys", { cache: "no-store" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) setError(data.error || "Không tải được danh sách key");
      else setKeys(data.keys || []);
    } catch {
      setError("Lỗi mạng, thử lại nhé.");
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function handleAdd(e) {
    e.preventDefault();
    if (!keyValue.trim() || busy) return;
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/keys", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key: keyValue, label }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) setError(data.error || "Không thêm được key");
      else {
        setKeys(data.keys || []);
        setKeyValue("");
        setLabel("");
      }
    } catch {
      setError("Lỗi mạng, thử lại nhé.");
    }
    setBusy(false);
  }

  async function handleRemove(k) {
    if (!confirm(`Xóa API key ${k.masked}?`)) return;
    setError("");
    const res = await fetch("/api/keys", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: k.id }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) setError(data.error || "Không xóa được key");
    else setKeys(data.keys || []);
  }

  return (
    <div
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.4)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 50,
        padding: 16,
      }}
    >
      <div
        style={{
          background: "#fff",
          borderRadius: 14,
          width: "100%",
          maxWidth: 520,
          maxHeight: "90vh",
          overflowY: "auto",
          padding: 22,
          boxShadow: "0 12px 40px rgba(0,0,0,0.25)",
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
          <strong style={{ fontSize: 18 }}>API key AI (Gemini)</strong>
          <button
            onClick={onClose}
            aria-label="Đóng"
            style={{ border: "none", background: "transparent", fontSize: 22, cursor: "pointer", color: "#666" }}
          >
            ×
          </button>
        </div>

        <div style={{ fontSize: 13, color: "#666", marginBottom: 8 }}>Các key đang dùng ({keys.length})</div>
        <div style={{ border: "1px solid #eee", borderRadius: 10, marginBottom: 20 }}>
          {loading && <div style={{ padding: 14, color: "#888", fontSize: 14 }}>Đang tải...</div>}
          {!loading && keys.length === 0 && (
            <div style={{ padding: 14, color: "#888", fontSize: 14 }}>Chưa có key nào.</div>
          )}
          {keys.map((k, i) => (
            <div
              key={k.id}
              style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 12px", borderTop: i ? "1px solid #f0f0f0" : "none" }}
            >
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 600, fontSize: 14, fontFamily: "monospace" }}>{k.masked}</div>
                {k.label && <div style={{ fontSize: 11, color: "#999" }}>{k.label}</div>}
              </div>
              {k.removable && (
                <button
                  onClick={() => handleRemove(k)}
                  style={{
                    padding: "6px 12px",
                    borderRadius: 8,
                    border: "1px solid #f3c0c0",
                    background: "#fff5f5",
                    color: "#c0392b",
                    cursor: "pointer",
                    fontSize: 13,
                  }}
                >
                  Xóa
                </button>
              )}
            </div>
          ))}
        </div>

        <form onSubmit={handleAdd}>
          <label style={{ fontSize: 13, color: "#666", display: "block", marginBottom: 6 }}>Thêm API key mới</label>
          <input
            type="password"
            autoComplete="off"
            value={keyValue}
            onChange={(e) => setKeyValue(e.target.value)}
            placeholder="AIza..."
            style={{ width: "100%", boxSizing: "border-box", padding: "10px 12px", borderRadius: 8, border: "1px solid #ddd", marginBottom: 8 }}
          />
          <div style={{ display: "flex", gap: 8 }}>
            <input
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="Ghi chú (không bắt buộc)"
              style={{ flex: 1, padding: "10px 12px", borderRadius: 8, border: "1px solid #ddd", minWidth: 0 }}
            />
            <button
              type="submit"
              disabled={busy || !keyValue.trim()}
              style={{
                padding: "10px 18px",
                borderRadius: 8,
                border: "none",
                background: busy || !keyValue.trim() ? "#9ca3af" : "#111",
                color: "#fff",
                cursor: busy || !keyValue.trim() ? "default" : "pointer",
                whiteSpace: "nowrap",
              }}
            >
              {busy ? "Đang lưu..." : "Thêm"}
            </button>
          </div>
          <p style={{ fontSize: 12, color: "#888", margin: "8px 0 0" }}>
            Lấy key miễn phí tại Google AI Studio. Có nhiều key thì bot tự chuyển sang key khác khi 1 key hết hạn mức.
          </p>
          {error && <p style={{ fontSize: 13, color: "#c0392b", margin: "10px 0 0" }}>{error}</p>}
        </form>
      </div>
    </div>
  );
}

const money = (n) => (Number(n) || 0).toLocaleString("vi-VN") + "đ";

// Tình trạng đơn (tick bằng tay)
const ORDER_STATUS = {
  draft: { label: "Mới tạo", color: "#6b7280" },
  shipped: { label: "Đã gửi hàng", color: "#2563eb" },
  delivered: { label: "Đã giao", color: "#16a34a" },
  returned: { label: "Hoàn / Hủy", color: "#dc2626" },
};
const statusOf = (o) => (ORDER_STATUS[o?.status] ? o.status : "draft");
const filterFieldStyle = { height: 34, padding: "0 10px", borderRadius: 8, border: "1px solid #d1d5db", background: "#fff", fontSize: 13, color: "#111827", width: "100%", boxSizing: "border-box", outline: "none" };
const filterLabelStyle = { fontSize: 11, fontWeight: 600, letterSpacing: 0.4, color: "#6b7280", textTransform: "uppercase", marginBottom: 5 };
const filterChipStyle = (active) => ({
  height: 28, padding: "0 11px", borderRadius: 999, fontSize: 12.5, cursor: "pointer", whiteSpace: "nowrap",
  border: active ? "1px solid #4f46e5" : "1px solid #d1d5db",
  background: active ? "#eef2ff" : "#fff",
  color: active ? "#4338ca" : "#374151",
  fontWeight: active ? 600 : 400,
});
// Ngày hôm nay theo giờ Việt Nam (YYYY-MM-DD), cộng/trừ thêm n ngày
function vnDay(offset = 0) {
  const t = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Ho_Chi_Minh" });
  const d = new Date(t + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + offset);
  return d.toISOString().slice(0, 10);
}
const inputStyle = { width: "100%", padding: "8px 10px", borderRadius: 8, border: "1px solid #ddd", fontSize: 14, boxSizing: "border-box" };
const fmtDateTime = (d) => {
  if (!d) return "";
  const dt = new Date(d);
  if (isNaN(dt)) return "";
  return dt.toLocaleString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
};
const labelStyle = { fontSize: 12, color: "#666", margin: "10px 0 3px", display: "block" };

const blankOrder = { customerName: "", phone: "", address: "", productId: "", productName: "", variant: "", quantity: 1, unitPrice: 0, shipFee: 0, note: "" };

// Cột đơn hàng bên phải: luôn hiện khi đang mở 1 hội thoại.
// Trên cùng là nút "Tạo đơn"; bên dưới là các đơn đã lưu, mỗi đơn có nút bút để sửa.
function OrderPanel({ conversationId, pageId, onChanged }) {
  const [order, setOrder] = useState(blankOrder);
  const [products, setProducts] = useState([]);
  const [saved, setSaved] = useState([]);
  const [orderId, setOrderId] = useState(null);
  const [formOpen, setFormOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState("");
  const [aiOk, setAiOk] = useState(false);

  const loadSaved = useCallback(async () => {
    try {
      const res = await fetch(`/api/orders?conversationId=${encodeURIComponent(conversationId)}`, { cache: "no-store" });
      if (res.ok) setSaved(await res.json());
    } catch {}
  }, [conversationId]);

  // Danh sách sản phẩm để chọn khi sửa đơn (không cần gọi AI)
  const loadProducts = useCallback(async () => {
    try {
      const res = await fetch("/api/products", { cache: "no-store" });
      if (!res.ok) return;
      const data = await res.json();
      const list = Array.isArray(data) ? data : data.products || [];
      setProducts(list.map((p) => ({ id: p.id, name: p.name })));
    } catch {}
  }, []);

  async function autoFill() {
    setLoading(true);
    setMsg("");
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 58000);
    try {
      const res = await fetch("/api/orders/draft", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ conversationId }),
        signal: ctrl.signal,
      });
      const raw = await res.text();
      let data = null;
      try {
        data = JSON.parse(raw);
      } catch {}
      if (!data) throw new Error(res.status === 504 || res.status === 500 ? "Máy chủ phản hồi quá lâu, bấm ↻ để thử lại" : "Máy chủ trả về dữ liệu lỗi, bấm ↻ để thử lại");
      if (!res.ok) throw new Error(data.error || "Lỗi");
      setOrder(data.order);
      setProducts(data.products || []);
      setAiOk(!!data.aiOk);
      setOrderId(null);
    } catch (e) {
      setAiOk(false);
      setMsg("Không tự điền được: " + (e.name === "AbortError" ? "quá thời gian chờ, bấm ↻ để thử lại" : e.message));
    }
    clearTimeout(timer);
    setLoading(false);
  }

  useEffect(() => {
    loadSaved();
    loadProducts();
  }, [conversationId]);

  function startNew() {
    setOrder(blankOrder);
    setOrderId(null);
    setFormOpen(true);
    autoFill();
  }

  function startEdit(o) {
    setOrder({ ...blankOrder, ...o });
    setOrderId(o.id);
    setAiOk(false);
    setLoading(false);
    setMsg("");
    setFormOpen(true);
  }

  function cancelForm() {
    setFormOpen(false);
    setOrderId(null);
    setMsg("");
  }

  const set = (k, v) => setOrder((o) => ({ ...o, [k]: v }));
  const total = (Number(order.unitPrice) || 0) * (Number(order.quantity) || 1) + (Number(order.shipFee) || 0);

  function pickProduct(id) {
    const p = products.find((x) => x.id === id);
    setOrder((o) => ({ ...o, productId: id, productName: p ? p.name : "" }));
  }

  function orderText() {
    return [
      `Khách: ${order.customerName}`,
      `SĐT: ${order.phone}`,
      `Địa chỉ: ${order.address}`,
      `Sản phẩm: ${order.productName}${order.variant ? " - " + order.variant : ""}`,
      `Số lượng: ${order.quantity}`,
      `Đơn giá: ${money(order.unitPrice)}`,
      `Phí ship: ${money(order.shipFee)}`,
      `Tổng thu: ${money(total)}`,
      order.note ? `Ghi chú: ${order.note}` : "",
    ]
      .filter(Boolean)
      .join("\n");
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(orderText());
      setMsg("Đã sao chép đơn ✓");
    } catch {
      setMsg("Không sao chép được");
    }
  }

  async function save() {
    if (!order.phone || !order.address) {
      setMsg("Cần có số điện thoại và địa chỉ trước khi lưu đơn.");
      return;
    }
    const res = await fetch("/api/orders", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ conversationId, pageId, id: orderId, order: { ...order, total } }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setMsg("Lưu lỗi: " + (data.error || res.status));
      return;
    }
    // Lưu xong: đóng form, đơn hiện thành thẻ bên dưới (có bút để sửa)
    setFormOpen(false);
    setOrderId(null);
    setMsg("");
    loadSaved();
    onChanged && onChanged();
  }

  // Tick tình trạng đơn: gửi hàng → đã giao → (hoặc) hoàn/hủy. Bỏ tick thì lùi về mức trước.
  async function toggleStatus(o, key) {
    const cur = statusOf(o);
    let next;
    if (key === "shipped") next = cur === "shipped" || cur === "delivered" ? "draft" : "shipped";
    else if (key === "delivered") next = cur === "delivered" ? "shipped" : "delivered";
    else next = cur === "returned" ? "draft" : "returned";
    setSaved((list) => list.map((x) => (x.id === o.id ? { ...x, status: next } : x)));
    try {
      await fetch("/api/orders", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: o.id, status: next }) });
    } catch {}
    loadSaved();
    onChanged && onChanged();
  }

  async function removeSaved(id) {
    if (!confirm("Xóa đơn này?")) return;
    await fetch("/api/orders", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id }) });
    if (orderId === id) cancelForm();
    loadSaved();
    onChanged && onChanged();
  }

  const iconBtn = { border: "none", background: "transparent", cursor: "pointer", fontSize: 15, padding: "2px 6px", borderRadius: 6 };

  return (
    <aside style={{ width: 360, flexShrink: 0, borderLeft: "1px solid #eee", display: "flex", flexDirection: "column", background: "#fff" }}>
      {/* Nút Tạo đơn luôn nằm trên cùng */}
      <div style={{ padding: "12px 16px", borderBottom: "1px solid #eee" }}>
        <button
          onClick={startNew}
          disabled={formOpen && orderId === null && loading}
          style={{ width: "100%", padding: "10px", borderRadius: 8, border: "none", background: "#16a34a", color: "#fff", fontWeight: 600, fontSize: 14, cursor: "pointer" }}
        >
          🧾 Tạo đơn
        </button>
      </div>

      <div style={{ flex: 1, overflowY: "auto", padding: "12px 16px" }}>
        {formOpen && (
          <div style={{ border: "1px solid #bbf7d0", background: "#fafffc", borderRadius: 10, padding: "10px 12px", marginBottom: 14 }}>
            <strong style={{ fontSize: 14 }}>{orderId ? `✏️ Sửa đơn #${orderId}` : "Đơn mới"}</strong>
            {loading && <div style={{ color: "#888", fontSize: 13, marginTop: 6 }}>Đang đọc chat để điền đơn...</div>}
            {!loading && !orderId && !aiOk && (
              <div style={{ color: "#b45309", fontSize: 12, marginTop: 6 }}>AI chưa điền được, bạn nhập tay các ô còn trống nhé.</div>
            )}
            {!loading && !orderId && aiOk && (
              <div style={{ color: "#888", fontSize: 12, marginTop: 6 }}>Đã tự điền từ chat. Bạn kiểm tra lại trước khi lưu.</div>
            )}

            <label style={labelStyle}>Tên người nhận</label>
            <input style={inputStyle} value={order.customerName} onChange={(e) => set("customerName", e.target.value)} />
            <label style={labelStyle}>Số điện thoại</label>
            <input style={inputStyle} value={order.phone} onChange={(e) => set("phone", e.target.value)} />
            <label style={labelStyle}>Địa chỉ nhận hàng</label>
            <textarea style={{ ...inputStyle, minHeight: 64 }} value={order.address} onChange={(e) => set("address", e.target.value)} />
            <label style={labelStyle}>Sản phẩm</label>
            <select style={inputStyle} value={order.productId} onChange={(e) => pickProduct(e.target.value)}>
              <option value="">{order.productName && !order.productId ? order.productName : "— Chọn sản phẩm —"}</option>
              {products.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
            <label style={labelStyle}>Màu / size</label>
            <input style={inputStyle} value={order.variant} onChange={(e) => set("variant", e.target.value)} />
            <div style={{ display: "flex", gap: 8 }}>
              <div style={{ flex: 1 }}>
                <label style={labelStyle}>Số lượng</label>
                <input type="number" min="1" style={inputStyle} value={order.quantity} onChange={(e) => set("quantity", e.target.value)} />
              </div>
              <div style={{ flex: 2 }}>
                <label style={labelStyle}>Đơn giá (đ)</label>
                <input type="number" min="0" style={inputStyle} value={order.unitPrice} onChange={(e) => set("unitPrice", e.target.value)} />
              </div>
            </div>
            <label style={labelStyle}>Phí ship (đ)</label>
            <input type="number" min="0" style={inputStyle} value={order.shipFee} onChange={(e) => set("shipFee", e.target.value)} />
            <label style={labelStyle}>Ghi chú</label>
            <input style={inputStyle} value={order.note} onChange={(e) => set("note", e.target.value)} />

            <div style={{ margin: "14px 0 8px", fontSize: 16 }}>
              Tổng thu: <strong style={{ color: "#c0392b" }}>{money(total)}</strong>
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <button onClick={save} disabled={loading} style={{ flex: 1, padding: "10px", borderRadius: 8, border: "none", background: "#16a34a", color: "#fff", fontWeight: 600, cursor: "pointer" }}>
                {orderId ? `Cập nhật đơn #${orderId}` : "Lưu đơn"}
              </button>
              <button onClick={copy} style={{ padding: "10px 12px", borderRadius: 8, border: "1px solid #ddd", background: "#fff", cursor: "pointer" }}>Sao chép</button>
              {!orderId && (
                <button onClick={autoFill} title="Điền lại từ chat" style={{ padding: "10px 12px", borderRadius: 8, border: "1px solid #ddd", background: "#fff", cursor: "pointer" }}>↻</button>
              )}
            </div>
            <button onClick={cancelForm} style={{ marginTop: 8, width: "100%", padding: "8px", borderRadius: 8, border: "1px solid #ddd", background: "#fff", color: "#555", cursor: "pointer" }}>
              Đóng
            </button>
            {msg && <div style={{ fontSize: 13, marginTop: 8, color: msg.includes("✓") ? "#166534" : "#b45309" }}>{msg}</div>}
          </div>
        )}

        <div style={{ fontSize: 13, fontWeight: 600, color: "#444", marginBottom: 6 }}>Đơn hàng ({saved.length})</div>
        {saved.length === 0 && !formOpen && (
          <div style={{ fontSize: 13, color: "#9ca3af", fontStyle: "italic" }}>Khách này chưa có đơn nào.</div>
        )}
        {saved.map((o) => (
          <div
            key={o.id}
            style={{ border: orderId === o.id ? "1px solid #16a34a" : "1px solid #e5e7eb", borderRadius: 10, marginBottom: 10, fontSize: 13, background: "#fff", overflow: "hidden" }}
          >
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "6px 10px", background: ORDER_STATUS[statusOf(o)].color, color: "#fff" }}>
              <strong>Đơn #{o.id} · {ORDER_STATUS[statusOf(o)].label}</strong>
              <span style={{ display: "flex", alignItems: "center", gap: 2 }}>
                <button onClick={() => startEdit(o)} title="Sửa đơn" aria-label="Sửa đơn" style={{ ...iconBtn, color: "#fff" }}>✏️</button>
                <button onClick={() => removeSaved(o.id)} title="Xóa đơn" aria-label="Xóa đơn" style={{ ...iconBtn, color: "#fff" }}>🗑</button>
              </span>
            </div>
            <div style={{ padding: "8px 10px", lineHeight: 1.65 }}>
              <div>👤 {o.customerName}{o.phone ? ` — ${o.phone}` : ""}</div>
              <div>📍 {o.address}</div>
              <div>🛍 {o.productName}{o.variant ? ` - ${o.variant}` : ""} × {o.quantity}</div>
              <div style={{ color: "#555" }}>Đơn giá: {money(o.unitPrice)} · Ship: {money(o.shipFee)}</div>
              {o.note ? <div>📝 {o.note}</div> : null}
              <div style={{ color: "#c0392b", fontWeight: 600 }}>Tổng thu: {money(o.total)}</div>
              <div style={{ color: "#999", fontSize: 12 }}>{fmtDateTime(o.createdAt)}</div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: "4px 14px", marginTop: 6, paddingTop: 6, borderTop: "1px dashed #e5e7eb" }}>
                {[["shipped", "Đã gửi hàng"], ["delivered", "Đã giao"], ["returned", "Hoàn / Hủy"]].map(([k, label]) => {
                  const st = statusOf(o);
                  const checked = k === "shipped" ? st === "shipped" || st === "delivered" : st === k;
                  return (
                    <label key={k} style={{ display: "flex", alignItems: "center", gap: 5, cursor: "pointer", fontSize: 13, color: checked ? ORDER_STATUS[k].color : "#555", fontWeight: checked ? 600 : 400 }}>
                      <input type="checkbox" checked={checked} onChange={() => toggleStatus(o, k)} style={{ width: 16, height: 16, cursor: "pointer" }} />
                      {label}
                    </label>
                  );
                })}
              </div>
            </div>
          </div>
        ))}
      </div>
    </aside>
  );
}

export default function ChatAdminPage() {
  const [conversations, setConversations] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [current, setCurrent] = useState({ name: null, avatar: null, messages: [] });
  const [botEnabled, setBotEnabled] = useState(true);
  const [replyText, setReplyText] = useState("");
  const [sending, setSending] = useState(false);
  const bottomRef = useRef(null);
  const [pages, setPages] = useState([]);
  const [pagesLoaded, setPagesLoaded] = useState(false);
  const [pageFilter, setPageFilter] = useState("all"); // "all" hoặc ID của 1 Page
  const [showSettings, setShowSettings] = useState(false);
  const [showKeys, setShowKeys] = useState(false);
  const [showMembers, setShowMembers] = useState(false);
  const [isOwner, setIsOwner] = useState(false); // false = member cấp dưới (ẩn các chức năng của chủ shop)
  useEffect(() => {
    fetch("/api/me", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setIsOwner(Boolean(d?.isOwner)))
      .catch(() => {});
  }, []);
  const pageFilterRef = useRef("all");
  const [ordersByConv, setOrdersByConv] = useState({}); // { conversationId: [đơn mới → cũ] }
  const [timePreset, setTimePreset] = useState("all"); // all | today | yesterday | 7d | 30d | custom
  const [dateFrom, setDateFrom] = useState(""); // YYYY-MM-DD, trống = không giới hạn
  const [dateTo, setDateTo] = useState("");
  const rangeRef = useRef("|");
  const [cleanup, setCleanup] = useState({ phase: "idle", count: 0, msg: "" }); // idle | loading | confirm | deleting | done | error
  const [orderFilter, setOrderFilter] = useState("all"); // all | none | draft | shipped | delivered | returned
  const [bc, setBc] = useState({ phase: "idle", count: 0, text: "", msg: "", sent: 0, failed: 0 }); // idle | loading | edit | sending | done | error

  const loadOrders = useCallback(async () => {
    try {
      const res = await fetch("/api/orders?all=1", { cache: "no-store" });
      if (!res.ok) return;
      const data = await res.json();
      if (!Array.isArray(data)) return;
      const map = {};
      for (const o of data) (map[o.conversationId] = map[o.conversationId] || []).push(o);
      setOrdersByConv(map);
    } catch {}
  }, []);
  const [teachMode, setTeachMode] = useState(false); // đang ở chế độ "Dạy bot"
  const [teachView, setTeachView] = useState("sim"); // "sim" = Mô phỏng đoạn chat, "saved" = Câu đã dạy
  const [teachMenu, setTeachMenu] = useState(false); // đang sổ menu của nút Dạy bot
  const [teachEver, setTeachEver] = useState(false); // đã mở Dạy bot ít nhất 1 lần (giữ đoạn chat đang soạn khi bấm sang chat khác)
  const [phoneOnly, setPhoneOnly] = useState(false); // chỉ hiện khách đã để lại số điện thoại
  const phoneOnlyRef = useRef(false);
  const [searchInput, setSearchInput] = useState(""); // chữ đang gõ trong ô tìm tên
  const [search, setSearch] = useState(""); // chữ tìm đã chốt (sau khi ngừng gõ ~0,3 giây)
  const searchRef = useRef("");
  useEffect(() => {
    const t = setTimeout(() => {
      const v = searchInput.trim();
      searchRef.current = v;
      setSearch(v);
    }, 300);
    return () => clearTimeout(t);
  }, [searchInput]);

  const loadConversations = useCallback(async () => {
    const filter = pageFilter;
    const onlyPhone = phoneOnly;
    const from = dateFrom;
    const to = dateTo;
    const q = search;
    try {
      const params = [];
      if (q) params.push(`q=${encodeURIComponent(q)}`);
      if (filter !== "all") params.push(`pageId=${encodeURIComponent(filter)}`);
      if (onlyPhone) params.push("phone=1");
      if (from) params.push(`from=${from}`);
      if (to) params.push(`to=${to}`);
      const qs = params.length ? "?" + params.join("&") : "";
      const res = await fetch("/api/conversations" + qs, { cache: "no-store" });
      if (!res.ok) return; // lỗi tạm thời: giữ nguyên danh sách cũ
      const data = await res.json();
      // Bỏ kết quả về muộn của Page đã đổi đi (tránh nhảy lẫn danh sách)
      if (Array.isArray(data) && pageFilterRef.current === filter && phoneOnlyRef.current === onlyPhone && rangeRef.current === `${from}|${to}` && searchRef.current === q) setConversations(data);
    } catch {}
  }, [pageFilter, phoneOnly, dateFrom, dateTo, search]);

  const loadPages = useCallback(async () => {
    try {
      const res = await fetch("/api/pages", { cache: "no-store" });
      if (!res.ok) return;
      const data = await res.json();
      if (Array.isArray(data)) {
        setPages(data);
        setPagesLoaded(true);
      }
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
    loadSettings();
    loadPages();
    // Nhớ Page đang xem lần trước
    try {
      const saved = localStorage.getItem("adminPageFilter");
      if (saved) {
        pageFilterRef.current = saved;
        setPageFilter(saved);
      }
      if (localStorage.getItem("adminPhoneOnly") === "1") {
        phoneOnlyRef.current = true;
        setPhoneOnly(true);
      }
    } catch {}
  }, [loadSettings, loadPages]);

  useEffect(() => {
    loadConversations();
    const t = setInterval(loadConversations, 3000);
    return () => clearInterval(t);
  }, [loadConversations]);

  useEffect(() => {
    loadOrders();
    const t = setInterval(loadOrders, 10000);
    return () => clearInterval(t);
  }, [loadOrders]);

  // Page đang xem đã bị gỡ → quay về "Tất cả"
  useEffect(() => {
    if (pagesLoaded && pageFilter !== "all" && !pages.some((p) => p.id === pageFilter)) changePage("all");
  }, [pages, pagesLoaded, pageFilter]);

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

  // Dọn chat không có SĐT, không có đơn, quá 48 giờ không có tin mới (xem trước → xác nhận → xóa)
  async function startCleanup() {
    setCleanup({ phase: "loading", count: 0, msg: "" });
    try {
      const qs = pageFilter !== "all" ? `?pageId=${encodeURIComponent(pageFilter)}` : "";
      const res = await fetch("/api/conversations/cleanup" + qs, { cache: "no-store" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Lỗi");
      if (!data.count) setCleanup({ phase: "done", count: 0, msg: "Không có cuộc chat nào cần dọn." });
      else setCleanup({ phase: "confirm", count: data.count, msg: "" });
    } catch (e) {
      setCleanup({ phase: "error", count: 0, msg: "Không kiểm tra được: " + (e.message || e) });
    }
  }

  async function confirmCleanup() {
    setCleanup((c) => ({ ...c, phase: "deleting" }));
    try {
      const res = await fetch("/api/conversations/cleanup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pageId: pageFilter !== "all" ? pageFilter : null }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Lỗi");
      setCleanup({ phase: "done", count: 0, msg: `Đã xóa ${data.deleted} cuộc chat.` });
      setSelectedId(null);
      loadConversations();
    } catch (e) {
      setCleanup({ phase: "error", count: 0, msg: "Xóa không thành công: " + (e.message || e) });
    }
  }

  // Nhắn 1 câu tự viết cho tất cả khách im lặng quá 3 giờ
  async function startBroadcast() {
    let saved = "";
    try {
      saved = localStorage.getItem("bcText") || "";
    } catch {}
    setBc({ phase: "loading", count: 0, text: saved, msg: "", sent: 0, failed: 0 });
    try {
      const qs = pageFilter !== "all" ? `?pageId=${encodeURIComponent(pageFilter)}` : "";
      const res = await fetch("/api/conversations/broadcast" + qs, { cache: "no-store" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Lỗi");
      setBc({ phase: "edit", count: data.count, text: saved, msg: "", sent: 0, failed: 0 });
    } catch (e) {
      setBc({ phase: "error", count: 0, text: saved, msg: "Không kiểm tra được: " + (e.message || e), sent: 0, failed: 0 });
    }
  }

  async function confirmBroadcast() {
    const text = bc.text.trim();
    if (!text) return;
    try {
      localStorage.setItem("bcText", text);
    } catch {}
    setBc((b) => ({ ...b, phase: "sending", sent: 0, failed: 0, msg: "" }));
    let sent = 0;
    const failedIds = [];
    let lastErr = "";
    try {
      for (let round = 0; round < 60; round++) {
        const res = await fetch("/api/conversations/broadcast", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ pageId: pageFilter !== "all" ? pageFilter : null, text, excludeIds: failedIds }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Lỗi");
        sent += data.sent;
        failedIds.push(...(data.failedIds || []));
        if (data.errors?.length) lastErr = data.errors[0];
        setBc((b) => ({ ...b, sent, failed: failedIds.length }));
        if (!data.remaining) break;
      }
      const msg =
        `Đã gửi cho ${sent} khách.` +
        (failedIds.length ? ` ${failedIds.length} khách gửi không được${lastErr ? ` (${lastErr})` : ""}.` : "");
      setBc({ phase: "done", count: 0, text, msg, sent, failed: failedIds.length });
      loadConversations();
    } catch (e) {
      setBc({ phase: "error", count: 0, text, msg: `Đã gửi ${sent} khách rồi bị dừng: ` + (e.message || e), sent, failed: failedIds.length });
      loadConversations();
    }
  }

  function applyRange(from, to) {
    rangeRef.current = `${from}|${to}`;
    setDateFrom(from);
    setDateTo(to);
    setConversations([]);
  }

  function changeTimePreset(p) {
    setTimePreset(p);
    if (p === "all") applyRange("", "");
    else if (p === "today") applyRange(vnDay(0), vnDay(0));
    else if (p === "yesterday") applyRange(vnDay(-1), vnDay(-1));
    else if (p === "7d") applyRange(vnDay(-6), vnDay(0));
    else if (p === "30d") applyRange(vnDay(-29), vnDay(0));
    else applyRange(dateFrom || vnDay(-6), dateTo || vnDay(0)); // custom: giữ khoảng đang có hoặc mặc định 7 ngày
  }

  // Lọc thêm theo tình trạng đơn (đơn đã tick bằng tay)
  const shownConversations = conversations.filter((c) => {
    if (orderFilter === "all") return true;
    const list = ordersByConv[c.id] || [];
    if (orderFilter === "none") return list.length === 0;
    return list.some((o) => statusOf(o) === orderFilter);
  });
  const filtering = timePreset !== "all" || orderFilter !== "all";

  function togglePhoneOnly() {
    const next = !phoneOnly;
    phoneOnlyRef.current = next;
    setPhoneOnly(next);
    setConversations([]);
    try {
      localStorage.setItem("adminPhoneOnly", next ? "1" : "0");
    } catch {}
  }

  function changePage(id) {
    pageFilterRef.current = id;
    setPageFilter(id);
    setSelectedId(null);
    setCurrent({ name: null, avatar: null, messages: [] });
    setConversations([]);
    try {
      localStorage.setItem("adminPageFilter", id);
    } catch {}
  }

  async function handlePagesChanged(removedId) {
    await loadPages();
    if (removedId && removedId === pageFilterRef.current) changePage("all");
  }

  async function togglePageBot(p) {
    const next = !p.botEnabled;
    setPages((list) => list.map((x) => (x.id === p.id ? { ...x, botEnabled: next } : x)));
    try {
      const res = await fetch("/api/pages", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: p.id, botEnabled: next }),
      });
      if (!res.ok) throw new Error("fail");
    } catch {
      alert("Không đổi được, thử lại nhé.");
      loadPages();
    }
  }

  async function toggleBot() {
    const next = !botEnabled;
    setBotEnabled(next);
    await fetch("/api/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ botEnabled: next }),
    });
  }

  async function deleteChat(id, name) {
    if (!confirm(`Xóa toàn bộ cuộc trò chuyện với ${name}?\nBot cũng sẽ quên khách này. Không thể khôi phục.`)) return;
    const res = await fetch(`/api/conversations/${id}`, { method: "DELETE" });
    if (!res.ok) {
      alert("Không xóa được, thử lại nhé.");
      return;
    }
    setConversations((list) => list.filter((c) => c.id !== id));
    if (selectedId === id) {
      setSelectedId(null);
      setCurrent({ name: null, avatar: null, messages: [] });
    }
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
  const pageMap = Object.fromEntries(pages.map((p) => [p.id, p]));
  const chatPage = pageMap[current.pageId || selected?.pageId];
  const showPageBadge = pageFilter === "all" && pages.length > 1;

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
        <strong style={{ fontSize: 18 }}>Hộp thoại khách hàng</strong>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        {isOwner && (
<button
          onClick={() => setShowSettings(true)}
          title="Cài đặt Fanpage"
          aria-label="Cài đặt Fanpage"
          style={{ ...navButtonStyle, cursor: "pointer" }}
        >
          <SettingsIcon />
        </button>
)}
        {isOwner && (
<button
          onClick={() => setShowKeys(true)}
          title="API key AI"
          aria-label="API key AI"
          style={{ ...navButtonStyle, cursor: "pointer" }}
        >
          <KeyIcon />
        </button>
)}
        {isOwner && (
        <button
          onClick={() => setShowMembers(true)}
          title="Quản lý member"
          aria-label="Quản lý member"
          style={{ ...navButtonStyle, cursor: "pointer" }}
        >
          <UsersIcon />
        </button>
        )}
        <a href="/admin/products" title={isOwner ? "Quản lý sản phẩm" : "Xem sản phẩm"} aria-label="Sản phẩm" style={navButtonStyle}>
          <BoxIcon />
        </a>
        {isOwner && (
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
)}
        </div>
      </header>

      <div style={{ flex: 1, display: "flex", overflow: "hidden" }}>
        {/* Danh sách hội thoại */}
        <aside style={{ width: 320, borderRight: "1px solid #eee", display: "flex", flexDirection: "column", position: "relative" }}>
          <PageSwitcher
            pages={pages}
            value={pageFilter}
            onChange={changePage}
            onManage={isOwner ? () => setShowSettings(true) : undefined}
            onToggleBot={isOwner ? togglePageBot : undefined}
            globalBotEnabled={botEnabled}
          />
          {/* Ô tìm khách theo tên */}
          <div style={{ padding: "10px 16px 0", position: "relative" }}>
            <input
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder="🔍 Tìm khách theo tên..."
              aria-label="Tìm khách theo tên"
              style={{ width: "100%", boxSizing: "border-box", height: 36, padding: "0 32px 0 12px", fontSize: 13.5, border: "1px solid #d1d5db", borderRadius: 9, outline: "none", background: "#f9fafb" }}
            />
            {searchInput && (
              <button
                onClick={() => setSearchInput("")}
                aria-label="Xóa chữ tìm"
                style={{ position: "absolute", right: 24, top: 17, width: 22, height: 22, border: "none", borderRadius: "50%", background: "#d1d5db", color: "#374151", cursor: "pointer", padding: 0, lineHeight: "22px", fontSize: 14 }}
              >
                ×
              </button>
            )}
          </div>
          {/* Thanh công cụ: Tất cả / Có SĐT + Dạy bot */}
          <div style={{ padding: "10px 16px", borderBottom: "1px solid #f0f0f0", display: "flex", gap: 10, alignItems: "center" }}>
            <div style={{ display: "flex", flex: 1, background: "#f3f4f6", borderRadius: 9, padding: 3 }}>
              {[[false, "Tất cả khách"], [true, "Có số điện thoại"]].map(([val, label]) => (
                <button
                  key={label}
                  onClick={() => phoneOnly !== val && togglePhoneOnly()}
                  aria-pressed={phoneOnly === val}
                  style={{
                    flex: 1, height: 30, border: "none", borderRadius: 7, cursor: "pointer", fontSize: 13,
                    background: phoneOnly === val ? "#fff" : "transparent",
                    color: phoneOnly === val ? "#111827" : "#6b7280",
                    fontWeight: phoneOnly === val ? 600 : 500,
                    boxShadow: phoneOnly === val ? "0 1px 2px rgba(0,0,0,0.12)" : "none",
                  }}
                >
                  {label}
                </button>
              ))}
            </div>
            {isOwner && (
<div style={{ position: "relative" }}>
              <button
                onClick={() => setTeachMenu((v) => !v)}
                aria-pressed={teachMode}
                style={{
                  height: 36, padding: "0 12px", borderRadius: 9, fontSize: 13, fontWeight: 600, cursor: "pointer",
                  border: "1px solid #1d4ed8",
                  background: teachMode ? "#1d4ed8" : "#fff",
                  color: teachMode ? "#fff" : "#1d4ed8",
                }}
              >
                Dạy bot ▾
              </button>
              {teachMenu && (
                <>
                  <div onClick={() => setTeachMenu(false)} style={{ position: "fixed", inset: 0, zIndex: 40 }} />
                  <div style={{ position: "absolute", right: 0, top: 40, zIndex: 41, background: "#fff", border: "1px solid #ddd", borderRadius: 10, boxShadow: "0 6px 20px rgba(0,0,0,0.15)", minWidth: 200, overflow: "hidden" }}>
                    {[["sim", "💬 Mô phỏng đoạn chat"], ["saved", "📚 Câu đã dạy"]].map(([k, label]) => (
                      <button
                        key={k}
                        onClick={() => {
                          setTeachEver(true);
                          setTeachView(k);
                          setTeachMode(true);
                          setTeachMenu(false);
                        }}
                        style={{ display: "block", width: "100%", textAlign: "left", padding: "10px 14px", border: "none", background: teachMode && teachView === k ? "#eef2ff" : "#fff", fontSize: 14, cursor: "pointer", fontWeight: teachMode && teachView === k ? 600 : 400 }}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </>
              )}
            </div>
)}
          </div>

          {/* Bộ lọc: thời gian (từ ngày → đến ngày) + tình trạng đơn */}
          <div style={{ padding: "12px 16px", borderBottom: "1px solid #f0f0f0", background: "#fafafa" }}>
            <div style={filterLabelStyle}>Thời gian</div>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 8 }}>
              {[["all", "Tất cả"], ["today", "Hôm nay"], ["yesterday", "Hôm qua"], ["7d", "7 ngày"], ["30d", "30 ngày"]].map(([k, label]) => (
                <button key={k} onClick={() => changeTimePreset(k)} style={filterChipStyle(timePreset === k)}>
                  {label}
                </button>
              ))}
            </div>
            <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 12 }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 11, color: "#6b7280", marginBottom: 3 }}>Từ ngày</div>
                <input
                  type="date"
                  value={dateFrom}
                  max={dateTo || vnDay(0)}
                  onChange={(e) => {
                    setTimePreset("custom");
                    applyRange(e.target.value, dateTo);
                  }}
                  style={{ ...filterFieldStyle, borderColor: dateFrom ? "#4f46e5" : "#d1d5db" }}
                />
              </div>
              <span style={{ color: "#9ca3af", marginTop: 18 }}>→</span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 11, color: "#6b7280", marginBottom: 3 }}>Đến ngày</div>
                <input
                  type="date"
                  value={dateTo}
                  min={dateFrom || undefined}
                  max={vnDay(0)}
                  onChange={(e) => {
                    setTimePreset("custom");
                    applyRange(dateFrom, e.target.value);
                  }}
                  style={{ ...filterFieldStyle, borderColor: dateTo ? "#4f46e5" : "#d1d5db" }}
                />
              </div>
            </div>
            <div style={filterLabelStyle}>Tình trạng đơn</div>
            <select
              value={orderFilter}
              onChange={(e) => setOrderFilter(e.target.value)}
              style={{ ...filterFieldStyle, borderColor: orderFilter !== "all" ? "#4f46e5" : "#d1d5db" }}
              aria-label="Lọc theo tình trạng đơn"
            >
              <option value="all">Tất cả</option>
              <option value="none">Chưa có đơn</option>
              <option value="draft">Mới tạo (chưa gửi)</option>
              <option value="shipped">Đã gửi hàng</option>
              <option value="delivered">Đã giao</option>
              <option value="returned">Hoàn / Hủy</option>
            </select>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 10, fontSize: 12.5, color: "#6b7280" }}>
              <span>
                <strong style={{ color: "#111827" }}>{shownConversations.length}</strong> cuộc chat
              </span>
              {filtering && (
                <button
                  onClick={() => {
                    changeTimePreset("all");
                    setOrderFilter("all");
                  }}
                  style={{ border: "none", background: "transparent", color: "#4f46e5", cursor: "pointer", fontSize: 12.5, fontWeight: 600, padding: 0 }}
                >
                  Xóa bộ lọc
                </button>
              )}
            </div>

            {/* Dọn chat không có SĐT quá 48 giờ */}
            {isOwner && (
<div style={{ marginTop: 10, paddingTop: 10, borderTop: "1px solid #e5e7eb" }}>
              {["idle", "done", "error"].includes(cleanup.phase) && ["idle", "done", "error"].includes(bc.phase) ? (
                <>
                  <div style={{ display: "flex", gap: 8 }}>
                    <button
                      onClick={startCleanup}
                      style={{ flex: 1, minHeight: 34, borderRadius: 8, border: "1px solid #fca5a5", background: "#fff", color: "#b91c1c", fontSize: 12.5, fontWeight: 600, cursor: "pointer", padding: "4px 6px" }}
                    >
                      Dọn chat không có SĐT quá 48 giờ
                    </button>
                    <button
                      onClick={startBroadcast}
                      style={{ flex: 1, minHeight: 34, borderRadius: 8, border: "1px solid #a5b4fc", background: "#fff", color: "#4338ca", fontSize: 12.5, fontWeight: 600, cursor: "pointer", padding: "4px 6px" }}
                    >
                      Nhắn khách im quá 3 giờ
                    </button>
                  </div>
                  {cleanup.msg && (
                    <div style={{ marginTop: 6, fontSize: 12.5, color: cleanup.phase === "error" ? "#b91c1c" : "#166534" }}>{cleanup.msg}</div>
                  )}
                  {bc.msg && (
                    <div style={{ marginTop: 6, fontSize: 12.5, color: bc.phase === "error" ? "#b91c1c" : "#166534" }}>{bc.msg}</div>
                  )}
                </>
              ) : bc.phase === "loading" ? (
                <div style={{ fontSize: 13, color: "#6b7280" }}>Đang kiểm tra...</div>
              ) : bc.phase === "edit" || bc.phase === "sending" ? (
                <div style={{ background: "#eef2ff", border: "1px solid #c7d2fe", borderRadius: 10, padding: 12 }}>
                  <div style={{ fontSize: 13, color: "#312e81", lineHeight: 1.5 }}>
                    Có <strong>{bc.count}</strong> khách{pageFilter !== "all" ? " của Fanpage đang chọn" : " (tất cả Fanpage)"} chưa để lại số điện thoại, cả shop lẫn khách đều không nhắn hơn 3 giờ và còn trong 24 giờ Facebook cho phép nhắn. Nhập câu muốn gửi:
                  </div>
                  <textarea
                    value={bc.text}
                    onChange={(e) => setBc((b) => ({ ...b, text: e.target.value }))}
                    disabled={bc.phase === "sending"}
                    rows={4}
                    maxLength={2000}
                    placeholder="Ví dụ: Dạ mình còn quan tâm sản phẩm bên shop không ạ? Cần shop tư vấn thêm mình cứ nhắn nhé."
                    style={{ width: "100%", boxSizing: "border-box", marginTop: 8, padding: 8, fontSize: 13, border: "1px solid #c7d2fe", borderRadius: 8, resize: "vertical", fontFamily: "inherit" }}
                  />
                  {bc.phase === "sending" && (
                    <div style={{ marginTop: 6, fontSize: 12.5, color: "#312e81" }}>
                      Đang gửi... đã gửi {bc.sent}{bc.failed ? `, lỗi ${bc.failed}` : ""}. Đừng đóng trang nhé.
                    </div>
                  )}
                  <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
                    <button
                      onClick={() => setBc({ phase: "idle", count: 0, text: bc.text, msg: "", sent: 0, failed: 0 })}
                      disabled={bc.phase === "sending"}
                      style={{ flex: 1, height: 34, borderRadius: 8, border: "1px solid #d1d5db", background: "#fff", color: "#374151", fontSize: 13, cursor: "pointer" }}
                    >
                      Hủy
                    </button>
                    <button
                      onClick={confirmBroadcast}
                      disabled={bc.phase === "sending" || !bc.text.trim() || !bc.count}
                      style={{ flex: 2, height: 34, borderRadius: 8, border: "none", background: "#4f46e5", color: "#fff", fontSize: 13, fontWeight: 600, cursor: "pointer", opacity: bc.phase === "sending" || !bc.text.trim() || !bc.count ? 0.5 : 1 }}
                    >
                      {bc.phase === "sending" ? "Đang gửi..." : `Gửi cho ${bc.count} khách`}
                    </button>
                  </div>
                </div>
              ) : cleanup.phase === "loading" ? (
                <div style={{ fontSize: 13, color: "#6b7280" }}>Đang kiểm tra...</div>
              ) : (
                <div style={{ background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 10, padding: 12 }}>
                  <div style={{ fontSize: 13, color: "#7f1d1d", lineHeight: 1.5 }}>
                    Sẽ xóa <strong>{cleanup.count}</strong> cuộc chat{pageFilter !== "all" ? " của Fanpage đang chọn" : " (tất cả Fanpage)"}: khách chưa để lại số điện thoại, chưa có đơn hàng và đã hơn 48 giờ không nhắn. <strong>Không thể khôi phục.</strong>
                  </div>
                  <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
                    <button
                      onClick={() => setCleanup({ phase: "idle", count: 0, msg: "" })}
                      disabled={cleanup.phase === "deleting"}
                      style={{ flex: 1, height: 34, borderRadius: 8, border: "1px solid #d1d5db", background: "#fff", color: "#374151", fontSize: 13, cursor: "pointer" }}
                    >
                      Hủy
                    </button>
                    <button
                      onClick={confirmCleanup}
                      disabled={cleanup.phase === "deleting"}
                      style={{ flex: 2, height: 34, borderRadius: 8, border: "none", background: "#dc2626", color: "#fff", fontSize: 13, fontWeight: 600, cursor: "pointer", opacity: cleanup.phase === "deleting" ? 0.6 : 1 }}
                    >
                      {cleanup.phase === "deleting" ? "Đang xóa..." : `Xóa ${cleanup.count} cuộc chat`}
                    </button>
                  </div>
                </div>
              )}
            </div>
)}
          </div>
          <div style={{ flex: 1, overflowY: "auto" }}>
          {shownConversations.length === 0 && (
            <p style={{ padding: 16, color: "#888" }}>
              {search ? "Không tìm thấy khách nào có tên này." : filtering ? "Không có cuộc chat nào khớp bộ lọc." : phoneOnly ? "Chưa có khách nào để lại số điện thoại." : "Chưa có khách nào nhắn tin."}
            </p>
          )}
          {shownConversations.map((c) => (
            <div
              key={c.id}
              onClick={() => {
                setTeachMode(false);
                setSelectedId(c.id);
              }}
              style={{
                display: "flex",
                gap: 12,
                alignItems: "center",
                padding: "12px 16px",
                cursor: "pointer",
                background: selectedId === c.id && !teachMode ? "#eef2ff" : "transparent",
                borderBottom: "1px solid #f5f5f5",
              }}
            >
              <div style={{ position: "relative", flexShrink: 0 }}>
                <Avatar src={c.avatar} name={displayName(c.name, c.id)} size={44} />
                {showPageBadge && pageMap[c.pageId] && (
                  <div
                    title={pageMap[c.pageId].name}
                    style={{ position: "absolute", right: -4, bottom: -4, border: "2px solid #fff", borderRadius: "50%", lineHeight: 0 }}
                  >
                    <Avatar src={pageMap[c.pageId].avatar} name={pageMap[c.pageId].name} size={18} />
                  </div>
                )}
              </div>
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
                {c.phone && (
                  <div style={{ fontSize: 12, color: "#166534", marginTop: 2 }}>📞 {c.phone}</div>
                )}
                {(ordersByConv[c.id] || []).length > 0 && (
                  <div style={{ fontSize: 12, color: "#166534", marginTop: 2 }}>
                    🧾 {ordersByConv[c.id].length} đơn
                    {Object.keys(ORDER_STATUS).map((k) => {
                      const n = ordersByConv[c.id].filter((o) => statusOf(o) === k).length;
                      return n ? (
                        <span key={k} style={{ marginLeft: 6, color: ORDER_STATUS[k].color }}>
                          · {n} {ORDER_STATUS[k].label.toLowerCase()}
                        </span>
                      ) : null;
                    })}
                  </div>
                )}
              </div>
              {isOwner && (
<button
                onClick={(e) => {
                  e.stopPropagation();
                  deleteChat(c.id, displayName(c.name, c.id));
                }}
                title="Xóa cuộc trò chuyện"
                aria-label="Xóa cuộc trò chuyện"
                style={{ border: "none", background: "transparent", cursor: "pointer", fontSize: 15, opacity: 0.45 }}
              >
                🗑
              </button>
)}
            </div>
          ))}
          </div>
        </aside>

        {/* Chế độ Dạy bot (giữ nguyên đoạn đang soạn khi bấm sang chat khác) */}
        {teachEver && (
          <div style={{ display: teachMode ? "contents" : "none" }}>
            <TeachChat view={teachView} onViewChange={setTeachView} onExit={() => setTeachMode(false)} />
          </div>
        )}
        {/* Khung chat */}
        {!teachMode && (
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
                <div style={{ minWidth: 0, flex: 1 }}>
                  <strong>{headName}</strong>
                  {chatPage && pages.length > 1 && (
                    <div style={{ fontSize: 11, color: "#888" }}>Nhắn tới Page: {chatPage.name}</div>
                  )}
                  {!current.name && current.profileError && (
                    <div style={{ fontSize: 11, color: "#b45309" }}>
                      Chưa lấy được tên từ Facebook: {current.profileError}
                    </div>
                  )}
                </div>
                {isOwner && (
<button
                  onClick={() => deleteChat(selectedId, headName)}
                  style={{
                    padding: "7px 14px",
                    borderRadius: 8,
                    border: "1px solid #f3c0c0",
                    background: "#fff5f5",
                    color: "#c0392b",
                    cursor: "pointer",
                    whiteSpace: "nowrap",
                  }}
                >
                  Xóa chat
                </button>
)}
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
                        {m.images?.length > 0 && (
                          <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: m.text ? 6 : 0 }}>
                            {m.images.map((u) => (
                              <a key={u} href={u} target="_blank" rel="noreferrer">
                                <img
                                  src={u}
                                  alt="Ảnh trong cuộc trò chuyện"
                                  referrerPolicy="no-referrer"
                                  style={{ maxWidth: 220, maxHeight: 260, borderRadius: 10, display: "block", objectFit: "cover" }}
                                />
                              </a>
                            ))}
                          </div>
                        )}
                        {m.text && <div style={{ fontSize: 15 }}>{m.text}</div>}
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
        )}
        {!teachMode && selectedId && (
          <OrderPanel
            key={selectedId}
            conversationId={selectedId}
            pageId={current.pageId || selected?.pageId}
            onChanged={loadOrders}
          />
        )}
      </div>
      {showKeys && isOwner && <ApiKeysModal onClose={() => setShowKeys(false)} />}
      {showMembers && isOwner && <MembersModal pages={pages} onClose={() => setShowMembers(false)} />}
      {showSettings && (
        <SettingsModal pages={pages} onClose={() => setShowSettings(false)} onChanged={handlePagesChanged} />
      )}
    </main>
  );
}
