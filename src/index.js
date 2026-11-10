/**
 * dsh-archive-mgr 鈥?host half.
 *
 * Archived-session cleaner for DeepSeek Harness. The native UI only *hides*
 * an archived session (its log stays on disk forever); this plugin lists the
 * archived sessions and gives them three outcomes:
 *
 *   - 鍒犻櫎       move the session log + projection cache into a local trash
 *                (`$DSH_HOME/archive-mgr/trash/<ts>-<id>/`) and drop the
 *                archived id from the workspace registry.
 *   - 鎭㈠       drop the archived id only (the session goes back to the
 *                sidebar, bytes untouched).
 *   - 鍥炴敹绔?    杩樺師 (files back + unarchive) / 褰诲簳鍒犻櫎 / 娓呯┖.
 *
 * HTTP API (same origin, prefix /dsh-archive-mgr/api):
 *   GET  /archived                     -> { total, items }
 *   POST /unarchive     { sessionId }  -> { ok }
 *   POST /delete        { sessionIds } -> { deleted, failed }
 *   GET  /trash                        -> { total, items }
 *   POST /trash/restore { trashId }    -> { ok, sessionId }
 *   POST /trash/delete  { trashId }    -> { ok }
 *   POST /trash/empty                  -> { removed }
 *
 * Everything is fail-open: if the workspace registry or session query is not
 * available the corresponding action reports `unavailable` instead of
 * throwing, and the native archive flow keeps working unchanged.
 */
import { mkdir, readFile, writeFile, readdir, rename, rm, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

export const name = 'dsh-archive-mgr';

const DSH_HOME = process.env.DSH_HOME && process.env.DSH_HOME.trim()
  ? process.env.DSH_HOME.trim()
  : join(homedir(), '.dsh');
const SESSIONS_DIR = join(DSH_HOME, 'sessions');
const PROJCACHE_DIR = join(DSH_HOME, 'storages', 'session_projcache', 'sessions');
const TRASH_DIR = join(DSH_HOME, 'archive-mgr', 'trash');
const TRASH_VERSION = 1;

// ---------------------------------------------------------------------------
// fs helpers
// ---------------------------------------------------------------------------

async function pathExists(p) {
  try { await stat(p); return true; } catch { return false; }
}

/** `$DSH_HOME/sessions/<encoded-workspace>/<sessionId>` 鈥?the workspace folder
 * name is an encoded cwd, so look the id up instead of re-deriving the codec. */
async function findSessionDir(sessionId) {
  let entries;
  try { entries = await readdir(SESSIONS_DIR, { withFileTypes: true }); } catch { return null; }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const candidate = join(SESSIONS_DIR, entry.name, sessionId);
    try {
      const st = await stat(candidate);
      if (st.isDirectory()) return candidate;
    } catch { /* not here */ }
  }
  return null;
}

async function dirSize(dir) {
  let total = 0;
  const stack = [dir];
  while (stack.length > 0) {
    const current = stack.pop();
    let entries;
    try { entries = await readdir(current, { withFileTypes: true }); } catch { continue; }
    for (const entry of entries) {
      const child = join(current, entry.name);
      if (entry.isDirectory()) stack.push(child);
      else if (entry.isFile()) {
        try { total += (await stat(child)).size; } catch { /* ignore */ }
      }
    }
  }
  return total;
}

async function movePath(from, to) {
  await mkdir(join(to, '..'), { recursive: true }).catch(() => {});
  try {
    await rename(from, to);
    return true;
  } catch (e) {
    // Cross-device or busy: fall back to copy + remove.
    if (e && (e.code === 'EXDEV' || e.code === 'EPERM' || e.code === 'EBUSY')) {
      try {
        const { cp } = await import('node:fs/promises');
        await cp(from, to, { recursive: true, force: true });
        await rm(from, { recursive: true, force: true });
        return true;
      } catch (inner) {
        throw inner;
      }
    }
    throw e;
  }
}

/** Trash entry names are `<deletedAt>-<sessionId>`; reject anything path-like. */
function isSafeTrashId(id) {
  return typeof id === 'string' && /^[A-Za-z0-9._-]+$/.test(id) && !id.includes('..');
}

// ---------------------------------------------------------------------------
// registry / session query helpers (lazy: the Loader mounts concurrently)
// ---------------------------------------------------------------------------

