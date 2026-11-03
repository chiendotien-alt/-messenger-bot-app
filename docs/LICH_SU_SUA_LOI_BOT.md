# Lịch sử sửa lỗi: bot lên đơn thiếu size (messenger-bot-app)

> Tài liệu để giao cho AI/dev khác đọc nhanh, khỏi phải đọc lại toàn bộ cuộc trò chuyện.
> Ngày ghi: 27/10/2026 (cập nhật thêm mục 10, 11 và 12 cùng ngày; mục 13 thêm ngày 28/10/2026; mục 14 ngày 31/10/2026; mục 15 ngày 01/11/2026; mục 16 ngày 02/11/2026; mục 17 ngày 02/11/2026; mục 18 ngày 02/11/2026; mục 19 ngày 02/11/2026; mục 20 ngày 03/11/2026). Bản zip tương ứng: bản zip dự án đầy đủ (file này nằm trong `docs/`).

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

## 3. Nguyên nhân gốc (lỗi chính)

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

### Thay đổi 4: sửa lỗi có sẵn khi khách đổi ý lúc bot vừa xin SĐT (phát hiện qua bộ test kịch bản)
- Hiện tượng: bot vừa xin SĐT/địa chỉ, khách nhắn "Chị đổi lấy size L nha" thì bot vẫn giữ size cũ (M). Câu "lấy L" hay "đổi L" thì đổi đúng. Lỗi này có từ trước, không do Thay đổi 1–3.
- Nguyên nhân: khi tin của khách là tin liên hệ (hoặc bot vừa xin SĐT), hệ thống chỉ đọc phần khách "nói rõ là chọn" qua `EXPLICIT_CHOICE_RE` / `explicitChoiceText` (để tên đường như "Lê Hồng Phong" không bị đọc thành màu). Regex lấy từ khóa kèm 2 từ liền sau rồi bỏ qua phần đã lấy, nên "đổi lấy size L" bị cắt thành "đổi lấy size", mất chữ "L".
- Cách sửa (`lib/attributes.js`): dùng lookahead để các đoạn chồng nhau: "đổi lấy size L" → "đổi lấy size" | "lấy size L" | "size L". Cũng sửa luôn ca "màu hồng dài 92" (trước đây "dài 92" bị nuốt).
- Test: nhóm "Hồi quy" cuối `tests/scenarios.test.mjs`, gồm kiểm tra tên đường/tên người không bị đọc thành màu.

## 5. Kịch bản kiểm chứng (đã chạy trên code thật)

Khách "Chị cao 1m60 nặng 55kg" → bot tư vấn "size M dài 85cm, chị chọn màu nào ạ?" → khách "Màu kem":

| Bước | Size | Chiều dài |
|---|---|---|
| Sau khi bot tư vấn | proposed(M) | proposed(85cm) |
| Khách nhắn "Màu kem" (trước khi sửa Thay đổi 3) | proposed(M) | proposed(85cm) |
| Khách nhắn "Màu kem" (sau khi sửa) | chosen(M) | chosen(85cm) |

`variant` lưu: `Màu Kem, Size M, Chiều dài 85cm`.

Chạy test: `npm test` (dùng `tests/loader.mjs`). Kết quả: 78 test, 78 qua, 0 lỗi (37 test cũ của dự án + 41 test mới: 2 sizeTypo, 6 reconcile, 6 silentAccept, 27 scenarios gồm kịch bản nhiều lượt chat, địa chỉ/SĐT, đổi ý, sản phẩm không size, fuzz 3000 tổ hợp ngẫu nhiên, hiệu năng).

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

## 10. Các lỗi sửa thêm ngày 27/10/2026 (sau lỗi thiếu size)

### 10.1. Bot hỏi gộp màu với xin số điện thoại sau khi khách đưa chiều cao/cân nặng

- **Hiện tượng:** khách nhắn `Chiều cao 55 cân nặng 54`. Bot tư vấn dài 85cm và hỏi màu đúng, nhưng cuối tin lại dính thêm câu `Em xin thêm số điện thoại nữa nha chị.` (khách chưa hề gửi địa chỉ).
- **Dòng log nhận biết:** `Khách mới đưa địa chỉ mà AI quên xin SĐT → hệ thống thêm câu xin: ...`
- **Nguyên nhân:** hàm `looksLikeAddress` (`lib/replyDedupe.js`) có luật "tin từ 6 từ trở lên, không có từ về sản phẩm (màu/size/cm/kg...) thì coi là địa chỉ". Tin số đo viết không kèm chữ `kg`/`cm` có đúng 6 từ nên bị đọc nhầm là địa chỉ. Chốt chặn `missingContactAsk` (`lib/contactAsk.js`, gọi trong `app/api/webhook/route.js`) tưởng khách vừa đưa địa chỉ mà chưa có SĐT nên tự thêm câu xin SĐT.
- **Cách sửa:** thêm `BODY_MEASURE_RE` trong `lib/replyDedupe.js`. Tin có từ về số đo (`chiều cao`, `cân nặng`, `nặng`, `cân`, `kg`, `ký`, `kí`, hoặc `cao` + số) kèm chữ số thì KHÔNG coi là địa chỉ. Nếu tin có từ khóa địa chỉ thật (đường, phường, quận, số nhà...) thì vẫn là địa chỉ (từ khóa được kiểm tra trước).
- **File đổi:** `lib/replyDedupe.js`, `tests/contactAsk.test.mjs` (thêm 2 test: tin số đo không phải địa chỉ; địa chỉ thật như `12 Cao Thắng Hà Nội Việt Nam` vẫn nhận ra).

### 10.2. Khách hỏi "53 tuổi mặc màu nào chị" mà bot gửi ảnh tổng hợp các màu

