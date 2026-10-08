# Kịch bản giới thiệu và bàn giao cho nhân viên

Messenger chỉ chạy kịch bản: **hình sản phẩm → video nếu có → giá/ưu đãi → xin cân nặng và chiều cao**. Bot không gọi AI để tư vấn size và không tự tạo đơn. Biến `MESSENGER_MODE` cũ không thay đổi luồng này, kể cả khi đặt `contextual_ai`.

## Chọn sản phẩm theo quảng cáo mới nhất

- Đọc Ads ID từ referral trong event, message, postback hoặc optin; lưu vào hội thoại kể cả sự kiện referral không có tin nhắn.
- Dùng timestamp của sự kiện để tránh referral cũ đến muộn ghi đè Ads mới. Khi Meta không gửi timestamp, dùng thứ tự tiếp nhận.
- Khi có Ads ID, chỉ chọn sản phẩm đang bán đã gắn với Ads đó trong `ad_product_mappings`. Tên/mã mẫu cũ trong tin khách không ghi đè sản phẩm của Ads mới nhất.
- Ads mới chưa gắn mẫu: bot không gửi tin và không dùng mẫu của Ads trước. Sau khi thêm mapping, tin tiếp theo sẽ tra lại mapping.
- Chưa có Ads ID hoặc mapping hợp lệ thì Messenger giữ im lặng; không đoán mẫu dù chỉ có một sản phẩm.

## Bộ giới thiệu

Gửi tối đa bốn ảnh đã có Facebook attachment ID, ưu tiên ảnh chính; sau đó tối đa một video nếu có Facebook attachment ID. Tiếp theo là giá `sale_price` khi thấp hơn `price`, giá gốc và chính sách vận chuyển đã lưu của đúng mẫu. Không tự thêm freeship hay thời hạn ưu đãi. Riêng mẫu SKU `MANGO-HQ-HONG-TIM-279` (Ads `52590312182503`) dùng nguyên văn lời ưu đãi shop đã yêu cầu, gồm giá 279K, freeship, giá 450K ngày mai và đoạn giới thiệu chất liệu. Cuối cùng xin chiều cao và cân nặng.

## Trạng thái theo UID khách + sản phẩm

Luồng chính: webhook nhận tin → lấy Ads ID mới nhất của đúng khách/hội thoại → mapping ra sản phẩm → đọc trạng thái `product_intro:<UID khách>:<ID sản phẩm>` trong `app_settings`.

- Chưa có trạng thái: gửi bộ giới thiệu, lưu tiến trình từng phần. Gửi đủ bộ mới đánh dấu `introduced`.
- Đã `introduced`: bot im lặng để Human tư vấn tiếp. Trạng thái không hết hạn sau vài giờ và không phụ thuộc Ads ID. Hai Ads cùng mẫu không tạo hai bộ giới thiệu.
- Cùng khách chuyển từ mẫu A sang mẫu B: B có trạng thái riêng. Nếu quay lại mẫu A đã giới thiệu thì không gửi lại A.
- Hai khách cùng quan tâm một mẫu: mỗi khách có trạng thái riêng, không ảnh hưởng nhau.
- Gửi lỗi giữa chừng: trạng thái `sending`, tiếp tục những bước chưa gửi. Danh sách hành động và số bước đã gửi được lưu bền, không dùng bộ nhớ process.

Với khách cũ chưa có trạng thái mới, server đọc lịch sử đã lưu một lần để nhận biết bộ giới thiệu đã hoàn tất hoặc tiếp tục phần còn thiếu. Sau đó dùng trạng thái riêng theo UID + ID sản phẩm. Đổi giá, tên hoặc media không tự mở lại trạng thái đã giới thiệu.

Khách gửi cân nặng/chiều cao hoặc thông tin nhận hàng trước khi gửi hết bộ giới thiệu cũng được nhường cho nhân viên: trạng thái `human_handoff` **của đúng khách + sản phẩm**. Số đo của mẫu A và khóa bàn giao toàn khách cũ không chặn giới thiệu mẫu B. Sau khi đã giới thiệu, bot im lặng ngay, không cần đợi khách trả lời số đo. Tin khách vẫn được lưu và hiện trong hộp thư.

## Human reset

Chọn khách → **Cấu hình trợ lý AI** → nhập mã quản trị dùng chung với trang Đơn hàng → **Reset mẫu đang tư vấn cho khách đã chọn**. Reset chỉ mở lại trạng thái của khách và sản phẩm gắn với Ads mới nhất. Không ảnh hưởng khách khác hoặc sản phẩm khác, không gửi Messenger ngay. Tin mới tiếp theo sẽ nhận đủ bộ giới thiệu, bỏ qua dấu đã gửi trước lần reset.

API: `POST /api/webhook?action=reset_introduction`, header `Authorization: Bearer <ORDERS_ADMIN_TOKEN>`, body `{ "sender_id": "PSID", "product_id": 123 }`. `product_id` tùy chọn giúp phát hiện mẫu đã đổi trước khi reset. Mã quản trị phải có ít nhất 24 ký tự. Reset dùng cùng khóa theo khách với webhook, nên không chạy đồng thời với lượt đang gửi; retry của lượt cũ không mở lại bộ mới sau reset.

## Khung thử phản hồi

**Cấu hình trợ lý AI → Thử kịch bản giới thiệu** chạy đúng kịch bản Messenger, không gọi AI. Kết quả thể hiện số ảnh/video, nội dung báo giá/xin số đo, hoặc bot không gửi tin để nhân viên xử lý. Các trường hướng dẫn AI và nút kiểm tra kết nối AI còn được giữ cho công cụ kiểm tra; chúng không điều khiển kịch bản Messenger.

`POST /api/webhook?action=preview_reply`, body `{ "message": "chị 53kg", "sender_id": "PSID đã có" }`. Bỏ `sender_id` để thử không có lịch sử khách. Khung thử nhớ tối đa 10 lượt trong phiên trang, không gửi Messenger, không ghi tin hoặc trạng thái bàn giao vào database.

## Retry và cấu hình

Giữ `PAGE_ACCESS_TOKEN`, `SUPABASE_URL`, `SUPABASE_SECRET_KEY` và cấu hình xác minh webhook hiện có. Không cần migration hoặc Serverless Function mới: khóa khách, trạng thái khách + sản phẩm và thời điểm referral dùng bảng `app_settings` sẵn có.

Sự kiện được khóa theo khách và chống trùng theo Facebook message ID. Lỗi đọc/lưu dữ liệu hoặc gửi tin trả HTTP 503 để Meta thử lại. Retry tiếp các phần chưa gửi, không tiếp tục kế hoạch hội thoại AI cũ. Vẫn có khả năng gửi lặp nếu Facebook đã nhận tin nhưng tiến trình dừng trước khi lưu dấu gửi thành công; không bảo đảm exactly-once.

Chạy `npm test` để kiểm tra giới thiệu, chọn Ads mới, referral đến muộn, Ads chưa mapping, trạng thái theo khách + sản phẩm, quick reply sau nhiều giờ, Human reset, retry, tin trùng, tắt bot và preview. Các kiểm thử webhook dùng API mô phỏng, không gửi tin cho khách thật.
