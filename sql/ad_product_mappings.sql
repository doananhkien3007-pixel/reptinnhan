-- Map a Facebook Messenger ad to the product used for conversation context.
create table if not exists public.ad_product_mappings (
  ad_id text primary key,
  product_id bigint not null references public.products(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.ad_product_mappings enable row level security;

-- Populate rows in the Supabase Table Editor: one ad_id per product_id.
-- Example SQL when the real IDs are known:
-- insert into public.ad_product_mappings (ad_id, product_id)
-- values ('FACEBOOK_AD_ID', 123)
-- on conflict (ad_id) do update
-- set product_id = excluded.product_id, updated_at = now();
