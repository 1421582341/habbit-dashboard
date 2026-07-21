-- Preserve the migrated source row for rollback, but remove all browser access.
alter table public.user_data enable row level security;
alter table public.user_data force row level security;

revoke all on table public.user_data from public, anon, authenticated;

comment on table public.user_data is
  'Legacy state retained temporarily for rollback; browser access is fully revoked.';
