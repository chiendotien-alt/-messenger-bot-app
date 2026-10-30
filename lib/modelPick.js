// lib/modelPick.js — CHỌN MODEL THEO ĐỘ KHÓ của tin nhắn.
// Tin dễ (hỏi giá, hỏi size, xin ảnh, hỏi ship...) → dùng model mặc định (GEMINI_MODEL, hiện là flash-lite: nhanh, ít tốn quota).
// Tin KHÓ (khách phân vân, lo lắng, mặc cả, đổi trả, phàn nàn, đang chốt đơn / đưa SĐT-địa chỉ) → thử model mạnh hơn trước,
// lỗi/hết quota thì tự rơi về danh sách model thường (xem lib/gemini.js).
//
// Biến môi trường (không bắt buộc):
//   GEMINI_COMPLEX_MODEL   model dùng cho tin khó. Mặc định "off" (mọi tin dùng danh sách model mặc định: 3.5-flash-lite → 3.8-flash → 3.6-flash). Đặt tên model để tin khó thử model đó trước.
import { MODEL_CHAIN } from "./gemini";

// Nhãn tình huống (xem lib/situation.js) được coi là khó
export const COMPLEX_LABELS = new Set(["chot_don", "phan_van", "mac_ca", "doi_tra", "phan_nan"]);

/**
 * @param label            nhãn tình huống của tin khách (hoi_size, chot_don, phan_van...)
 * @param worry            khách đang lo lắng/nghi ngờ (isWorryText)
 * @param gaveContact      tin khách có SĐT hoặc địa chỉ
 * @param botAskedContact  tin gần nhất của bot đang xin SĐT/địa chỉ (đang ở bước chốt đơn)
 */
export function isComplexTurn({ label, worry = false, gaveContact = false, botAskedContact = false }) {
  return COMPLEX_LABELS.has(label) || !!worry || !!gaveContact || !!botAskedContact;
}

/** Danh sách model cho lượt này, hoặc null = dùng danh sách mặc định. */
export function modelsForTurn(complex, chain = MODEL_CHAIN) {
  if (!complex) return null;
  const m = String(process.env.GEMINI_COMPLEX_MODEL ?? "off").trim().replace(/^models\//, "");
  if (!m || /^(off|0|none|false)$/i.test(m)) return null;
  return [...new Set([m, ...chain])];
}
