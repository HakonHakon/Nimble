import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture } from './helpers.mjs';

const dataUrl = (type, text) => 'data:' + type + ';base64,' + Buffer.from(text).toString('base64');

test('SVG uploads are accepted only when they are SVG, and are served sandboxed', async t => {
  const f = await fixture(); t.after(() => f.cleanup());
  const owner = await f.login();
  const upload = (name, data) => f.request('/api/media', { method: 'POST', auth: owner, body: { name, data } });
  const svg = await upload('logo.svg', dataUrl('image/svg+xml', '﻿<?xml version="1.0"?>\n<!-- logo -->\n<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><script>alert(1)</script><circle cx="5" cy="5" r="4"/></svg>'));
  assert.equal(svg.status, 201, svg.text);
  assert.equal(svg.data.kind, 'image');
  assert.match(svg.data.url, /^\/uploads\/[a-z0-9-]+\.svg$/);
  const served = await f.request(svg.data.url);
  assert.equal(served.status, 200);
  assert.equal(served.headers.get('content-type'), 'image/svg+xml');
  assert.match(served.headers.get('content-security-policy'), /default-src 'none'.*sandbox/);
  assert.equal(served.headers.get('x-content-type-options'), 'nosniff');
  for (const fake of ['<html><body>hi</body></html>', '<div><svg></svg></div>', 'plain text']) {
    assert.equal((await upload('fake.svg', dataUrl('image/svg+xml', fake))).status, 400, fake);
  }
  assert.equal((await upload('bin.svg', 'data:image/svg+xml;base64,' + Buffer.from([0x3c, 0x73, 0x76, 0x67, 0x20, 0xff, 0xfe]).toString('base64'))).status, 400, 'invalid UTF-8');
  const png = await f.request('/uploads/' + svg.data.url.split('/').pop().replace('.svg', '.png'));
  assert.equal(png.status, 404);
});