- **Hiện tượng:** khách xin tư vấn màu hợp với tuổi, không xin xem ảnh. Bot trả lời chữ đúng ("đen, kem hoặc đỏ đô") rồi vẫn gửi ảnh tổng hợp 8 màu.
- **Dòng log nhận biết:** `Gửi ảnh tổng hợp mẫu mã cho khách: 53 tuổi mặc màu nào chị`
- **Nguyên nhân:** `isCatalogQuestion` (`lib/products.js`) nhận "xin xem các màu" bằng cụm `màu nào`, nên câu "mặc màu nào" bị coi là xin bảng màu. Hàm này còn được dùng làm điều kiện trong chốt chặn "khách không xin xem ảnh thì không gửi" (`unaskedImages`, `blockImages` trong `app/api/webhook/route.js`), nên cùng lúc chốt chặn đó cũng bị tắt.
- **Cách sửa:**
  1. `lib/products.js`: câu có `mặc`, `hợp`, `phù hợp`, `tuổi`, `nên mặc/lấy/chọn` thì cụm `màu/kiểu/loại nào` không còn tính là xin xem ảnh. Các câu hỏi chung vẫn gửi ảnh như cũ: `có mấy màu`, `có những màu nào`, `xin bảng màu`, `shop có màu nào`, `cho xem các mẫu`.
  2. `lib/botPrompt.js` (luật ẢNH TỔNG HỢP): thêm ngoại lệ, khách xin tư vấn màu hợp với bản thân thì chỉ tư vấn bằng chữ (nêu 2-3 màu trong danh sách), không đặt `send_catalog`, không đặt `send_images`.
- **File đổi:** `lib/products.js`, `lib/botPrompt.js`, `tests/contactAsk.test.mjs` (thêm 2 test cho 2 chiều: câu xin tư vấn không gửi ảnh, câu hỏi chung vẫn gửi ảnh).
- **Chưa xác định được:** log chụp bị cắt phần cuối nên không biết lần đó do luật từ khóa hay do AI tự đặt `send_catalog`. Hai chỗ sửa trên chặn được cả hai đường.

### 10.3. Kiểm tra sau khi sửa

- `npm test`: 87 test, 87 qua, 0 lỗi, tính cả mục 10.5 và 10.6 (cần chạy `npm install` trước, vì test mới nạp `lib/products.js` phụ thuộc `@vercel/blob`).
- Chưa chạy thử trên bot thật. Sau khi deploy, theo dõi 2 dòng log: `Khách mới đưa địa chỉ mà AI quên xin SĐT` (chỉ nên xuất hiện khi khách thật sự gửi địa chỉ) và `Gửi ảnh tổng hợp mẫu mã cho khách` (chỉ nên xuất hiện khi khách hỏi chung các màu).
- **Giới hạn đã biết:** nhóm từ "câu xin tư vấn" (`mặc`, `hợp`, `tuổi`...) là danh sách cố định. Nếu có khách xin tư vấn bằng cách nói khác (vd "da em ngăm, màu nào ổn nhất") mà vẫn bị gửi ảnh thì cần thêm từ vào biến `adviceAsk` trong `isCatalogQuestion`.

### 10.4. Vì sao hai lỗi trên không nằm trong các thay đổi 1–4 ở trên

- Các thay đổi 1–4 chỉ đụng `lib/attributes.js` và `app/api/webhook/route.js` (lỗi thiếu size). Không thay đổi nào chạm `looksLikeAddress`, `isCatalogQuestion` hay `contactAsk`.
- Hai lỗi cùng một kiểu: bot ĐOÁN ý khách bằng từ khóa/độ dài câu, và có một chốt chặn tự gửi tin cho khách dựa trên phép đoán đó. Đoán sai ở đầu vào thì chốt chặn đẩy sai ra thành tin gửi khách (`contactAsk` dùng `looksLikeAddress`; chốt chặn "khách không xin ảnh" dùng `isCatalogQuestion`).

### 10.5. Luật nhận địa chỉ CHẶT cho chỗ hệ thống tự gửi câu xin SĐT

- **Vấn đề còn lại sau 10.1:** `looksLikeAddress` vẫn coi mọi tin chat thường từ 6 từ trở lên là địa chỉ, ví dụ "Cho chị xin thêm chút thông tin nữa nha", "Để chị suy nghĩ thêm rồi nhắn lại nha". Nếu khách nhắn các câu này lúc bot đang chờ SĐT thì bot có thể thêm câu xin SĐT sai chỗ.
- **Cách sửa:** thêm hàm `looksLikeAddressStrict` (`lib/replyDedupe.js`) chạy song song với `looksLikeAddress`. Chỉ đổi đúng 1 chỗ gọi: `gaveAddress` của `missingContactAsk` trong `app/api/webhook/route.js` (khoảng dòng 1719). Các chỗ gọi `looksLikeAddress` còn lại (nhặt địa chỉ lưu đơn, chờ khách gửi nốt nửa còn lại, `attributes.js`) giữ nguyên.
- **Luật chặt coi là địa chỉ khi:**
  1. có từ khóa địa chỉ thật (đường, phường, xã, số nhà, tp...), hoặc dạng "12 Nguyễn Trãi Hà Nội"; hoặc
  2. tin KẾT THÚC bằng tên 1 trong 63 tỉnh thành (tên cũ trước sáp nhập, `PROVINCES_63`; 34 tỉnh mới đều mang tên một tỉnh cũ; nhận cả không dấu và cách gọi HCM/TPHCM/Sài Gòn/Hà Nội viết liền), có ít nhất 3 từ nội dung khác (không tính chị/em/ạ/nha/về/gửi...), không phải câu hỏi, không hỏi phí/thời gian ship, không có từ về sản phẩm (cái, màu, size, kg...). Đuôi "ạ/nha/nhé/Việt Nam" được bỏ qua.
  3. Tỉnh có tên trùng tên người (Thanh Hóa, Hải Dương, Khánh Hòa, Thái Bình, Hà Giang, Hòa Bình, Quảng Ninh, Vĩnh Phúc, Bình Dương, Phú Thọ, Hà Nam, Huế, Phú Yên, Nam Định) phải kèm số hoặc dấu phẩy/chấm phẩy mới tính, để "Nguyễn Thị Thanh Hoa" không bị đọc thành địa chỉ.
