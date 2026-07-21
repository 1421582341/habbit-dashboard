const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const config = fs.readFileSync(path.join(__dirname, '..', 'supabase', 'config.toml'), 'utf8');

function section(name) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return config.match(new RegExp(`\\[${escaped}\\]([\\s\\S]*?)(?=\\n\\[|$)`))?.[1] || '';
}

test('public registration is disabled without disabling email login', () => {
  assert.match(section('auth'), /enable_signup\s*=\s*false/);
  assert.match(section('auth.email'), /enable_signup\s*=\s*true/);
});
