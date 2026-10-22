import test from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { fixture, ownerCredentials, example } from './helpers.mjs';
import { normalizeSite } from '../lib/site-model.mjs';
import { migrateV1 } from '../lib/migrate-v1.mjs';

test('v2 editor: layout containers, grid editor, spacing, docking and section presets', { timeout: 180000 }, async t => {
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
  await page.goto(f.base + '/login.html?next=/editor.html');
  await page.locator('#email').fill(ownerCredentials.email); await page.locator('#password').fill(ownerCredentials.password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await page.waitForURL('**/editor.html');
  const canvas = page.frameLocator('#canvasFrame');
  await canvas.locator('#intro').waitFor();
  const doc = () => page.evaluate(() => window.nimbleEditor.doc);
  const css = (selector, property) => canvas.locator(selector).first().evaluate((el, name) => getComputedStyle(el)[name], property);
  const lp = selector => page.locator('#inspector .lp ' + selector);
  const rowOf = key => page.locator('#inspector .lp-row[data-k^="' + key + '"]');
  const layoutTab = () => page.getByRole('tab', { name: 'Layout' }).click();

  await t.test('grid editor: presets, track sizes, add and remove columns', async () => {
    await page.locator('.layer-row[data-id="columns"]').click();
    await layoutTab();
    await lp('[data-lp-set=mode][data-value=grid]').click();
    let layout = (await doc()).nodes.columns.layout.desktop;
    assert.equal(layout.mode, 'grid'); assert.deepEqual(layout.columns, ['1fr']);
    assert.equal(await css('#columns', 'display'), 'grid');
    await page.locator('#inspector .chip', { hasText: '1:2' }).click();
    assert.deepEqual((await doc()).nodes.columns.layout.desktop.columns, ['1fr', '2fr']);
    await lp('[data-lp-track-unit=columns][data-i="0"]').selectOption('px');
    await lp('[data-lp-track=columns][data-i="0"]').fill('300');
    await lp('[data-lp-track=columns][data-i="0"]').press('Enter');
    assert.deepEqual((await doc()).nodes.columns.layout.desktop.columns, ['300px', '2fr']);
    assert.match(await css('#columns', 'gridTemplateColumns'), /^300px /);
    await lp('[data-lp-track-add=columns]').click();
    assert.equal((await doc()).nodes.columns.layout.desktop.columns.length, 3);
    await lp('[data-lp-track-add=rows]').click();
    assert.deepEqual((await doc()).nodes.columns.layout.desktop.rows, ['auto']);
    await lp('[data-lp-track-remove=columns][data-i="2"]').click();
    assert.deepEqual((await doc()).nodes.columns.layout.desktop.columns, ['300px', '2fr']);
    assert.ok(await lp('.grid-preview').count());
  });

  await t.test('removing a column moves children placed in it back inside', async () => {
    await page.locator('.layer-row[data-id="intro"]').click();
    await layoutTab();
    assert.deepEqual((await doc()).nodes.intro__art.place.desktop.cell, [1, 2, 1, 1]);
    await lp('[data-lp-track-remove=columns][data-i="1"]').click();
    const state = await doc();
    assert.deepEqual(state.nodes.intro.layout.desktop.columns, ['1.2fr']);
    assert.deepEqual(state.nodes.intro__art.place.desktop.cell, [1, 1, 1, 1]);
    await page.keyboard.press('Control+z');
    assert.deepEqual((await doc()).nodes.intro__art.place.desktop.cell, [1, 2, 1, 1]);
  });

  await t.test('dragging a column divider on the canvas resizes the two columns', async () => {
    const handle = page.locator('.ov-col-handle').first();
    await handle.waitFor();
    const box = await handle.boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + 40); await page.mouse.down();
    for (let i = 1; i <= 8; i++) await page.mouse.move(box.x + box.width / 2 - i * 10, box.y + 40);
    await page.mouse.up();
    const [a, b] = (await doc()).nodes.intro.layout.desktop.columns;
    assert.match(a, /fr$/); assert.match(b, /fr$/);
    assert.ok(parseFloat(a) < 1.2, 'left column got narrower: ' + a);
    assert.equal(Math.round((parseFloat(a) + parseFloat(b)) * 100) / 100, 2, 'the total stays the same');
  });

  await t.test('stack controls set direction, distribution, alignment and wrap', async () => {
    await page.locator('.layer-row[data-id="cta"]').click();
    await layoutTab();
    await lp('[data-lp-set=direction][data-value=column]').click();
    await lp('[data-lp-set=justify][data-value=center]').click();
    await lp('[data-lp-set=align][data-value=end]').click();
    await lp('[data-lp-set=wrap][data-value=true]').click();
    const layout = (await doc()).nodes.cta.layout.desktop;
    assert.equal(layout.direction, 'column'); assert.equal(layout.justify, 'center'); assert.equal(layout.align, 'end'); assert.equal(layout.wrap, true);
    assert.equal(await css('#cta', 'flexDirection'), 'column');
    assert.equal(await css('#cta', 'alignItems'), 'flex-end');
    assert.equal(await css('#cta', 'flexWrap'), 'wrap');
  });

  await t.test('gaps link, padding sides link, and values apply per breakpoint', async () => {
    await page.locator('#inspector .lp .box-link[data-lp-link=gap]').click();
    await lp('[data-lp-len=rowGap]').fill('24');
    await lp('[data-lp-len=rowGap]').press('Enter');
    let layout = (await doc()).nodes.cta.layout.desktop;
    assert.equal(layout.rowGap, '24px'); assert.equal(layout.columnGap, '24px');
    await page.locator('#devices button', { hasText: 'Mobile' }).click();
    const paddingLink = page.locator('#inspector .lp .box-link[data-lp-link=padding]');
    assert.equal(await paddingLink.getAttribute('aria-pressed'), 'false', 'unequal sides start unlinked');
    await paddingLink.click();
    await lp('[data-lp-box=padding][data-side="0"]').fill('12');
    await lp('[data-lp-box=padding][data-side="0"]').press('Enter');
    const state = await doc();
    assert.deepEqual(state.nodes.cta.layout.mobile.padding, ['12px', '12px', '12px', '12px']);
    assert.deepEqual(state.nodes.cta.layout.desktop.padding, ['70px', '35px', '70px', '35px'], 'desktop is untouched');
    assert.equal(await rowOf('padding').evaluate(el => el.classList.contains('has-own')), true);
    await rowOf('padding').locator('[data-lp-reset]').click();
    assert.equal((await doc()).nodes.cta.layout.mobile.padding, undefined, 'reset removes the mobile override');
    assert.equal(await css('#cta', 'paddingTop'), '70px', 'mobile now inherits the desktop padding');
    await page.locator('#devices button', { hasText: 'Desktop' }).click();
  });

  await t.test('docking, cell spans and full-width elements in a grid', async () => {
    await canvas.locator('#intro__art').click();
    await layoutTab();
    await lp('[data-lp-dock="end,start"]').click();
    let place = (await doc()).nodes.intro__art.place.desktop;
    assert.equal(place.justifySelf, 'end'); assert.equal(place.alignSelf, 'start');
    assert.deepEqual(place.margin, ['0px', '0px', '0px', '0px']);
    assert.equal(await css('#intro__art', 'justifySelf'), 'end');
    await lp('[data-lp-span-all]').click();
    assert.deepEqual((await doc()).nodes.intro__art.place.desktop.cell, [1, 1, 1, 2]);
    await lp('[data-lp-cell="2"]').fill('2');
    await lp('[data-lp-cell="2"]').press('Enter');
    assert.deepEqual((await doc()).nodes.intro__art.place.desktop.cell, [1, 1, 2, 2]);
    await lp('[data-lp-stretch=h]').click();
    place = (await doc()).nodes.intro__art.place.desktop;
    assert.equal(place.justifySelf, 'stretch'); assert.equal(place.width, 'auto');
    await lp('[data-lp-unit=height]').selectOption('vh');
    await lp('[data-lp-len=height]').fill('30');
    await lp('[data-lp-len=height]').press('Enter');
    assert.equal((await doc()).nodes.intro__art.place.desktop.height, '30vh');
  });

  await t.test('stretch to full width in a stack and margins with auto', async () => {
    // The art now covers the copy column on the canvas, so select the button in Layers.
    await page.locator('.layer-row[data-id="intro__copy"] [data-toggle]').click();
    await page.locator('.layer-row[data-id="intro__button"]').click();
    await layoutTab();
    await lp('[data-lp-full]').click();
    let place = (await doc()).nodes.intro__button.place.desktop;
    assert.equal(place.width, '100%');
    const copyWidth = await canvas.locator('#intro__copy').evaluate(el => el.clientWidth);
    assert.equal(await canvas.locator('#intro__button').evaluate(el => el.offsetWidth), copyWidth);
    await lp('[data-lp-full]').click();
    assert.equal((await doc()).nodes.intro__button.place?.desktop?.width, undefined);
    await lp('[data-lp-box=margin][data-side="3"]').fill('auto');
    await lp('[data-lp-box=margin][data-side="3"]').press('Enter');
    place = (await doc()).nodes.intro__button.place.desktop;
    assert.equal(place.margin[3], 'auto');
  });

  await t.test('section presets: full width, boxed and full-screen height', async () => {
    await page.locator('.layer-row[data-id="quote"]').click();
    await layoutTab();
    await lp('[data-lp-set=sectionWidth][data-value=full]').click();
    assert.equal((await doc()).nodes.quote.layout.desktop.contentWidth, 'auto');
    assert.equal(await css('#quote', 'paddingLeft'), '35px');
    await lp('[data-lp-set=sectionWidth][data-value=boxed]').click();
    await lp('[data-lp-len=contentWidth]').fill('600');
    await lp('[data-lp-len=contentWidth]').press('Enter');
    assert.equal((await doc()).nodes.quote.layout.desktop.contentWidth, '600px');
    await page.locator('#inspector .chip', { hasText: 'Full screen' }).click();
    assert.equal((await doc()).nodes.quote.layout.desktop.minHeight, '100vh');
    const viewport = await canvas.locator('html').evaluate(() => innerHeight);
    assert.ok(Math.abs(await canvas.locator('#quote').evaluate(el => el.offsetHeight) - viewport) <= 1);
  });

  await t.test('add panel creates grids, stacks and section presets', async () => {
    await page.locator('.layer-row[data-id="quote"]').click();
    await page.locator('.rail-button[data-tool=add]').click();
    await page.locator('[data-add=section-columns]').click();
    let state = await doc();
    const section = state.nodes[(await page.evaluate(() => window.nimbleEditor.selected))];
    assert.equal(section.type, 'section');
    assert.deepEqual(section.layout.desktop.columns, ['1fr', '1fr']);
    assert.deepEqual(section.layout.mobile.columns, ['1fr']);
    assert.ok(state.pages[0].children.indexOf(section.id) === state.pages[0].children.indexOf('quote') + 1, 'inserted after the selected section');
    assert.equal(await page.getByRole('tab', { name: 'Layout' }).getAttribute('aria-selected'), 'true', 'layout tab opens for new containers');
    await page.locator('.rail-button[data-tool=add]').click();
    await page.locator('[data-add=stack-row]').click();
    state = await doc();
    const stack = state.nodes[(await page.evaluate(() => window.nimbleEditor.selected))];
    assert.equal(stack.type, 'container');
    assert.equal(stack.layout.desktop.direction, 'row');
    assert.ok(section.id && state.nodes[section.id].children.includes(stack.id));
    await page.locator('.rail-button[data-tool=add]').click();
    await page.locator('[data-add=grid-3]').click();
    const grid = (await doc()).nodes[(await page.evaluate(() => window.nimbleEditor.selected))];
    assert.deepEqual(grid.layout.desktop.columns, ['1fr', '1fr', '1fr']);
    assert.ok((await doc()).nodes[stack.id].children.includes(grid.id), 'nested inside the selected stack');
  });

  await t.test('layout changes are saved and published', async () => {
    await page.locator('#saveState').filter({ hasText: 'All changes saved' }).waitFor();
    const stored = (await f.request('/api/site', { auth: owner })).data.site;
    assert.equal(stored.nodes.quote.layout.desktop.minHeight, '100vh');
    assert.equal(stored.nodes.cta.layout.desktop.wrap, true);
  });
  assert.deepEqual(errors, []);
});
