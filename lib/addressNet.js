// lib/addressNet.js — AI đã ghi "tinh_huong" (khách đang hỏi giá / ship / chất vải / ảnh / phân vân...) mà KHÔNG nói khách đưa địa chỉ/SĐT
// → "lưới an toàn" của hệ thống KHÔNG được tự đọc tin khách để nhặt địa chỉ trong lượt đó.
// (Lỗi cũ: AI ghi đúng "khách hỏi xác nhận giá và phí ship" nhưng lưới an toàn vẫn đọc "195k miễn ship à" thành địa chỉ.)
// File này không import gì nên test được bằng `npm test`.

const plain = (t) =>
  String(t || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/gi, "d")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

// AI nói khách ĐƯA / CHỐT thông tin giao hàng → vẫn cho lưới an toàn làm việc
const GIVES_CONTACT = /(?:^| )(?:dia chi|sdt|so dien thoai|dien thoai|so nha|nhan hang tai|gui thong tin|dua thong tin|cho thong tin|chot don|len don|dat hang|muon mua|chot)(?: |$)/;
// AI nói khách đang hỏi / bàn chuyện KHÁC
const OTHER_TOPIC = /(?:^| )(?:gia|gia ca|ship|phi ship|phi van chuyen|giao hang|cod|kiem tra hang|chat lieu|chat vai|vai|lop lot|anh|hinh|video|phan van|suy nghi|doi tra|bao hanh|size|chieu cao|can nang|con hang|het hang|giam gia|bot gia|mac ca|mau)(?: |$)/;

/** @param {string} tinhHuong câu AI tự ghi về tình huống của khách trong lượt này */
export function aiSaysNotAddress(tinhHuong) {
  const p = plain(tinhHuong);
  if (!p) return false; // AI không ghi → giữ cách cũ
  if (GIVES_CONTACT.test(` ${p} `)) return false;
  return OTHER_TOPIC.test(` ${p} `);
}
