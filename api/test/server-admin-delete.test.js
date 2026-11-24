/* Issue #107: disabling locks an account out but deliberately leaves state-<uid>.json and the
   credential record in place, so "no data remains" was not reachable from the dashboard. Delete
   removes the user, their credentials, their push subscriptions, their training history and any
   Coach credential — and refuses the two cases nothing in the UI could undo afterwards. Real
   server.js in a child, same harness as server-admin-state.test.js. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { adminProof, boundPort, softPasskey } from './helpers.mjs';

const API = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const SECRET = crypto.randomBytes(32).toString('hex');
const mintSession = (uid, kind = '') => {
  const payload = `${uid}:${Date.now() + 86400000}:0${kind ? ':' + kind : ''}`;
  return payload + '.' + crypto.createHmac('sha256', SECRET).update(payload).digest('base64url');
};
const ADMIN = 'u_adm_1', ADMIN2 = 'u_adm_2', VICTIM = 'u_vic_1';
const as = uid => ({ Cookie: `gymsid=${mintSession(uid)}`, 'Content-Type': 'application/json' });
async function startServer(t, { twoAdmins = false } = {}) {
  const adminKeys = new Map([[ADMIN, softPasskey()], [ADMIN2, softPasskey()]]);
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gym-del-'));
  fs.writeFileSync(path.join(dataDir, 'secret'), SECRET, { mode: 0o600 });
  const users = [
    { id: ADMIN, name: 'Adminna', created: new Date().toISOString(), admin: true },
    { id: VICTIM, name: 'Mallory', created: new Date().toISOString(), invitedBy: 'CODE1' },
  ];
  if (twoAdmins) users.push({ id: ADMIN2, name: 'Second', created: new Date().toISOString(), admin: true });
  fs.writeFileSync(path.join(dataDir, 'db.json'), JSON.stringify({
    users,
    creds: [{ id: 'c-victim', userId: VICTIM, publicKey: 'x' }, ...users.filter(u => u.admin).map(u => adminKeys.get(u.id).row(u.id))],
    subs: [{ endpoint: 'https://push/victim', userId: VICTIM }, { endpoint: 'https://push/admin', userId: ADMIN }],
    invites: [{ code: 'CODE1', usedBy: VICTIM, usedAt: new Date().toISOString() }],
  }));
  fs.writeFileSync(path.join(dataDir, `state-${VICTIM}.json`), JSON.stringify({ unit: 'kg', workouts: [], _rev: 3 }));
  const child = spawn(process.execPath, ['server.js'], {
    cwd: API, stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, PORT: '0', DATA_DIR: dataDir, ORIGIN: 'http://localhost:8080', RP_ID: 'localhost' },
  });
  const h = { api: '', log: '', dataDir };
  child.stdout.on('data', d => h.log += d);
  child.stderr.on('data', d => h.log += d);
  t.after(() => { child.kill('SIGKILL'); fs.rmSync(dataDir, { recursive: true, force: true }); });
  // The boot line carries the port the listener bound, so it is both the address and the
  // readiness signal — see boundPort in helpers.mjs for why the test does not pick one.
  h.port = await boundPort(child, () => h.log);
  h.api = `http://127.0.0.1:${h.port}`;
  h.send = async (route, body, headers) => {
    const r = await fetch(`${h.api}${route}`, { method: 'POST', headers, body: JSON.stringify(body) });
    return { status: r.status, body: await r.json() };
  };
  h.proof = (headers, action, body, options) => adminProof(h.api, headers, action, body, adminKeys.get(ADMIN), options);
  h.post = async (route, body, uid = ADMIN) => {
    const headers = { ...as(uid), Origin: 'http://localhost:8080' };
    const action = { '/api/admin/user/delete': 'delete', '/api/admin/user/role': 'role', '/api/admin/owner': 'owner' }[route];
    if ((action === 'delete' && uid !== VICTIM) || (action && uid === ADMIN)) {
      body = { ...body, ...await adminProof(h.api, headers, action, body, adminKeys.get(uid)) };
    }
    return h.send(route, body, headers);
  };
  h.del = (id, uid = ADMIN) => h.post('/api/admin/user/delete', { id }, uid);
  h.db = () => JSON.parse(fs.readFileSync(path.join(h.dataDir, 'db.json'), 'utf8'));
  h.stackFrames = () => h.log.split('\n').filter(l => /^\s+at /.test(l)).length;
  return h;
}

test('admin actions need a fresh, verified assertion bound to the session, action and target', async t => {
  const h = await startServer(t, { twoAdmins: true });
  const headers = as(ADMIN);
  const route = '/api/admin/user/role';
  const body = { id: VICTIM, admin: true };
  const send = (proof, target = body, session = headers) => h.send(route, { ...target, ...proof }, session);
  assert.equal((await send()).body.code, 'admin-passkey-required');
  assert.equal((await send(await h.proof(headers, 'role', body, { verified: false }))).status, 403);
  assert.equal((await send(await h.proof(headers, 'delete', body))).status, 403);
  assert.equal((await send(await h.proof(headers, 'role', body), { ...body, id: ADMIN2 })).status, 403);
  assert.equal((await send(await h.proof(headers, 'role', body), { ...body, admin: false })).status, 403);
  const another = { ...headers, Cookie: `gymsid=${mintSession(ADMIN, 'c')}` };
  assert.equal((await send(await h.proof(headers, 'role', body), body, another)).status, 403);
  const proof = await h.proof(headers, 'role', body);
  assert.equal((await send(proof)).status, 200);
  assert.equal((await send(proof)).status, 403);
});

test('removes the account and everything attached to it', async t => {
  const h = await startServer(t);
  assert.ok(fs.existsSync(path.join(h.dataDir, `state-${VICTIM}.json`)));
  const res = await h.del(VICTIM);
  assert.equal(res.status, 200);

  const db = h.db();
  assert.deepEqual(db.users.map(u => u.id), [ADMIN], 'the user is gone');
  assert.deepEqual(db.creds.map(c => c.userId), [ADMIN], 'their passkeys are gone');
  assert.deepEqual(db.subs.map(s => s.userId), [ADMIN], 'their push subscriptions are gone');
  assert.equal(fs.existsSync(path.join(h.dataDir, `state-${VICTIM}.json`)), false, 'their history is gone');
  // The code they joined with stays burned: it was used, and freeing it would quietly widen
  // an invite-only instance.
  assert.equal(db.invites[0].usedBy, VICTIM);
  assert.equal(h.stackFrames(), 0, `no stack traces:\n${h.log}`);
});

test('their session stops working immediately', async t => {
  const h = await startServer(t);
  const before = await fetch(`${h.api}/api/me`, { headers: as(VICTIM) });
  assert.equal(before.status, 200);
  await h.del(VICTIM);
  const after = await fetch(`${h.api}/api/me`, { headers: as(VICTIM) });
  assert.equal(after.status, 401, 'a cookie for a deleted account is worthless');
});

test('refuses the two deletions that cannot be undone', async t => {
  const h = await startServer(t);
  const self = await h.del(ADMIN);
  assert.equal(self.status, 400);
  assert.match(self.body.error, /your own account/);

  const last = await h.del(ADMIN, ADMIN);   // ADMIN is also the only admin
  assert.equal(last.status, 400);
  assert.equal(h.db().users.length, 2, 'nothing was removed');
});

test('the owner can delete another admin', async t => {
  const h = await startServer(t, { twoAdmins: true });
  const res = await h.del(ADMIN2);   // ADMIN is the oldest admin record, so the owner
  assert.equal(res.status, 200);
  assert.deepEqual(h.db().users.map(u => u.id).sort(), [ADMIN, VICTIM].sort());
});

test('an admin who is not the owner cannot delete the owner or clear the log', async t => {
  const h = await startServer(t, { twoAdmins: true });
  const owner = await h.del(ADMIN, ADMIN2);
  assert.equal(owner.status, 400);
  assert.match(owner.body.error, /owner cannot be deleted/);
  const clear = await h.post('/api/admin/audit/clear', {}, ADMIN2);
  assert.equal(clear.status, 403);
  assert.equal(h.db().users.length, 3, 'nothing was removed');
  // Still an admin for everything else: an ordinary account goes.
  assert.equal((await h.del(VICTIM, ADMIN2)).status, 200);
});

test('only the owner appoints and removes admins, and can hand the role on', async t => {
  const h = await startServer(t, { twoAdmins: true });
  assert.equal((await h.post('/api/admin/user/role', { id: VICTIM, admin: true }, ADMIN2)).status, 403, 'an admin cannot appoint');
  assert.equal((await h.post('/api/admin/user/role', { id: ADMIN, admin: false }, ADMIN2)).status, 403, 'nor demote the owner');
  assert.equal((await h.post('/api/admin/user/role', { id: ADMIN, admin: false })).status, 400, 'the owner stays an admin');

  assert.equal((await h.post('/api/admin/user/role', { id: VICTIM, admin: true })).status, 200);
  assert.equal(h.db().users.find(u => u.id === VICTIM).admin, true);
  assert.equal((await h.post('/api/admin/user/role', { id: VICTIM, admin: false })).status, 200);
  assert.equal(h.db().users.find(u => u.id === VICTIM).admin, undefined);

  assert.equal((await h.post('/api/admin/owner', { id: VICTIM })).status, 400, 'only an admin can become owner');
  assert.equal((await h.post('/api/admin/owner', { id: ADMIN2 })).status, 200);
  const list = (await (await fetch(`${h.api}/api/admin/users`, { headers: as(ADMIN) })).json()).users;
  assert.deepEqual(list.filter(u => u.owner).map(u => u.id), [ADMIN2]);
  // The old owner is an admin like any other now.
  assert.equal((await h.post('/api/admin/audit/clear', {}, ADMIN)).status, 403);
  assert.equal((await h.del(ADMIN, ADMIN2)).status, 200, 'the new owner can remove them');
});

test('an admin cannot delete another admin', async t => {
  const h = await startServer(t, { twoAdmins: true });
  await h.post('/api/admin/user/role', { id: VICTIM, admin: true });
  const res = await h.del(VICTIM, ADMIN2);
  assert.equal(res.status, 403);
  assert.equal(h.db().users.length, 3);
});

test('says so plainly when the account is not there, and needs an admin', async t => {
  const h = await startServer(t);
  const missing = await h.del('nobody');
  assert.equal(missing.status, 404);
  const asVictim = await h.del(ADMIN, VICTIM);
  assert.equal(asVictim.status, 403, 'an ordinary user cannot delete anyone');
  assert.equal(h.db().users.length, 2);
});
