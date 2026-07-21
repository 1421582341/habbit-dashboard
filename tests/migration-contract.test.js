const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const migrationPath = path.join(__dirname, '..', 'supabase', 'migrations', '20260722010000_secure_user_state.sql');
const shortcutMigrationPath = path.join(__dirname, '..', 'supabase', 'migrations', '20260722020000_shortcut_events.sql');
const legacyLockMigrationPath = path.join(__dirname, '..', 'supabase', 'migrations', '20260722030000_lock_legacy_user_data.sql');

function migrationSql() {
  return fs.readFileSync(migrationPath, 'utf8').replace(/\s+/g, ' ').toLowerCase();
}

function shortcutMigrationSql() {
  return fs.readFileSync(shortcutMigrationPath, 'utf8').replace(/\s+/g, ' ').toLowerCase();
}

function legacyLockMigrationSql() {
  return fs.readFileSync(legacyLockMigrationPath, 'utf8').replace(/\s+/g, ' ').toLowerCase();
}

test('migration enables and forces RLS while removing anonymous privileges', () => {
  const sql = migrationSql();
  assert.match(sql, /alter table public\.user_state enable row level security/);
  assert.match(sql, /alter table public\.user_state force row level security/);
  assert.match(sql, /revoke all on table public\.user_state from [^;]*anon/);
  assert.doesNotMatch(sql, /grant [^;]*delete[^;]* to authenticated/);
  assert.doesNotMatch(sql, /grant [^;]*update[^;]* to authenticated/);
});

test('every browser policy binds the row to auth.uid()', () => {
  const sql = migrationSql();
  assert.match(sql, /for select to authenticated using \(\(select auth\.uid\(\)\) = user_id\)/);
  assert.match(sql, /for insert to authenticated with check \(\(select auth\.uid\(\)\) = user_id\)/);
  assert.match(sql, /for update to authenticated using \(\(select auth\.uid\(\)\) = user_id\) with check \(\(select auth\.uid\(\)\) = user_id\)/);
  assert.doesNotMatch(sql, /to anon/);
});

test('save_user_state is the only authenticated update path and rejects stale versions', () => {
  const sql = migrationSql();
  assert.match(sql, /create or replace function public\.save_user_state/);
  assert.match(sql, /security definer/);
  assert.match(sql, /us\.user_id = \(select auth\.uid\(\)\)/);
  assert.match(sql, /us\.version = expected_version/);
  assert.match(sql, /errcode = '40001'/);
  assert.match(sql, /revoke all on function public\.save_user_state\(bigint, jsonb\) from public, anon/);
  assert.match(sql, /grant execute on function public\.save_user_state\(bigint, jsonb\) to authenticated/);
});

test('shortcut migration keeps its event ledger private and idempotent', () => {
  const sql = shortcutMigrationSql();
  assert.match(sql, /primary key \(user_id, event_id\)/);
  assert.match(sql, /alter table public\.shortcut_events enable row level security/);
  assert.match(sql, /revoke all on table public\.shortcut_events from [^;]*anon[^;]*/);
  assert.match(sql, /on conflict \(user_id, event_id\) do nothing/);
  assert.match(sql, /if event_inserted is distinct from true then/);
});

test('only service_role can execute the shortcut state mutation', () => {
  const sql = shortcutMigrationSql();
  assert.match(sql, /create or replace function public\.apply_shortcut_event/);
  assert.match(sql, /security definer/);
  assert.match(sql, /revoke all on function public\.apply_shortcut_event\(uuid, uuid, text, numeric, date\) from public, anon, authenticated/);
  assert.match(sql, /grant execute on function public\.apply_shortcut_event\(uuid, uuid, text, numeric, date\) to service_role/);
  assert.match(sql, /event_type not in \('exercise','water','weight'\)/);
});

test('the preserved legacy table is sealed from browser roles', () => {
  const sql = legacyLockMigrationSql();
  assert.match(sql, /alter table public\.user_data enable row level security/);
  assert.match(sql, /alter table public\.user_data force row level security/);
  assert.match(sql, /revoke all on table public\.user_data from public, anon, authenticated/);
});