function makeRegistryOps(getRegistry) {
  const stateOf = () => {
    const registry = getRegistry();
    if (!registry || typeof registry.requireState !== 'function') return null;
    try { return registry.requireState(); } catch { return null; }
  };

  const archivedIds = () => {
    const state = stateOf();
    const ids = state && Array.isArray(state.archivedSessionIds) ? state.archivedSessionIds : [];
    return ids.map(String);
  };

  /** Serialized mutation mirroring the native archive session queue. */
  const withRegistry = async (mutate) => {
    const registry = getRegistry();
    if (!registry || typeof registry.enqueueOperation !== 'function'
      || typeof registry.requireState !== 'function' || typeof registry.setState !== 'function') {
      return { ok: false, error: 'unavailable', message: 'workspace registry does not expose the archive surface' };
    }
    let result;
    try {
      await registry.enqueueOperation(async () => {
        const current = registry.requireState();
        result = await mutate(current);
      });
      return { ok: true, result };
    } catch (e) {
      return { ok: false, error: 'failed', message: String((e && e.message) || e) };
    }
  };

  const unarchive = (sessionId) => withRegistry(async (current) => {
    const ids = Array.isArray(current.archivedSessionIds) ? current.archivedSessionIds : [];
    if (!ids.includes(sessionId)) return { changed: false };
    await registrySetState(getRegistry(), { ...current, archivedSessionIds: ids.filter((x) => x !== sessionId) });
    return { changed: true };
  });

  return { stateOf, archivedIds, withRegistry, unarchive };
}

function registrySetState(registry, next) {
  return registry.setState(next);
}

function makeLister(getRegistry, getQuery) {
  return async () => {
    const ids = makeRegistryOps(getRegistry).archivedIds();
    const query = getQuery();
    const empty = { total: 0, items: [] };
    if (ids.length === 0) return empty;
    if (!query || !getRegistry()) return { ...empty, unavailable: true };

    const headers = new Map();
    try {
      const records = await query.listSessions();
      if (Array.isArray(records)) {
        for (const r of records) {
          const h = r && r.header;
          if (h && h.id !== undefined) headers.set(String(h.id), h);
        }
      }
    } catch (e) { console.error('[dsh-archive-mgr] listSessions failed', e); }

    const titles = new Map();
    try {
      const obs = await query.readTitleSnapshots(ids);
      if (Array.isArray(obs)) {
        for (const o of obs) {
          if (o && o.status === 'fulfilled' && o.value && o.value.title && typeof o.value.title.title === 'string') {
            titles.set(String(o.sessionId), o.value.title.title);
          }
        }
      }
    } catch (e) { console.error('[dsh-archive-mgr] readTitleSnapshots failed', e); }

    const wsBySession = new Map();
    try {
      const registry = getRegistry();
      for (const ws of registry.list()) {
        const members = ws && ws.sessionIds;
        if (!Array.isArray(members)) continue;
        const meta = { workspaceTitle: ws.title ?? null, workspacePath: ws.path ?? null };
        for (const m of members) {
          const key = String(m);
          if (!wsBySession.has(key)) wsBySession.set(key, meta);
        }
      }
    } catch (e) { console.error('[dsh-archive-mgr] workspace membership failed', e); }

    const items = [];
    for (const id of ids) {
      const header = headers.get(id);
      const sessionDir = await findSessionDir(id);
      const cachePath = join(PROJCACHE_DIR, id + '.json');
      const hasCache = await pathExists(cachePath);
      const ws = wsBySession.get(id);
      const sizeBytes = sessionDir ? await dirSize(sessionDir) : 0;
      items.push({
        sessionId: id,
        title: titles.get(id) ?? null,
        workspaceTitle: ws ? ws.workspaceTitle : null,
        workspacePath: ws ? ws.workspacePath : null,
        createdAt: header && typeof header.createdAt === 'number' ? header.createdAt : null,
        sizeBytes,
        hasLog: !!sessionDir,
        hasCache,
      });
    }
    items.sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0));
    return { total: items.length, items };
  };
}

// ---------------------------------------------------------------------------
// trash
// ---------------------------------------------------------------------------

function trashDirOf(trashId) {
  if (!isSafeTrashId(trashId)) throw new Error('bad-trash-id');
  return join(TRASH_DIR, trashId);
}

