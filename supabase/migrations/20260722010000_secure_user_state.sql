create table if not exists public.user_state (
  user_id uuid primary key references auth.users(id) on delete cascade,
  state jsonb not null default '{}'::jsonb,
  version bigint not null default 1 check (version > 0),
  updated_at timestamptz not null default now(),
  constraint user_state_object check (jsonb_typeof(state) = 'object'),
  constraint user_state_size check (pg_column_size(state) <= 2097152)
);

alter table public.user_state enable row level security;
alter table public.user_state force row level security;

revoke all on table public.user_state from public, anon, authenticated;
grant select, insert on table public.user_state to authenticated;

drop policy if exists "read own state" on public.user_state;
drop policy if exists "insert own state" on public.user_state;
drop policy if exists "update own state" on public.user_state;

create policy "read own state"
on public.user_state
for select
to authenticated
using ((select auth.uid()) = user_id);

create policy "insert own state"
on public.user_state
for insert
to authenticated
with check ((select auth.uid()) = user_id);

-- Defense in depth for the security-definer RPC. Authenticated clients do not
-- receive direct UPDATE privileges, so every update must include a version.
create policy "update own state"
on public.user_state
for update
to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

create or replace function public.save_user_state(expected_version bigint, new_state jsonb)
returns table(saved_state jsonb, saved_version bigint, saved_updated_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid := auth.uid();
begin
  if caller_id is null then
    raise exception 'authentication_required' using errcode = '42501';
  end if;

  if new_state is null
    or jsonb_typeof(new_state) <> 'object'
    or pg_column_size(new_state) > 2097152 then
    raise exception 'invalid_state' using errcode = '22023';
  end if;

  return query
  update public.user_state as us
  set state = new_state,
      version = us.version + 1,
      updated_at = now()
  where us.user_id = (select auth.uid())
    and us.version = expected_version
  returning us.state, us.version, us.updated_at;

  if not found then
    raise exception 'stale_version' using errcode = '40001';
  end if;
end;
$$;

revoke all on function public.save_user_state(bigint, jsonb) from public, anon;
grant execute on function public.save_user_state(bigint, jsonb) to authenticated;

comment on table public.user_state is 'One versioned application-state document per authenticated user.';
comment on function public.save_user_state(bigint, jsonb) is 'Atomically saves the caller state only when expected_version is current.';
