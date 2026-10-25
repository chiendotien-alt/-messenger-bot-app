// Chuẩn hóa chính tả cho TÊN và ĐỊA CHỈ khách gõ (viết hoa đúng, bỏ dấu cách thừa, dấu phẩy/ngoặc đúng chỗ) trước khi báo đơn và lưu đơn.
// Chỉ sửa cách TRÌNH BÀY, không đổi chữ khách viết (trừ tên tỉnh/thành gõ không dấu ở cuối địa chỉ được viết lại có dấu).

const plainOf = (t) =>
  String(t || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D");

// Chữ viết tắt luôn VIẾT HOA
const ABBR = new Set(["tdp", "tp", "tx", "tt", "kcn", "ql", "kp", "cc", "ubnd", "hcm", "tphcm", "kdc", "kđt", "kdt", "cn", "tl", "dt"]);
// Chữ chỉ đơn vị / nối câu: viết thường (phường An Bình, thôn Thành Công, đối diện chợ ...)
const LOWER = new Set([
  "số", "ngõ", "ngách", "hẻm", "kiệt", "đường", "phố", "phường", "xã", "quận", "huyện", "tỉnh",
  "thôn", "xóm", "ấp", "tổ", "khu", "làng", "bản", "buôn", "cụm", "tầng", "lầu", "tòa", "toà", "lô",
  "cũ", "mới", "nay", "là", "trước", "đây", "thuộc", "gần", "cạnh", "đối", "diện", "ngay", "sau", "bên", "cổng", "phía", "giữa",
  "trong", "ngoài", "và", "hoặc", "của", "ở", "tại", "đầu", "cuối", "gồm",
]);
// Cùng ý nghĩa nhưng gõ KHÔNG DẤU ("ngo", "duong", "phuong"...) → cũng viết thường
const LOWER_PLAIN = new Set(["ngo", "ngach", "hem", "kiet", "duong", "pho", "phuong", "xa", "quan", "huyen", "tinh", "thon", "xom", "khu"]);
// Chữ chỉ viết thường khi đi cùng chữ bên cạnh: "thành phố", "thị xã", "thị trấn", "số nhà", "tổ dân phố", "chung cư", "căn hộ"
function lowerByContext(lc, prev, next) {
  if (lc === "thành") return next === "phố";
  if (lc === "thị") return next === "xã" || next === "trấn";
  if (lc === "trấn") return prev === "thị";
  if (lc === "nhà") return prev === "số";
  if (lc === "dân") return prev === "tổ";
  if (lc === "chung") return next === "cư";
  if (lc === "cư") return prev === "chung";
  if (lc === "căn") return next === "hộ";
  if (lc === "hộ") return prev === "căn";
  return false;
}
const ADMIN_START = new Set(["phường", "xã", "quận", "huyện", "tỉnh", "tp", "phuong", "xa", "quan", "huyen", "tinh"]);

const PROVINCES = [
  "An Giang","Bà Rịa - Vũng Tàu","Bắc Giang","Bắc Kạn","Bạc Liêu","Bắc Ninh","Bến Tre","Bình Định","Bình Dương","Bình Phước","Bình Thuận",
  "Cà Mau","Cần Thơ","Cao Bằng","Đà Nẵng","Đắk Lắk","Đắk Nông","Điện Biên","Đồng Nai","Đồng Tháp","Gia Lai","Hà Giang","Hà Nam","Hà Nội",
  "Hà Tĩnh","Hải Dương","Hải Phòng","Hậu Giang","Hòa Bình","Hồ Chí Minh","Hưng Yên","Khánh Hòa","Kiên Giang","Kon Tum","Lai Châu","Lâm Đồng",
  "Lạng Sơn","Lào Cai","Long An","Nam Định","Nghệ An","Ninh Bình","Ninh Thuận","Phú Thọ","Phú Yên","Quảng Bình","Quảng Nam","Quảng Ngãi",
  "Quảng Ninh","Quảng Trị","Sóc Trăng","Sơn La","Tây Ninh","Thái Bình","Thái Nguyên","Thanh Hóa","Thừa Thiên Huế","Tiền Giang","Trà Vinh",
  "Tuyên Quang","Vĩnh Long","Vĩnh Phúc","Yên Bái","Vũng Tàu",
];
const PROVINCE_BY_PLAIN = new Map(PROVINCES.map((p) => [plainOf(p).toLowerCase(), p]));

const cap1 = (w) => (w ? w.charAt(0).toLocaleUpperCase("vi") + w.slice(1).toLocaleLowerCase("vi") : w);

/** Viết hoa chữ cái đầu từng phần của một từ (cả khi có gạch nối: "Phú-mỹ" → "Phú-Mỹ"). */
function titleWord(w) {
  return w
    .split("-")
    .map((part) => (part ? cap1(part) : part))
    .join("-");
}

/** "Tdp 04( tdp Hiệp phú cũ) phường An Bình tỉnh Gia   Lai." → "TDP 04 (TDP Hiệp Phú cũ), phường An Bình, tỉnh Gia Lai" */
export function tidyAddress(input) {
  let t = String(input || "").normalize("NFC").replace(/\s+/g, " ").trim();
  if (!t) return "";
  t = t.replace(/^\s*(?:địa\s*chỉ|dia\s*chi|đc)\s*[:\-]\s*/i, "");
  // Dấu ngoặc & dấu câu: bỏ dấu cách thừa, thêm dấu cách còn thiếu
  t = t
    .replace(/\(\s+/g, "(")
    .replace(/\s+\)/g, ")")
    .replace(/(\S)\(/g, "$1 (")
    .replace(/\)(?=[\p{L}\p{N}])/gu, ") ")
    .replace(/\s+([,;:.!?])/g, "$1")
    .replace(/([,;:])(?=\S)/g, "$1 ")
    .replace(/\.{2,}/g, ".")
    .replace(/([,;])\s*\1+/g, "$1");
  // Dấu chấm ngăn cách ("Thơm. Thôn A. Xã B") → dấu phẩy. Giữ nguyên viết tắt dính liền như "P.5", "TP.HCM"
  t = t.replace(/\.\s+(?=\p{L})/gu, ", ").replace(/\s*[-–—]\s+(?=[\p{L}\p{N}])/gu, ", ").replace(/[\s,.;:\-–—]+$/g, ""); // "71- thanh ninh- Kim Anh-" → "71, thanh ninh, Kim Anh"

  // Tách thành từ, giữ dấu câu đứng cuối từ
  const rawAll = t.split(" ").filter(Boolean);
  const raw = rawAll.filter((w, i) => i === 0 || !(/^\p{L}+$/u.test(w) && w.toLocaleLowerCase("vi") === rawAll[i - 1].toLocaleLowerCase("vi"))); // "phường phường An Bình" → "phường An Bình"
  const words = [];
  for (const tokRaw of raw) {
    const m = tokRaw.match(/^([("]*)(.*?)([),;:.)"]*)$/u);
    const pre = m ? m[1] : "";
    const core = m ? m[2] : tokRaw;
    const post = m ? m[3] : "";
    words.push({ pre, core, post });
  }

  const lowerCore = (i) => (words[i] ? words[i].core.toLocaleLowerCase("vi") : "");
  const out = words.map((w, i) => {
    const lc = lowerCore(i);
    let core = w.core;
    if (!core) return w;
    const prevLc = lowerCore(i - 1);
    const nextLc = lowerCore(i + 1);
    const nextNum = /^\d/.test(nextLc);
    if (/\d/.test(core) && !core.includes(".")) {
      core = core.replace(/[a-zà-ỹ]+/giu, (x) => (x.length <= 2 ? x.toUpperCase() : x)); // "12a" → "12A", "5/3b" → "5/3B"
    } else if (core.includes(".") && /^[\p{L}]{1,4}(?:\.[\p{L}\p{N}]+)+$/u.test(core)) {
      core = core.split(".").map((part) => (/^\d/.test(part) ? part : ABBR.has(part.toLocaleLowerCase("vi")) || part.length <= 2 ? part.toLocaleUpperCase("vi") : titleWord(part))).join("."); // "p.5" → "P.5", "tp.hcm" → "TP.HCM"
    } else if (ABBR.has(lc)) {
      core = lc.toUpperCase();
    } else if (LOWER.has(lc) || lowerByContext(lc, prevLc, nextLc) || (LOWER_PLAIN.has(lc) && lc === plainOf(lc)) || ((lc === "so" || lc === "to") && nextNum)) {
      core = lc;
    } else {
      core = titleWord(core);
    }
    return { ...w, core };
  });

  // Dấu phẩy ngăn các cấp hành chính: "..., phường X, quận Y, tỉnh Z"
  let result = "";
  out.forEach((w, i) => {
    const prev = out[i - 1];
    const lc = lowerCore(i);
    const next = lowerCore(i + 1);
    const prevLc = lowerCore(i - 1);
    const isAdminStart = !w.pre && i > 0 && ((ADMIN_START.has(lc) && prevLc !== "thị") || (lc === "thành" && next === "phố") || (lc === "thị" && (next === "xã" || next === "trấn")));
    const prevEndsComma = prev && /[,;]$/.test(prev.post);
    if (i > 0) {
      if (isAdminStart && !prevEndsComma && !(prev.pre && !prev.post)) result += ",";
      result += " ";
    }
    result += w.pre + w.core + w.post;
  });

  result = result.replace(/[\s,.;:]+$/g, "").replace(/,\s*,/g, ",");

  // Tên tỉnh/thành ở CUỐI địa chỉ gõ không dấu → viết lại đúng dấu ("ha noi" → "Hà Nội")
  const ws = result.split(" ");
  for (const n of [4, 3, 2, 1]) {
    if (ws.length < n) continue;
    const tail = ws.slice(-n).join(" ");
    const tl = tail.toLocaleLowerCase("vi");
    if (plainOf(tl) !== tl) continue; // khách đã gõ có dấu → giữ nguyên
    const hit = PROVINCE_BY_PLAIN.get(tl.replace(/-/g, " ").replace(/\s+/g, " "));
    if (hit) {
      result = [...ws.slice(0, -n), hit].join(" ");
      break;
    }
  }

  // Chữ cái đầu của cả địa chỉ viết hoa
  return result.charAt(0).toLocaleUpperCase("vi") + result.slice(1);
}

// Chữ xưng hô đứng trước tên ("chị Lan") không phải là một phần của tên
const HONORIFIC = new Set(["chị", "anh", "cô", "chú", "bác", "mẹ", "bố", "em", "bạn", "c", "a"]);

/** "đỗ thị hồng vâng" → "Đỗ Thị Hồng Vâng"; "chị Lan" → "Lan". */
export function tidyName(input) {
  let t = String(input || "").normalize("NFC").replace(/[\d_@#$%^&*=+<>/\\|~`"()[\]{}]/g, " ").replace(/\s+/g, " ").trim();
  t = t.replace(/^[\s,.;:\-]+|[\s,.;:\-]+$/g, "");
  if (!t) return "";
  let words = t.split(" ").filter(Boolean);
  if (words.length > 1 && HONORIFIC.has(words[0].toLocaleLowerCase("vi"))) words = words.slice(1);
  return words.map((w) => (w.length === 1 ? w.toLocaleUpperCase("vi") : titleWord(w))).join(" ");
}
