// lib/imageContact.js — SĐT / ĐỊA CHỈ khách gửi bằng ẢNH CHỤP (vd ảnh chụp ghi chú "Số 163 Đg phạm khắc vinh ... Dt 0818686370").
//
// Lỗi 26/11/2026: khách gửi ảnh có địa chỉ + SĐT. AI (Gemini) đã đọc được ảnh và điền customer_info, nhưng hàm kiểm tra
// verifyCustomerInfo (route.js) chỉ tin thông tin có trong CHỮ khách nhắn → bỏ cả SĐT lẫn địa chỉ → hồ sơ khách không có số,
// không tự tạo đơn (chỉ chạy khi tin có chữ SĐT), chủ shop phải lên đơn bằng tay.
//
// Cách làm: khi lượt này khách có gửi ảnh VÀ shop vừa xin SĐT/địa chỉ, tin thông tin AI đọc từ ảnh nếu nó đúng DẠNG
// (SĐT di động Việt Nam 10 số; địa chỉ có số nhà / đường / phường / quận...). Không xin SĐT thì không nhận từ ảnh (tránh AI đọc nhầm
// số trên ảnh hàng, ảnh feedback...).
//
// File chỉ chứa luật thuần (không gọi mạng/CSDL) nên test riêng được.

const plain = (t) =>
  String(t || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/gi, "d")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

/** SĐT di động Việt Nam: 10 số bắt đầu 03/05/07/08/09 (nhận cả 84xxxxxxxxx, +84...). Trả về số dạng 0xxxxxxxxx hoặc "". */
export function normalizeVnMobile(s) {
  let d = String(s || "").replace(/\D/g, "");
  if (d.startsWith("84") && d.length === 11) d = "0" + d.slice(2);
  return /^0(3|5|7|8|9)\d{8}$/.test(d) ? d : "";
}

/** Trong vài tin shop gần nhất có xin SĐT / địa chỉ / thông tin nhận hàng không. history: [{ from, text }] cũ → mới. */
export function shopAskedContactRecently(history, lastN = 6) {
  const shop = (history || []).filter((m) => m && m.from !== "customer").slice(-lastN);
  return shop.some((m) => /số điện thoại|so dien thoai|sđt|sdt|địa chỉ|dia chi|nhận hàng|nhan hang|thông tin/i.test(String(m.text || "")));
}

/** Chuỗi trông như địa chỉ nhận hàng (không chỉ là tên tỉnh/thành): đủ dài và có số nhà hoặc từ chỉ đường/phường/quận... */
export function addressPlausible(v) {
  const t = plain(v);
  if (t.split(" ").filter(Boolean).length < 3) return false;
  if (/\d/.test(t)) return true; // có số nhà / số hẻm
  // không có số: cần ít nhất 2 từ chỉ đường/phường/quận... (vd "thôn Hòa Bình xã Lục Yên"); một mình "Tp Yên Bái" là nơi ở, chưa phải địa chỉ
  const hits = new Set(t.match(/\b(duong|pho|phuong|xa|quan|huyen|thon|xom|ap|ngo|hem|khu|khom|tp|thanh pho|thi tran)\b/g) || []);
  return hits.size >= 2;
}

/**
 * Thông tin AI đọc từ ảnh khách gửi → phần được nhận (SĐT, địa chỉ).
 * @param {{phone?: string, address?: string}} info  customer_info AI điền
 * @param {{from: string, text: string}[]} history   tin cũ trong cuộc chat (để biết shop có vừa xin SĐT/địa chỉ không)
 * @returns {{phone?: string, address?: string}}
 */
export function acceptImageContact(info, history) {
  const out = {};
  if (!info || typeof info !== "object") return out;
  if (!shopAskedContactRecently(history)) return out;
  const phone = normalizeVnMobile(info.phone);
  if (phone) out.phone = phone;
  const addr = typeof info.address === "string" ? info.address.trim() : "";
  if (addr && addressPlausible(addr)) out.address = addr;
  return out;
}
