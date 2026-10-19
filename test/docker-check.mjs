import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { example, png } from './helpers.mjs';
import assert from 'node:assert/strict';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'parsen-docker-check-'));
const project = 'parsen-verification-' + randomUUID().slice(0, 8);
const environmentFile = path.join(directory, 'fixture.env');
await fs.writeFile(environmentFile, [
  'NODE_ENV=production', 'PARSEN_DOMAIN=dev.parsen.no', 'PARSEN_PUBLIC_URL=https://dev.parsen.no',
  'PARSEN_TRUST_PROXY=1', 'PARSEN_ADMIN_EMAIL=container@example.test', 'PARSEN_ADMIN_PASSWORD=Fixture-container-password-2026',
  'PARSEN_ADMIN_NAME=Container fixture', 'PARSEN_STORAGE_DIR=/var/lib/parsen', 'PARSEN_BACKUP_DIR=/backups'
].join('\n'));
const args = ['compose', '-p', project, '--env-file', environmentFile, '-f', 'docker-compose.production.yml', '-f', 'test/docker-compose.verify.yml'];
async function compose(...tail) {
  const task = spawn('docker', [...args, ...tail], { cwd: root, windowsHide: true, env: { ...process.env, PARSEN_ENV_FILE: environmentFile }, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '', errors = ''; task.stdout.on('data', chunk => { output += chunk; }); task.stderr.on('data', chunk => { errors += chunk; });
  const exit = await new Promise(resolve => { task.on('error', error => { errors += error.message; resolve(1); }); task.on('exit', resolve); });
  if (exit !== 0) throw new Error('Container verification failed: ' + output + errors);
  return output.trim();
}
let base, cookie = '', csrf = '';
async function request(route, { method = 'GET', body, headers = {} } = {}) {
  const response = await fetch(base + route, { method, redirect: 'manual', headers: { Host: 'localhost', ...(cookie ? { Cookie: cookie, 'X-CSRF-Token': csrf } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}), ...headers }, ...(body ? { body: JSON.stringify(body) } : {}) });
  const text = await response.text(); let data; try { data = JSON.parse(text); } catch {}
  return { status: response.status, text, data, headers: response.headers };
}
try {
  await compose('config', '--quiet');
  console.log('Starting isolated production stack with localhost HTTP proxy for verification…');
  await compose('up', '-d', '--no-build', '--wait', '--wait-timeout', '120');
  base = 'http://' + await compose('port', 'caddy', '80');
  assert.equal((await request('/api/ready')).data?.ok, true);
  const login = await request('/api/auth/login', { method: 'POST', body: { email: 'container@example.test', password: 'Fixture-container-password-2026' } });
  assert.equal(login.status, 200, login.text);
  assert.ok(login.headers.get('set-cookie')?.includes('Secure'), 'Expected a secure session cookie from the proxied backend.');
  cookie = login.headers.get('set-cookie').split(';')[0]; csrf = login.data.csrf;
  const current = await request('/api/site');
  const saved = await request('/api/site', { method: 'PUT', body: example, headers: { 'If-Match': current.headers.get('etag') } }); assert.equal(saved.status, 200, saved.text);
  const uploaded = await request('/api/media', { method: 'POST', body: { name: 'pixel.png', data: 'data:image/png;base64,' + png.toString('base64') } }); assert.equal(uploaded.status, 201);
  const publishes = await Promise.all([1, 2, 3].map(() => request('/api/publish', { method: 'POST', body: { revision: saved.data.revision } })));
  publishes.forEach(result => assert.equal(result.status, 200, result.text));
  assert.ok((await request('/')).text.includes('A saved heading'));
  assert.equal((await request('/assets/builder.js')).status, 200);
  assert.equal((await request('/.env')).status, 404);
  assert.equal((await request('/published/current.json')).status, 404);
  const token = await request('/api/contact-token?block=inquiry');
  assert.equal((await request('/api/contact', { method: 'POST', body: { token: token.data.token, name: 'Container visitor', email: 'visitor@example.test', message: 'Production stack enquiry.' } })).status, 201);
  const snapshot = JSON.parse(await compose('exec', '-T', 'studio', 'node', 'scripts/backup.mjs'));
  assert.ok(snapshot.ok);
  console.log('Proxy, secure cookies, save, upload, concurrent publication and contact inbox passed.');
  await compose('stop', 'studio', 'backup');
  await compose('run', '--rm', '--no-deps', '-e', 'PARSEN_ALLOW_RESTORE=yes', 'studio', 'node', 'scripts/restore.mjs', snapshot.backup);
  await compose('up', '-d', '--no-build', '--wait', '--wait-timeout', '120', 'studio', 'backup');
  assert.equal((await request('/api/ready')).status, 200);
  assert.ok((await request('/')).text.includes('A saved heading'));
  assert.equal((await request(uploaded.data.url)).status, 200);
  const inbox = await request('/api/messages');
  assert.equal(inbox.status, 200); assert.equal(inbox.data.messages[0].name, 'Container visitor');
  const backupLogs = await compose('logs', '--no-color', 'backup');
  assert.ok(backupLogs.includes('"ok":true'), backupLogs);
  console.log('Container volume restore, restart persistence and scheduled backup service passed.');
  console.log(JSON.stringify({ ok: true, verification: 'production Compose services and storage, localhost HTTP proxy; real-domain TLS pending', project }));
} finally {
  if (!/^parsen-verification-[a-f0-9]{8}$/.test(project)) throw new Error('Unexpected verification project.');
  await compose('down', '--volumes', '--remove-orphans').catch(error => console.error(error.message));
  if (path.dirname(directory) !== path.resolve(os.tmpdir()) || !path.basename(directory).startsWith('parsen-docker-check-')) throw new Error('Unexpected verification cleanup path.');
  await fs.rm(directory, { recursive: true, force: true });
}