async function readTrashMeta(trashId) {
  const raw = await readFile(join(trashDirOf(trashId), 'meta.json'), 'utf8');
  const meta = JSON.parse(raw);
  if (!meta || typeof meta.sessionId !== 'string') throw new Error('bad-meta');
  return meta;
}

async function listTrash() {
  let entries;
  try { entries = await readdir(TRASH_DIR, { withFileTypes: true }); } catch { return { total: 0, items: [] }; }
  const items = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || !isSafeTrashId(entry.name)) continue;
    try {
      const meta = await readTrashMeta(entry.name);
      items.push({
        trashId: entry.name,
        sessionId: meta.sessionId,
        title: typeof meta.title === 'string' ? meta.title : null,
        workspaceTitle: typeof meta.workspaceTitle === 'string' ? meta.workspaceTitle : null,
        workspacePath: typeof meta.workspacePath === 'string' ? meta.workspacePath : null,
        deletedAt: typeof meta.deletedAt === 'number' ? meta.deletedAt : null,
        createdAt: typeof meta.createdAt === 'number' ? meta.createdAt : null,
        sizeBytes: typeof meta.sizeBytes === 'number' ? meta.sizeBytes : 0,
      });
    } catch (e) { /* not one of ours */ }
  }
  items.sort((a, b) => (b.deletedAt ?? 0) - (a.deletedAt ?? 0));
  return { total: items.length, items };
}

/** Move one archived session into the trash. Caller must run this inside the
 * registry's serialized operation so state and files move together. */
async function stashSession(sessionId, extra) {
  const deletedAt = Date.now();
  const trashId = deletedAt + '-' + sessionId;
  const target = join(TRASH_DIR, trashId);
  await mkdir(target, { recursive: true });

  const sessionDir = await findSessionDir(sessionId);
  const cachePath = join(PROJCACHE_DIR, sessionId + '.json');
  const hasCache = await pathExists(cachePath);
  const sizeBytes = sessionDir ? await dirSize(sessionDir) : 0;

  const meta = {
    version: TRASH_VERSION,
    sessionId,
    title: extra.title ?? null,
    workspaceTitle: extra.workspaceTitle ?? null,
    workspacePath: extra.workspacePath ?? null,
    createdAt: extra.createdAt ?? null,
    deletedAt,
    sizeBytes,
    hadSessionDir: !!sessionDir,
    hadCache: hasCache,
    sessionDir: sessionDir ?? null,
  };
  await writeFile(join(target, 'meta.json'), JSON.stringify(meta, null, 2), 'utf8');

  if (sessionDir) await movePath(sessionDir, join(target, 'session'));
  if (hasCache) await movePath(cachePath, join(target, 'projection.json'));
  return meta;
}

async function restoreTrashEntry(trashId) {
  const dir = trashDirOf(trashId);
  const meta = await readTrashMeta(trashId);
  const sessionId = meta.sessionId;

  const stashedSession = join(dir, 'session');
  const stashedCache = join(dir, 'projection.json');
  const hasSession = await pathExists(stashedSession);
  let targetSessionDir = typeof meta.sessionDir === 'string' && meta.sessionDir ? meta.sessionDir : null;

  if (hasSession) {
    if (!targetSessionDir) {
      // Fall back to the encoded workspace folder convention.
      targetSessionDir = join(SESSIONS_DIR, encodeWorkspaceDir(meta.workspacePath || ''), sessionId);
    }
    await mkdir(join(targetSessionDir, '..'), { recursive: true });
    await movePath(stashedSession, targetSessionDir);
  }
  if (await pathExists(stashedCache)) {
    await mkdir(PROJCACHE_DIR, { recursive: true });
    await movePath(stashedCache, join(PROJCACHE_DIR, sessionId + '.json'));
  }
  return { sessionId, restoredFiles: hasSession };
}

/** `E:\\WeGame\\X` -> `--E-WeGame-X--` (the DSH session folder codec). */
function encodeWorkspaceDir(cwd) {
  if (!cwd) return '--unknown--';
  return '--' + String(cwd).replace(/[^A-Za-z0-9]+/g, '-').replace(/^-+|-+$/g, '') + '--';
}

// ---------------------------------------------------------------------------
// HTTP plumbing
// ---------------------------------------------------------------------------

function sendJson(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  res.end(payload);
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      try {
        const text = Buffer.concat(chunks).toString('utf8');
        resolve(text ? JSON.parse(text) : {});
      } catch (e) { reject(e); }
    });
    req.on('error', reject);
  });
}

