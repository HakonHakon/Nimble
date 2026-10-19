import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawn } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { fixture, example, png, ownerCredentials, sourceRoot } from './helpers.mjs';
import { normalizeSite } from '../lib/site-model.mjs';
import { renderBlock } from '../lib/render.mjs';
import { currentRelease, publishAtomic } from '../lib/publish-atomic.mjs';

test('public release: security, persistence, permissions, publishing, forms and recovery', async t => {
  const f = await fixture(); t.after(() => f.cleanup());
  const owner = await f.login();
  let saved, editor, viewer, media;
  await t.test('private files, encoded separators and HTML authentication', async () => {
    for (const route of ['/.env', '/backups/fixture.sqlite', '/%5cdata%5cnimble.sqlite', '/data/nimble.sqlite', '/server.mjs', '/lib/render.mjs', '/published/current.json', '/assets/../server.mjs', '/BUILDER.html']) assert.ok([400, 401, 403, 404].includes((await f.request(route)).status), route);
    assert.equal((await f.request('/%62uilder.html')).status, 302);
    assert.equal((await f.request('/control-panel.html')).status, 302);
    assert.equal((await f.request('/api/site')).status, 401);
    assert.equal((await f.request('/api/messages')).status, 401);
    const builder = await f.request('/builder.html', { auth: owner });
    assert.equal(builder.status, 200);
    const csp = builder.headers.get('content-security-policy');
    assert.ok(!csp.split('script-src')[1].split(';')[0].includes('unsafe-inline'));
    assert.ok(csp.includes("object-src 'none'"));
    assert.equal(builder.headers.get('x-content-type-options'), 'nosniff');
    assert.equal((await f.request('/api/ready')).status, 200);
  });
  await t.test('CSRF, cross-origin and content type protection', async () => {
    assert.equal((await f.request('/api/site', { method: 'PUT', body: example, headers: { Cookie: owner.cookie } })).status, 403);
    assert.equal((await f.request('/api/site', { method: 'PUT', body: example, auth: owner, headers: { Origin: 'https://evil.example' } })).status, 403);
    assert.equal((await f.request('/api/auth/login', { method: 'POST', body: ownerCredentials, headers: { 'Content-Type': 'text/plain' } })).status, 415);
  });
  await t.test('saved site restores with independent page content', async () => {
    saved = await f.save(owner, example); assert.equal(saved.status, 200, saved.text);
    const loaded = await f.request('/api/site', { auth: owner });
    assert.equal(loaded.data.site.blocks.intro.title, 'A saved heading');
    assert.equal(loaded.data.site.site.name, 'Saved site');
    assert.notEqual(loaded.data.site.pages[1].blocks[0], loaded.data.site.pages[0].blocks[0]);
    assert.equal(loaded.data.site.blocks[loaded.data.site.pages[1].blocks[0]].title, 'A saved heading');
  });
  await t.test('invalid schemas, duplicate identifiers and unsafe URLs cannot overwrite a good site', async () => {
    const cases = [{ pages: 'invalid', blocks: null }, { ...example, pages: [example.pages[0], example.pages[0]] }, { ...example, blocks: { ...example.blocks, image: { type: 'image', image: 'x\\"><img src=x onerror=alert(1)>' } } }];
    for (const value of cases) assert.equal((await f.save(owner, value)).status, 400);
    const current = await f.request('/api/site', { auth: owner });
    assert.equal(current.data.site.blocks.intro.title, 'A saved heading');
    const stale = await f.request('/api/site', { method: 'PUT', auth: owner, body: example, headers: { 'If-Match': '"0"' } });
    assert.equal(stale.status, 409);
    assert.equal((await f.request('/api/site', { method: 'PUT', auth: owner, body: example })).status, 428);
  });
  await t.test('shared renderer escapes text and malicious image values', () => {
    const normalized = normalizeSite(example);
    const html = renderBlock(normalized, { id: 'test', type: 'image', image: 'x\\"><img src=x onerror=alert(1)>', alt: '<script>alert(1)</script>' });
    assert.ok(!html.includes('<script>')); assert.ok(!html.includes('<img src=x onerror='));
    assert.ok(renderBlock(normalized, { id: 'q', type: 'quote', text: '<script>bad</script>' }).includes('&lt;script&gt;'));
  });
  await t.test('team memberships, editor publishing and viewer restrictions', async () => {
    for (const role of ['editor', 'viewer']) {
      const result = await f.request('/api/admin/users', { method: 'POST', auth: owner, body: { name: role, email: role + '@example.test', password: 'Fixture-' + role + '-password-2026', role } });
      assert.equal(result.status, 201, result.text);
    }
    editor = await f.login({ email: 'editor@example.test', password: 'Fixture-editor-password-2026' });
    viewer = await f.login({ email: 'viewer@example.test', password: 'Fixture-viewer-password-2026' });
    assert.equal((await f.save(viewer, example)).status, 403);
    assert.equal((await f.request('/api/admin/users', { auth: editor })).status, 403);
    assert.equal((await f.request('/api/messages', { auth: viewer })).status, 403);
    assert.equal((await f.request('/api/publish', { method: 'POST', auth: viewer, body: { revision: saved.data.revision } })).status, 403);
    const users = (await f.request('/api/admin/users', { auth: owner })).data.users;
    const ownerId = users.find(user => user.site_role === 'owner').id;
    assert.equal((await f.request('/api/admin/users/' + ownerId + '/reset-password', { method: 'POST', auth: editor, body: { password: 'Attempted-password-2026' } })).status, 403);
    assert.equal((await f.request('/api/admin/users/' + ownerId, { method: 'DELETE', auth: owner })).status, 400);
  });
  await t.test('saved template CRUD is shared with editors and protected from viewers', async () => {
    const created = await f.request('/api/templates', { method: 'POST', auth: editor, body: { name: 'Release template', description: 'Reusable release layout.', document: example } });
    assert.equal(created.status, 201, created.text);
    const templateId = created.data.template.id;
    assert.equal(created.data.template.document.site.name, 'Saved site');
    const listed = await f.request('/api/templates', { auth: owner });
    assert.equal(listed.status, 200); assert.equal(listed.data.templates.length, 1); assert.equal(listed.data.templates[0].id, templateId);
    const updated = await f.request('/api/templates/' + templateId, { method: 'PUT', auth: owner, body: { name: 'Release template updated', description: 'Updated description.' } });
    assert.equal(updated.status, 200, updated.text); assert.equal(updated.data.template.name, 'Release template updated');
    assert.equal((await f.request('/api/templates', { auth: viewer })).status, 403);
    assert.equal((await f.request('/api/templates', { method: 'POST', auth: viewer, body: { name: 'No access', document: example } })).status, 403);
    assert.equal((await f.request('/api/templates/' + templateId, { method: 'DELETE', auth: editor })).status, 200);
    assert.equal((await f.request('/api/templates', { auth: owner })).data.templates.length, 0);
  });
  await t.test('image content checks, storage and HTTP range delivery', async () => {
    assert.equal((await f.request('/api/media', { method: 'POST', auth: owner, body: { name: 'fake.png', data: 'data:image/png;base64,' + Buffer.from('not an image').toString('base64') } })).status, 400);
    const response = await f.request('/api/media', { method: 'POST', auth: editor, body: { name: 'pixel.png', data: 'data:image/png;base64,' + png.toString('base64') } });
    assert.equal(response.status, 201, response.text); media = response.data;
    const range = await fetch(f.base + media.url, { headers: { Range: 'bytes=0-7' } });
    assert.equal(range.status, 206); assert.deepEqual(Buffer.from(await range.arrayBuffer()), png.subarray(0, 8));
    assert.equal((await f.request(media.url, { headers: { Range: 'bytes=9999-' } })).status, 416);
  });
  await t.test('all supported content publishes and the exact generation handles concurrency', async () => {
    const loaded = (await f.request('/api/site', { auth: owner })).data;
    const posts = await Promise.all([owner, editor, owner, editor].map(auth => f.request('/api/publish', { method: 'POST', auth, body: { revision: loaded.revision } })));
    posts.forEach(result => assert.equal(result.status, 200, result.text));
    const publicPage = await f.request('/published/'); assert.equal(publicPage.status, 200);
    for (const phrase of ['A saved heading', 'youtube-nocookie.com/embed/', 'First column', 'Our customer', 'Contact the team', 'action="/api/contact"', 'name="message"', 'meta name="robots" content="noindex,nofollow"', 'font-family:Georgia', '#fff8ed', 'Email us', './about.html']) assert.ok(publicPage.text.includes(phrase), phrase);
    assert.equal((await f.request('/')).status, 200);
    assert.equal((await f.request('/about')).status, 200);
    assert.equal((await f.request('/about.html')).status, 200);
    assert.equal((await f.request('/published/site.json')).status, 404);
  });
  await t.test('playable file video and preview use the same renderer', async () => {
    const document = structuredClone(example); document.blocks.clip.videoUrl = 'https://example.test/movie.mp4';
    const result = await f.request('/api/preview', { method: 'POST', auth: viewer, body: { site: document, pageId: 'home' } });
    assert.equal(result.status, 200); assert.ok(result.text.includes('<video controls'));
    assert.ok(result.text.includes('First column')); assert.ok(result.text.includes('A saved heading'));
  });
  await t.test('contact messages reach the protected inbox', async () => {
    const token = await f.request('/api/contact-token?block=inquiry'); assert.equal(token.status, 200, token.text);
    assert.equal((await f.request('/api/contact-token?block=nonexistent')).status, 404);
    const message = { name: 'Website visitor', email: 'visitor@example.test', message: 'Please contact me about my project.', token: token.data.token, website: '' };
    assert.equal((await f.request('/api/contact', { method: 'POST', body: { ...message, token: 'invalid' } })).status, 400);
    assert.equal((await f.request('/api/contact', { method: 'POST', body: message })).status, 201);
    const inbox = await f.request('/api/messages', { auth: editor }); assert.equal(inbox.status, 200);
    assert.equal(inbox.data.messages[0].message, message.message);
    assert.equal((await f.request('/api/contact', { method: 'POST', body: message, headers: { Origin: 'https://evil.example' } })).status, 403);
  });
  await t.test('password changes, resets and role changes revoke sessions', async () => {
    const changed = await f.request('/api/auth/password', { method: 'POST', auth: viewer, body: { currentPassword: 'Fixture-viewer-password-2026', password: 'Fixture-changed-password-2026' } });
    assert.equal(changed.status, 200, changed.text);
    assert.equal((await f.request('/api/auth/me', { auth: viewer })).status, 401);
    const users = (await f.request('/api/admin/users', { auth: owner })).data.users;
    const viewerId = users.find(user => user.email === 'viewer@example.test').id;
    assert.equal((await f.request('/api/admin/users/' + viewerId + '/reset-password', { method: 'POST', auth: owner, body: { password: 'Fixture-reset-password-2026' } })).status, 200);
    viewer = await f.login({ email: 'viewer@example.test', password: 'Fixture-reset-password-2026' });
    assert.equal((await f.request('/api/admin/users/' + viewerId, { method: 'PATCH', auth: owner, body: { role: 'editor' } })).status, 200);
    assert.equal((await f.request('/api/auth/me', { auth: viewer })).status, 401);
    const newRole = await f.login({ email: 'viewer@example.test', password: 'Fixture-reset-password-2026' });
    assert.equal(newRole.result.data.role, 'editor');
  });
  await t.test('failed generation never changes the current publication', async () => {
    const directory = path.join(f.directory, 'publication-test'), document = normalizeSite(example);
    const first = await publishAtomic({ publishedDir: directory, site: document, renderPage: () => 'Good release' });
    await assert.rejects(publishAtomic({ publishedDir: directory, site: document, renderPage: () => { throw new Error('Injected render failure'); } }));
    assert.equal((await currentRelease(directory)).id, first.releaseId);
    const module = pathToFileURL(path.join(sourceRoot, 'lib', 'publish-atomic.mjs')).href;
    const code = 'const {publishAtomic}=await import(' + JSON.stringify(module) + '); await publishAtomic({publishedDir:' + JSON.stringify(directory) + ',site:' + JSON.stringify(document) + ',renderPage:()=>process.exit(99)});';
    const child = spawn(process.execPath, ['--input-type=module', '-e', code], { windowsHide: true, stdio: 'ignore' });
    const exit = await new Promise(resolve => child.once('exit', resolve));
    assert.equal(exit, 99); assert.equal((await currentRelease(directory)).id, first.releaseId);
  });
  await t.test('backup integrity and a complete restored-instance drill', async () => {
    const backup = await f.runScript('backup.mjs'); assert.equal(backup.exit, 0, backup.output);
    const directory = JSON.parse(backup.output).backup;
    const database = new DatabaseSync(path.join(directory, 'data', 'nimble.sqlite'), { readOnly: true });
    assert.equal(database.prepare('PRAGMA integrity_check').get().integrity_check, 'ok'); database.close();
    const target = path.join(f.directory, 'restored-storage');
    await f.stop();
    const restored = await f.runScript('restore.mjs', [directory], { NIMBLE_STORAGE_DIR: target, NIMBLE_ALLOW_RESTORE: 'yes' });
    assert.equal(restored.exit, 0, restored.output);
    await f.start({ NIMBLE_STORAGE_DIR: target });
    const restoredOwner = await f.login();
    assert.equal((await f.request('/api/site', { auth: restoredOwner })).data.site.blocks.intro.title, 'A saved heading');
    assert.equal((await f.request('/')).status, 200);
    assert.equal((await f.request(media.url)).status, 200);
    assert.equal((await f.request('/api/messages', { auth: restoredOwner })).data.messages[0].name, 'Website visitor');
    await fs.appendFile(path.join(directory, 'data', 'nimble.sqlite'), 'corruption');
    const rejected = await f.runScript('restore.mjs', [directory], { NIMBLE_STORAGE_DIR: path.join(f.directory, 'unused-target'), NIMBLE_ALLOW_RESTORE: 'yes' });
    assert.notEqual(rejected.exit, 0); assert.ok(rejected.output.includes('checksum'));
  });
});
