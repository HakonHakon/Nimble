import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';
import { fixture, ownerCredentials, png } from './helpers.mjs';

test('real browser: editor lifecycle, pages, drag/drop, uploads, preview, contact, roles and conflicts', { timeout: 120000 }, async t => {
  const f = await fixture(); t.after(() => f.cleanup());
  const browser = await chromium.launch(process.env.NIMBLE_BROWSER_CHANNEL ? { channel: process.env.NIMBLE_BROWSER_CHANNEL } : {});
  t.after(() => browser.close());
  const context = await browser.newContext({ viewport: { width: 1536, height: 1000 } });
  const errors = [];
  const attach = async context => {
    await context.route('**/*', route => route.request().url().startsWith(f.base) || route.request().url().startsWith('about:') ? route.continue() : route.abort());
    context.on('page', page => page.on('pageerror', error => errors.push(error.message)));
  };
  await attach(context);
  async function signIn(context, credentials = ownerCredentials) {
    const page = await context.newPage();
    await page.goto(f.base + '/login.html?next=/builder.html');
    await page.locator('#email').fill(credentials.email); await page.locator('#password').fill(credentials.password);
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await page.waitForURL('**/builder.html');
    await page.locator('.save-state').filter({ hasText: /All changes saved|Read-only access/ }).waitFor();
    return page;
  }
  const page = await signIn(context);
  const saved = async page => { await page.locator('.save-state').filter({ hasText: 'All changes saved' }).waitFor(); };
  const editField = async (selector, value) => { await page.locator(selector).fill(value); await page.locator(selector).press('Tab'); await saved(page); };
  await t.test('editing survives reload without startup overwrites', async () => {
    await editField('#inspector [data-field=title]', 'Browser saved heading');
    await page.reload(); await saved(page);
    await page.locator('#siteCanvas h1').filter({ hasText: 'Browser saved heading' }).waitFor();
    assert.equal(await page.locator('#inspector [data-field=title]').inputValue(), 'Browser saved heading');
  });
  await t.test('hostile text stays text and failed saves remain recoverable', async () => {
    const hostile = '<img src=x onerror="window.auditXss=1">';
    await editField('#inspector [data-field=title]', hostile);
    assert.equal(await page.locator('#siteCanvas h1').textContent(), hostile);
    assert.equal(await page.evaluate(() => window.auditXss), undefined);
    assert.equal(await page.locator('#siteCanvas h1 img').count(), 0);
    await context.route('**/api/site', async route => route.request().method() === 'PUT' ? route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'Fixture save unavailable' }) }) : route.fallback());
    await page.locator('#inspector [data-field=title]').fill('A recoverable draft');
    await page.locator('#inspector [data-field=title]').press('Tab');
    await page.locator('.save-state').filter({ hasText: 'Fixture save unavailable' }).waitFor();
    assert.ok(await page.evaluate(() => Object.entries(localStorage).some(([key, value]) => key.startsWith('nimble-draft-v2-') && JSON.parse(value).dirty)));
    await context.unroute('**/api/site');
    await page.keyboard.press('Control+s'); await saved(page);
    await editField('#inspector [data-field=title]', 'Browser saved heading');
  });
  await t.test('add, drag and reorder blocks through actual browser events', async () => {
    await page.setViewportSize({ width: 1536, height: 1400 });
    const count = await page.locator('[data-block-id]').count();
    await page.locator('[data-add=text]').click();
    await saved(page); assert.equal(await page.locator('[data-block-id]').count(), count + 1);
    await page.locator('[data-add=quote]').dragTo(page.locator('[data-drop-zone]').first());
    await saved(page);
    assert.ok(await page.locator('[data-block-id]').first().locator('.quote').count());
    const nextBlockId = await page.locator('[data-block-id]').nth(2).getAttribute('data-block-id');
    const quoteId = await page.locator('[data-block-id]').first().getAttribute('data-block-id');
    const quote = page.locator('[data-block-id="' + quoteId + '"] [data-drag-handle]');
    const sourceBox = await quote.boundingBox(), targetBox = await page.locator('[data-drop-zone][data-drop-before="' + nextBlockId + '"]').boundingBox();
    await page.mouse.move(sourceBox.x + sourceBox.width / 2, sourceBox.y + sourceBox.height / 2);
    await page.mouse.down(); await page.mouse.move(targetBox.x + targetBox.width / 2, targetBox.y + targetBox.height / 2, { steps: 12 }); await page.mouse.up(); await saved(page);
    assert.ok(await page.locator('[data-block-id]').nth(1).locator('.quote').count());
    assert.equal(await page.locator('[data-action=move-up],[data-action=move-down]').count(), 0);
    await page.setViewportSize({ width: 1536, height: 1000 });
  });
  await t.test('saved templates can be created, applied, edited and deleted', async () => {
    await page.locator('[data-block-id]').filter({ has: page.locator('.hero') }).click();
    const originalTitle = await page.locator('#inspector [data-field=title]').inputValue();
    await page.locator('#templateBtn').click();
    await page.getByRole('button', { name: 'Save current as template', exact: true }).click();
    await page.locator('#templateName').fill('Browser saved template');
    await page.locator('#templateDescription').fill('A reusable browser test layout.');
    await page.getByRole('button', { name: 'Save template', exact: true }).click();
    const card = page.locator('.template-card-manager').filter({ hasText: 'Browser saved template' });
    await card.waitFor();
    await card.getByRole('button', { name: 'Edit', exact: true }).click();
    await page.locator('#templateDescription').fill('Updated reusable layout.');
    await page.getByRole('button', { name: 'Save template', exact: true }).click();
    await page.locator('.template-card-manager').filter({ hasText: 'Updated reusable layout.' }).waitFor();
    await page.getByRole('button', { name: 'Close', exact: true }).click();
    await page.locator('[data-block-id]').filter({ has: page.locator('.hero') }).click();
    await editField('#inspector [data-field=title]', 'Changed after saving template');
    await page.locator('#templateBtn').click();
    await page.locator('.template-card-manager').filter({ hasText: 'Browser saved template' }).getByRole('button', { name: 'Apply', exact: true }).click();
    await saved(page);
    assert.equal(await page.locator('#inspector [data-field=title]').inputValue(), originalTitle);
    page.once('dialog', dialog => dialog.accept());
    await page.locator('#templateBtn').click();
    await page.locator('.template-card-manager').filter({ hasText: 'Browser saved template' }).getByRole('button', { name: 'Delete', exact: true }).click();
    await page.locator('.template-empty').waitFor();
    await page.getByRole('button', { name: 'Close', exact: true }).click();
  });
  await t.test('images upload, videos and columns have usable controls', async () => {
    await context.route('**/api/media', route => route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'Fixture upload unavailable' }) }));
    await page.locator('#fileInput').setInputFiles({ name: 'failed.png', mimeType: 'image/png', buffer: png });
    await page.locator('.save-state').filter({ hasText: 'Upload failed' }).waitFor();
    await context.unroute('**/api/media');
    await page.locator('#fileInput').setInputFiles({ name: 'pixel.png', mimeType: 'image/png', buffer: png });
    await page.getByRole('button', { name: 'pixel.png', exact: true }).waitFor();
    await page.locator('[data-asset]').first().click(); await saved(page);
    await editField('#inspector [data-field=alt]', 'Uploaded image description');
    await page.locator('[data-tool=build]').click(); await page.locator('[data-add=video]').click();
    await editField('#inspector [data-field=videoUrl]', 'https://example.test/film.mp4');
    assert.equal(await page.locator('#siteCanvas video').count(), 1);
    await page.locator('[data-add=columns]').click();
    await editField('#inspector [data-card="0"][data-part="0"]', 'Browser card heading');
    await page.locator('#siteCanvas h3').filter({ hasText: 'Browser card heading' }).waitFor();
  });
  await t.test('site settings and fonts persist and appear in the renderer', async () => {
    await page.locator('[data-tool=settings]').click();
    await editField('[data-site-setting=name]', 'Nimble browser test');
    await editField('[data-site-setting=description]', 'A description saved in the browser.');
    await page.locator('[data-site-setting=searchVisible]').uncheck(); await saved(page);
    await page.locator('[data-tool=styles]').click();
    await page.locator('[data-site-setting=headingFont]').selectOption('serif'); await saved(page);
    assert.ok((await page.locator('#siteCanvas h1').evaluate(element => getComputedStyle(element).fontFamily)).includes('Georgia'));
    await page.reload(); await saved(page);
    assert.equal(await page.locator('.site-logo').textContent(), 'Nimble browser test');
  });
  await t.test('pages are independent, page links work and preview renders the saved layout', async () => {
    await page.locator('[data-tool=pages]').click(); await page.locator('[data-action=add-page]').click();
    await page.locator('#newPageName').fill('About');
    await page.getByRole('button', { name: 'Create page', exact: true }).click(); await saved(page);
    await editField('#inspector [data-field=title]', 'About page only');
    await page.locator('#leftPanel [data-page=home]').click();
    await page.locator('#siteCanvas h1').filter({ hasText: 'Browser saved heading' }).waitFor();
    await page.locator('#previewBtn').click();
    await page.frameLocator('.website-preview').getByRole('heading', { name: 'Browser saved heading' }).waitFor();
    await page.frameLocator('.website-preview').getByRole('link', { name: 'About', exact: true }).click();
    await page.frameLocator('.website-preview').getByRole('heading', { name: 'About page only' }).waitFor();
    await page.getByRole('button', { name: 'Done', exact: true }).click();
    await page.locator('#publishBtn').click();
    await page.getByRole('dialog').filter({ hasText: 'Your changes are live.' }).waitFor();
    await page.getByRole('button', { name: 'Back to editing', exact: true }).click();
  });
  await t.test('public contact form submits into the team inbox in the browser', async () => {
    const publicPage = await context.newPage(); await publicPage.goto(f.base + '/');
    await publicPage.locator('input[name=name]').fill('Browser visitor');
    await publicPage.locator('input[name=email]').fill('browser-visitor@example.test');
    await publicPage.locator('textarea[name=message]').fill('A browser contact enquiry.');
    await publicPage.getByRole('button', { name: 'Send message' }).click();
    await publicPage.getByRole('status').filter({ hasText: 'Your message has reached our team.' }).waitFor();
    await page.goto(f.base + '/control-panel.html#inbox');
    await page.locator('.message-body').filter({ hasText: 'A browser contact enquiry.' }).waitFor();
    await publicPage.close();
  });
  await t.test('viewer and editor controls match their real permissions', async () => {
    const owner = await f.login();
    for (const role of ['viewer', 'editor']) assert.equal((await f.request('/api/admin/users', { method: 'POST', auth: owner, body: { name: role, email: role + '@example.test', password: 'Browser-' + role + '-password-2026', role } })).status, 201);
    for (const role of ['viewer', 'editor']) {
      const context = await browser.newContext(); await attach(context);
      const rolePage = await signIn(context, { email: role + '@example.test', password: 'Browser-' + role + '-password-2026' });
      assert.equal(await rolePage.locator('#publishBtn').isDisabled(), role === 'viewer');
      if (role === 'viewer') {
        const count = await rolePage.locator('[data-block-id]').count();
        await rolePage.locator('[data-add=text]').click();
        assert.equal(await rolePage.locator('[data-block-id]').count(), count);
      }
      await rolePage.goto(f.base + '/control-panel.html'); await rolePage.locator('#accountName').filter({ hasText: role }).waitFor();
      assert.equal(await rolePage.locator('#teamSection').isVisible(), false);
      assert.equal(await rolePage.locator('#inboxSection').isVisible(), role === 'editor');
      await context.close();
    }
  });
  await t.test('mobile layout keeps the block tools and inspector accessible', async () => {
    await page.goto(f.base + '/builder.html'); await saved(page);
    await page.setViewportSize({ width: 390, height: 844 });
    assert.equal(await page.locator('#leftPanel').isVisible(), true);
    await page.locator('[data-block-id]').first().click();
    assert.equal(await page.locator('#inspector').isVisible(), true);
    const width = await page.evaluate(() => ({ client: document.documentElement.clientWidth, scroll: document.documentElement.scrollWidth }));
    assert.ok(width.scroll <= width.client + 2, JSON.stringify(width));
    if (process.env.NIMBLE_SCREENSHOT_DIR) {
      await fs.mkdir(process.env.NIMBLE_SCREENSHOT_DIR, { recursive: true });
      await page.screenshot({ path: path.join(process.env.NIMBLE_SCREENSHOT_DIR, 'editor-mobile.png'), fullPage: true });
      await page.setViewportSize({ width: 1536, height: 1000 });
      await page.screenshot({ path: path.join(process.env.NIMBLE_SCREENSHOT_DIR, 'editor-desktop.png'), fullPage: true });
    } else await page.setViewportSize({ width: 1536, height: 1000 });
  });
  await t.test('two editor sessions cannot silently overwrite newer work', async () => {
    const secondContext = await browser.newContext(); await attach(secondContext);
    const stalePage = await signIn(secondContext);
    await editField('#inspector [data-field=title]', 'The newest saved heading');
    await stalePage.locator('#inspector [data-field=title]').fill('A stale edit');
    await stalePage.locator('#inspector [data-field=title]').press('Tab');
    await stalePage.locator('.save-state').filter({ hasText: 'Someone else saved a newer version' }).waitFor();
    const owner = await f.login();
    const result = await f.request('/api/site', { auth: owner });
    assert.equal(result.data.site.blocks.hero.title, 'The newest saved heading');
    await secondContext.close();
  });
  assert.deepEqual(errors, [], 'Browser JavaScript errors: ' + JSON.stringify(errors));
});
