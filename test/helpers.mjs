import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

export const sourceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const ownerCredentials = { email: 'owner@example.test', password: 'Fixture-owner-password-2026' };
export const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');
export const example = {
  site: { name: 'Saved site', description: 'Our saved description', headingFont: 'serif', bodyFont: 'sans', rounded: false, searchVisible: false },
  theme: 'mint', assets: [],
  pages: [{ id: 'home', name: 'Home', path: '/', blocks: ['intro', 'clip', 'inquiry', 'columns', 'quote', 'gallery', 'button', 'image', 'split', 'services', 'cta'] }, { id: 'about', name: 'About', path: '/about', blocks: ['intro'] }],
  blocks: {
    intro: { type: 'hero', title: 'A saved heading', text: 'A saved paragraph', button: 'About us', buttonLink: '/about', bg: '#fff8ed' },
    clip: { type: 'video', title: 'Our clip', videoUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ' },
    inquiry: { type: 'form', title: 'Contact the team' },
    columns: { type: 'columns', title: 'Three columns', cards: [['One', 'First column'], ['Two', 'Second column'], ['Three', 'Third column']] },
    quote: { type: 'quote', text: 'A thoughtful quote.', author: 'Our customer' },
    gallery: { type: 'gallery', images: [] },
    button: { type: 'button', label: 'Email us', buttonLink: 'mailto:team@example.test' },
    image: { type: 'image', image: 'https://example.test/photo.jpg', alt: 'An image description' },
    split: { type: 'split', title: 'Split layout', text: 'Split text', image: 'https://example.test/photo.jpg', button: 'Read more', buttonLink: '/about' },
    services: { type: 'services', title: 'Services', cards: [['Design', 'With care']] },
    cta: { type: 'cta', title: 'Your next step', button: 'Contact', buttonLink: '#inquiry' }
  }
};
export async function fixture() {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'nimble-release-test-'));
  const app = path.join(directory, 'app'), storage = path.join(directory, 'storage'), backupDir = path.join(directory, 'backups');
  await fs.mkdir(app);
  for (const entry of ['server.mjs', 'package.json', 'lib', 'scripts', 'assets', 'builder.html', 'login.html', 'control-panel.html']) await fs.cp(path.join(sourceRoot, entry), path.join(app, entry), { recursive: true });
  await fs.writeFile(path.join(app, '.env'), 'SYNTHETIC_SECRET=never-expose');
  await fs.mkdir(path.join(app, 'backups')); await fs.writeFile(path.join(app, 'backups', 'fixture.sqlite'), 'synthetic-backup');
  let child, base, logs;
  async function start(overrides = {}) {
    logs = '';
    child = spawn(process.execPath, ['server.mjs'], { cwd: app, windowsHide: true, env: { ...process.env, NODE_ENV: 'development', HOST: '127.0.0.1', PORT: '0', NIMBLE_STORAGE_DIR: storage, NIMBLE_BACKUP_DIR: backupDir, NIMBLE_PUBLIC_URL: '', NIMBLE_TRUST_PROXY: '0', NIMBLE_ADMIN_EMAIL: ownerCredentials.email, NIMBLE_ADMIN_PASSWORD: ownerCredentials.password, NIMBLE_ADMIN_NAME: 'Fixture owner', ...overrides }, stdio: ['ignore', 'pipe', 'pipe'] });
    child.stdout.on('data', chunk => { logs += chunk; }); child.stderr.on('data', chunk => { logs += chunk; });
    for (let i = 0; i < 150; i++) {
      const port = logs.match(/http:\/\/localhost:(\d+)/)?.[1];
      if (port) { base = 'http://127.0.0.1:' + port; return; }
      if (child.exitCode !== null) throw new Error('Test server exited: ' + logs);
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    throw new Error('Test server did not start: ' + logs);
  }
  async function stop() {
    if (!child || child.exitCode !== null || child.signalCode !== null) { child = null; return; }
    const current = child;
    const ended = new Promise(resolve => current.once('exit', resolve));
    current.kill();
    await ended;
    child = null;
  }
  async function request(route, { method = 'GET', body, auth, headers = {} } = {}) {
    const response = await fetch(base + route, { method, redirect: 'manual', headers: { ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...(auth ? { Cookie: auth.cookie, 'X-CSRF-Token': auth.csrf } : {}), ...headers }, ...(body === undefined ? {} : { body: typeof body === 'string' ? body : JSON.stringify(body) }) });
    const text = await response.text(); let data;
    try { data = JSON.parse(text); } catch {}
    return { status: response.status, data, text, headers: response.headers };
  }
  async function login(credentials = ownerCredentials) {
    const result = await request('/api/auth/login', { method: 'POST', body: credentials });
    if (result.status !== 200) throw new Error('Fixture login failed: ' + result.status + ' ' + result.text);
    return { cookie: result.headers.get('set-cookie').split(';')[0], csrf: result.data.csrf, result };
  }
  async function save(auth, document) {
    const current = await request('/api/site', { auth });
    return request('/api/site', { method: 'PUT', body: document, auth, headers: { 'If-Match': current.headers.get('etag') } });
  }
  async function runScript(script, args = [], environment = {}) {
    const task = spawn(process.execPath, [path.join(app, 'scripts', script), ...args], { cwd: app, windowsHide: true, env: { ...process.env, NIMBLE_STORAGE_DIR: storage, NIMBLE_BACKUP_DIR: backupDir, ...environment }, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = ''; task.stdout.on('data', chunk => { output += chunk; }); task.stderr.on('data', chunk => { output += chunk; });
    const exit = await new Promise(resolve => task.once('exit', resolve));
    return { exit, output };
  }
  async function cleanup() {
    await stop();
    if (path.dirname(directory) !== path.resolve(os.tmpdir()) || !path.basename(directory).startsWith('nimble-release-test-')) throw new Error('Unexpected cleanup directory.');
    await fs.rm(directory, { recursive: true, force: true });
  }
  await start();
  return { get base() { return base; }, get logs() { return logs; }, directory, app, storage, backupDir, start, stop, request, login, save, runScript, cleanup };
}
