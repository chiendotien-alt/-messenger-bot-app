// lib/bodyCross.js — ĐỐI CHIẾU tin AI với tin KHÁCH để biết khách đã đưa chiều cao / cân nặng chưa.
//
// Vấn đề: bộ nhận diện bằng luật (HEIGHT_TEXT_RE...) chỉ biết những kiểu viết đã được dạy ("1m62", "m150"...). Khách viết kiểu lạ
// ("M62 58kg", "1 62 58kg") thì luật bỏ sót, hệ thống tưởng khách chưa nói và xin lại, trong khi chính AI đã hiểu đúng
// và nhắc lại ngay trong tin ("chị cao 1m62 nặng 58kg").
//
// Cách làm (cần CẢ HAI phía khớp nhau, để AI không bịa số cho khỏi phải hỏi):
//   (1) tin AI (câu khẳng định, không phải câu hỏi) nói MỘT con số chiều cao/cân nặng cụ thể ngay sau chữ "cao"/"nặng"/"chị"...
//   (2) tin KHÁCH có đúng con số đó ("62" hoặc "162" cho 1m62; "58" cho 58kg).
// Khớp cả hai → coi như khách ĐÃ đưa số đo đó.

import { HEIGHT_TEXT_RE, WEIGHT_TEXT_RE } from "./replyDedupe";

const plainNorm = (t) =>
  String(t || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/gi, "d")
    .toLowerCase();

const HEIGHT_G = new RegExp(HEIGHT_TEXT_RE.source, "giu");
const WEIGHT_G = new RegExp(WEIGHT_TEXT_RE.source, "giu");

/** "1m62" / "1m6" / "1,62m" / "162cm" / "m62" → cm (130–199) hoặc null */
function heightCm(s) {
  let m;
  let cm = null;
  if ((m = s.match(/(?<!\d)([12])\s?m\s?(\d{1,2})/))) cm = +m[1] * 100 + (m[2].length === 1 ? +m[2] * 10 : +m[2]);
  else if ((m = s.match(/(?<!\d)([12])[.,](\d{1,2})/))) cm = +m[1] * 100 + (m[2].length === 1 ? +m[2] * 10 : +m[2]);
  else if ((m = s.match(/(?<!\d)(1[3-9]\d)(?!\d)/))) cm = +m[1];
  else if ((m = s.match(/m\s?(\d{2,3})/))) cm = +m[1] >= 100 ? +m[1] : 100 + +m[1];
  return cm !== null && cm >= 130 && cm <= 199 ? cm : null;
}

/** Mọi con số nguyên trong chữ (bỏ dấu . , trong số: "1.62" → 162) */
function numbersIn(plainText) {
  const out = new Set();
  for (const m of plainText.matchAll(/\d+(?:[.,]\d+)?/g)) out.add(parseInt(m[0].replace(/[.,]/g, ""), 10));
  return out;
}

/** Các câu KHẲNG ĐỊNH (không có dấu ?) của tin AI, đã bỏ dấu */
function statements(replyTexts) {
  return (replyTexts || [])
    .flatMap((t) => String(t || "").split(/\n+|(?<=[.!])\s+/))
    .map((s) => s.trim())
    .filter((s) => s && !/\?/.test(s))
    .map(plainNorm);
}

/**
 * @returns {{height: boolean, weight: boolean, heightCm: number|null, weightKg: number|null}}
 */
export function crossCheckBody({ customerTexts = [], replyTexts = [] } = {}) {
  const res = { height: false, weight: false, heightCm: null, weightKg: null };
  const cust = (customerTexts || []).map(plainNorm).filter((t) => t.trim()).join(" \n ");
  if (!cust) return res;
  // Số trong tin khách: khi đối chiếu chiều cao thì bỏ các cụm cân nặng ("58kg") và ngược lại, để 58kg không bị nhầm thành 1m58
  const custNoWeight = cust.replace(new RegExp(WEIGHT_G.source, "giu"), " ");
  const custNoHeight = cust.replace(new RegExp(HEIGHT_G.source, "giu"), " ");
  const hNums = numbersIn(custNoWeight);
  const wNums = numbersIn(custNoHeight);

  for (const s of statements(replyTexts)) {
    // CHIỀU CAO: đúng 1 mốc chiều cao trong câu (câu bảng size "cao 1m51 - 1m60" có 2 mốc → bỏ), đứng ngay sau chữ "cao"
    const hm = [...s.matchAll(new RegExp(HEIGHT_G.source, "giu"))];
    if (!res.height && hm.length === 1) {
      const before = s.slice(0, hm[0].index);
      if (/\bcao\s*(?:khoang\s*|tam\s*)?$/.test(before) || /^cao/.test(hm[0][0])) {
        const cm = heightCm(hm[0][0]);
        if (cm && (hNums.has(cm) || hNums.has(cm - 100))) {
          res.height = true;
          res.heightCm = cm;
        }
      }
    }
    // CÂN NẶNG: đúng 1 mốc cân nặng, đứng sau chữ "nặng"/"cân nặng" hoặc sau xưng hô (chị/anh/bạn/mình/em)
    const wm = [...s.matchAll(new RegExp(WEIGHT_G.source, "giu"))];
    if (!res.weight && wm.length === 1) {
      const before = s.slice(0, wm[0].index);
      if (/^nang/.test(wm[0][0]) || /(?:\bnang|\bchi|\banh|\bban|\bminh|\bem|\bkhach)\s*(?:khoang\s*|tam\s*)?$/.test(before)) {
        const kg = parseInt((wm[0][0].match(/\d{2,3}/) || [])[0], 10);
        if (kg >= 25 && kg <= 160 && wNums.has(kg)) {
          res.weight = true;
          res.weightKg = kg;
        }
      }
    }
  }
  return res;
}

