import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fixture, example, sourceRoot } from './helpers.mjs';
import { normalizeSite, makeDefaultSite } from '../lib/site-model.mjs';
import { normalizeSiteV2, hasForm } from '../lib/site-model-v2.mjs';
import { pageHtmlV2, siteCss, pageRoots } from '../lib/render-v2.mjs';
import { pageHtml } from '../lib/render.mjs';
import { migrateV1 } from '../lib/migrate-v1.mjs';

const kitchenSink = async () => JSON.parse(await fs.readFile(path.join(sourceRoot, 'test/fixtures/v2/kitchen-sink.json'), 'utf8'));
const minimal = (nodes, children, extra = {}) => ({ version: 2, site: { name: 'Test' }, pages: [{ id: 'home', name: 'Home', children }], nodes, ...extra });
const media = css => [...css.matchAll(/@media \(max-width:(\d+)px\)\{(.*?)\}(?=@media|$)/g)].map(match => [match[1], match[2]]);

test('v1 documents migrate to an equivalent, stable v2 tree', () => {
  const v1 = normalizeSite(example);
  const v2 = migrateV1(v1);
  assert.equal(v2.version, 2);
  assert.deepEqual(normalizeSite(JSON.parse(JSON.stringify(v2))), v2, 'normalization is idempotent');
  assert.deepEqual(v2.pages[0].children, v1.pages[0].blocks, 'v1 block ids stay the section ids, so #anchors keep working');
  assert.equal(v2.nodes[v2.header].tag, 'header');
  assert.equal(v2.nodes[v2.footer].tag, 'footer');
  assert.equal(v2.design.colors.accent, '#3b9c7a');
  assert.equal(v2.design.fonts.find(font => font.id === 'heading').family, 'serif');
  assert.deepEqual(v2.nodes.intro__button.props.link, { to: 'page', page: 'about' });
  assert.deepEqual(v2.nodes.cta__button.props.link, { to: 'anchor', node: 'inquiry' });
  assert.deepEqual(v2.nodes.button__button.props.link, { to: 'email', address: 'team@example.test' });
  assert.equal(v2.nodes.intro.style.desktop.background.kind, 'gradient');
  assert.ok(hasForm(v2, 'inquiry__form'));
  assert.ok(!hasForm(v2, 'inquiry'));
  const html = pageHtml(v2, v2.pages[0]);
  for (const phrase of ['A saved heading', 'youtube-nocookie.com/embed/', 'First column', 'Our customer', 'Contact the team', 'action="/api/contact"', 'Email us', './about.html', 'noindex,nofollow', '--f-heading:Georgia, serif', 'aria-current="page"', '© ' + new Date().getFullYear() + ' Saved site']) assert.ok(html.includes(phrase), phrase);
  assert.deepEqual(migrateV1(v2), v2, 'migrating a v2 document only normalizes it');
  assert.ok(migrateV1(makeDefaultSite()).nodes.contact__form);
});

test('normalization canonicalizes values and drops what cannot be referenced', async () => {
  const site = normalizeSiteV2(await kitchenSink());
  assert.ok(!site.nodes.orphan, 'unreachable elements are removed');
  assert.deepEqual(Object.keys(site.nodes).slice(0, 4), ['hdr', 'logo', 'nav', 'ftr'], 'element order follows the tree');
  assert.equal(site.design.colors.accent, '#ff5500');
  assert.equal(site.nodes.cta.style.desktop.color, '#ffffff');
  assert.deepEqual(site.nodes.hdr.layout.desktop.padding, ['0px', '24px', '0px', '24px']);
  assert.deepEqual(site.nodes.hero.layout.desktop.columns, ['1.2fr', 'minmax(200px,1fr)']);
  assert.deepEqual(site.nodes.grid.layout.desktop.columns, ['repeat(auto-fit,minmax(240px,1fr))']);
  assert.equal(site.design.textStyles.h1.mobile.fontSize, '36.5px');
  assert.deepEqual(site.design.textStyles.p1, normalizeSiteV2(minimal({}, [])).design.textStyles.p1, 'missing text styles fall back to defaults');
  assert.deepEqual(site.breakpoints.map(bp => bp.id), ['tablet', 'mobile', 'small'], 'breakpoints are ordered widest first');
  assert.deepEqual(site.nodes.pic.hidden, { mobile: true, small: false });
  assert.equal(site.nodes.title.props.doc[1].c[2].link, undefined, 'links to deleted pages are dropped');
  assert.deepEqual(site.nodes.logo.props.doc[0].c[0], { text: '', link: { to: 'page', page: 'home' }, token: 'siteName' });
  assert.equal(site.nodes.copy.place.mobile.order, 2);
  assert.equal(site.nodes.hero.place, undefined, 'sections are never placed');
  assert.equal(site.nodes.blob.locked, true);
});

