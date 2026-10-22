import test from 'node:test';
import assert from 'node:assert/strict';
import { box } from '../assets/editor/geometry.mjs';
import { snapTargets, snapBox } from '../assets/editor/snap.mjs';

const content = box(0, 0, 1000, 600);

test('moving boxes snap to the closest parent, sibling, grid or guide line', () => {
  const targets = snapTargets({ content, siblings: [box(100, 100, 200, 50)], guides: { x: [733], y: [] }, viewport: { width: 1000, height: 600 } });
  let result = snapBox(box(396, 300, 200, 100), targets, 6);
  assert.equal(result.dx, 4, 'centre snaps to the parent centre (500)');
  assert.ok(result.lines.some(line => line.x1 === 500 && line.kind === 'parent'));
  result = snapBox(box(103, 300, 50, 50), targets, 6);
  assert.equal(result.dx, -3, 'left edge snaps to the sibling left edge');
  result = snapBox(box(735, 300, 50, 50), targets, 6);
  assert.equal(result.dx, -2, 'guides attract edges');
  assert.equal(result.lines.find(line => line.kind === 'guide').x1, 733);
  result = snapBox(box(380, 320, 50, 50), targets, 6);
  assert.equal(result.dx, 0, 'nothing within the threshold leaves the box alone');
  assert.equal(result.lines.length, 0);
});

test('resizing only snaps the edges that move', () => {
  const targets = snapTargets({ content, viewport: { width: 1000, height: 600 } });
  const result = snapBox(box(400, 200, 597, 100), targets, 6, { x: ['right'], y: [], equal: false });
  assert.equal(result.dx, 3);
  assert.equal(result.dy, 0);
});

test('equal spacing centres a box between its neighbours and labels both gaps', () => {
  const siblings = [box(0, 0, 100, 100), box(500, 0, 100, 100)];
  const targets = snapTargets({ siblings, viewport: { width: 1000, height: 600 } });
  const result = snapBox(box(253, 20, 100, 60), targets, 6);
  assert.equal(result.dx, -3);
  assert.deepEqual(result.labels.map(label => label.text), [150, 150]);
});

test('grid tracks are snap targets', () => {
  const grid = { content, columns: [[0, 490], [510, 1000]], rows: [[0, 600]] };
  const targets = snapTargets({ grid, viewport: { width: 1000, height: 600 } });
  const result = snapBox(box(514, 50, 100, 100), targets, 6, { equal: false });
  assert.equal(result.dx, -4);
  assert.ok(result.lines.some(line => line.kind === 'grid' && line.x1 === 510));
});
