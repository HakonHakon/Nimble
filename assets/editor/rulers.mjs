import { shield } from './transform.mjs';

// Rulers along the top and left of the canvas (page pixels) and draggable guides.
// Drag from the top ruler for a horizontal guide, from the left ruler for a vertical one;
// drag a guide back onto a ruler to remove it. Guides are kept per page and breakpoint in this browser.

export function createRulers({ area, canvas, key, onChange }) {
  const top = document.createElement('canvas'), left = document.createElement('canvas'), corner = document.createElement('div');
  top.className = 'ruler ruler-top'; left.className = 'ruler ruler-left'; corner.className = 'ruler-corner';
  top.setAttribute('aria-hidden', 'true'); left.setAttribute('aria-hidden', 'true');
  area.append(top, left, corner);
  let guides = { x: [], y: [] }, visible = true, drag = null;
  const SIZE = 20;

  function load() {
    try { const stored = JSON.parse(localStorage.getItem(key()) || 'null'); guides = stored && Array.isArray(stored.x) && Array.isArray(stored.y) ? stored : { x: [], y: [] }; }
    catch { guides = { x: [], y: [] }; }
    canvas.setGuides(visible ? guides : { x: [], y: [] });
    draw();
  }
  function save() {
    try { localStorage.setItem(key(), JSON.stringify(guides)); } catch {}
    canvas.setGuides(visible ? guides : { x: [], y: [] });
    onChange?.();
  }
  function step(scale) {
    for (const candidate of [5, 10, 20, 25, 50, 100, 200, 250, 500, 1000]) if (candidate * scale >= 48) return candidate;
    return 2000;
  }
  function paint(element, horizontal) {
    const areaRect = area.getBoundingClientRect(), frameRect = canvas.frame.getBoundingClientRect();
    const ratio = devicePixelRatio || 1, length = horizontal ? areaRect.width : areaRect.height;
    element.width = Math.round((horizontal ? length : SIZE) * ratio); element.height = Math.round((horizontal ? SIZE : length) * ratio);
    element.style.width = (horizontal ? length : SIZE) + 'px'; element.style.height = (horizontal ? SIZE : length) + 'px';
    const g = element.getContext('2d');
    g.scale(ratio, ratio);
    g.fillStyle = '#fafafd'; g.fillRect(0, 0, horizontal ? length : SIZE, horizontal ? SIZE : length);
    g.strokeStyle = '#c9c8d6'; g.fillStyle = '#77768a'; g.font = '9px Inter, system-ui, sans-serif'; g.lineWidth = 1;
    const scale = canvas.scale, view = canvas.viewport();
    const origin = horizontal ? frameRect.left - areaRect.left - view.scrollX * scale : frameRect.top - areaRect.top - view.scrollY * scale;
    const major = step(scale), minor = major / 5;
    const first = Math.floor(-origin / scale / minor) * minor, last = (length - origin) / scale;
    g.beginPath();
    for (let value = first; value <= last; value += minor) {
      const at = Math.round(origin + value * scale) + 0.5;
      const isMajor = Math.abs(value % major) < 0.001;
      const tick = isMajor ? SIZE : SIZE / 3;
      if (horizontal) { g.moveTo(at, SIZE); g.lineTo(at, SIZE - tick); } else { g.moveTo(SIZE, at); g.lineTo(SIZE - tick, at); }
      if (isMajor) {
        if (horizontal) g.fillText(String(Math.round(value)), at + 3, 9);
        else { g.save(); g.translate(9, at + 3); g.rotate(-Math.PI / 2); g.fillText(String(Math.round(value)), 0, 0); g.restore(); }
      }
    }
    g.stroke();
    g.fillStyle = 'rgba(61,109,255,.85)';
    for (const value of horizontal ? guides.x : guides.y) {
      const at = origin + value * scale;
      if (horizontal) g.fillRect(at - 1, 0, 2, SIZE); else g.fillRect(0, at - 1, SIZE, 2);
    }
  }
  function draw() {
    for (const element of [top, left, corner]) element.hidden = !visible;
    if (!visible || !canvas.document()) return;
    paint(top, true); paint(left, false);
  }
  // Page coordinate under a parent-document pointer position.
  const pagePoint = event => { const p = canvas.toFrame(event.clientX, event.clientY), view = canvas.viewport(); return { x: Math.round(p.x + view.scrollX), y: Math.round(p.y + view.scrollY) }; };
  const overRuler = (event, axis) => {
    const r = (axis === 'y' ? top : left).getBoundingClientRect();
    return axis === 'y' ? event.clientY < r.bottom : event.clientX < r.right;
  };
  function begin(event, axis, index) {
    event.preventDefault();
    drag = { axis, index };
    const release = shield(axis === 'x' ? 'col-resize' : 'row-resize');
    const move = moveEvent => {
      const value = pagePoint(moveEvent)[axis];
      if (drag.index === null) { guides[axis].push(value); drag.index = guides[axis].length - 1; }
      else guides[axis][drag.index] = value;
      canvas.setGuides(guides); draw();
      canvas.setGesture({ info: { x: axis === 'x' ? value - canvas.viewport().scrollX + 6 : 6, y: axis === 'y' ? value - canvas.viewport().scrollY + 6 : 6, text: (axis === 'x' ? 'x ' : 'y ') + value } });
    };
    const up = upEvent => {
      document.removeEventListener('pointermove', move); document.removeEventListener('pointerup', up);
      release();
      if (drag.index !== null && overRuler(upEvent, axis)) guides[axis].splice(drag.index, 1);
      drag = null;
      canvas.setGesture(null);
      save(); draw();
    };
    document.addEventListener('pointermove', move); document.addEventListener('pointerup', up);
  }
  top.addEventListener('pointerdown', event => begin(event, 'y', null));
  left.addEventListener('pointerdown', event => begin(event, 'x', null));
  return {
    load, draw,
    beginGuideDrag: (event, axis, index) => begin(event, axis, index),
    get guides() { return visible ? guides : { x: [], y: [] }; },
    setVisible(on) { visible = on; canvas.setGuides(on ? guides : { x: [], y: [] }); draw(); },
    clear() { guides = { x: [], y: [] }; save(); draw(); }
  };
}
