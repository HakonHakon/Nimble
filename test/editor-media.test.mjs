import test from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { fixture, ownerCredentials, example } from './helpers.mjs';
import { normalizeSite } from '../lib/site-model.mjs';
import { migrateV1 } from '../lib/migrate-v1.mjs';

const PNG = color => Buffer.from({
  red: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==',
  blue: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPj/HwADBwIAMCbHYQAAAABJRU5ErkJggg=='
}[color], 'base64');

test('v2 editor: slideshow and gallery manager, captions, lightbox, audio, image focal point and filters', { timeout: 180000 }, async t => {
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
  const css = () => canvas.locator('#nimble-site').evaluate(style => style.textContent);
  const content = () => page.locator('#inspector [role=tab]', { hasText: 'Content' }).click();
  async function upload(button, name, buffer, mimeType) {
    const chooser = page.waitForEvent('filechooser');
    await button.click();
    await (await chooser).setFiles({ name, mimeType, buffer });
  }
  const urls = [];

  await t.test('upload images and build a slideshow with captions', async () => {
    await page.locator('.rail-button[data-tool=media]').click();
    for (const [name, color] of [['red.png', 'red'], ['blue.png', 'blue']]) {
      await upload(page.locator('#mediaPanel [data-media-upload=image]'), name, PNG(color), 'image/png');
      await page.locator('#mediaPanel .asset', { hasText: name }).waitFor();
    }
    for (const name of ['red.png', 'blue.png']) urls.push((await doc()).assets.find(asset => asset.name === name).url);
    await page.locator('.rail-button[data-tool=layers]').click();
    await page.locator('.layer-row[data-id="gallery"]').click();
    await page.locator('.rail-button[data-tool=add]').click();
    await page.locator('#addPanel [data-add=slideshow]').click();
    const id = await selected();
    assert.deepEqual((await doc()).nodes[id].props, { layout: 'slider', lightbox: true, autoplay: true, interval: 5 });
    await content();
    await page.locator('#inspector [data-ml-add]').selectOption(urls[0]);
    await page.locator('#inspector [data-ml-add]').selectOption(urls[1]);
    await page.locator('#inspector [data-ml-caption="1"]').fill('Blue sky');
    await page.locator('#inspector [data-ml-caption="1"]').press('Tab');
    let props = (await doc()).nodes[id].props;
    assert.deepEqual(props.images, urls);
    assert.deepEqual(props.captions, ['', 'Blue sky']);
    await page.locator('#inspector [data-ml="1"] [data-ml-move="-1"]').click();
    props = (await doc()).nodes[id].props;
    assert.deepEqual(props.images, [urls[1], urls[0]]);
    assert.deepEqual(props.captions, ['Blue sky']);
    assert.equal(await canvas.locator('#' + id + ' .g-track > figure').count(), 2);
    assert.equal(await canvas.locator('#' + id + ' figcaption').first().textContent(), 'Blue sky');
    await page.locator('#inspector .field[data-key=interval] input').fill('3');
    await page.locator('#inspector .field[data-key=interval] input').press('Enter');
    assert.equal((await doc()).nodes[id].props.interval, 3);
  });

  await t.test('masonry gallery takes images from the media library panel', async () => {
    await page.locator('.rail-button[data-tool=add]').click();
    await page.locator('#addPanel [data-add=gallery-masonry]').click();
    const id = await selected();
    await page.locator('.rail-button[data-tool=media]').click();
    await page.locator('#mediaPanel [data-use]').first().click();
    assert.equal((await doc()).nodes[id].props.images.length, 1);
    assert.equal(await canvas.locator('#' + id).evaluate(el => getComputedStyle(el).columnWidth), '220px');
  });

  await t.test('audio player with an uploaded MP3', async () => {
    await page.locator('.rail-button[data-tool=add]').click();
    await page.locator('#addPanel [data-add=audio]').click();
    const id = await selected();
    await content();
    await upload(page.locator('#inspector .field[data-key=src] [data-upload=audio]'), 'jingle.mp3', Buffer.concat([Buffer.from('ID3'), Buffer.alloc(64, 1)]), 'audio/mpeg');
    await page.waitForFunction(id => /\.mp3$/.test(window.nimbleEditor.doc.nodes[id].props.src || ''), id);
    const state = await doc();
    assert.equal(state.assets.find(asset => asset.name === 'jingle.mp3').kind, 'audio');
    assert.match(await canvas.locator('#' + id + ' audio').getAttribute('src'), /\.mp3$/);
  });

  await t.test('image focal point and filter', async () => {
    await page.locator('.rail-button[data-tool=layers]').click();
    await page.locator('.layer-row[data-id="image"]').click();
    await canvas.locator('#image__image').click();
    await content();
    await page.locator('#inspector .field[data-key=src] input').fill(urls[0]);
    await page.locator('#inspector .field[data-key=src] input').press('Enter');
    const box = await page.locator('#inspector [data-point-pick]').boundingBox();
    await page.mouse.click(box.x + box.width * 0.2, box.y + box.height * 0.9);
    const focal = (await doc()).nodes.image__image.props.focal;
    assert.ok(Math.abs(focal[0] - 20) <= 1 && Math.abs(focal[1] - 90) <= 1, 'focal ' + focal);
    assert.match(await css(), new RegExp('\\.n-image__image img\\{[^}]*object-position:' + focal[0] + '% ' + focal[1] + '%'));
    await page.locator('#inspector [role=tab]', { hasText: 'Design' }).click();
    await page.locator('#inspector .field[data-key=filter] select').selectOption('grayscale');
    assert.equal(await canvas.locator('#image__image').evaluate(el => getComputedStyle(el).filter), 'grayscale(1)');
  });

  await t.test('published slider and lightbox work', async () => {
    await page.locator('#saveState').filter({ hasText: 'All changes saved' }).waitFor();
    const revision = (await f.request('/api/site', { auth: owner })).data.revision;
    assert.equal((await f.request('/api/publish', { method: 'POST', auth: owner, body: { revision } })).status, 200);
    const site = await context.newPage();
    site.on('pageerror', error => errors.push(error.message));
    await site.goto(f.base + '/');
    const slider = site.locator('[data-slider]');
    assert.equal(await slider.getAttribute('data-autoplay'), '3');
    await slider.locator('.g-next').click();
    await site.waitForFunction(() => document.querySelector('[data-slider] .g-track').scrollLeft > 0);
    await slider.locator('.g-open').first().click();
    const dialog = site.locator('dialog.lightbox');
    await dialog.waitFor();
    assert.equal(await dialog.locator('img').getAttribute('src'), urls[1]);
    assert.equal(await dialog.locator('figcaption').textContent(), 'Blue sky');
    await dialog.locator('.lb-next').click();
    assert.equal(await dialog.locator('img').getAttribute('src'), urls[0]);
    await site.keyboard.press('Escape');
    assert.equal(await dialog.evaluate(el => el.open), false);
    assert.match(await site.locator('.t-audio audio').getAttribute('src'), /\.mp3$/);
    await site.close();
  });
  assert.deepEqual(errors, []);
});
