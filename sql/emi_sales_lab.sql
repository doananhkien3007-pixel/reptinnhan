-- Isolated Lab data inside the LeafChat project. No Messenger, product, order or inventory table is read.
create table if not exists public.emi_lab_conversations (
  id uuid primary key,
  session_id uuid not null,
  title text not null check (char_length(title) <= 240),
  state jsonb not null check (jsonb_typeof(state) = 'object' and state ? 'history' and jsonb_typeof(state->'history') = 'array' and jsonb_array_length(state->'history') <= 160),
  revision bigint not null default 0 check (revision >= 0),
  last_request_id uuid,
  lock_token uuid,
  locked_until timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists emi_lab_session_updated_idx on public.emi_lab_conversations (session_id, updated_at desc);
alter table public.emi_lab_conversations enable row level security;
revoke all on public.emi_lab_conversations from public, anon, authenticated;
grant select, insert, update on public.emi_lab_conversations to service_role;

create or replace function public.emi_lab_claim_turn(
  p_session_id uuid, p_conversation_id uuid, p_request_id uuid, p_lock_token uuid, p_revision bigint
) returns jsonb language plpgsql security invoker set search_path = '' as $$
declare v public.emi_lab_conversations;
begin
  select * into v from public.emi_lab_conversations
    where id = p_conversation_id and session_id = p_session_id for update;
  if not found then raise exception 'Lab conversation not found' using errcode = 'P0002'; end if;
  if v.last_request_id = p_request_id then
    return jsonb_build_object('replayed', true, 'conversation', to_jsonb(v) - 'session_id' - 'lock_token' - 'locked_until');
  end if;
  if v.revision <> p_revision then raise exception 'Lab revision changed' using errcode = '40001'; end if;
  if v.locked_until > now() then raise exception 'Lab conversation busy' using errcode = '55P03'; end if;
  update public.emi_lab_conversations set lock_token = p_lock_token, locked_until = now() + interval '90 seconds'
    where id = p_conversation_id and session_id = p_session_id returning * into v;
  return jsonb_build_object('replayed', false, 'conversation', to_jsonb(v) - 'session_id' - 'lock_token' - 'locked_until');
end;
$$;

create or replace function public.emi_lab_finish_turn(
  p_session_id uuid, p_conversation_id uuid, p_request_id uuid, p_lock_token uuid, p_revision bigint, p_state jsonb
) returns jsonb language plpgsql security invoker set search_path = '' as $$
declare v public.emi_lab_conversations;
begin
  update public.emi_lab_conversations set state = p_state, revision = revision + 1,
    last_request_id = p_request_id, lock_token = null, locked_until = null, updated_at = now()
    where id = p_conversation_id and session_id = p_session_id and lock_token = p_lock_token
      and revision = p_revision and locked_until > now() returning * into v;
  if not found then raise exception 'Lab turn no longer owns the lock' using errcode = '40001'; end if;
  return to_jsonb(v) - 'session_id' - 'lock_token' - 'locked_until';
end;
$$;

create or replace function public.emi_lab_release_turn(p_session_id uuid, p_conversation_id uuid, p_lock_token uuid)
returns void language sql security invoker set search_path = '' as $$
  update public.emi_lab_conversations set lock_token = null, locked_until = null
    where id = p_conversation_id and session_id = p_session_id and lock_token = p_lock_token;
$$;

revoke all on function public.emi_lab_claim_turn(uuid,uuid,uuid,uuid,bigint) from public, anon, authenticated;
revoke all on function public.emi_lab_finish_turn(uuid,uuid,uuid,uuid,bigint,jsonb) from public, anon, authenticated;
revoke all on function public.emi_lab_release_turn(uuid,uuid,uuid) from public, anon, authenticated;
grant execute on function public.emi_lab_claim_turn(uuid,uuid,uuid,uuid,bigint) to service_role;
grant execute on function public.emi_lab_finish_turn(uuid,uuid,uuid,uuid,bigint,jsonb) to service_role;
grant execute on function public.emi_lab_release_turn(uuid,uuid,uuid) to service_role;
