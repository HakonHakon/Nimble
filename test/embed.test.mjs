import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture } from './helpers.mjs';

test('HTML embeds are served sandboxed from /embed/, published or as a draft for signed-in users', async t => {
  const f = await fixture(); t.after(() => f.cleanup());
  const owner = await f.login();
  const doc = { version: 2, site: { name: 'Embeds' }, pages: [{ id: 'home', name: 'Home', children: ['s'] }], nodes: {
    s: { type: 'section', children: ['code', 'map', 'pic'] },
    code: { type: 'embed', props: { kind: 'html', html: '<b id="w">Widget</b><script>document.title = "ran"</script>', title: 'Widget' } },
    map: { type: 'embed', props: { kind: 'map', address: 'Oslo' } },
    pic: { type: 'image', props: { src: '/uploads/a.jpg' } }
  } };
  assert.equal((await f.save(owner, doc)).status, 200);
  assert.equal((await f.request('/embed/code.html')).status, 404, 'nothing published yet');
  const draft = await f.request('/embed/code.html?draft=1', { auth: owner });
  assert.equal(draft.status, 200);
  assert.match(draft.text, /<b id="w">Widget<\/b><script>/);
  assert.equal((await f.request('/embed/code.html?draft=1')).status, 401, 'drafts need a session');
  const revision = (await f.request('/api/site', { auth: owner })).data.revision;
  assert.equal((await f.request('/api/publish', { method: 'POST', auth: owner, body: { revision } })).status, 200);
  const published = await f.request('/embed/code.html');
  assert.equal(published.status, 200);
  assert.match(published.headers.get('content-security-policy'), /^sandbox allow-scripts allow-popups allow-forms allow-popups-to-escape-sandbox; frame-ancestors 'self'$/);
  assert.equal(published.headers.get('x-frame-options'), 'SAMEORIGIN');
  for (const other of ['/embed/map.html', '/embed/pic.html', '/embed/missing.html', '/embed/../site.html']) assert.equal((await f.request(other)).status, 404, other);
  const page = await f.request('/');
  assert.match(page.text, /<iframe src="\/embed\/code\.html" title="Widget"[^>]* sandbox="allow-scripts allow-popups allow-forms allow-popups-to-escape-sandbox">/);
  assert.match(page.headers.get('content-security-policy'), /frame-src 'self' https:;/);
  assert.match(page.headers.get('content-security-policy'), /frame-ancestors 'none'/);
});
