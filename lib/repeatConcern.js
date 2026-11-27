// lib/repeatConcern.js — KHÁCH NHẮC LẠI CÙNG MỘT MỐI LO (phí ship / hoàn hàng, chất vải, size có vừa không, hàng có thật không).
//
// Lỗi 27/11/2026: khách hỏi đi hỏi lại về chất vải và phí ship khi hoàn hàng; bot mỗi lần giải thích bằng một cách khác
// ("hoàn hàng thoải mái", "hỗ trợ phí ship hoàn", "bên em hỗ trợ phí ship hoàn hàng"...) nên khách không yên tâm, còn bực thêm.
// Nguyên nhân: lời dặn cho AI bảo khách hỏi lại thì "trả lời lại bằng cách nói khác" và "không nhắc lại lời khách"; hệ thống
// không đếm khách nhắc lại lần thứ mấy.
//
// Cách làm: đếm số tin của khách (gần đây) nói về cùng một chủ đề. Từ lần thứ 2 trở đi, dặn AI: KHÔNG giải thích lại, đáp 1 câu ngắn,
// chắc, đúng điều khách đang đòi / đang chê, chỉ bằng thông tin THẬT trong Nội dung sản phẩm.
//   - Chủ đề khách ĐÒI một điều shop đồng ý được (phí ship, hoàn hàng): được đáp "Dạ vâng, ..." khẳng định thẳng, dùng lại chữ của khách.
//   - Chủ đề khách CHÊ / NGHI NGỜ (chất vải, hàng thật, size): KHÔNG đáp "vâng" (thành đồng ý với lời chê); bác lại bằng 1-2 đặc điểm thật.
// Dùng chung cho mọi sản phẩm: chỉ dặn cách trả lời, nội dung lấy từ Nội dung / Lưu ý của chính sản phẩm khách đang hỏi.
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

/** agree = khách ĐÒI điều shop có thể đồng ý (được đáp "Dạ vâng"); !agree = khách chê/nghi ngờ (không đáp "vâng"). */
export const CONCERN_TOPICS = [
  {
    key: "ship_hoan",
    name: "phí ship / hoàn hàng / đổi trả",
    agree: true,
    res: [
      /\b(hoan|hoan tien|doi tra|bao hanh)\b/,
      /\btra (hang|lai|ve|ze)\b/,
      /\b(mat|ton) (phi|tien|ship|them)\b/,
      /\bphi (ship|hoan|tra|van chuyen)\b/,
      /\b(ko|khong|k) tra (ship|tien|phi)\b/,
      /\btra ship\b/,
      /\bship (hoan|tra|ve)\b/,
      /\b\d+ ?k ship\b|\bship \d+ ?k\b/,
      /\bkiem tra hang\b/,
      /\b(ko|khong|k) (ung|vua)\b.*\b(ship|hoan|tra)\b|\b(ship|hoan|tra)\b.*\b(ko|khong|k) (ung|vua)\b/,
      /\bmat long\b/,
    ],
  },
  {
    key: "chat_vai",
    name: "chất vải / chất liệu / chất lượng",
    agree: false,
    res: [
      /\bvai(?! (ngay|hom|cai|chiec|phut|gio|tieng|lan|tuan|thang|nam|nguoi|ban|bo|set))\b/, // "vải"; không nhầm "vài ngày", "vài cái"
      /\b(chat lieu|chat luong)\b/,
      /^(tho|xu|nhan|mong|xau|re tien|rach|nong|bi tho|tho lam)\b/, // khách chê cụt lủn: "Thô", "Mỏng", "Xấu"
      /\b(bi|co|de) (xu|nhan|tho|rach|phai|bai)\b/,
    ],
  },
  {
    key: "size_vua",
    name: "size có vừa / hợp dáng không",
    agree: false,
    res: [
      /\b(so|lo|ngai) (ko |k |khong )?(vua|chat|rong|om)\b/,
      /\b(co )?vua (ko|k|khong)\b/,
      /\b(chat|rong|om) (ko|k|khong|y|qua)\b/,
      /\bmac (co )?vua (ko|k|khong)\b/,
      /\bhop dang\b/,
    ],
  },
  {
    key: "hang_that",
    name: "hàng có thật / giống hình / uy tín không",
    agree: false,
    res: [
      /\b(hang that|hang gia|lua dao|uy tin|co that khong|co that ko)\b/,
      /\b(giong|khac|nhu) (hinh|anh)\b/,
    ],
  },
];

