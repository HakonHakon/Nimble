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

test('audio uploads: MP3, M4A, OGG and WAV are checked by content and served with audio types', async t => {
  const f = await fixture(); t.after(() => f.cleanup());
  const owner = await f.login();
  const upload = (name, type, bytes) => f.request('/api/media', { method: 'POST', auth: owner, body: { name, data: 'data:' + type + ';base64,' + Buffer.from(bytes).toString('base64') } });
  const samples = [
    ['a.mp3', 'audio/mpeg', Buffer.concat([Buffer.from('ID3'), Buffer.alloc(40, 1)]), 'audio/mpeg'],
    ['b.mp3', 'audio/mpeg', Buffer.concat([Buffer.from([0xff, 0xfb, 0x90, 0x64]), Buffer.alloc(40, 2)]), 'audio/mpeg'],
    ['c.m4a', 'audio/x-m4a', Buffer.concat([Buffer.from([0, 0, 0, 32]), Buffer.from('ftypM4A '), Buffer.alloc(40)]), 'audio/mp4'],
    ['d.ogg', 'audio/ogg', Buffer.concat([Buffer.from('OggS'), Buffer.alloc(40, 3)]), 'audio/ogg'],
    ['e.wav', 'audio/wav', Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WAVE'), Buffer.alloc(40)]), 'audio/wav']
  ];
  for (const [name, type, bytes, served] of samples) {
    const result = await upload(name, type, bytes);
    assert.equal(result.status, 201, name + ': ' + result.text);
    assert.equal(result.data.kind, 'audio');
    const file = await f.request(result.data.url);
    assert.equal(file.headers.get('content-type'), served, name);
  }
  assert.equal((await upload('fake.mp3', 'audio/mpeg', Buffer.from('<html>not audio</html>'))).status, 400);
  assert.equal((await upload('fake.wav', 'audio/wav', Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('AVI ')]))).status, 400);
});
