create table if not exists public.shortcut_events (
  user_id uuid not null references auth.users(id) on delete cascade,
  event_id uuid not null,
  event_type text not null,
  event_value numeric not null,
  occurred_on date not null,
  created_at timestamptz not null default now(),
  primary key (user_id, event_id)
);

alter table public.shortcut_events enable row level security;
alter table public.shortcut_events force row level security;
revoke all on table public.shortcut_events from public, anon, authenticated;

create or replace function public.apply_shortcut_event(
  target_user_id uuid,
  target_event_id uuid,
  event_type text,
  event_value numeric,
  event_date date
)
returns table(applied boolean, saved_version bigint)
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_state jsonb;
  current_version bigint;
  event_inserted boolean := false;
  logs jsonb;
  previous_value integer;
  next_value integer;
  exp_delta integer := 0;
  coin_delta integer := 0;
  reward integer;
  cup integer;
  next_exp integer;
  next_level integer;
  was_new boolean;
begin
  if target_user_id is null or target_event_id is null then
    raise exception 'invalid_identity' using errcode = '22023';
  end if;
  if event_type not in ('exercise','water','weight') then
    raise exception 'invalid_event_type' using errcode = '22023';
  end if;
  if event_date is null or abs(event_date - current_date) > 2 then
    raise exception 'invalid_event_date' using errcode = '22023';
  end if;
  if event_value is null
    or (event_type = 'exercise' and (event_value < 1 or event_value > 600 or event_value <> trunc(event_value)))
    or (event_type = 'water' and (event_value < 1 or event_value > 20 or event_value <> trunc(event_value)))
    or (event_type = 'weight' and (event_value < 20 or event_value > 400)) then
    raise exception 'invalid_event_value' using errcode = '22023';
  end if;

  select us.state, us.version
  into current_state, current_version
  from public.user_state as us
  where us.user_id = target_user_id
  for update;

  if not found then
    raise exception 'owner_state_not_found' using errcode = 'P0002';
  end if;

  insert into public.shortcut_events(user_id, event_id, event_type, event_value, occurred_on)
  values(target_user_id, target_event_id, event_type, event_value, event_date)
  on conflict (user_id, event_id) do nothing
  returning true into event_inserted;

  if event_inserted is distinct from true then
    return query select false, current_version;
    return;
  end if;

  if event_type = 'exercise' then
    logs := case when jsonb_typeof(current_state->'exerciseLogs') = 'object'
      then current_state->'exerciseLogs' else '{}'::jsonb end;
    previous_value := coalesce((logs->>event_date::text)::integer, 0);
    next_value := greatest(previous_value, event_value::integer);
    coin_delta := (next_value / 30) * 10 - (previous_value / 30) * 10;
    current_state := jsonb_set(
      current_state,
      '{exerciseLogs}',
      logs || jsonb_build_object(event_date::text, next_value),
      true
    );
  elsif event_type = 'water' then
    logs := case when jsonb_typeof(current_state->'waterLogs') = 'object'
      then current_state->'waterLogs' else '{}'::jsonb end;
    previous_value := coalesce((logs->>event_date::text)::integer, 0);
    next_value := least(20, previous_value + event_value::integer);
    if previous_value < least(next_value, 8) then
      for cup in previous_value + 1..least(next_value, 8) loop
        reward := case cup when 1 then 1 when 2 then 1 when 3 then 1 when 4 then 1
          when 5 then 1 when 6 then 3 when 7 then 5 when 8 then 7 else 0 end;
        exp_delta := exp_delta + reward;
        coin_delta := coin_delta + ceil(reward::numeric / 2)::integer;
      end loop;
    end if;
    current_state := jsonb_set(
      current_state,
      '{waterLogs}',
      logs || jsonb_build_object(event_date::text, next_value),
      true
    );
  else
    logs := case when jsonb_typeof(current_state->'weightLogs') = 'object'
      then current_state->'weightLogs' else '{}'::jsonb end;
    was_new := not (logs ? event_date::text);
    if was_new then
      exp_delta := 20;
      coin_delta := 10;
    end if;
    current_state := jsonb_set(
      current_state,
      '{weightLogs}',
      logs || jsonb_build_object(
        event_date::text,
        jsonb_build_object('weight', event_value, 'ts', (extract(epoch from clock_timestamp()) * 1000)::bigint)
      ),
      true
    );
  end if;

  next_exp := greatest(0, coalesce((current_state->>'exp')::integer, 0) + exp_delta);
  next_level := greatest(1, coalesce((current_state->>'level')::integer, 1));
  while next_exp >= 50 * next_level * (next_level + 1) loop
    next_level := next_level + 1;
  end loop;
  current_state := jsonb_set(current_state, '{exp}', to_jsonb(next_exp), true);
  current_state := jsonb_set(current_state, '{level}', to_jsonb(next_level), true);
  current_state := jsonb_set(
    current_state,
    '{coins}',
    to_jsonb(greatest(0, coalesce((current_state->>'coins')::integer, 0) + coin_delta)),
    true
  );

  update public.user_state as us
  set state = current_state,
      version = us.version + 1,
      updated_at = now()
  where us.user_id = target_user_id
  returning us.version into current_version;

  return query select true, current_version;
end;
$$;

revoke all on function public.apply_shortcut_event(uuid, uuid, text, numeric, date) from public, anon, authenticated;
grant execute on function public.apply_shortcut_event(uuid, uuid, text, numeric, date) to service_role;

comment on table public.shortcut_events is 'Private idempotency ledger for trusted Apple Shortcut events.';
comment on function public.apply_shortcut_event(uuid, uuid, text, numeric, date) is 'Validates and atomically applies one trusted shortcut event for the configured owner.';
