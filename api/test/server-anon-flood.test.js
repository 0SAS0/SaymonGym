/* The routes anyone can call without a session (pairing, passkey sign-in and sign-up) used to
   answer a flood of junk with a 400 and an audit row each, never a 429: a few thousand requests
   pushed every other row out of the AUDIT_MAX-capped log in seconds. And a signed-in session could
   mint pairing codes without limit, each one kept for five minutes. Real server.js in a child. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { boundPort, softPasskey } from './helpers.mjs';

const KEY = softPasskey();

const API = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const SECRET = crypto.randomBytes(32).toString('hex');

function mintSession(uid) {
  const payload = `${uid}:${Date.now() + 86400000}:0`;
  return payload + '.' + crypto.createHmac('sha256', SECRET).update(payload).digest('base64url');
}
const cookie = { Cookie: `gymsid=${mintSession('u_test_1')}` };

async function startServer(t, env = {}, profiles = [{ id: 'u_test_1', name: 'One', key: KEY }]) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gym-flood-'));
  fs.writeFileSync(path.join(dataDir, 'secret'), SECRET, { mode: 0o600 });
  fs.writeFileSync(path.join(dataDir, 'db.json'), JSON.stringify({
    users: profiles.map(({ id, name }) => ({ id, name, created: new Date().toISOString() })),
    creds: profiles.map(({ id, key }) => key.row(id)), subs: [], invites: []
  }));
  const child = spawn(process.execPath, ['server.js'], {
    cwd: API, stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, PORT: '0', DATA_DIR: dataDir, ORIGIN: 'http://localhost:8080', RP_ID: 'localhost', AUDIT_LOG: '1', ...env }
  });
  const h = { api: '', dataDir, log: '' };
  child.stdout.on('data', d => h.log += d);
  child.stderr.on('data', d => h.log += d);
  t.after(() => { child.kill('SIGKILL'); fs.rmSync(dataDir, { recursive: true, force: true }); });
  h.port = await boundPort(child, () => h.log);
  h.api = `http://127.0.0.1:${h.port}`;
  h.post = (p, body, headers = {}) => fetch(`${h.api}${p}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body || {})
  });
  h.audit = () => {
    let text = '';
    try { text = fs.readFileSync(path.join(dataDir, 'audit.log'), 'utf8'); } catch { /* none yet */ }
    return text.split('\n').filter(Boolean).map(l => JSON.parse(l));
  };
  return h;
}

test('pairing is limited even when an untrusted peer supplies changing proxy headers', async t => {
  const h = await startServer(t);
  for (let i = 0; i < 32; i++) assert.equal((await h.post('/api/pair/redeem', { code: '' })).status, 400);
  const denied = await h.post('/api/pair/redeem', {}, { 'X-Forwarded-For': '192.0.2.2', 'CF-Connecting-IP': '192.0.2.3' });
  assert.equal(denied.status, 429);
  assert.ok(+denied.headers.get('Retry-After') > 0);
  assert.equal(h.audit().filter(r => r.ev === 'auth.pair.fail').length, 10, 'ten a minute per address, not thirty');
});

test('junk passkey sign-ins and sign-ups are answered but not each written to the audit log', async t => {
  const h = await startServer(t);
  for (let i = 0; i < 25; i++) {
    assert.equal((await h.post('/api/login/verify', { cid: 'junk' + i, credential: { id: 'x' } })).status, 400);
    assert.equal((await h.post('/api/register/verify', { cid: 'junk' + i })).status, 400);
  }
  // A valid challenge with an unknown passkey is the other cheap miss.
  for (let i = 0; i < 10; i++) {
    const { cid } = await (await h.post('/api/login/options')).json();
    assert.equal((await h.post('/api/login/verify', { cid, credential: { id: 'nobody' + i } })).status, 404);
  }
  const rows = h.audit();
  assert.equal(rows.filter(r => r.ev === 'auth.login.fail').length, 10);
  assert.equal(rows.filter(r => r.ev === 'auth.register.fail').length, 10);
});

