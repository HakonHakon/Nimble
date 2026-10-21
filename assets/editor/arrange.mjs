// Arrange and clipboard actions for one or more selected elements: copy/cut/paste/duplicate,
// paste style, delete, group/ungroup, align/distribute, match size, layer order, lock and hide.
// Every action is one undoable step. `can(action)` drives menus, toolbars and shortcuts.
import { layoutBox, box, gridGeometry, cellAt, cellOrigin, contentBox, pxValue } from './geometry.mjs';
import { isContainer, isRoot, descendants, effective, listOf, label, insertionTarget } from './tree.mjs';
import { hiddenAt } from './layers.mjs';

const CLIPBOARD_KEY = 'nimble-clipboard-v1';
const POSITION_KEYS = ['cell', 'justifySelf', 'alignSelf', 'margin', 'order'];
const ID_PATTERN = /^[a-z][a-z0-9_-]{0,79}$/;

export function createArranger(canvas, transformer, ctx) {
  let memory = null, styleMemory = null;
  const st = () => ctx.state();
  const nodeOf = id => st().doc.nodes[id];
  const parentOf = id => st().index.get(id)?.parent ?? null;
  const selection = () => st().selection.filter(id => nodeOf(id));
  const inPageOrNode = id => ['page', 'node'].includes(st().index.get(id)?.list);
  const siblings = ids => ids.length > 0 && ids.every(id => parentOf(id) === parentOf(ids[0]));
  const freeformGrid = ids => siblings(ids) && parentOf(ids[0]) !== null && transformer.modeOf(parentOf(ids[0])) === 'grid';
  const commit = (ops, text) => ctx.commit(ops.filter(Boolean), { label: text });
  const placeOp = (id, key, value) => ({ path: ['nodes', id, 'place', st().bp, key], value });
  const boxes = ids => ids.map(id => ({ id, b: layoutBox(canvas.element(id)) }));
  const bounds = list => {
    const left = Math.min(...list.map(item => item.b.left)), top = Math.min(...list.map(item => item.b.top));
    return box(left, top, Math.max(...list.map(item => item.b.right)) - left, Math.max(...list.map(item => item.b.bottom)) - top);
  };
  // Outermost selected elements only; children of selected containers come along with them.
  const outermost = ids => ids.filter(id => !ids.some(other => other !== id && descendants(st().doc, other).includes(id)));

  // ---- clipboard ----
  function snapshot(ids) {
    const { doc } = st();
    const roots = outermost(ids).filter(id => inPageOrNode(id));
    const nodes = {};
    for (const id of roots) for (const item of descendants(doc, id)) nodes[item] = structuredClone(doc.nodes[item]);
    return { version: 1, roots, nodes, parent: siblings(roots) ? parentOf(roots[0]) : null };
  }
  function store(data) {
    memory = data;
    try { localStorage.setItem(CLIPBOARD_KEY, JSON.stringify(data)); } catch {}
  }
  function clipboard() {
    try { const stored = JSON.parse(localStorage.getItem(CLIPBOARD_KEY) || 'null'); if (stored?.version === 1) return stored; } catch {}
    return memory;
  }
  function freshId(type, taken) {
    const alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789';
    let id;
    do id = type + '-' + Array.from(crypto.getRandomValues(new Uint8Array(8)), byte => alphabet[byte % alphabet.length]).join('');
    while (taken.has(id));
    taken.add(id);
    return id;
  }
  // Copies the subtrees with new ids, so pasting twice never collides.
  function cloneTree(data, sameParent) {
    const { doc, bpIds } = st();
    const taken = new Set(Object.keys(doc.nodes)), map = new Map();
    for (const [id, item] of Object.entries(data.nodes)) if (ID_PATTERN.test(id) && item?.type) map.set(id, freshId(item.type === 'section' ? 'section' : item.type, taken));
    const nodes = {};
    for (const [oldId, newId] of map) {
      const item = structuredClone(data.nodes[oldId]);
      item.id = newId;
      if (item.children) item.children = item.children.map(child => map.get(child)).filter(Boolean);
      // Keep only breakpoints this site has.
      for (const group of ['layout', 'place', 'style', 'hidden']) if (item[group]) for (const bp of Object.keys(item[group])) if (!bpIds.includes(bp)) delete item[group][bp];
      delete item.locked;
      nodes[newId] = item;
    }
    const roots = data.roots.map(id => map.get(id)).filter(Boolean);
    for (const id of roots) {
      const item = nodes[id];
      if (!item.place) continue;
      if (!sameParent) {
        for (const bp of Object.keys(item.place)) {
          item.place[bp] = Object.fromEntries(Object.entries(item.place[bp]).filter(([key]) => !POSITION_KEYS.includes(key)));
          if (!Object.keys(item.place[bp]).length) delete item.place[bp];
        }
        if (!Object.keys(item.place).length) delete item.place;
      } else {
        // Offset copies in the same freeform grid so they don't sit exactly on the original.
        for (const values of Object.values(item.place)) {
          if (!Array.isArray(values.margin) || values.justifySelf !== 'start') continue;
          values.margin = values.margin.map((value, i) => (i === 0 || i === 3) && /px$/.test(value) ? (parseFloat(value) + 20) + 'px' : value);
        }
      }
    }
    return { roots, nodes };
  }
  function insertOps(roots, nodes, target) {
    const { doc, page } = st();
    const list = target.parent === null ? page.children : doc.nodes[target.parent].children;
    const next = list.slice();
    next.splice(Math.min(target.position, next.length), 0, ...roots);
    return [...Object.entries(nodes).map(([id, item]) => ({ path: ['nodes', id], value: item })), { path: target.parent === null ? ['pages', target.page, 'children'] : ['nodes', target.parent, 'children'], value: next }];
  }
  function pasteTarget(data) {
    const { doc, index, page, selected } = st();
    const sections = data.roots.every(id => isRoot(data.nodes[id]?.type));
    if (sections !== data.roots.some(id => isRoot(data.nodes[id]?.type))) return null;
    return insertionTarget(doc, index, page, selected, sections ? 'section' : 'container');
  }
  function paste(data = clipboard(), { sameSpot = false } = {}) {
    if (!data?.roots?.length) return ctx.toast('The clipboard is empty.');
    const target = pasteTarget(data);
    if (!target) return ctx.toast('Select a section or container to paste into.');
    const { roots, nodes } = cloneTree(data, sameSpot || target.parent === data.parent);
    if (commit(insertOps(roots, nodes, target), roots.length > 1 ? 'Paste ' + roots.length + ' elements' : 'Paste')) ctx.selectMany(roots);
  }
  function duplicate() {
    const ids = outermost(selection()).filter(inPageOrNode);
    if (!ids.length) return;
    const data = snapshot(ids);
    const { pageIndex } = st(), list = listOf(st().doc, st().index, ids[ids.length - 1]);
    const target = { parent: parentOf(ids[0]), page: pageIndex, position: list.items.indexOf(ids[ids.length - 1]) + 1 };
    if (!siblings(ids)) return paste(data);
    const { roots, nodes } = cloneTree(data, true);
    if (commit(insertOps(roots, nodes, target), 'Duplicate')) ctx.selectMany(roots);
  }
  function removeOps(ids) {
    const { doc, index } = st();
    const ops = [], lists = new Map();
    for (const id of outermost(ids).filter(inPageOrNode)) {
      const list = listOf(doc, index, id), key = list.path.join('/');
      if (!lists.has(key)) lists.set(key, { path: list.path, items: list.items.slice() });
      lists.get(key).items = lists.get(key).items.filter(item => item !== id);
      for (const item of descendants(doc, id)) ops.push({ path: ['nodes', item], value: undefined });
    }
    return [...[...lists.values()].map(list => ({ path: list.path, value: list.items })), ...ops];
  }
  function remove() {
    const ids = selection();
    if (!ids.some(inPageOrNode)) return ctx.toast('Headers and footers can be hidden per page, not deleted.');
    const first = ids[0], list = listOf(st().doc, st().index, first), remaining = list?.items.filter(item => !ids.includes(item)) || [];
    const next = remaining[Math.min(list?.items.indexOf(first) ?? 0, remaining.length - 1)] || parentOf(first);
    if (commit(removeOps(ids), ids.length > 1 ? 'Delete ' + ids.length + ' elements' : 'Delete ' + label(nodeOf(first)))) ctx.select(next || null);
  }

  // ---- group / ungroup (structure changes are measured on desktop) ----
  function group() {
    const ids = outermost(selection());
    const parent = parentOf(ids[0]);
    const { doc } = st();
    const children = doc.nodes[parent].children;
    const ordered = children.filter(id => ids.includes(id));
    const taken = new Set(Object.keys(doc.nodes));
    const groupId = freshId('container', taken);
    const position = children.indexOf(ordered[0]);
    const remaining = children.filter(id => !ids.includes(id));
    remaining.splice(position, 0, groupId);
    const ops = [{ path: ['nodes', parent, 'children'], value: remaining }];
    const grid = transformer.modeOf(parent) === 'grid';
    let groupNode;
    if (grid) {
      const items = boxes(ordered), all = bounds(items);
      const geo = gridGeometry(canvas.element(parent));
      const firstCell = effective(nodeOf(ordered[0]).place, st().bpIds, 'desktop').cell;
      const cell = firstCell ? { row: firstCell[0], col: firstCell[1] } : cellAt(geo, all.cx, all.cy);
      const origin = cellOrigin(geo, cell.row, cell.col);
      // Freeform positions only make sense at desktop width: below it the group becomes a simple stack.
      const smaller = st().bpIds[1];
      groupNode = { id: groupId, type: 'container', name: 'Group', children: ordered, layout: { desktop: { mode: 'grid', columns: ['1fr'] }, ...(smaller ? { [smaller]: { mode: 'stack', direction: 'column', align: 'start', rowGap: '16px' } } : {}) },
        place: { desktop: { cell: [cell.row, cell.col, 1, 1], justifySelf: 'start', alignSelf: 'start', margin: [pxValue(all.top - origin.top), '0px', '0px', pxValue(all.left - origin.left)], width: pxValue(all.width) }, ...(smaller ? { [smaller]: { justifySelf: 'stretch', margin: ['0px', '0px', '0px', '0px'], width: 'auto' } } : {}) } };
      for (const { id, b } of items) {
        const place = structuredClone(nodeOf(id).place || {});
        for (const bp of Object.keys(place)) { for (const key of POSITION_KEYS) delete place[bp][key]; if (!Object.keys(place[bp]).length) delete place[bp]; }
        const desktop = place.desktop || {};
        place.desktop = { ...desktop, cell: [1, 1, 1, 1], justifySelf: 'start', alignSelf: 'start', margin: [pxValue(b.top - all.top), '0px', '0px', pxValue(b.left - all.left)], ...(!desktop.width || desktop.width === 'auto' ? { width: pxValue(b.width) } : {}) };
        if (smaller) place[smaller] = { ...(place[smaller] || {}), margin: ['0px', '0px', '0px', '0px'], maxWidth: '100%' };
        ops.push({ path: ['nodes', id, 'place'], value: place });
      }
    } else {
      const layout = effective(doc.nodes[parent].layout, st().bpIds, 'desktop');
      groupNode = { id: groupId, type: 'container', name: 'Group', children: ordered, layout: { desktop: { mode: 'stack', direction: layout.direction || 'column', align: layout.align || 'start', ...(layout.rowGap ? { rowGap: layout.rowGap } : {}), ...(layout.columnGap ? { columnGap: layout.columnGap } : {}) } } };
      for (const id of ordered) {
        const place = structuredClone(nodeOf(id).place || {});
        for (const bp of Object.keys(place)) { delete place[bp].order; if (!Object.keys(place[bp]).length) delete place[bp]; }
        ops.push({ path: ['nodes', id, 'place'], value: Object.keys(place).length ? place : undefined });
      }
    }
    ops.unshift({ path: ['nodes', groupId], value: groupNode });
    if (commit(ops, 'Group ' + ordered.length + ' elements')) ctx.select(groupId);
  }
  function ungroup() {
    const id = st().selected, groupNode = nodeOf(id), parent = parentOf(id);
    const { doc } = st();
    const children = groupNode.children.slice();
    const list = doc.nodes[parent].children.slice(), position = list.indexOf(id);
    list.splice(position, 1, ...children);
    const ops = [{ path: ['nodes', parent, 'children'], value: list }];
    if (transformer.modeOf(parent) === 'grid') {
      const geo = gridGeometry(canvas.element(parent));
      const groupCell = effective(groupNode.place, st().bpIds, 'desktop').cell;
      const b0 = layoutBox(canvas.element(id));
      const cell = groupCell ? { row: groupCell[0], col: groupCell[1] } : cellAt(geo, b0.cx, b0.cy);
      const origin = cellOrigin(geo, cell.row, cell.col);
      for (const { id: child, b } of boxes(children)) {
        const place = structuredClone(nodeOf(child).place || {});
        for (const bp of Object.keys(place)) { for (const key of POSITION_KEYS) delete place[bp][key]; if (!Object.keys(place[bp]).length) delete place[bp]; }
        const desktop = place.desktop || {};
        place.desktop = { ...desktop, cell: [cell.row, cell.col, groupCell?.[2] || 1, groupCell?.[3] || 1], justifySelf: 'start', alignSelf: 'start', margin: [pxValue(b.top - origin.top), '0px', '0px', pxValue(b.left - origin.left)], ...(!desktop.width || desktop.width === 'auto' ? { width: pxValue(b.width) } : {}) };
        ops.push({ path: ['nodes', child, 'place'], value: place });
      }
    } else {
      for (const child of children) {
        const place = structuredClone(nodeOf(child).place || {});
        for (const bp of Object.keys(place)) { for (const key of POSITION_KEYS) delete place[bp][key]; if (!Object.keys(place[bp]).length) delete place[bp]; }
        ops.push({ path: ['nodes', child, 'place'], value: Object.keys(place).length ? place : undefined });
      }
    }
    ops.push({ path: ['nodes', id], value: undefined });
    if (commit(ops, 'Ungroup')) ctx.selectMany(children);
  }

  // ---- align, distribute, match size ----
  function align(edge) {
    const ids = selection(), items = boxes(ids);
    const frame = ids.length === 1 ? contentBox(canvas.element(parentOf(ids[0]))) : bounds(items);
    const ops = [];
    for (const { id, b } of items) {
      let left = b.left, top = b.top;
      if (edge === 'left') left = frame.left;
      if (edge === 'center') left = frame.cx - b.width / 2;
      if (edge === 'right') left = frame.right - b.width;
      if (edge === 'top') top = frame.top;
      if (edge === 'middle') top = frame.cy - b.height / 2;
      if (edge === 'bottom') top = frame.bottom - b.height;
      for (const [key, value] of Object.entries(transformer.placeValues(id, box(left, top, b.width, b.height)))) ops.push(placeOp(id, key, value));
    }
    commit(ops, 'Align ' + edge);
  }
  function distribute(axis) {
    const items = boxes(selection());
    const [start, size] = axis === 'x' ? ['left', 'width'] : ['top', 'height'];
    items.sort((a, b) => a.b[start] - b.b[start]);
    const first = items[0].b[start], last = items[items.length - 1].b[start] + items[items.length - 1].b[size];
    const gap = (last - first - items.reduce((sum, item) => sum + item.b[size], 0)) / (items.length - 1);
    let at = first;
    const ops = [];
    for (const { id, b } of items) {
      const next = axis === 'x' ? box(at, b.top, b.width, b.height) : box(b.left, at, b.width, b.height);
      for (const [key, value] of Object.entries(transformer.placeValues(id, next))) ops.push(placeOp(id, key, value));
      at += b[size] + gap;
    }
    commit(ops, axis === 'x' ? 'Distribute horizontally' : 'Distribute vertically');
  }
  function matchSize(dimension) {
    const primary = layoutBox(canvas.element(st().selected));
    const ops = [];
    for (const id of selection()) {
      if (dimension !== 'height') ops.push(placeOp(id, 'width', pxValue(primary.width)));
      if (dimension !== 'width') ops.push(placeOp(id, 'height', pxValue(primary.height)));
    }
    commit(ops, 'Match ' + dimension);
  }

  // ---- layer order (document order among siblings) ----
  function order(direction) {
    const ids = selection(), parent = parentOf(ids[0]);
    const list = st().doc.nodes[parent].children.slice();
    const chosen = list.filter(id => ids.includes(id)), rest = list.filter(id => !ids.includes(id));
    let next;
    if (direction === 'front') next = [...rest, ...chosen];
    else if (direction === 'back') next = [...chosen, ...rest];
    else {
      next = list.slice();
      const step = direction === 'forward' ? 1 : -1;
      const sequence = step === 1 ? [...chosen].reverse() : chosen;
      for (const id of sequence) {
        const at = next.indexOf(id), swap = at + step;
        if (swap < 0 || swap >= next.length || ids.includes(next[swap])) continue;
        [next[at], next[swap]] = [next[swap], next[at]];
      }
    }
    commit([{ path: ['nodes', parent, 'children'], value: next }], { front: 'Bring to front', back: 'Send to back', forward: 'Bring forward', backward: 'Send backward' }[direction]);
  }

  // ---- lock, hide, style ----
  function toggleLock() {
    const ids = selection(), lock = !nodeOf(st().selected).locked;
    commit(ids.map(id => ({ path: ['nodes', id, 'locked'], value: lock ? true : undefined })), lock ? 'Lock' : 'Unlock');
  }
  function toggleHide() {
    const { bp, bpIds } = st(), ids = selection();
    const hide = !hiddenAt(nodeOf(st().selected), bpIds, bp);
    commit(ids.map(id => ({ path: ['nodes', id, 'hidden', bp], value: bp === 'desktop' && !hide ? undefined : hide })), hide ? 'Hide' : 'Show');
  }
  function copyStyle() { styleMemory = { type: nodeOf(st().selected).type, style: structuredClone(nodeOf(st().selected).style || null) }; ctx.toast('Design copied.'); }
  function pasteStyle() {
    if (!styleMemory) return ctx.toast('Copy a design first (Ctrl+Alt+C).');
    commit(selection().map(id => ({ path: ['nodes', id, 'style'], value: structuredClone(styleMemory.style) ?? undefined })), 'Paste design');
  }
  function selectAll() {
    const { selected, page } = st();
    const parent = selected ? parentOf(selected) : null;
    ctx.selectMany(parent ? nodeOf(parent).children.slice() : page.children.slice());
  }

  // ---- availability ----
  function can(action) {
    const ids = selection(), editable = ctx.editable();
    const one = ids.length === 1, many = ids.length > 1;
    const movableAll = ids.length > 0 && ids.every(id => transformer.movable(id));
    const desktop = st().bp === 'desktop';
    switch (action) {
      case 'copy': return ids.some(inPageOrNode);
      case 'cut': case 'delete': case 'duplicate': return editable && ids.some(inPageOrNode);
      case 'paste': return editable && !!clipboard()?.roots?.length;
      case 'copyStyle': return one;
      case 'pasteStyle': return editable && ids.length > 0 && !!styleMemory;
      case 'group': return editable && desktop && many && siblings(outermost(ids)) && outermost(ids).length > 1 && parentOf(ids[0]) !== null && movableAll;
      case 'ungroup': return editable && desktop && one && isContainer(nodeOf(ids[0]).type) && !isRoot(nodeOf(ids[0]).type) && nodeOf(ids[0]).children.length > 0 && movableAll && !!parentOf(ids[0]);
      case 'align': return editable && movableAll && freeformGrid(ids);
      case 'distribute': return editable && movableAll && ids.length >= 3 && freeformGrid(ids);
      case 'match': return editable && many && movableAll && siblings(ids);
      case 'order': return editable && ids.length > 0 && siblings(ids) && parentOf(ids[0]) !== null && transformer.modeOf(parentOf(ids[0])) === 'grid';
      case 'lock': case 'hide': return editable && ids.length > 0;
      case 'selectAll': return true;
      default: return false;
    }
  }
  const actions = {
    copy: () => { store(snapshot(selection())); ctx.toast(selection().length > 1 ? selection().length + ' elements copied.' : 'Copied.'); },
    cut: () => { store(snapshot(selection())); remove(); },
    paste: () => paste(),
    duplicate, delete: remove, copyStyle, pasteStyle, group, ungroup, selectAll,
    alignLeft: () => align('left'), alignCenter: () => align('center'), alignRight: () => align('right'),
    alignTop: () => align('top'), alignMiddle: () => align('middle'), alignBottom: () => align('bottom'),
    distributeX: () => distribute('x'), distributeY: () => distribute('y'),
    matchWidth: () => matchSize('width'), matchHeight: () => matchSize('height'), matchSize: () => matchSize('both'),
    front: () => order('front'), forward: () => order('forward'), backward: () => order('backward'), back: () => order('back'),
    lock: toggleLock, hide: toggleHide
  };
  const needs = { alignLeft: 'align', alignCenter: 'align', alignRight: 'align', alignTop: 'align', alignMiddle: 'align', alignBottom: 'align', distributeX: 'distribute', distributeY: 'distribute', matchWidth: 'match', matchHeight: 'match', matchSize: 'match', front: 'order', forward: 'order', backward: 'order', back: 'order' };
  const available = action => can(needs[action] || action);
  function run(action) {
    if (!actions[action]) return false;
    if (!available(action)) {
      if ((action === 'group' || action === 'ungroup') && st().bp !== 'desktop') ctx.toast('Switch to Desktop to group or ungroup.');
      return false;
    }
    actions[action]();
    return true;
  }
  return { run, available, clipboard };
}
