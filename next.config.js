/** @type {import('next').NextConfig} */
const nextConfig = {
  // Cho phép nạp file .html thành chuỗi chữ (trang Quản lý bán hàng: lib/banHang.html)
  webpack(config) {
    config.module.rules.push({ test: /\.html$/, type: "asset/source" });
    return config;
  },
};

module.exports = nextConfig;
