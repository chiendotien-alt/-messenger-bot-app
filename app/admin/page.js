"use client";
import { useEffect, useRef, useState, useCallback } from "react";
import { BoxIcon, KeyIcon, SettingsIcon, navButtonStyle } from "./icons";

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
              {switchBtn(p)}
            </div>
          ))}
          <button
            style={{ ...itemStyle(false), borderTop: "1px solid #eee", color: "#4f46e5" }}
            onClick={() => {
              setOpen(false);
              onManage();
            }}
          >
            ⚙ Quản lý Page
          </button>
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
const inputStyle = { width: "100%", padding: "8px 10px", borderRadius: 8, border: "1px solid #ddd", fontSize: 14, boxSizing: "border-box" };
const labelStyle = { fontSize: 12, color: "#666", margin: "10px 0 3px", display: "block" };

function OrderPanel({ conversationId, pageId, onClose }) {
  const [order, setOrder] = useState(null);
  const [products, setProducts] = useState([]);
  const [saved, setSaved] = useState([]);
  const [orderId, setOrderId] = useState(null);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState("");
  const [aiOk, setAiOk] = useState(true);

  const loadSaved = useCallback(async () => {
    try {
      const res = await fetch(`/api/orders?conversationId=${encodeURIComponent(conversationId)}`, { cache: "no-store" });
      if (res.ok) setSaved(await res.json());
    } catch {}
  }, [conversationId]);

  async function autoFill() {
    setLoading(true);
    setMsg("");
    try {
      const res = await fetch("/api/orders/draft", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ conversationId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Lỗi");
      setOrder(data.order);
      setProducts(data.products || []);
      setAiOk(data.aiOk);
      setOrderId(null);
    } catch (e) {
      setMsg("Không tự điền được: " + e.message);
      setOrder((o) => o || { customerName: "", phone: "", address: "", productId: "", productName: "", variant: "", quantity: 1, unitPrice: 0, shipFee: 0, note: "" });
    }
    setLoading(false);
  }

  useEffect(() => {
    autoFill();
    loadSaved();
  }, [conversationId]);

  if (!order) return <aside style={{ width: 360, borderLeft: "1px solid #eee", padding: 20 }}>Đang lấy thông tin đơn...</aside>;

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
    setOrderId(data.id);
    setMsg("Đã lưu đơn ✓");
    loadSaved();
  }

  async function removeSaved(id) {
    if (!confirm("Xóa đơn này?")) return;
    await fetch("/api/orders", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id }) });
    if (orderId === id) setOrderId(null);
    loadSaved();
  }

  return (
    <aside style={{ width: 360, borderLeft: "1px solid #eee", overflowY: "auto", padding: "14px 16px", background: "#fff" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <strong style={{ fontSize: 16 }}>🧾 Tạo đơn hàng</strong>
        <button onClick={onClose} style={{ border: "none", background: "transparent", fontSize: 18, cursor: "pointer" }}>✕</button>
      </div>
      {loading && <div style={{ color: "#888", fontSize: 13, marginTop: 6 }}>Đang đọc chat để điền đơn...</div>}
      {!loading && !aiOk && (
        <div style={{ color: "#b45309", fontSize: 12, marginTop: 6 }}>AI chưa điền được, bạn nhập tay các ô còn trống nhé.</div>
      )}
      {!loading && aiOk && (
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
        <option value="">— Chọn sản phẩm —</option>
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
        <button onClick={save} style={{ flex: 1, padding: "10px", borderRadius: 8, border: "none", background: "#16a34a", color: "#fff", fontWeight: 600, cursor: "pointer" }}>
          {orderId ? "Cập nhật đơn" : "Lưu đơn"}
        </button>
        <button onClick={copy} style={{ padding: "10px 12px", borderRadius: 8, border: "1px solid #ddd", background: "#fff", cursor: "pointer" }}>Sao chép</button>
        <button onClick={autoFill} title="Điền lại từ chat" style={{ padding: "10px 12px", borderRadius: 8, border: "1px solid #ddd", background: "#fff", cursor: "pointer" }}>↻</button>
      </div>
      {msg && <div style={{ fontSize: 13, marginTop: 8, color: msg.includes("✓") ? "#166534" : "#b45309" }}>{msg}</div>}

      {saved.length > 0 && (
        <div style={{ marginTop: 18 }}>
          <strong style={{ fontSize: 13 }}>Đơn đã lưu của khách này</strong>
          {saved.map((o) => (
            <div key={o.id} style={{ border: "1px solid #eee", borderRadius: 8, padding: 8, marginTop: 6, fontSize: 13 }}>
              <div>{o.productName}{o.variant ? ` - ${o.variant}` : ""} × {o.quantity}</div>
              <div style={{ color: "#c0392b" }}>{money(o.total)}</div>
              <div style={{ marginTop: 4, display: "flex", gap: 10 }}>
                <button onClick={() => { setOrder(o); setOrderId(o.id); setMsg(""); }} style={{ border: "none", background: "none", color: "#2563eb", cursor: "pointer", padding: 0 }}>Mở sửa</button>
                <button onClick={() => removeSaved(o.id)} style={{ border: "none", background: "none", color: "#c0392b", cursor: "pointer", padding: 0 }}>Xóa</button>
              </div>
            </div>
          ))}
        </div>
      )}
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
  const [showOrder, setShowOrder] = useState(false);
  const pageFilterRef = useRef("all");
  const [phoneOnly, setPhoneOnly] = useState(false); // chỉ hiện khách đã để lại số điện thoại
  const phoneOnlyRef = useRef(false);

  const loadConversations = useCallback(async () => {
    const filter = pageFilter;
    const onlyPhone = phoneOnly;
    try {
      const params = [];
      if (filter !== "all") params.push(`pageId=${encodeURIComponent(filter)}`);
      if (onlyPhone) params.push("phone=1");
      const qs = params.length ? "?" + params.join("&") : "";
      const res = await fetch("/api/conversations" + qs, { cache: "no-store" });
      if (!res.ok) return; // lỗi tạm thời: giữ nguyên danh sách cũ
      const data = await res.json();
      // Bỏ kết quả về muộn của Page đã đổi đi (tránh nhảy lẫn danh sách)
      if (Array.isArray(data) && pageFilterRef.current === filter && phoneOnlyRef.current === onlyPhone) setConversations(data);
    } catch {}
  }, [pageFilter, phoneOnly]);

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
        <button
          onClick={() => setShowSettings(true)}
          title="Cài đặt Fanpage"
          aria-label="Cài đặt Fanpage"
          style={{ ...navButtonStyle, cursor: "pointer" }}
        >
          <SettingsIcon />
        </button>
        <button
          onClick={() => setShowKeys(true)}
          title="API key AI"
          aria-label="API key AI"
          style={{ ...navButtonStyle, cursor: "pointer" }}
        >
          <KeyIcon />
        </button>
        <a href="/admin/products" title="Quản lý sản phẩm" aria-label="Quản lý sản phẩm" style={navButtonStyle}>
          <BoxIcon />
        </a>
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
        </div>
      </header>

      <div style={{ flex: 1, display: "flex", overflow: "hidden" }}>
        {/* Danh sách hội thoại */}
        <aside style={{ width: 320, borderRight: "1px solid #eee", display: "flex", flexDirection: "column", position: "relative" }}>
          <PageSwitcher
            pages={pages}
            value={pageFilter}
            onChange={changePage}
            onManage={() => setShowSettings(true)}
            onToggleBot={togglePageBot}
            globalBotEnabled={botEnabled}
          />
          <div style={{ padding: "8px 16px", borderBottom: "1px solid #f0f0f0" }}>
            <button
              onClick={togglePhoneOnly}
              aria-pressed={phoneOnly}
              style={{
                border: phoneOnly ? "1px solid #16a34a" : "1px solid #ddd",
                background: phoneOnly ? "#e8f7ee" : "#fff",
                color: phoneOnly ? "#166534" : "#555",
                borderRadius: 999,
                padding: "5px 12px",
                fontSize: 13,
                cursor: "pointer",
              }}
            >
              📞 Chỉ khách có số điện thoại{phoneOnly ? " ✓" : ""}
            </button>
          </div>
          <div style={{ flex: 1, overflowY: "auto" }}>
          {conversations.length === 0 && (
            <p style={{ padding: 16, color: "#888" }}>
              {phoneOnly ? "Chưa có khách nào để lại số điện thoại." : "Chưa có khách nào nhắn tin."}
            </p>
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
              </div>
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
            </div>
          ))}
          </div>
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
                <button
                  onClick={() => setShowOrder(true)}
                  style={{
                    padding: "7px 14px",
                    borderRadius: 8,
                    border: "none",
                    background: "#16a34a",
                    color: "#fff",
                    fontWeight: 600,
                    cursor: "pointer",
                    whiteSpace: "nowrap",
                  }}
                >
                  🧾 Tạo đơn
                </button>
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
        {showOrder && selectedId && (
          <OrderPanel
            key={selectedId}
            conversationId={selectedId}
            pageId={current.pageId || selected?.pageId}
            onClose={() => setShowOrder(false)}
          />
        )}
      </div>
      {showKeys && <ApiKeysModal onClose={() => setShowKeys(false)} />}
      {showSettings && (
        <SettingsModal pages={pages} onClose={() => setShowSettings(false)} onChanged={handlePagesChanged} />
      )}
    </main>
  );
}