// ---------------------------------------------------------------------------
// plugin
// ---------------------------------------------------------------------------

export function apply(ctx) {
  const registryOf = () => ctx.get('workspaceRegistry');
  const queryOf = () => ctx.get('sessionQuery');

  const ops = makeRegistryOps(registryOf);
  const listArchived = makeLister(registryOf, queryOf);

  /**
   * Drop a deleted session from everything the UI reads.
   *
   * Removing the id from `archivedSessionIds` makes the session visible again
   * on every grouping surface, but the browser keeps its own session catalog:
   * it only learns about removals from `api-session/removed` (or a full list
   * refresh). A cold archived session therefore stayed in the sidebar until
   * the next app start, because nothing told the client it was gone.
   *
   * A live session is detached first so the next Host `session.list` no longer
   * returns it (a live row wins over persistence and would otherwise
   * resurrect on refresh); detaching also emits `session/disposed`, which the
   * Session Controller relays as the same removal event. The explicit emit
   * covers the common cold case and any Host that cannot detach.
   */
  function forgetSession(sessionId) {
    let live = false;
    let detached = false;
    try {
      const sessions = ctx.get('sessions');
      if (sessions && typeof sessions.get === 'function') {
        const session = sessions.get(sessionId);
        live = session !== undefined;
        if (live && typeof sessions.liveEntryFor === 'function') {
          const entry = sessions.liveEntryFor(session);
          if (entry && typeof entry.detach === 'function') {
            entry.detach();
            detached = true;
          }
        }
      }
    } catch (e) {
      console.warn('[dsh-archive-mgr] live session detach failed', e);
    }
    try {
      ctx.emit('api-session/removed', sessionId);
    } catch (e) {
      console.warn('[dsh-archive-mgr] session removal notification failed', e);
    }
    return { live, detached };
  }

  const unarchiveOne = async (sessionId) => {
    const r = await ops.unarchive(sessionId);
    return r.ok ? { ok: true, changed: r.result ? r.result.changed : false } : r;
  };

  const deleteOne = async (sessionId) => {
    const registry = registryOf();
    if (!registry) return { ok: false, sessionId, error: 'unavailable' };
    const list = await listArchived();
    const item = (list.items || []).find((it) => it.sessionId === sessionId);
    let stashed = null;
    let markerError = null;

    // 1) files + archive marker together, inside the serialized queue.
    const moved = await ops.withRegistry(async (current) => {
      const ids = Array.isArray(current.archivedSessionIds) ? current.archivedSessionIds : [];
      if (!ids.includes(sessionId)) return { skipped: true };
      stashed = await stashSession(sessionId, item || {});
      try {
        await registrySetState(registry, { ...current, archivedSessionIds: ids.filter((x) => x !== sessionId) });
      } catch (e) {
        // State write failed: put the files back so nothing is lost.
        markerError = e;
        try {
          await restoreTrashEntry(stashed.deletedAt + '-' + sessionId);
          await rm(join(TRASH_DIR, stashed.deletedAt + '-' + sessionId), { recursive: true, force: true });
        } catch (inner) { console.error('[dsh-archive-mgr] rollback failed', inner); }
        throw e;
      }
      return { stashed: true };
    });

    if (!moved.ok) return { ok: false, sessionId, error: moved.error, message: moved.message };
    if (!moved.result || !moved.result.stashed) {
      return { ok: true, sessionId, skipped: true };
    }
    const catalog = forgetSession(sessionId);
    return {
      ok: true,
      sessionId,
      trashId: stashed.deletedAt + '-' + sessionId,
      sizeBytes: stashed.sizeBytes,
      // The sidebars can trust their own catalog again: the live entry is gone
      // (or was cold) and the removal event already went out.
      catalogRemoved: !catalog.live || catalog.detached,
    };
  };

  const restoreOne = async (trashId) => {
    if (!isSafeTrashId(trashId)) return { ok: false, error: 'bad-trash-id' };
    let meta;
    try { meta = await readTrashMeta(trashId); } catch (e) {
      return { ok: false, error: 'not-found', message: String((e && e.message) || e) };
    }
    const { sessionId } = await restoreTrashEntry(trashId);
    // Restored conversations go back to the sidebar (unarchived), per the
    // recycle-bin contract: "restore = the deletion never happened".
    const un = await unarchiveOne(sessionId);
    try { await rm(trashDirOf(trashId), { recursive: true, force: true }); } catch { /* ignore */ }
    return { ok: true, sessionId, unarchived: un.ok, title: meta.title ?? null };
  };

  const purgeOne = async (trashId) => {
    if (!isSafeTrashId(trashId)) return { ok: false, error: 'bad-trash-id' };
    try {
      await rm(trashDirOf(trashId), { recursive: true, force: true });
      return { ok: true };
    } catch (e) {
      return { ok: false, error: 'failed', message: String((e && e.message) || e) };
    }
  };

  const emptyTrash = async () => {
    try { await mkdir(TRASH_DIR, { recursive: true }); } catch { /* ignore */ }
    let removed = 0;
    try {
      const entries = await readdir(TRASH_DIR, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory() || !isSafeTrashId(entry.name)) continue;
        try { await rm(join(TRASH_DIR, entry.name), { recursive: true, force: true }); removed += 1; } catch { /* ignore */ }
      }
    } catch { /* empty */ }
    return { removed };
  };

  ctx.inject(['webServer'], (sub) => {
    const web = sub.webServer;
    // A plugin that is unloaded must stop answering. Some hosts keep routes
    // registered after dispose, so every handler is gated on `mounted` and the
    // gate is cleared by the effect below — a stale route then answers 404
    // instead of serving a dead plugin.
    let mounted = true;
    const disposers = [];
    const register = (path, handler) => {
      const gated = (req, res) => (mounted
        ? handler(req, res)
        : sendJson(res, 404, { error: 'not-found', message: 'plugin unloaded' }));
      const off = web.register({ kind: 'exact', path, handler: gated });
      if (typeof off === 'function') disposers.push(off);
    };

    // Client liveness heartbeat: the panel's first mount drops a timestamp so
    // a missing button can be told apart from a missing route.
    register('/dsh-archive-mgr/api/hello', async (req, res) => {
      if (req.method !== 'POST') return sendJson(res, 405, { error: 'method-not-allowed' });
      try {
        await mkdir(join(DSH_HOME, 'archive-mgr'), { recursive: true });
        await writeFile(join(DSH_HOME, 'archive-mgr', 'client-seen.json'), JSON.stringify({ at: Date.now() }), 'utf8');
      } catch { /* best effort */ }
      sendJson(res, 200, { ok: true });
    });

    register('/dsh-archive-mgr/api/archived', async (req, res) => {
      if (req.method !== 'GET') return sendJson(res, 405, { error: 'method-not-allowed' });
      try { sendJson(res, 200, await listArchived()); }
      catch (e) { sendJson(res, 500, { total: 0, items: [], error: String((e && e.message) || e) }); }
    });

    register('/dsh-archive-mgr/api/unarchive', async (req, res) => {
      if (req.method !== 'POST') return sendJson(res, 405, { error: 'method-not-allowed' });
      try {
        const body = await readJsonBody(req);
        if (typeof body.sessionId !== 'string' || !body.sessionId) {
          return sendJson(res, 400, { ok: false, error: 'bad-request', message: 'sessionId required' });
        }
        sendJson(res, 200, await unarchiveOne(body.sessionId));
      } catch (e) { sendJson(res, 500, { ok: false, error: 'failed', message: String((e && e.message) || e) }); }
    });

    register('/dsh-archive-mgr/api/delete', async (req, res) => {
      if (req.method !== 'POST') return sendJson(res, 405, { error: 'method-not-allowed' });
      try {
        const body = await readJsonBody(req);
        const ids = Array.isArray(body.sessionIds) ? body.sessionIds.filter((x) => typeof x === 'string').slice(0, 200) : [];
        if (ids.length === 0) return sendJson(res, 400, { ok: false, error: 'bad-request', message: 'sessionIds required' });
        const deleted = [];
        const failed = [];
        for (const id of ids) {
          const r = await deleteOne(id);
          if (r.ok) deleted.push(r);
          else failed.push({ sessionId: id, error: r.error, message: r.message });
        }
        sendJson(res, 200, { ok: failed.length === 0, deleted, failed });
      } catch (e) { sendJson(res, 500, { ok: false, error: 'failed', message: String((e && e.message) || e) }); }
    });

    register('/dsh-archive-mgr/api/trash', async (req, res) => {
      if (req.method !== 'GET') return sendJson(res, 405, { error: 'method-not-allowed' });
      try { sendJson(res, 200, await listTrash()); }
      catch (e) { sendJson(res, 500, { total: 0, items: [], error: String((e && e.message) || e) }); }
    });

    register('/dsh-archive-mgr/api/trash/restore', async (req, res) => {
      if (req.method !== 'POST') return sendJson(res, 405, { error: 'method-not-allowed' });
      try {
        const body = await readJsonBody(req);
        if (typeof body.trashId !== 'string') return sendJson(res, 400, { ok: false, error: 'bad-request' });
        sendJson(res, 200, await restoreOne(body.trashId));
      } catch (e) { sendJson(res, 500, { ok: false, error: 'failed', message: String((e && e.message) || e) }); }
    });

    register('/dsh-archive-mgr/api/trash/delete', async (req, res) => {
      if (req.method !== 'POST') return sendJson(res, 405, { error: 'method-not-allowed' });
      try {
        const body = await readJsonBody(req);
        if (typeof body.trashId !== 'string') return sendJson(res, 400, { ok: false, error: 'bad-request' });
        sendJson(res, 200, await purgeOne(body.trashId));
      } catch (e) { sendJson(res, 500, { ok: false, error: 'failed', message: String((e && e.message) || e) }); }
    });

    register('/dsh-archive-mgr/api/trash/empty', async (req, res) => {
      if (req.method !== 'POST') return sendJson(res, 405, { error: 'method-not-allowed' });
      try { sendJson(res, 200, await emptyTrash()); }
      catch (e) { sendJson(res, 500, { removed: 0, error: String((e && e.message) || e) }); }
    });

    console.log('[dsh-archive-mgr] host routes mounted');

    // Dispose hook: unregister what the host lets us, and always close the
    // gate so a leaked route can no longer answer.
    const teardown = () => {
      mounted = false;
      for (const off of disposers) {
        try { off(); } catch { /* ignore */ }
      }
      console.log('[dsh-archive-mgr] host routes unmounted');
    };
    if (typeof sub.effect === 'function') {
      sub.effect(() => teardown);
    }
  });

  // Startup reconciliation: drop archived ids whose log is gone, and sweep
  // projection caches left behind for sessions that no longer exist (the
  // native projection-cache service can flush a stale cache on shutdown).
  ctx.inject(['workspaceRegistry', 'sessionQuery'], (sub) => {
    const timer = setTimeout(() => { reconcile().catch((e) => console.error('[dsh-archive-mgr] reconcile failed', e)); }, 3000);
    timer.unref && timer.unref();
  });

  async function reconcile() {
    const registry = registryOf();
    const query = queryOf();
    if (!registry || !query) return;
    let records;
    try { records = await query.listSessions(); } catch (e) { return; }
    if (!Array.isArray(records) || records.length === 0) return; // uncertain: do nothing
    const known = new Set();
    for (const r of records) {
      const h = r && r.header;
      if (h && h.id !== undefined) known.add(String(h.id));
    }
    // 1) ghost archived ids
    const ids = ops.archivedIds();
    const ghosts = ids.filter((id) => !known.has(id));
    if (ghosts.length > 0) {
      await ops.withRegistry(async (current) => {
        const currentIds = Array.isArray(current.archivedSessionIds) ? current.archivedSessionIds : [];
        const next = currentIds.filter((id) => !ghosts.includes(String(id)));
        if (next.length === currentIds.length) return { changed: false };
        await registrySetState(registry, { ...current, archivedSessionIds: next });
        return { changed: true };
      }).catch(() => {});
      console.log('[dsh-archive-mgr] removed ' + ghosts.length + ' ghost archived id(s)');
    }
    // 2) orphan projection caches
    let files;
    try { files = await readdir(PROJCACHE_DIR); } catch { return; }
    let swept = 0;
    for (const file of files) {
      if (!file.endsWith('.json')) continue;
      const id = file.slice(0, -5);
      if (known.has(id)) continue;
      try {
        await rm(join(PROJCACHE_DIR, file), { force: true });
        swept += 1;
      } catch { /* ignore */ }
    }
    if (swept > 0) console.log('[dsh-archive-mgr] swept ' + swept + ' orphan projection cache(s)');
  }

  console.log('[dsh-archive-mgr] host ready');
}
