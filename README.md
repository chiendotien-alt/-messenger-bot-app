# Chạy thử Messenger Bot trên máy tính (localhost)

## Yêu cầu trước
- Đã cài **Node.js** (bản 18 trở lên). Kiểm tra bằng lệnh: `node -v`
  Nếu chưa có, tải tại https://nodejs.org (chọn bản LTS).

## Bước 1 — Cài thư viện
Mở terminal/cmd, vào đúng thư mục project này, gõ:

```bash
npm install
```

## Bước 2 — Tạo file biến môi trường
Copy file `.env.local.example` thành `.env.local`:

```bash
cp .env.local.example .env.local
```

(Windows dùng lệnh `copy .env.local.example .env.local`)

Lúc này chưa cần điền `FB_PAGE_ACCESS_TOKEN` và `ANTHROPIC_API_KEY` vội — bước 3 sẽ chạy được server, nhưng bot chỉ thật sự trả lời khách khi có đủ 2 giá trị này.

## Bước 3 — Chạy thử local

```bash
npm run dev
```

Mở trình duyệt vào `http://localhost:3000` — thấy dòng "Messenger Bot đang chạy ✅" là server đã sống.

## Bước 4 — Điền API key để bot trả lời được
1. Lấy `ANTHROPIC_API_KEY` tại https://console.anthropic.com → API Keys → Create Key.
2. Dán vào `.env.local`, dòng `ANTHROPIC_API_KEY=...`
3. Tắt server (Ctrl+C) rồi chạy lại `npm run dev` để nó đọc biến môi trường mới.

Bạn có thể tự test hàm trả lời AI bằng cách gọi thử endpoint webhook bằng `curl` (giả một tin nhắn Facebook gửi tới), không cần đợi kết nối Facebook thật:

```bash
curl -X POST http://localhost:3000/api/webhook \
  -H "Content-Type: application/json" \
  -d '{
    "object": "page",
    "entry": [{
      "messaging": [{
        "sender": { "id": "test_user_123" },
        "message": { "text": "Nồi chiên không dầu giá bao nhiêu vậy shop?" }
      }]
    }]
  }'
```

Server sẽ chạy `generateReply()` và cố gửi tin nhắn qua Facebook (bước gửi sẽ lỗi vì chưa có `FB_PAGE_ACCESS_TOKEN` thật — không sao, xem log trong terminal chạy `npm run dev` để thấy nội dung AI trả lời có đúng ý không).

## Bước 5 — Khi nào cần kết nối Facebook thật
Facebook **bắt buộc** webhook phải là địa chỉ HTTPS công khai (không nhận `localhost`). Có 2 cách khi bạn sẵn sàng test thật với Fanpage:

- **Cách nhanh để test tạm thời**: dùng `ngrok` để tạo đường link công khai trỏ về máy bạn:
  ```bash
  npx ngrok http 3000
  ```
  Nó sẽ cho bạn 1 link dạng `https://xxxx.ngrok-free.app` — dùng link này + `/api/webhook` làm Callback URL khi khai báo Webhook trong Facebook App (link chỉ tồn tại khi bạn còn mở ngrok).

- **Cách chạy thật lâu dài**: deploy lên Vercel để có domain cố định. Nhắn mình khi bạn tới bước này, mình sẽ hướng dẫn deploy.

## Cấu trúc project
```
messenger-bot-app/
├── app/
│   ├── layout.js          # layout gốc bắt buộc của Next.js
│   ├── page.js             # trang chủ test server sống chưa
│   └── api/webhook/route.js  # endpoint Facebook gọi vào
├── lib/products.js         # dữ liệu sản phẩm cho AI trả lời
├── .env.local.example      # mẫu biến môi trường
└── package.json
```

## Web Quản lý bán hàng (/admin/ban-hang)

- Mở bằng nút 🧾 trên thanh trên cùng của trang chat (cùng mật khẩu, chỉ chủ shop thấy).
- Khi khách để lại số điện thoại trong chat, hệ thống tự tạo đơn (nhãn "🤖 Tự tạo") → hiện ở tab "Đơn chat" → bấm "Ghi vào doanh thu".
- Tắt/bật tự tạo đơn bằng nút trong tab "Đơn chat". Không cần thêm biến môi trường nào.