test('minting a pairing code retires the profile\'s previous one', async t => {
  const h = await startServer(t);
  // Each code asks the owner proof: a passkey assertion made for that request.
  const mint = async () => {
    const { cid, options } = await (await h.post('/api/login/options')).json();
    const body = { cid, credential: KEY.assertion(options.challenge) };
    return (await (await h.post('/api/pair/create', body, { ...cookie, Origin: 'http://localhost:8080' })).json()).code;
  };
  const first = await mint();
  const second = await mint();
  assert.notEqual(first, second);
  assert.equal((await h.post('/api/pair/redeem', { code: first })).status, 400, 'the older code is gone');
  assert.equal((await h.post('/api/pair/redeem', { code: second })).status, 200, 'the newest one works');
  assert.equal((await h.post('/api/pair/redeem', { code: second })).status, 400, 'a successful redemption consumes the code');
});

test('trusted peer addresses get separate budgets, subject to the shared global cap', async t => {
  const h = await startServer(t, { TRUST_PROXY: '1', TRUST_PROXY_PEERS: '127.0.0.1' });
  const redeem = ip => h.post('/api/pair/redeem', {}, { 'X-Forwarded-For': ip });
  for (let i = 0; i < 32; i++) assert.equal((await redeem('192.0.2.1')).status, 400);
  assert.equal((await redeem('192.0.2.1')).status, 429);
  for (let i = 2; i <= 209; i++) assert.equal((await redeem(`192.0.2.${i}`)).status, 400);
  const denied = await redeem('192.0.2.210');
  assert.equal(denied.status, 429);
  assert.ok(+denied.headers.get('Retry-After') > 0);
  assert.equal((await h.post('/api/login/options')).status, 200);
});

test('trusted proxies share the IPv4-mapped address and the IPv6 /64 budgets', async t => {
  const h = await startServer(t, { TRUST_PROXY: '1', TRUST_PROXY_PEERS: '::ffff:127.0.0.1' });
  const redeem = ip => h.post('/api/pair/redeem', {}, { 'X-Forwarded-For': ip });
  for (let i = 0; i < 32; i++) {
    assert.equal((await redeem('192.0.2.1')).status, 400);
    assert.equal((await redeem(`2001:db8:1:2::${i.toString(16)}`)).status, 400);
  }
  assert.equal((await redeem('::ffff:c000:201')).status, 429);
  assert.equal((await redeem('2001:0DB8:0001:0002::ffff')).status, 429);
  assert.equal((await redeem('2001:db8:1:3::1')).status, 400);

  for (let i = 0; i < 32; i++) assert.equal((await redeem('192.0.2.2, 192.0.2.3')).status, 400);
  assert.equal((await redeem('192.000.2.2')).status, 429, 'invalid addresses fall back to the peer');
});

test('four profiles can sign in and pair through the same NAT', async t => {
  const profiles = Array.from({ length: 4 }, (_, i) => ({ id: `u_nat_${i}`, name: `User ${i}`, key: softPasskey() }));
  const h = await startServer(t, {}, profiles);
  await Promise.all(profiles.map(async ({ id, key }) => {
    const assertion = async () => {
      const options = await h.post('/api/login/options');
      assert.equal(options.status, 200);
      const { cid, options: { challenge } } = await options.json();
      return { cid, credential: key.assertion(challenge) };
    };
    const login = await h.post('/api/login/verify', await assertion());
    assert.equal(login.status, 200);
    const session = login.headers.getSetCookie().find(value => value.startsWith('gymsid=')).split(';')[0];
    const pair = await h.post('/api/pair/create', await assertion(), { Cookie: session, Origin: 'http://localhost:8080' });
    assert.equal(pair.status, 200);
    const redeem = await h.post('/api/pair/redeem', { code: (await pair.json()).code });
    assert.equal(redeem.status, 200);
    assert.equal((await redeem.json()).user.id, id);
  }));
});
