# Trả lời khách theo ngữ cảnh

Webhook hiện gọi AI cho mỗi tin mới khi bật trả lời tự động, thay cho bộ giới thiệu cố định rồi dừng.

## Cách hoạt động

- Đọc tối đa 60 tin gần nhất của đúng hội thoại, theo thứ tự thời gian.
- Ưu tiên tên/mã sản phẩm khách nhắc rõ; nếu chưa nhắc thì dùng sản phẩm đã gắn với hội thoại/Ads. Chỉ tự chọn khi còn đúng một sản phẩm đang bán. Nhiều mẫu chưa xác định thì hỏi lại.
- Dùng giá, màu, chất liệu và bảng size từ database. Chưa có dữ liệu tồn kho/ưu đãi/vận chuyển thì yêu cầu AI không tự khẳng định.
- AI trả về ý định, nội dung trả lời và danh sách media. Server xác thực schema, giới hạn 2.000 ký tự, kiểm tra ID ảnh/video thuộc sản phẩm. Chỉ gửi media với ý định xem ảnh/video.
- Không có chức năng tạo đơn: AI chỉ ghi nhận thông tin qua hội thoại, không xác nhận đã tạo đơn.
- Ảnh khách gửi hiện được nhận như thông báo có tệp; chưa có phân tích hình ảnh.

## Kiểm tra trên web

Chọn khách → **Cấu hình trợ lý AI** → **Thử cách AI trả lời**. Nhập một tin ví dụ và bấm **Thử phản hồi**. Dùng hướng dẫn đã lưu; trả về ý định, sản phẩm, nội dung và số media dự kiến. Không gửi Messenger, không sửa hội thoại hay sản phẩm của khách.

API thử: `POST /api/webhook?action=preview_reply`, body `{ "message": "chị 53kg mặc size gì", "sender_id": "PSID đã có" }`. Bỏ `sender_id` để thử không có lịch sử khách.

## Cấu hình triển khai

Giữ các biến hiện tại: `OPENAI_API_KEY`, `OPENAI_MODEL`, `PAGE_ACCESS_TOKEN`, `SUPABASE_URL`, `SUPABASE_SECRET_KEY`. Không đổi model đã cấu hình. Bật công tắc Trợ lý tự động trên web sau khi kiểm tra phản hồi phù hợp. Không cần thêm migration hoặc Serverless Function.

## Tin trùng, lỗi và giới hạn

Sử dụng `app_settings` hiện có để khóa từng khách và lưu checkpoint theo Facebook message ID. Sự kiện đã hoàn tất được bỏ qua khi Meta gửi lại. Khi khách đang được xử lý hoặc API lỗi, webhook trả HTTP 503 để Meta có thể thử lại. Kế hoạch và bước gửi thành công được lưu để retry tiếp phần còn lại; không gọi lại AI cho kế hoạch đã tạo.

Đây là xử lý có retry, không bảo đảm exactly-once: nếu Facebook đã nhận tin nhưng kết nối bị ngắt trước khi server ghi checkpoint thì vẫn có khả năng gửi lặp. Sự kiện thiếu cả message ID và timestamp không thể chống trùng ổn định. Khóa hết hạn sau 5 phút nếu tiến trình bị dừng. Chưa có worker/queue riêng; thời gian thực thi vẫn phụ thuộc giới hạn của host. Các khóa `ai_turn:*` được giữ lại để chống trùng và cần chính sách dọn dẹp khi lưu lượng tăng.

## Xác minh

Chạy `npm test`. Kiểm thử mô phỏng kiểm tra lịch sử, chọn đúng mẫu, trả lời tiếp sau lời chào cũ, allowlist media, output lỗi, tắt bot, retry, trùng message ID và chế độ xem trước. Các kiểm thử này xác minh luồng tích hợp, không đo chất lượng hiểu tiếng Việt của model thực tế.

API phản hồi theo [OpenAI Structured Outputs](https://developers.openai.com/api/docs/guides/structured-outputs).
