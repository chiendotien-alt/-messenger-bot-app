"use client";
// Quản lý member cấp dưới: tạo tài khoản + chọn Page / sản phẩm mà member được xem (chỉ chủ shop thấy)
import { useEffect, useState, useCallback } from "react";

const inputStyle = { width: "100%", height: 36, padding: "0 10px", borderRadius: 8, border: "1px solid #d4d4d8", fontSize: 14, boxSizing: "border-box" };
const btn = (bg, color = "#fff", border = "none") => ({ height: 34, padding: "0 14px", borderRadius: 8, border, background: bg, color, fontSize: 13, fontWeight: 600, cursor: "pointer" });

function CheckList({ title, items, selected, onToggle, emptyText }) {
  return (
    <div style={{ marginTop: 10 }}>
      <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 4 }}>
        {title} <span style={{ fontWeight: 400, color: "#6b7280" }}>({selected.length} đã chọn)</span>
      </div>
      <div style={{ maxHeight: 130, overflowY: "auto", border: "1px solid #e5e7eb", borderRadius: 8, padding: "4px 10px" }}>
        {items.length === 0 && <div style={{ fontSize: 13, color: "#9ca3af", padding: "6px 0" }}>{emptyText}</div>}
        {items.map((it) => (
          <label key={it.id} style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 13.5, padding: "4px 0", cursor: "pointer" }}>
            <input type="checkbox" checked={selected.includes(String(it.id))} onChange={() => onToggle(String(it.id))} />
            <span>{it.name}</span>
          </label>
        ))}
      </div>
    </div>
  );
}

const toggleIn = (arr, id) => (arr.includes(id) ? arr.filter((x) => x !== id) : [...arr, id]);