- **File đổi:** `lib/replyDedupe.js`, `app/api/webhook/route.js`, `tests/contactAsk.test.mjs` (3 test mới: đủ 63 tỉnh; 14 câu KHÔNG phải địa chỉ; 11 địa chỉ thật vẫn nhận ra).
- **Cái được/mất:** câu chat thường không còn kéo theo câu xin SĐT sai chỗ. Đổi lại, địa chỉ viết trơn không có từ khóa và không kết thúc bằng tên tỉnh (vd "Cầu Giấy Hà Nội") sẽ không được lưới an toàn này nhận; lúc đó chỉ còn trông vào AI tự xin nốt SĐT (các chỗ dùng luật lỏng vẫn nhận được).
- **Giới hạn đã biết:** câu kiểu "Chị đang ở nhà Hà Nội" đã được loại nhờ bộ từ bỏ qua (`ADDR_STOP`), nhưng một câu chat dài có đủ 3 từ nội dung rồi kết thúc bằng tên tỉnh vẫn có thể lọt. Nếu gặp ca thật, thêm từ vào `ADDR_STOP` hoặc `SHIP_Q_RE`.

### 10.6. Chỗ LƯU địa chỉ vào đơn cũng dùng luật chặt

- **Vấn đề:** `pickAddressFromTexts` lấy địa chỉ từ tin khách khi AI quên điền `customer_info.address` (chỉ chạy sau khi shop vừa xin SĐT/địa chỉ). Hàm này dùng `looksLikeAddress` (luật lỏng) nên theo code, câu chat thường từ 6 từ trở lên như "Để chị suy nghĩ thêm rồi nhắn lại nha" có thể bị lưu thành địa chỉ giao hàng của khách và đi thẳng vào đơn. Đây là kết luận từ đọc code và chạy hàm riêng lẻ, chưa thử trên bot thật.
- **Cách sửa:** chuyển hàm ra file mới `lib/pickAddress.js` (để chạy test được; file route của Next không export được hàm phụ) và đổi sang `looksLikeAddressStrict`. `webhook/route.js` chỉ import lại hàm này.
- **Nguyên tắc:** AI điền `customer_info.address` là nguồn chính (đã được đối chiếu với tin khách thật trong `verifyCustomerInfo`). Luật chặt chỉ là lưới dự phòng khi AI không điền.
- **Cái mất:** địa chỉ viết trơn, không từ khóa và không kết thúc bằng tên tỉnh (vd "Cầu Giấy Hà Nội"), sẽ không tự lưu được nếu AI không điền.
- **File đổi:** `lib/pickAddress.js` (mới), `app/api/webhook/route.js`, `tests/contactAsk.test.mjs` (thêm 2 test: câu chat thường không bị lưu thành địa chỉ; địa chỉ thật được lấy, bỏ SĐT, bỏ qua câu dặn dò).
- **Chưa đổi (còn luật lỏng):**
  - `contactHalfOnly` (khoảng dòng 113–135 của `route.js`, quyết định chờ khách gửi nốt nửa còn lại). Đoán sai ở đây chỉ làm bot chờ thêm `PAIR_WAIT_MS` trước khi trả lời, không gửi sai nội dung.
  - `gaveContact` trong `isComplexTurn` (khoảng dòng 1205) và `attributes.js` dòng 477. Chưa kiểm tra kỹ hậu quả nên chưa đổi.
  - Nếu thấy bot trả lời chậm bất thường sau khi shop xin SĐT/địa chỉ mà khách nhắn câu chat thường, thì đây là chỗ cần xem trước.

### 10.7. Cách áp dụng

Chép vào repo rồi push lên GitHub để Vercel deploy (giữ đúng đường dẫn): `lib/replyDedupe.js`, `lib/products.js`, `lib/botPrompt.js`, `lib/pickAddress.js` (file MỚI), `app/api/webhook/route.js`, `tests/contactAsk.test.mjs`, `docs/LICH_SU_SUA_LOI_BOT.md`.

## 11. Hai lỗi sửa thêm trong `lib/attributes.js` (cùng ngày 27/10/2026)

### 11.1. Báo đơn thiếu chiều dài váy dù bot đã tư vấn "dài 92cm"

- **Hiện tượng:** khách đưa chiều cao (1m62), bot tư vấn "mặc chân váy dài 92cm là vừa đẹp". Đến lúc khách gửi SĐT, tin báo đơn chỉ có `Màu trắng, size L, SL:1`, thiếu chiều dài. Log: `Thuộc tính: Size=chosen(L) | Chiều dài váy=measured | màu=chosen(Trắng)`, kèm `Chưa tư vấn giá trị cho: Chiều dài váy → nhờ AI viết lại`.
- **Nguyên nhân (đã tái hiện bằng cách chạy lại từng tin của hội thoại thật):** lời tư vấn (`proposed`) bị hai tin của khách làm mất, dù cả hai KHÔNG phải từ chối:
  1. `Nặng 55-56 gì đó lâu ko cân lại` ("ko cân lại" = lâu chưa cân)
  2. `Cho kiểm tra hàng trước khi thanh toán ko sop` ("ko sop" = "không shop", trợ từ hỏi)
  Nhánh từ chối chung chung trong `attributeStatus` coi mọi tin có chữ `ko/k/không/chưa/thôi/khác/đổi` mà không nhắc tới thuộc tính nào là từ chối, rồi hủy MỌI lời tư vấn đang chờ (biến `NEGATE`).
- **Cách sửa:** thay `NEGATE` bằng `refusesAdvice(text)`. Chỉ coi là từ chối thật khi:
  - tin chỉ là lời từ chối đơn thuần (`BARE_NO`: "không", "ko", "thôi", "chưa", "sai"...), hoặc
  - có cụm từ chối rõ (`REFUSAL_RE`: "không lấy / không vừa / không hợp / chưa ưng / không chọn ..."), hoặc
  - có tín hiệu đổi ý (`CHANGE_RE`: "đổi", "dài hơn", "ngắn hơn", "khác"), hoặc có chữ "thôi".
  Chữ "ko/k/chưa" đứng một mình trong câu khác (`lâu ko cân lại`, `ko sop`, `chưa cần gấp`) không còn bị tính là từ chối.
