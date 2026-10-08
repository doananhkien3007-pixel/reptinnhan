# Trả lời khách theo ngữ cảnh

Khi `MESSENGER_MODE=contextual_ai`, webhook gọi AI cho mỗi tin mới khi bật trả lời tự động. Mặc định là `introduction_only`: gửi bộ giới thiệu một lần, nhưng ưu tiên xử lý số đo/thông tin nhận hàng trước kịch bản này.

Trong chế độ `introduction_only`, tin có số đo hoặc thông tin nhận hàng không tự kích hoạt video, ảnh hay quảng cáo. Server đọc số đo trong tin mới và tối đa 60 tin lịch sử, chỉ lấy từ khách, ưu tiên số đo sửa mới nhất; hỗ trợ `m59`, `1m59`, `1.59m`, `159cm`, `nang 70` và `70kg`. Đã có cân nặng thì đối chiếu bảng size sản phẩm; ngoài bảng/thiếu bảng thì nói rõ, không chọn size gần nhất. Đã có chiều cao thì không hỏi lại chiều cao. Thông tin nhận hàng chỉ được ghi nhận, không tự coi là chốt đơn; chế độ này không gọi AI hay tự tạo đơn. Các nhu cầu hội thoại khác cần `contextual_ai` để tư vấn tiếp. Bộ giới thiệu khi cần gửi phần còn thiếu cũng bỏ câu hỏi số đo khách đã cung cấp.

## Cách hoạt động

- Đọc tối đa 60 tin gần nhất của đúng hội thoại, theo thứ tự thời gian.
- Ưu tiên tên/mã sản phẩm khách nhắc rõ; nếu chưa nhắc thì dùng sản phẩm đã gắn với hội thoại/Ads. Chỉ tự chọn khi còn đúng một sản phẩm đang bán. Nhiều mẫu chưa xác định thì hỏi lại.
- Dùng giá, màu, chất liệu và bảng size từ database. Chưa có dữ liệu tồn kho/ưu đãi/vận chuyển thì yêu cầu AI không tự khẳng định.
- AI trả về ý định, nội dung trả lời và danh sách media. Server xác thực schema, giới hạn 2.000 ký tự, kiểm tra ID ảnh/video thuộc sản phẩm. Chỉ gửi media với ý định xem ảnh/video.
- Luồng tự tạo đơn mặc định xử lý cả khi tắt gửi trả lời: AI vẫn gom dữ liệu đã lưu trong Supabase nhưng không nhắn khách. Đặt `AUTO_ORDERS_ENABLED=false` để tạm dừng hoàn toàn; xem [Quản lý đơn](order-management.md).
- Ảnh khách gửi hiện được nhận như thông báo có tệp; chưa có phân tích hình ảnh.

## Kiểm tra trên web

Chọn khách → **Cấu hình trợ lý AI** → **Thử cách AI trả lời**. Nhập một tin ví dụ và bấm **Thử phản hồi**. Dùng hướng dẫn đã lưu; trả về ý định, sản phẩm, nội dung và số media dự kiến. Không gửi Messenger, không sửa hội thoại hay sản phẩm của khách.

Khung thử nhớ tối đa 10 lượt trong phiên trang hiện tại, bao gồm số đo, lựa chọn và sản phẩm đã nhắc. Bấm **Bắt đầu lại**, chuyển khách hoặc tải lại trang sẽ xóa các lượt thử. Lịch sử thử chỉ dùng làm ngữ cảnh và không ghi vào database.

Bot được hướng dẫn đưa đề xuất cụ thể, không tự thêm câu “chị có muốn xem hình/tư vấn thêm không”. Chỉ hỏi một thông tin thực sự còn thiếu để giải quyết nhu cầu hiện tại, không xin thông tin đặt hàng khi khách mới hỏi size. Lớp lọc cuối loại câu mời chung chung hoặc câu hỏi cuối lặp nguyên văn trong các phản hồi gần đây khi vẫn còn phần trả lời có nghĩa. Lớp lọc này không bảo đảm phát hiện mọi cách diễn đạt lặp; chất lượng tư vấn vẫn cần kiểm tra với model thật.

API thử: `POST /api/webhook?action=preview_reply`, body `{ "message": "chị 53kg mặc size gì", "sender_id": "PSID đã có" }`. Bỏ `sender_id` để thử không có lịch sử khách.

## Cấu hình triển khai

Giữ các biến hiện tại: `OPENAI_API_KEY`, `OPENAI_MODEL`, `PAGE_ACCESS_TOKEN`, `SUPABASE_URL`, `SUPABASE_SECRET_KEY`. Không đổi model đã cấu hình. Bật công tắc Trợ lý tự động trên web sau khi kiểm tra phản hồi phù hợp. Luồng tư vấn không cần thêm migration; tính năng tự tạo đơn cần schema và cấu hình trong [Quản lý đơn](order-management.md). Không thêm Serverless Function.

## Tin trùng, lỗi và giới hạn

Sử dụng `app_settings` hiện có để khóa từng khách và lưu checkpoint theo Facebook message ID. Sự kiện đã hoàn tất được bỏ qua khi Meta gửi lại. Khi khách đang được xử lý hoặc API lỗi, webhook trả HTTP 503 để Meta có thể thử lại. Kế hoạch và bước gửi thành công được lưu để retry tiếp phần còn lại; không gọi lại AI cho kế hoạch đã tạo.

Đây là xử lý có retry, không bảo đảm exactly-once: nếu Facebook đã nhận tin nhưng kết nối bị ngắt trước khi server ghi checkpoint thì vẫn có khả năng gửi lặp. Sự kiện thiếu cả message ID và timestamp không thể chống trùng ổn định. Khóa hết hạn sau 5 phút nếu tiến trình bị dừng. Chưa có worker/queue riêng; thời gian thực thi vẫn phụ thuộc giới hạn của host. Các khóa `ai_turn:*` được giữ lại để chống trùng và cần chính sách dọn dẹp khi lưu lượng tăng.

## Xác minh

Chạy `npm test`. Kiểm thử mô phỏng kiểm tra lịch sử, chọn đúng mẫu, trả lời tiếp sau lời chào cũ, allowlist media, output lỗi, tắt bot, retry, trùng message ID và chế độ xem trước. Các kiểm thử này xác minh luồng tích hợp, không đo chất lượng hiểu tiếng Việt của model thực tế.

API phản hồi theo [OpenAI Structured Outputs](https://developers.openai.com/api/docs/guides/structured-outputs).
