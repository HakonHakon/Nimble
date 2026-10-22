// The PHP edition must normalize and render v2 documents exactly like the Node edition.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { sourceRoot, example } from './helpers.mjs';
import { normalizeSite, makeDefaultSite } from '../lib/site-model.mjs';
import { normalizeSiteV2 } from '../lib/site-model-v2.mjs';
import { pageHtmlV2 } from '../lib/render-v2.mjs';
import { migrateV1 } from '../lib/migrate-v1.mjs';

const php = spawnSync('php', ['-v'], { encoding: 'utf8' });
const skip = php.status === 0 ? false : 'PHP CLI is not installed';
const YEAR = 2026;

function runPhp(document) {
  const result = spawnSync('php', [path.join(sourceRoot, 'test/php/v2-run.php')], { input: JSON.stringify({ document, year: YEAR }), encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout);
}
function runJs(document) {
  try {
    const site = normalizeSiteV2(document);
    return { site, pages: Object.fromEntries(site.pages.map(page => [page.id, pageHtmlV2(site, page, { year: YEAR })])) };
  } catch (error) {
    if (error.statusCode !== 400) throw error;
    return { error: error.message };
  }
}
async function fixtures() {
  const directory = path.join(sourceRoot, 'test/fixtures/v2');
  const files = (await fs.readdir(directory)).filter(name => name.endsWith('.json')).sort();
  const loaded = await Promise.all(files.map(async name => [name, JSON.parse(await fs.readFile(path.join(directory, name), 'utf8'))]));
  return [
    ...loaded,
    ['migrated-example', migrateV1(normalizeSite(example))],
    ['migrated-default', migrateV1(makeDefaultSite())]
  ];
}

test('PHP and Node produce identical v2 documents and HTML', { skip }, async () => {
  for (const [name, document] of await fixtures()) {
    const js = runJs(document), phpResult = runPhp(document);
    assert.equal(js.error, undefined, name + ': ' + js.error);
    assert.ok(Object.keys(js.pages).length > 0);
    assert.deepEqual(phpResult, JSON.parse(JSON.stringify(js)), name);
  }
});

test('PHP and Node reject the same invalid v2 documents', { skip }, async () => {
  const base = JSON.parse(await fs.readFile(path.join(sourceRoot, 'test/fixtures/v2/kitchen-sink.json'), 'utf8'));
  const mutate = change => { const copy = structuredClone(base); change(copy); return copy; };
  const cases = [
    mutate(doc => { doc.nodes.title.style.desktop.color = 'red'; }),
    mutate(doc => { doc.nodes.copy.place.desktop.margin = ['1px', '2px']; }),
    mutate(doc => { doc.nodes.copy.place.desktop.width = '-5px'; }),
    mutate(doc => { doc.nodes.hero.layout.desktop.columns = ['1fr', 'calc(100% - 1px)']; }),
    mutate(doc => { doc.nodes.cta.style.desktop.background = { kind: 'image', src: 'javascript:alert(1)' }; }),
    mutate(doc => { doc.nodes.cta.style.desktop.font = 'missing'; }),
    mutate(doc => { doc.nodes.title.style.desktop.color = '@missing'; }),
    mutate(doc => { doc.nodes.copy.children.push('title'); }),
    mutate(doc => { doc.nodes.copy.children.push('about'); }),
    mutate(doc => { doc.pages[0].children.push('copy'); }),
    mutate(doc => { doc.nodes.copy.children.push('nowhere'); }),
    mutate(doc => { doc.pages[1].path = '/api/x'; }),
    mutate(doc => { doc.pages = doc.pages.slice(1); }),
    mutate(doc => { doc.breakpoints = [{ id: 'a', max: 500 }, { id: 'b', max: 500 }]; }),
    mutate(doc => { doc.breakpoints = [{ id: 'desktop', max: 500 }]; }),
    mutate(doc => { doc.design.fonts.push({ id: 'evil', source: 'custom', family: 'X;}body{', src: '/uploads/x.woff2' }); }),
    mutate(doc => { doc.nodes.title.props.doc[0].t = 'script'; }),
    mutate(doc => { doc.nodes.title.props.doc[0].c[0].text = 'x'.repeat(20001); }),
    mutate(doc => { doc.nodes.yt.props.src = 'https://example.test/video'; }),
    mutate(doc => { doc.nodes.blob.tag = 'script'; }),
    mutate(doc => { doc.nodes.cta.place.desktop.rotate = 400; }),
    mutate(doc => { doc.nodes.cta.place.desktop.z = 1.5; }),
    mutate(doc => { delete doc.nodes.hdr; }),
    mutate(doc => { doc.nodes.cta.style = { desktop: { background: { kind: 'video', src: '/uploads/clip.mp4' } } }; }),
    mutate(doc => { doc.nodes.hero.style.desktop.background = { kind: 'video', src: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ' }; }),
    mutate(doc => { doc.nodes.cta.hover = { scale: 3 }; }),
    mutate(doc => { doc.nodes.cta.hover = { background: { kind: 'video', src: '/uploads/clip.mp4' } }; }),
    mutate(doc => { doc.nodes.hero.style.desktop.scrollEffect = 'zoom'; }),
    mutate(doc => { doc.nodes.hero.style.desktop.background = { kind: 'image', src: '/uploads/a.jpg', focal: [10, 120] }; }),
    mutate(doc => { doc.design.fonts.push({ id: 'bad', source: 'custom', family: 'Bad', files: [] }); }),
    mutate(doc => { doc.design.fonts.push({ id: 'bad', source: 'custom', family: 'Bad', files: [{ src: '/uploads/a.woff2', weight: 950 }] }); }),
    mutate(doc => { doc.design.presets = [{ id: 'x', name: 'X', type: 'nope' }]; }),
    mutate(doc => { doc.design.presets = [{ id: 'x', name: ' ', type: 'button' }]; }),
    mutate(doc => { doc.nodes.title.props.doc = [{ t: 'p', c: [{ text: 'x', font: 'missing' }] }]; }),
    mutate(doc => { doc.nodes.title.props.doc = [{ t: 'p', c: [{ text: 'x', size: '12pt' }] }]; }),
    mutate(doc => { doc.nodes.title.props.doc = [{ t: 'p', c: [{ text: 'x', weight: 950 }] }]; }),
    mutate(doc => { doc.nodes.title.props.doc = [{ t: 'p', c: [{ text: 'x', highlight: 'red' }] }]; }),
    mutate(doc => { doc.nodes.title.props.doc = [{ t: 'p', lineHeight: 9, c: [] }]; }),
    mutate(doc => { doc.nodes.title.props.doc = [{ t: 'ul', letterSpacing: 'wide', items: [] }]; })
  ];
  for (const [index, document] of cases.entries()) {
    const js = runJs(document), phpResult = runPhp(document);
    assert.ok(js.error, 'case ' + index + ' should be rejected by Node');
    assert.equal(phpResult.error, js.error, 'case ' + index);
  }
});
