begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(16);

insert into auth.users(id)
values
  ('00000000-0000-4000-8000-000000000001'::uuid),
  ('00000000-0000-4000-8000-000000000002'::uuid);

insert into public.user_state(user_id, state, version)
values
  ('00000000-0000-4000-8000-000000000001'::uuid, '{"coins":0}'::jsonb, 1),
  ('00000000-0000-4000-8000-000000000002'::uuid, '{"coins":0}'::jsonb, 1);

select has_table('public', 'user_state', 'user_state exists');
select policies_are(
  'public',
  'user_state',
  array['insert own state', 'read own state', 'update own state'],
  'only ownership policies exist'
);
select table_privs_are(
  'public',
  'user_state',
  'anon',
  array[]::text[],
  'anon has no table privileges'
);
select table_privs_are(
  'public',
  'user_state',
  'authenticated',
  array['INSERT', 'SELECT'],
  'authenticated users cannot update or delete directly'
);
select has_function(
  'public',
  'save_user_state',
  array['bigint', 'jsonb'],
  'versioned save function exists'
);

select ok(
  (select relrowsecurity from pg_class where oid = 'public.user_state'::regclass),
  'RLS is enabled'
);
select ok(
  (select relforcerowsecurity from pg_class where oid = 'public.user_state'::regclass),
  'RLS is forced'
);
select function_privs_are(
  'public',
  'save_user_state',
  array['bigint', 'jsonb'],
  'anon',
  array[]::text[],
  'anon cannot execute versioned saves'
);
select function_privs_are(
  'public',
  'save_user_state',
  array['bigint', 'jsonb'],
  'authenticated',
  array['EXECUTE'],
  'authenticated users can execute versioned saves'
);

select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000001', true);
set local role authenticated;

select is(
  (select count(*) from public.user_state),
  1::bigint,
  'authenticated owner sees exactly one row'
);
select is(
  (select count(*) from public.user_state where user_id = '00000000-0000-4000-8000-000000000002'::uuid),
  0::bigint,
  'authenticated owner cannot see another user row'
);
select is(
  (select saved_version from public.save_user_state(1, '{"coins":1}'::jsonb)),
  2::bigint,
  'owner can save with the current version'
);
select throws_ok(
  $$select public.save_user_state(1, '{"coins":2}'::jsonb)$$,
  '40001',
  'stale_version',
  'stale owner save is rejected'
);

reset role;

select is(
  (select applied from public.apply_shortcut_event(
    '00000000-0000-4000-8000-000000000001'::uuid,
    '00000000-0000-4000-8000-000000000009'::uuid,
    'water', 1, current_date
  )),
  true,
  'first shortcut event is applied'
);
select is(
  (select applied from public.apply_shortcut_event(
    '00000000-0000-4000-8000-000000000001'::uuid,
    '00000000-0000-4000-8000-000000000009'::uuid,
    'water', 1, current_date
  )),
  false,
  'duplicate shortcut event is ignored'
);
select is(
  (select version from public.user_state where user_id = '00000000-0000-4000-8000-000000000001'::uuid),
  3::bigint,
  'duplicate shortcut event does not advance the version'
);

select * from finish();
rollback;