- **Sửa kèm theo:**
  - Nhận câu hỏi nghi ngờ kết thúc bằng "không em / không ạ / ko nha..." là câu hỏi (trước đây chỉ nhận vài trợ từ ngắn), để "mặc vậy ổn không em" không bị coi là đồng ý ngầm. Trước khi sửa `NEGATE`, những câu này được giữ lại nhờ vô tình bị `NEGATE` chặn.
  - Khách nhắn đúng chữ "không" / "thôi" thì hủy lời tư vấn (trước đây chữ "không" đứng một mình bị coi là câu hỏi nên không hủy được).
- **Test:** nhóm 9 trong `tests/scenarios.test.mjs` (dựng lại đúng hội thoại thật, kiểm tra từng tin không làm mất lời tư vấn, 6 câu "ko/chưa" không phải từ chối, 10 câu từ chối thật).

### 11.2. Báo đơn không nhận màu "cam" (sản phẩm có màu "Cam Đất")

- **Hiện tượng:** khách nhắn `Màu cam`, bot trả lời "em lấy chân váy màu cam nha chị", nhưng tin báo đơn chỉ có `size L, dài 75cm, SL:1`, thiếu màu.
- **Nguyên nhân:** màu trong sản phẩm tên là `Cam Đất` (2 từ). Hàm `matchValues` chỉ khớp khi khách gõ đủ "cam đất"; gọi tắt "màu cam" không khớp nên `Màu=missing`.
- **Cách sửa:** thêm hàm `headAlias` và khớp theo TỪ ĐẦU của giá trị nhiều từ ("màu cam", "lấy cam", "chọn cam" → Cam Đất). Điều kiện an toàn:
  - chỉ khi từ đầu là duy nhất trong các giá trị (nhiều màu "Xanh lá", "Xanh dương" thì không đoán);
  - từ đầu từ 3 chữ trở lên và phải có chữ báo hiệu đứng trước (màu, lấy, chọn, đổi, thêm, mua, đặt); nhắn trơn "cam" chỉ nhận khi shop vừa hỏi màu;
  - từ đầu 2 chữ có dấu ("Đỏ đô" → "màu đỏ") chỉ nhận khi khách gõ ĐÚNG có dấu "đỏ", để "lấy đồ", "để em đo" không bị đọc thành màu đỏ;
  - các chữ dễ nhầm vẫn bị che: "cảm ơn", "cam kết", "cam on".
  `colorQtys` cũng đọc được số lượng theo tên gọi tắt ("2 cam 1 trắng").
- **Giới hạn đã biết:** gọi tắt bằng chữ KHÔNG dấu cho từ đầu 2 chữ (vd "mau do" cho "Đỏ đô") chưa được nhận, vì trùng với "do/đo/đồ". Khách gõ kiểu đó thì chỉ còn trông vào bước đối chiếu tin AI (`reconcileWithReply`, thay đổi 2) hoặc AI tự xin lại màu.
- **Test:** nhóm 10 trong `tests/scenarios.test.mjs`.

### 11.3. Kiểm tra

- `npm test`: 98 test, 98 qua, 0 lỗi (cần `npm install` trước vì `contactAsk.test.mjs` nạp `@vercel/blob` và `@neondatabase/serverless`).
- Chưa chạy thử trên bot thật. Sau khi deploy, nếu thấy đơn thiếu màu/size/chiều dài, lấy dòng log `Thuộc tính: ...` kèm tin khách để biết bộ nhận diện bỏ sót ở đâu.

## 12. Tính năng mới: chốt đơn xong thì tự tắt bot với khách đó

- **Yêu cầu của chủ shop:** khi bot chat tới câu cuối "Đơn hàng giao trong khoảng từ 3-4 ngày chị để ý điện thoại giúp em nha." thì tắt bot với khách đó luôn (các tin khách nhắn sau đó như "Sipbo giao kiểm tra hàng nếu ko như ý..." do chủ shop tự trả lời).
- **Cách làm (dùng công tắc tắt bot theo từng khách đã có sẵn: cột `conversations.bot_off`, hàm `setConversationBotOff` trong `lib/conversations.js`):**
  1. `lib/priceLadder.js`: thêm `isOrderClosingMessage(text)`. Chỉ nhận ĐÚNG cấu trúc câu mà `buildOrderMessages` sinh ra (`Đơn hàng giao trong khoảng từ X-Y ngày <xưng hô> để ý điện thoại giúp <xưng hô> nha.`, hoặc `... khoảng N ngày ...`). Câu do AI tự viết kiểu "ship khoảng 3-4 ngày" khi khách hỏi giao hàng KHÔNG bị nhận nhầm.
  2. `app/api/webhook/route.js`, trong `sendTexts`: sau khi `sendMessage` gửi thành công từng tin, nếu tin đó là BẢNG ĐƠN (`looksLikeOrderBlock`, có dòng SĐT) thì đánh dấu `orderBlockSent`; chỉ khi bảng đơn đã gửi rồi mà tin sau đó là câu chốt thì mới đánh dấu `closingSent` (thứ tự bắt buộc: lên đơn trước, câu giao hàng sau); hết vòng gửi thì gọi `setConversationBotOff(senderId, true)` và ghi log `Đã gửi câu chốt đơn → tắt bot với khách này.`. Nếu khách nhắn thêm khiến câu chốt không được gửi thì không tắt.
  3. Công tắc tính năng: `offAfterOrder` trong cài đặt (`/api/settings`), mặc định BẬT (chỉ tắt khi giá trị là `false`). Ô tích nằm trong `app/admin/products/page.js`, mục "Thông tin & quy tắc của shop cho bot", dòng "Chốt đơn xong thì tự tắt bot với khách đó".