const topicOf = (t) => {
  const p = plain(t);
  if (!p) return [];
  return CONCERN_TOPICS.filter((tp) => tp.res.some((re) => re.test(p))).map((tp) => tp.key);
};

/**
 * Các chủ đề khách đang NHẮC LẠI ở lượt này.
 * @param {string[]} previousTexts  tin cũ của khách (cũ → mới)
 * @param {string[]} currentTexts   các tin khách của lượt này
 * @param {number} window           chỉ xét tối đa ngần này tin khách gần nhất (kể cả lượt này)
 * @returns {{ key: string, name: string, agree: boolean, count: number }[]}  count = số tin khách nói về chủ đề (kể cả lượt này), chỉ trả khi >= 2
 */
export function repeatedConcerns(previousTexts, currentTexts, window = 16) {
  const cur = (currentTexts || []).map((t) => String(t || "")).filter((t) => t.trim());
  const prev = (previousTexts || []).map((t) => String(t || "")).filter((t) => t.trim());
  const nowKeys = new Set(cur.flatMap(topicOf));
  if (!nowKeys.size) return [];
  const recent = [...prev, ...cur].slice(-window);
  const out = [];
  for (const tp of CONCERN_TOPICS) {
    if (!nowKeys.has(tp.key)) continue;
    const count = recent.filter((t) => topicOf(t).includes(tp.key)).length;
    if (count >= 2) out.push({ key: tp.key, name: tp.name, agree: tp.agree, count });
  }
  return out;
}

/** Lời dặn AI (nối vào câu lệnh của lượt). Rỗng nếu khách không nhắc lại mối lo nào. */
export function repeatConcernNote(list) {
  if (!list?.length) return "";
  const parts = list.map((c) => {
    const base = `chủ đề "${c.name}" (khách nhắc lần thứ ${c.count})`;
    return c.agree
      ? `${base}: khách đòi một điều shop có thể đồng ý → đáp thẳng, rõ ràng đúng điều khách đòi, bắt đầu bằng "Dạ vâng," và được dùng lại chữ của khách (vd khách nói "không mất 30k ship" mà Nội dung ghi miễn phí hoàn hàng thì đáp "Dạ vâng, bên em hoàn toàn miễn phí ship, chị không mất tiền gì hết ạ"). Chỉ khẳng định "miễn phí hoàn toàn" khi Nội dung / Lưu ý của sản phẩm ghi đúng vậy; không ghi thì chỉ nói phần có ghi, tuyệt đối không hứa thêm.`
      : `${base}: khách đang chê / nghi ngờ → KHÔNG đáp "vâng" (thành đồng ý với lời chê). Bác lại bằng ĐÚNG 1-2 đặc điểm chắc nhất có trong Nội dung sản phẩm (không liệt kê lại cả đoạn mô tả), rồi nếu Nội dung có chính sách kiểm tra hàng trước khi thanh toán / hoàn hàng thì nhắc 1 vế ngắn. Không bịa ưu điểm ngoài Nội dung.`;
  });
  return (
    "\n\nKHÁCH NHẮC LẠI CÙNG MỘT MỐI LO (hệ thống đã đếm): " + parts.join(" | ") +
    ". Lần này KHÔNG giải thích lại từ đầu, KHÔNG đổi cách nói dài dòng như các lần trước: chỉ 1 tin ngắn (tối đa khoảng 25 từ), chắc, đúng điều khách đang nói. " +
    "KHÔNG hỏi thêm màu/size/SĐT/địa chỉ, KHÔNG giục chốt đơn."
  );
}
