const test = require('node:test');
const assert = require('node:assert/strict');

const cloudModule = require('../src/supabase-sync.js');

function clientDouble(options = {}) {
  const calls = [];
  let session = options.session || null;
  const remote = options.remote === undefined ? null : options.remote;

  const client = {
    calls,
    auth: {
      async signInWithPassword(credentials) {
        calls.push(['signInWithPassword', credentials]);
        if (options.signInError) return { data: {}, error: options.signInError };
        session = { user: { id: 'owner-id', email: credentials.email } };
        return { data: { session }, error: null };
      },
      async getSession() {
        return { data: { session }, error: null };
      },
      async signOut() {
        calls.push(['signOut']);
        session = null;
        return { error: null };
      },
      onAuthStateChange(callback) {
        client.authCallback = callback;
        return { data: { subscription: { unsubscribe() {} } } };
      }
    },
    from(table) {
      calls.push(['from', table]);
      return {
        select(columns) {
          calls.push(['select', columns]);
          return {
            eq(column, value) {
              calls.push(['eq', column, value]);
              return {
                async maybeSingle() {
                  return { data: remote, error: options.loadError || null };
                }
              };
            }
          };
        },
        insert(row) {
          calls.push(['insert', row]);
          return {
            select() {
              return {
                async single() {
                  return { data: { ...row, updated_at: 'now' }, error: options.insertError || null };
                }
              };
            }
          };
        }
      };
    },
    async rpc(name, args) {
      calls.push(['rpc', name, args]);
      if (options.rpcImpl) return options.rpcImpl(name, args, calls);
      if (options.rpcError) return { data: null, error: options.rpcError };
      return {
        data: [{ saved_state: args.new_state, saved_version: args.expected_version + 1, saved_updated_at: 'later' }],
        error: null
      };
    }
  };

  return client;
}

test('load refuses cloud access without an authenticated session', async () => {
  const cloud = cloudModule.create({ client: clientDouble() });
  await assert.rejects(() => cloud.load({ habits: [] }), /authentication_required/);
});

test('signIn uses email/password and load selects only the session user row', async () => {
  const client = clientDouble({ remote: { state: { coins: 7 }, version: 4, updated_at: 'now' } });
  const cloud = cloudModule.create({ client });

  await cloud.signIn('owner@example.com', 'password');
  const loaded = await cloud.load({});

  assert.equal(loaded.state.coins, 7);
  assert.equal(loaded.version, 4);
  assert.deepEqual(client.calls.find(call => call[0] === 'eq'), ['eq', 'user_id', 'owner-id']);
});

test('load creates the first owner row from the local fallback', async () => {
  const client = clientDouble({ session: { user: { id: 'owner-id', email: 'owner@example.com' } } });
  const cloud = cloudModule.create({ client });

  const loaded = await cloud.load({ coins: 12, petState: { sprout: { hunger: 50 } } });

  const insert = client.calls.find(call => call[0] === 'insert');
  assert.equal(insert[1].user_id, 'owner-id');
  assert.equal(insert[1].state.coins, 12);
  assert.deepEqual(insert[1].state.petState, { sprout: { hunger: 50 } });
  assert.equal(loaded.version, 1);
});

test('flush saves through the versioned RPC and advances the local version', async () => {
  const client = clientDouble({
    session: { user: { id: 'owner-id' } },
    remote: { state: {}, version: 3, updated_at: 'now' }
  });
  const cloud = cloudModule.create({ client });
  await cloud.load({});

  const saved = await cloud.flush({ coins: 5 });

  const rpc = client.calls.find(call => call[0] === 'rpc');
  assert.equal(rpc[1], 'save_user_state');
  assert.equal(rpc[2].expected_version, 3);
  assert.equal(rpc[2].new_state.coins, 5);
  assert.equal(saved.version, 4);
  assert.equal(cloud.getVersion(), 4);
});

test('a stale write reports conflict instead of retrying over newer data', async () => {
  const statuses = [];
  const client = clientDouble({
    session: { user: { id: 'owner-id' } },
    remote: { state: {}, version: 2 },
    rpcError: { code: '40001', message: 'stale_version' }
  });
  const cloud = cloudModule.create({ client, onStatus: status => statuses.push(status) });
  await cloud.load({});

  await assert.rejects(() => cloud.flush({ coins: 99 }), /stale_version/);
  assert.equal(statuses.at(-1).kind, 'conflict');
  assert.equal(client.calls.filter(call => call[0] === 'rpc').length, 1);
  assert.equal(cloud.hasPending(), true);
});

test('a failed save remains in the durable outbox until a later success', async () => {
  const outbox = [];
  let shouldFail = true;
  const client = clientDouble({
    session: { user: { id: 'owner-id' } },
    remote: { state: {}, version: 1 },
    rpcImpl(_name, args) {
      if (shouldFail) return { data: null, error: { message: 'offline' } };
      return { data: [{ saved_state: args.new_state, saved_version: 2, saved_updated_at: 'later' }], error: null };
    }
  });
  const cloud = cloudModule.create({
    client,
    onOutboxChange(value) { outbox.push(value); }
  });
  await cloud.load({});

  await assert.rejects(() => cloud.flush({ coins: 8 }), /offline/);
  assert.equal(cloud.hasPending(), true);
  assert.equal(outbox.at(-1).state.coins, 8);

  shouldFail = false;
  await cloud.flush();
  assert.equal(cloud.hasPending(), false);
  assert.equal(outbox.at(-1), null);
});

