import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { chromium } from 'playwright';
import { fixture, ownerCredentials, example } from './helpers.mjs';
import { normalizeSite } from '../lib/site-model.mjs';
import { migrateV1 } from '../lib/migrate-v1.mjs';

const WOFF2 = Buffer.concat([Buffer.from('wOF2'), Buffer.alloc(80, 7)]);

test('v2 editor: colour picker, backgrounds, shadows, hover, saved designs, text styles and fonts', { timeout: 240000 }, async t => {
  // A stand-in for fonts.googleapis.com: CSS with two faces, and the font files themselves.
  const google = http.createServer((req, res) => {
    const origin = 'http://127.0.0.1:' + google.address().port;
    if (req.url.startsWith('/css2?')) {
      res.writeHead(200, { 'Content-Type': 'text/css' });
      return res.end(`/* latin */ @font-face { font-family: 'Lora'; font-style: normal; font-weight: 400; src: url(${origin}/f/400.woff2) format('woff2'); }
/* latin */ @font-face { font-family: 'Lora'; font-style: normal; font-weight: 700; src: url(${origin}/f/700.woff2) format('woff2'); }`);
    }
    if (req.url.startsWith('/f/')) { res.writeHead(200, { 'Content-Type': 'font/woff2' }); return res.end(WOFF2); }
    res.writeHead(404); res.end();
  });
  await new Promise(resolve => google.listen(0, '127.0.0.1', resolve));
  t.after(() => google.close());
  const f = await fixture(); t.after(() => f.cleanup());
  await f.stop(); await f.start({ NIMBLE_GOOGLE_FONTS_URL: 'http://127.0.0.1:' + google.address().port });
  const owner = await f.login();
  assert.equal((await f.save(owner, migrateV1(normalizeSite(example)))).status, 200);

  const browser = await chromium.launch(process.env.NIMBLE_BROWSER_CHANNEL ? { channel: process.env.NIMBLE_BROWSER_CHANNEL } : {});
  t.after(() => browser.close());
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  await context.route('**/*', route => route.request().url().startsWith(f.base) || route.request().url().startsWith('about:') ? route.continue() : route.abort());
  const errors = [];
  const page = await context.newPage();
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(f.base + '/login.html');
  await page.locator('#email').fill(ownerCredentials.email); await page.locator('#password').fill(ownerCredentials.password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await page.waitForURL('**/editor.html');
  const canvas = page.frameLocator('#canvasFrame');
  await canvas.locator('#intro').waitFor();
  const doc = () => page.evaluate(() => window.nimbleEditor.doc);
  const field = key => page.locator('#inspector .field[data-group=style][data-key=' + key + ']');
  const hover = key => page.locator('#inspector .field[data-group=hover][data-key=' + key + ']');
  // Sections are picked in Layers; elements inside them on the canvas.
  const selectLayer = async id => {
    if (id.includes('__')) await canvas.locator('#' + id).click();
    else {
      await page.locator('.rail-button[data-tool=layers]').click();
      await page.locator('.layer-row[data-id="' + id + '"]').click();
    }
    assert.equal(await page.evaluate(() => window.nimbleEditor.selected), id);
    await page.locator('#inspector [role=tab]', { hasText: 'Design' }).click();
  };
  const css = () => canvas.locator('#nimble-site').evaluate(style => style.textContent);

  await t.test('colour picker: theme colours, custom colour with opacity and recent colours', async () => {
    await selectLayer('intro__title');
    await field('color').locator('[data-picker]').click();
    await page.locator('.color-popover [data-pick="@accent"]').click();
    assert.equal(await page.locator('.color-popover').count(), 0, 'picking closes the popover');
    assert.equal((await doc()).nodes.intro__title.style.desktop.color, '@accent');
    await field('color').locator('[data-picker]').click();
    await page.locator('.color-popover [data-cp=hex]').fill('#ff000080');
    await page.locator('.color-popover [data-cp=hex]').press('Enter');
    assert.equal((await doc()).nodes.intro__title.style.desktop.color, '#ff000080');
    await field('color').locator('[data-picker]').click();
    assert.equal(await page.locator('.color-popover .cp-recent [data-pick="#ff000080"]').count(), 1, 'recent colours remember custom values');
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('.color-popover').count(), 0);
    assert.equal(await page.evaluate(() => window.nimbleEditor.selected), 'intro__title', 'Escape closes the picker without changing the selection');
  });

  await t.test('gradient stops can be added, moved and removed', async () => {
    await selectLayer('intro');
    const bg = field('background');
    assert.equal(await bg.locator('[data-stop-row]').count(), 2);
    await bg.locator('[data-stop-add]').click();
    let stops = (await doc()).nodes.intro.style.desktop.background.stops;
    assert.equal(stops.length, 3);
    await bg.locator('[data-stop-row]').nth(1).locator('[data-at]').fill('40');
    await bg.locator('[data-stop-row]').nth(1).locator('[data-at]').press('Enter');
    await bg.locator('[data-stop-row]').nth(1).locator('[data-part=value]').fill('@accent');
    await bg.locator('[data-stop-row]').nth(1).locator('[data-part=value]').press('Enter');
    stops = (await doc()).nodes.intro.style.desktop.background.stops;
    assert.deepEqual(stops[1], { color: '@accent', at: 40 });
    assert.match(await css(), /linear-gradient\(125deg,#fffaf1 0%,var\(--c-accent\) 40%,#f3edff 100%\)/);
    await bg.locator('[data-stop-remove]').first().click();
    assert.equal((await doc()).nodes.intro.style.desktop.background.stops.length, 2);
  });

  await t.test('image backgrounds take a focal point; sections can have a video background', async () => {
    await selectLayer('clip');
    const bg = field('background');
    assert.ok((await bg.locator('[data-part=kind] option').allTextContents()).includes('video'), 'sections offer video');
    await bg.locator('[data-part=kind]').selectOption('image');
    await bg.locator('[data-part=src]').fill('https://images.example/photo.jpg');
    await bg.locator('[data-part=src]').press('Enter');
    assert.equal((await doc()).nodes.clip.style.desktop.background.src, 'https://images.example/photo.jpg');
    const box = await bg.locator('[data-focal]').boundingBox();
    await page.mouse.click(box.x + box.width * 0.25, box.y + box.height * 0.75);
    assert.deepEqual((await doc()).nodes.clip.style.desktop.background.focal, [25, 75]);
    assert.match(await css(), /\.n-clip\{[^}]*background:url\("https:\/\/images\.example\/photo\.jpg"\) 25% 75%\/cover/);
    await bg.locator('[data-part=kind]').selectOption('video');
    await bg.locator('[data-part=src]').fill('/uploads/loop.mp4');
    await bg.locator('[data-part=src]').press('Enter');
    await bg.locator('[data-overlay]').fill('#00000066');
    await bg.locator('[data-overlay]').press('Enter');
    assert.deepEqual((await doc()).nodes.clip.style.desktop.background, { kind: 'video', src: '/uploads/loop.mp4', overlay: '#00000066' });
    assert.equal(await canvas.locator('#clip > video.bg-video').count(), 1);
    assert.equal(await canvas.locator('#clip > .bg-overlay').count(), 1);
    await selectLayer('clip__title');
    assert.ok(!(await field('background').locator('[data-part=kind] option').allTextContents()).includes('video'), 'text cannot have a video background');
  });

  await t.test('several shadows, corner radius, blend mode and scroll effect', async () => {
    await selectLayer('intro__button');
    const shadow = field('shadow');
    await shadow.locator('[data-shadow-add]').click();
    await shadow.locator('[data-shadow-add]').click();
    await shadow.locator('[data-shadow-row]').nth(1).locator('[data-shadow=inset]').check();
    await shadow.locator('[data-shadow-row]').nth(1).locator('[data-shadow=blur]').fill('2');
    await shadow.locator('[data-shadow-row]').nth(1).locator('[data-shadow=blur]').press('Enter');
    let shadows = (await doc()).nodes.intro__button.style.desktop.shadow;
    assert.equal(shadows.length, 2);
    assert.deepEqual(shadows[1], { x: '0px', y: '4px', blur: '2px', spread: '0px', color: '#00000033', inset: true });
    await shadow.locator('[data-shadow-remove]').first().click();
    shadows = (await doc()).nodes.intro__button.style.desktop.shadow;
    assert.equal(shadows.length, 1);
    assert.equal(shadows[0].inset, true);
    assert.deepEqual(await field('radius').locator('input').evaluateAll(inputs => inputs.map(input => input.title)), ['Top left', 'Top right', 'Bottom right', 'Bottom left']);
    await field('blendMode').locator('select').selectOption('multiply');
    assert.equal((await doc()).nodes.intro__button.style.desktop.blendMode, 'multiply');
    await selectLayer('quote');
    await field('scrollEffect').locator('select').selectOption('parallax');
    assert.equal(await canvas.locator('#quote').getAttribute('data-fx'), '');
  });

  await t.test('hover design', async () => {
    await selectLayer('intro__button');
    await page.locator('#inspector details[data-group-name=hover] summary').click();
    await hover('background').locator('[data-part=kind]').selectOption('color');
    await hover('background').locator('[data-part=value]').fill('@ink');
    await hover('background').locator('[data-part=value]').press('Enter');
    await hover('scale').locator('input').fill('1.05');
    await hover('scale').locator('input').press('Enter');
    assert.deepEqual((await doc()).nodes.intro__button.hover, { background: { kind: 'color', color: '@ink' }, scale: 1.05 });
    assert.match(await css(), /\.n-intro__button:hover\{[^}]*scale:1\.05/);
    assert.equal(await page.locator('#inspector details[data-group-name=hover]').getAttribute('open'), '', 'the hover group stays open');
    await hover('scale').locator('[data-reset]').click();
    assert.deepEqual((await doc()).nodes.intro__button.hover, { background: { kind: 'color', color: '@ink' } });
  });

  await t.test('save a design and apply it to another element of the same type', async () => {
    await selectLayer('intro__button');
    await page.locator('#inspector [data-preset-save]').click();
    await page.locator('#inspector .preset-save input').fill('Shadow button');
    await page.locator('#inspector .preset-save input').press('Enter');
    let state = await doc();
    assert.equal(state.design.presets.length, 1);
    assert.deepEqual(state.design.presets[0].style, state.nodes.intro__button.style);
    await selectLayer('cta__button');
    await page.locator('#inspector [data-preset-apply]').selectOption({ label: 'Shadow button' });
    state = await doc();
    assert.deepEqual(state.nodes.cta__button.style, state.nodes.intro__button.style);
    await selectLayer('cta__title');
    assert.equal(await page.locator('#inspector [data-preset-apply]').count(), 0, 'button designs are not offered for text');
  });

  await t.test('text styles per breakpoint', async () => {
    await page.locator('.rail-button[data-tool=site]').click();
    await page.locator('#sitePanel [data-ts-key-select]').selectOption('h2');
    await page.locator('#devices button', { hasText: 'Tablet' }).click();
    const size = page.locator('#sitePanel [data-ts-key=fontSize] input');
    assert.ok(await size.getAttribute('placeholder'), 'tablet shows the inherited size');
    await size.fill('30');
    await size.press('Enter');
    assert.equal((await doc()).design.textStyles.h2.tablet.fontSize, '30px');
    assert.match(await css(), /@media \(max-width:1000px\)\{[^@]*\.ts-h2[^{]*\{[^}]*font-size:30px/);
    await page.locator('#sitePanel [data-ts-key=fontSize] [data-ts-reset]').click();
    assert.equal((await doc()).design.textStyles.h2.tablet?.fontSize, undefined);
    await page.locator('#devices button', { hasText: 'Desktop' }).click();
  });

  await t.test('import a Google font, upload a font file and use them', async () => {
    await page.locator('#sitePanel .google-font input[name=family]').fill('Lora');
    await page.locator('#sitePanel .google-font button').click();
    await page.locator('#sitePanel .font-list li', { hasText: 'Lora' }).waitFor();
    let fonts = (await doc()).design.fonts;
    const lora = fonts.find(font => font.family === 'Lora');
    assert.equal(lora.id, 'f-lora');
    assert.deepEqual(lora.files.map(file => file.weight), [400, 700]);
    await page.locator('#sitePanel [data-font=heading]').selectOption({ label: 'Lora (self-hosted)' });
    fonts = (await doc()).design.fonts;
    assert.deepEqual(fonts.find(font => font.id === 'heading'), { id: 'heading', source: 'custom', family: 'Lora', files: lora.files });
    assert.match(await css(), /@font-face\{font-family:"Lora";src:url\("\/uploads\/[a-z0-9-]+\.woff2"\);font-weight:700/);
    assert.match(await canvas.locator('#intro__title h1').evaluate(el => getComputedStyle(el).fontFamily), /Lora/);

    const chooser = page.waitForEvent('filechooser');
    await page.locator('#sitePanel [data-upload-font]').click();
    await (await chooser).setFiles({ name: 'Brand_Display.woff2', mimeType: '', buffer: WOFF2 });
    await page.locator('#sitePanel .font-list li', { hasText: 'Brand Display' }).waitFor();
    const brand = (await doc()).design.fonts.find(font => font.family === 'Brand Display');
    assert.match(brand.src, /^\/uploads\/[a-z0-9-]+\.woff2$/);
    assert.equal(await page.locator('#sitePanel [data-remove-font="f-lora"]').count(), 1);
    await page.locator('#sitePanel [data-remove-font="' + brand.id + '"]').click();
    assert.equal((await doc()).design.fonts.some(font => font.id === brand.id), false, 'unused fonts can be removed');
  });

  await t.test('everything publishes', async () => {
    await page.locator('#saveState').filter({ hasText: 'All changes saved' }).waitFor();
    const revision = (await f.request('/api/site', { auth: owner })).data.revision;
    const published = await f.request('/api/publish', { method: 'POST', auth: owner, body: { revision } });
    assert.equal(published.status, 200, published.text);
    const html = (await f.request('/')).text;
    assert.equal((html.match(/@font-face\{font-family:"Lora"/g) || []).length, 2, 'shared faces are declared once');
    assert.match(html, /\.n-intro__button:hover\{[^}]*background:var\(--c-ink\)/);
    assert.match(html, /<video class="bg-video bg-v0"[^>]*src="\/uploads\/loop\.mp4"/);
    assert.match(html, /<section id="quote"[^>]* data-fx[ >]/);
    const fontFile = html.match(/url\("(\/uploads\/[a-z0-9-]+\.woff2)"\)/)[1];
    assert.equal((await f.request(fontFile)).status, 200);
  });
  assert.deepEqual(errors, []);
});
