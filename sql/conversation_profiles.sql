-- Cache the Messenger user profile for conversation labels.
alter table public.conversations
  add column if not exists facebook_name text,
  add column if not exists facebook_first_name text,
  add column if not exists facebook_last_name text,
  add column if not exists facebook_profile_pic text,
  add column if not exists profile_updated_at timestamptz;

create index if not exists conversations_facebook_name_idx
  on public.conversations (facebook_name);