test('overlapping edits are serialized against the version returned by the first save', async () => {
  let releaseFirst;
  let callCount = 0;
  const firstResponse = new Promise(resolve => { releaseFirst = resolve; });
  const client = clientDouble({
    session: { user: { id: 'owner-id' } },
    remote: { state: {}, version: 1 },
    rpcImpl(_name, args) {
      callCount += 1;
      if (callCount === 1) return firstResponse;
      return { data: [{ saved_state: args.new_state, saved_version: 3, saved_updated_at: 'third' }], error: null };
    }
  });
  const cloud = cloudModule.create({ client });
  await cloud.load({});

  const firstSave = cloud.flush({ coins: 1 });
  while (client.calls.filter(call => call[0] === 'rpc').length === 0) {
    await new Promise(resolve => setImmediate(resolve));
  }
  cloud.scheduleSave({ coins: 2 });
  releaseFirst({ data: [{ saved_state: { coins: 1 }, saved_version: 2, saved_updated_at: 'second' }], error: null });
  await firstSave;
  await cloud.flush();

  const writes = client.calls.filter(call => call[0] === 'rpc').map(call => call[2]);
  assert.deepEqual(writes.map(write => write.expected_version), [1, 2]);
  assert.deepEqual(writes.map(write => write.new_state.coins), [1, 2]);
  assert.equal(cloud.hasPending(), false);
});

test('multiple waiters share one serialized drain without reusing a version', async () => {
  let releaseFirst;
  let callCount = 0;
  const firstResponse = new Promise(resolve => { releaseFirst = resolve; });
  const client = clientDouble({
    session: { user: { id: 'owner-id' } },
    remote: { state: {}, version: 1 },
    rpcImpl(_name, args) {
      callCount += 1;
      if (callCount === 1) return firstResponse;
      return { data: [{ saved_state: args.new_state, saved_version: args.expected_version + 1 }], error: null };
    }
  });
  const cloud = cloudModule.create({ client });
  await cloud.load({});

  const first = cloud.flush({ coins: 1 });
  while (client.calls.filter(call => call[0] === 'rpc').length === 0) {
    await new Promise(resolve => setImmediate(resolve));
  }
  cloud.scheduleSave({ coins: 2 });
  const second = cloud.flush();
  const third = cloud.flush();
  releaseFirst({ data: [{ saved_state: { coins: 1 }, saved_version: 2 }], error: null });
  await Promise.all([first, second, third]);

  const writes = client.calls.filter(call => call[0] === 'rpc').map(call => call[2]);
  assert.deepEqual(writes.map(write => write.expected_version), [1, 2]);
  assert.deepEqual(writes.map(write => write.new_state.coins), [1, 2]);
});

test('load waits for an active save before replacing the adapter version', async () => {
  let releaseSave;
  const saveResponse = new Promise(resolve => { releaseSave = resolve; });
  const client = clientDouble({
    session: { user: { id: 'owner-id' } },
    remote: { state: {}, version: 1 },
    rpcImpl() { return saveResponse; }
  });
  const cloud = cloudModule.create({ client });
  await cloud.load({});
  const firstFromCount = client.calls.filter(call => call[0] === 'from').length;

  const saving = cloud.flush({ coins: 1 });
  while (client.calls.filter(call => call[0] === 'rpc').length === 0) {
    await new Promise(resolve => setImmediate(resolve));
  }
  const loading = cloud.load({});
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(client.calls.filter(call => call[0] === 'from').length, firstFromCount);

  releaseSave({ data: [{ saved_state: { coins: 1 }, saved_version: 2 }], error: null });
  await saving;
  await loading;
  assert.equal(client.calls.filter(call => call[0] === 'from').length, firstFromCount + 1);
});

test('load cancels an unsent debounce without discarding its pending outbox', async () => {
  let cancelled = false;
  const client = clientDouble({
    session: { user: { id: 'owner-id' } },
    remote: { state: {}, version: 1 }
  });
  const cloud = cloudModule.create({
    client,
    setTimeoutFn() { return 17; },
    clearTimeoutFn(id) { if (id === 17) cancelled = true; }
  });
  await cloud.load({});
  cloud.scheduleSave({ coins: 4 });

  await cloud.load({});

  assert.equal(cancelled, true);
  assert.equal(cloud.hasPending(), true);
  assert.equal(client.calls.filter(call => call[0] === 'rpc').length, 0);
});

test('signOut flushes pending saves before clearing cloud identity', async () => {
  let scheduled;
  let cancelled = false;
  const client = clientDouble({ session: { user: { id: 'owner-id' } }, remote: { state: {}, version: 1 } });
  const cloud = cloudModule.create({
    client,
    setTimeoutFn(fn) { scheduled = fn; return 9; },
    clearTimeoutFn(id) { if (id === 9) cancelled = true; }
  });
  await cloud.load({});
  cloud.scheduleSave({ coins: 8 });

  await cloud.signOut();

  assert.equal(typeof scheduled, 'function');
  assert.equal(cancelled, true);
  assert.deepEqual(client.calls.filter(call => call[0] === 'rpc').map(call => call[2].new_state.coins), [8]);
  assert.ok(client.calls.findIndex(call => call[0] === 'rpc') < client.calls.findIndex(call => call[0] === 'signOut'));
  assert.equal(cloud.getUser(), null);
});

test('signOut refuses to discard a pending edit when its flush fails', async () => {
  const client = clientDouble({
    session: { user: { id: 'owner-id' } },
    remote: { state: {}, version: 1 },
    rpcError: { message: 'offline' }
  });
  const cloud = cloudModule.create({ client });
  await cloud.load({});
  cloud.scheduleSave({ coins: 8 });

  await assert.rejects(() => cloud.signOut(), /offline/);
  assert.equal(cloud.hasPending(), true);
  assert.equal(client.calls.some(call => call[0] === 'signOut'), false);
  assert.equal(cloud.getUser().id, 'owner-id');
});
