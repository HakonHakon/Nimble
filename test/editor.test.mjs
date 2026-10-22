import test from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { fixture, ownerCredentials, example } from './helpers.mjs';

test('v2 editor: canvas selection, layers, inspector, breakpoints, undo and publishing', { timeout: 180000 }, async t => {
  const f = await fixture(); t.after(() => f.cleanup());
  const owner = await f.login();
  assert.equal((await f.save(owner, example)).status, 200);
  const browser = await chromium.launch(process.env.NIMBLE_BROWSER_CHANNEL ? { channel: process.env.NIMBLE_BROWSER_CHANNEL } : {});
  t.after(() => browser.close());
  const context = await browser.newContext({ viewport: { width: 1500, height: 950 } });
  await context.route('**/*', route => route.request().url().startsWith(f.base) || route.request().url().startsWith('about:') ? route.continue() : route.abort());
  const errors = [];
  const page = await context.newPage();
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(f.base + '/login.html?next=/editor.html');
  await page.locator('#email').fill(ownerCredentials.email); await page.locator('#password').fill(ownerCredentials.password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await page.waitForURL('**/editor.html');
  const canvas = page.frameLocator('#canvasFrame');
  const editor = () => page.evaluate(() => ({ doc: window.nimbleEditor.doc, selected: window.nimbleEditor.selected, bp: window.nimbleEditor.bp }));
  const saved = () => page.locator('#saveState').filter({ hasText: 'All changes saved' }).waitFor();
  const style = (selector, property) => canvas.locator(selector).first().evaluate((element, name) => getComputedStyle(element)[name], property);
  const inspectorField = key => page.locator('#inspector .field[data-key="' + key + '"]');
  await canvas.locator('h1').first().waitFor();

  await t.test('classic sites open migrated, unchanged until the first edit', async () => {
    await page.locator('#banner').filter({ hasText: 'made with the classic builder' }).waitFor();
    assert.notEqual((await f.request('/api/site', { auth: owner })).data.site.version, 2);
    await page.locator('.layer-row', { hasText: 'Hero' }).first().waitFor();
  });

  await t.test('clicking the canvas selects the deepest element and syncs layers and inspector', async () => {
    await canvas.locator('h1').first().click();
    assert.equal((await editor()).selected, 'intro__title');
    await page.locator('.layer-row.selected', { hasText: 'A saved heading' }).waitFor();
    await page.locator('#inspector .crumb').filter({ hasText: 'Hero' }).waitFor();
    await page.keyboard.press('Escape');
    assert.equal((await editor()).selected, 'intro__copy');
    await page.locator('#inspector .crumb', { hasText: 'A saved heading' }).count().then(count => assert.equal(count, 0));
    await page.locator('.layer-row', { hasText: 'A saved heading' }).click();
    assert.equal((await editor()).selected, 'intro__title');
    assert.ok(await page.locator('.ov-select .ov-tag').textContent(), 'selection box is drawn');
  });

  await t.test('content edits render live, save as v2 and survive reload', async () => {
    await page.locator('#inspector textarea[data-part=text]').fill('Designed in the new editor');
    await canvas.locator('h1', { hasText: 'Designed in the new editor' }).waitFor();
    await saved();
    const stored = (await f.request('/api/site', { auth: owner })).data.site;
    assert.equal(stored.version, 2);
    assert.equal(stored.nodes.intro__title.props.doc[0].c[0].text, 'Designed in the new editor');
    await page.reload();
    await canvas.locator('h1', { hasText: 'Designed in the new editor' }).waitFor();
    assert.ok(await page.locator('#banner').isHidden());
  });

  await t.test('design values apply per breakpoint and undo/redo step through them', async () => {
    await canvas.locator('h1').first().click();
    await page.getByRole('tab', { name: 'Design' }).click();
    await inspectorField('fontSize').locator('input').fill('50');
    await inspectorField('fontSize').locator('input').press('Enter');
    assert.equal(await style('h1', 'fontSize'), '50px');
    await page.locator('#devices button', { hasText: 'Mobile' }).click();
    assert.equal(await page.locator('#canvasFrame').evaluate(frame => frame.getBoundingClientRect().width / (frame.parentElement.getBoundingClientRect().width / frame.parentElement.offsetWidth)), 390);
    assert.equal(await inspectorField('fontSize').locator('input').getAttribute('placeholder'), '50px', 'mobile shows the inherited desktop value');
    await inspectorField('fontSize').locator('input').fill('30px');
    await inspectorField('fontSize').locator('input').press('Enter');
    assert.equal(await style('h1', 'fontSize'), '30px');
    let state = await editor();
    assert.deepEqual(state.doc.nodes.intro__title.style, { desktop: { fontSize: '50px' }, mobile: { fontSize: '30px' } });
    await page.locator('#devices button', { hasText: 'Desktop' }).click();
    assert.equal(await style('h1', 'fontSize'), '50px');
    await page.locator('body').click({ position: { x: 5, y: 900 } });
    await page.keyboard.press('Control+z');
    state = await editor();
    assert.equal(state.doc.nodes.intro__title.style.mobile, undefined);
    await page.locator('#redoBtn').click();
    state = await editor();
    assert.equal(state.doc.nodes.intro__title.style.mobile.fontSize, '30px');
    await inspectorField('fontSize').locator('[data-reset]').click();
    assert.equal((await editor()).doc.nodes.intro__title.style.desktop, undefined);
  });

  await t.test('invalid values are rejected without changing the page', async () => {
    const before = JSON.stringify((await editor()).doc);
    await inspectorField('letterSpacing').locator('input').fill('red;}body{display:none');
    await inspectorField('letterSpacing').locator('input').press('Enter');
    await page.locator('.toast', { hasText: 'letterSpacing' }).waitFor();
    assert.equal(JSON.stringify((await editor()).doc), before);
  });

  await t.test('layers hide per breakpoint, rename, lock and reorder', async () => {
    const row = page.locator('.layer-row[data-id="intro__art"]');
    await page.locator('#devices button', { hasText: 'Mobile' }).click();
    await row.hover(); await row.locator('[data-eye]').click();
    assert.equal((await editor()).doc.nodes.intro__art.hidden.mobile, true);
    assert.equal(await style('#intro__art', 'display'), 'none');
    await page.locator('#devices button', { hasText: 'Desktop' }).click();
    assert.equal(await style('#intro__art', 'display'), 'block');
    await row.dblclick();
    await page.locator('.layer-rename').fill('Hero art');
    await page.locator('.layer-rename').press('Enter');
    assert.equal((await editor()).doc.nodes.intro__art.name, 'Hero art');
    await page.locator('.layer-row[data-id="intro__art"]').hover();
    await page.locator('.layer-row[data-id="intro__art"] [data-lock]').click();
    assert.equal((await editor()).doc.nodes.intro__art.locked, true);
    await page.locator('.layer-row[data-id="clip"]').click();
    await page.locator('.layer-row[data-id="clip"]').press('Alt+ArrowDown');
    assert.deepEqual((await editor()).doc.pages[0].children.slice(0, 3), ['intro', 'inquiry', 'clip']);
    await page.locator('.layer-row[data-id="intro"] [data-toggle]').click();
    await page.locator('.layer-row[data-id="intro"] [data-toggle]').click();
    await page.locator('.layer-row[data-id="intro__copy"] [data-toggle]').click();
    await page.locator('.layer-row[data-id="intro__copy"] [data-toggle]').click();
    await page.locator('.layer-row[data-id="intro__button"]').dragTo(page.locator('.layer-row[data-id="intro__title"]'), { targetPosition: { x: 40, y: 2 } });
    assert.deepEqual((await editor()).doc.nodes.intro__copy.children.slice(0, 2), ['intro__button', 'intro__title']);
    await canvas.locator('#intro__copy > :first-child.t-button').waitFor();
  });

  await t.test('elements can be added, deleted and restored', async () => {
    await page.locator('.layer-row[data-id="inquiry"]').click();
    await page.locator('.rail-button[data-tool=add]').click();
    await page.locator('[data-add=button]').click();
    const state = await editor();
    const added = state.selected;
    assert.match(added, /^button-/);
    assert.equal(state.doc.nodes.inquiry.children.at(-1), added);
    await canvas.locator('#' + added).waitFor();
    await page.locator('.rail-button[data-tool=layers]').click();
    await page.locator('.layer-row[data-id="' + added + '"]').focus();
    await page.keyboard.press('Delete');
    assert.equal((await editor()).doc.nodes[added], undefined);
    await page.keyboard.press('Control+z');
    assert.ok((await editor()).doc.nodes[added]);
    await canvas.locator('#' + added).waitFor();
  });

  await t.test('pages can be added and appear in the menu', async () => {
    await page.locator('.rail-button[data-tool=pages]').click();
    await page.locator('.add-page input').fill('Our Team');
    await page.locator('.add-page button').click();
    const state = await editor();
    assert.ok(state.doc.pages.some(item => item.id === 'our-team' && item.path === '/our-team'));
    await canvas.locator('nav a[aria-current=page]', { hasText: 'Our Team' }).waitFor();
    await page.locator('.page-item', { hasText: 'Home' }).click();
  });

  await t.test('publishing uses the v2 renderer and the classic builder stays out', async () => {
    await saved();
    await page.locator('#publishBtn').click();
    await page.locator('.modal', { hasText: 'Your changes are live' }).waitFor();
    const home = await f.request('/');
    assert.ok(home.text.includes('Designed in the new editor'));
    assert.ok(home.text.includes('/assets/public-v2.css'));
    assert.equal((await f.request('/our-team')).status, 200);
    const classic = await context.newPage();
    await classic.goto(f.base + '/builder.html');
    await classic.locator('.save-state', { hasText: 'Could not load your site' }).waitFor();
    await classic.close();
  });

  await t.test('viewers get a read-only editor', async () => {
    const created = await f.request('/api/admin/users', { method: 'POST', auth: owner, body: { name: 'View Only', email: 'viewer-v2@example.test', password: 'Viewer-password-2026', role: 'viewer' } });
    assert.equal(created.status, 201, created.text);
    const viewerContext = await browser.newContext({ viewport: { width: 1400, height: 900 } });
    const viewer = await viewerContext.newPage();
    await viewer.goto(f.base + '/login.html?next=/editor.html');
    await viewer.locator('#email').fill('viewer-v2@example.test'); await viewer.locator('#password').fill('Viewer-password-2026');
    await viewer.getByRole('button', { name: 'Sign in', exact: true }).click();
    await viewer.locator('#saveState', { hasText: 'Read-only access' }).waitFor();
    assert.ok(await viewer.locator('#publishBtn').isDisabled());
    await viewer.frameLocator('#canvasFrame').locator('h1').first().click();
    assert.ok(await viewer.locator('#inspector textarea[data-part=text]').isDisabled());
    await viewerContext.close();
  });

  assert.deepEqual(errors, []);
});
