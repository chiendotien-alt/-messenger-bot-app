// lib/hesitate.js
// Khách đang CÂN NHẮC / PHÂN VÂN chuyện khác (không phải chọn màu/size): "để mình hỏi chồng đã", "để mình xem đã", "lăn tăn quá",
// "hơi mắc, để cân nhắc", "không biết chất lượng có tốt không", "sợ mặc không vừa"...
// Lúc đó bot KHÔNG được ép chốt, hối, dọa hết hàng, hay xin SĐT/địa chỉ. Chỉ đáp nhẹ nhàng, giải đáp nỗi lo (nếu có), để khách thong thả.
// (Phân vân giữa các màu/size cụ thể do lib/attributes.js lo; file này lo các kiểu còn lại.)

const plain = (t) =>
  String(t || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d")
    .replace(/[^a-z0-9?\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const PRON = "(?:minh|em|chi|anh|toi|e|c|a|mjh)";
// "để mình xem / coi / tham khảo" + ĐỐI TƯỢNG cụ thể (ảnh, hình, màu, size, giá, đơn...) = khách đang XEM / HỎI THÊM, KHÔNG phải hẹn cân nhắc.
const NOT_OBJ =
  "(?! (?:lai |them |nua )*(?:roi|thu|giup|anh|hinh|video|clip|feedback|review|mau|kich|size|bang|gia|ship|phi|thong tin|chinh sach|hang|don|tin nhan|cai nay|cai kia|chan vay|vay|ao|do|san pham|sp)(?: |$))";
// Người mà khách hay "hỏi ý kiến / bàn" trước khi mua. Cố ý KHÔNG có "con", "ma": trùng với "hỏi còn size M không", "hỏi mã giảm giá".
const PEOPLE = "chong|vo|me|ba|bo|con gai|con trai|nguoi nha|gia dinh|ban be|chi gai|em gai|chi em";
// Cụm đi sau "xem lại / tham khảo" cho thấy khách hẹn quay lại: "xem lại nha", "tham khảo thêm đã", "xem lại sau"
const LATER_TAIL = "(?:da|nha|nhe|nhen|sau|chut|ti|hen|truoc|ky)";
// Hẹn xem lại / hỏi người nhà / còn lưỡng lự → khách cần thời gian
const DEFER_RE = new RegExp(
  [
    // "để mình suy nghĩ / cân nhắc / tính / nghĩ"
    `(?:^| )de (?:${PRON} )?(?:suy nghi|can nhac|nghi|tinh)(?: |$)`,
    // "để mình bàn với chồng", "để bàn lại đã" — "để bạn tư vấn" thì KHÔNG phải
    `(?:^| )de (?:${PRON} )?ban(?= (?:voi|cung|lai|da|nha|nhe|nhen)(?: |$)|$)`,
    // "để mình xem đã", "để chị coi lại nha" — nhưng KHÔNG phải "để mình xem ảnh / xem size / xem thử"
    `(?:^| )de (?:${PRON} )?(?:xem|coi|tham khao)${NOT_OBJ}(?: |$)`,
    // "xem đã", "tính sau", "nghĩ đã"
    "(?:^| )(?:xem|coi|tinh|nghi|suy nghi|can nhac) (?:lai |them )?(?:da|sau)(?: |$)",
    // "hỏi chồng đã", "hỏi ý kiến chồng cái đã", "hỏi lại mẹ"
    `(?:^| )hoi (?:lai )?(?:y kien |y )?(?:${PEOPLE})(?: |$)`,
    "(?:^| )ban (?:lai )?(?:voi|cung) (?:chong|vo|me|ba|bo|gia dinh|nguoi nha)(?: |$)",
    // "để mình hỏi bé thích ko rồi đặt", "để mình hỏi ý kiến bé / người yêu / bạn gái" — phải có "để ... hỏi" đứng trước (tránh nhầm "cho mình hỏi bé 5 tuổi mặc size nào")
    `(?:^| )de (?:${PRON} )?hoi (?:lai )?(?:y kien )?(?:be|con be|nguoi yeu|ban gai|ban trai|ong ba|co ay|chu ay)(?: |$)`,
    // "hỏi bé thích không đã", "hỏi ý kiến bé nha"
    `(?:^| )hoi (?:y kien )?(?:be|con be|nguoi yeu|ban gai|ban trai) (?:da|truoc|xem|thich|co thich|nha|nhe|nhen)(?: |$)`,
    // "để mình hỏi (ai đó) ... rồi đặt/mua/lấy" — trừ khi hỏi về giá/size/màu/ảnh... (đó là khách đang hỏi shop, không phải hẹn)
    `(?:^| )de (?:${PRON} )?hoi${NOT_OBJ}(?: [a-z0-9]+){1,6} roi (?:${PRON} )?(?:dat|mua|lay|chot|len don)(?: |$)`,
    "(?:^| )(?:con )?(?:phan van|luong lu|lan tan|do du)(?: |$)",
    // "chưa chắc", "chưa quyết", "chưa chốt đâu nha", "chưa lên đơn"
    "(?:^| )chua (?:chac|quyet|chot|len don|dat hang|dat don|biet co (?:mua|lay))(?: |$)",
    // "cân nhắc", "suy nghĩ thêm" (đứng trơ trọi cũng là hẹn cân nhắc)
    "(?:^| )(?:can nhac|suy nghi|nghi them)(?: |$)",
    // "tham khảo thêm nha", "xem lại nha", "xem lại" (hết câu). Còn "xem lại đơn / giúp mình / hình...", "xem thêm ảnh..." thì KHÔNG tính.
    `(?:^| )(?:tham khao|xem lai|coi lai)(?: (?:them|nua))*(?:$| ${LATER_TAIL}(?: |$))`,
    `(?:^| )(?:xem|coi) (?:them|nua) ${LATER_TAIL}(?: |$)`,
    "(?:^| )(?:so sanh|xem|coi|hoi) (?:them )?(?:may )?(?:shop|cho|noi|ben) khac(?: |$)",
    // "từ từ đã", "đợi lương rồi mua", "chưa có tiền"
    "(?:^| )tu tu(?: |$)",
    "(?:^| )(?:doi (?:den )?(?:co )?(?:luong|tet|thang sau|tuan sau)|cho (?:co )?luong)(?: |$)",
    "(?:^| )chua co (?:tien|luong)(?: |$)",
    // khách tự nói thôi không mua nữa: không phải lúc để hối thêm
    `(?:^| )thoi (?:${PRON} )?(?:khong|ko|k) (?:mua|lay|dat)(?: |$)`,
    "(?:^| )(?:khong|ko|k) (?:mua|lay|dat|can) nua(?: |$)",
  ].join("|")
);
// Lo lắng / nghi ngại (chưa phải từ chối): cần được giải đáp, không phải bị hối
const DOUBT_RE = new RegExp(
  [
    "(?:^| )(?:khong|ko|k) biet (?:chat luong|co (?:tot|ben|vua|dep|that|giong|dung|chat)|hang (?:co|nhu)|shop)(?: |$)",
    "(?:^| )(?:so|lo|ngai) (?:mac |nho |rong |chat |dai |ngan )?(?:khong|ko|k) (?:vua|dep|giong|ben|dung|that|hop)(?: |$)",
    "(?:^| )(?:so|lo|ngai) (?:mac|mua) (?:khong|ko|k) (?:vua|dep|giong|ben)(?: |$)",
    "(?:^| )(?:nghi ngai|chua tin|chua yen tam|hoi lo|hoi so)(?: |$)",
    "(?:^| )hoi (?:mac|dat)(?: |$)",
    // "sợ bị lừa", "hàng có đúng như hình không"
    "(?:^| )(?:so|lo|ngai) (?:bi )?(?:lua|lua dao)(?: |$)",
    "(?:^| )hang (?:co )?(?:giong|dung|y nhu|nhu) (?:trong )?(?:hinh|anh|mo ta|quang cao)(?: |$)",
  ].join("|")
);
// Đã chốt rõ. "chốt / lên đơn / lấy luôn" đứng SAU "chưa / không / đừng" ("chưa chốt đâu nha") thì KHÔNG phải chốt.
const FIRM_RE = /(?:^| )(?:chot|lay luon|dat luon|mua luon|len don)(?: |$)/;
const NEGATED_FIRM_RE = /(?:^| )(?:chua|khong|ko|k|dung|chang|chu)(?: (?:co|duoc|nen|dinh|muon|biet|voi))* (?:chot|lay luon|dat luon|mua luon|len don)(?: |$)/g;
const PHONE_RE = /(?:\+?84|0)(?:[\s.\-]?\d){9}/;

/**
 * texts: các tin khách vừa nhắn (chưa được bot trả lời).
 * @returns { hesitating: boolean, kind: "defer"|"doubt"|null, quote: string }
 */
export function analyzeHesitation(texts) {
  let doubt = "";
  for (const raw of texts || []) {
    const orig = String(raw || "").trim();
    if (!orig) continue;
    if (PHONE_RE.test(orig.replace(/[\s.\-]/g, ""))) continue; // khách đang đưa SĐT → không phải cân nhắc
    const p = plain(orig);
    if (FIRM_RE.test(p.replace(NEGATED_FIRM_RE, " "))) continue; // đã chốt rõ ("lấy luôn", "chốt kem và trắng"); "chưa chốt đâu nha" thì không tính
    if (DEFER_RE.test(p)) return { hesitating: true, kind: "defer", quote: orig.slice(0, 80) };
    if (!doubt && DOUBT_RE.test(p)) doubt = orig.slice(0, 80);
  }
  return doubt ? { hesitating: true, kind: "doubt", quote: doubt } : { hesitating: false, kind: null, quote: "" };
}

/** Lời dặn AI khi khách đang cân nhắc / lo lắng. */
export function hesitateNote(h) {
  if (!h?.hesitating) return "";
  const common =
    'KHÔNG ép chốt, KHÔNG hối, KHÔNG dọa hết hàng/hết khuyến mãi/"nhanh tay", KHÔNG xin số điện thoại/địa chỉ, KHÔNG hỏi dồn mục khác trong tin này.';
  if (h.kind === "doubt") {
    return `\n\nKHÁCH ĐANG LO LẮNG / NGHI NGẠI ("${h.quote}"): giải đáp đúng điều khách lo, ngắn gọn, thật lòng, chỉ dựa vào thông tin có thật trong sản phẩm/chính sách shop (không bịa; không có thông tin thì nói thật rằng shop sẽ kiểm tra lại giúp). ${common} Kết bằng câu mở nhẹ nhàng cho khách thong thả (vd "chị cứ hỏi thêm nếu còn lăn tăn gì, em tư vấn nha").`;
  }
  return `\n\nKHÁCH ĐANG CÂN NHẮC / CHƯA QUYẾT ("${h.quote}"): đáp ngắn gọn, thân thiện, tôn trọng việc khách cần thời gian. ${common} Nếu khách có hỏi gì thì giải đáp ngắn đúng theo thông tin sản phẩm. Có thể nhắc nhẹ 1 điểm có thật (vd cam kết đổi trả, freeship) nếu có trong thông tin sản phẩm. Kết bằng câu mở nhẹ nhàng (vd "chị cứ thong thả, cần gì nhắn em nha").`;
}

// Câu ép chốt / thúc giục / dọa hết hàng
const PUSHY_RE =
  /(?:^| )(?:chot (?:don|luon|nha|nhe|giup)|len don (?:cho|luon|nha|nhe|ngay)|dat (?:luon|hang (?:nha|nhe|ngay))|lay luon|mua luon|sap het hang|het khuyen mai|het uu dai|nhanh tay|chi con (?:hom nay|vai|it|1|2)|con (?:it|1|2|vai) (?:cai|san pham|mau|size)|ket thuc khuyen mai)(?: |$)/;

/** Bỏ câu ép chốt/thúc giục của AI; còn lại câu nào thì giữ. Trả { messages, changed }. */
export function dropPushyClose(messages) {
  const list = (messages || []).map((m) => String(m || "")).filter((m) => m.trim());
  let changed = false;
  const out = [];
  for (const m of list) {
    const parts = m.split(/(?<=[.!?…])\s+/).filter(Boolean);
    const keep = parts.filter((s) => {
      const bad = PUSHY_RE.test(plain(s));
      if (bad) changed = true;
      return !bad;
    });
    const t = keep.join(" ").trim();
    if (t) out.push(t);
  }
  return { messages: changed ? out : list, changed };
}
