import test from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { fixture, ownerCredentials, example, png } from './helpers.mjs';
import { normalizeSite } from '../lib/site-model.mjs';
import { migrateV1 } from '../lib/migrate-v1.mjs';

test('v2 editor: multi-select, marquee, group, align, order, clipboard, shortcuts and context menu', { timeout: 180000 }, async t => {
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
  const selection = () => page.evaluate(() => window.nimbleEditor.selection);
  const primary = () => page.evaluate(() => window.nimbleEditor.selected);
  const rect = id => page.locator('#canvasFrame').evaluate((frame, target) => { const r = frame.contentDocument.getElementById(target).getBoundingClientRect(); return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height }; }, id);
  const screen = (x, y) => page.locator('#canvasFrame').evaluate((frame, [px, py]) => { const o = frame.getBoundingClientRect(), s = o.width / frame.contentWindow.innerWidth; return { x: o.left + px * s, y: o.top + py * s }; }, [x, y]);

  await t.test('shift-click adds and removes elements; parents and children are never selected together', async () => {
    await canvas.locator('#intro__art').click();
    await canvas.locator('#intro__title').click({ modifiers: ['Shift'] });
    assert.deepEqual(await selection(), ['intro__art', 'intro__title']);
    assert.equal(await page.locator('.ov-also').count(), 1);
    await page.locator('#inspector .inspector-title', { hasText: '2 elements selected' }).waitFor();
    await page.locator('.layer-row[data-id="intro__copy"]').click({ modifiers: ['Control'] });
    assert.deepEqual(await selection(), ['intro__art', 'intro__copy'], 'selecting the container replaces its selected child');
    await page.locator('.layer-row[data-id="intro__art"]').click({ modifiers: ['Control'] });
    assert.deepEqual(await selection(), ['intro__copy']);
    assert.equal(await page.locator('.layer-row.selected').count(), 1);
    await page.keyboard.press('Escape');
  });

  await t.test('dragging on empty section space selects with a rectangle', async () => {
    const hero = await rect('intro'), art = await rect('intro__art'), copy = await rect('intro__copy');
    const from = await screen(hero.left + 5, hero.top + 5), to = await screen(Math.max(art.right, copy.right) + 4, Math.max(art.bottom, copy.bottom) + 4);
    await page.mouse.move(from.x, from.y); await page.mouse.down();
    for (let i = 1; i <= 8; i++) await page.mouse.move(from.x + (to.x - from.x) * i / 8, from.y + (to.y - from.y) * i / 8);
    assert.equal(await page.locator('.ov-marquee').count(), 1);
    await page.mouse.up();
    assert.deepEqual((await selection()).sort(), ['intro__art', 'intro__copy']);
  });

  await t.test('align and distribute in a freeform grid; multi-drag moves all selected', async () => {
    await page.locator('#inspector [data-arrange=alignTop]').click();
    let state = await doc();
    const art = await rect('intro__art'), copy = await rect('intro__copy');
    assert.ok(Math.abs(art.top - copy.top) < 1, 'tops aligned: ' + art.top + ' / ' + copy.top);
    assert.equal(state.nodes.intro__copy.place.desktop.alignSelf, 'start');
    await page.keyboard.press('Control+z');
    const before = await rect('intro__art'), beforeCopy = await rect('intro__copy');
    const start = await screen(before.left + before.width / 2, before.top + before.height / 2);
    await page.mouse.move(start.x, start.y); await page.mouse.down();
    for (let i = 1; i <= 8; i++) await page.mouse.move(start.x - i * 3, start.y + i * 4, { steps: 1 });
    await page.keyboard.down('Control'); await page.mouse.move(start.x - 24, start.y + 32); await page.keyboard.up('Control');
    await page.mouse.up();
    const after = await rect('intro__art'), afterCopy = await rect('intro__copy');
    assert.ok(Math.abs((after.top - before.top) - (afterCopy.top - beforeCopy.top)) < 1.5, 'both moved by the same amount');
    assert.ok(after.top > before.top);
    assert.deepEqual((await selection()).sort(), ['intro__art', 'intro__copy'], 'selection is kept after the drag');
    state = await doc();
    assert.ok(state.nodes.intro__art.place.desktop.margin && state.nodes.intro__copy.place.desktop.margin);
    await page.keyboard.press('ArrowLeft');
    const nudged = await rect('intro__art'), nudgedCopy = await rect('intro__copy');
    assert.ok(Math.abs(nudged.left - (after.left - 1)) < 0.6 && Math.abs(nudgedCopy.left - (afterCopy.left - 1)) < 0.6, 'arrow keys nudge every selected element');
  });

  await t.test('group keeps the visual position, adds a mobile stack, and ungroup restores', async () => {
    const art = await rect('intro__art'), copy = await rect('intro__copy');
    await page.keyboard.press('Control+g');
    let state = await doc();
    const group = await primary();
    assert.equal(state.nodes[group].type, 'container');
    assert.deepEqual(state.nodes[group].children.sort(), ['intro__art', 'intro__copy']);
    assert.ok(state.nodes.intro.children.includes(group));
    assert.equal(state.nodes[group].layout.tablet.mode, 'stack', 'below desktop the group stacks its content');
    const artNow = await rect('intro__art'), copyNow = await rect('intro__copy');
    for (const [a, b] of [[art, artNow], [copy, copyNow]]) assert.ok(Math.abs(a.left - b.left) < 1.5 && Math.abs(a.top - b.top) < 1.5, 'unchanged position: ' + JSON.stringify([a, b]));
    await page.locator('#devices button', { hasText: 'Mobile' }).click();
    const mobile = await rect(group), section = await rect('intro');
    assert.ok(mobile.right <= section.right + 1, 'the group fits the mobile width');
    await page.locator('#devices button', { hasText: 'Desktop' }).click();
    await page.keyboard.press('Control+Shift+g');
    state = await doc();
    assert.equal(state.nodes[group], undefined);
    assert.ok(state.nodes.intro.children.includes('intro__art') && state.nodes.intro.children.includes('intro__copy'));
    const artBack = await rect('intro__art');
    assert.ok(Math.abs(artBack.left - art.left) < 1.5 && Math.abs(artBack.top - art.top) < 1.5, 'ungroup keeps the position');
    assert.deepEqual((await selection()).sort(), ['intro__art', 'intro__copy']);
  });

  await t.test('layer order changes stacking among siblings', async () => {
    await canvas.locator('#intro__art').click();
    await page.keyboard.press('Control+Shift+BracketLeft');
    assert.equal((await doc()).nodes.intro.children[0], 'intro__art');
    await page.keyboard.press('Control+BracketRight');
    assert.equal((await doc()).nodes.intro.children[1], 'intro__art');
  });

  await t.test('copy, paste, duplicate and cut with new ids and offsets', async () => {
    await canvas.locator('#intro__art').click();
    await page.keyboard.press('Control+c');
    await page.keyboard.press('Control+v');
    let state = await doc();
    const pasted = await primary();
    assert.notEqual(pasted, 'intro__art');
    assert.ok(state.nodes.intro.children.includes(pasted), 'pasted next to the original');
    const original = state.nodes.intro__art.place.desktop.margin, copy = state.nodes[pasted].place.desktop.margin;
    assert.equal(parseFloat(copy[3]) - parseFloat(original[3]), 20, 'offset by 20px');
    await page.keyboard.press('Control+d');
    const duplicate = await primary();
    state = await doc();
    assert.ok(![pasted, 'intro__art'].includes(duplicate));
    assert.equal(state.nodes.intro.children.indexOf(duplicate), state.nodes.intro.children.indexOf(pasted) + 1);
    await page.keyboard.press('Control+x');
    state = await doc();
    assert.equal(state.nodes[duplicate], undefined);
    await page.locator('.layer-row[data-id="inquiry"]').click();
    await page.keyboard.press('Control+v');
    state = await doc();
    const moved = await primary();
    assert.ok(state.nodes.inquiry.children.includes(moved), 'pasted into the selected section');
    assert.equal(state.nodes[moved].place?.desktop?.cell, undefined, 'grid positions are dropped in a different container');
    await page.keyboard.press('Delete');
    await canvas.locator('#' + pasted).click();
    await page.keyboard.press('Delete');
    assert.equal((await doc()).nodes[pasted], undefined);
  });

  await t.test('sections can be copied, pasted and moved by their tag', async () => {
    await page.locator('.layer-row[data-id="quote"]').click();
    await page.keyboard.press('Control+c');
    await page.keyboard.press('Control+v');
    let state = await doc();
    const section = await primary();
    assert.equal(state.nodes[section].type, 'section');
    assert.equal(state.pages[0].children.indexOf(section), state.pages[0].children.indexOf('quote') + 1);
    assert.equal(state.nodes[section].children.length, state.nodes.quote.children.length, 'children are copied too');
    assert.ok(state.nodes[section].children.every(id => !state.nodes.quote.children.includes(id)));
    const tag = page.locator('.ov-select .ov-tag-drag');
    await tag.waitFor();
    const box = await tag.boundingBox();
    await page.mouse.move(box.x + 10, box.y + 5); await page.mouse.down();
    await page.locator('#canvasFrame').evaluate(frame => frame.contentDocument.getElementById('clip').scrollIntoView({ block: 'center' }));
    const clipNow = await rect('clip'), point = await screen(clipNow.left + 50, clipNow.top + 10);
    for (let i = 1; i <= 8; i++) await page.mouse.move(box.x + (point.x - box.x) * i / 8, box.y + (point.y - box.y) * i / 8);
    await page.mouse.up();
    state = await doc();
    assert.equal(state.pages[0].children.indexOf(section), state.pages[0].children.indexOf('clip') - 1, 'moved above the video section');
    await page.keyboard.press('Control+z');
    await page.keyboard.press('Control+z');
  });

  await t.test('context menu runs actions and reflects what is possible', async () => {
    await canvas.locator('#intro__art').click({ button: 'right' });
    const menu = page.locator('.context-menu');
    await menu.waitFor();
    assert.ok(await menu.locator('[data-menu=ungroup]').isDisabled());
    assert.ok(await menu.locator('[data-menu=paste]').isEnabled(), 'clipboard persists');
    await menu.locator('[data-menu=lock]').click();
    assert.equal((await doc()).nodes.intro__art.locked, true);
    assert.equal(await menu.count(), 0);
    await page.locator('.layer-row[data-id="intro__art"]').click({ button: 'right' });
    await menu.locator('[data-menu=lock]').click();
    assert.equal((await doc()).nodes.intro__art.locked, undefined);
    await canvas.locator('#intro__art').click({ button: 'right' });
    await page.keyboard.press('Escape');
    assert.equal(await menu.count(), 0);
  });

  await t.test('select all, multi delete, shortcut sheet', async () => {
    await canvas.locator('#intro__title').click();
    const count = (await doc()).nodes.intro__copy.children.length;
    await page.keyboard.press('Control+a');
    assert.deepEqual((await selection()).sort(), [...(await doc()).nodes.intro__copy.children].sort());
    await page.keyboard.press('Delete');
    assert.deepEqual((await doc()).nodes.intro__copy.children, []);
    await page.keyboard.press('Control+z');
    assert.equal((await doc()).nodes.intro__copy.children.length, count);
    await page.keyboard.press('?');
    await page.locator('.modal', { hasText: 'Keyboard shortcuts' }).waitFor();
    await page.keyboard.press('Escape');
  });

  await t.test('group and ungroup are desktop-only, and everything is saved', async () => {
    await page.locator('#devices button', { hasText: 'Mobile' }).click();
    await page.locator('.layer-row[data-id="intro__art"]').click();
    await page.locator('.layer-row[data-id="intro__copy"]').click({ modifiers: ['Control'] });
    await page.keyboard.press('Control+g');
    await page.locator('.toast', { hasText: 'Switch to Desktop' }).waitFor();
    await page.locator('#devices button', { hasText: 'Desktop' }).click();
    await page.locator('#saveState').filter({ hasText: 'All changes saved' }).waitFor();
    const stored = (await f.request('/api/site', { auth: owner })).data.site;
    assert.equal(stored.nodes.intro__copy.children.length, 3);
    assert.equal(stored.version, 2);
  });
  assert.deepEqual(errors, []);
});

