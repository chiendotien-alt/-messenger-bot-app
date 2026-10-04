// lib/replyDedupe.js — chặn bot hỏi/xin lại 1 thông tin mà bot/shop vừa hỏi (mặc định so với 3 tin gần nhất).
//
// So từng CÂU (không phải cả tin), vì AI hay gộp nhiều câu trong 1 tin và hay đổi cách nói
// ("Chị cho em xin cân nặng...?" → "Dạ chị cho em xin cân nặng để em chọn size... nha chị.").
// Chỉ xét câu HỎI/XIN (có dấu ? hoặc có cụm "cho em xin/biết/hỏi", "xin thêm"...).
// Câu thường (giá, số tài khoản, địa chỉ...) không bao giờ bị chặn, vì khách xin lại thì bot phải gửi lại được.

const MIN_CONTENT = 3; // câu phải có ít nhất ngần này từ khóa (đã bỏ chữ đệm như dạ/chị/em/nha...)
const MIN_SHARED = 3; // và trùng ít nhất ngần này từ khóa với câu cũ
const SIMILAR = 0.6; // tỉ lệ từ khóa trùng (so với câu ngắn hơn) từ 60% trở lên → coi là hỏi lặp

// Chữ đệm/xưng hô (viết không dấu) — bỏ đi để chỉ so phần nội dung (cân nặng, size, màu, địa chỉ...)
const FILLER = new Set(
  "da vang uh a ah oi nha nhe nhi nghen ne chi anh em shop minh cho xin la de va thi cua cung voi rat lam nhat qua nua them the nay kia do duoc co khong ko k ma ban to bo cai nhung vay roi luon dang se giup".split(" ")
);

// Cụm cho biết câu đang xin/hỏi khách điều gì (không dấu, chữ thường)
const ASK_CUE = /\b(cho (em|shop|minh) (xin|biet|hoi)|xin them|nhan (cho )?(em|shop)|gui (cho )?(em|shop)|bao (em|shop))\b/;

function plain(t) {
  return String(t || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d");
}

function contentWords(t) {
  return plain(t)
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w && !FILLER.has(w));
}

function isAsk(sentence) {
  return sentence.includes("?") || ASK_CUE.test(plain(sentence));
}

function splitSentences(text) {
  // [{ line, parts: [câu, câu...] }, ...]
  return String(text || "")
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => line.split(/(?<=[.!?…])\s+/).filter(Boolean));
}

function sameAsk(a, b) {
  const A = new Set(contentWords(a));
  const B = new Set(contentWords(b));
  if (A.size < MIN_CONTENT || B.size < MIN_CONTENT) return false;
  let shared = 0;
  for (const w of A) if (B.has(w)) shared++;
  return shared >= MIN_SHARED && shared / Math.min(A.size, B.size) >= SIMILAR;
}

/**
 * Bỏ khỏi `candidate` những câu hỏi/xin đã hỏi trong `recentTexts`. Trả về phần còn lại ("" nếu bỏ hết).
 * Không có câu nào lặp → trả đúng nguyên văn `candidate`.
 */
export function removeRepeatedAsks(candidate, recentTexts) {
  const oldAsks = [];
  for (const t of recentTexts || []) for (const line of splitSentences(t)) for (const s of line) if (isAsk(s)) oldAsks.push(s);
  if (!oldAsks.length) return candidate;

  const lines = splitSentences(candidate);
  let removed = false;
  const kept = lines
    .map((parts) =>
      parts.filter((s) => {
        if (isAsk(s) && oldAsks.some((o) => sameAsk(s, o))) {
          removed = true;
          return false;
        }
        return true;
      })
    )
    .filter((parts) => parts.length)
    .map((parts) => parts.join(" "));
  return removed ? kept.join("\n") : candidate;
}
