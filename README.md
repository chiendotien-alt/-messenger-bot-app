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

## Đoán tình huống & ngữ cảnh khách (3 lớp)

Trước khi trả lời, bot hiểu tình huống của khách theo 3 lớp từ rẻ đến đắt:

1. **AI tự ghi `tinh_huong` trong JSON trả lời** (lib/botPrompt.js) — khách muốn gì, đang ở bước nào, cần tránh gì. Không tốn thêm lần gọi AI. Xem trong log Vercel: `Tình huống AI tự ghi`.
2. **Nhãn tình huống bằng luật từ khoá** (lib/situation.js → `detectSituation`) — hỏi giá, mặc cả, ship, đổi trả, phàn nàn... Dùng để tìm câu đã dạy ở trang "Dạy bot" đúng nhóm hơn (lib/training.js). Không gọi AI.
3. **AI phân loại riêng, chỉ khi cần** (`shouldClassify` + `classifySituation`) — khi khách phàn nàn / xin giảm giá / đổi trả / đang phân vân, tin quá ngắn ("vậy hả", "thôi", "ok"), hoặc khách đã có đơn mà hỏi tiếp. Dùng model nhẹ, tối đa ~4,5 giây; lỗi/timeout/không chắc thì bỏ qua, bot chạy như cũ. Xem log: `Phân loại tình huống (lớp 3)`.

Biến môi trường (không bắt buộc):
- `SITUATION_LAYER=off` — tắt lớp 3 (lớp 1 và 2 vẫn chạy, không tốn quota).
- `SITUATION_BUDGET_MS` — thời gian tối đa cho lớp 3 (mặc định 4500).


## Gom tin nhắn ngắn của khách

Khách hay nhắn từng mảnh ngắn ("sai s", "46k", "2c"). Với khách đã có cuộc trò chuyện, nếu tin ít hơn **5 chữ** (không kèm ảnh) thì bot chờ **6 giây** cho khách gõ tiếp; mỗi tin ngắn mới tính lại 6 giây từ đầu. Hết thời gian chờ, **chỉ tin cuối của loạt** đi tiếp và trả lời MỘT lần cho cả loạt. Tin dài từ 5 chữ trở lên, ảnh và nút bấm thì không chờ thêm.

- Đổi thời gian chờ: biến `SHORT_MSG_WAIT_MS` (mili giây, mặc định 6000; đặt `0` để tắt).
- Đổi ngưỡng số chữ: biến `SHORT_MSG_WORDS` (mặc định 5, tức tin 1–4 chữ bị coi là ngắn).
- Mã nguồn: `lib/shortMessage.js` và phần "Khách cũ nhắn liền mấy tin ngắn" trong `app/api/webhook/route.js`.
- Webhook trả 200 cho Facebook NGAY rồi xử lý nền (`waitUntil`, gói `@vercel/functions`). Nhờ vậy Facebook chuyển các tin kế tiếp của khách ngay trong lúc bot đang chờ, và bot gom được. Đặt `WEBHOOK_BACKGROUND=0` trên Vercel để quay về cách cũ.

## AI dự phòng: Gemini → Claude → Groq

Thứ tự bot gọi AI cho mỗi tin nhắn:

1. **Gemini** (chính, miễn phí) — luôn thử trước.
2. **Claude** (dự phòng 1, **trả phí**) — chỉ được gọi khi mọi model/key Gemini đều lỗi, quá tải (503) hoặc hết hạn mức. Dùng đúng câu lệnh đầy đủ như Gemini nên chất lượng trả lời gần như không đổi.
3. **Groq** (dự phòng 2, miễn phí) — chỉ khi cả Gemini lẫn Claude đều lỗi.

Cách thêm key Claude (chọn 1 trong 2):
- **Trên trang quản trị (khuyên dùng):** nút 🔑 → mục "Claude (dự phòng 1 — trả phí)" → dán key `sk-ant-...` → Thêm. Dùng được ngay (tối đa ~30 giây để nhận key mới), không cần deploy lại. Nút "Kiểm tra" báo key còn dùng được / hết tiền.
- **Biến môi trường:** `ANTHROPIC_API_KEY` trên Vercel (nhiều key ngăn cách bằng dấu phẩy) → Redeploy.

