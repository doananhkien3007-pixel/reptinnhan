create index if not exists messenger_remarketing_product_idx
  on public.messenger_remarketing_cycles(product_id);
create index if not exists messenger_bot_outbound_cycle_idx
  on public.messenger_bot_outbound(cycle_id);
create index if not exists messenger_remarketing_logs_cycle_idx
  on public.messenger_remarketing_logs(cycle_id);
