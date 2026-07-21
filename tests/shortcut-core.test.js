const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

async function shortcutCore() {
  const url = pathToFileURL(path.join(__dirname, '..', 'supabase', 'functions', '_shared', 'shortcut-core.mjs'));
  return import(url.href);
}

test('shortcut secret comparison requires an exact non-empty match', async () => {
  const core = await shortcutCore();
  assert.equal(core.isAuthorized('correct-secret', 'correct-secret'), true);
  assert.equal(core.isAuthorized('correct-secret-x', 'correct-secret'), false);
  assert.equal(core.isAuthorized('', ''), false);
  assert.equal(core.isAuthorized(null, 'correct-secret'), false);
});

test('shortcut event validator normalizes allowed input', async () => {
  const core = await shortcutCore();
  assert.deepEqual(core.validateEvent({
    event_id: '4f967af1-15e8-4c7c-ae70-b14e29977241',
    type: 'weight',
    value: '68.5',
    occurred_on: '2026-07-22'
  }, '2026-07-22'), {
    event_id: '4f967af1-15e8-4c7c-ae70-b14e29977241',
    type: 'weight',
    value: 68.5,
    occurred_on: '2026-07-22'
  });
});

test('shortcut event validator rejects unknown actions and unsafe values', async () => {
  const core = await shortcutCore();
  const base = {
    event_id: '4f967af1-15e8-4c7c-ae70-b14e29977241',
    type: 'exercise',
    value: 30,
    occurred_on: '2026-07-22'
  };
  assert.throws(() => core.validateEvent({ ...base, type: 'delete' }, '2026-07-22'), /type/);
  assert.throws(() => core.validateEvent({ ...base, value: -1 }, '2026-07-22'), /value/);
  assert.throws(() => core.validateEvent({ ...base, occurred_on: '2026-08-01' }, '2026-07-22'), /occurred_on/);
});
