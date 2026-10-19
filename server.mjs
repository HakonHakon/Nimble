import http from 'node:http';
import { promises as fs, createReadStream } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes, randomUUID, createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { isIP } from 'node:net';
import { DatabaseSync } from 'node:sqlite';
import { normalizeSite, makeDefaultSite, escapeHtml } from './lib/site-model.mjs';
import { publishAtomic, currentRelease } from './lib/publish-atomic.mjs';
import { pageHtml } from './lib/render.mjs';
import { validPassword, passwordHash, checkPassword } from './lib/passwords.mjs';

const root = path.dirname(fileURLToPath(import.meta.url));
const storage = path.resolve(process.env.NIMBLE_STORAGE_DIR || root);
const dataDir = path.join(storage, 'data'), uploads = path.join(storage, 'uploads'), published = path.join(storage, 'published');
const production = process.env.NODE_ENV === 'production';
const port = Number(process.env.PORT ?? 4173);
const host = process.env.HOST || (production ? '0.0.0.0' : '127.0.0.1');
const publicOrigin = process.env.NIMBLE_PUBLIC_URL ? new URL(process.env.NIMBLE_PUBLIC_URL).origin : '';
const sessionDays = Number(process.env.NIMBLE_SESSION_DAYS || 7);
const maxDocumentBytes = Number(process.env.NIMBLE_MAX_DOCUMENT_BYTES || 2_000_000);
const maxMediaBytes = 15 * 1024 * 1024;
const maxStorageBytes = Number(process.env.NIMBLE_MEDIA_QUOTA_BYTES || 1024 * 1024 * 1024);
if (!Number.isInteger(sessionDays) || sessionDays < 1 || sessionDays > 30) throw new Error('Session lifetime must be 1–30 days.');
if (!Number.isInteger(maxDocumentBytes) || maxDocumentBytes < 10000 || maxDocumentBytes > 12000000) throw new Error('Site document limit must be 10,000–12,000,000 bytes.');
if (!Number.isSafeInteger(maxStorageBytes) || maxStorageBytes < 1) throw new Error('Media quota must be a positive integer.');
if (production && (!publicOrigin || !publicOrigin.startsWith('https://'))) throw new Error('Production requires NIMBLE_PUBLIC_URL=https://your-domain.');
await Promise.all([dataDir, uploads, published].map(directory => fs.mkdir(directory, { recursive: true })));
const db = new DatabaseSync(path.join(dataDir, 'nimble.sqlite'));
db.exec('PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;');
db.exec([
  "CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY AUTOINCREMENT,name TEXT NOT NULL,email TEXT NOT NULL UNIQUE COLLATE NOCASE,password_hash TEXT NOT NULL,password_salt TEXT NOT NULL,role TEXT NOT NULL DEFAULT 'user' CHECK(role IN ('admin','user')),created_at TEXT NOT NULL);",
  'CREATE TABLE IF NOT EXISTS sessions (token_hash TEXT PRIMARY KEY,user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,csrf_token TEXT NOT NULL,expires_at INTEGER NOT NULL,created_at TEXT NOT NULL);',
  'CREATE TABLE IF NOT EXISTS sites (id TEXT PRIMARY KEY,owner_id INTEGER NOT NULL REFERENCES users(id),document_json TEXT NOT NULL,updated_at TEXT NOT NULL,revision INTEGER NOT NULL DEFAULT 1);',
  "CREATE TABLE IF NOT EXISTS site_members (site_id TEXT NOT NULL REFERENCES sites(id) ON DELETE CASCADE,user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,role TEXT NOT NULL CHECK(role IN ('owner','admin','editor','viewer')),created_at TEXT NOT NULL,PRIMARY KEY(site_id,user_id));",
  "CREATE TABLE IF NOT EXISTS templates (id TEXT PRIMARY KEY,site_id TEXT NOT NULL REFERENCES sites(id) ON DELETE CASCADE,name TEXT NOT NULL COLLATE NOCASE,description TEXT NOT NULL DEFAULT '',document_json TEXT NOT NULL,created_at TEXT NOT NULL,updated_at TEXT NOT NULL,UNIQUE(site_id,name));",
  'CREATE TABLE IF NOT EXISTS audit_events (id INTEGER PRIMARY KEY AUTOINCREMENT,user_id INTEGER,action TEXT NOT NULL,metadata_json TEXT,created_at TEXT NOT NULL);',
  'CREATE TABLE IF NOT EXISTS messages (id INTEGER PRIMARY KEY AUTOINCREMENT,name TEXT NOT NULL,email TEXT NOT NULL,message TEXT NOT NULL,page_id TEXT NOT NULL,created_at TEXT NOT NULL);',
  'CREATE TABLE IF NOT EXISTS app_settings (key TEXT PRIMARY KEY,value TEXT NOT NULL);',
  'CREATE INDEX IF NOT EXISTS sessions_expiry ON sessions(expires_at);',
  'CREATE INDEX IF NOT EXISTS messages_created ON messages(created_at);'
].join('\n'));
if (!db.prepare('PRAGMA table_info(sites)').all().some(column => column.name === 'revision')) db.exec('ALTER TABLE sites ADD COLUMN revision INTEGER NOT NULL DEFAULT 1');
db.prepare('INSERT OR IGNORE INTO app_settings (key,value) VALUES (?,?)').run('contact_secret', randomBytes(32).toString('hex'));
const contactSecret = db.prepare('SELECT value FROM app_settings WHERE key=?').get('contact_secret').value;
const hash = value => createHash('sha256').update(value).digest('hex');
const timestamp = () => new Date().toISOString();
const problem = (statusCode, message) => Object.assign(new Error(message), { statusCode });
const equal = (left, right) => {
  const a = Buffer.from(String(left || '')), b = Buffer.from(String(right || ''));
  return a.length === b.length && timingSafeEqual(a, b);
};
const emailValue = value => String(value || '').trim().toLowerCase();
const validEmail = value => value.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
const userPublic = id => db.prepare('SELECT id,name,email,role,created_at FROM users WHERE id=?').get(id);
const userRaw = email => db.prepare('SELECT * FROM users WHERE email=?').get(emailValue(email));
const siteRow = () => db.prepare("SELECT * FROM sites WHERE id='nimble'").get();
const audit = (userId, action, metadata = {}) => db.prepare('INSERT INTO audit_events(user_id,action,metadata_json,created_at) VALUES(?,?,?,?)').run(userId, action, JSON.stringify(metadata), timestamp());
function transaction(operation) {
  db.exec('BEGIN IMMEDIATE');
  try { const result = operation(); db.exec('COMMIT'); return result; } catch (error) { db.exec('ROLLBACK'); throw error; }
}
function createUser({ name, email, password, role = 'user' }, credentials) {
  const normalized = emailValue(email);
  if (typeof name !== 'string' || !name.trim() || name.length > 120 || !validEmail(normalized) || !validPassword(password)) throw problem(400, 'A name, valid email, and a 12–256 character password are required.');
  const result = db.prepare('INSERT INTO users(name,email,password_hash,password_salt,role,created_at) VALUES(?,?,?,?,?,?)').run(name.trim(), normalized, credentials.hash, credentials.salt, role, timestamp());
  return userPublic(Number(result.lastInsertRowid));
}
async function initialDocument() {
  try { return normalizeSite(JSON.parse(await fs.readFile(path.join(dataDir, 'site.json'), 'utf8'))); }
  catch (error) { if (error.code !== 'ENOENT') console.warn('Legacy document was preserved; review it before importing.'); return makeDefaultSite(); }
}
function createSite(ownerId, document) {
  const existing = siteRow();
  if (!existing) db.prepare('INSERT INTO sites(id,owner_id,document_json,updated_at,revision) VALUES(?,?,?,?,1)').run('nimble', ownerId, JSON.stringify(document), timestamp());
  const owner = siteRow().owner_id;
  db.prepare("INSERT INTO site_members(site_id,user_id,role,created_at) VALUES('nimble',?,'owner',?) ON CONFLICT(site_id,user_id) DO UPDATE SET role='owner'").run(owner, timestamp());
  db.prepare("INSERT OR IGNORE INTO site_members(site_id,user_id,role,created_at) SELECT 'nimble',id,CASE WHEN role='admin' THEN 'admin' ELSE 'viewer' END,created_at FROM users").run();
}
if (!db.prepare('SELECT id FROM users LIMIT 1').get()) {
  const email = process.env.NIMBLE_ADMIN_EMAIL, password = process.env.NIMBLE_ADMIN_PASSWORD;
  if (email && password) {
    if (production && /replace-with|test-only|example-password/i.test(password)) throw new Error('Replace the example admin password before production.');
    const credentials = await passwordHash(password), document = await initialDocument();
    transaction(() => { const user = createUser({ name: process.env.NIMBLE_ADMIN_NAME || 'Nimble owner', email, password, role: 'admin' }, credentials); createSite(user.id, document); audit(user.id, 'owner_provisioned'); });
  } else if (production && !process.env.NIMBLE_SETUP_TOKEN) throw new Error('Provision NIMBLE_ADMIN_EMAIL/NIMBLE_ADMIN_PASSWORD or a private NIMBLE_SETUP_TOKEN before production startup.');
} else {
  const owner = siteRow()?.owner_id || db.prepare("SELECT id FROM users WHERE role='admin' ORDER BY id LIMIT 1").get()?.id;
  if (!owner) throw new Error('No site owner exists. Restore a valid account database.');
  const document = await initialDocument();
  transaction(() => createSite(owner, document));
}
const roleFor = user => siteRow()?.owner_id === user.id ? 'owner' : db.prepare("SELECT role FROM site_members WHERE site_id='nimble' AND user_id=?").get(user.id)?.role || null;
const roleRank = { viewer: 1, editor: 2, admin: 3, owner: 4 };
function cookieToken(req) {
  try { return decodeURIComponent(String(req.headers.cookie || '').split(';').map(part => part.trim()).find(part => part.startsWith('nimble_session='))?.slice(15) || ''); } catch { return ''; }
}
function identity(req) {
  const token = cookieToken(req);
  if (!/^[a-f0-9]{64}$/.test(token)) return null;
  const session = db.prepare('SELECT * FROM sessions WHERE token_hash=? AND expires_at>?').get(hash(token), Date.now());
  const user = session && userPublic(session.user_id);
  return user ? { user, session, role: roleFor(user) } : null;
}
function requireAccess(req, permission = 'view', csrf = false) {
  const auth = identity(req);
  if (!auth) throw problem(401, 'Sign in to continue.');
  const minimum = permission === 'users' ? 3 : ['edit', 'publish', 'messages'].includes(permission) ? 2 : 1;
  if ((roleRank[auth.role] || 0) < minimum) throw problem(403, 'Your account does not have access to this action.');
  if (csrf && !equal(req.headers['x-csrf-token'], auth.session.csrf_token)) throw problem(403, 'Your session changed. Reload before trying again.');
  return auth;
}
function createSession(userId) {
  const token = randomBytes(32).toString('hex'), csrf = randomBytes(24).toString('hex');
  db.prepare('DELETE FROM sessions WHERE expires_at<?').run(Date.now());
  db.prepare('INSERT INTO sessions VALUES(?,?,?,?,?)').run(hash(token), userId, csrf, Date.now() + sessionDays * 86400000, timestamp());
  return { token, csrf };
}
function sessionCookie(res, token = '') {
  res.setHeader('Set-Cookie', 'nimble_session=' + token + '; Path=/; HttpOnly; SameSite=Lax; Max-Age=' + (token ? sessionDays * 86400 : 0) + (production ? '; Secure' : ''));
}
const rates = new Map();
function clientIP(req) {
  const forwarded = String(req.headers['x-real-ip'] || '');
  return process.env.NIMBLE_TRUST_PROXY === '1' && isIP(forwarded) ? forwarded : req.socket.remoteAddress;
}
function rate(key, limit, windowMs = 15 * 60000) {
  const now = Date.now();
  let item = rates.get(key);
  if (!item || item.until <= now) { item = { count: 0, until: now + windowMs }; rates.set(key, item); }
  if (++item.count > limit) throw problem(429, 'Too many requests. Please try again later.');
  if (rates.size > 10000) { for (const [id, value] of rates) if (value.until < now) rates.delete(id); if (rates.size > 10000) rates.delete(rates.keys().next().value); }
}
async function readBody(req, limit = maxDocumentBytes, form = false) {
  const type = String(req.headers['content-type'] || '').split(';')[0];
  if (type !== 'application/json' && !(form && type === 'application/x-www-form-urlencoded')) throw problem(415, 'Send JSON with Content-Type: application/json.');
  if (Number(req.headers['content-length'] || 0) > limit) { req.resume(); throw problem(413, 'This request is too large.'); }
  const chunks = []; let size = 0;
  for await (const chunk of req) { size += chunk.length; if (size > limit) throw problem(413, 'This request is too large.'); chunks.push(chunk); }
  const text = Buffer.concat(chunks).toString('utf8');
  try {
    const value = type === 'application/json' ? JSON.parse(text || '{}') : Object.fromEntries(new URLSearchParams(text));
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error();
    return value;
  } catch { throw problem(400, 'The request body is invalid.'); }
}
function headers(res, nonce = '') {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'" + (nonce ? " 'nonce-" + nonce + "'" : '') + "; style-src 'self' 'unsafe-inline'; img-src 'self' https: data:; media-src 'self' https:; frame-src https://www.youtube-nocookie.com https://player.vimeo.com; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'");
  if (production) res.setHeader('Strict-Transport-Security', 'max-age=31536000');
}
function send(res, status, body, type = 'application/json; charset=utf-8') {
  res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store, no-transform' });
  res.end(type.startsWith('application/json') ? JSON.stringify(body) : body);
}
function redirect(res, location) { res.writeHead(302, { Location: location, 'Cache-Control': 'no-store' }); res.end(); }
function canonicalPath(req) {
  let value;
  try { value = decodeURIComponent(String(req.url || '/').split('?')[0]); } catch { throw problem(400, 'Invalid address.'); }
  if (!value.startsWith('/') || /[\\\u0000-\u0020\u007f%]/.test(value) || value.includes('//') || value.split('/').some(part => part === '..' || part === '.' || part.startsWith('.'))) throw problem(404, 'Not found.');
  return value;
}
function sameOrigin(req) {
  if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) return;
  const expected = publicOrigin || 'http://' + req.headers.host;
  if (req.headers['sec-fetch-site'] === 'cross-site' || (req.headers.origin && req.headers.origin !== expected)) throw problem(403, 'Submit this request from the site itself.');
}
function savedDocument(req, input) {
  const document = normalizeSite(input);
  if (Buffer.byteLength(JSON.stringify(document)) > maxDocumentBytes) throw problem(413, 'The site document is too large.');
  return transaction(() => {
    requireAccess(req, 'edit', true);
    const row = siteRow();
    const expected = req.headers['if-match'];
    if (expected === undefined) throw problem(428, 'Reload the latest site before saving.');
    if (expected !== '"' + row.revision + '"') throw problem(409, 'Someone else saved a newer version. Reload before saving your changes.');
    const json = JSON.stringify(document);
    if (json !== row.document_json) {
      db.prepare("UPDATE sites SET document_json=?,revision=revision+1,updated_at=? WHERE id='nimble'").run(json, timestamp());
    }
    return siteRow();
  });
}
function templatePublic(row) {
  return { id: row.id, name: row.name, description: row.description, document: JSON.parse(row.document_json), created_at: row.created_at, updated_at: row.updated_at };
}
function templateInput(body, current = null) {
  const name = body.name === undefined ? current?.name || '' : String(body.name || '').trim();
  const description = body.description === undefined ? current?.description || '' : String(body.description || '').trim();
  if (!name || name.length > 120) throw problem(400, 'Template names must be 1–120 characters.');
  if (description.length > 500) throw problem(400, 'Template descriptions must be at most 500 characters.');
  const source = body.document === undefined ? current ? JSON.parse(current.document_json) : null : body.document;
  if (!source || typeof source !== 'object' || Array.isArray(source)) throw problem(400, 'A saved template needs a valid site document.');
  const document = normalizeSite(source);
  if (Buffer.byteLength(JSON.stringify(document)) > maxDocumentBytes) throw problem(413, 'The template document is too large.');
  return { name, description, document };
}
function templateRow(id) { return db.prepare("SELECT * FROM templates WHERE id=? AND site_id='nimble'").get(id); }
const mime = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif', '.mp4': 'video/mp4', '.webm': 'video/webm' };
async function sendFile(req, res, filename, { html = false, immutable = false } = {}) {
  const info = await fs.stat(filename);
  if (!info.isFile()) throw problem(404, 'Not found.');
  if (html) {
    const nonce = randomBytes(18).toString('base64');
    headers(res, nonce);
    const body = (await fs.readFile(filename, 'utf8')).replace(/<script\b/g, '<script nonce="' + nonce + '"');
    return send(res, 200, body, mime['.html']);
  }
  let start = 0, end = info.size - 1, status = 200;
  res.setHeader('Accept-Ranges', 'bytes');
  if (req.headers.range) {
    const match = String(req.headers.range).match(/^bytes=(\d*)-(\d*)$/);
    if (!match || (!match[1] && !match[2])) throw problem(416, 'Invalid media range.');
    if (!match[1]) start = Math.max(0, info.size - Number(match[2]));
    else { start = Number(match[1]); if (match[2]) end = Math.min(end, Number(match[2])); }
    if (start > end || start >= info.size) { res.setHeader('Content-Range', 'bytes */' + info.size); throw problem(416, 'Invalid media range.'); }
    res.setHeader('Content-Range', 'bytes ' + start + '-' + end + '/' + info.size);
    status = 206;
  }
  res.writeHead(status, { 'Content-Type': mime[path.extname(filename)] || 'application/octet-stream', 'Content-Length': Math.max(0, end - start + 1), 'Cache-Control': immutable ? 'public, max-age=31536000, immutable' : 'no-cache' });
  if (req.method === 'HEAD' || info.size === 0) return res.end();
  const stream = createReadStream(filename, { start, end });
  stream.on('error', () => res.destroy());
  stream.pipe(res);
}
function detectMedia(bytes, type) {
  if (type === 'image/png' && bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10])) && bytes.length >= 24) return 'png';
  if (type === 'image/jpeg' && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return 'jpg';
  if (type === 'image/gif' && /^GIF8[79]a$/.test(bytes.subarray(0, 6).toString())) return 'gif';
  if (type === 'image/webp' && bytes.subarray(0, 4).toString() === 'RIFF' && bytes.subarray(8, 12).toString() === 'WEBP') return 'webp';
  if (type === 'video/mp4' && bytes.subarray(4, 8).toString() === 'ftyp') return 'mp4';
  if (type === 'video/webm' && bytes.subarray(0, 4).equals(Buffer.from([26,69,223,163]))) return 'webm';
  throw problem(400, 'The file contents do not match a supported image or video format.');
}
let mediaQueue = Promise.resolve();
async function storeMedia(body) {
  const match = String(body.data || '').match(/^data:(image\/(?:png|jpeg|webp|gif)|video\/(?:mp4|webm));base64,([a-z0-9+/]+={0,2})$/i);
  if (!match || match[2].length > Math.ceil(maxMediaBytes / 3) * 4) throw problem(400, 'Upload an image or video no larger than 15 MB.');
  const bytes = Buffer.from(match[2], 'base64');
  if (bytes.toString('base64') !== match[2] || bytes.length > maxMediaBytes) throw problem(400, 'Invalid media encoding or file size.');
  const extension = detectMedia(bytes, match[1].toLowerCase());
  const task = mediaQueue.catch(() => {}).then(async () => {
    const files = await fs.readdir(uploads, { withFileTypes: true });
    const sizes = await Promise.all(files.filter(file => file.isFile()).map(async file => (await fs.stat(path.join(uploads, file.name))).size));
    if (sizes.reduce((sum, size) => sum + size, 0) + bytes.length > maxStorageBytes) throw problem(413, 'Your media storage is full. Contact the site administrator.');
    const filename = randomUUID() + '.' + extension;
    await fs.writeFile(path.join(uploads, filename), bytes, { flag: 'wx' });
    return { url: '/uploads/' + filename, name: String(body.name || 'Media').slice(0, 200), kind: match[1].startsWith('video') ? 'video' : 'image' };
  });
  mediaQueue = task;
  return task;
}
function contactToken(block) {
  const payload = Buffer.from(JSON.stringify({ block, expires: Date.now() + 3600000, nonce: randomBytes(8).toString('hex') })).toString('base64url');
  return payload + '.' + createHmac('sha256', contactSecret).update(payload).digest('base64url');
}
function verifyContactToken(token) {
  const [payload, signature, extra] = String(token || '').split('.');
  if (!payload || !signature || extra || !equal(signature, createHmac('sha256', contactSecret).update(payload).digest('base64url'))) throw problem(400, 'Reload the page before sending your message.');
  let parsed;
  try { parsed = JSON.parse(Buffer.from(payload, 'base64url').toString()); } catch { throw problem(400, 'Invalid contact form.'); }
  if (parsed.expires < Date.now()) throw problem(400, 'This contact form has expired. Reload and try again.');
  return parsed;
}
const assets = new Map([
  ['/assets/builder.js', 'assets/builder.js'], ['/assets/control-panel.js', 'assets/control-panel.js'],
  ['/assets/login.js', 'assets/login.js'], ['/assets/public.js', 'assets/public.js'],
  ['/assets/public.css', 'assets/public.css'], ['/assets/editor.css', 'assets/editor.css'],
  ['/assets/site-model.mjs', 'lib/site-model.mjs'], ['/assets/render.mjs', 'lib/render.mjs']
]);
const server = http.createServer(async (req, res) => {
  headers(res);
  try {
    const pathname = canonicalPath(req);
    const url = new URL(req.url, 'http://localhost');
    sameOrigin(req);
    const method = req.method;
    if (pathname === '/api/health' && method === 'GET') return send(res, 200, { ok: true });
    if (pathname === '/api/ready' && method === 'GET') {
      const row = siteRow();
      await Promise.all([dataDir, uploads, published].map(async directory => { const test = path.join(directory, '.ready-' + randomUUID()); await fs.writeFile(test, ''); await fs.unlink(test); }));
      return send(res, row ? 200 : 503, { ok: Boolean(row), application: 'nimble-studio', setupRequired: !row });
    }
    if (pathname === '/api/auth/setup-status' && method === 'GET') return send(res, 200, { setupRequired: !siteRow(), tokenRequired: production || Boolean(process.env.NIMBLE_SETUP_TOKEN) });
    if (pathname === '/api/auth/setup' && method === 'POST') {
      rate('setup:' + clientIP(req), 10);
      const body = await readBody(req, 10000);
      const setupToken = process.env.NIMBLE_SETUP_TOKEN;
      if ((production || setupToken) && !equal(body.setupToken, setupToken)) throw problem(403, 'Use the private setup token supplied by the site administrator.');
      if (siteRow()) throw problem(409, 'Owner setup is already complete.');
      if (!validPassword(body.password)) throw problem(400, 'Use a password of 12–256 characters.');
      const credentials = await passwordHash(body.password), document = await initialDocument();
      const user = transaction(() => {
        if (db.prepare('SELECT id FROM users LIMIT 1').get()) throw problem(409, 'Owner setup is already complete.');
        const account = createUser({ ...body, role: 'admin' }, credentials);
        createSite(account.id, document); audit(account.id, 'owner_provisioned'); return account;
      });
      const session = createSession(user.id); sessionCookie(res, session.token);
      return send(res, 201, { user, csrf: session.csrf, role: 'owner' });
    }
    if (pathname === '/api/auth/login' && method === 'POST') {
      rate('login-ip:' + clientIP(req), 60);
      const body = await readBody(req, 10000);
      const email = emailValue(body.email);
      rate('login-account:' + email, 12);
      const user = userRaw(email);
      if (!await checkPassword(body.password, user)) throw problem(401, 'Email or password is incorrect.');
      if (userRaw(email)?.password_hash !== user.password_hash) throw problem(401, 'Your credentials changed. Sign in again.');
      if (!user.password_hash.startsWith('scrypt$')) {
        const upgraded = await passwordHash(body.password);
        const updated = db.prepare('UPDATE users SET password_hash=?,password_salt=? WHERE id=? AND password_hash=?').run(upgraded.hash, upgraded.salt, user.id, user.password_hash);
        if (!updated.changes) throw problem(401, 'Your credentials changed. Sign in again.');
      }
      rates.delete('login-account:' + email);
      const session = createSession(user.id); sessionCookie(res, session.token); audit(user.id, 'login');
      return send(res, 200, { user: userPublic(user.id), csrf: session.csrf, role: roleFor(user) });
    }
    if (pathname === '/api/auth/me' && method === 'GET') {
      const auth = requireAccess(req);
      return send(res, 200, { user: auth.user, csrf: auth.session.csrf_token, role: auth.role });
    }
    if (pathname === '/api/auth/logout' && method === 'POST') {
      const auth = requireAccess(req, 'view', true);
      db.prepare('DELETE FROM sessions WHERE token_hash=?').run(auth.session.token_hash); sessionCookie(res);
      return send(res, 200, { ok: true });
    }
    if (pathname === '/api/auth/password' && method === 'POST') {
      const auth = requireAccess(req, 'view', true); rate('password:' + auth.user.id, 8);
      const body = await readBody(req, 10000);
      if (!validPassword(body.password)) throw problem(400, 'Use a password of 12–256 characters.');
      const previous = userRaw(auth.user.email);
      if (!await checkPassword(body.currentPassword, previous)) throw problem(403, 'Your current password is incorrect.');
      const credentials = await passwordHash(body.password);
      transaction(() => {
        requireAccess(req, 'view', true);
        const result = db.prepare('UPDATE users SET password_hash=?,password_salt=? WHERE id=? AND password_hash=?').run(credentials.hash, credentials.salt, auth.user.id, previous.password_hash);
        if (!result.changes) throw problem(409, 'Your credentials changed. Sign in again.');
        db.prepare('DELETE FROM sessions WHERE user_id=?').run(auth.user.id); audit(auth.user.id, 'password_changed');
      });
      const session = createSession(auth.user.id); sessionCookie(res, session.token);
      return send(res, 200, { csrf: session.csrf });
    }
    if (pathname === '/api/site' && method === 'GET') {
      const auth = requireAccess(req), row = siteRow();
      res.setHeader('ETag', '"' + row.revision + '"');
      return send(res, 200, { site: JSON.parse(row.document_json), revision: row.revision, role: auth.role });
    }
    if (pathname === '/api/site' && method === 'PUT') {
      const auth = requireAccess(req, 'edit', true);
      const row = savedDocument(req, await readBody(req)); audit(auth.user.id, 'site_saved', { revision: row.revision });
      res.setHeader('ETag', '"' + row.revision + '"');
      return send(res, 200, { site: JSON.parse(row.document_json), revision: row.revision });
    }
    if (pathname === '/api/templates' && method === 'GET') {
      requireAccess(req, 'edit');
      const templates = db.prepare("SELECT id,name,description,document_json,created_at,updated_at FROM templates WHERE site_id='nimble' ORDER BY updated_at DESC,name ASC").all().map(templatePublic);
      return send(res, 200, { templates });
    }
    if (pathname === '/api/templates' && method === 'POST') {
      const auth = requireAccess(req, 'edit', true), input = templateInput(await readBody(req));
      const row = transaction(() => {
        if (!siteRow()) throw problem(503, 'Owner setup is incomplete.');
        if (Number(db.prepare("SELECT COUNT(*) AS total FROM templates WHERE site_id='nimble'").get().total) >= 50) throw problem(409, 'You can save up to 50 templates for this site.');
        if (db.prepare("SELECT id FROM templates WHERE site_id='nimble' AND name=?").get(input.name)) throw problem(409, 'A template with that name already exists.');
        const id = randomUUID();
        db.prepare('INSERT INTO templates(id,site_id,name,description,document_json,created_at,updated_at) VALUES(?,?,?,?,?,?,?)').run(id, 'nimble', input.name, input.description, JSON.stringify(input.document), timestamp(), timestamp());
        audit(auth.user.id, 'template_created', { templateId: id, name: input.name });
        return templateRow(id);
      });
      return send(res, 201, { template: templatePublic(row) });
    }
    const templateMatch = pathname.match(/^\/api\/templates\/([a-f0-9-]{8,80})$/i);
    if (templateMatch && ['PUT', 'DELETE'].includes(method)) {
      const auth = requireAccess(req, 'edit', true), id = templateMatch[1], existing = templateRow(id);
      if (!existing) throw problem(404, 'Template not found.');
      if (method === 'DELETE') {
        transaction(() => { db.prepare("DELETE FROM templates WHERE id=? AND site_id='nimble'").run(id); audit(auth.user.id, 'template_deleted', { templateId: id }); });
        return send(res, 200, { ok: true });
      }
      const input = templateInput(await readBody(req), existing);
      const row = transaction(() => {
        if (db.prepare("SELECT id FROM templates WHERE site_id='nimble' AND name=? AND id<>?").get(input.name, id)) throw problem(409, 'A template with that name already exists.');
        db.prepare('UPDATE templates SET name=?,description=?,document_json=?,updated_at=? WHERE id=? AND site_id=\'nimble\'').run(input.name, input.description, JSON.stringify(input.document), timestamp(), id);
        audit(auth.user.id, 'template_updated', { templateId: id, name: input.name });
        return templateRow(id);
      });
      return send(res, 200, { template: templatePublic(row) });
    }
    if (pathname === '/api/media' && method === 'POST') {
      const auth = requireAccess(req, 'edit', true);
      const result = await storeMedia(await readBody(req, 22_000_000)); audit(auth.user.id, 'media_uploaded', { url: result.url });
      return send(res, 201, result);
    }
    if (pathname === '/api/publish' && method === 'POST') {
      const auth = requireAccess(req, 'publish', true), body = await readBody(req);
      const row = body.pages ? savedDocument(req, body) : siteRow();
      if (!body.pages && body.revision !== row.revision) throw problem(409, 'Save and load the latest draft before publishing.');
      const result = await publishAtomic({ publishedDir: published, site: normalizeSite(JSON.parse(row.document_json)), renderPage: pageHtml });
      audit(auth.user.id, 'site_published', { revision: row.revision, releaseId: result.releaseId });
      return send(res, 200, result);
    }
    if (pathname === '/api/preview' && method === 'POST') {
      requireAccess(req, 'view', true);
      const body = await readBody(req), document = normalizeSite(body.site);
      const page = document.pages.find(page => page.id === body.pageId) || document.pages[0];
      return send(res, 200, pageHtml(document, page), 'text/html; charset=utf-8');
    }
    if (pathname === '/api/admin/users' && method === 'GET') {
      requireAccess(req, 'users');
      const users = db.prepare("SELECT u.id,u.name,u.email,u.created_at,m.role AS site_role FROM users u JOIN site_members m ON m.user_id=u.id AND m.site_id='nimble' ORDER BY u.id").all();
      return send(res, 200, { users });
    }
    if (pathname === '/api/admin/users' && method === 'POST') {
      const auth = requireAccess(req, 'users', true), body = await readBody(req, 10000);
      if (!['admin', 'editor', 'viewer'].includes(body.role) || !validPassword(body.password)) throw problem(400, 'Choose a valid role and a password of 12–256 characters.');
      const credentials = await passwordHash(body.password);
      const user = transaction(() => { requireAccess(req, 'users', true); const account = createUser({ ...body, role: body.role === 'admin' ? 'admin' : 'user' }, credentials); db.prepare("INSERT INTO site_members VALUES('nimble',?,?,?)").run(account.id, body.role, timestamp()); audit(auth.user.id, 'user_created', { userId: account.id }); return account; });
      return send(res, 201, { user });
    }
    const memberMatch = pathname.match(/^\/api\/admin\/users\/(\d+)(\/reset-password)?$/);
    if (memberMatch && ['PATCH', 'DELETE', 'POST'].includes(method)) {
      const auth = requireAccess(req, 'users', true), id = Number(memberMatch[1]);
      const target = userPublic(id);
      if (!target) throw problem(404, 'User not found.');
      if (id === auth.user.id || id === siteRow().owner_id) throw problem(400, 'You cannot modify your own access or the site owner here.');
      if (method === 'DELETE' && !memberMatch[2]) {
        transaction(() => { db.prepare('DELETE FROM users WHERE id=?').run(id); audit(auth.user.id, 'user_removed', { userId: id }); });
        return send(res, 200, { ok: true });
      }
      const body = await readBody(req, 10000);
      if (method === 'PATCH' && !memberMatch[2]) {
        if (!['admin', 'editor', 'viewer'].includes(body.role)) throw problem(400, 'Choose a valid role.');
        transaction(() => { db.prepare('UPDATE users SET role=? WHERE id=?').run(body.role === 'admin' ? 'admin' : 'user', id); db.prepare("UPDATE site_members SET role=? WHERE site_id='nimble' AND user_id=?").run(body.role, id); db.prepare('DELETE FROM sessions WHERE user_id=?').run(id); audit(auth.user.id, 'user_role_changed', { userId: id, role: body.role }); });
        return send(res, 200, { ok: true });
      }
      if (method === 'POST' && memberMatch[2]) {
        if (!validPassword(body.password)) throw problem(400, 'Use a password of 12–256 characters.');
        const credentials = await passwordHash(body.password);
        transaction(() => { requireAccess(req, 'users', true); const result = db.prepare('UPDATE users SET password_hash=?,password_salt=? WHERE id=?').run(credentials.hash, credentials.salt, id); if (!result.changes) throw problem(404, 'User not found.'); db.prepare('DELETE FROM sessions WHERE user_id=?').run(id); audit(auth.user.id, 'user_password_reset', { userId: id }); });
        return send(res, 200, { ok: true });
      }
      throw problem(405, 'Method not allowed.');
    }
    if (pathname === '/api/messages' && method === 'GET') {
      requireAccess(req, 'messages');
      const before = Math.max(0, Number(url.searchParams.get('before') || Number.MAX_SAFE_INTEGER));
      const messages = db.prepare('SELECT * FROM messages WHERE id<? ORDER BY id DESC LIMIT 100').all(before);
      return send(res, 200, { messages, nextBefore: messages.length === 100 ? messages.at(-1).id : null });
    }
    if (pathname.match(/^\/api\/messages\/\d+$/) && method === 'DELETE') {
      const auth = requireAccess(req, 'messages', true), id = Number(pathname.split('/').at(-1));
      db.prepare('DELETE FROM messages WHERE id=?').run(id); audit(auth.user.id, 'message_deleted', { id });
      return send(res, 200, { ok: true });
    }
    if (pathname === '/api/contact-token' && method === 'GET') {
      rate('contact-token:' + clientIP(req), 100);
      const release = await currentRelease(published), block = url.searchParams.get('block');
      if (!release?.site.pages.some(page => page.blocks.includes(block)) || release.site.blocks[block]?.type !== 'form') throw problem(404, 'This form is unavailable.');
      return send(res, 200, { token: contactToken(block) });
    }
    if (pathname === '/api/contact' && method === 'POST') {
      rate('contact:' + clientIP(req), 5);
      const body = await readBody(req, 15000, true);
      const token = verifyContactToken(body.token), release = await currentRelease(published);
      if (!release?.site.pages.some(page => page.blocks.includes(token.block)) || release.site.blocks[token.block]?.type !== 'form') throw problem(400, 'This form is unavailable.');
      if (body.website) return send(res, 200, { ok: true });
      const name = String(body.name || '').trim(), email = emailValue(body.email), message = String(body.message || '').trim();
      if (!name || name.length > 120 || !validEmail(email) || !message || message.length > 5000) throw problem(400, 'Enter your name, a valid email, and a message of at most 5,000 characters.');
      db.prepare('INSERT INTO messages(name,email,message,page_id,created_at) VALUES(?,?,?,?,?)').run(name, email, message, token.block, timestamp());
      if (req.headers['content-type'].startsWith('application/json')) return send(res, 201, { ok: true });
      return send(res, 201, '<!doctype html><title>Message sent</title><h1>Thank you</h1><p>Your message has reached our team.</p><a href="/">Back to the site</a>', 'text/html; charset=utf-8');
    }
    if (pathname.startsWith('/api/')) throw problem(404, 'Endpoint not found.');
    if (!['GET', 'HEAD'].includes(method)) throw problem(405, 'Method not allowed.');
    if (assets.has(pathname)) return await sendFile(req, res, path.join(root, assets.get(pathname)));
    if (pathname === '/builder' || pathname === '/control-panel') return redirect(res, pathname + '.html');
    if (['/builder.html', '/control-panel.html'].includes(pathname)) {
      if (!identity(req)) return redirect(res, '/login.html?next=' + encodeURIComponent(pathname));
      requireAccess(req);
      return await sendFile(req, res, path.join(root, pathname.slice(1)), { html: true });
    }
    if (pathname === '/login.html') return await sendFile(req, res, path.join(root, 'login.html'), { html: true });
    if (/^\/uploads\/[a-zA-Z0-9_-]+\.(png|jpg|jpeg|webp|gif|mp4|webm)$/.test(pathname)) return await sendFile(req, res, path.join(uploads, path.basename(pathname)), { immutable: true });
    const release = await currentRelease(published);
    if (pathname === '/robots.txt') return send(res, 200, 'User-agent: *\n' + (release?.site.site.searchVisible ? 'Allow: /\nDisallow: /api/\nDisallow: /builder.html\nDisallow: /control-panel.html\n' : 'Disallow: /\n'), 'text/plain; charset=utf-8');
    if (pathname === '/sitemap.xml' && release && publicOrigin) return send(res, 200, '<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">' + release.site.pages.map(page => '<url><loc>' + escapeHtml(publicOrigin + (page.id === 'home' ? '/' : '/' + page.id + '.html')) + '</loc></url>').join('') + '</urlset>', 'application/xml; charset=utf-8');
    if (release) {
      const local = pathname.startsWith('/published/') ? pathname.slice(10) : pathname;
      const page = release.site.pages.find(page => local === page.path || local === (page.id === 'home' ? '/index.html' : '/' + page.id + '.html') || (local === '/' && page.id === 'home'));
      if (page) return await sendFile(req, res, path.join(release.directory, page.id === 'home' ? 'index.html' : page.id + '.html'), { html: true });
    }
    if (pathname === '/' && !release) return send(res, 200, '<!doctype html><title>Nimble</title><meta name="viewport" content="width=device-width"><link rel="stylesheet" href="/assets/public.css"><main class="wrap block"><h1>Nimble</h1><p>Your new website is on its way.</p><a href="/login.html">Team sign in</a></main>', 'text/html; charset=utf-8');
    throw problem(404, 'Not found.');
  } catch (error) {
    if (res.headersSent) return res.destroy();
    const duplicateEmail = error.errcode === 2067 || /UNIQUE constraint failed: users.email/.test(error.message);
    const status = error.statusCode || (error.code === 'ENOENT' ? 404 : duplicateEmail ? 409 : 500);
    if (status === 500) console.error(JSON.stringify({ event: 'request_failed', requestId: randomUUID(), error: error.message }));
    send(res, status, { error: status === 500 ? 'The server could not complete this request.' : status === 404 ? 'Not found.' : duplicateEmail ? 'This email already has an account.' : error.message });
  }
});
server.requestTimeout = 30000; server.headersTimeout = 15000; server.keepAliveTimeout = 5000;
let closing = false;
async function shutdown() {
  if (closing) return; closing = true;
  server.close(async () => { await mediaQueue.catch(() => {}); db.close(); process.exit(0); });
  server.closeIdleConnections();
  setTimeout(() => process.exit(1), 10000).unref();
}
process.on('SIGTERM', shutdown); process.on('SIGINT', shutdown);
server.listen(port, host, () => console.log('Nimble website builder running at http://localhost:' + server.address().port));
