export function isAuthorized(provided, expected) {
  if (typeof provided !== 'string' || typeof expected !== 'string' || !provided || !expected) return false;
  const providedBytes = new TextEncoder().encode(provided);
  const expectedBytes = new TextEncoder().encode(expected);
  const length = Math.max(providedBytes.length, expectedBytes.length);
  let mismatch = providedBytes.length ^ expectedBytes.length;
  for (let index = 0; index < length; index += 1) {
    mismatch |= (providedBytes[index] || 0) ^ (expectedBytes[index] || 0);
  }
  return mismatch === 0;
}

function parseDay(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ''))) return null;
  const millis = Date.parse(`${value}T00:00:00Z`);
  if (!Number.isFinite(millis)) return null;
  return new Date(millis).toISOString().slice(0, 10) === value ? millis : null;
}

export function validateEvent(value, today = new Date().toISOString().slice(0, 10)) {
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
