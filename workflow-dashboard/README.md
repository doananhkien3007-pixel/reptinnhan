# Messenger Live Workflow Dashboard

Dashboard Next.js chỉ quan sát workflow cố định của chatbot. React Flow không cho kéo node, tạo/xoá node, nối edge hoặc sửa vị trí.

## Kết nối Realtime

1. Chạy `../sql/workflow_realtime.sql` trong Supabase SQL Editor.
2. Tạo `.env.local` từ `.env.example` và điền URL cùng anon key của project Supabase.
3. Chạy:

```bash
npm install
npm run dev
```

Webhook hiện tại ghi execution và event bằng `SUPABASE_SECRET_KEY` ở server. Dashboard đọc `workflow_executions` và subscribe `workflow_events` bằng Supabase Realtime.

Nếu chưa cấu hình biến môi trường frontend, dashboard tự chuyển sang demo data để có thể kiểm tra giao diện và animation. Khi cấu hình Supabase, demo data tự tắt.

## Event model

- `workflow_started`
- `node_started`
- `node_completed`
- `edge_transfer`
- `node_error`
- `workflow_completed`

Telemetry là best-effort: nếu bảng Realtime tạm lỗi, webhook Messenger vẫn tiếp tục xử lý để không ảnh hưởng khách hàng.
