(function initCloudModule(root, factory) {
  const core = typeof module === 'object' && module.exports
    ? require('./sync-core.js')
    : root.InflifeSyncCore;
  const api = factory(core);
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.InflifeCloud = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function createCloudModule(core) {
  function create(options) {
    if (!options || !options.client) throw new Error('supabase_client_required');
    const client = options.client;
    const onStatus = options.onStatus || function noop() {};
    const setTimer = options.setTimeoutFn || setTimeout;
    const clearTimer = options.clearTimeoutFn || clearTimeout;
    const saveDelay = options.saveDelay === undefined ? 500 : options.saveDelay;
    const onOutboxChange = options.onOutboxChange || function noopOutbox() {};
    let session = null;
    let version = 0;
    let saveTimer = null;
    let pendingState = null;
    let pendingExpectedVersion = 0;
    let saveQueue = Promise.resolve();
    let activeSaves = 0;

    function status(kind, message) {
      onStatus({ kind, message: message || '' });
    }

    async function requireSession() {
      if (session && session.user) return session;
      const result = await client.auth.getSession();
      if (result.error) throw result.error;
      session = result.data && result.data.session;
      if (!session || !session.user) throw new Error('authentication_required');
      return session;
    }

    async function signIn(email, password) {
      status('syncing', '正在登录…');
      const result = await client.auth.signInWithPassword({ email, password });
      if (result.error) {
        status('error', result.error.message || '登录失败');
        throw result.error;
      }
      session = result.data.session;
      status('authenticated', session.user.email || '已登录');
      return session;
    }

    async function signOut() {
      if (saveTimer !== null) clearTimer(saveTimer);
      saveTimer = null;
      while (pendingState || activeSaves) await flush();
      const result = await client.auth.signOut();
      if (result.error) throw result.error;
      session = null;
      version = 0;
      status('signed_out', '已退出');
    }

    async function load(fallbackState) {
      if (saveTimer !== null) clearTimer(saveTimer);
      saveTimer = null;
      await saveQueue;
      const active = await requireSession();
      status('syncing', '正在读取云端数据…');
      const result = await client
        .from('user_state')
        .select('state,version,updated_at')
        .eq('user_id', active.user.id)
        .maybeSingle();

      if (result.error) {
        status('error', result.error.message || '云端读取失败');
        throw result.error;
      }

      let row = result.data;
      if (!row) {
        const created = await client
          .from('user_state')
          .insert({
            user_id: active.user.id,
            state: core.serializeState(fallbackState),
            version: 1
          })
          .select('state,version,updated_at')
          .single();
        if (created.error) {
          status('error', created.error.message || '云端初始化失败');
          throw created.error;
        }
        row = created.data;
      }

      version = Number(row.version);
      status('synced', '已同步');
      return {
        state: core.normalizeState(row.state),
        version,
        updatedAt: row.updated_at || null
      };
    }

    function publishOutbox() {
      onOutboxChange(pendingState ? {
        state: core.serializeState(pendingState),
        expectedVersion: pendingExpectedVersion || version
      } : null);
    }

    function setPending(nextState) {
      if (!pendingState) pendingExpectedVersion = version;
      pendingState = core.serializeState(nextState);
      publishOutbox();
    }

    async function runFlush() {
      await requireSession();
      if (!version) throw new Error('cloud_state_not_loaded');
      if (!pendingState) return null;
      const payload = core.serializeState(pendingState);
      const payloadFingerprint = JSON.stringify(payload);
      const expectedVersion = pendingExpectedVersion || version;
      status('syncing', '正在同步…');
      const result = await client.rpc('save_user_state', {
        expected_version: expectedVersion,
        new_state: payload
      });

      if (result.error) {
        if (core.isVersionConflict(result.error)) status('conflict', '另一台设备已有更新，请重新加载');
        else status('error', result.error.message || '同步失败');
        const error = new Error(result.error.message || 'cloud_save_failed');
        error.code = result.error.code;
        throw error;
      }

      const row = Array.isArray(result.data) ? result.data[0] : result.data;
      version = Number(row.saved_version);
      if (pendingState && JSON.stringify(pendingState) === payloadFingerprint) {
        pendingState = null;
        pendingExpectedVersion = 0;
      } else {
        pendingExpectedVersion = version;
      }
      publishOutbox();
      status('synced', '已同步');
      return {
        state: core.normalizeState(row.saved_state),
        version,
        updatedAt: row.saved_updated_at || null
      };
    }

    async function flush(nextState) {
      if (nextState !== undefined) setPending(nextState);
      const queued = saveQueue.then(async function drainOneSave() {
        if (!pendingState) return null;
        activeSaves += 1;
        try {
          return await runFlush();
        } finally {
          activeSaves -= 1;
        }
      });
      saveQueue = queued.catch(function keepQueueUsable() { return null; });
      return queued;
    }

    function scheduleSave(nextState) {
      setPending(nextState);
      if (saveTimer !== null) clearTimer(saveTimer);
      status('pending', '等待同步…');
      saveTimer = setTimer(function saveAfterDelay() {
        saveTimer = null;
        flush().catch(function reportScheduledFailure(error) {
          if (!core.isVersionConflict(error)) status('error', error.message || '同步失败');
        });
      }, saveDelay);
    }

    function restorePending(entry) {
      if (!entry || !entry.state) return;
      pendingState = core.serializeState(entry.state);
      pendingExpectedVersion = Number(entry.expectedVersion) || version;
      publishOutbox();
    }

    function rebasePending() {
      if (!pendingState) return;
      pendingExpectedVersion = version;
      publishOutbox();
    }

    function discardPending() {
      if (saveTimer !== null) clearTimer(saveTimer);
      saveTimer = null;
      pendingState = null;
      pendingExpectedVersion = 0;
      publishOutbox();
    }

    function subscribeAuth(callback) {
      return client.auth.onAuthStateChange(function handleAuth(event, nextSession) {
        session = nextSession || null;
        if (!session) version = 0;
        if (callback) callback(event, session);
      });
    }

    return {
      signIn,
      signOut,
      load,
      flush,
      scheduleSave,
      restorePending,
      rebasePending,
      discardPending,
      subscribeAuth,
      hasPending: function hasPending() { return Boolean(pendingState || activeSaves); },
      getPending: function getPending() { return pendingState ? core.serializeState(pendingState) : null; },
      getVersion: function getVersion() { return version; },
      getUser: function getUser() { return session && session.user ? session.user : null; }
    };
  }

  return { create };
});