- **Khi bot đã tắt với một khách:** webhook vẫn LƯU tin khách nhắn và vẫn ghi/cập nhật đơn (`wantOrderSync`, `syncAutoOrder`), chỉ không trả lời; tin nhắn bồi (`nudge`) cũng bỏ qua khách này (`lib/nudge.js` lọc `bot_off`). Muốn bot trả lời lại thì gạt nút cạnh tên khách trong khung chat (nút có sẵn).
- **Khi nào KHÔNG tắt:** (a) shop chưa ghi thời gian giao hàng (vd "Giao hàng 3-4 ngày") trong ô thông tin shop thì hệ thống không sinh câu chốt, nên bot không tự tắt; (b) đơn chỉ được cập nhật (khách đổi màu, địa chỉ...) thì không gửi lại câu chốt nên không tắt lần nữa; (c) công tắc `offAfterOrder` đang tắt.
- **Hệ quả cần biết:** sau khi tắt, nếu khách nhắn muốn đổi/thêm hàng thì bot không trả lời, chủ shop phải vào xem. Khách quay lại mua đơn MỚI sau vài tuần cũng không được bot trả lời cho tới khi chủ shop gạt bật lại nút của khách đó. Hệ thống chưa tự bật lại bot sau một khoảng thời gian.
- **Test:** `tests/orderClose.test.mjs` (8 test: câu chốt được nhận diện, 1 mốc ngày và cách xưng hô khác, thiếu thời gian giao hàng thì không có câu chốt, đơn chỉ cập nhật thì không chốt lại, 9 câu không phải câu chốt, kiểm tra webhook chỉ tắt sau khi gửi thành công và tôn trọng `offAfterOrder`). `npm test`: 106 test, 106 qua.
- **Chưa kiểm tra trên bot thật:** phần gọi `setConversationBotOff` trong webhook mới được kiểm bằng đọc code và test cấu trúc, chưa chạy với Facebook và Neon thật. Sau khi deploy, theo dõi log `Đã gửi câu chốt đơn → tắt bot với khách này.` và xem nút gạt cạnh tên khách có chuyển sang tắt không.

## 13. Lỗi bot gửi cả "Bước phân tích tình huống" cho khách (28/10/2026)

- Hiện tượng: khách nhắn "Can nang 61 kg chieu cao 145" → bot gửi nguyên đoạn "ক্ষমতার / Bước phân tích tình huống: ... Tin nhắn: 1. ... 2. ..." (kèm 1 chữ Bengali lạ ở đầu) thay vì 2 tin ngắn.
- Nguyên nhân: AI không trả JSON (lần thử 2 trong `generateReply` tắt `responseMimeType`, hoặc AI dự phòng Groq) mà viết chữ thường theo đúng tiêu đề "PHÂN TÍCH TÌNH HUỐNG..." trong prompt. `parseModelJson` ra null → `salvageMessages` coi là "chữ bình thường" → gửi cả đoạn cho khách.
- Cách sửa:
  - `lib/replyGuard.js` (mới): gỡ chữ lạ (Bengali, Thái, Hindi, Hán...), nhận ra phần phân tích bị lộ và chỉ lấy phần sau "Tin nhắn:" (tối đa 2 tin); không có phần đó thì bỏ hết để hệ thống gọi AI lại.
  - `app/api/webhook/route.js`: `salvageMessages` và 3 chỗ lọc tin đầu ra đều đi qua `cleanReplyList`. `lib/botPlayground.js` (trang Dạy bot) cũng vậy.
  - `lib/botPrompt.js`: đổi tiêu đề thành "GHI CHÚ NỘI BỘ...", thêm luật cấm viết "Bước phân tích", "Tin nhắn:"... và cấm chèn chữ ngôn ngữ khác.
- Test: `tests/replyGuard.test.mjs` (có ca lỗi thật y như ảnh).

## 14. Gemini vẫn timeout dù đã có nhánh dự phòng song song (31/10/2026)

- Hiện tượng (log Vercel 18:38): `gemini-3.5-flash` treo ở CẢ 3 key (key env, 6, 7) cùng lúc, tới 20-22s mới ngắt, rồi sang Groq. Groq `gpt-oss-120b` báo 429 (hết 8000 token/phút) nên rơi xuống `gpt-oss-20b` viết câu trả lời → khách chờ ~22s và nhận câu trả lời của AI yếu hơn. Cùng lúc đó các lần gọi khác vẫn OK trong 1.5-3.5s (`gemini-3.5-flash-lite` 1.5s, `gemini-3.5-flash` 1.7-3.5s).
- Nguyên nhân: treo là lỗi phía Google trên CẢ MODEL ở thời điểm đó, đổi key không giúp (key nằm ở 5 project khác nhau mà vẫn treo cùng lúc). Nhưng nhánh dự phòng song song trong `lib/gemini.js` (làm ngày 26/10) xếp hàng theo thứ tự "cùng model, key kế tiếp" trước, "model kế tiếp" sau (hàm sắp `queue.sort`), nên 3 lần gọi đều đâm vào đúng model đang treo.
- Cách sửa (chỉ `lib/gemini.js`): khi gọi nhánh dự phòng, `pickNext(true)` ưu tiên (model, key) có MODEL chưa đang chạy; không còn model nào khác thì mới dùng key khác của cùng model. Ghi log "timeout sau Ns" đúng số giây thật của lần gọi đó (trước đây luôn in 20s dù lần gọi muộn bị cắt sớm hơn do giới hạn tổng 22s).
- Không đổi: thời gian chờ mỗi lần gọi (20s), thời gian chờ trước khi gọi nhánh dự phòng (5s), tổng 22s trước khi sang Groq, cầu dao 30s, thứ tự model.
- Test: `tests/hedgeModel.test.mjs` (3 test: model đầu treo → nhánh dự phòng sang model khác thắng ngay; chỉ có 1 model → dùng key khác; model đầu nhanh → không gọi thêm). Test 1 lỗi trên bản cũ, qua trên bản mới.
- Giới hạn: nếu CẢ HAI model đều treo cùng lúc thì vẫn phải chờ tới 22s rồi mới sang Groq. Không có cách nào làm Google hết treo, chỉ giảm thời gian khách phải chờ.
- Ghi chú về bộ test: 10 test hiện lỗi từ TRƯỚC khi sửa — 9 test trong `tests/paidFallback.test.mjs` và `tests/modelPick.test.mjs` nói về tính năng "key Gemini trả phí" (`GOOGLE_PAID_API_KEY`) mà `lib/gemini.js` hiện tại không có; 1 test (`contactAsk.test.mjs`) lỗi chỉ vì chưa chạy `npm install`.

