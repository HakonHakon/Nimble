import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeSiteV2 } from '../lib/site-model-v2.mjs';
import { spec } from '../lib/site-model-v2.mjs';
import * as R from '../assets/editor/rich-model.mjs';

const doc = [
  { t: 'h1', c: [{ text: 'Hello ' }, { text: 'world', b: true }] },
  { t: 'p', align: 'center', c: [{ text: 'Second line' }] },
  { t: 'ul', items: [[{ text: 'One' }], [{ text: 'Two' }]] }
];
const range = (l1, o1, l2 = l1, o2 = o1) => ({ start: { line: l1, offset: o1 }, end: { line: l2, offset: o2 } });
const defaults = spec.richDefaultStyle;

test('runs merge, split and keep the normalizer key order', () => {
  assert.deepEqual(R.mergeRuns([{ text: 'a', b: true }, { b: true, text: 'b' }, { text: '' }, { text: 'c', i: false }]), [{ text: 'ab', b: true }, { text: 'c' }]);
  assert.deepEqual(R.splitRuns([{ text: 'abc' }, { text: '', token: 'year' }, { text: 'de' }], 4), [[{ text: 'abc' }, { text: '', token: 'year' }], [{ text: 'de' }]]);
  assert.equal(R.lineCount(doc), 4);
  assert.deepEqual(R.endOf(doc), { line: 3, offset: 3 });
  // Output of every operation is accepted unchanged by the server normalizer.
  const site = { version: 2, site: { name: 'x' }, pages: [{ id: 'home', name: 'Home', children: ['s'] }], nodes: { s: { type: 'section', children: ['t'] }, t: { type: 'text', props: { doc: R.canonical(doc) } } } };
  assert.equal(JSON.stringify(normalizeSiteV2(site).nodes.t.props.doc), JSON.stringify(R.canonical(doc)));
});

test('marks and run properties apply to exactly the selected characters', () => {
  let next = R.toggleMark(doc, range(0, 3, 0, 8), 'i');
  assert.deepEqual(next[0].c, [{ text: 'Hel' }, { text: 'lo ', i: true }, { text: 'wo', b: true, i: true }, { text: 'rld', b: true }]);
  assert.equal(R.markState(next, range(0, 3, 0, 8)).i, true);
  next = R.toggleMark(next, range(0, 3, 0, 8), 'i');
  assert.deepEqual(next[0].c, doc[0].c, 'toggling twice restores the runs');
  assert.equal(R.markState(doc, range(0, 0, 0, 11)).b, false, 'mixed selection is not bold');
  assert.equal(R.markState(doc, range(0, 8)).b, true, 'caret inside bold text');
  next = R.setRunProp(doc, range(0, 0, 1, 6), 'color', '@accent');
  assert.deepEqual(next[0].c, [{ text: 'Hello ', color: '@accent' }, { text: 'world', b: true, color: '@accent' }]);
  assert.deepEqual(next[1].c, [{ text: 'Second', color: '@accent' }, { text: ' line' }]);
  assert.equal(R.markState(next, range(0, 0, 1, 6)).color, '@accent');
  assert.equal(R.markState(next, range(0, 0, 1, 8)).color, undefined, 'mixed colours');
  next = R.clearFormatting(R.setRunProp(next, range(0, 0, 0, 3), 'link', { to: 'url', href: 'https://a.example' }), range(0, 0, 1, 11));
  assert.deepEqual(next[0].c, [{ text: 'Hel', link: { to: 'url', href: 'https://a.example' } }, { text: 'lo world' }]);
  assert.equal(next[1].align, undefined, 'paragraph formatting is cleared too');
  assert.deepEqual(R.linkRange(next, range(0, 1)), range(0, 0, 0, 3));
  assert.equal(R.linkRange(next, range(0, 5)), null);
});

test('block types: headings, paragraphs and lists keep the line positions', () => {
  let next = R.setBlockType(doc, range(0, 2, 1, 1), 'p', 'p2', defaults);
  assert.deepEqual(next.slice(0, 2).map(block => [block.t, block.style, block.align]), [['p', 'p2', undefined], ['p', 'p2', 'center']]);
  next = R.setBlockType(doc, range(1, 0), 'h2', undefined, defaults);
  assert.deepEqual(next[1], { t: 'h2', align: 'center', c: [{ text: 'Second line' }] });
  next = R.setBlockType(doc, range(0, 0, 1, 0), 'ol', undefined, defaults);
  assert.deepEqual(next[0], { t: 'ol', items: [[{ text: 'Hello ' }, { text: 'world', b: true }], [{ text: 'Second line' }]] });
  assert.equal(R.lineCount(next), 4);
  next = R.setBlockType(doc, range(3, 1), 'p', undefined, defaults);
  assert.deepEqual(next.slice(2), [{ t: 'p', c: [{ text: 'One' }] }, { t: 'p', c: [{ text: 'Two' }] }], 'a list becomes paragraphs');
  next = R.setBlockProps(doc, range(2, 0, 3, 0), { lineHeight: 1.8, align: 'right' });
  assert.deepEqual(next[2], { t: 'ul', align: 'right', lineHeight: 1.8, items: doc[2].items });
  assert.deepEqual(R.blockState(next, range(3, 0)), { t: 'ul', align: 'right', lineHeight: 1.8 });
});

test('paste inserts blocks at the caret, replacing the selection', () => {
  let { doc: next, caret } = R.insertBlocks(doc, range(0, 6, 0, 11), [{ t: 'p', c: [{ text: 'there', i: true }] }]);
  assert.deepEqual(next[0].c, [{ text: 'Hello ' }, { text: 'there', i: true }]);
  assert.deepEqual(caret, { line: 0, offset: 11 });
  ({ doc: next, caret } = R.insertBlocks(doc, range(1, 6), R.textToBlocks('A\nB\r\nC')));
  assert.deepEqual(next.slice(1, 4).map(block => block.c.map(run => run.text).join('')), ['SecondA', 'B', 'C line']);
  assert.equal(next[3].t, 'p');
  assert.deepEqual(caret, { line: 3, offset: 1 });
  ({ doc: next } = R.insertBlocks(doc, range(0, 3, 2, 1), []));
  assert.deepEqual(next, [{ t: 'h1', c: [{ text: 'Helne' }] }, { t: 'ul', items: [[{ text: 'Two' }]] }]);
  ({ doc: next, caret } = R.insertBlocks([], range(0, 0), [{ t: 'h2', c: [{ text: 'x' }] }]));
  assert.deepEqual(next, [{ t: 'p', c: [{ text: 'x' }] }], 'a single pasted line takes the current block type');
});
