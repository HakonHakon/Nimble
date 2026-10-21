// Direct manipulation on the canvas: move (freeform in grids, reorder in stacks, reparent into other
// containers), resize with 8 handles, rotate, and arrow-key nudging. Gestures only touch inline styles
// while the pointer is down and commit a single undoable step when it is released.
import { box, layoutBox, rotationOf, contentBox, gridGeometry, cellAt, cellOrigin, rotate, pxValue } from './geometry.mjs';
import { snapTargets, snapBox } from './snap.mjs';
import { isContainer, isRoot, ancestors, effective, moveOps, label } from './tree.mjs';

const SNAP_PX = 6;
const POSITION_KEYS = ['cell', 'justifySelf', 'alignSelf', 'margin', 'order'];

// While a handle or guide is dragged, a transparent layer over the whole window keeps every pointer
// event in this document, even when the pointer crosses the canvas iframe.
export function shield(cursor = 'default') {
  const layer = document.createElement('div');
  layer.className = 'gesture-shield';
  layer.style.cursor = cursor;
  document.body.append(layer);
  return () => layer.remove();
}

export function createTransformer(canvas, ctx) {
  let active = null;
  const state = () => ctx.state();
  const node = id => state().doc.nodes[id];
  const modeOf = id => (id ? effective(node(id).layout, state().bpIds, state().bp).mode : null) || 'grid';
  const threshold = () => SNAP_PX / canvas.scale;
  const placeAt = id => effective(node(id).place, state().bpIds, state().bp);
  const viewportGuides = () => {
    const { scrollX, scrollY, width, height } = canvas.viewport(), guides = ctx.guides();
    return { x: guides.x.map(x => x - scrollX), y: guides.y.map(y => y - scrollY), viewport: { width, height } };
  };
  function movable(id) {
    const where = state().index.get(id);
    return ctx.editable() && !!where && !node(id).locked && where.list !== 'header' && where.list !== 'footer';
  }
  function handles(id) {
    if (!id || !ctx.editable() || !node(id) || node(id).locked) return [];
    return isRoot(node(id).type) ? ['s'] : ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w', 'rotate'];
  }
  function childBoxes(parentId, exclude) {
    return (node(parentId)?.children || []).filter(id => id !== exclude).map(id => canvas.element(id)).filter(el => el && el.getClientRects().length).map(layoutBox);
  }
  function targetsFor(parentId, exclude) {
    const parentEl = canvas.element(parentId), { x, y, viewport } = viewportGuides();
    return snapTargets({ content: contentBox(parentEl), siblings: childBoxes(parentId, exclude), grid: modeOf(parentId) === 'grid' ? gridGeometry(parentEl) : null, guides: { x, y }, viewport });
  }
  // The deepest container under the pointer that may receive `id`.
  function containerAt(id, x, y) {
    const d = canvas.document(), dragged = canvas.element(id), { index, doc } = state();
    for (const hit of d.elementsFromPoint(x, y)) {
      let el = hit.closest('.n');
      while (el && (dragged.contains(el) || !isContainer(doc.nodes[el.id]?.type))) el = el.parentElement?.closest('.n');
      if (el && !ancestors(index, el.id).includes(id) && index.has(el.id)) return el.id;
    }
    return null;
  }
  // Visual order of stack children along the main axis and the insertion point for the pointer.
  function stackSlot(parentId, id, x, y) {
    const direction = effective(node(parentId).layout, state().bpIds, state().bp).direction || 'column';
    const horizontal = direction === 'row';
    const items = node(parentId).children.filter(child => child !== id).map(child => ({ id: child, el: canvas.element(child) })).filter(item => item.el?.getClientRects().length).map(item => ({ ...item, b: layoutBox(item.el) }));
    items.sort((a, b) => horizontal ? a.b.left - b.b.left : a.b.top - b.b.top);
    const at = items.findIndex(item => (horizontal ? x < item.b.cx : y < item.b.cy));
    const position = at === -1 ? items.length : at;
    const content = contentBox(canvas.element(parentId));
    let line;
    if (horizontal) {
      const edge = position < items.length ? items[position].b.left - 3 : (items.length ? items[items.length - 1].b.right + 1 : content.left);
      line = { x1: edge, x2: edge + 2, y1: content.top, y2: content.bottom };
    } else {
      const edge = position < items.length ? items[position].b.top - 3 : (items.length ? items[items.length - 1].b.bottom + 1 : content.top);
      line = { x1: content.left, x2: content.right, y1: edge, y2: edge + 2 };
    }
    return { order: items.map(item => item.id), position, line };
  }
  // Placement values that put `moved` (layout box) at its spot inside a grid cell, docked top-left.
  function gridPlacement(parentId, id, moved, pointer, keepSpans) {
    const geo = gridGeometry(canvas.element(parentId));
    const cell = cellAt(geo, pointer.x, pointer.y), origin = cellOrigin(geo, cell.row, cell.col);
    const current = placeAt(id);
    const spans = keepSpans && current.cell ? [current.cell[2], current.cell[3]] : [1, 1];
    const values = { cell: [cell.row, cell.col, spans[0], spans[1]], justifySelf: 'start', alignSelf: 'start', margin: [pxValue(moved.top - origin.top), '0px', '0px', pxValue(moved.left - origin.left)] };
    if (!current.width || current.width === 'auto') values.width = pxValue(moved.width);
    return { values, origin };
  }
  const placeOps = (id, values) => Object.entries(values).map(([key, value]) => ({ path: ['nodes', id, 'place', state().bp, key], value }));

  // ---- Move ----
  function pointerDown(event, id) {
    // No native text selection or drag-and-drop inside the canvas: every drag is an editor gesture.
    event.preventDefault();
    if (!id) { ctx.select(null, { source: 'canvas' }); return; }
    if (id !== state().selected) ctx.select(id, { source: 'canvas' });
    if (!movable(id)) return;
    const start = { x: event.clientX, y: event.clientY }, target = event.target, host = target.ownerDocument;
    target.setPointerCapture?.(event.pointerId);
    let started = false;
    const onMove = move => {
      if (!started) {
        if (Math.hypot(move.clientX - start.x, move.clientY - start.y) < 3) return;
        started = true; beginMove(id, start);
      }
      if (active?.kind === 'move') updateMove({ x: move.clientX, y: move.clientY }, move);
    };
    const onUp = () => { cleanup(); if (active?.kind === 'move') finishMove(); };
    const cleanup = () => { host.removeEventListener('pointermove', onMove); host.removeEventListener('pointerup', onUp); host.removeEventListener('pointercancel', onCancel); };
    const onCancel = () => { cleanup(); cancel(); };
    host.addEventListener('pointermove', onMove);
    host.addEventListener('pointerup', onUp);
    host.addEventListener('pointercancel', onCancel);
  }
  function beginMove(id, start) {
    const el = canvas.element(id), where = state().index.get(id);
    const view = canvas.viewport();
    active = { kind: 'move', id, el, start, startBox: layoutBox(el), parent: where.parent, root: where.parent === null, targets: new Map(), scroll: { x: view.scrollX, y: view.scrollY } };
    canvas.setGesture({});
  }
  function updateMove(pointer, event) {
    const a = active, { startBox } = a;
    // Auto-scroll near the top and bottom edge; the element's own position moves with the page.
    const view = canvas.viewport();
    if (pointer.y < 40) canvas.document().defaultView.scrollBy(0, -20);
    else if (pointer.y > view.height - 40) canvas.document().defaultView.scrollBy(0, 20);
    const now = canvas.viewport(), scrolled = { x: now.scrollX - a.scroll.x, y: now.scrollY - a.scroll.y };
    let dx = pointer.x - a.start.x, dy = pointer.y - a.start.y;
    if (event.shiftKey) { if (Math.abs(dx) > Math.abs(dy)) dy = 0; else dx = 0; }
    let moved = box(startBox.left + dx, startBox.top + dy, startBox.width, startBox.height);
    const gesture = { lines: [], labels: [] };
    if (a.root) {
      const page = state().page, slot = rootSlot(a.id, pointer.y, page);
      a.drop = { kind: 'root', ...slot };
      gesture.insert = slot.line;
      moved = box(startBox.left, startBox.top + dy, startBox.width, startBox.height);
    } else {
      const over = containerAt(a.id, pointer.x, pointer.y) || a.parent;
      const parentId = over;
      if (parentId !== a.parent) gesture.target = canvas.element(parentId).getBoundingClientRect();
      if (modeOf(parentId) === 'grid') {
        if (ctx.snapping() && !(event.ctrlKey || event.metaKey)) {
          const key = parentId + ':' + now.scrollX + ':' + now.scrollY;
          if (!a.targets.has(key)) { a.el.style.translate = ''; a.targets.set(key, targetsFor(parentId, a.id)); }
          const snapped = snapBox(moved, a.targets.get(key), threshold());
          moved = box(moved.left + snapped.dx, moved.top + snapped.dy, moved.width, moved.height);
          gesture.lines = snapped.lines; gesture.labels = snapped.labels;
        }
        const { origin } = gridPlacement(parentId, a.id, moved, pointer, parentId === a.parent);
        gesture.labels.push({ x1: origin.left, x2: moved.left, y1: moved.top - 8, y2: moved.top - 8, text: Math.round(moved.left - origin.left) }, { x1: moved.left - 8, x2: moved.left - 8, y1: origin.top, y2: moved.top, text: Math.round(moved.top - origin.top) });
        a.drop = { kind: 'grid', parent: parentId, moved, pointer };
      } else {
        const slot = stackSlot(parentId, a.id, pointer.x, pointer.y);
        gesture.insert = slot.line;
        a.drop = { kind: 'stack', parent: parentId, ...slot };
      }
    }
    a.el.style.translate = (moved.left - startBox.left + scrolled.x) + 'px ' + (moved.top - startBox.top + scrolled.y) + 'px';
    gesture.info = { x: moved.left, y: moved.bottom + 6, text: a.drop.kind === 'grid' ? Math.round(moved.left) + ', ' + Math.round(moved.top) : 'Move ' + label(node(a.id)) };
    canvas.setGesture(gesture);
  }
  function rootSlot(id, y, page) {
    const items = page.children.filter(child => child !== id).map(child => ({ id: child, b: canvas.element(child)?.getBoundingClientRect() })).filter(item => item.b);
    const at = items.findIndex(item => y < item.b.top + item.b.height / 2);
    const position = at === -1 ? items.length : at;
    const edge = position < items.length ? items[position].b.top - 2 : (items.length ? items[items.length - 1].b.bottom : 0);
    return { order: items.map(item => item.id), position, line: { x1: 0, x2: canvas.viewport().width, y1: edge, y2: edge + 4 } };
  }
  function finishMove() {
    const a = active; active = null;
    a.el.style.translate = '';
    canvas.setGesture(null);
    if (!a.drop) return;
    const { doc, index, pageIndex, bp } = state();
    let ops = [];
    if (a.drop.kind === 'root') {
      const before = a.drop.order[a.drop.position];
      const children = doc.pages[pageIndex].children;
      ops = moveOps(doc, index, a.id, { parent: null, page: pageIndex, position: before ? children.indexOf(before) : children.length });
    } else if (a.drop.parent !== a.parent) {
      // Reparent: positions from the old container no longer apply, sizes and rotation do.
      const cleaned = {};
      for (const [bpId, values] of Object.entries(node(a.id).place || {})) {
        const kept = Object.fromEntries(Object.entries(values).filter(([key]) => !POSITION_KEYS.includes(key)));
        if (Object.keys(kept).length) cleaned[bpId] = kept;
      }
      const target = a.drop.kind === 'grid'
        ? { parent: a.drop.parent, page: pageIndex, position: node(a.drop.parent).children.length }
        : { parent: a.drop.parent, page: pageIndex, position: a.drop.position < a.drop.order.length ? node(a.drop.parent).children.indexOf(a.drop.order[a.drop.position]) : node(a.drop.parent).children.length };
      if (a.drop.kind === 'grid') cleaned[bp] = { ...(cleaned[bp] || {}), ...gridPlacement(a.drop.parent, a.id, a.drop.moved, a.drop.pointer, false).values };
      ops = [...moveOps(doc, index, a.id, target), { path: ['nodes', a.id, 'place'], value: Object.keys(cleaned).length ? cleaned : undefined }];
    } else if (a.drop.kind === 'grid') {
      ops = placeOps(a.id, gridPlacement(a.parent, a.id, a.drop.moved, a.drop.pointer, true).values);
    } else {
      const order = a.drop.order.slice(); order.splice(a.drop.position, 0, a.id);
      if (bp === 'desktop') {
        const children = node(a.parent).children, before = order[a.drop.position + 1];
        ops = moveOps(doc, index, a.id, { parent: a.parent, page: pageIndex, position: before ? children.indexOf(before) : children.length });
      } else {
        // Smaller breakpoints reorder with `order` only, so the desktop order stays as it is.
        ops = order.map((child, position) => ({ path: ['nodes', child, 'place', bp, 'order'], value: position }));
      }
    }
    ctx.commit(ops, { label: 'Move ' + label(node(a.id)) });
  }

  // ---- Resize and rotate (handles live in the parent document overlay) ----
  function columnHandles(id) {
    if (!id || !ctx.editable() || !node(id)?.children) return false;
    const layout = effective(node(id).layout, state().bpIds, state().bp);
    return (layout.mode || 'grid') === 'grid' && (layout.columns || ['1fr']).length > 1 && !(layout.columns || []).some(track => track.startsWith('repeat('));
  }
  // Dragging the divider between columns i and i+1 changes only those two tracks.
  function columnDown(event, index) {
    const id = state().selected, el = canvas.element(id);
    const geo = gridGeometry(el), columns = effective(node(id).layout, state().bpIds, state().bp).columns.slice();
    const left = geo.columns[index], right = geo.columns[index + 1], gap = right[0] - left[1];
    const total = (left[1] - left[0]) + (right[1] - right[0]);
    const release = shield('col-resize');
    const frOf = track => /^\d+(\.\d+)?fr$/.test(track) ? parseFloat(track) : null;
    let result = null;
    const move = moveEvent => {
      const x = canvas.toFrame(moveEvent.clientX, moveEvent.clientY).x;
      const leftWidth = Math.max(24, Math.min(total - 24, x - gap / 2 - left[0])), rightWidth = total - leftWidth;
      const next = columns.slice(), a = frOf(columns[index]), b = frOf(columns[index + 1]);
      if (a !== null && b !== null) {
        const sum = a + b;
        next[index] = Math.round(sum * leftWidth / total * 100) / 100 + 'fr';
        next[index + 1] = Math.round((sum - parseFloat(next[index])) * 100) / 100 + 'fr';
      } else {
        // A flexible (fr) track absorbs the change; fixed and auto tracks become pixel widths.
        next[index] = a !== null ? columns[index] : Math.round(leftWidth) + 'px';
        next[index + 1] = b !== null ? columns[index + 1] : Math.round(rightWidth) + 'px';
      }
      result = next;
      el.style.gridTemplateColumns = next.join(' ');
      canvas.setGesture({ keepColumns: true, info: { x: x + 8, y: geo.content.top + 8, text: next[index] + ' | ' + next[index + 1] } });
    };
    const up = () => {
      document.removeEventListener('pointermove', move); document.removeEventListener('pointerup', up);
      release();
      el.style.gridTemplateColumns = '';
      canvas.setGesture(null);
      if (result) ctx.commit([{ path: ['nodes', id, 'layout', state().bp, 'columns'], value: result }], { label: 'Resize columns' });
    };
    document.addEventListener('pointermove', move); document.addEventListener('pointerup', up);
  }
  function handleDown(event, handle) {
    if (handle.startsWith('col:')) return columnDown(event, Number(handle.slice(4)));
    const id = state().selected;
    if (!id || !ctx.editable() || node(id).locked) return;
    const el = canvas.element(id);
    const release = shield(getComputedStyle(event.target).cursor);
    const where = state().index.get(id);
    const startBox = layoutBox(el), rotation = rotationOf(el);
    const start = canvas.toFrame(event.clientX, event.clientY);
    active = { kind: handle === 'rotate' ? 'rotate' : 'resize', handle, id, el, startBox, rotation, start, parent: where.parent, root: where.parent === null };
    if (active.kind === 'resize' && !active.root && modeOf(where.parent) === 'grid') {
      const geo = gridGeometry(canvas.element(where.parent)), current = placeAt(id).cell;
      const cell = current ? { row: current[0], col: current[1] } : cellAt(geo, startBox.cx, startBox.cy);
      active.grid = { cell, origin: cellOrigin(geo, cell.row, cell.col), spans: current ? [current[2], current[3]] : [1, 1] };
      active.targets = rotation ? null : targetsFor(where.parent, id);
    }
    canvas.setGesture({});
    const onMove = move => { if (active) (active.kind === 'rotate' ? updateRotate : updateResize)(canvas.toFrame(move.clientX, move.clientY), move); };
    const onUp = () => { cleanup(); release(); if (!active) return; active.kind === 'rotate' ? finishRotate() : finishResize(); };
    const onCancel = () => { cleanup(); release(); cancel(); };
    const cleanup = () => { document.removeEventListener('pointermove', onMove); document.removeEventListener('pointerup', onUp); document.removeEventListener('pointercancel', onCancel); };
    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onUp);
    document.addEventListener('pointercancel', onCancel);
  }
  function updateResize(pointer, event) {
    const a = active, { startBox, rotation } = a;
    const hx = a.handle.includes('e') ? 1 : a.handle.includes('w') ? -1 : 0;
    const hy = a.handle.includes('s') ? 1 : a.handle.includes('n') ? -1 : 0;
    const local = rotate(pointer.x - a.start.x, pointer.y - a.start.y, -rotation);
    const factor = event.altKey ? 2 : 1;
    let width = Math.max(4, startBox.width + hx * local.x * factor), height = Math.max(4, startBox.height + hy * local.y * factor);
    if (event.shiftKey) {
      const ratio = startBox.width / startBox.height;
      if (hx && hy) { if (width / startBox.width > height / startBox.height) height = width / ratio; else width = height * ratio; }
      else if (hx) height = width / ratio;
      else if (hy) width = height * ratio;
    }
    const gesture = { lines: [], labels: [] };
    const place = () => {
      const shift = event.altKey ? { x: 0, y: 0 } : rotate(hx * (width - startBox.width) / 2, hy * (height - startBox.height) / 2, rotation);
      const cx = startBox.cx + shift.x, cy = startBox.cy + shift.y;
      return box(cx - width / 2, cy - height / 2, width, height);
    };
    let next = place();
    if (a.targets && ctx.snapping() && !(event.ctrlKey || event.metaKey) && !event.shiftKey) {
      const snapped = snapBox(next, a.targets, threshold(), { x: hx ? [hx > 0 ? 'right' : 'left'] : [], y: hy ? [hy > 0 ? 'bottom' : 'top'] : [], equal: false });
      width = Math.max(4, width + hx * snapped.dx * (event.altKey ? 2 : 1)); height = Math.max(4, height + hy * snapped.dy * (event.altKey ? 2 : 1));
      next = place();
      gesture.lines = snapped.lines;
    }
    a.result = { width, height, next, hx, hy };
    const style = a.el.style;
    if (a.root) style.minHeight = height + 'px';
    else {
      if (hx) style.width = width + 'px';
      if (hy) style.height = height + 'px';
      if (a.grid) {
        style.justifySelf = 'start'; style.alignSelf = 'start';
        style.margin = (next.top - a.grid.origin.top) + 'px 0px 0px ' + (next.left - a.grid.origin.left) + 'px';
      }
    }
    gesture.info = { x: next.right + 6, y: next.bottom + 6, text: Math.round(width) + ' × ' + Math.round(height) };
    canvas.setGesture(gesture);
  }
  function finishResize() {
    const a = active; active = null;
    Object.assign(a.el.style, { width: '', height: '', minHeight: '', margin: '', justifySelf: '', alignSelf: '' });
    canvas.setGesture(null);
    if (!a.result) return;
    const { width, height, next, hx, hy } = a.result;
    if (a.root) return ctx.commit([{ path: ['nodes', a.id, 'layout', state().bp, 'minHeight'], value: pxValue(height) }], { label: 'Resize section' });
    const values = {};
    if (hx) values.width = pxValue(width);
    if (hy) values.height = pxValue(height);
    if (a.grid) Object.assign(values, { cell: [a.grid.cell.row, a.grid.cell.col, a.grid.spans[0], a.grid.spans[1]], justifySelf: 'start', alignSelf: 'start', margin: [pxValue(next.top - a.grid.origin.top), '0px', '0px', pxValue(next.left - a.grid.origin.left)] });
    ctx.commit(placeOps(a.id, values), { label: 'Resize ' + label(node(a.id)) });
  }
  function updateRotate(pointer, event) {
    const a = active, { startBox } = a;
    const angle = deg => Math.atan2(deg.y - startBox.cy, deg.x - startBox.cx) * 180 / Math.PI;
    let value = a.rotation + angle(pointer) - angle(a.start);
    value = event.shiftKey ? Math.round(value / 15) * 15 : Math.round(value);
    value = ((value + 180) % 360 + 360) % 360 - 180;
    if (!event.shiftKey && Math.abs(value) <= 2) value = 0;
    a.value = value;
    a.el.style.transform = value ? 'rotate(' + value + 'deg)' : 'none';
    canvas.setGesture({ info: { x: startBox.cx, y: startBox.top - 28, text: value + '°' } });
  }
  function finishRotate() {
    const a = active; active = null;
    a.el.style.transform = '';
    canvas.setGesture(null);
    if (a.value === undefined) return;
    ctx.commit([{ path: ['nodes', a.id, 'place', state().bp, 'rotate'], value: a.value || (state().bp === 'desktop' ? undefined : 0) }], { label: 'Rotate ' + label(node(a.id)) });
  }

  // ---- Keyboard ----
  function nudge(dx, dy) {
    const id = state().selected;
    if (!id || !movable(id) || state().index.get(id).parent === null) return;
    const where = state().index.get(id), el = canvas.element(id);
    if (modeOf(where.parent) === 'grid') {
      const b = layoutBox(el), moved = box(b.left + dx, b.top + dy, b.width, b.height);
      const current = placeAt(id).cell;
      const geo = gridGeometry(canvas.element(where.parent));
      const cell = current ? { row: current[0], col: current[1] } : cellAt(geo, b.cx, b.cy);
      const origin = cellOrigin(geo, cell.row, cell.col);
      const values = { cell: [cell.row, cell.col, current?.[2] || 1, current?.[3] || 1], justifySelf: 'start', alignSelf: 'start', margin: [pxValue(moved.top - origin.top), '0px', '0px', pxValue(moved.left - origin.left)] };
      if (!placeAt(id).width || placeAt(id).width === 'auto') values.width = pxValue(b.width);
      return ctx.commit(placeOps(id, values), { label: 'Nudge', merge: 'nudge:' + id });
    }
    const cs = el.ownerDocument.defaultView.getComputedStyle(el);
    const margin = [parseFloat(cs.marginTop) + dy, parseFloat(cs.marginRight), parseFloat(cs.marginBottom), parseFloat(cs.marginLeft) + dx].map(pxValue);
    ctx.commit(placeOps(id, { margin }), { label: 'Nudge', merge: 'nudge:' + id });
  }
  function cancel() {
    if (!active) return false;
    Object.assign(active.el.style, { translate: '', width: '', height: '', minHeight: '', margin: '', justifySelf: '', alignSelf: '', transform: '' });
    active = null;
    canvas.setGesture(null);
    return true;
  }
  return { pointerDown, handleDown, handles, columnHandles, nudge, cancel, get busy() { return !!active; } };
}
