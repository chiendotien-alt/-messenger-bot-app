# Lịch sử sửa lỗi: bot lên đơn thiếu size (messenger-bot-app)

> Tài liệu để giao cho AI/dev khác đọc nhanh, khỏi phải đọc lại toàn bộ cuộc trò chuyện.
> Ngày ghi: 27/10/2026. Bản zip tương ứng: bản zip dự án đầy đủ (file này nằm trong `docs/`).

## 1. Bối cảnh dự án

- Bot bán hàng Messenger, Next.js chạy trên Vercel, repo GitHub `messenger-bot-app`.
- AI trả lời: Gemini (log ghi `gemini-3.6-flash`, `gemini-3.5-flash-lite`).
- Sản phẩm có "thuộc tính" (màu, size, chiều dài váy...). Mỗi thuộc tính có kiểu `kind`:
  - `pair` (chọn theo chiều cao + cân nặng), `height`, `weight`, `choose` (khách tự chọn, vd màu).
- File liên quan:
  - `lib/attributes.js`: nhận diện giá trị khách chọn, tính trạng thái từng thuộc tính (`attributeStatus`), ghép `variant` (`composeVariant`), ghép chi tiết tin tóm tắt (`summaryDetail`).
  - `app/api/webhook/route.js`: xử lý webhook, gọi AI, ghép khối báo đơn, lưu đơn.
  - `lib/priceLadder.js`: `buildSummaryText` (ghép tin báo đơn gửi khách).
  - `lib/orderFacts.js`: `deriveOrderFacts` (tính dữ kiện đơn lưu trong hệ thống).
- Trạng thái một thuộc tính (`state`):
  `missing` (chưa có) / `measured` (khách đưa đủ số đo, shop chưa nói giá trị) / `proposed` (shop đã tư vấn, khách chưa chốt) / `confirm` (khách nói số ngoài danh sách, chờ xác nhận) / `chosen` (đã chốt).

## 2. Lỗi gặp phải

Khách nhắn: `Chị lấy Màu kem zai l dài váy 75 cm` ("zai l" = "size L" gõ tắt).

- Bot trả lời đúng: "Dạ em lấy chị chân váy màu kem, size L dài 75cm".
- Nhưng khối báo đơn do hệ thống tự ghép lại ra: `Màu kem, dài 75cm, SL:1`, **thiếu size L**.
- Bot còn hỏi thêm cân nặng để chọn size, dù khách đã nói size.
- Log lúc lỗi: `Thuộc tính: Size=missing | Chiều dài váy=chosen(75cm) | màu=chosen(Kem)`.
- Dòng log liên quan: `Thiếu khối đơn sau khi khách đưa SĐT/địa chỉ → hệ thống ghép khối đơn`.

## 3. Nguyên nhân gốc

Có **hai bộ phận đọc tin khách riêng, kết quả lệch nhau**:

1. **AI (Gemini)** đọc nguyên văn nên hiểu "zai l" là size L, viết tin trả lời đúng.
2. **Hệ thống ghép khối đơn** không hỏi AI mà dùng regex trong `lib/attributes.js` (`matchValues`). Với giá trị dạng chữ (S/M/L/XL), regex chỉ nhận khi:
   - khách gõ kèm tiền tố `size|sz|siz|saiz`, hoặc
   - tin ngắn (từ 6 từ trở xuống) thì nhận chữ trơn.
   Tin "zai l" dài 9 từ và "zai" không nằm trong danh sách → `Size=missing`.

## 4. Các thay đổi đã làm (theo thứ tự)

### Thay đổi 1: mở rộng cách nhận chữ "size" (sửa gốc regex)
- File: `lib/attributes.js`.
- Thêm hằng `SIZE_WORDS` (size, sz, siz, sise, szie, saiz, sai, sais, zai, zaiz, zize, xai, xaiz, sizee, co, kich co), thay chuỗi cứng `size|sz|siz|saiz` ở hai regex trong `matchValues`.
- Test: `tests/sizeTypo.test.mjs`.
- Hạn chế: chỉ bắt các kiểu gõ đã liệt kê; kiểu lạ khác vẫn có thể sót (đã có Thay đổi 2 bù).

### Thay đổi 2: đối chiếu tin AI với trạng thái thuộc tính (lưới an toàn)
- File: `lib/attributes.js`, hàm mới `reconcileWithReply(status, { replyTexts, customerTexts })`.
- Điều kiện ghi nhận một mục đang `missing` thành `chosen`:
  1. Tin AI (và 3 tin shop gần nhất) nói **đúng một** giá trị của mục đó, ở câu khẳng định (không phải câu hỏi).
  2. **Khách có nhắn** giá trị đó (đọc kiểu nhắn trơn, `matchValues(..., {bare:true})`) trong 4 tin gần nhất.
  3. Khách không phủ định ("không lấy size L").
- Không đụng mục đã `chosen`/`confirm`/`proposed`. Giá trị AI tự nói mà khách không nhắn thì **không** ghi vào đơn.
- File `app/api/webhook/route.js`:
  - thêm `reconcileWithReply` vào dòng import từ `@/lib/attributes`;
  - đổi `const sumDetail` thành `let sumDetail`;
  - chèn khối đối chiếu ngay sau dòng `const openingRequested = !!parsed?.use_opening_product;`, tức sau khi có tin AI và trước bước lưu lựa chọn/`composeVariant`. Khi bổ sung được sẽ tính lại `sumDetail` và ghi log `Đối chiếu tin AI: bổ sung lựa chọn khách mà bộ nhận diện bỏ sót: ...`.
