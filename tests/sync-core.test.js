const test = require('node:test');
const assert = require('node:assert/strict');

const core = require('../src/sync-core.js');

test('normalizeState supplies safe defaults without sharing mutable values', () => {
  const first = core.normalizeState(null);
  const second = core.normalizeState({ habits: [{ id: 'h1' }], coins: 4 });

  first.habits.push({ id: 'changed' });

  assert.deepEqual(second.habits, [{ id: 'h1' }]);
  assert.deepEqual(second.records, {});
  assert.deepEqual(second.petState, {});
  assert.equal(second.coins, 4);
  assert.equal(second.level, 1);
  assert.deepEqual(second.settings, { darkMode: false, reminder: true });
});

test('serializeState keeps every durable field and drops session-only unlocks', () => {
  const serialized = core.serializeState({
    habits: [{ id: 'h1' }],
    records: { '2026-07-22': { h1: true } },
    coffeeLogs: {},
    weightLogs: {},
    waterLogs: {},
    exerciseLogs: {},
    taskLogs: { '2026-07-22': [0, 2] },
    exp: 9,
    level: 2,
    coins: 3,
    creatureLevels: { sprout: 2 },
    inventory: { apple: 1 },
    collectedCreatures: ['sprout'],
    petState: { sprout: { hunger: 80 } },
    settings: { darkMode: true, reminder: false },
    newUnlocks: ['sprout'],
    transient: 'ignore me'
  });

  assert.deepEqual(serialized.petState, { sprout: { hunger: 80 } });
  assert.equal(serialized.newUnlocks, undefined);
  assert.equal(serialized.transient, undefined);
  assert.deepEqual(Object.keys(serialized).sort(), [
    'coffeeLogs', 'coins', 'collectedCreatures', 'creatureLevels', 'exerciseLogs',
    'exp', 'habits', 'inventory', 'level', 'petState', 'records', 'settings',
    'taskLogs', 'waterLogs', 'weightLogs'
  ].sort());
  assert.deepEqual(serialized.taskLogs, { '2026-07-22': [0, 2] });
});

test('normalizeState strips executable markup from legacy nested values', () => {
  const normalized = core.normalizeState({
    habits: [{ id: "h1');alert(1)//", label: '<img src=x onerror=alert(1)>' }],
    coffeeLogs: { '2026-07-22': [{ id: "c1');alert(1)//", type: '<svg onload=alert(1)>', time: '08:30' }] },
    weightLogs: { '2026-07-22': { weight: '<img src=x>', ts: 1 } }
  });
  function strings(value) {
    if (typeof value === 'string') return [value];
    if (Array.isArray(value)) return value.flatMap(strings);
    if (value && typeof value === 'object') return Object.entries(value).flatMap(([key, nested]) => [key, ...strings(nested)]);
    return [];
  }

  assert.equal(strings(normalized).every(value => !/[<>&"'`]/.test(value)), true);
  assert.match(normalized.habits[0].label, /img src=x/);
});

test('isVersionConflict recognizes database serialization failures', () => {
  assert.equal(core.isVersionConflict({ code: '40001' }), true);
  assert.equal(core.isVersionConflict({ message: 'stale_version' }), true);
  assert.equal(core.isVersionConflict({ code: '23505' }), false);
  assert.equal(core.isVersionConflict(null), false);
});

test('validateShortcutEvent accepts a normalized exercise event', () => {
  const event = core.validateShortcutEvent({
    event_id: '4f967af1-15e8-4c7c-ae70-b14e29977241',
    type: 'exercise',
    value: '35',
    occurred_on: '2026-07-22'
  }, '2026-07-22');

  assert.deepEqual(event, {
    event_id: '4f967af1-15e8-4c7c-ae70-b14e29977241',
    type: 'exercise',
    value: 35,
    occurred_on: '2026-07-22'
  });
});

test('validateShortcutEvent rejects invalid IDs, dates, kinds, and bounds', () => {
  const base = {
    event_id: '4f967af1-15e8-4c7c-ae70-b14e29977241',
    type: 'exercise',
    value: 35,
    occurred_on: '2026-07-22'
  };

  assert.throws(() => core.validateShortcutEvent({ ...base, event_id: 'guessable' }, '2026-07-22'), /event_id/);
  assert.throws(() => core.validateShortcutEvent({ ...base, type: 'coins' }, '2026-07-22'), /type/);
  assert.throws(() => core.validateShortcutEvent({ ...base, value: 601 }, '2026-07-22'), /value/);
  assert.throws(() => core.validateShortcutEvent({ ...base, type: 'water', value: 21 }, '2026-07-22'), /value/);
  assert.throws(() => core.validateShortcutEvent({ ...base, type: 'weight', value: 401 }, '2026-07-22'), /value/);
  assert.throws(() => core.validateShortcutEvent({ ...base, occurred_on: '2026-07-30' }, '2026-07-22'), /occurred_on/);
});