test('invalid or unsafe v2 values are rejected', async () => {
  const base = await kitchenSink();
  const reject = (change, pattern) => {
    const copy = structuredClone(base); change(copy);
    assert.throws(() => normalizeSiteV2(copy), error => error.statusCode === 400 && pattern.test(error.message));
  };
  reject(doc => { doc.nodes.title.style.desktop.color = 'red;background:url(x)'; }, /style value for color/);
  reject(doc => { doc.nodes.cta.style.desktop.fontSize = '12px}</style><script>'; }, /fontSize/);
  reject(doc => { doc.nodes.hero.style.desktop.background = { kind: 'image', src: 'https://x.test/a.png")}body{' }; }, /background/);
  reject(doc => { doc.nodes.copy.children.push('title'); }, /only appear once/);
  reject(doc => { doc.nodes.loose = { type: 'container' }; doc.pages[0].children.push('loose'); }, /only contain sections/);
  reject(doc => { doc.nodes.extra = { type: 'section' }; doc.nodes.copy.children.push('extra'); }, /directly on a page/);
  reject(doc => { doc.nodes.title.props.doc[0].t = 'iframe'; }, /valid tag/);
  reject(doc => { doc.design.fonts.push({ id: 'x', source: 'custom', family: 'X', src: 'https://evil.test/font.woff2' }); }, /uploaded font/);
  let deep = 'card', doc = structuredClone(base);
  for (let i = 0; i < 12; i++) { const id = 'deep' + i; doc.nodes[deep].children = [id]; doc.nodes[id] = { type: 'container', children: [] }; deep = id; }
  assert.throws(() => normalizeSiteV2(doc), /nested at most/);
});