## 15. Khách hẹn "mai gửi địa chỉ / thông tin" mà bot vẫn xin thêm SĐT (01/11/2026)

- Hiện tượng (ảnh chụp chat): bot xin SĐT + địa chỉ, khách trả lời `Mai chị gửi địa chỉ cty nha y`. Bot đáp đúng "dạ vâng ạ, mai chị gửi địa chỉ công ty cho em nhé ạ" nhưng ngay sau đó tự gửi thêm `Em xin thêm số điện thoại nữa nha chị.`
- Nguyên nhân: câu hẹn có chữ "địa chỉ" nên `looksLikeAddressStrict` (lib/replyDedupe.js) coi là khách VỪA ĐƯA địa chỉ. Hậu quả: (1) chốt chặn `missingContactAsk` (lib/contactAsk.js) thấy "có địa chỉ, thiếu SĐT" nên tự thêm câu xin SĐT; (2) lưới an toàn `pickAddressFromTexts` có thể lưu nguyên câu hẹn làm địa chỉ giao hàng; (3) `partialPairTopics` mở khóa cho phép hỏi lại nửa còn lại.
- Cách sửa:
  - `lib/laterStop.js`: thêm `analyzeDefer` nhận ra khách HẸN GỬI SAU ("mai/tối/lát nữa/để sau/khi nào tiện + gửi/đưa/nhắn/ib + địa chỉ/SĐT/thông tin", "chưa có địa chỉ", "mai tư vấn cho chị"), trả về chủ đề được hẹn và phần tin còn lại sau khi bỏ câu hẹn. Không nhầm các câu như "mai gửi hàng cho chị", "ship mai tới không", "chiều dài váy chị gửi em", "mai chị gửi tiền cọc". Thêm `dropAsksForDeferred`: bỏ câu bot xin lại thông tin đã hẹn, giữ câu đáp lời hẹn. `saidLater` (dùng cho tin bồi trong lib/nudge.js) cũng hiểu câu hẹn này nên không nhắn bồi.
  - `app/api/webhook/route.js`: khi khách hẹn gửi sau thì (a) không lưu câu hẹn làm địa chỉ; (b) không chạy `missingContactAsk` và khối tự xin SĐT/địa chỉ sau khi tư vấn xong; (c) không mở khóa hỏi nốt nửa còn lại; (d) bỏ câu AI lỡ xin lại, AI chỉ toàn câu xin thì thay bằng "Dạ vâng ạ, khi nào tiện chị gửi em nhé ạ"; (e) `skipAskClean` = true để câu đáp lời hẹn không bị bộ lọc chống hỏi lặp cắt mất.
  - `lib/botPrompt.js`: thêm luật "KHÁCH HẸN GỬI SAU / TƯ VẤN SAU" vào cả prompt đầy đủ và prompt gọn của Groq.
- Test: `tests/deferInfo.test.mjs` (8 test, có đúng câu trong ảnh). Toàn bộ bộ test: 147 test, 9 lỗi cũ (tính năng key Gemini trả phí) vẫn như trước, không có lỗi mới. `next build` chạy qua.
- Giới hạn: chỉ nhận các cách nói hẹn phổ biến (mai, tối, chiều, lát nữa, sau, khi nào tiện...). Cách nói lạ chưa có trong danh sách thì vẫn như cũ; thêm từ vào `TIME_ALTS` trong `lib/laterStop.js`.

## 16. Khách bị bỏ rơi mà chủ shop không biết (02/11/2026)

- Vấn đề: sau khi chốt đơn bot tự TẮT với khách đó; khách nhắn tiếp ("bao giờ giao", "đổi địa chỉ") thì bot im và không ai báo cho chủ shop. Bot lỗi / chủ shop bận cũng vậy — Telegram chỉ báo lỗi hệ thống, không báo "khách đang chờ".
- Cách sửa (file mới `lib/unanswered.js`):
  - BÁO NGAY qua Telegram khi khách nhắn lúc bot đang tắt với khách đó (cùng khách chỉ báo 1 lần / 5 phút).
  - NHẮC LẠI khi khách nhắn xong quá `UNANSWERED_ALERT_MIN` phút (mặc định 10) mà tin cuối vẫn là của khách; gom nhiều khách vào 1 tin; mỗi tin khách chỉ báo 1 lần (cột mới `conversations.unanswered_alert_at`, tự tạo khi chạy). Chỉ xét khách nhắn trong 22 giờ gần nhất.
  - KHÔNG báo: tin chỉ là "cảm ơn / ok / dạ / emoji", các lần bot CHỦ Ý im lặng (khách lặp lại thông tin đã chốt, tin gửi trùng), giờ nghỉ đêm 23h-6h (sáng 6h báo gộp).
  - Chạy ở 2 chỗ: mỗi lần gọi `/api/nudge/run` (hẹn giờ mỗi phút, cùng cái đang chạy nhắn bồi) và kèm mỗi lần webhook chạy (giới hạn 1 lần / 60 giây). Muốn nhắc đúng giờ cả khi không có khách nào nhắn thêm thì BẮT BUỘC có hẹn giờ gọi `/api/nudge/run` mỗi phút.
  - Câu lệnh lấy khách + đánh dấu "đã báo" là 1 lệnh duy nhất nên 2 lượt chạy cùng lúc không báo trùng; gửi Telegram lỗi thì trả lại trạng thái chưa báo để phút sau thử lại.
