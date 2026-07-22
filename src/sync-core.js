(function initSyncCore(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.InflifeSyncCore = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function createSyncCore() {
  function safeText(value, limit) {
    return String(value).slice(0, limit || 200).replace(/[<>&"'`\\]/g, '');
  }

  function sanitizeJson(value, depth) {
    const level = depth || 0;
    if (level > 8 || value === null || value === undefined) return null;
    if (typeof value === 'string') return safeText(value);
    if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
    if (typeof value === 'boolean') return value;
    if (Array.isArray(value)) return value.slice(0, 500).map(item => sanitizeJson(item, level + 1));
    if (typeof value === 'object') {
      const result = {};
      for (const [key, nested] of Object.entries(value).slice(0, 500)) {
        const safeKey = safeText(key, 100);
        if (safeKey) result[safeKey] = sanitizeJson(nested, level + 1);
      }
      return result;
    }
    return null;
  }

  function safeObject(value) {
    return value && typeof value === 'object' && !Array.isArray(value) ? sanitizeJson(value) : {};
  }

  function safeNumber(value, fallback) {
    return Number.isFinite(Number(value)) ? Number(value) : fallback;
  }

  function dateEntries(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return [];
    return Object.entries(value).filter(([key]) => /^\d{4}-\d{2}-\d{2}$/.test(key)).slice(0, 1500);
  }

  function sanitizeRecords(value) {
    const result = {};
    for (const [date, record] of dateEntries(value)) {
      if (!record || typeof record !== 'object' || Array.isArray(record)) continue;
      result[date] = {};
      for (const [id, done] of Object.entries(record).slice(0, 100)) {
        const safeId = safeText(id, 100);
        if (safeId) result[date][safeId] = done === true;
      }
    }
    return result;
  }

  function sanitizeCoffeeLogs(value) {
    const result = {};
    for (const [date, logs] of dateEntries(value)) {
      if (!Array.isArray(logs)) continue;
      result[date] = logs.slice(0, 50).map((log, index) => {
        const source = log && typeof log === 'object' ? log : {};
        return {
          id: safeText(source.id || `c${index}`, 100),
          type: safeText(source.type || '☕', 20),
          time: /^\d{2}:\d{2}$/.test(String(source.time || '')) ? String(source.time) : '',
          ts: Math.max(0, safeNumber(source.ts, 0))
        };
      });
    }
    return result;
  }

  function sanitizeWeightLogs(value) {
    const result = {};
    for (const [date, entry] of dateEntries(value)) {
      const weight = safeNumber(entry && entry.weight, NaN);
      if (!Number.isFinite(weight) || weight < 20 || weight > 400) continue;
      result[date] = { weight, ts: Math.max(0, safeNumber(entry.ts, 0)) };
    }
    return result;
  }

  function sanitizeNumberLog(value, maximum) {
    const result = {};
    for (const [date, raw] of dateEntries(value)) {
      const number = safeNumber(raw, NaN);
      if (Number.isFinite(number) && number >= 0 && number <= maximum) result[date] = Math.floor(number);
    }
    return result;
  }

  function sanitizeTaskLogs(value) {
    const result = {};
    for (const [date, indexes] of dateEntries(value)) {
      if (!Array.isArray(indexes)) continue;
      result[date] = [...new Set(indexes.filter(index => Number.isInteger(index) && index >= 0 && index < 100))];
    }
    return result;
  }

  function normalizeState(value) {
    const source = value && typeof value === 'object' ? value : {};
    const normalized = {
      habits: Array.isArray(source.habits)
        ? sanitizeJson(source.habits).filter(habit => habit && typeof habit === 'object' && !Array.isArray(habit)
          && typeof habit.id === 'string' && habit.id).slice(0, 12)
        : [],
      records: sanitizeRecords(source.records),
      coffeeLogs: sanitizeCoffeeLogs(source.coffeeLogs),
      weightLogs: sanitizeWeightLogs(source.weightLogs),
      waterLogs: sanitizeNumberLog(source.waterLogs, 20),
      exerciseLogs: sanitizeNumberLog(source.exerciseLogs, 600),
      taskLogs: sanitizeTaskLogs(source.taskLogs),
      exp: Math.max(0, safeNumber(source.exp, 0)),
      level: Math.max(1, Math.floor(safeNumber(source.level, 1))),
      coins: Math.max(0, safeNumber(source.coins, 0)),
      creatureLevels: safeObject(source.creatureLevels),
      inventory: safeObject(source.inventory),
      petState: safeObject(source.petState),
      personalRecords: safeObject(source.personalRecords),
      _perfectDays: Array.isArray(source._perfectDays) ? sanitizeJson(source._perfectDays).slice(0, 365) : [],
      collectedCreatures: Array.isArray(source.collectedCreatures)
        ? sanitizeJson(source.collectedCreatures).filter(value => typeof value === 'string').slice(0, 200)
        : [],
      settings: {
        darkMode: Boolean(source.settings && source.settings.darkMode),
        reminder: source.settings && typeof source.settings.reminder === 'boolean'
          ? source.settings.reminder
          : true
      }
    };

    return normalized;
  }

  function serializeState(value) {
    return normalizeState(value);
  }

  function isVersionConflict(error) {
    if (!error) return false;
    return error.code === '40001' || String(error.message || '').includes('stale_version');
  }

  function parseDay(value) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ''))) return null;
    const millis = Date.parse(`${value}T00:00:00Z`);
    if (!Number.isFinite(millis)) return null;
    return new Date(millis).toISOString().slice(0, 10) === value ? millis : null;
  }

  function validateShortcutEvent(value, today) {
    const source = value && typeof value === 'object' ? value : {};
    const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    if (!uuid.test(String(source.event_id || ''))) throw new Error('invalid event_id');

    const ranges = {
      exercise: { min: 1, max: 600, integer: true },
      water: { min: 1, max: 20, integer: true },
      weight: { min: 20, max: 400, integer: false }
    };
    const range = ranges[source.type];
    if (!range) throw new Error('invalid type');

    const numericValue = Number(source.value);
    if (!Number.isFinite(numericValue)
      || numericValue < range.min
      || numericValue > range.max
      || (range.integer && !Number.isInteger(numericValue))) {
      throw new Error('invalid value');
    }

    const eventDay = parseDay(source.occurred_on);
    const currentDay = parseDay(today);
    if (eventDay === null || currentDay === null || Math.abs(eventDay - currentDay) > 2 * 86400000) {
      throw new Error('invalid occurred_on');
    }

    return {
      event_id: source.event_id.toLowerCase(),
      type: source.type,
      value: numericValue,
      occurred_on: source.occurred_on
    };
  }

  return { normalizeState, serializeState, isVersionConflict, validateShortcutEvent };
});
