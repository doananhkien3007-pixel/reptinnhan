alter table public.products
  add column if not exists consultation_notes text not null default '',
  add column if not exists reply_template text not null default '';

comment on column public.products.consultation_notes is
  'Các điểm cần tư vấn và điểm bán hàng riêng của sản phẩm.';

comment on column public.products.reply_template is
  'Tin nhắn mẫu để trợ lý tham khảo khi trả lời khách; không phải câu trả lời bắt buộc.';