- Cần có: `TELEGRAM_BOT_TOKEN` + `TELEGRAM_CHAT_ID` trên Vercel (đã dùng cho báo lỗi). Chưa có thì mọi thứ im lặng.
- Cài đặt (không bắt buộc): `UNANSWERED_ALERT_MIN` (đặt 0 = chỉ báo ngay, không nhắc lại), `UNANSWERED_ALERT=off` để tắt hẳn.
- Test: `tests/unanswered.test.mjs` (6 test: lọc tin cảm ơn/ok, cài đặt, nội dung tin báo). Câu lệnh SQL đã thử trên Postgres thật (PGlite): chọn đúng khách, không báo trùng, trả lại trạng thái khi gửi lỗi.

## 17. Khách chọn 2 màu nhưng đơn chỉ ghi "Màu đen, SL:2" (02/11/2026)

- Hiện tượng (ảnh chụp chat): bot hỏi "Chị lấy chân váy màu nào ạ?", khách trả lời `Chốt chị 2 váy =380 miễn phí ( màu đen và xanh ) Sđt 0974161328 . Hồi cù, Hoàng Sơn...`. Bot lên đơn `Màu đen, size S, dài 75cm, SL:2` (mất màu xanh; lẽ ra `Màu xanh + đen ... SL:2`).
- Dựng lại được lỗi bằng test. Hai nguyên nhân cộng lại (`lib/attributes.js`):
  1. Thuộc tính của sản phẩm tên "Chiều dài váy" có chữ "váy" trùng tên sản phẩm "Chân váy 3 tầng". Câu shop hỏi "chị lấy chân VÁY MÀU nào ạ?" bị hiểu là hỏi cả chiều dài lẫn màu → bot không biết đang hỏi màu, nên không đọc kỹ câu trả lời về màu.
  2. Tin có SĐT/địa chỉ chỉ được đọc phần khách "nói rõ là chọn" và chỉ lấy 2 chữ sau chữ "màu" → "màu đen và xanh" chỉ lấy "đen và", rơi mất "xanh".
- Cách sửa:
  - Từ trong tên thuộc tính nhiều từ mà trùng tên sản phẩm (vd "váy") không còn dùng riêng lẻ để nhận ra thuộc tính (tên đầy đủ "chiều dài váy", từ "chiều", "dài" vẫn nhận). Tên thuộc tính chỉ 1 từ giữ nguyên.
  - Đọc cả danh sách màu sau chữ "màu": "màu đen và xanh", "màu đen + kem", "màu đen, trắng và kem". Sau dấu phẩy chỉ lấy 1 chữ để "màu đen, Lê Hồng Phong" không bị đọc thêm màu Hồng từ tên đường.
- Test: `tests/multiColor.test.mjs` (7 test, có đúng câu trong ảnh). Toàn bộ bộ test: 160 test, 9 lỗi cũ (Gemini trả phí) như trước.
- Chưa xác định: tổng tiền trong đơn đó là 350k trong khi khách ghi 380k. Quy tắc của bot: tổng tiền = mức thấp nhất shop ĐÃ BÁO cho đúng số lượng đó, nên 350k nghĩa là trong chat từng có câu báo 350k cho 2 váy. Nếu không đúng thì cần xem phần chat phía trên và bảng giá của sản phẩm.

## 18. Khách đặt 2 váy KHÁC NHAU mà đơn chỉ ghi 1 váy, 185k (02/11/2026)

- Hiện tượng (ảnh chụp chat): khách nhắn `Cho 1 chân váy màu kem chiêu dài 75cm sai m. 1 váy màu chắng dài 92 cm sai xl`. AI trả lời đúng "đã ghi nhận 2 chân váy gồm 1 kem M 75cm và 1 trắng XL 92cm", nhưng tin báo đơn do hệ thống ghép chỉ có `Màu kem, size M, dài 75cm, SL:1`, tổng 185k (giá 1 váy) thay vì 350k.
- Nguyên nhân (`lib/attributes.js`): (1) khách gõ sai "sai m / sai xl" (thay cho size), "chắng" (thay cho trắng) nên bộ đọc chỉ nhận món đầu; (2) kể cả khi gõ đúng, bộ đọc chỉ gộp thành "màu kem + trắng, size M + XL, dài 75 + 92" — mất việc màu nào đi với size/dài nào; (3) số lượng lấy theo "1 váy" cuối cùng nên ra 1.
- Cách sửa:
  - `fixTypos`: sửa lỗi gõ phổ biến trước khi đọc ("sai/siz/sz + cỡ" → size, "chắng" → trắng, "màu sanh" → xanh). Câu thường như "sai rồi", "em gửi sai size" không bị đổi.
  - `extractItems`/`formatItems`: nhận ra khách liệt kê NHIỀU MÓN, mỗi món bắt đầu bằng số lượng ("1 váy…", "1 chân váy…", "1 cái…", "1 màu…"); tách từng món, đọc màu/size/dài RIÊNG cho từng món. Tin báo đơn ghi mỗi món một dòng: `Màu kem, size M, dài 75cm, SL:1` / `Màu trắng, size XL, dài 92cm, SL:1`; SL = tổng các món; giá theo bảng giá của tổng số lượng (350k); đơn lưu (`lines`) cũng đúng từng món.
  - Chỉ dùng khi chắc chắn: món nào thiếu thông tin mà món khác có, món có 2 giá trị cho 1 mục ("đen hoặc trắng"), hoặc khách nhắn tiếp đổi/thêm/bớt ("đổi cái trắng thành đen", "lấy thêm 1 cái") → bỏ danh sách món, chạy như cũ (như trước khi sửa).
