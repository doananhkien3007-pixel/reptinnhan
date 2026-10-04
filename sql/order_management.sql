-- Additive setup script. Run once through Supabase apply_migration.
-- Private customer data: server service_role only, no browser Data API access.
create table public.orders (
  id uuid primary key,
  order_code text not null unique,
  conversation_id uuid not null references public.conversations(id),
  sender_id text not null,
  customer_name text not null check (length(trim(customer_name)) between 1 and 150),
  name_source text not null check (name_source in ('customer', 'facebook')),
  facebook_name text,
  phone text not null check (phone ~ '^0([35789][0-9]{8}|2[0-9]{9})$'),
  address text not null check (length(trim(address)) between 12 and 600),
  product_id bigint references public.products(id) on delete set null,
  product_name text not null check (length(trim(product_name)) > 0),
  size text not null check (length(trim(size)) between 1 and 40),
  color text,
  quantity integer not null default 1 check (quantity between 1 and 99),
  unit_price numeric not null check (unit_price >= 0),
  status text not null default 'new' check (status in ('new','processing','shipped','completed','cancelled')),
  review_request text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index orders_conversation_idx on public.orders(conversation_id);
create index orders_product_idx on public.orders(product_id);
create index orders_created_idx on public.orders(created_at desc, id);
create index orders_status_created_idx on public.orders(status, created_at desc, id);

create table public.order_checkouts (
  conversation_id uuid primary key references public.conversations(id),
  state jsonb not null default '{}'::jsonb,
  revision bigint not null default 0,
  updated_at timestamptz not null default now()
);
create table public.order_events (
  event_key text primary key,
  conversation_id uuid not null references public.conversations(id),
  result jsonb not null,
  created_at timestamptz not null default now()
);
create index order_events_conversation_idx on public.order_events(conversation_id);
alter table public.orders enable row level security;
alter table public.order_checkouts enable row level security;
alter table public.order_events enable row level security;
revoke all on public.orders, public.order_checkouts, public.order_events from public, anon, authenticated;
grant select, insert, update on public.orders, public.order_checkouts, public.order_events to service_role;

create function public.commit_order_checkout(
  p_event_key text, p_conversation_id uuid, p_revision bigint,
  p_state jsonb, p_order jsonb, p_result jsonb, p_review_request text default null
) returns jsonb language plpgsql security invoker set search_path = '' as $$
declare saved jsonb; current_revision bigint;
begin
  -- Lock the durable conversation row: serializes even first-time checkouts.
  perform 1 from public.conversations where id = p_conversation_id for update;
  if not found then raise exception 'Conversation not found'; end if;
  select result into saved from public.order_events where event_key = p_event_key;
  if found then return saved; end if;
  select revision into current_revision from public.order_checkouts where conversation_id = p_conversation_id;
  if coalesce(current_revision, 0) <> p_revision then raise exception 'Checkout changed; retry'; end if;
  if p_order is not null and p_order <> 'null'::jsonb then
    if (p_order->>'conversation_id')::uuid <> p_conversation_id or
       p_state->>'order_id' is distinct from p_order->>'id' or
       (p_state->>'confirmed')::boolean is distinct from true or
       (p_state->>'address_complete')::boolean is distinct from true then
      raise exception 'Invalid checkout';
    end if;
    insert into public.orders(id, order_code, conversation_id, sender_id, customer_name, name_source,
      facebook_name, phone, address, product_id, product_name, size, color, quantity, unit_price)
    values ((p_order->>'id')::uuid, p_order->>'order_code', p_conversation_id, p_order->>'sender_id',
      p_order->>'customer_name', p_order->>'name_source', p_order->>'facebook_name', p_order->>'phone',
      p_order->>'address', (p_order->>'product_id')::bigint, p_order->>'product_name', p_order->>'size',
      p_order->>'color', (p_order->>'quantity')::integer, (p_order->>'unit_price')::numeric);
  end if;
  if p_review_request is not null and p_state->>'order_id' is not null then
    update public.orders set review_request = left(p_review_request,1000), updated_at = now()
    where id = (p_state->>'order_id')::uuid and conversation_id = p_conversation_id;
  end if;
  insert into public.order_checkouts(conversation_id, state, revision)
    values (p_conversation_id, p_state, p_revision + 1)
    on conflict(conversation_id) do update set state = excluded.state, revision = excluded.revision, updated_at = now();
  insert into public.order_events(event_key, conversation_id, result) values(p_event_key, p_conversation_id, p_result);
  return p_result;
end;
$$;
revoke all on function public.commit_order_checkout(text,uuid,bigint,jsonb,jsonb,jsonb,text) from public, anon, authenticated;
grant execute on function public.commit_order_checkout(text,uuid,bigint,jsonb,jsonb,jsonb,text) to service_role;
