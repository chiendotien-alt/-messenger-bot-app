// lib/orderContext.js — cho bot biết khách ĐÃ ĐẶT HÀNG lúc nào và đã bao nhiêu ngày,
// để trả lời đúng hoàn cảnh khi khách hỏi về đơn / giao hàng (không hẹn lại "3-4 ngày" từ đầu).
// Chỉ dựa vào đơn có trong hệ thống + ngày tạo đơn. KHÔNG dùng trạng thái tick tay (draft/shipped/...) vì hay quên tick.

const VN_OFFSET_MS = 7 * 60 * 60 * 1000;

/** Số ngày lịch (giờ Việt Nam) từ ngày a đến ngày b. */
function dayDiffVN(a, b) {
  const da = new Date(new Date(a).getTime() + VN_OFFSET_MS);
  const db = new Date(new Date(b).getTime() + VN_OFFSET_MS);
  const ua = Date.UTC(da.getUTCFullYear(), da.getUTCMonth(), da.getUTCDate());
  const ub = Date.UTC(db.getUTCFullYear(), db.getUTCMonth(), db.getUTCDate());
  return Math.round((ub - ua) / 86400000);
}

function fmtDateVN(d) {
  const x = new Date(new Date(d).getTime() + VN_OFFSET_MS);
  const dd = String(x.getUTCDate()).padStart(2, "0");
  const mm = String(x.getUTCMonth() + 1).padStart(2, "0");
  return `${dd}/${mm}/${x.getUTCFullYear()}`;
}

/** Đọc thời gian giao hàng chủ shop ghi trong "Thông tin shop", vd "Giao hàng 3-4 ngày" → { min: 3, max: 4 }. Không thấy thì null. */
export function parseDeliveryDays(shopInfo) {
  const lines = String(shopInfo || "").split(/\n+/);
  for (const line of lines) {
    if (!/(giao|ship|vận chuyển|van chuyen)/i.test(line)) continue;
    const range = line.match(/(\d{1,2})\s*(?:-|–|—|~|đến|tới|den|toi)\s*(\d{1,2})\s*ngày/i);
    if (range) {
      const a = Number(range[1]);
      const b = Number(range[2]);
      if (a > 0 && b >= a && b <= 30) return { min: a, max: b };
    }
    const single = line.match(/(\d{1,2})\s*ngày/i);
    if (single) {
      const n = Number(single[1]);
      if (n > 0 && n <= 30) return { min: n, max: n };
    }
  }
  return null;
}

/**
 * Soạn đoạn "ĐƠN HÀNG CỦA KHÁCH" cho lời nhắc của AI. Không có đơn → "" (bot chat như cũ).
 * orders: kết quả listOrders() (mới → cũ), mỗi đơn có createdAt + productName/variant/quantity...
 */
export function buildOrderContext(orders, shopInfo, now = new Date()) {
  const list = (Array.isArray(orders) ? orders : []).filter((o) => o?.createdAt).slice(0, 3);
  if (!list.length) return "";
  const window = parseDeliveryDays(shopInfo);

  const lines = list.map((o, i) => {
    const days = Math.max(0, dayDiffVN(o.createdAt, now));
    const what = [o.productName, o.variant].filter(Boolean).join(" ") || "sản phẩm";
    const qty = Number(o.quantity) > 1 ? ` x${Number(o.quantity)}` : "";
    const when = days === 0 ? "hôm nay" : days === 1 ? "hôm qua" : `${days} ngày trước`;
    let verdict = "";
    if (window) {
      const range = window.min === window.max ? `${window.max} ngày` : `${window.min}-${window.max} ngày`;
      if (days < window.min) {
        verdict = `Shop hẹn giao trong ${range}, hiện mới ngày thứ ${days}, chưa tới hạn giao.`;
      } else if (days <= window.max) {
        const left = window.max - days;
        verdict = `Shop hẹn giao trong ${range}, hiện đã ngày thứ ${days}: đang trong thời gian giao${left > 0 ? `, nhiều nhất khoảng ${left} ngày nữa` : ", hôm nay là hạn cuối dự kiến"}.`;
      } else {
        verdict = `Shop hẹn giao trong ${range}, hiện đã ngày thứ ${days}: ĐÃ QUÁ hạn dự kiến ${days - window.max} ngày.`;
      }
    }
    return `${i === 0 ? "Đơn gần nhất" : `Đơn trước đó`}: đặt ngày ${fmtDateVN(o.createdAt)} (${when}) — ${what}${qty}.${verdict ? " " + verdict : ""}`;
  });

  return `Hôm nay là ngày ${fmtDateVN(now)}.
${lines.join("\n")}
CÁCH DÙNG THÔNG TIN ĐƠN HÀNG (đây là dữ liệu thật của shop):
- Chỉ nhắc ngày đặt / số ngày khi khách hỏi về đơn, giao hàng, ship, "bao giờ tới", "chưa thấy ai gọi"... Khách hỏi chuyện khác thì đừng tự nhắc.
- Trả lời theo SỐ NGÀY ĐÃ TRÔI QUA: tuyệt đối không hẹn lại "3-4 ngày" tính từ đầu khi đơn đã đặt được vài ngày. Vd đã ngày thứ 3 của hạn 3-4 ngày thì nói hàng sắp tới nơi, tối đa khoảng 1 ngày nữa.
- Còn trong hạn: trấn an ngắn gọn, nói theo số ngày còn lại. Quá hạn: xin lỗi ngắn, nói shop sẽ kiểm tra với bên vận chuyển rồi báo lại. KHÔNG bịa mã vận đơn, vị trí đơn hay tên shipper.
- Shop không biết chắc đơn đã gửi / đã giao hay chưa nên đừng khẳng định "đã gửi", "đã giao"; chỉ nói theo ngày đặt. Nếu không có thời gian hẹn giao ở trên thì không tự đưa ra số ngày giao.
- Khách đã có đơn: không hỏi lại tên, SĐT, địa chỉ, màu/size đã có trong đơn, và không chào mời mua lại đúng sản phẩm đó. Khách hỏi mua thêm hoặc sản phẩm mới thì tư vấn bình thường.`;
}
