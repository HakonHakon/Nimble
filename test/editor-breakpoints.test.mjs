import test from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { fixture, ownerCredentials, example } from './helpers.mjs';
import { normalizeSite } from '../lib/site-model.mjs';
import { migrateV1 } from '../lib/migrate-v1.mjs';

test('v2 editor: breakpoint manager, width dragging, override markers and reading order', { timeout: 180000 }, async t => {
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
  const bp = () => page.evaluate(() => window.nimbleEditor.bp);
  const innerWidth = () => page.locator('#canvasFrame').evaluate(frame => frame.contentWindow.innerWidth);
  const fontSize = selector => canvas.locator(selector).first().evaluate(el => getComputedStyle(el).fontSize);

  await t.test('add a breakpoint, design on it, rename and resize it', async () => {
    await page.locator('#bpManage').click();
    await page.locator('.bp-add input[name=name]').fill('Small laptop');
    await page.locator('.bp-add input[name=max]').fill('1200');
    await page.locator('.bp-add button').click();
    let state = await doc();
    const added = state.breakpoints.find(item => item.name === 'Small laptop');
    assert.deepEqual(state.breakpoints.map(item => item.max), [1200, 1000, 750], 'kept widest first');
    assert.equal(await bp(), added.id, 'the editor switches to the new breakpoint');
    await page.keyboard.press('Escape');
    assert.equal(await innerWidth(), 1001, 'previewed at the narrow end of its range');
    await page.locator('#devices button', { hasText: 'Small laptop' }).waitFor();
    await canvas.locator('h1').first().click();
    await page.getByRole('tab', { name: 'Design' }).click();
    await page.locator('#inspector .field[data-key=fontSize] input').fill('44');
    await page.locator('#inspector .field[data-key=fontSize] input').press('Enter');
    assert.equal(await fontSize('h1'), '44px');
    state = await doc();
    assert.equal(state.nodes.intro__title.style[added.id].fontSize, '44px');
    await page.locator('#bpManage').click();
    await page.locator('[data-bp-row="' + added.id + '"] [data-bp-name]').fill('Laptop');
    await page.locator('[data-bp-row="' + added.id + '"] [data-bp-name]').press('Tab');
    await page.locator('[data-bp-row="' + added.id + '"] [data-bp-max]').fill('1100');
    await page.locator('[data-bp-row="' + added.id + '"] [data-bp-max]').press('Tab');
    state = await doc();
    assert.deepEqual(state.breakpoints.find(item => item.id === added.id), { id: added.id, name: 'Laptop', max: 1100 });
    await page.keyboard.press('Escape');
    await page.locator('#saveState').filter({ hasText: 'All changes saved' }).waitFor();
    const revision = (await f.request('/api/site', { auth: owner })).data.revision;
    const published = await f.request('/api/publish', { method: 'POST', auth: owner, body: { revision } });
    assert.equal(published.status, 200, published.text);
    assert.match((await f.request('/')).text, /@media \(max-width:1100px\)\{[^@]*\.n-intro__title\.t-text,\.n-intro__title\.t-text>\*\{font-size:44px\}/);
  });

  await t.test('overrides are marked and can be reset; inherited values show as placeholders', async () => {
    const laptop = (await doc()).breakpoints.find(item => item.name === 'Laptop').id;
    assert.equal(await bp(), laptop);
    await page.locator('#inspector .override-summary', { hasText: '1 change on Laptop' }).waitFor();
    await page.locator('.rail-button[data-tool=layers]').click();
    assert.equal(await page.locator('.layer-row[data-id="intro__title"] .layer-badge').count(), 1);
    await page.locator('#inspector [data-reset-bp]').click();
    assert.equal((await doc()).nodes.intro__title.style?.[laptop], undefined);
    assert.equal(await page.locator('.layer-row[data-id="intro__title"] .layer-badge').count(), 0);
    assert.equal(await fontSize('h1'), '76px', 'desktop text style applies again');
    await page.keyboard.press('Control+z');
    assert.equal(await fontSize('h1'), '44px');
  });

  await t.test('removing a breakpoint removes its changes, and undo restores both', async () => {
    const laptop = (await doc()).breakpoints.find(item => item.name === 'Laptop').id;
    await page.locator('#bpManage').click();
    await page.locator('[data-bp-row="' + laptop + '"] [data-bp-remove]').click();
    let state = await doc();
    assert.equal(state.breakpoints.length, 2);
    assert.equal(state.nodes.intro__title.style?.[laptop], undefined);
    assert.equal(await bp(), 'desktop');
    await page.keyboard.press('Escape');
    await page.keyboard.press('Control+z');
    state = await doc();
    assert.equal(state.breakpoints.length, 3);
    assert.equal(state.nodes.intro__title.style[laptop].fontSize, '44px');
  });

  await t.test('dragging the width handle previews any width and follows the breakpoint', async () => {
    await page.locator('#devices button', { hasText: 'Desktop' }).click();
    const handle = await page.locator('#widthHandle').boundingBox();
    const startX = handle.x + handle.width / 2, y = handle.y + 60;
    await page.mouse.move(startX, y); await page.mouse.down();
    let width = await innerWidth(), steps = 0;
    while (width > 900 && steps++ < 60) { await page.mouse.move(startX - steps * 8, y); width = await innerWidth(); }
    assert.equal(await bp(), 'tablet', 'tablet is active at ' + width + 'px');
    assert.equal(await page.locator('#devices button[aria-pressed=true]').textContent(), 'Tablet');
    await page.mouse.up();
    assert.ok(Math.abs((await innerWidth()) - width) <= 2, 'the dragged width is kept');
    assert.match(await page.locator('#widthLabel').textContent(), new RegExp('^' + (await innerWidth()) + 'px'));
    await page.locator('#devices button', { hasText: 'Mobile' }).click();
    assert.equal(await innerWidth(), 390, 'choosing a breakpoint resets the preview width');
  });

  await t.test('sort layers by position follows the desktop layout', async () => {
    await page.locator('#devices button', { hasText: 'Desktop' }).click();
    await page.locator('.layer-row[data-id="intro"]').click();
    await page.locator('#inspector [role=tab]', { hasText: 'Layout' }).click();
    assert.deepEqual((await doc()).nodes.intro.children, ['intro__copy', 'intro__art']);
    await canvas.locator('#intro__art').click();
    await page.keyboard.press('Control+Shift+BracketLeft');
    assert.deepEqual((await doc()).nodes.intro.children, ['intro__art', 'intro__copy']);
    await page.locator('.layer-row[data-id="intro"]').click();
    await page.locator('#inspector [data-arrange=sortByPosition]').click();
    assert.deepEqual((await doc()).nodes.intro.children, ['intro__copy', 'intro__art'], 'the left column comes first');
  });
  assert.deepEqual(errors, []);
});
