import test from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { fixture, ownerCredentials, example } from './helpers.mjs';
import { normalizeSite } from '../lib/site-model.mjs';
import { migrateV1 } from '../lib/migrate-v1.mjs';

test('v2 editor: add panel search, drag onto the canvas, icons, button variants, lines and SVG uploads', { timeout: 180000 }, async t => {
  const f = await fixture(); t.after(() => f.cleanup());
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
  const selected = () => page.evaluate(() => window.nimbleEditor.selected);
  const item = text => page.locator('#addPanel [data-add]', { hasText: new RegExp('^\\S*' + text + '$') });
  const openAdd = () => page.locator('.rail-button[data-tool=add]').click();
  const selectLayer = async id => { await page.locator('.rail-button[data-tool=layers]').click(); await page.locator('.layer-row[data-id="' + id + '"]').click(); };
  // Drags a panel item to the centre (or a fraction) of a canvas element.
  async function dragTo(text, targetSelector, fx = 0.5, fy = 0.5, { cancel = false } = {}) {
    await openAdd();
    await canvas.locator(targetSelector).evaluate((el, fy) => { const r = el.getBoundingClientRect(); el.ownerDocument.defaultView.scrollBy(0, r.top + r.height * fy - 300); }, fy);
    await page.waitForTimeout(50);
    await item(text).scrollIntoViewIfNeeded();
    const from = await item(text).boundingBox(), to = await canvas.locator(targetSelector).boundingBox();
    await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
    await page.mouse.down();
    const x = to.x + to.width * fx, y = to.y + to.height * fy;
    for (let i = 1; i <= 8; i++) await page.mouse.move(from.x + (x - from.x) * i / 8, from.y + (y - from.y) * i / 8);
    const feedback = await page.locator('#canvasOverlay .ov-insert, #canvasOverlay .ov-target').count();
    if (cancel) await page.keyboard.press('Escape');
    await page.mouse.up();
    return feedback;
  }

  await t.test('search filters the element list', async () => {
    await openAdd();
    await page.locator('#addPanel .add-search').fill('circle');
    assert.ok(await item('Circle').isVisible());
    assert.equal(await item('Gallery').count(), 0);
    await page.locator('#addPanel .add-search').fill('zzz');
    assert.match(await page.locator('#addPanel .add-results').textContent(), /No elements match/);
    await page.locator('#addPanel .add-search').fill('');
    assert.ok(await item('Gallery').isVisible());
  });

  await t.test('click adds an icon; the icon picker changes it', async () => {
    await selectLayer('clip');
    await openAdd();
    await item('Icon').click();
    const id = await selected();
    let state = await doc();
    assert.equal(state.nodes[id].type, 'icon');
    assert.equal(state.nodes.clip.children.at(-1), id);
    assert.equal(await canvas.locator('#' + id + ' svg path').count(), 1);
    await page.locator('#inspector [role=tab]', { hasText: 'Content' }).click();
    await page.locator('#inspector .icon-picker summary').click();
    await page.locator('#inspector [data-icon-pick=heart]').click();
    state = await doc();
    assert.equal(state.nodes[id].props.icon, 'heart');
    assert.equal(await page.locator('#inspector [data-icon-pick=""]').count(), 0, 'an icon element always has an icon');
  });

  await t.test('drag into a stack inserts at the line shown', async () => {
    const before = (await doc()).nodes.quote.children.slice();
    const feedback = await dragTo('Button with icon', '#quote', 0.5, 0.05);
    assert.ok(feedback > 0, 'insertion feedback while dragging');
    const state = await doc(), id = await selected();
    assert.deepEqual(state.nodes[id].props, { label: 'Learn more', icon: 'arrow-right', iconPosition: 'end' });
    assert.deepEqual(state.nodes.quote.children, [id, ...before], 'dropped above the first child');
    assert.equal(await canvas.locator('#' + id + ' > span').textContent(), 'Learn more');
    assert.equal(await canvas.locator('#' + id + ' > svg').count(), 1);
  });

  await t.test('drag into a grid docks the element in the cell under the pointer', async () => {
    await dragTo('Circle', '#intro__art', 0.5, 0.5);
    const state = await doc(), id = await selected();
    assert.equal(state.nodes[id].props.shape, 'ellipse');
    assert.ok(state.nodes.intro.children.includes(id));
    const place = state.nodes[id].place.desktop;
    assert.deepEqual(place.cell, [1, 2, 1, 1]);
    assert.equal(place.justifySelf, 'start');
    assert.ok(parseFloat(place.margin[0]) > 0 && parseFloat(place.margin[3]) > 0, 'offset to the drop point');
  });

  await t.test('drag a section between sections; Escape cancels a drag', async () => {
    const before = (await doc()).pages[0].children.slice();
    await dragTo('Section \\(boxed\\)', '#clip', 0.5, 0.1);
    let children = (await doc()).pages[0].children;
    assert.equal(children.length, before.length + 1);
    assert.equal(children.indexOf(await selected()), before.indexOf('clip'), 'inserted before Our clip');
    const count = Object.keys((await doc()).nodes).length;
    await dragTo('Icon', '#quote', 0.5, 0.5, { cancel: true });
    assert.equal(Object.keys((await doc()).nodes).length, count);
    assert.equal(await page.locator('.add-ghost').count(), 0);
  });

  await t.test('icon button, outline button and vertical line', async () => {
    await selectLayer('cta');
    await openAdd();
    await item('Icon button').click();
    let id = await selected(), state = await doc();
    assert.equal(state.nodes[id].props.hideLabel, true);
    assert.equal(await canvas.locator('#' + id + ' .vh').textContent(), 'Next');
    await openAdd();
    await item('Outline button').click();
    id = await selected(); state = await doc();
    assert.equal(state.nodes[id].style.desktop.background.color, 'transparent');
    assert.equal(await canvas.locator('#' + id).evaluate(el => getComputedStyle(el).borderTopWidth), '2px');
    await openAdd();
    await item('Vertical line').click();
    id = await selected();
    await page.locator('#inspector [role=tab]', { hasText: 'Content' }).click();
    await page.locator('#inspector .field[data-key=thickness] input').fill('4');
    await page.locator('#inspector .field[data-key=thickness] input').press('Enter');
    state = await doc();
    assert.deepEqual(state.nodes[id].props, { orientation: 'vertical', thickness: '4px' });
    assert.equal(await canvas.locator('#' + id).evaluate(el => getComputedStyle(el).borderLeftWidth), '4px');
  });

  await t.test('SVG images upload through the media library', async () => {
    await page.locator('.rail-button[data-tool=media]').click();
    const chooser = page.waitForEvent('filechooser');
    await page.locator('#mediaPanel [data-media-upload=image]').click();
    await (await chooser).setFiles({ name: 'mark.svg', mimeType: 'image/svg+xml', buffer: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect width="10" height="10" fill="#e33"/></svg>') });
    await page.locator('#mediaPanel .asset', { hasText: 'mark.svg' }).waitFor();
    const asset = (await doc()).assets.find(item => item.name === 'mark.svg');
    assert.match(asset.url, /\.svg$/);
    assert.equal(await page.locator('#mediaPanel .asset img[src="' + asset.url + '"]').evaluate(img => img.naturalWidth > 0), true, 'the SVG renders as an image');
  });

  await t.test('new elements publish', async () => {
    await page.locator('#saveState').filter({ hasText: 'All changes saved' }).waitFor();
    const revision = (await f.request('/api/site', { auth: owner })).data.revision;
    assert.equal((await f.request('/api/publish', { method: 'POST', auth: owner, body: { revision } })).status, 200);
    const html = (await f.request('/')).text;
    assert.match(html, /class="n n-icon-[a-z0-9]+ t-icon" aria-hidden="true"><svg viewBox="0 0 24 24"/);
    assert.match(html, /<span class="vh">Next<\/span>/);
    assert.match(html, /t-divider is-vertical" aria-orientation="vertical">/);
  });
  assert.deepEqual(errors, []);
});
