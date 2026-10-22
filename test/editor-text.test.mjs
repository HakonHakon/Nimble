import test from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { fixture, ownerCredentials, example } from './helpers.mjs';
import { normalizeSite } from '../lib/site-model.mjs';
import { migrateV1 } from '../lib/migrate-v1.mjs';

test('v2 editor: inline rich text editing with the formatting toolbar, links, paste and undo', { timeout: 180000 }, async t => {
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
  const title = canvas.locator('#intro__title');
  const textDoc = async (id = 'intro__title') => (await page.evaluate(id => window.nimbleEditor.doc.nodes[id].props.doc, id));
  const toolbar = page.locator('.rt-toolbar');
  // Selects characters [from, to) of the edited element's text (text nodes only, in document order).
  const selectText = (from, to) => title.evaluate((el, [from, to]) => {
    const walker = el.ownerDocument.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    let node, at = 0, start, end;
    while ((node = walker.nextNode())) {
      if (!start && at + node.data.length >= from && from - at < node.data.length + (from === to ? 1 : 0)) start = [node, from - at];
      if (!end && at + node.data.length >= to) end = [node, to - at];
      at += node.data.length;
    }
    el.ownerDocument.getSelection().setBaseAndExtent(start[0], start[1], end[0], end[1]);
  }, [from, to]).then(() => page.waitForTimeout(60));
  const runs = async (block = 0) => (await textDoc())[block].c;

  await t.test('double-click edits the text in place; typing is saved', async () => {
    await title.locator('h1').dblclick();
    assert.equal(await title.getAttribute('contenteditable'), 'true');
    await toolbar.waitFor();
    assert.deepEqual(await page.locator('#canvasOverlay .ov-select .ov-handle').count(), 0, 'no resize handles while typing');
    await page.keyboard.press('Control+a');
    await page.keyboard.type('Hello brave world');
    await page.waitForTimeout(600);
    assert.deepEqual(await textDoc(), [{ t: 'h1', c: [{ text: 'Hello brave world' }] }]);
    assert.equal(await title.getAttribute('contenteditable'), 'true', 'saving keeps the editor open');
  });

  await t.test('marks, colour, size and font from the toolbar and shortcuts', async () => {
    await selectText(6, 11);
    await toolbar.locator('[data-rt=b]').click();
    assert.deepEqual(await runs(), [{ text: 'Hello ' }, { text: 'brave', b: true }, { text: ' world' }]);
    assert.equal(await toolbar.locator('[data-rt=b]').getAttribute('aria-pressed'), 'true');
    await page.keyboard.press('Control+i');
    assert.deepEqual((await runs())[1], { text: 'brave', b: true, i: true });
    await toolbar.locator('[data-rt=color]').locator('xpath=..').locator('[data-picker]').click();
    await page.locator('.color-popover [data-pick="@accent"]').click();
    assert.equal((await runs())[1].color, '@accent');
    await toolbar.locator('[data-rt=size]').fill('40');
    await toolbar.locator('[data-rt=size]').press('Enter');
    await toolbar.locator('[data-rt=weight]').selectOption('300');
    assert.deepEqual((await runs())[1], { text: 'brave', b: true, i: true, color: '@accent', size: '40px', weight: 300 });
    assert.equal(await title.locator('span[data-r]').evaluate(el => getComputedStyle(el).fontSize), '40px');
    assert.equal(await title.evaluate(el => el.ownerDocument.getSelection().toString()), 'brave', 'the selection survives formatting');
  });

  await t.test('paragraph style, HTML tag, alignment, spacing and lists', async () => {
    await toolbar.locator('[data-rt=style]').selectOption('p2');
    let block = (await textDoc())[0];
    assert.equal(block.t, 'p'); assert.equal(block.style, 'p2');
    await toolbar.locator('[data-rt=tag]').selectOption('h3');
    block = (await textDoc())[0];
    assert.equal(block.t, 'h3'); assert.equal(block.style, 'p2', 'the tag changes, the look stays');
    await toolbar.locator('[data-rt-align=center]').click();
    await toolbar.locator('[data-rt=lineHeight]').fill('1.8');
    await toolbar.locator('[data-rt=lineHeight]').press('Enter');
    block = (await textDoc())[0];
    assert.equal(block.align, 'center'); assert.equal(block.lineHeight, 1.8);
    assert.equal(await title.locator('h3').evaluate(el => getComputedStyle(el).textAlign), 'center');
    // A new paragraph, turned into a bulleted list.
    await selectText(17, 17);
    await page.keyboard.press('Enter');
    await page.keyboard.type('Second line');
    await page.waitForTimeout(600);
    let doc = await textDoc();
    assert.equal(doc.length, 2);
    assert.deepEqual(doc[1].c.map(run => run.text).join(''), 'Second line');
    await toolbar.locator('[data-rt=style]').selectOption('ul');
    doc = await textDoc();
    assert.equal(doc[1].t, 'ul');
    assert.equal(doc[1].items[0].map(run => run.text).join(''), 'Second line');
    assert.equal(await title.locator('ul > li').count(), 1);
  });

  await t.test('links: add, edit and remove', async () => {
    await selectText(0, 5);
    await toolbar.locator('[data-rt=link]').click();
    await toolbar.locator('.rt-link select[name=to]').selectOption('url');
    await toolbar.locator('.rt-link input[name=href]').fill('https://example.com/about');
    await toolbar.locator('.rt-link input[name=newTab]').check();
    await toolbar.locator('.rt-link button', { hasText: 'Apply' }).click();
    assert.deepEqual((await runs())[0], { text: 'Hello', link: { to: 'url', href: 'https://example.com/about', newTab: true } });
    await selectText(2, 2);
    await page.keyboard.press('Control+k');
    assert.equal(await toolbar.locator('.rt-link input[name=href]').inputValue(), 'https://example.com/about', 'the caret inside a link edits that link');
    await toolbar.locator('.rt-link select[name=to]').selectOption('page');
    await toolbar.locator('.rt-link select[name=page]').selectOption('about');
    await toolbar.locator('.rt-link button', { hasText: 'Apply' }).click();
    assert.deepEqual((await runs())[0], { text: 'Hello', link: { to: 'page', page: 'about', newTab: true } });
    await selectText(1, 1);
    await toolbar.locator('[data-rt=link]').click();
    await toolbar.locator('[data-link-remove]').click();
    assert.deepEqual((await runs())[0], { text: 'Hello ' });
  });

  await t.test('paste keeps safe formatting only; undo works while typing', async () => {
    await selectText(0, 0);
    await title.evaluate(el => {
      const data = new DataTransfer();
      data.setData('text/html', '<meta charset="utf-8"><p style="color:red" onclick="alert(1)">Pasted <b>bold</b> <a href="javascript:alert(1)">bad</a> <a href="https://ok.example">ok</a><script>window.pwned=1</script></p><h2>Head</h2>');
      data.setData('text/plain', 'Pasted bold bad ok\nHead');
      el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
    });
    let doc = await textDoc();
    assert.deepEqual(doc[0].c.slice(0, 5), [{ text: 'Pasted ' }, { text: 'bold', b: true }, { text: ' bad ' }, { text: 'ok', link: { to: 'url', href: 'https://ok.example' } }]);
    assert.equal(doc[0].t, 'h3', 'the first pasted line joins the current paragraph');
    assert.equal(doc[1].t, 'h2', 'the last pasted line keeps its heading and takes the rest of the paragraph');
    assert.equal(doc[1].c.map(run => run.text).join(''), 'HeadHello brave world');
    assert.equal(await title.evaluate(el => !!el.ownerDocument.defaultView.pwned || !!el.querySelector('script,[onclick]')), false);
    await page.keyboard.press('Control+z');
    doc = await textDoc();
    assert.equal(doc[0].c.map(run => run.text).join(''), 'Hello brave world', 'undo removes the paste');
    assert.equal(await title.getAttribute('contenteditable'), 'true');
    assert.match(await title.textContent(), /^Hello brave world/);
  });

  await t.test('Escape ends editing; Enter starts it again; clicking elsewhere ends it', async () => {
    await page.keyboard.press('Escape');
    assert.equal(await title.getAttribute('contenteditable'), null);
    assert.equal(await toolbar.count(), 0);
    assert.equal(await page.evaluate(() => window.nimbleEditor.selected), 'intro__title');
    assert.ok((await page.locator('#canvasOverlay .ov-select .ov-handle').count()) > 0, 'handles are back');
    assert.equal(await title.locator('[data-r],[data-b],[data-link]').count(), 0, 'the published markup is restored');
    await page.keyboard.press('Enter');
    assert.equal(await title.getAttribute('contenteditable'), 'true');
    await canvas.locator('#intro__text').click();
    assert.equal(await title.getAttribute('contenteditable'), null);
    assert.equal(await page.evaluate(() => window.nimbleEditor.selected), 'intro__text');
    await page.locator('#inspector [role=tab]', { hasText: 'Content' }).click();
    await page.locator('#inspector [data-edit-text]').click();
    assert.equal(await canvas.locator('#intro__text').getAttribute('contenteditable'), 'true');
    await page.keyboard.press('Escape');
  });

  await t.test('the formatted text publishes', async () => {
    await page.locator('#saveState').filter({ hasText: 'All changes saved' }).waitFor();
    const revision = (await f.request('/api/site', { auth: owner })).data.revision;
    assert.equal((await f.request('/api/publish', { method: 'POST', auth: owner, body: { revision } })).status, 200);
    const html = (await f.request('/')).text;
    assert.match(html, /<h3 class="ts-p2 ta-center" style="line-height:1.8">Hello <span style="color:var\(--c-accent\);font-size:40px;font-weight:300"><em><strong>brave<\/strong><\/em><\/span> world<\/h3><ul class="ts-p1"><li>Second line<\/li><\/ul>/);
  });
  assert.deepEqual(errors, []);
});
