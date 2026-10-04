# Tự tạo đơn từ Messenger

## Luồng đã triển khai

Khách chốt mua → AI trích thông tin có bằng chứng từ tin khách → server kiểm tra trường thiếu → hỏi từng phần còn thiếu → ghi đơn + bộ nhớ + mã sự kiện trong một transaction → xác nhận đã tạo đơn → hiển thị tại `/orders`.

- Trường bắt buộc: tên người nhận, SĐT, địa chỉ, sản phẩm, size. Tên khách cung cấp được ưu tiên; chưa có thì dùng `conversations.facebook_name`. Nếu Facebook không trả tên, bot hỏi tên.
- Hỏi giá/size, số đo, cảm ơn hoặc câu phủ định chưa chốt không tạo đơn. Chọn size phải từ khách, không tự lấy lời bot gợi ý. Những câu như “lấy size em tư vấn” chưa ghi rõ size có thể cần hỏi làm rõ.
- SĐT Việt Nam: chuẩn hóa `+84`/`84` thành `0`, chấp nhận di động 10 số và điện thoại bàn 11 số. Đây là kiểm tra định dạng, không xác minh số đang hoạt động.
- Địa chỉ phải có điểm nhận và địa phương. AI đánh giá độ đầy đủ dựa trên văn bản khách gửi; chưa có dịch vụ xác minh địa chỉ thực tế.
- Sản phẩm lấy từ danh mục/Ads/hội thoại, lưu snapshot tên và giá lúc tạo. Giá tiền hàng chưa bao gồm vận chuyển; chưa trừ tồn kho, thu tiền hoặc tạo vận đơn.
- Màu và số lượng lưu nếu khách cung cấp; mặc định số lượng 1. Nhiều mẫu/size khác nhau được đánh dấu cần shop kiểm tra trong danh sách đang hoàn thiện, không tự cắt bỏ món để tạo đơn một sản phẩm.
- Sửa/hủy sau khi đã tạo được gắn `review_request` để shop xử lý. Bot không tự sửa đơn đã giao. Quản trị có thể thay đổi trạng thái; chưa có trình sửa các trường đơn.
- Nhắc lại chốt không tạo đơn thứ hai. Chỉ yêu cầu rõ một đơn riêng mới mở checkout mới; thông tin nhận hàng cũ không tự dùng lại.
- Bộ nhớ theo conversation lưu bền qua restart. Mỗi event Facebook ghi vào `order_events`, RPC kiểm tra revision và khóa hàng conversation. Nếu lỗi sau ghi đơn nhưng trước gửi tin, retry lấy kết quả đã lưu, không tạo lại đơn.
- Chế độ thử AI ở hộp thư vẫn chỉ tư vấn, không ghi đơn và không gửi Messenger.

## Kích hoạt trên môi trường triển khai

1. Schema `sql/order_management.sql` đã áp dụng vào Supabase project `chatbot` (`dnpigfdoyywvahnxuoei`) bằng migration `order_management`. Với database khác, áp dụng script một lần qua migration trước khi bật.
2. Cấu hình server (không đưa vào frontend, không gửi secret trong chat):
   - `FB_APP_SECRET`: App Secret của Meta app nhận webhook (khác Page access token).
   - `ORDERS_ADMIN_TOKEN`: mã ngẫu nhiên ít nhất 24 ký tự, chỉ dùng khi đổi trạng thái đơn. Việc xem danh sách không yêu cầu mã.
   - `AUTO_ORDERS_ENABLED=true` là mặc định; đặt `false` khi cần tạm dừng bắt đơn.
   - `FB_APP_SECRET` bật xác minh chữ ký webhook Meta. Bộ bắt đơn vẫn có thể xử lý tin đã lưu trong Supabase khi chưa cấu hình khóa này.
   - Giữ các biến OpenAI, Page token và Supabase hiện có.
3. Deploy code. Bắt đơn vẫn chạy khi tắt trả lời tự động; lúc đó hệ thống chỉ cập nhật checkout/đơn và không nhắn khách. Khi có `FB_APP_SECRET`, webhook Facebook phải có chữ ký `X-Hub-Signature-256` hợp lệ trên raw body; payload thiếu/sai chữ ký bị từ chối trước mọi xử lý.
4. Mở `/orders` để xem ngay toàn bộ danh sách qua các trang. Danh sách refresh mỗi 15 giây khi tab hiện, có lọc trạng thái, phân trang 50 đơn và tìm trên trang hiện tại. Chỉ khi đổi trạng thái mới nhập mã quản trị; mã bị xóa khỏi form ngay sau mỗi lần gửi và không được lưu trong browser.
5. Chạy một hội thoại kiểm tra bằng tài khoản thử trước khi nhận đơn thật. Hiện chưa chạy model thật hoặc webhook live cho chức năng mới do local không có thông tin xác thực.

API vẫn nằm trong `/api/products?action=orders_list|orders_status`, không thêm Serverless Function.

## Bảo vệ dữ liệu và giới hạn

Ba bảng mới bật RLS, thu hồi quyền `anon`/`authenticated`, chỉ `service_role` đọc/ghi; RPC là SECURITY INVOKER, PUBLIC không được execute. Supabase Advisor có thông báo INFO “RLS enabled, no policy” là chủ đích với bảng server-only ([giải thích](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy)).

API xem danh sách không yêu cầu Bearer token theo yêu cầu mở toàn bộ và luôn trả `Cache-Control: no-store`. API đổi trạng thái vẫn yêu cầu mã quản trị và kiểm tra timestamp chống ghi đè dữ liệu cũ. Các bảng Supabase vẫn không cấp quyền trực tiếp cho `anon`/`authenticated`; secret key chỉ nằm ở server. Đây **không phải đăng nhập/phân quyền toàn ứng dụng**: bất kỳ ai truy cập được `/orders` hoặc endpoint GET đều xem được tên, SĐT và địa chỉ khách. Mã quản trị dùng chung chưa có tài khoản/nhật ký từng nhân viên; muốn giới hạn người xem hoặc đa nhân viên cần bổ sung auth/RBAC.

Thời gian lưu `order_events` và bộ nhớ checkout chưa có TTL; không dọn tùy ý vì sẽ giảm khả năng chống trùng. Cần chính sách lưu giữ phù hợp. Việc gửi tin Messenger không thể bảo đảm exactly-once nếu Facebook đã nhận nhưng mạng đứt trước checkpoint; phần ghi đơn vẫn được chống trùng ở DB.

## Kiểm thử

`npm test`: reducer, tên Facebook, thông tin thiếu, nguồn dữ liệu, SĐT, phủ định, đơn nhiều món, chữ ký webhook, mã quản trị, lỗi database, retry sau checkpoint/send lỗi, chế độ preview không ghi đơn.

Database được kiểm tra với insert fixture trong transaction rồi rollback: ghi đơn atomic, replay trả kết quả cũ, revision cũ bị từ chối. Giao diện được kiểm tra với API giả lập; không tự gửi tin/đặt đơn thật.

Tham khảo: [OpenAI Structured Outputs](https://developers.openai.com/api/docs/guides/structured-outputs), [Supabase RLS](https://supabase.com/docs/guides/database/postgres/row-level-security).
