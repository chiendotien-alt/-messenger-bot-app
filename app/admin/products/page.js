"use client";
import { useEffect, useRef, useState } from "react";
import { ChatIcon, navButtonStyle } from "../icons";

const EMPTY_FORM = {
  name: "",
  stock: "Còn hàng",
  description: "",
  notes: "",
  openingScript: "",
  triggerQuestions: "",
  sampleImages: [],
  realImages: [],
  imageLabels: {},
};

// Nén ảnh về tối đa 1600px, JPEG — nhẹ để upload nhanh và Messenger tải nhanh
async function compressImage(file, maxSize = 1600, quality = 0.85) {
  if (!file.type.startsWith("image/") || file.type === "image/gif") return file;
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, maxSize / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext("2d").drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  const blob = await new Promise((r) => canvas.toBlob(r, "image/jpeg", quality));
  const name = file.name.replace(/\.[^.]+$/, "") + ".jpg";
  return new File([blob], name, { type: "image/jpeg" });
}

async function uploadImage(file) {
  const small = await compressImage(file);
  const fd = new FormData();
  fd.append("file", small);
  const res = await fetch("/api/upload", { method: "POST", body: fd });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Upload thất bại");
  return data.url;
}

function ImagePicker({ title, hint, urls, labels, onLabel, onChange }) {
  const inputRef = useRef(null);
  const [busy, setBusy] = useState(0);
  const [error, setError] = useState("");

  async function handleFiles(fileList) {
    const files = Array.from(fileList);
    if (!files.length) return;
    setError("");
    setBusy(files.length);
    const added = [];
    for (const f of files) {
      try {
        added.push(await uploadImage(f));
      } catch (e) {
        setError(`${f.name}: ${e.message}`);
      }
      setBusy((n) => n - 1);
    }
    if (added.length) onChange([...urls, ...added]);
    if (inputRef.current) inputRef.current.value = "";
  }

  return (
    <div style={{ border: "1px dashed #cfcfcf", borderRadius: 8, padding: 12, background: "#fff" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
        <div>
          <strong style={{ fontSize: 14 }}>{title}</strong>
          <div style={{ color: "#888", fontSize: 12 }}>{hint}</div>
        </div>
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={busy > 0}
          style={{
            padding: "7px 12px",
            border: "1px solid #ccc",
            borderRadius: 6,
            background: "#fff",
            cursor: "pointer",
            whiteSpace: "nowrap",
          }}
        >
          {busy > 0 ? `Đang tải ${busy}...` : "+ Thêm ảnh"}
        </button>
        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          multiple
          hidden
          onChange={(e) => handleFiles(e.target.files)}
        />
      </div>
      {error && <div style={{ color: "#c0392b", fontSize: 13, marginTop: 6 }}>{error}</div>}
      {urls.length > 0 && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 10, marginTop: 10 }}>
          {urls.map((u, i) => (
            <div key={u} style={{ width: 110 }}>
              <div style={{ position: "relative" }}>
                <img
                  src={u}
                  alt=""
                  style={{ width: 110, height: 110, objectFit: "cover", borderRadius: 6, border: "1px solid #eee", display: "block" }}
                />
                <button
                  type="button"
                  onClick={() => onChange(urls.filter((_, j) => j !== i))}
                  aria-label="Xóa ảnh"
                  style={{
                    position: "absolute",
                    top: -6,
                    right: -6,
                    width: 22,
                    height: 22,
                    borderRadius: "50%",
                    border: "none",
                    background: "#c0392b",
                    color: "#fff",
                    cursor: "pointer",
                    lineHeight: "22px",
                    padding: 0,
                  }}
                >
                  ×
                </button>
              </div>
              <input
                value={labels?.[u] || ""}
                onChange={(e) => onLabel(u, e.target.value)}
                placeholder="Tên ảnh (vd: Váy trắng)"
                aria-label="Tên ảnh"
                style={{ width: "100%", boxSizing: "border-box", marginTop: 4, padding: "5px 6px", fontSize: 12, border: "1px solid #ddd", borderRadius: 5 }}
              />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function Thumbs({ label, urls, labels }) {
  if (!urls?.length) return null;
  return (
    <div style={{ marginTop: 8 }}>
      <div style={{ fontSize: 12, color: "#888", marginBottom: 4 }}>
        {label} ({urls.length})
      </div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        {urls.slice(0, 8).map((u) => (
          <div key={u} style={{ width: 64 }}>
            <img src={u} alt="" style={{ width: 64, height: 64, objectFit: "cover", borderRadius: 4, display: "block" }} />
            {labels?.[u] && (
              <div style={{ fontSize: 11, color: "#555", marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={labels[u]}>
                {labels[u]}
              </div>
            )}
          </div>
        ))}
        {urls.length > 8 && <span style={{ alignSelf: "center", color: "#888", fontSize: 12 }}>+{urls.length - 8}</span>}
      </div>
    </div>
  );
}

// Chỉ giữ tên ảnh của những ảnh còn tồn tại
function cleanForm(form) {
  const keep = new Set([...form.sampleImages, ...form.realImages]);
  const imageLabels = {};
  for (const [u, v] of Object.entries(form.imageLabels || {})) {
    if (keep.has(u) && String(v).trim()) imageLabels[u] = String(v).trim();
  }
  return { ...form, imageLabels };
}

export default function AdminPage() {
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState(EMPTY_FORM);
  const [editingId, setEditingId] = useState(null);
  const [saving, setSaving] = useState(false);
  const [botPrompt, setBotPrompt] = useState("");
  const [promptSaved, setPromptSaved] = useState("");
  const [promptStatus, setPromptStatus] = useState("");
  const [openId, setOpenId] = useState(null); // sản phẩm đang mở rộng trong danh sách
  const [copyFromId, setCopyFromId] = useState("");
  const [copyParts, setCopyParts] = useState({
    description: true,
    notes: true,
    openingScript: true,
    triggerQuestions: false,
    sampleImages: true,
    realImages: true,
  });
  const [copyNotice, setCopyNotice] = useState("");

  async function load() {
    setLoading(true);
    const res = await fetch("/api/products", { cache: "no-store" });
    setProducts(await res.json());
    setLoading(false);
  }

  useEffect(() => {
    load();
    fetch("/api/settings", { cache: "no-store" })
      .then((r) => r.json())
      .then((s) => {
        setBotPrompt(s.botPrompt || "");
        setPromptSaved(s.botPrompt || "");
      })
      .catch(() => {});
  }, []);

  async function savePrompt() {
    setPromptStatus("Đang lưu...");
    const res = await fetch("/api/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ botPrompt }),
    });
    if (res.ok) {
      setPromptSaved(botPrompt);
      setPromptStatus("Đã lưu ✓");
    } else {
      setPromptStatus("Lưu thất bại, thử lại nhé");
    }
    setTimeout(() => setPromptStatus(""), 2500);
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setSaving(true);
    await fetch("/api/products", {
      method: editingId ? "PUT" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(editingId ? { id: editingId, ...cleanForm(form) } : cleanForm(form)),
    });
    setForm(EMPTY_FORM);
    setEditingId(null);
    setSaving(false);
    load();
  }

  function setLabel(url, value) {
    setForm((f) => ({ ...f, imageLabels: { ...f.imageLabels, [url]: value } }));
  }

  function handleEdit(p) {
    setForm({
      name: p.name || "",
      stock: p.stock || "Còn hàng",
      description: p.description || "",
      notes: p.notes || "",
      openingScript: p.openingScript || "",
      triggerQuestions: p.triggerQuestions || "",
      sampleImages: p.sampleImages || [],
      realImages: p.realImages || [],
      imageLabels: p.imageLabels || {},
    });
    setEditingId(p.id);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  // Lấy dữ liệu từ 1 sản phẩm có sẵn đổ vào form (chữ thì thay thế, ảnh thì cộng thêm)
  function applyCopy(src, parts) {
    setForm((f) => {
      const next = { ...f, imageLabels: { ...f.imageLabels } };
      for (const key of ["description", "notes", "openingScript", "triggerQuestions"]) {
        if (parts[key]) next[key] = src[key] || "";
      }
      for (const key of ["sampleImages", "realImages"]) {
        if (parts[key]) {
          const add = (src[key] || []).filter((u) => !next[key].includes(u));
          next[key] = [...next[key], ...add];
          for (const u of add) if (src.imageLabels?.[u]) next.imageLabels[u] = src.imageLabels[u];
        }
      }
      return next;
    });
  }

  function handleCopyFrom() {
    const src = products.find((x) => x.id === copyFromId);
    if (!src) return;
    applyCopy(src, copyParts);
    setCopyNotice(`Đã lấy dữ liệu từ “${src.name}” vào form. Kiểm tra lại rồi bấm nút lưu ở cuối form.`);
    setTimeout(() => setCopyNotice(""), 6000);
  }

  // Nhân bản: mở form "Thêm sản phẩm mới" đã điền sẵn dữ liệu của sản phẩm này
  function handleDuplicate(p) {
    setForm({
      name: (p.name || "") + " (bản sao)",
      stock: p.stock || "Còn hàng",
      description: p.description || "",
      notes: p.notes || "",
      openingScript: p.openingScript || "",
      triggerQuestions: "", // để trống: nếu trùng câu hỏi quảng cáo, bot sẽ nhầm sang sản phẩm cũ
      sampleImages: p.sampleImages || [],
      realImages: p.realImages || [],
      imageLabels: p.imageLabels || {},
    });
    setEditingId(null);
    setCopyNotice(`Đã tạo dữ liệu từ “${p.name}”. Sửa tên và nội dung cho Page mới rồi bấm “Thêm sản phẩm”.`);
    setTimeout(() => setCopyNotice(""), 8000);
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

  const inputStyle = { padding: "10px 12px", border: "1px solid #ddd", borderRadius: 6, fontSize: 15 };
  const btn = { padding: "6px 12px", border: "1px solid #ccc", borderRadius: 6, background: "#fff", cursor: "pointer" };

  return (
    <main style={{ fontFamily: "sans-serif", padding: 24, maxWidth: 760, margin: "0 auto" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
        <h1 style={{ margin: 0 }}>Quản lý sản phẩm</h1>
        <a href="/admin" title="Hộp thoại khách hàng" aria-label="Hộp thoại khách hàng" style={navButtonStyle}>
          <ChatIcon />
        </a>
      </div>
      <p style={{ color: "#666", marginTop: 8 }}>
        Bot dùng đúng danh sách này (nội dung và ảnh) để tư vấn khách trên Messenger.
      </p>

      <details
        style={{ border: "1px solid #e2e2e2", borderRadius: 10, padding: "12px 16px", marginBottom: 20, background: "#fafafa" }}
      >
        <summary style={{ cursor: "pointer", fontWeight: 600 }}>Thông tin & quy tắc của shop cho bot</summary>
        <p style={{ color: "#666", fontSize: 13 }}>
          Ghi những gì bot cần biết để tư vấn giống người thật: phí ship, thời gian giao, bảo hành, đổi trả, khuyến mãi,
          SĐT/Zalo, giờ làm việc, cách xưng hô riêng...
        </p>
        <textarea
          style={{ ...inputStyle, width: "100%", boxSizing: "border-box", resize: "vertical" }}
          rows={6}
          value={botPrompt}
          onChange={(e) => setBotPrompt(e.target.value)}
          placeholder={"Ví dụ:\n- Freeship đơn từ 500.000đ, dưới đó phí ship 30.000đ\n- Giao 2-3 ngày, được kiểm tra hàng trước khi thanh toán\n- Bảo hành 12 tháng, đổi mới trong 7 ngày nếu lỗi"}
        />
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 8 }}>
          <button
            type="button"
            onClick={savePrompt}
            disabled={botPrompt === promptSaved}
            style={{ ...btn, background: "#111", color: "#fff", border: "none", opacity: botPrompt === promptSaved ? 0.5 : 1 }}
          >
            Lưu
          </button>
          <span style={{ color: "#2d7a3a", fontSize: 13 }}>{promptStatus}</span>
        </div>
      </details>

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
        {copyNotice && (
          <div style={{ padding: "8px 12px", background: "#ecfdf3", border: "1px solid #b7ebc6", color: "#15803d", borderRadius: 8, fontSize: 13 }}>
            {copyNotice}
          </div>
        )}
        {products.length > 0 && (
          <div style={{ border: "1px dashed #b9c2ff", background: "#f5f7ff", borderRadius: 8, padding: 12 }}>
            <strong style={{ fontSize: 14 }}>📋 Tạo dữ liệu từ sản phẩm có sẵn</strong>
            <div style={{ color: "#777", fontSize: 12, margin: "2px 0 8px" }}>
              Chọn sản phẩm, tick phần muốn lấy, rồi bấm “Lấy dữ liệu”. Không phải gõ lại hay tải ảnh lại.
            </div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <select
                value={copyFromId}
                onChange={(e) => setCopyFromId(e.target.value)}
                style={{ ...inputStyle, flex: 1, minWidth: 180, padding: "8px 10px", fontSize: 14 }}
              >
                <option value="">— Chọn sản phẩm để lấy dữ liệu —</option>
                {products
                  .filter((x) => x.id !== editingId)
                  .map((x) => (
                    <option key={x.id} value={x.id}>
                      {x.name}
                    </option>
                  ))}
              </select>
              <button
                type="button"
                onClick={handleCopyFrom}
                disabled={!copyFromId}
                style={{ ...btn, background: copyFromId ? "#4f46e5" : "#c7c7c7", color: "#fff", border: "none", padding: "8px 16px" }}
              >
                Lấy dữ liệu
              </button>
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: "6px 16px", marginTop: 8, fontSize: 13 }}>
              {[
                ["description", "Nội dung"],
                ["notes", "Lưu ý cho bot"],
                ["openingScript", "Câu mở đầu"],
                ["triggerQuestions", "Câu hỏi có sẵn"],
                ["sampleImages", "Ảnh mẫu"],
                ["realImages", "Ảnh thực tế"],
              ].map(([key, label]) => (
                <label key={key} style={{ display: "flex", alignItems: "center", gap: 4, cursor: "pointer" }}>
                  <input
                    type="checkbox"
                    checked={copyParts[key]}
                    onChange={(e) => setCopyParts((c) => ({ ...c, [key]: e.target.checked }))}
                  />
                  {label}
                </label>
              ))}
            </div>
            {copyParts.triggerQuestions && (
              <div style={{ color: "#b45309", fontSize: 12, marginTop: 6 }}>
                Nhớ sửa “Câu hỏi có sẵn” cho khác sản phẩm cũ. Nếu trùng, bot sẽ nhầm sang sản phẩm cũ.
              </div>
            )}
          </div>
        )}
        <input
          style={inputStyle}
          placeholder="Tên sản phẩm (vd: Chân váy 3 tầng)"
          value={form.name}
          onChange={(e) => setForm({ ...form, name: e.target.value })}
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
          placeholder="Nội dung sản phẩm: giá bán (theo số lượng nếu có), chất liệu, màu sắc, size, ưu đãi, giao hàng, câu hỏi khách hay hỏi..."
          value={form.description}
          onChange={(e) => setForm({ ...form, description: e.target.value })}
          rows={7}
        />
        {/\|/.test(form.description) && (
          <button
            type="button"
            onClick={() =>
              setForm((f) => ({ ...f, description: f.description.replace(/[ \t]*(\|[ \t]*)+$/gm, "") }))
            }
            style={{ ...btn, alignSelf: "flex-start", fontSize: 13 }}
          >
            Dọn ký tự "|" thừa ở cuối dòng
          </button>
        )}
        <div>
          <label style={{ display: "block", fontWeight: 600, fontSize: 14, marginBottom: 2 }}>
            Lưu ý cho bot (không bắt buộc)
          </label>
          <div style={{ color: "#888", fontSize: 12, marginBottom: 6 }}>
            Dặn riêng bot về sản phẩm này: đối tượng khách, cách xưng hô, điều nên/không nên nói... Bot sẽ tuân theo khi
            tư vấn sản phẩm này.
          </div>
          <textarea
            style={{ ...inputStyle, width: "100%", boxSizing: "border-box", resize: "vertical" }}
            rows={3}
            value={form.notes}
            onChange={(e) => setForm({ ...form, notes: e.target.value })}
            placeholder={"Ví dụ:\nKhách của sản phẩm này toàn là nữ, gọi khách là chị.\nKhông tự giảm giá, chỉ báo giá theo bảng."}
          />
        </div>
        <div>
          <label style={{ display: "block", fontWeight: 600, fontSize: 14, marginBottom: 2 }}>
            Câu thoại mở đầu (chạy quảng cáo)
          </label>
          <div style={{ color: "#888", fontSize: 12, marginBottom: 6 }}>
            Khi khách nhắn lần đầu kiểu "Giá sản phẩm bao nhiêu?", bot gửi đúng câu này kèm ảnh mẫu của sản phẩm
            (ảnh thực tế chỉ gửi khi khách hỏi). Để trống nếu không dùng.
          </div>
          <textarea
            style={{ ...inputStyle, width: "100%", boxSizing: "border-box", resize: "vertical" }}
            rows={5}
            value={form.openingScript}
            onChange={(e) => setForm({ ...form, openingScript: e.target.value })}
            placeholder={"Ví dụ:\nDạ chào anh/chị, chân váy 3 tầng bên shop giá 199.000đ/chiếc, mua 2 chiếc chỉ 380.000đ, freeship toàn quốc ạ.\nAnh/chị xem ảnh mẫu bên dưới rồi cho shop biết mình thích màu nào nhé!"}
          />
        </div>
        <div>
          <label style={{ display: "block", fontWeight: 600, fontSize: 14, marginBottom: 2 }}>
            Câu hỏi có sẵn của quảng cáo (không bắt buộc)
          </label>
          <div style={{ color: "#888", fontSize: 12, marginBottom: 6 }}>
            Mỗi dòng 1 câu, gõ giống hệt câu hỏi sẵn bạn cài ở quảng cáo. Khách bấm câu nào, bot biết ngay khách đang
            hỏi sản phẩm này và gửi câu mở đầu. Nếu câu hỏi đã có sẵn tên sản phẩm ở trên thì có thể bỏ trống.
          </div>
          <textarea
            style={{ ...inputStyle, width: "100%", boxSizing: "border-box", resize: "vertical" }}
            rows={3}
            value={form.triggerQuestions}
            onChange={(e) => setForm({ ...form, triggerQuestions: e.target.value })}
            placeholder={"Ví dụ:\nGiá chân váy 3 tầng bao nhiêu?\nTư vấn giúp mình chân váy 3 tầng"}
          />
        </div>
        <ImagePicker
          title="Ảnh sản phẩm mẫu"
          hint="Ảnh giới thiệu, ảnh đẹp. Đặt tên từng ảnh (vd: Váy trắng) để bot gửi đúng mẫu khi khách hỏi"
          urls={form.sampleImages}
          labels={form.imageLabels}
          onLabel={setLabel}
          onChange={(urls) => setForm((f) => ({ ...f, sampleImages: urls }))}
        />
        <ImagePicker
          title="Ảnh sản phẩm thực tế"
          hint="Ảnh chụp hàng thật, khách hàng thật, feedback"
          urls={form.realImages}
          labels={form.imageLabels}
          onLabel={setLabel}
          onChange={(urls) => setForm((f) => ({ ...f, realImages: urls }))}
        />
        <div style={{ display: "flex", gap: 8 }}>
          <button
            type="submit"
            disabled={saving}
            style={{ padding: "10px 18px", background: "#111", color: "#fff", border: "none", borderRadius: 6, cursor: "pointer" }}
          >
            {saving ? "Đang lưu..." : editingId ? "Lưu thay đổi" : "Thêm sản phẩm"}
          </button>
          {editingId && (
            <button type="button" onClick={handleCancelEdit} style={{ ...btn, padding: "10px 18px" }}>
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
          {products.map((p) => {
            const open = openId === p.id;
            const thumb = (p.sampleImages || [])[0] || (p.realImages || [])[0];
            const nImg = (p.sampleImages || []).length + (p.realImages || []).length;
            return (
              <div key={p.id} style={{ border: "1px solid #eee", borderRadius: 10, overflow: "hidden" }}>
                <div
                  onClick={() => setOpenId(open ? null : p.id)}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && setOpenId(open ? null : p.id)}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 12,
                    padding: "10px 14px",
                    cursor: "pointer",
                    background: open ? "#fafafa" : "#fff",
                  }}
                >
                  {thumb ? (
                    <img src={thumb} alt="" style={{ width: 44, height: 44, objectFit: "cover", borderRadius: 6 }} />
                  ) : (
                    <div style={{ width: 44, height: 44, borderRadius: 6, background: "#f0f0f0" }} />
                  )}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <strong style={{ display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {p.name}
                    </strong>
                    <span style={{ color: "#888", fontSize: 13 }}>
                      {p.stock}
                      {nImg > 0 ? ` · ${nImg} ảnh` : ""}
                      {p.openingScript ? " · có câu mở đầu" : ""}
                    </span>
                  </div>
                  <span style={{ color: "#888", width: 16, textAlign: "center" }}>{open ? "▲" : "▼"}</span>
                </div>

                {open && (
                  <div style={{ padding: "4px 14px 14px", borderTop: "1px solid #eee" }}>
                    <p
                      style={{
                        margin: "10px 0",
                        color: "#444",
                        whiteSpace: "pre-wrap",
                        maxHeight: 320,
                        overflowY: "auto",
                        fontSize: 14,
                      }}
                    >
                      {p.description || "(chưa có nội dung)"}
                    </p>
                    {p.notes && (
                      <div style={{ margin: "10px 0", padding: "8px 10px", background: "#f1faf1", borderRadius: 6, fontSize: 13, whiteSpace: "pre-wrap" }}>
                        <div style={{ color: "#575", fontSize: 12, marginBottom: 2 }}>Lưu ý cho bot</div>
                        {p.notes}
                      </div>
                    )}
                    {p.openingScript && (
                      <div style={{ margin: "10px 0", padding: "8px 10px", background: "#f4f7ff", borderRadius: 6, fontSize: 13, whiteSpace: "pre-wrap" }}>
                        <div style={{ color: "#667", fontSize: 12, marginBottom: 2 }}>Câu mở đầu quảng cáo</div>
                        {p.openingScript}
                      </div>
                    )}
                    {p.triggerQuestions && (
                      <div style={{ margin: "10px 0", padding: "8px 10px", background: "#fff8ec", borderRadius: 6, fontSize: 13, whiteSpace: "pre-wrap" }}>
                        <div style={{ color: "#876", fontSize: 12, marginBottom: 2 }}>Câu hỏi có sẵn của quảng cáo</div>
                        {p.triggerQuestions}
                      </div>
                    )}
                    <Thumbs label="Ảnh mẫu" urls={p.sampleImages} labels={p.imageLabels} />
                    <Thumbs label="Ảnh thực tế" urls={p.realImages} labels={p.imageLabels} />
                    <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
                      <button onClick={() => handleEdit(p)} style={btn}>
                        Sửa
                      </button>
                      <button onClick={() => handleDuplicate(p)} style={{ ...btn, border: "1px solid #b9c2ff", background: "#f5f7ff", color: "#4338ca" }}>
                        📋 Tạo dữ liệu (nhân bản)
                      </button>
                      <button
                        onClick={() => handleDelete(p.id)}
                        style={{ ...btn, border: "1px solid #f3c0c0", background: "#fff5f5", color: "#c0392b" }}
                      >
                        Xóa
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </main>
  );
}
