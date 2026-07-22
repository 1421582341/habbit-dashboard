-- A stale application version is a business conflict, not a PostgreSQL
-- serialization failure. Using SQLSTATE 40001 causes infrastructure-level
-- transaction retries and can turn one conflict into a request storm.
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
    raise exception 'stale_version' using errcode = 'P0001';
  end if;
end;
$$;

revoke all on function public.save_user_state(bigint, jsonb) from public, anon;
grant execute on function public.save_user_state(bigint, jsonb) to authenticated;

comment on function public.save_user_state(bigint, jsonb) is
  'Atomically saves the caller state; stale versions raise non-retryable business error P0001.';