/**
 * Ghi kết quả đối chiếu vào trạng thái thuộc tính: bật body.height / body.weight và đổi các mục đang "missing" mà suy ra được từ số đo
 * (chiều dài váy theo chiều cao, size theo cân nặng...) sang "measured" — đúng như khi bộ nhận diện luật tự đọc được.
 * @returns {string[]} số đo vừa bổ sung (để ghi log), rỗng nếu không đổi gì
 */
export function applyCrossBody(status, cross) {
  const changed = [];
  if (!status || !cross) return changed;
  const body = status.body || (status.body = { height: false, weight: false });
  if (cross.height && !body.height) {
    body.height = true;
    changed.push(`chiều cao${cross.heightCm ? " " + cross.heightCm + "cm" : ""}`);
  }
  if (cross.weight && !body.weight) {
    body.weight = true;
    changed.push(`cân nặng${cross.weightKg ? " " + cross.weightKg + "kg" : ""}`);
  }
  if (!changed.length) return changed;
  for (const x of status.list || []) {
    if (x.state !== "missing") continue;
    const k = x.attr?.kind;
    if ((k === "pair" && body.height && body.weight) || (k === "height" && body.height) || (k === "weight" && body.weight)) x.state = "measured";
  }
  return changed;
}

const ASK_H = /chieu cao|cao bao nhieu|cao tam|cao may|cao khoang|cao nhieu|met may/;
const ASK_W = /can nang|nang bao nhieu|nang may|nang nhieu|nang tam|bao nhieu (?:kg|can|ky|ki)|bao (?:kg|can|ky|ki)\b|may (?:kg|can|ky|ki)/; // gồm cả \"chị tầm bao cân ạ?\"
const ASK_CUE = /\?|\b(?:xin|cho .{0,10}biet|gui|nhan|bao)\b/;

/** Câu/vế này đang XIN chiều cao/cân nặng mà khách đã đưa rồi? (câu có con số là câu xác nhận, không phải câu xin → giữ) */
function isRedundantBodyAsk(part, known) {
  const p = plainNorm(part);
  if (/\d/.test(p) || !ASK_CUE.test(p)) return false;
  const h = ASK_H.test(p);
  const w = ASK_W.test(p);
  if (!h && !w) return false;
  return (!h || !!known.height) && (!w || !!known.weight);
}

/**
 * Bỏ khỏi tin AI những câu xin chiều cao / cân nặng mà khách đã đưa. Vế trả lời đi kèm vẫn giữ.
 * Không bao giờ trả về mảng rỗng (bỏ hết thì giữ nguyên bản gốc: bot không được im lặng).
 * @returns {{messages: string[], dropped: string[]}}
 */
export function dropKnownBodyAsks(messages, known) {
  const list = Array.isArray(messages) ? messages : [];
  if (!known || (!known.height && !known.weight)) return { messages: list, dropped: [] };
  const dropped = [];
  const out = [];
  for (const msg of list) {
    const lines = String(msg || "")
      .split(/\n+/)
      .map((line) => {
        const sentences = line.split(/(?<=[.!?…])\s+/).filter(Boolean);
        const kept = [];
        const bodyAskish = (c) => {
          const p = plainNorm(c);
          return ASK_H.test(p) || ASK_W.test(p);
        };
        for (const s of sentences) {
          const clauses = s.split(/,\s+/);
          // câu ghép có vế KHÔNG phải xin số đo ("Dạ size L vừa ạ, chị cho em xin chiều cao nha?"): chỉ bỏ riêng vế xin thừa
          if (clauses.length >= 2 && clauses.some((c) => !bodyAskish(c))) {
            const keep = clauses.filter((c) => !isRedundantBodyAsk(c, known));
            if (keep.length !== clauses.length) {
              dropped.push(s);
              if (keep.length) {
                const t = keep.join(", ").replace(/[,\s]+$/, "");
                kept.push(/[.!?…]$/.test(t) ? t : t + ".");
              }
              continue;
            }
            kept.push(s);
            continue;
          }
          // câu thường: bỏ cả câu nếu mọi thứ nó xin đều đã có (xin cả chiều cao + cân nặng mà mới biết một nửa → giữ nguyên)
          if (isRedundantBodyAsk(s, known)) dropped.push(s);
          else kept.push(s);
        }
        return kept.join(" ");
      })
      .filter(Boolean);
    const text = lines.join("\n");
    if (text) out.push(text);
  }
  if (!out.length) return { messages: list, dropped: [] }; // không để bot im lặng
  return { messages: out, dropped };
}
