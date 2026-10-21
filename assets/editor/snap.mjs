// Snapping for move and resize gestures: parent edges and centre, sibling edges and centres,
// grid lines, ruler guides and equal spacing between neighbours. Returns the correction and guides to draw.
import { box } from './geometry.mjs';

export function snapTargets({ content, siblings = [], grid = null, guides = { x: [], y: [] }, viewport }) {
  const xs = [], ys = [];
  const addX = (pos, from, to, kind) => xs.push({ pos, from, to, kind });
  const addY = (pos, from, to, kind) => ys.push({ pos, from, to, kind });
  if (content) {
    for (const pos of [content.left, content.cx, content.right]) addX(pos, content.top, content.bottom, 'parent');
    for (const pos of [content.top, content.cy, content.bottom]) addY(pos, content.left, content.right, 'parent');
  }
  for (const item of siblings) {
    for (const pos of [item.left, item.cx, item.right]) addX(pos, item.top, item.bottom, 'sibling');
    for (const pos of [item.top, item.cy, item.bottom]) addY(pos, item.left, item.right, 'sibling');
  }
  if (grid) {
    for (const [start, end] of grid.columns) { addX(start, grid.content.top, grid.content.bottom, 'grid'); addX(end, grid.content.top, grid.content.bottom, 'grid'); }
    for (const [start, end] of grid.rows) { addY(start, grid.content.left, grid.content.right, 'grid'); addY(end, grid.content.left, grid.content.right, 'grid'); }
  }
  for (const pos of guides.x) addX(pos, 0, viewport.height, 'guide');
  for (const pos of guides.y) addY(pos, 0, viewport.width, 'guide');
  return { xs, ys, siblings };
}

function nearest(edges, targets, threshold) {
  let best = null;
  for (const [, value] of edges) for (const target of targets) {
    const distance = target.pos - value;
    if (Math.abs(distance) <= threshold && (best === null || Math.abs(distance) < Math.abs(best))) best = distance;
  }
  return best;
}
// Equal spacing between the nearest neighbours on each side along one axis.
function spacing(b, siblings, axis) {
  const [start, end, crossStart, crossEnd, size] = axis === 'x' ? ['left', 'right', 'top', 'bottom', 'width'] : ['top', 'bottom', 'left', 'right', 'height'];
  const overlapping = siblings.filter(item => item[crossEnd] > b[crossStart] && item[crossStart] < b[crossEnd]);
  const before = overlapping.filter(item => item[end] <= b[start] + 1).sort((a, c) => c[end] - a[end])[0];
  const after = overlapping.filter(item => item[start] >= b[end] - 1).sort((a, c) => a[start] - c[start])[0];
  if (!before || !after) return null;
  const target = (before[end] + after[start] - b[size]) / 2;
  return { distance: target - b[start], before, after };
}

// `edges` limits which edges may snap (resize moves only some of them).
export function snapBox(b, targets, threshold, { x = ['left', 'cx', 'right'], y = ['top', 'cy', 'bottom'], equal = true } = {}) {
  let dx = x.length ? nearest(x.map(edge => [edge, b[edge]]), targets.xs, threshold) : null;
  let dy = y.length ? nearest(y.map(edge => [edge, b[edge]]), targets.ys, threshold) : null;
  const gaps = [];
  if (equal && x.length === 3) {
    const result = spacing(b, targets.siblings, 'x');
    if (result && Math.abs(result.distance) <= threshold && (dx === null || Math.abs(result.distance) < Math.abs(dx))) { dx = result.distance; gaps.push({ axis: 'x', ...result }); }
  }
  if (equal && y.length === 3) {
    const result = spacing(b, targets.siblings, 'y');
    if (result && Math.abs(result.distance) <= threshold && (dy === null || Math.abs(result.distance) < Math.abs(dy))) { dy = result.distance; gaps.push({ axis: 'y', ...result }); }
  }
  dx = dx ?? 0; dy = dy ?? 0;
  const moved = box(b.left + (x.length ? dx : 0), b.top + (y.length ? dy : 0), b.width, b.height);
  const lines = [];
  for (const target of targets.xs) if (x.some(edge => Math.abs(target.pos - moved[edge]) < 0.5)) lines.push({ x1: target.pos, x2: target.pos, y1: Math.min(target.from, moved.top), y2: Math.max(target.to, moved.bottom), kind: target.kind });
  for (const target of targets.ys) if (y.some(edge => Math.abs(target.pos - moved[edge]) < 0.5)) lines.push({ y1: target.pos, y2: target.pos, x1: Math.min(target.from, moved.left), x2: Math.max(target.to, moved.right), kind: target.kind });
  const labels = [];
  for (const gap of gaps) {
    if (gap.axis === 'x') {
      const y0 = moved.cy;
      labels.push({ x1: gap.before.right, x2: moved.left, y1: y0, y2: y0, text: Math.round(moved.left - gap.before.right) }, { x1: moved.right, x2: gap.after.left, y1: y0, y2: y0, text: Math.round(gap.after.left - moved.right) });
    } else {
      const x0 = moved.cx;
      labels.push({ y1: gap.before.bottom, y2: moved.top, x1: x0, x2: x0, text: Math.round(moved.top - gap.before.bottom) }, { y1: moved.bottom, y2: gap.after.top, x1: x0, x2: x0, text: Math.round(gap.after.top - moved.bottom) });
    }
  }
  return { dx: x.length ? dx : 0, dy: y.length ? dy : 0, lines, labels };
}
