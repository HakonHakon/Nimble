import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { scryptSync, randomBytes } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { promises as fs } from 'node:fs';
import { fixture, ownerCredentials } from './helpers.mjs';

test('account lifecycle and production provisioning boundaries', { timeout: 60000 }, async t => {
  const f = await fixture(); t.after(() => f.cleanup());
  let owner = await f.login();
  await t.test('legacy password hashes are verified and upgraded on sign-in', async () => {
    const salt = randomBytes(16), hash = scryptSync(ownerCredentials.password, salt, 64).toString('base64');
    const db = new DatabaseSync(path.join(f.storage, 'data', 'nimble.sqlite'));
    db.prepare('UPDATE users SET password_hash=?,password_salt=? WHERE email=?').run(hash, salt.toString('base64'), ownerCredentials.email);
    owner = await f.login();
    assert.ok(db.prepare('SELECT password_hash FROM users WHERE email=?').get(ownerCredentials.email).password_hash.startsWith('scrypt$131072$8$1$'));
    db.close();
  });
  await t.test('revoked admins cannot complete a queued account creation', async () => {
    const created = await f.request('/api/admin/users', { method: 'POST', auth: owner, body: { name: 'Second admin', email: 'second-admin@example.test', password: 'Secondary-admin-password-2026', role: 'admin' } });
    assert.equal(created.status, 201);
    const second = await f.login({ email: 'second-admin@example.test', password: 'Secondary-admin-password-2026' });
    const queued = f.request('/api/admin/users', { method: 'POST', auth: second, body: { name: 'Queued member', email: 'queued@example.test', password: 'Queued-member-password-2026', role: 'admin' } });
    const changed = await f.request('/api/admin/users/' + created.data.user.id, { method: 'PATCH', auth: owner, body: { role: 'viewer' } });
    assert.equal(changed.status, 200);
    assert.equal((await queued).status, 401);
    const users = (await f.request('/api/admin/users', { auth: owner })).data.users;
    assert.ok(!users.some(user => user.email === 'queued@example.test'));
  });
  await t.test('host-side owner recovery revokes browser sessions', async () => {
    const recovered = await f.runScript('reset-owner.mjs', [], { NIMBLE_OWNER_NEW_PASSWORD: 'Recovered-owner-password-2026' });
    assert.equal(recovered.exit, 0, recovered.output);
    assert.equal((await f.request('/api/auth/me', { auth: owner })).status, 401);
    owner = await f.login({ email: ownerCredentials.email, password: 'Recovered-owner-password-2026' });
    assert.equal(owner.result.data.role, 'owner');
  });
  await t.test('first-run setup requires a private token and provisions only one owner', async () => {
    await f.stop();
    await f.start({ NIMBLE_STORAGE_DIR: path.join(f.directory, 'setup-storage'), NIMBLE_ADMIN_EMAIL: '', NIMBLE_ADMIN_PASSWORD: '', NIMBLE_SETUP_TOKEN: 'private-fixture-setup-token' });
    const request = { name: 'New owner', email: 'new-owner@example.test', password: 'New-fixture-owner-password-2026', setupToken: 'private-fixture-setup-token' };
    assert.equal((await f.request('/api/auth/setup', { method: 'POST', body: { ...request, setupToken: '' } })).status, 403);
    const results = await Promise.all([request, { ...request, email: 'second-owner@example.test' }].map(body => f.request('/api/auth/setup', { method: 'POST', body })));
    assert.deepEqual(results.map(response => response.status).sort(), [201, 409]);
    assert.equal((await f.request('/api/auth/setup-status')).data.setupRequired, false);
  });
  await t.test('production refuses an unprovisioned publicly claimable instance', async () => {
    await f.stop();
    const task = spawn(process.execPath, ['server.mjs'], { cwd: f.app, windowsHide: true, env: { ...process.env, NODE_ENV: 'production', NIMBLE_PUBLIC_URL: 'https://dev.nimble.no', NIMBLE_STORAGE_DIR: path.join(f.directory, 'unprovisioned'), NIMBLE_ADMIN_EMAIL: '', NIMBLE_ADMIN_PASSWORD: '', NIMBLE_SETUP_TOKEN: '' }, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = ''; task.stdout.on('data', chunk => { output += chunk; }); task.stderr.on('data', chunk => { output += chunk; });
    const exit = await new Promise(resolve => task.once('exit', resolve));
    assert.notEqual(exit, 0); assert.ok(output.includes('Provision NIMBLE_ADMIN_EMAIL'));
  });
  await t.test('backup retention preserves recent snapshots and rejects invalid settings', async () => {
    const root = path.join(f.directory, 'retention');
    await fs.mkdir(path.join(root, 'unrelated'), { recursive: true });
    for (const day of [15, 16, 17]) {
      const directory = path.join(root, 'nimble-2026-10-' + day + 'T00-00-00-000Z-00000001');
      await fs.mkdir(directory);
      await fs.writeFile(path.join(directory, 'manifest.json'), JSON.stringify({ application: 'nimble-studio', format: 2, createdAt: '2026-10-' + day + 'T00:00:00.000Z' }));
    }
    const result = await f.runScript('prune-backups.mjs', [], { NIMBLE_BACKUP_DIR: root, NIMBLE_BACKUP_RETENTION_COUNT: '2' });
    assert.equal(result.exit, 0, result.output); assert.deepEqual(JSON.parse(result.output), { retained: 2, removed: 1 });
    const remaining = await fs.readdir(root); assert.ok(remaining.includes('unrelated')); assert.ok(!remaining.some(name => name.includes('10-15')));
    const invalid = await f.runScript('prune-backups.mjs', [], { NIMBLE_BACKUP_DIR: root, NIMBLE_BACKUP_RETENTION_COUNT: 'not-a-number' });
    assert.notEqual(invalid.exit, 0); assert.deepEqual(await fs.readdir(root), remaining);
  });
});
