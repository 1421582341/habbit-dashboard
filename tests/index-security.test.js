const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

test('the app starts behind an email/password authentication gate', () => {
  assert.match(html, /<body class="auth-pending">/);
  assert.match(html, /id="loginForm"/);
  assert.match(html, /type="email"[^>]*autocomplete="username"/);
  assert.match(html, /type="password"[^>]*autocomplete="current-password"/);
});

test('browser code uses authenticated cloud sync and contains no legacy anonymous writes', () => {
  assert.match(html, /InflifeCloud\.create\(\{client:sbClient/);
  assert.match(html, /cloud\.scheduleSave\(durableState\)/);
  assert.match(html, /onOutboxChange:writeOutbox/);
  assert.match(html, /inflife_outbox/);
  assert.match(html, /id="keepLocalBtn"/);
  assert.match(html, /id="useCloudBtn"/);
  assert.match(html, /state\.taskLogs\?\.\[key\]/);
  assert.match(html, /else if\(afterInit!==beforeInit\)/);
  assert.doesNotMatch(html, /hideLogin\(\);\s*saveState\(\)/);
  assert.match(html, /const wasCloudReady=cloudReady/);
  assert.match(html, /catch\(error\)\{\s*cloudReady=wasCloudReady;\s*throw error/);
  assert.doesNotMatch(html, /function deviceId/);
  assert.doesNotMatch(html, /function sbLoad/);
  assert.doesNotMatch(html, /function sbSave/);
  assert.doesNotMatch(html, /sync_exercise|inflife_used_tokens/);
  assert.doesNotMatch(html, /service_role|sb_secret_/i);
});

test('the browser SDK is pinned and protected by subresource integrity', () => {
  assert.match(html, /@supabase\/supabase-js@2\.110\.8\/dist\/umd\/supabase\.min\.js/);
  assert.match(html, /integrity="sha384-[A-Za-z0-9+/=]+"/);
  assert.match(html, /src="src\/sync-core\.js"/);
  assert.match(html, /src="src\/supabase-sync\.js"/);
});