export default function MembersModal({ pages, onClose }) {
  const [members, setMembers] = useState([]);
  const [products, setProducts] = useState([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [editingId, setEditingId] = useState(null); // null = đang thêm mới
  const [form, setForm] = useState({ username: "", name: "", password: "", pageIds: [], productIds: [] });

  const load = useCallback(async () => {
    try {
      const [m, p] = await Promise.all([fetch("/api/members", { cache: "no-store" }), fetch("/api/products", { cache: "no-store" })]);
      if (m.ok) setMembers(await m.json());
      if (p.ok) setProducts(await p.json());
    } catch {
      setError("Lỗi mạng, thử lại nhé.");
    }
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  const reset = () => {
    setEditingId(null);
    setForm({ username: "", name: "", password: "", pageIds: [], productIds: [] });
  };

  async function call(method, body) {
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/members", { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || "Không thực hiện được");
        return false;
      }
      if (data.members) setMembers(data.members);
      return true;
    } catch {
      setError("Lỗi mạng, thử lại nhé.");
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function submit(e) {
    e.preventDefault();
    if (busy) return;
    let ok;
    if (editingId == null) {
      ok = await call("POST", form);
    } else {
      const patch = { id: editingId, name: form.name, pageIds: form.pageIds, productIds: form.productIds };
      if (form.password) patch.password = form.password;
      ok = await call("PATCH", patch);
    }
    if (ok) reset();
  }

  function startEdit(m) {
    setEditingId(m.id);
    setForm({ username: m.username, name: m.name || "", password: "", pageIds: m.pageIds.map(String), productIds: m.productIds.map(String) });
  }

  const nameOf = (list, id) => list.find((x) => String(x.id) === String(id))?.name || "(đã xóa)";

  return (
    <div
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
      style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 50, padding: 16 }}
    >
      <div style={{ background: "#fff", borderRadius: 14, width: "100%", maxWidth: 600, maxHeight: "90vh", overflowY: "auto", padding: 22, boxShadow: "0 12px 40px rgba(0,0,0,0.25)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
          <strong style={{ fontSize: 18 }}>Quản lý member</strong>
          <button onClick={onClose} aria-label="Đóng" style={{ border: "none", background: "transparent", fontSize: 22, cursor: "pointer", color: "#666" }}>×</button>
        </div>
        <p style={{ margin: "0 0 12px", fontSize: 13, color: "#6b7280" }}>
          Member đăng nhập bằng tài khoản riêng, chỉ thấy chat/đơn của các Page và các sản phẩm được chọn. Không xem được cài đặt, API key, và không sửa/xóa sản phẩm.
        </p>

        {members.length === 0 && <p style={{ fontSize: 13.5, color: "#9ca3af" }}>Chưa có member nào.</p>}
        {members.map((m) => (
          <div key={m.id} style={{ border: "1px solid #e5e7eb", borderRadius: 10, padding: "10px 12px", marginBottom: 8, opacity: m.active ? 1 : 0.55 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <strong>{m.name || m.username}</strong> <span style={{ color: "#6b7280", fontSize: 13 }}>@{m.username}</span>
                {!m.active && <span style={{ marginLeft: 6, fontSize: 11, color: "#fff", background: "#9ca3af", borderRadius: 8, padding: "2px 7px" }}>ĐÃ KHÓA</span>}
              </div>
              <button disabled={busy} onClick={() => startEdit(m)} style={btn("#fff", "#374151", "1px solid #d4d4d8")}>Sửa</button>
              <button disabled={busy} onClick={() => call("PATCH", { id: m.id, active: !m.active })} style={btn("#fff", "#374151", "1px solid #d4d4d8")}>
                {m.active ? "Khóa" : "Mở khóa"}
              </button>
              <button
                disabled={busy}
                onClick={() => confirm(`Xóa member “${m.name || m.username}”?`) && call("DELETE", { id: m.id })}
                style={btn("#fff5f5", "#c0392b", "1px solid #f3c0c0")}
              >
                Xóa
              </button>
            </div>
            <div style={{ fontSize: 12.5, color: "#4b5563", marginTop: 6 }}>
              <div>Page: {m.pageIds.length ? m.pageIds.map((id) => nameOf(pages, id)).join(", ") : <em style={{ color: "#b45309" }}>chưa cấp Page nào</em>}</div>
              <div>Sản phẩm: {m.productIds.length ? `${m.productIds.length} sản phẩm` : <em style={{ color: "#b45309" }}>chưa cấp sản phẩm nào</em>}</div>
            </div>
          </div>
        ))}

        <form onSubmit={submit} style={{ marginTop: 14, paddingTop: 14, borderTop: "1px solid #eee" }}>
          <strong style={{ fontSize: 15 }}>{editingId == null ? "Thêm member mới" : `Sửa member @${form.username}`}</strong>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginTop: 8 }}>
            <input style={inputStyle} placeholder="Tên đăng nhập (a-z, 0-9)" value={form.username} disabled={editingId != null} onChange={(e) => setForm({ ...form, username: e.target.value })} />
            <input style={inputStyle} placeholder="Tên hiển thị" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </div>
          <input
            style={{ ...inputStyle, marginTop: 8 }}
            type="text"
            autoComplete="off"
            placeholder={editingId == null ? "Mật khẩu (tối thiểu 6 ký tự)" : "Mật khẩu mới (bỏ trống nếu không đổi)"}
            value={form.password}
            onChange={(e) => setForm({ ...form, password: e.target.value })}
          />
          <CheckList title="Page được xem" items={pages} selected={form.pageIds} onToggle={(id) => setForm({ ...form, pageIds: toggleIn(form.pageIds, id) })} emptyText="Chưa có Page nào." />
          <CheckList title="Sản phẩm được xem" items={products} selected={form.productIds} onToggle={(id) => setForm({ ...form, productIds: toggleIn(form.productIds, id) })} emptyText="Chưa có sản phẩm nào." />
          {error && <div style={{ marginTop: 10, color: "#b91c1c", fontSize: 13 }}>{error}</div>}
          <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
            <button type="submit" disabled={busy} style={btn("#1d4ed8")}>{busy ? "Đang lưu..." : editingId == null ? "Thêm member" : "Lưu thay đổi"}</button>
            {editingId != null && <button type="button" onClick={reset} style={btn("#fff", "#374151", "1px solid #d4d4d8")}>Hủy sửa</button>}
          </div>
        </form>
      </div>
    </div>
  );
}
