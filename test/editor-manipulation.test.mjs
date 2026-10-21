import test from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { fixture, ownerCredentials, example } from './helpers.mjs';
import { normalizeSite } from '../lib/site-model.mjs';
import { migrateV1 } from '../lib/migrate-v1.mjs';

test('v2 editor: move, snap, reorder, reparent, resize, rotate, nudge and guides', { timeout: 180000 }, async t => {
  const f = await fixture(); t.after(() => f.cleanup());
  const owner = await f.login();
  assert.equal((await f.save(owner, migrateV1(normalizeSite(example)))).status, 200);
  const browser = await chromium.launch(process.env.NIMBLE_BROWSER_CHANNEL ? { channel: process.env.NIMBLE_BROWSER_CHANNEL } : {});
  t.after(() => browser.close());
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await context.route('**/*', route => route.request().url().startsWith(f.base) || route.request().url().startsWith('about:') ? route.continue() : route.abort());
  await context.addInitScript(() => { if (window === window.top) try { localStorage.setItem('nimble-editor-prefs', JSON.stringify({ snap: true, rulers: true, grid: false })); } catch {} });
  const errors = [];
  const page = await context.newPage();
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(f.base + '/login.html?next=/editor.html');
  await page.locator('#email').fill(ownerCredentials.email); await page.locator('#password').fill(ownerCredentials.password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await page.waitForURL('**/editor.html');
  const canvas = page.frameLocator('#canvasFrame');
  await canvas.locator('#intro__art').waitFor();
  const doc = () => page.evaluate(() => window.nimbleEditor.doc);
  // Screen position of a point inside an element (fractions of its layout box).
  const at = (id, fx = 0.5, fy = 0.5) => page.locator('#canvasFrame').evaluate((frame, [target, x, y]) => {
    const el = frame.contentDocument.getElementById(target), r = el.getBoundingClientRect(), o = frame.getBoundingClientRect(), s = o.width / frame.contentWindow.innerWidth;
    return { x: o.left + (r.left + r.width * x) * s, y: o.top + (r.top + r.height * y) * s, scale: s };
  }, [id, fx, fy]);
  const frameBox = id => page.locator('#canvasFrame').evaluate((frame, target) => {
    const el = frame.contentDocument.getElementById(target), r = el.getBoundingClientRect();
    return { cx: r.left + r.width / 2, cy: r.top + r.height / 2, width: el.offsetWidth, height: el.offsetHeight };
  }, id);
  async function drag(from, to, { steps = 12, before = null, keys = [] } = {}) {
    await page.mouse.move(from.x, from.y);
    for (const key of keys) await page.keyboard.down(key);
    await page.mouse.down();
    for (let i = 1; i <= steps; i++) await page.mouse.move(from.x + (to.x - from.x) * i / steps, from.y + (to.y - from.y) * i / steps);
    if (before) await before();
    await page.mouse.up();
    for (const key of keys) await page.keyboard.up(key);
  }

  await t.test('freeform move inside a grid cell shows snap guides and docks the element', async () => {
    const hero = await page.locator('#canvasFrame').evaluate(frame => {
      const el = frame.contentDocument.getElementById('intro'), cs = getComputedStyle(el), r = el.getBoundingClientRect();
      return { cx: r.left + parseFloat(cs.paddingLeft) + (r.width - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight)) / 2 };
    });
    const start = await at('intro__art'), art = await frameBox('intro__art');
    const target = { x: start.x + (hero.cx - art.cx + 3) * start.scale, y: start.y + 40 * start.scale };
    let sawGuide = false;
    let lines = [];
    await drag(start, target, { before: async () => { lines = await page.locator('.ov-line').evaluateAll(items => items.map(item => ({ left: parseFloat(item.style.left), width: parseFloat(item.style.width) }))); sawGuide = lines.length > 0; } });
    assert.ok(sawGuide, 'a snap guide is shown while dragging');
    const after = await frameBox('intro__art');
    const edges = [after.cx - after.width / 2, after.cx, after.cx + after.width / 2];
    assert.ok(lines.some(line => line.width < 2 && edges.some(edge => Math.abs(edge - line.left) < 1)), 'the element ends exactly on a vertical guide');
    assert.ok(Math.abs(after.cx - hero.cx) < 12, 'the element moved to the centre area');
    const place = (await doc()).nodes.intro__art.place.desktop;
    assert.equal(place.justifySelf, 'start'); assert.equal(place.alignSelf, 'start');
    assert.match(place.margin[0], /^\d+px$/);
    assert.deepEqual((await doc()).nodes.intro__art.place.mobile.cell, [2, 1, 1, 1], 'other breakpoints keep their placement');
  });

  await t.test('Escape cancels a drag and undo restores a move', async () => {
    const before = JSON.stringify((await doc()).nodes.intro__art);
    const start = await at('intro__art');
    await page.mouse.move(start.x, start.y); await page.mouse.down();
    for (let i = 1; i < 6; i++) await page.mouse.move(start.x - i * 10, start.y + i * 5);
    await page.keyboard.press('Escape');
    await page.mouse.up();
    assert.equal(JSON.stringify((await doc()).nodes.intro__art), before);
    assert.equal(await canvas.locator('#intro__art').evaluate(el => el.style.translate), '');
    await drag(start, { x: start.x - 60, y: start.y });
    assert.notEqual(JSON.stringify((await doc()).nodes.intro__art), before);
    await page.keyboard.press('Control+z');
    assert.equal(JSON.stringify((await doc()).nodes.intro__art), before);
  });

  await t.test('resize keeps the ratio with Shift and rotate snaps to 15° steps', async () => {
    await canvas.locator('#intro__art').click();
    const handle = await page.locator('.ov-handle.ov-se').boundingBox();
    await drag({ x: handle.x + 4, y: handle.y + 4 }, { x: handle.x + 64, y: handle.y + 20 }, { keys: ['Shift'] });
    const place = (await doc()).nodes.intro__art.place.desktop;
    assert.equal(place.width, place.height, 'square stays square: ' + place.width + ' × ' + place.height);
    assert.notEqual(place.width, '220px');
    const rotateHandle = await page.locator('.ov-rotate').boundingBox();
    const center = await at('intro__art');
    await drag({ x: rotateHandle.x + 4, y: rotateHandle.y + 4 }, { x: center.x + 120, y: center.y - 70 }, { keys: ['Shift'] });
    const rotation = (await doc()).nodes.intro__art.place.desktop.rotate;
    assert.equal(rotation % 15, 0); assert.notEqual(rotation, 0);
    assert.equal(await page.locator('.ov-select').evaluate(el => el.style.transform), 'rotate(' + rotation + 'deg)');
  });

  await t.test('arrow keys nudge and merge into one undo step', async () => {
    const before = (await doc()).nodes.intro__art.place.desktop.margin;
    await page.keyboard.press('ArrowRight'); await page.keyboard.press('Shift+ArrowRight'); await page.keyboard.press('ArrowDown');
    const after = (await doc()).nodes.intro__art.place.desktop.margin;
    assert.equal(parseFloat(after[3]) - parseFloat(before[3]), 11);
    assert.equal(parseFloat(after[0]) - parseFloat(before[0]), 1);
    await page.keyboard.press('Control+z');
    assert.deepEqual((await doc()).nodes.intro__art.place.desktop.margin, before);
  });

  await t.test('dragging inside a stack reorders, per breakpoint below desktop', async () => {
    const button = await at('intro__button'), title = await at('intro__title', 0.3, 0.1);
    await drag(button, title);
    assert.deepEqual((await doc()).nodes.intro__copy.children.slice(0, 2), ['intro__button', 'intro__title']);
    await page.locator('#devices button', { hasText: 'Mobile' }).click();
    const paragraph = await at('intro__text', 0.5, 0.9), first = await at('intro__button');
    await drag(first, { x: paragraph.x, y: paragraph.y + 5 });
    const state = await doc();
    assert.deepEqual(state.nodes.intro__copy.children.slice(0, 2), ['intro__button', 'intro__title'], 'desktop order is unchanged');
    assert.ok(state.nodes.intro__button.place.mobile.order > state.nodes.intro__text.place.mobile.order, 'mobile order puts the button after the paragraph');
    await page.locator('#devices button', { hasText: 'Desktop' }).click();
  });

  await t.test('dragging into another container reparents the element', async () => {
    await page.locator('#canvasFrame').evaluate(frame => frame.contentDocument.getElementById('inquiry').scrollIntoView({ block: 'center' }));
    const formNow = await at('inquiry', 0.5, 0.15);
    await page.locator('#canvasFrame').evaluate(frame => frame.contentWindow.scrollTo(0, 0));
    const start = await at('intro__button');
    await page.mouse.move(start.x, start.y); await page.mouse.down();
    for (let i = 1; i <= 10; i++) await page.mouse.move(start.x + 5 * i, start.y + 5 * i);
    // Scroll the canvas so the form section is under the pointer, then finish the drag there.
    await page.locator('#canvasFrame').evaluate(frame => frame.contentDocument.getElementById('inquiry').scrollIntoView({ block: 'center' }));
    for (let i = 1; i <= 6; i++) await page.mouse.move(formNow.x, formNow.y + i);
    assert.ok(await page.locator('.ov-target').count() > 0, 'the receiving container is highlighted');
    await page.mouse.up();
    const state = await doc();
    assert.ok(state.nodes.inquiry.children.includes('intro__button'));
    assert.ok(!state.nodes.intro__copy.children.includes('intro__button'));
    assert.equal(state.nodes.intro__button.place?.mobile?.order, undefined, 'positions from the old container are dropped');
    await canvas.locator('#inquiry > #intro__button').waitFor();
  });

  await t.test('sections reorder by dragging their name tag', async () => {
    await page.locator('#canvasFrame').evaluate(frame => frame.contentWindow.scrollTo(0, 0));
    await page.locator('.layer-row[data-id="clip"]').click();
    const tag = await page.locator('.ov-select .ov-tag-drag').boundingBox(), intro = await at('intro', 0.5, 0.1);
    await drag({ x: tag.x + 8, y: tag.y + tag.height / 2 }, intro);
    assert.deepEqual((await doc()).pages[0].children.slice(0, 2), ['clip', 'intro']);
  });

  await t.test('locked elements cannot be moved', async () => {
    await page.locator('.layer-row[data-id="intro"] [data-toggle]').click().catch(() => {});
    await canvas.locator('#intro__art').click();
    await page.locator('#inspector [role=tab]', { hasText: 'Settings' }).click();
    await page.locator('#inspector [data-setting=locked] input').check();
    const before = JSON.stringify((await doc()).nodes.intro__art.place);
    const start = await at('intro__art');
    await drag(start, { x: start.x - 80, y: start.y + 30 });
    assert.equal(JSON.stringify((await doc()).nodes.intro__art.place), before);
    assert.equal(await page.locator('.ov-select [data-handle]').count(), 0);
  });

  await t.test('ruler guides are created, kept per page and breakpoint, and removed on the ruler', async () => {
    const ruler = await page.locator('.ruler-left').boundingBox();
    const shape = await at('intro__title', 0, 0.5);
    await drag({ x: ruler.x + 10, y: shape.y }, { x: shape.x - 30, y: shape.y });
    const guides = await page.locator('.ov-guide-x').count();
    assert.equal(guides, 1);
    const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('nimble-guides-home-desktop')));
    assert.equal(stored.x.length, 1);
    await page.locator('#gridToggle').click();
    await page.locator('.layer-row[data-id="intro"]').click();
    assert.ok(await page.locator('.ov-track').count() > 0, 'grid lines are drawn for the selected layout');
    await page.locator('#gridToggle').click();
    await page.locator('.ov-guide-x').waitFor();
    const guide = await page.locator('.ov-guide-x').boundingBox();
    await drag({ x: guide.x + guide.width / 2, y: guide.y + 100 }, { x: ruler.x + 8, y: guide.y + 100 });
    await page.locator('.ov-guide-x').waitFor({ state: 'detached' });
  });

  await t.test('everything above is saved', async () => {
    await page.locator('#saveState').filter({ hasText: 'All changes saved' }).waitFor();
    const stored = (await f.request('/api/site', { auth: owner })).data.site;
    assert.deepEqual(stored.pages[0].children.slice(0, 2), ['clip', 'intro']);
    assert.ok(stored.nodes.inquiry.children.includes('intro__button'));
    assert.equal(stored.nodes.intro__art.locked, true);
  });
  assert.deepEqual(errors, []);
});