- Test: `tests/multiItem.test.mjs` (9 test, có đúng tin trong ảnh). Toàn bộ: 169 test, 9 lỗi cũ (Gemini trả phí) như trước.
- Giới hạn: khách đổi ý SAU khi đã liệt kê nhiều món thì bot quay về cách gộp cũ (không ghép cặp màu/size) — chủ shop nên kiểm tra tay đơn đó.

## 19. AI + hệ thống cùng đọc đơn, không hỏi lại khách (02/11/2026)

- Yêu cầu của chủ shop: không hỏi khách xác nhận lại đơn, muốn đọc đơn đúng từ 95% trở lên. Trước đây chỉ hệ thống đọc bằng luật nên mỗi kiểu khách nhắn lạ (gõ sai, nhiều món khác nhau...) lại phải thêm luật.
- Cách làm (lib/orderItems.js, lib/orderReading.js):
  1. AI ghi danh sách món trong CÙNG câu trả lời (trường mới `order_items`, không tốn thêm lần gọi AI; cả prompt đầy đủ và prompt gọn của Groq): `[{ "qty": 1, "values": { "Màu": "Kem", "Size": "M", "Chiều dài váy": "75cm" } }]`.
  2. Hệ thống KIỂM từng giá trị AI ghi: phải trùng đúng một giá trị trong danh sách của sản phẩm (không cho "3XL" khớp nhầm "XL", không có "70cm"), và khách phải thật sự nhắc tới (có xét gõ sai 1-2 chữ cái, ch/tr, s/x). Giá trị nào không qua thì bỏ CẢ bản AI (`ai_invalid`).
  3. Đối chiếu với cách đọc bằng luật: giống nhau (`agree`, nếu AI ghi nhiều món thì nhận cách ghép cặp màu/size/dài của AI) | AI đọc được thêm điều luật bỏ sót (`ai_filled`, chỉ ĐIỀN mục còn trống, không ghi đè mục luật đã đọc chắc) | mâu thuẫn (`conflict`) thì dùng bản HỆ THỐNG và báo Telegram "Đơn của ... cần bạn xem" (cùng khách 1 lần / 10 phút, không báo ban đêm) | AI không ghi món (`ai_none`, không tính vào tỉ lệ).
  4. Nhiều món thì danh sách món được lưu (cột mới `conversations.order_items`) để các lượt sau và ĐƠN LƯU dùng đúng từng món; khách nhắn tiếp đổi/thêm/bớt thì không dùng nữa. Tiền và định dạng tin báo đơn vẫn do hệ thống tính.
  5. Mỗi lượt đọc được ghi vào bảng `order_reading_log` (mỗi kết quả khác nhau của cùng khách chỉ ghi 1 lần; SĐT trong chữ khách nhắn bị che). Trang chủ shop xem: `/admin/doc-don` (nút "%" trên thanh trên của trang chat): tỉ lệ hai bên giống nhau, tỉ lệ dùng được, tỉ lệ cần xem, và danh sách các lượt cần xem kèm chữ khách nhắn.
- Đây là tỉ lệ HAI BÊN ĐỌC GIỐNG NHAU, chưa phải tỉ lệ đúng tuyệt đối so với ý khách. Muốn biết tỉ lệ đúng thật cần đối chiếu một số đơn với đơn đúng do chủ shop xác nhận.
- Lỗi AI đọc sai: bản AI chỉ được dùng khi (a) mọi giá trị hợp lệ và có trong chữ khách, (b) và hoặc giống hệ thống hoặc bổ sung chứ không mâu thuẫn. Mọi trường hợp mâu thuẫn dùng bản hệ thống.
- Test: `tests/orderReading.test.mjs` (13 test). Câu lệnh SQL (ghi nhật ký, thống kê, lưu danh sách món) đã thử trên Postgres thật (PGlite). Toàn bộ: 182 test, 9 lỗi cũ (Gemini trả phí) như trước. Chưa thử với AI thật (không gọi được Gemini trong môi trường phát triển) — cần theo dõi trang /admin/doc-don vài ngày đầu.

## 20. Tin báo đơn thiếu chiều dài dù bot đã tư vấn 85cm (03/11/2026)

- Hiện tượng (ảnh chụp chat): shop tư vấn "chị cao 1m54 mặc chân váy dài 85cm", khách trả lời `Xem hàng ko ưng ko nhận nha sop` rồi `Màu đen đi`. Tin báo đơn chỉ có `Màu đen, size L, SL:1`, thiếu chiều dài.
- Nguyên nhân (`lib/attributes.js`): câu "xem hàng ko ưng ko nhận" (xem hàng, không ưng thì không nhận) có chữ "ko ưng" và "ko nhận" nên `refusesAdvice` hiểu là khách TỪ CHỐI lời tư vấn gần nhất (85cm) → bỏ giá trị chiều dài. Size L không mất vì đã được chốt trước đó.
- Cách sửa: câu nói về xem/kiểm tra/nhận/hoàn/đổi trả hàng, COD ("cho kiểm tra hàng", "ko ưng thì hoàn hàng", "ship cod", "nhận hàng rồi mới thanh toán") KHÔNG còn bị coi là từ chối lời tư vấn. Từ chối thật ("không lấy dài 85cm", "thôi", "đổi dài 92cm", "dài hơn chút") vẫn hoạt động.
- Kèm theo, phần AI+hệ thống (mục 19): giá trị AI ghi được chấp nhận nếu có trong chữ khách HOẶC trong lời tư vấn của shop ở 10 tin gần nhất (size/chiều dài thường do shop tư vấn theo số đo rồi khách đồng ý ngầm). Trước đó mục 19 sẽ coi "85cm" là khách không nhắc → bỏ bản AI. Giờ nếu luật bỏ sót một giá trị shop đã tư vấn mà AI ghi đúng thì AI điền vào (ai_filled).
- Test: `tests/deliveryTalk.test.mjs` (4 test, có đúng cuộc chat trong ảnh). Toàn bộ: 186 test, 9 lỗi cũ (Gemini trả phí) như trước.

