// app/admin/doc-don/page.js — Trang "Độ chính xác đọc đơn": bot ghi lại mỗi lần AI và hệ thống cùng đọc đơn của khách,
// ở đây chủ shop xem tỉ lệ hai bên giống nhau và các đơn cần xem lại. Chỉ chủ shop vào được (middleware chặn member).
import { readingStats, verdictText } from "@/lib/orderReading";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const pctText = (v) => (v === null || v === undefined ? "—" : `${v}%`);
const card = { background: "#fff", border: "1px solid #e5e5e5", borderRadius: 12, padding: "14px 16px", minWidth: 190, flex: "1 1 190px" };
const small = { color: "#666", fontSize: 13, lineHeight: 1.5 };
const when = (d) => {
  try {
    return new Date(d).toLocaleString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh", hour12: false });
  } catch {
    return String(d || "");
  }
};

export default async function Page({ searchParams }) {
  const days = Number(searchParams?.days) === 30 ? 30 : Number(searchParams?.days) === 1 ? 1 : 7;
  let stats = null;
  let error = "";
  try {
    stats = await readingStats(days);
  } catch (e) {
    error = String(e?.message || e);
  }
  const c = stats?.counts || {};
  return (
    <main style={{ maxWidth: 980, margin: "0 auto", padding: "20px 16px 60px", fontFamily: "system-ui, sans-serif", color: "#222" }}>
      <p style={{ margin: "0 0 8px" }}>
        <a href="/admin" style={{ color: "#2563eb", textDecoration: "none" }}>← Về trang chat</a>
      </p>
      <h1 style={{ fontSize: 22, margin: "0 0 6px" }}>Độ chính xác đọc đơn</h1>
      <p style={small}>
        Mỗi khi khách nói món muốn đặt, bot cho AI đọc và cho hệ thống đọc riêng, rồi so hai bản. Hai bên giống nhau thì rất ít khi sai. Hai bên khác nhau thì bot chọn bản có chữ khách làm bằng chứng và báo bạn qua Telegram.
        Đây là tỉ lệ hai bên đọc giống nhau, chưa phải tỉ lệ đúng tuyệt đối so với ý khách.
      </p>
      <p style={{ margin: "12px 0" }}>
        {[1, 7, 30].map((d) => (
          <a key={d} href={`/admin/doc-don?days=${d}`} style={{ marginRight: 8, padding: "6px 12px", borderRadius: 16, border: "1px solid #d4d4d4", textDecoration: "none", color: days === d ? "#fff" : "#333", background: days === d ? "#2563eb" : "#fff" }}>
            {d === 1 ? "Hôm nay" : `${d} ngày`}
          </a>
        ))}
      </p>

      {error && <p style={{ color: "#b91c1c" }}>Không đọc được số liệu: {error}</p>}

      {stats && stats.judged === 0 && (
        <p style={{ ...small, padding: 14, background: "#f8f8f8", borderRadius: 10 }}>
          Chưa có lượt nào trong {days === 1 ? "hôm nay" : `${days} ngày gần đây`}. Số liệu bắt đầu có khi có khách nói món muốn đặt sau khi bạn cập nhật bản mới.
        </p>
      )}

      {stats && stats.judged > 0 && (
        <>
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap", margin: "8px 0 18px" }}>
            <div style={card}>
              <div style={small}>Hai bên đọc GIỐNG nhau</div>
              <div style={{ fontSize: 30, fontWeight: 700, color: "#15803d" }}>{pctText(stats.agreeRate)}</div>
              <div style={small}>{c.agree} / {stats.judged} lượt</div>
            </div>
            <div style={card}>
              <div style={small}>Dùng được (giống nhau + AI bổ sung)</div>
              <div style={{ fontSize: 30, fontWeight: 700, color: "#15803d" }}>{pctText(stats.usableRate)}</div>
              <div style={small}>{(c.agree || 0) + (c.ai_filled || 0)} / {stats.judged} lượt</div>
            </div>
            <div style={card}>
              <div style={small}>KHÁC nhau, cần bạn xem</div>
              <div style={{ fontSize: 30, fontWeight: 700, color: (stats.needCheckRate || 0) > 5 ? "#b91c1c" : "#444" }}>{pctText(stats.needCheckRate)}</div>
              <div style={small}>{c.conflict} lượt (đã báo Telegram)</div>
            </div>
            <div style={card}>
              <div style={small}>AI ghi sai, đã bỏ</div>
              <div style={{ fontSize: 30, fontWeight: 700, color: "#444" }}>{pctText(stats.invalidRate)}</div>
              <div style={small}>{c.ai_invalid} lượt</div>
            </div>
          </div>
          <p style={small}>
            Trong {stats.days === 1 ? "hôm nay" : `${stats.days} ngày`}: {stats.judged} lượt có cả AI và hệ thống đọc{c.ai_none ? `, ${c.ai_none} lượt AI không ghi món nào (không tính vào tỉ lệ)` : ""}.
          </p>
        </>
      )}

      {stats && stats.recent.length > 0 && (
        <>
          <h2 style={{ fontSize: 17, margin: "22px 0 8px" }}>Các lượt cần xem ({stats.recent.length} gần nhất)</h2>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {stats.recent.map((r) => (
              <div key={r.id} style={{ border: "1px solid #e5e5e5", borderRadius: 10, padding: "10px 12px", background: r.verdict === "conflict" ? "#fff7ed" : "#fff" }}>
                <div style={{ fontWeight: 600 }}>
                  {r.name || "Khách"} <span style={{ fontWeight: 400, color: "#777", fontSize: 13 }}>· {when(r.createdAt)}</span>
                </div>
                <div style={{ fontSize: 13, color: r.verdict === "conflict" ? "#c2410c" : "#555", margin: "2px 0 6px" }}>{verdictText(r.verdict)}</div>
                {r.customerText && <div style={{ fontSize: 14 }}>Khách nhắn: “{r.customerText}”</div>}
                <div style={{ fontSize: 14, marginTop: 4, lineHeight: 1.6 }}>
                  <div>Hệ thống đọc: <b>{r.systemReading || "(chưa rõ)"}</b></div>
                  <div>AI đọc: <b>{r.aiReading || "(không có)"}</b></div>
                  {r.finalReading && <div>Bot đã dùng bản AI: <b>{r.finalReading}</b></div>}
                  {r.notes && <div style={{ color: "#777", fontSize: 13 }}>Lý do: {r.notes}</div>}
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </main>
  );
}