test('v2 editor: media, site settings, colours, fonts, templates, import/export and sign-in landing', { timeout: 180000 }, async t => {
  const f = await fixture(); t.after(() => f.cleanup());
  const owner = await f.login();
  assert.equal((await f.save(owner, migrateV1(normalizeSite(example)))).status, 200);
  const browser = await chromium.launch(process.env.NIMBLE_BROWSER_CHANNEL ? { channel: process.env.NIMBLE_BROWSER_CHANNEL } : {});
  t.after(() => browser.close());
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true });
  await context.route('**/*', route => route.request().url().startsWith(f.base) || route.request().url().startsWith('about:') ? route.continue() : route.abort());
  const errors = [];
  const page = await context.newPage();
  page.on('pageerror', error => errors.push(error.message));
  page.on('dialog', dialog => dialog.accept());
  await page.goto(f.base + '/login.html');
  await page.locator('#email').fill(ownerCredentials.email); await page.locator('#password').fill(ownerCredentials.password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await page.waitForURL('**/editor.html');
  const canvas = page.frameLocator('#canvasFrame');
  await canvas.locator('#intro').waitFor();
  const doc = () => page.evaluate(() => window.nimbleEditor.doc);

  await t.test('signing in opens the new editor', async () => {
    assert.match(page.url(), /\/editor\.html$/);
  });

  await t.test('media uploads, replaces an image and adds new images', async () => {
    await page.locator('.rail-button[data-tool=media]').click();
    const chooser = page.waitForEvent('filechooser');
    await page.locator('[data-media-upload=image]').click();
    await (await chooser).setFiles({ name: 'pixel.png', mimeType: 'image/png', buffer: png });
    await page.locator('.asset').first().waitFor();
    const asset = (await doc()).assets[0];
    assert.match(asset.url, /^\/uploads\//);
    await page.locator('.rail-button[data-tool=layers]').click();
    await page.locator('.layer-row[data-id="split"] [data-toggle]').click();
    await page.locator('.layer-row[data-id="split__image"]').click();
    await page.locator('.rail-button[data-tool=media]').click();
    await page.locator('.asset-use').first().click();
    assert.equal((await doc()).nodes.split__image.props.src, asset.url);
    await page.locator('.rail-button[data-tool=layers]').click();
    await page.locator('.layer-row[data-id="split"]').click();
    await page.locator('.rail-button[data-tool=media]').click();
    await page.locator('.asset-use').first().click();
    const added = await page.evaluate(() => window.nimbleEditor.selected);
    const state = await doc();
    assert.equal(state.nodes[added].type, 'image');
    assert.equal(state.nodes[added].props.src, asset.url);
    assert.ok(state.nodes.split.children.includes(added));
  });

  await t.test('site settings, theme colours and fonts', async () => {
    await page.locator('.rail-button[data-tool=site]').click();
    await page.locator('[data-site=name]').fill('Renamed site');
    await page.locator('[data-site=name]').press('Tab');
    await canvas.locator('.n-site__logo', { hasText: 'Renamed site' }).waitFor();
    await page.locator('[data-site=searchVisible]').check();
    await page.locator('[data-color=accent]').evaluate(input => { input.value = '#ff0055'; input.dispatchEvent(new Event('change', { bubbles: true })); });
    assert.equal((await doc()).design.colors.accent, '#ff0055');
    assert.equal(await canvas.locator('#intro__button').evaluate(el => getComputedStyle(el).backgroundColor), 'rgb(255, 0, 85)');
    await page.locator('[data-add-color]').click();
    await page.locator('.add-color input[name=key]').fill('brand');
    await page.locator('.add-color button').click();
    assert.ok((await doc()).design.colors.brand);
    await page.locator('[data-remove-color=brand]').click();
    assert.equal((await doc()).design.colors.brand, undefined);
    await page.locator('[data-font=heading]').selectOption('mono');
    assert.equal((await doc()).design.fonts.find(font => font.id === 'heading').family, 'mono');
    assert.match(await canvas.locator('h1').first().evaluate(el => getComputedStyle(el).fontFamily), /monospace/);
    assert.equal((await doc()).site.searchVisible, true);
  });

  await t.test('templates: save, apply built-in with undo, apply saved, export and import', async () => {
    await page.locator('#templatesBtn').click();
    await page.locator('.save-template input[name=name]').fill('My layout');
    await page.locator('.save-template button').click();
    await page.locator('.template-card', { hasText: 'My layout' }).waitFor();
    const download = page.waitForEvent('download');
    await page.locator('[data-export]').click();
    const file = await (await download).path();
    await page.locator('[data-builtin="1"]').click();
    await canvas.locator('h1', { hasText: 'Build it properly.' }).waitFor();
    let state = await doc();
    assert.equal(state.site.name, 'Renamed site', 'the site name is kept');
    assert.equal(state.design.colors.accent, '#df754e');
    await page.keyboard.press('Control+z');
    assert.equal((await doc()).design.colors.accent, '#ff0055');
    await page.locator('#templatesBtn').click();
    await page.locator('.template-card', { hasText: 'Studio' }).locator('[data-builtin]').click();
    await page.locator('#templatesBtn').click();
    await page.locator('.template-card', { hasText: 'My layout' }).locator('[data-apply]').click();
    state = await doc();
    assert.equal(state.design.colors.accent, '#ff0055');
    assert.equal(state.design.fonts.find(font => font.id === 'heading').family, 'mono');
    await page.locator('#templatesBtn').click();
    await page.locator('.template-card', { hasText: 'Minimal' }).locator('[data-builtin]').click();
    await page.locator('#templatesBtn').click();
    const chooser = page.waitForEvent('filechooser');
    await page.locator('[data-import]').click();
    await (await chooser).setFiles(file);
    await canvas.locator('h1', { hasText: 'A saved heading' }).waitFor();
    assert.equal((await doc()).site.name, 'Renamed site');
    await page.locator('#templatesBtn').click();
    await page.locator('.template-card', { hasText: 'My layout' }).locator('[data-delete-template]').click();
    await page.locator('.template-card', { hasText: 'My layout' }).waitFor({ state: 'detached' });
    await page.keyboard.press('Escape');
  });

  await t.test('control panel links to the editor', async () => {
    const panel = await context.newPage();
    await panel.goto(f.base + '/control-panel.html');
    assert.equal(await panel.locator('a.btn', { hasText: 'Open editor' }).getAttribute('href'), '/editor.html');
    await panel.close();
  });
  assert.deepEqual(errors, []);
});
