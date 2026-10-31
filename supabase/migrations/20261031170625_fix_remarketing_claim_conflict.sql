create or replace function public.remarketing_claim_due(
  p_limit integer default 10,
  p_lease_seconds integer default 45
) returns table(
  cycle_id uuid, attempt_id uuid, claim_token uuid, customer_psid text,
  conversation_id uuid, product_id bigint, step smallint,
  window_expires_at timestamptz, idempotency_key uuid
)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_cycle public.messenger_remarketing_cycles;
  v_attempt public.messenger_remarketing_attempts;
  v_token uuid;
begin
  update public.messenger_remarketing_attempts a
    set status = 'uncertain', error_class = 'lease_expired', completed_at = now(), updated_at = now()
    from public.messenger_remarketing_cycles c
    where a.cycle_id = c.id and a.step = c.step and a.status = 'sending'
      and c.status = 'claimed' and c.lease_until < now();
  update public.messenger_remarketing_cycles
    set status = 'uncertain', last_error_class = 'lease_expired',
        completed_at = now(), claim_token = null, lease_until = null, updated_at = now()
    where status = 'claimed' and lease_until < now();

  update public.messenger_remarketing_cycles c
    set status = 'cancelled', cancel_reason = case
      when c.window_expires_at <= now() then 'window_expired'
      when not cfg.enabled then 'disabled'
      when cfg.dry_run then 'dry_run_only'
      when not coalesce((s.value->>'enabled')::boolean, true) then 'bot_disabled'
      when p.status <> 'active' then 'product_inactive'
      when conv.current_product_id is distinct from c.product_id then 'product_changed'
      when exists (select 1 from public.orders o where o.conversation_id = c.conversation_id) then 'order_exists'
      else c.cancel_reason end,
      completed_at = now(), claim_token = null, lease_until = null, updated_at = now()
    from public.messenger_remarketing_config cfg
    join public.conversations conv on true
    join public.products p on true
    left join public.app_settings s on s.key = 'auto_reply_enabled'
    where cfg.singleton = true and conv.id = c.conversation_id and p.id = c.product_id
      and c.status = 'scheduled' and (
        c.window_expires_at <= now() or not cfg.enabled or cfg.dry_run
        or not coalesce((s.value->>'enabled')::boolean, true)
        or p.status <> 'active' or conv.current_product_id is distinct from c.product_id
        or exists (select 1 from public.orders o where o.conversation_id = c.conversation_id)
      );

  for v_cycle in
    select c.* from public.messenger_remarketing_cycles c
    join public.messenger_remarketing_config cfg on cfg.singleton = true
    where cfg.enabled and not cfg.dry_run and c.status = 'scheduled'
      and c.due_at <= now() and c.window_expires_at > now() and not c.has_measurements
    order by c.due_at, c.id
    for update of c skip locked
    limit greatest(1, least(p_limit, 25))
  loop
    v_token := gen_random_uuid();
    insert into public.messenger_remarketing_attempts(cycle_id, step, status, claimed_at)
      values (v_cycle.id, v_cycle.step, 'sending', now())
      on conflict on constraint messenger_remarketing_attempts_cycle_id_step_key do update
        set status = 'sending', claimed_at = now(), updated_at = now()
        where public.messenger_remarketing_attempts.status = 'retryable'
      returning * into v_attempt;
    if not found then continue; end if;
    update public.messenger_remarketing_cycles
      set status = 'claimed', claim_token = v_token, claimed_at = now(),
          lease_until = now() + make_interval(secs => greatest(10, least(p_lease_seconds, 120))), updated_at = now()
      where id = v_cycle.id;
    cycle_id := v_cycle.id; attempt_id := v_attempt.id; claim_token := v_token;
    customer_psid := v_cycle.customer_psid; conversation_id := v_cycle.conversation_id;
    product_id := v_cycle.product_id; step := v_cycle.step;
    window_expires_at := v_cycle.window_expires_at; idempotency_key := v_attempt.idempotency_key;
    return next;
  end loop;
end;
$$;
