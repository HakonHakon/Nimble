import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import path from 'node:path';
import { spawnSync, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fixture, sourceRoot } from './helpers.mjs';
import { fontRequest, cssUrl, parseFontCss, allowedFontUrl } from '../lib/fonts.mjs';

const GOOGLE_CSS = (origin, family = 'Brand Sans') => `
/* cyrillic */
@font-face { font-family: '${family}'; font-style: normal; font-weight: 400; font-display: swap; src: url(${origin}/files/cyr-400.woff2) format('woff2'); unicode-range: U+0400-045F; }
/* latin */
@font-face { font-family: '${family}'; font-style: normal; font-weight: 400; font-display: swap; src: url(${origin}/files/latin-400.woff2) format('woff2'); unicode-range: U+0000-00FF; }
/* latin */
@font-face { font-family: '${family}'; font-style: italic; font-weight: 700; font-display: swap; src: url("${origin}/files/latin-700i.woff2") format("woff2"); }
/* latin */
@font-face { font-family: '${family}'; font-style: normal; font-weight: 700; font-display: swap; src: url(${origin}/files/latin-700.woff2) format('woff2'); }
`;

test('font requests, Google CSS parsing and file address checks', () => {
  assert.deepEqual(fontRequest({ family: '  Open   Sans ', weights: [700, 400, 400] }), { family: 'Open Sans', weights: [400, 700], italic: false });
  assert.ok(fontRequest({ family: 'Bad;font' }).error);
  assert.ok(fontRequest({ family: 'Inter', weights: [450] }).error);
  assert.equal(cssUrl('https://fonts.googleapis.com/', { family: 'Open Sans', weights: [400, 700], italic: true }), 'https://fonts.googleapis.com/css2?family=Open+Sans:ital,wght@0,400;0,700;1,400;1,700&display=swap');
  assert.deepEqual(parseFontCss(GOOGLE_CSS('https://fonts.gstatic.com')), [
    { weight: 400, style: 'normal', url: 'https://fonts.gstatic.com/files/latin-400.woff2' },
    { weight: 700, style: 'italic', url: 'https://fonts.gstatic.com/files/latin-700i.woff2' },
    { weight: 700, style: 'normal', url: 'https://fonts.gstatic.com/files/latin-700.woff2' }
  ]);
  assert.equal(allowedFontUrl('https://fonts.gstatic.com/s/x.woff2', 'https://fonts.googleapis.com'), true);
  assert.equal(allowedFontUrl('https://evil.example/x.woff2', 'https://fonts.googleapis.com'), false);
  assert.equal(allowedFontUrl('http://fonts.gstatic.com/x.woff2', 'https://fonts.googleapis.com'), false);
  assert.equal(allowedFontUrl('http://127.0.0.1:9/x.woff2', 'http://127.0.0.1:9'), true);
});

