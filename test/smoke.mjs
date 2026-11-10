// Smoke test for dsh-archive host half.
//
// Runs the real plugin code (routes + fs moves + registry serialization)
// against a throwaway DSH_HOME and fake registry/session-query services.
// Run: node test/smoke.mjs
import { mkdir, writeFile, readFile, rm, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import assert from 'node:assert/strict';

const home = join(tmpdir(), 'dam-test-' + Date.now());
process.env.DSH_HOME = home;

const sessionsDir = join(home, 'sessions');
const projcacheDir = join(home, 'storages', 'session_projcache', 'sessions');
const sessionId = 'session-test-0001';
const sessionDir = join(sessionsDir, '--E-Fake--', sessionId);

await mkdir(sessionDir, { recursive: true });
await writeFile(join(sessionDir, 'session.v4.jsonl.zstd'), Buffer.alloc(2048, 7));
await mkdir(projcacheDir, { recursive: true });
await writeFile(join(projcacheDir, sessionId + '.json'), '{"cache":true}');

let state = { archivedSessionIds: [sessionId] };
const registry = {
  enqueueOperation: async (fn) => { await fn(); },
  requireState: () => state,
  setState: async (next) => { state = next; },
  list: () => [{ path: 'E:\\Fake', title: 'Fake workspace', sessionIds: [sessionId] }],
};
const query = {
  listSessions: async () => [{ header: { id: sessionId, createdAt: 1700000000000, cwd: 'E:\\Fake' } }],
  readTitleSnapshots: async (ids) => ids.map((id) => ({
    status: 'fulfilled', sessionId: id, value: { title: { title: '测试会话' } },
  })),
};

const routes = new Map();
const events = [];
let liveSessionPresent = true;
let detached = 0;
const liveSession = { id: sessionId };
const sessions = {
  get: (id) => (liveSessionPresent && id === sessionId ? liveSession : undefined),
  liveEntryFor: () => ({
    detach: () => { detached += 1; liveSessionPresent = false; },
  }),
};
const ctx = {
  get: (n) => ({ workspaceRegistry: registry, sessionQuery: query, sessions })[n],
  inject: (deps, cb) => { cb(ctx); },
  emit: (event, ...args) => { events.push([event, ...args]); },
  webServer: { register: (route) => routes.set(route.path, route.handler) },
};

const { apply } = await import('../src/index.js');
apply(ctx);

function makeReq(method, body) {
  return {
    method,
    on(event, cb) {
      if (event === 'data' && body !== undefined) cb(Buffer.from(JSON.stringify(body)));
      if (event === 'end') cb();
      return this;
    },
  };
}
function makeRes() {
  const res = { status: 0, payload: null };
  res.writeHead = (status) => { res.status = status; };
  res.end = (text) => { res.payload = text ? JSON.parse(text) : null; };
  return res;
}
async function call(path, method = 'GET', body) {
  const handler = routes.get(path);
  assert.ok(handler, 'route missing: ' + path);
  const res = makeRes();
  await handler(makeReq(method, body), res);
  return { status: res.status, body: res.payload };
}

// 1) list
let r = await call('/dsh-archive/api/archived');
assert.equal(r.status, 200);
assert.equal(r.body.total, 1);
assert.equal(r.body.items[0].title, '测试会话');
assert.equal(r.body.items[0].hasLog, true);
assert.deepEqual(state.archivedSessionIds, [sessionId]);

// 2) delete -> moves to trash, drops the archived marker
r = await call('/dsh-archive/api/delete', 'POST', { sessionIds: [sessionId] });
assert.equal(r.body.ok, true, JSON.stringify(r.body));
assert.equal(r.body.deleted[0].catalogRemoved, true, 'a deletable session leaves the live catalog');
assert.equal(detached, 1, 'the live session is detached so host list no longer returns it');
assert.deepEqual(
  events.filter(([name]) => name === 'api-session/removed').map(([, id]) => id),
  [sessionId],
  'clients are told to drop the deleted row immediately',
);
assert.equal(existsSync(sessionDir), false, 'session dir should be gone');
assert.equal(existsSync(join(projcacheDir, sessionId + '.json')), false, 'cache should be moved');
assert.deepEqual(state.archivedSessionIds, []);
const trashRoot = join(home, 'archive-mgr', 'trash');
const trashEntries = await readdir(trashRoot);
assert.equal(trashEntries.length, 1);
const trashId = trashEntries[0];
assert.ok(existsSync(join(trashRoot, trashId, 'session', 'session.v4.jsonl.zstd')));
assert.ok(existsSync(join(trashRoot, trashId, 'projection.json')));
const meta = JSON.parse(await readFile(join(trashRoot, trashId, 'meta.json'), 'utf8'));
assert.equal(meta.sessionId, sessionId);
assert.equal(meta.sizeBytes, 2048);

// 3) trash list
r = await call('/dsh-archive/api/trash');
assert.equal(r.body.total, 1);
assert.equal(r.body.items[0].trashId, trashId);

// 4) restore -> files back, session unarchived (stays in the sidebar)
r = await call('/dsh-archive/api/trash/restore', 'POST', { trashId });
assert.equal(r.body.ok, true, JSON.stringify(r.body));
assert.ok(existsSync(join(sessionDir, 'session.v4.jsonl.zstd')), 'session log restored');
assert.ok(existsSync(join(projcacheDir, sessionId + '.json')), 'cache restored');
assert.deepEqual(state.archivedSessionIds, []);
assert.equal((await readdir(trashRoot)).length, 0);

// 5) delete again, then purge permanently
state = { archivedSessionIds: [sessionId] };
r = await call('/dsh-archive/api/delete', 'POST', { sessionIds: [sessionId] });
assert.equal(r.body.ok, true);
const trashId2 = (await readdir(trashRoot))[0];
r = await call('/dsh-archive/api/trash/delete', 'POST', { trashId: trashId2 });
assert.equal(r.body.ok, true);
assert.equal((await readdir(trashRoot)).length, 0);

// 6) unarchive keeps the bytes and only drops the marker
await mkdir(sessionDir, { recursive: true });
await writeFile(join(sessionDir, 'session.v4.jsonl.zstd'), Buffer.alloc(2048, 7));
state = { archivedSessionIds: [sessionId] };
const before = await readFile(join(sessionDir, 'session.v4.jsonl.zstd'));
r = await call('/dsh-archive/api/unarchive', 'POST', { sessionId });
assert.equal(r.body.ok, true);
assert.deepEqual(state.archivedSessionIds, []);
assert.equal(
  events.filter(([name, id]) => name === 'api-session/removed' && id === sessionId).length,
  2, // only the two deletes above; unarchiving must not remove the row
);
const after = await readFile(join(sessionDir, 'session.v4.jsonl.zstd'));
assert.ok(before.equals(after));

// 7) deleting a ghost id (no files) still clears the marker
state = { archivedSessionIds: ['session-ghost'] };
r = await call('/dsh-archive/api/delete', 'POST', { sessionIds: ['session-ghost'] });
assert.equal(r.body.ok, true);
assert.deepEqual(state.archivedSessionIds, []);
assert.deepEqual(
  events.filter(([name]) => name === 'api-session/removed').map(([, id]) => id),
  [sessionId, sessionId, 'session-ghost'],
  'a cold row is still evicted client-side',
);

await rm(home, { recursive: true, force: true });
console.log('smoke: all assertions passed');