- Test: `tests/reconcile.test.mjs`.

### Thay đổi 3: shop tư vấn mà khách không phản đối thì coi là khách đồng ý
- Yêu cầu của chủ shop: nếu bot gợi ý size/chiều dài (theo chiều cao, cân nặng khách đưa) mà khách không phản đối thì ghi nhận là thông số của khách và báo đơn.
- File: `lib/attributes.js`:
  - hàm mới `isAdviceAttr(a)`: chỉ áp dụng cho thuộc tính shop tư vấn theo số đo (size, chiều dài, kind khác `choose`), **không áp dụng cho màu** (khách tự chọn);
  - nhánh mới cuối chuỗi `else if` trong vòng lặp tin khách của `attributeStatus`: nếu thuộc tính đang `proposed`, tin khách mới không phải câu hỏi, không có từ phủ định (`NEGATE`) và không nhắc tới thuộc tính đó (`aboutAttr`) → `chosen` (`by: "accepted"`).
- Cách chốt cũ vẫn còn: khách đồng ý ("ok"), gửi SĐT/địa chỉ, hoặc nhắn giá trị khác.
- Không chốt (vẫn là `proposed`) khi: khách phản đối, khách hỏi lại về size/chiều dài ("size M có chật không?"), khách nhắn câu hỏi hoặc có chữ phủ định, hoặc tin cuối cùng của hội thoại là tin tư vấn của shop (khách chưa trả lời).
- Test: `tests/silentAccept.test.mjs`.

## 5. Kịch bản kiểm chứng (đã chạy trên code thật)

Khách "Chị cao 1m60 nặng 55kg" → bot tư vấn "size M dài 85cm, chị chọn màu nào ạ?" → khách "Màu kem":

| Bước | Size | Chiều dài |
|---|---|---|
| Sau khi bot tư vấn | proposed(M) | proposed(85cm) |
| Khách nhắn "Màu kem" (trước khi sửa Thay đổi 3) | proposed(M) | proposed(85cm) |
| Khách nhắn "Màu kem" (sau khi sửa) | chosen(M) | chosen(85cm) |

`variant` lưu: `Màu Kem, Size M, Chiều dài 85cm`.

Chạy test: `npm test` (dùng `tests/loader.mjs`). Kết quả: 51 test, 51 qua, 0 lỗi (37 test cũ của dự án + 14 test mới: 2 trong sizeTypo, 6 trong reconcile, 6 trong silentAccept).

## 6. Đã xem xét nhưng KHÔNG làm

- Bỏ size/chiều dài khỏi tin báo đơn gửi khách (chỉ giữ tên sản phẩm + màu, đơn lưu vẫn đủ): chủ shop đã cân nhắc rồi quyết định **không bỏ**. Định dạng tin báo giữ nguyên.
- Tự chốt **màu** khi shop chỉ khen màu hợp: không làm, màu là khách tự chọn.

## 7. Giới hạn đã biết và việc cần theo dõi

1. Cách chốt ngầm (Thay đổi 3) nghĩa là nếu khách muốn size khác mà không nói ra, đơn vẫn ra theo size bot tư vấn. Nên theo dõi vài ngày.
2. Gợi ý (`proposed`) chỉ được tạo khi tin shop có từ tư vấn kiểu `lấy|chọn|hợp|vừa|đẹp|mặc|dùng|nên|phù hợp|lên đơn|chốt` (biến `RECOMMEND`) và nêu đúng một giá trị. Tin kiểu "size M ạ." trơn có thể không được tính là gợi ý; chưa có test cho ca này.
3. Cổng "đủ thông tin để xin SĐT/địa chỉ" đòi `chosen`. Sau Thay đổi 3, khi khách chọn màu thì size/chiều dài đã `chosen` nên bot xin SĐT luôn. Điều này đã thấy qua mô phỏng `attributeStatus`, **chưa kiểm tra bằng luồng webhook thật**.
4. Chưa chạy thử trên bot đang chạy thật (chỉ chạy test và mô phỏng). Sau khi deploy, xem log có dòng `Đối chiếu tin AI` hay không: nếu xuất hiện nhiều, nghĩa là regex đang sót nhiều kiểu gõ, cần bổ sung `SIZE_WORDS`.
5. Đơn lưu (`deriveOrderFacts`) tính lại từ nội dung chat và từ `variant` đã lưu. Nhờ đối chiếu chạy **trước** bước lưu `variant`, size bổ sung được đi vào đơn lưu. Phần này suy ra từ đọc code, chưa có test riêng.

## 8. Cách áp dụng

1. Giải nén bản zip dự án đầy đủ (file này nằm trong `docs/`).
2. Chép đè `lib/attributes.js` và `app/api/webhook/route.js` vào repo.
3. Thêm 3 file test vào `tests/`: `sizeTypo.test.mjs`, `reconcile.test.mjs`, `silentAccept.test.mjs`.
4. Push lên GitHub để Vercel deploy, rồi chạy `npm test` để kiểm tra.

## 9. Nếu AI khác tiếp tục sửa

- Đọc trước: mục 3 (nguyên nhân), hàm `matchValues`, `attributeStatus`, `reconcileWithReply` trong `lib/attributes.js`.
- Khi thấy lỗi thiếu giá trị mới: lấy tin khách gốc + dòng log `Thuộc tính: ...` để biết bộ nhận diện bỏ sót ở đâu.
- Đừng sửa theo hướng cho AI tự điền giá trị vào đơn mà khách chưa nhắn; nguyên tắc của dự án là đơn chỉ ghi những gì khách đã chọn, hoặc shop gợi ý rồi khách không phản đối.
