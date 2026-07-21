begin;

insert into auth.users(id)
values
  ('00000000-0000-4000-8000-000000000001'::uuid),
  ('00000000-0000-4000-8000-000000000002'::uuid);

insert into public.user_state(user_id, state, version)
values
  ('00000000-0000-4000-8000-000000000001'::uuid, '{"coins":0}'::jsonb, 1),
  ('00000000-0000-4000-8000-000000000002'::uuid, '{"coins":0}'::jsonb, 1);

select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000001', true);
set local role authenticated;

do $$
declare
  visible_rows bigint;
  cross_user_rows bigint;
  saved_version bigint;
  stale_rejected boolean := false;
begin
  select count(*) into visible_rows from public.user_state;
  select count(*) into cross_user_rows
  from public.user_state
  where user_id = '00000000-0000-4000-8000-000000000002'::uuid;

  if visible_rows <> 1 or cross_user_rows <> 0 then
    raise exception 'rls_behavior_check_failed';
  end if;

  select result.saved_version into saved_version
  from public.save_user_state(1, '{"coins":1}'::jsonb) as result;
  if saved_version <> 2 then
    raise exception 'version_advance_check_failed';
  end if;

  begin
    perform public.save_user_state(1, '{"coins":2}'::jsonb);
  exception when serialization_failure then
    stale_rejected := true;
  end;
  if not stale_rejected then
    raise exception 'stale_version_check_failed';
  end if;
end;
$$;

reset role;

do $$
declare
  first_applied boolean;
  replay_applied boolean;
  final_version bigint;
begin
  select result.applied into first_applied
  from public.apply_shortcut_event(
    '00000000-0000-4000-8000-000000000001'::uuid,
    '00000000-0000-4000-8000-000000000009'::uuid,
    'water', 1, current_date
  ) as result;

  select result.applied into replay_applied
  from public.apply_shortcut_event(
    '00000000-0000-4000-8000-000000000001'::uuid,
    '00000000-0000-4000-8000-000000000009'::uuid,
    'water', 1, current_date
  ) as result;

  select version into final_version
  from public.user_state
  where user_id = '00000000-0000-4000-8000-000000000001'::uuid;

  if first_applied is distinct from true
    or replay_applied is distinct from false
    or final_version <> 3 then
    raise exception 'shortcut_idempotency_check_failed';
  end if;
end;
$$;

rollback;