test('PHP parses fonts exactly like Node', { skip: spawnSync('php', ['-v']).status === 0 ? false : 'PHP CLI is not installed' }, () => {
  const input = {
    requests: [{ family: 'Open  Sans', weights: [700, 400] }, { family: 'Inter', italic: true }, { family: 'x"y' }, { family: 'Inter', weights: [100, 200, 300, 400, 500, 600, 700] }],
    css: [GOOGLE_CSS('https://fonts.gstatic.com'), '@font-face{font-weight:300;src:url(a.ttf) format("truetype")}', '/* latin-ext */ @font-face { font-weight: 500; src: url(https://fonts.gstatic.com/a.woff2) format("woff2") }'],
    urls: [['https://fonts.gstatic.com/a.woff2', 'https://fonts.googleapis.com'], ['https://x.test/a.woff2', 'https://fonts.googleapis.com'], ['http://127.0.0.1:81/a.woff2', 'http://127.0.0.1:81'], ['http://127.0.0.1:82/a.woff2', 'http://127.0.0.1:81']]
  };
  const result = spawnSync('php', [path.join(sourceRoot, 'test/php/fonts-run.php')], { input: JSON.stringify(input), encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  const js = {
    requests: input.requests.map(request => { const value = fontRequest(request); return value.error ? value : { ...value, url: cssUrl('https://fonts.example', value) }; }),
    faces: input.css.map(parseFontCss),
    allowed: input.urls.map(([url, base]) => allowedFontUrl(url, base))
  };
  assert.deepEqual(JSON.parse(result.stdout), js);
});

test('server: font uploads and self-hosted Google Fonts', async t => {
  const woff2 = Buffer.concat([Buffer.from('wOF2'), Buffer.alloc(60, 1)]);
  let requested = '';
  const google = http.createServer((req, res) => {
    const origin = 'http://127.0.0.1:' + google.address().port;
    if (req.url.startsWith('/css2?')) {
      requested = req.url;
      if (req.url.includes('family=Nope')) { res.writeHead(400); return res.end('Bad family'); }
      res.writeHead(200, { 'Content-Type': 'text/css' }); return res.end(GOOGLE_CSS(origin, 'Brand Sans'));
    }
    if (req.url.startsWith('/files/')) { res.writeHead(200, { 'Content-Type': 'font/woff2' }); return res.end(woff2); }
    res.writeHead(404); res.end();
  });
  await new Promise(resolve => google.listen(0, '127.0.0.1', resolve));
  t.after(() => google.close());
  const f = await fixture(); t.after(() => f.cleanup());
  await f.stop(); await f.start({ NIMBLE_GOOGLE_FONTS_URL: 'http://127.0.0.1:' + google.address().port });
  const owner = await f.login();

  const upload = await f.request('/api/media', { method: 'POST', auth: owner, body: { name: 'Brand.woff2', data: 'data:font/woff2;base64,' + woff2.toString('base64') } });
  assert.equal(upload.status, 201, upload.text);
  assert.equal(upload.data.kind, 'font');
  assert.match(upload.data.url, /^\/uploads\/[a-z0-9-]+\.woff2$/);
  const served = await f.request(upload.data.url);
  assert.equal(served.status, 200);
  assert.equal(served.headers.get('content-type'), 'font/woff2');
  const fake = await f.request('/api/media', { method: 'POST', auth: owner, body: { name: 'x.woff2', data: 'data:font/woff2;base64,' + Buffer.from('not a font file').toString('base64') } });
  assert.equal(fake.status, 400);

  const imported = await f.request('/api/fonts/google', { method: 'POST', auth: owner, body: { family: 'Brand Sans', weights: [400, 700], italic: true } });
  assert.equal(imported.status, 201, imported.text);
  assert.match(requested, /family=Brand\+Sans:ital,wght@0,400;0,700;1,400;1,700/);
  assert.equal(imported.data.family, 'Brand Sans');
  assert.deepEqual(imported.data.files.map(file => [file.weight, file.style]), [[400, 'normal'], [700, 'italic'], [700, 'normal']]);
  for (const file of imported.data.files) assert.equal((await f.request(file.src)).status, 200);
  assert.equal((await f.request('/api/fonts/google', { method: 'POST', auth: owner, body: { family: 'Nope' } })).status, 404);
  assert.equal((await f.request('/api/fonts/google', { method: 'POST', auth: owner, body: { family: '<script>' } })).status, 400);
  assert.equal((await f.request('/api/fonts/google', { method: 'POST', body: { family: 'Inter' } })).status, 401);

  const site = (await f.request('/api/site', { auth: owner })).data;
  const doc = { version: 2, site: { name: 'Fonts' }, design: { fonts: [{ id: 'brand', source: 'custom', family: 'Brand Sans', files: imported.data.files }, { id: 'heading', source: 'system', family: 'sans' }, { id: 'body', source: 'custom', family: 'Uploaded', src: upload.data.url }] }, pages: [{ id: 'home', name: 'Home', children: [] }], nodes: {} };
  const saved = await f.request('/api/site', { method: 'PUT', auth: owner, body: doc, headers: { 'If-Match': '"' + site.revision + '"' } });
  assert.equal(saved.status, 200, saved.text);
  const preview = await f.request('/api/preview', { method: 'POST', auth: owner, body: { site: doc, pageId: 'home' } });
  assert.equal((preview.text.match(/@font-face/g) || []).length, 4);
});

test('PHP imports Google Fonts with the same rules', { skip: spawnSync('php', ['-v']).status === 0 ? false : 'PHP CLI is not installed' }, async t => {
  const woff2 = Buffer.concat([Buffer.from('wOF2'), Buffer.alloc(40, 3)]);
  const server = http.createServer((req, res) => {
    const origin = 'http://127.0.0.1:' + server.address().port;
    if (req.url.includes('family=Nope')) { res.writeHead(400); return res.end(); }
    if (req.url.includes('family=Evil')) { res.writeHead(200); return res.end("/* latin */ @font-face { font-weight: 400; src: url(https://evil.example/x.woff2) format('woff2'); }"); }
    if (req.url.includes('family=Fake')) { res.writeHead(200); return res.end(`@font-face { font-weight: 400; src: url(${origin}/files/fake.woff2) format('woff2'); }`); }
    if (req.url.startsWith('/css2?')) { res.writeHead(200); return res.end(GOOGLE_CSS(origin)); }
    if (req.url === '/files/fake.woff2') { res.writeHead(200); return res.end('<html>'); }
    res.writeHead(200); res.end(woff2);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => server.close());
  const base = 'http://127.0.0.1:' + server.address().port;
  const run = async body => JSON.parse((await promisify(execFile)('php', [path.join(sourceRoot, 'test/php/fonts-import.php'), base, JSON.stringify(body)])).stdout);
  const ok = await run({ family: 'Brand Sans', weights: [700, 400], italic: true });
  assert.deepEqual(ok.result, { family: 'Brand Sans', files: [{ src: '/uploads/font-1.woff2', weight: 400, style: 'normal' }, { src: '/uploads/font-2.woff2', weight: 700, style: 'italic' }, { src: '/uploads/font-3.woff2', weight: 700, style: 'normal' }] });
  assert.deepEqual(ok.stored.map(item => item.name), ['Brand Sans 400', 'Brand Sans 700 italic', 'Brand Sans 700']);
  assert.equal(ok.stored[0].bytes, woff2.length);
  assert.deepEqual(await run({ family: 'Nope' }), { error: 'Google Fonts has no family called Nope with those weights.', status: 404 });
  assert.equal((await run({ family: 'Evil' })).status, 502);
  assert.deepEqual(await run({ family: 'Fake' }), { error: 'A font file was not a valid WOFF2 file.', status: 502 });
  assert.equal((await run({ family: '<b>' })).status, 400);
});