test('breakpoint CSS only contains what changes, with resets for removed properties', async () => {
  const site = normalizeSiteV2(await kitchenSink());
  const css = siteCss(site, pageRoots(site, site.pages[0]));
  const list = media(css), queries = Object.fromEntries(list);
  assert.deepEqual(list.map(([width]) => width), ['1024', '640', '400']);
  assert.ok(css.indexOf('@media (max-width:1024px)') < css.indexOf('@media (max-width:640px)'));
  assert.match(queries[1024], /\.n-hero\{grid-template-columns:1fr\}/);
  assert.match(queries[640], /\.n-hero\{display:flex;flex-direction:column;flex-wrap:nowrap;grid-template-columns:none;grid-template-rows:none\}/);
  assert.match(queries[640], /\.n-copy\{align-self:stretch;order:2;grid-area:auto\}/, 'grid placement is reset when the parent becomes a stack');
  assert.match(queries[640], /\.n-pic\{display:none/);
  assert.match(queries[400], /\.n-pic\{display:block\}/, 'hidden can be switched off again on a smaller breakpoint');
  assert.match(queries[400], /\.n-nav\{display:none\}/);
  assert.ok(!queries[1024].includes('.n-cta'), 'unchanged elements are not repeated');
  assert.match(css, /\.n-cta\{display:inline-flex;align-self:flex-start|\.n-cta\{display:inline-flex;margin:auto -10px 0px 1em/);
  assert.match(css, /transform:rotate\(-2\.5deg\);z-index:3/);
  assert.match(css, /\.n-title\.t-text,\.n-title\.t-text>\*\{letter-spacing:-0\.02em;text-align:left;text-transform:uppercase\}/);
  assert.match(css, /@font-face\{font-family:"Brand Sans";src:url\("\/uploads\/brand-sans\.woff2"\);font-display:swap\}/);
  assert.match(css, /linear-gradient\(var\(--c-bg\),var\(--c-bg\)\)|linear-gradient\(#00000066,#00000066\),url\("https:\/\/example\.test\/bg\.jpg"\) top left\/cover no-repeat var\(--c-bg\)/);
});

test('rendered v2 HTML escapes content and resolves links', async () => {
  const site = normalizeSiteV2(await kitchenSink());
  const html = pageHtmlV2(site, site.pages[0], { year: 2030 });
  assert.ok(!html.includes('<script>alert(1)</script>'));
  assert.ok(html.includes('&lt;script&gt;alert(1)&lt;/script&gt;'));
  assert.ok(html.includes('<title>Welcome</title>'));
  assert.ok(html.includes('<html lang="nb-NO">'));
  assert.ok(html.includes('Kitchen &lt;sink&gt; &amp; &quot;co&quot;'));
  assert.ok(html.includes('<a href="mailto:hi@example.test">Mail </a>'));
  assert.ok(html.includes('<a href="tel:+4722334455" target="_blank" rel="noopener noreferrer">Call</a>'));
  assert.ok(html.includes('href="./about.html#about"'));
  assert.ok(html.includes('<a href="#grid">Anchor</a>'));
  assert.ok(html.includes('<strong>bold<br>line</strong>'));
  assert.ok(html.includes('<video autoplay playsinline loop muted preload="metadata" poster="/uploads/poster.jpg" src="/uploads/clip.mp4">'));
  assert.ok(html.includes('<button type="button" id="plain" class="n n-plain t-button">Learn more</button>'));
  assert.ok(html.includes('© 2030 Kitchen'));
  assert.ok(html.includes('<img loading="lazy" decoding="async" src="/uploads/photo.jpg" alt="Gallery">'), 'galleries without images show the media library');
  const about = pageHtmlV2(site, site.pages[1], { year: 2030 });
  assert.ok(!about.includes('id="hdr"'), 'pages can hide the global header');
  assert.ok(about.includes('id="ftr"'));
});

test('server stores, publishes and serves v2 sites alongside the classic builder', async t => {
  const f = await fixture(); t.after(() => f.cleanup());
  const owner = await f.login();
  const v2 = migrateV1(normalizeSite(example));
  const saved = await f.save(owner, v2); assert.equal(saved.status, 200, saved.text);
  const loaded = await f.request('/api/site', { auth: owner });
  assert.equal(loaded.data.site.version, 2);
  assert.deepEqual(loaded.data.site, JSON.parse(JSON.stringify(v2)));
  const bad = structuredClone(v2); bad.nodes.intro.style.desktop.background = { kind: 'color', color: 'url(javascript:alert(1))' };
  assert.equal((await f.save(owner, bad)).status, 400);
  const published = await f.request('/api/publish', { method: 'POST', auth: owner, body: { revision: loaded.revision ?? saved.data.revision } });
  assert.equal(published.status, 200, published.text);
  const home = await f.request('/');
  assert.equal(home.status, 200);
  for (const phrase of ['/assets/public-v2.css', 'class="n n-intro t-section"', 'A saved heading', '@media (max-width:750px)']) assert.ok(home.text.includes(phrase), phrase);
  assert.equal((await f.request('/about')).status, 200);
  assert.equal((await f.request('/api/contact-token?block=inquiry__form')).status, 200);
  assert.equal((await f.request('/api/contact-token?block=inquiry')).status, 404);
  for (const asset of ['/assets/public-v2.css', '/assets/site-model-v2.mjs', '/assets/render-v2.mjs', '/assets/migrate-v1.mjs']) assert.equal((await f.request(asset)).status, 200, asset);
  const spec = await f.request('/assets/nimble-spec.json');
  assert.equal(spec.status, 200);
  assert.match(spec.headers.get('content-type'), /^application\/json/);
  const preview = await f.request('/api/preview', { method: 'POST', auth: owner, body: { site: v2, pageId: 'about' } });
  assert.equal(preview.status, 200); assert.ok(preview.text.includes('aria-current="page" href="./about.html"'));
});
