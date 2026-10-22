// Geometry inside the canvas iframe. All coordinates are iframe viewport (CSS) pixels.

const px = value => parseFloat(value) || 0;
export function rectOf(el) {
  const r = el.getBoundingClientRect();
  return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height, cx: r.left + r.width / 2, cy: r.top + r.height / 2 };
}
export function box(left, top, width, height) {
  return { left, top, width, height, right: left + width, bottom: top + height, cx: left + width / 2, cy: top + height / 2 };
}
// Rotation of an element in degrees, read from its computed transform.
export function rotationOf(el) {
  const transform = el.ownerDocument.defaultView.getComputedStyle(el).transform;
  const match = transform && transform.match(/^matrix\(([^,]+),([^,]+)/);
  return match ? Math.round(Math.atan2(parseFloat(match[2]), parseFloat(match[1])) * 180 / Math.PI * 100) / 100 : 0;
}
// The unrotated layout box: the element's own size, centred where it is drawn.
export function layoutBox(el) {
  const r = el.getBoundingClientRect();
  const width = el.offsetWidth || r.width, height = el.offsetHeight || r.height;
  return box(r.left + r.width / 2 - width / 2, r.top + r.height / 2 - height / 2, width, height);
}
export function contentBox(el) {
  const cs = el.ownerDocument.defaultView.getComputedStyle(el), r = el.getBoundingClientRect();
  const left = r.left + px(cs.borderLeftWidth) + px(cs.paddingLeft), top = r.top + px(cs.borderTopWidth) + px(cs.paddingTop);
  const right = r.right - px(cs.borderRightWidth) - px(cs.paddingRight), bottom = r.bottom - px(cs.borderBottomWidth) - px(cs.paddingBottom);
  return box(left, top, Math.max(0, right - left), Math.max(0, bottom - top));
}
export const isGrid = el => el.ownerDocument.defaultView.getComputedStyle(el).display === 'grid';
function tracks(text, start, size, gap) {
  const sizes = String(text).replace(/\[[^\]]*\]/g, ' ').trim().split(/\s+/).map(parseFloat).filter(Number.isFinite);
  if (!sizes.length) return [[start, start + size]];
  const lines = [];
  let at = start;
  for (const length of sizes) { lines.push([at, at + length]); at += length + gap; }
  return lines;
}
// Resolved grid tracks of a grid container: columns and rows as [start, end] pairs.
export function gridGeometry(el) {
  if (!isGrid(el)) return null;
  const cs = el.ownerDocument.defaultView.getComputedStyle(el), content = contentBox(el);
  const columnGap = cs.columnGap === 'normal' ? 0 : px(cs.columnGap), rowGap = cs.rowGap === 'normal' ? 0 : px(cs.rowGap);
  return { content, columns: tracks(cs.gridTemplateColumns, content.left, content.width, columnGap), rows: tracks(cs.gridTemplateRows, content.top, content.height, rowGap), columnGap, rowGap };
}
const trackAt = (list, value) => {
  for (let i = 0; i < list.length; i++) if (value < list[i][1] + (list[i + 1] ? (list[i + 1][0] - list[i][1]) / 2 : Infinity)) return i;
  return list.length - 1;
};
export function cellAt(geo, x, y) { return { col: trackAt(geo.columns, x) + 1, row: trackAt(geo.rows, y) + 1 }; }
export function cellOrigin(geo, row, col) {
  const column = geo.columns[Math.min(col, geo.columns.length) - 1], line = geo.rows[Math.min(row, geo.rows.length) - 1];
  return { left: column[0], top: line[0] };
}
export function rotate(x, y, degrees) {
  const angle = degrees * Math.PI / 180, cos = Math.cos(angle), sin = Math.sin(angle);
  return { x: x * cos - y * sin, y: x * sin + y * cos };
}
export const round = value => Math.round(value);
export const pxValue = value => Math.round(value) + 'px';
