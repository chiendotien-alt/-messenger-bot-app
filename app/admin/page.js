"use client";
import { useEffect, useState } from "react";

const EMPTY_FORM = { name: "", price: "", stock: "Còn hàng", description: "" };

export default function AdminPage() {
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState(EMPTY_FORM);
  const [editingId, setEditingId] = useState(null);
  const [saving, setSaving] = useState(false);

  async function load() {
    setLoading(true);
    const res = await fetch("/api/products");
    setProducts(await res.json());
    setLoading(false);
  }

  useEffect(() => {
    load();
  }, []);

  async function handleSubmit(e) {
    e.preventDefault();
    setSaving(true);
    if (editingId) {
      await fetch("/api/products", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: editingId, ...form }),
      });
    } else {
      await fetch("/api/products", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
    }
    setForm(EMPTY_FORM);
    setEditingId(null);
    setSaving(false);
    load();
  }

  function handleEdit(p) {
    setForm({
      name: p.name || "",
      price: p.price || "",
      stock: p.stock || "Còn hàng",
      description: p.description || "",
    });
    setEditingId(p.id);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function handleDelete(id) {
    if (!confirm("Xóa sản phẩm này?")) return;
    await fetch("/api/products", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    });
    load();
  }

  function handleCancelEdit() {
    setForm(EMPTY_FORM);
    setEditingId(null);
  }

  const inputStyle = {
    padding: "10px 12px",
    border: "1px solid #ddd",
    borderRadius: 6,
    fontSize: 15,
  };

  return (
    <main
      style={{
        fontFamily: "sans-serif",
        padding: 24,
        maxWidth: 720,
        margin: "0 auto",
      }}
    >
      <h1 style={{ marginBottom: 4 }}>Quản lý sản phẩm</h1>
      <p style={{ color: "#666", marginTop: 0 }}>
        Bot sẽ tự động dùng đúng danh sách này để trả lời khách trên Messenger.
      </p>

      <form
        onSubmit={handleSubmit}
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 10,
          marginBottom: 32,
          border: "1px solid #e2e2e2",
          padding: 20,
          borderRadius: 10,
          background: "#fafafa",
        }}
      >
        <strong>{editingId ? "Sửa sản phẩm" : "Thêm sản phẩm mới"}</strong>
        <input
          style={inputStyle}
          placeholder="Tên sản phẩm (vd: Nồi chiên không dầu 5L)"
          value={form.name}
          onChange={(e) => setForm({ ...form, name: e.target.value })}
          required
        />
        <input
          style={inputStyle}
          placeholder="Giá (vd: 890.000đ)"
          value={form.price}
          onChange={(e) => setForm({ ...form, price: e.target.value })}
          required
        />
        <input
          style={inputStyle}
          placeholder="Tình trạng (vd: Còn hàng / Hết hàng)"
          value={form.stock}
          onChange={(e) => setForm({ ...form, stock: e.target.value })}
        />
        <textarea
          style={{ ...inputStyle, resize: "vertical" }}
          placeholder="Mô tả sản phẩm (tính năng, ưu đãi, cách dùng...)"
          value={form.description}
          onChange={(e) => setForm({ ...form, description: e.target.value })}
          rows={3}
        />
        <div style={{ display: "flex", gap: 8 }}>
          <button
            type="submit"
            disabled={saving}
            style={{
              padding: "10px 18px",
              background: "#111",
              color: "#fff",
              border: "none",
              borderRadius: 6,
              cursor: "pointer",
            }}
          >
            {saving ? "Đang lưu..." : editingId ? "Lưu thay đổi" : "Thêm sản phẩm"}
          </button>
          {editingId && (
            <button
              type="button"
              onClick={handleCancelEdit}
              style={{
                padding: "10px 18px",
                background: "#fff",
                border: "1px solid #ccc",
                borderRadius: 6,
                cursor: "pointer",
              }}
            >
              Hủy
            </button>
          )}
        </div>
      </form>

      {loading ? (
        <p>Đang tải...</p>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {products.length === 0 && <p>Chưa có sản phẩm nào — thêm sản phẩm đầu tiên ở form trên.</p>}
          {products.map((p) => (
            <div
              key={p.id}
              style={{
                border: "1px solid #eee",
                borderRadius: 10,
                padding: 14,
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <strong>{p.name}</strong>
                <span>{p.price}</span>
              </div>
              <div style={{ color: "#888", fontSize: 13, margin: "4px 0" }}>{p.stock}</div>
              <p style={{ margin: "6px 0", color: "#444" }}>{p.description}</p>
              <div style={{ display: "flex", gap: 8 }}>
                <button
                  onClick={() => handleEdit(p)}
                  style={{
                    padding: "6px 12px",
                    border: "1px solid #ccc",
                    borderRadius: 6,
                    background: "#fff",
                    cursor: "pointer",
                  }}
                >
                  Sửa
                </button>
                <button
                  onClick={() => handleDelete(p.id)}
                  style={{
                    padding: "6px 12px",
                    border: "1px solid #f3c0c0",
                    borderRadius: 6,
                    background: "#fff5f5",
                    color: "#c0392b",
                    cursor: "pointer",
                  }}
                >
                  Xóa
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </main>
  );
}
