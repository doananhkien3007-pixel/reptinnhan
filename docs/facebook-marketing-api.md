# Kết nối Facebook Marketing API

Trang `/ads` đọc quảng cáo từ Marketing API ở phía server, lấy Ads ID, trạng thái, Creative ID và ảnh bìa creative. Sau đó trang ghép quảng cáo với sản phẩm trong bảng `products` thông qua bảng `ad_product_mappings`.

## Biến môi trường

Thiết lập các biến sau trên Vercel hoặc trong `.env.local`:

```text
# Có thể bỏ qua nếu PAGE_ACCESS_TOKEN hiện tại đã có quyền ads_read
FB_MARKETING_ACCESS_TOKEN=token_co_quyen_ads_read
# Có thể bỏ qua nếu token chỉ truy cập đúng một Ad Account
FB_AD_ACCOUNT_ID=act_123456789
GRAPH_API_VERSION=v26.0
```

Server ưu tiên `FB_MARKETING_ACCESS_TOKEN`, sau đó `META_ACCESS_TOKEN`, và cuối cùng dùng `PAGE_ACCESS_TOKEN` đang có. Token phải có quyền `ads_read`. Nếu chưa có `FB_AD_ACCOUNT_ID`, server tự dò khi token chỉ truy cập đúng một tài khoản quảng cáo; nếu có nhiều tài khoản, cần chỉ định ID để tránh lấy nhầm. Không đưa access token vào mã frontend; token chỉ được gửi từ server bằng header `Authorization`.

## Database

Chạy file `sql/ad_product_mappings.sql` một lần trong Supabase SQL Editor nếu bảng mapping chưa tồn tại.

## Cách ghép

- Mapping đã lưu trong database luôn được ưu tiên.
- Nếu chưa có mapping, hệ thống gợi ý theo SKU xuất hiện trong tên ads, tên creative hoặc URL đích.
- Nếu không có SKU, hệ thống thử khớp tên sản phẩm.
- Người dùng kiểm tra gợi ý rồi bấm **Ghép sản phẩm** để lưu chính thức.