Lấy key ở https://console.anthropic.com/settings/keys, nạp tiền ở Plans & Billing. **Nên đặt hạn mức chi tiêu hàng tháng** bên Anthropic để không bị tốn ngoài ý muốn.

- Model mặc định: `claude-haiku-5-5`, rồi `claude-sonnet-5-5`. Đổi bằng biến `CLAUDE_MODELS` (xem `.env.local.example`).
- Mức suy nghĩ: `CLAUDE_EFFORT` (mặc định `low` → nhanh và rẻ hơn; nếu thấy tư vấn kém hơn Gemini thì đặt `medium`).
- Tắt tạm Claude mà không xoá key: đặt `CLAUDE_ENABLED=0`.
- Khi Claude trả lời thay Gemini, log có dòng `Bot trả lời (claude:...)` và chủ shop nhận tin Telegram (tối đa 30 phút/lần). Khi tài khoản Claude hết tiền hoặc key bị từ chối cũng có tin Telegram riêng (6 giờ/lần).
- Mã nguồn: `lib/claude.js` (gọi Claude), `lib/gemini.js` → hàm `callGemini` (thứ tự dự phòng).

## AI dự phòng bằng Groq

Khi Gemini lỗi/hết hạn mức (và Claude không có hoặc cũng lỗi), bot tự chuyển sang Groq (miễn phí) để vẫn trả lời khách.

Cách thêm key Groq (chọn 1 trong 2):
- **Trên trang quản trị (khuyên dùng):** bấm nút 🔑 → mục "Groq (dự phòng)" → dán key `gsk_...` → Thêm. Dùng được ngay, không cần deploy lại. Có nút "Kiểm tra" để xem key còn hạn mức không.
- **Biến môi trường:** thêm `GROQ_API_KEY` trên Vercel (nhiều key ngăn cách bằng dấu phẩy) → Redeploy.

Lấy key tại https://console.groq.com/keys.

Xem log để biết đang dùng AI nào: dòng `Bot trả lời (groq:...)` nghĩa là Groq đã thay Gemini.
Ảnh khách gửi chỉ đọc được nếu model vision của Groq còn hoạt động; nếu không bot trả lời bằng chữ và bỏ qua ảnh.
Mã nguồn: `lib/groq.js`. Model mặc định: `openai/gpt-oss-120b`, `openai/gpt-oss-20b`. Nếu Groq gỡ model, đặt `GROQ_MODELS` trên Vercel theo tên ở https://console.groq.com/docs/models (xem `.env.local.example`).

## AI dịch lại chính tả tin khách

Khách hay gõ lạ ("M61" = cao 1m61, "5ok" = 50kg, "zai l" = size L). AI hiểu được nhưng các luật của hệ thống thì không, nên bot từng hỏi lại điều khách đã nói.

Cách hoạt động: khi trả lời, AI viết thêm trường `khach_viet_lai` = từng tin mới của khách viết lại đúng chính tả / đúng dạng hệ thống hiểu. Hệ thống kiểm tra (số phải có trong tin gốc, không mất SĐT / cân nặng / số nhà), lưu vào cột `messages.text_norm`, rồi mọi luật đọc bản đó. Chữ khách gõ (`messages.text`) giữ nguyên để chủ shop xem.

- Mã nguồn: `lib/customerRewrite.js`; chỗ gắn vào: khối "AI DỊCH LẠI CHÍNH TẢ" trong `app/api/webhook/route.js`, `lib/nudge.js`, `lib/autoOrder.js`.
- Không cần biến môi trường mới, không tốn thêm lượt gọi AI. Cột `text_norm` tự tạo khi chạy lần đầu.
- Xem log Vercel: `AI dịch lại chính tả khách: "5ok nha" → "nặng 50kg nha"`.
