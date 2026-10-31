create table if not exists public.messenger_customer_activity (
  page_id text not null,
  customer_psid text not null,
  last_interaction_at timestamptz not null,
  last_event_id text not null,
  has_measurements boolean not null default false,
  updated_at timestamptz not null default now(),
  primary key(page_id, customer_psid)
);
alter table public.messenger_customer_activity enable row level security;
revoke all on public.messenger_customer_activity from public, anon, authenticated;
grant select, insert, update, delete on public.messenger_customer_activity to service_role;

drop function if exists public.remarketing_start_cycle(text,uuid,text,bigint,text,timestamptz,timestamptz,boolean,text);

create or replace function public.remarketing_start_cycle(
  p_page_id text,
  p_conversation_id uuid,
  p_customer_psid text,
  p_product_id bigint,
  p_intro_version text,
  p_last_customer_interaction_at timestamptz,
  p_intro_completed_at timestamptz,
  p_origin_event_id text,
  p_has_measurements boolean default false,
  p_source_ad_id text default null
) returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_config public.messenger_remarketing_config;
  v_existing public.messenger_remarketing_cycles;
  v_due timestamptz;
  v_expires timestamptz;
  v_cycle public.messenger_remarketing_cycles;
begin
  select * into v_config from public.messenger_remarketing_config where singleton = true for share;
  if not v_config.enabled or v_config.rollout_at is null then
    return jsonb_build_object('started', false, 'reason', 'disabled');
  end if;
  if p_intro_completed_at < v_config.rollout_at then
    return jsonb_build_object('started', false, 'reason', 'before_rollout');
  end if;
  if not (p_product_id = any(v_config.target_product_ids)) then
    return jsonb_build_object('started', false, 'reason', 'product_not_targeted');
  end if;
  if p_has_measurements then
    return jsonb_build_object('started', false, 'reason', 'measurements_known');
  end if;
  if exists (
    select 1 from public.messenger_customer_activity a
    where a.page_id = p_page_id and a.customer_psid = p_customer_psid
      and (a.has_measurements or a.last_interaction_at > p_last_customer_interaction_at
        or (a.last_interaction_at = p_last_customer_interaction_at
          and a.last_event_id is distinct from p_origin_event_id))
  ) then
    return jsonb_build_object('started', false, 'reason', 'newer_customer_activity');
  end if;
  if not exists (
    select 1 from public.conversations c join public.products p on p.id = p_product_id
    where c.id = p_conversation_id and c.external_user_id = p_customer_psid
      and c.current_product_id = p_product_id and p.status = 'active'
  ) then
    return jsonb_build_object('started', false, 'reason', 'context_changed');
  end if;
  select * into v_existing from public.messenger_remarketing_cycles
    where page_id = p_page_id and customer_psid = p_customer_psid
      and product_id = p_product_id and intro_version = p_intro_version;
  if found then
    return jsonb_build_object('started', false, 'reason', 'already_exists', 'cycle_id', v_existing.id);
  end if;
  update public.messenger_remarketing_cycles
    set status = 'cancelled', cancel_reason = 'new_cycle', completed_at = now(),
        claim_token = null, lease_until = null, updated_at = now()
    where page_id = p_page_id and customer_psid = p_customer_psid
      and status in ('scheduled', 'claimed');
  v_expires := p_last_customer_interaction_at
    + interval '24 hours' - make_interval(mins => v_config.window_safety_minutes);
  v_due := public.remarketing_effective_due(
    p_intro_completed_at + make_interval(mins => v_config.first_delay_minutes),
    v_expires, v_config.quiet_start, v_config.quiet_end
  );
  if v_due is null or v_due <= p_intro_completed_at or v_due >= v_expires then
    return jsonb_build_object('started', false, 'reason', 'outside_window');
  end if;
  insert into public.messenger_remarketing_cycles(
    page_id, conversation_id, customer_psid, product_id, intro_version,
    source_ad_id, last_customer_interaction_at, intro_completed_at,
    due_at, window_expires_at, has_measurements
  ) values (
    p_page_id, p_conversation_id, p_customer_psid, p_product_id, p_intro_version,
    p_source_ad_id, p_last_customer_interaction_at, p_intro_completed_at,
    v_due, v_expires, p_has_measurements
  ) returning * into v_cycle;
  insert into public.messenger_remarketing_logs(cycle_id, event, reason)
    values (v_cycle.id, 'scheduled', 'introduction_completed');
  return jsonb_build_object('started', true, 'cycle_id', v_cycle.id,
    'due_at', v_cycle.due_at, 'dry_run', v_config.dry_run);
end;
$$;

create or replace function public.remarketing_record_customer_activity(
  p_page_id text,
  p_customer_psid text,
  p_interaction_at timestamptz,
  p_event_id text,
  p_reason text,
  p_has_measurements boolean default false
) returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare v_count integer;
begin
  insert into public.messenger_customer_activity(
    page_id, customer_psid, last_interaction_at, last_event_id, has_measurements
  ) values (
    p_page_id, p_customer_psid, p_interaction_at, p_event_id, p_has_measurements
  )
  on conflict(page_id, customer_psid) do update set
    last_interaction_at = greatest(public.messenger_customer_activity.last_interaction_at, excluded.last_interaction_at),
    last_event_id = case when excluded.last_interaction_at >= public.messenger_customer_activity.last_interaction_at
      then excluded.last_event_id else public.messenger_customer_activity.last_event_id end,
    has_measurements = public.messenger_customer_activity.has_measurements or excluded.has_measurements,
    updated_at = now();
  update public.messenger_remarketing_cycles
    set status = 'cancelled', cancel_reason = left(p_reason, 80),
        has_measurements = has_measurements or p_has_measurements,
        claim_token = null, lease_until = null, completed_at = now(), updated_at = now()
    where page_id = p_page_id and customer_psid = p_customer_psid
      and status in ('scheduled', 'claimed');
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function public.remarketing_start_cycle(text,uuid,text,bigint,text,timestamptz,timestamptz,text,boolean,text) from public, anon, authenticated;
revoke all on function public.remarketing_record_customer_activity(text,text,timestamptz,text,text,boolean) from public, anon, authenticated;
grant execute on function public.remarketing_start_cycle(text,uuid,text,bigint,text,timestamptz,timestamptz,text,boolean,text) to service_role;
grant execute on function public.remarketing_record_customer_activity(text,text,timestamptz,text,text,boolean) to service_role;
