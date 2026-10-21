// Layers panel: the element tree of the current page with rename, hide, lock and drag-to-reorder.
import { escapeHtml as esc } from '/assets/render-v2.mjs';
import { TYPES, label, ancestors, isContainer, isRoot, canDrop, moveOps, listOf } from './tree.mjs';

export function hiddenAt(node, bpIds, bp) {
  let hidden = false;
  for (const id of bpIds.slice(0, bpIds.indexOf(bp) + 1)) if (typeof node.hidden?.[id] === 'boolean') hidden = node.hidden[id];
  return hidden;
}

export function createLayers(root, ctx) {
  const expanded = new Set();
  let drag = null, renaming = null;
  root.innerHTML = '<div class="panel-head"><h2 class="panel-title">Layers</h2></div><div class="layers" role="tree" aria-label="Page layers"></div>';
  const tree = root.querySelector('.layers');

  function rows() {
    const { doc, page, bp, bpIds, selected, index } = ctx.state();
    if (selected) for (const id of ancestors(index, selected).slice(0, -1)) expanded.add(id);
    const out = [];
    const walk = (id, depth, region) => {
      const node = doc.nodes[id];
      if (!node) return;
      const children = node.children || [];
      const open = expanded.has(id);
      const hidden = hiddenAt(node, bpIds, bp);
      const title = region === 'header' ? 'Header' : region === 'footer' ? 'Footer' : label(node);
      const dimmed = (region === 'header' && !page.showHeader) || (region === 'footer' && !page.showFooter);
      out.push('<div class="layer-row' + (id === selected ? ' selected' : '') + (hidden ? ' is-hidden' : '') + (dimmed ? ' is-dimmed' : '') + '" role="treeitem" tabindex="' + (id === selected ? '0' : '-1') + '" aria-level="' + (depth + 1) + '" aria-selected="' + (id === selected) + '"' + (children.length ? ' aria-expanded="' + open + '"' : '') + ' data-id="' + esc(id) + '" draggable="' + (region === 'page' || depth > 0) + '" style="--depth:' + depth + '">'
        + '<button class="layer-toggle" data-toggle tabindex="-1" aria-hidden="true"' + (children.length ? '' : ' disabled') + '>' + (children.length ? (open ? '▾' : '▸') : '') + '</button>'
        + '<span class="layer-icon" aria-hidden="true">' + (TYPES[node.type]?.icon || '•') + '</span>'
        + (renaming === id ? '<input class="layer-rename" value="' + esc(node.name || '') + '" placeholder="' + esc(label(node)) + '" aria-label="Element name">' : '<span class="layer-name">' + esc(title) + '</span>')
        + '<button class="layer-action" data-eye tabindex="-1" title="' + (hidden ? 'Show' : 'Hide') + ' on ' + esc(bp) + '" aria-label="' + (hidden ? 'Show' : 'Hide') + ' ' + esc(title) + '">' + (hidden ? '◌' : '●') + '</button>'
        + '<button class="layer-action" data-lock tabindex="-1" title="' + (node.locked ? 'Unlock' : 'Lock') + '" aria-label="' + (node.locked ? 'Unlock' : 'Lock') + ' ' + esc(title) + '">' + (node.locked ? '🔒' : '🔓') + '</button></div>');
      if (open) for (const child of children) walk(child, depth + 1, 'node');
    };
    if (doc.header) walk(doc.header, 0, 'header');
    for (const id of page.children) walk(id, 0, 'page');
    if (doc.footer) walk(doc.footer, 0, 'footer');
    return out.join('');
  }
  function render() {
    tree.innerHTML = rows() || '<p class="empty">This page has no sections yet. Use Add to create one.</p>';
    const input = tree.querySelector('.layer-rename');
    if (input) { input.focus(); input.select(); }
  }
  const rowOf = event => event.target.closest('.layer-row');
  function finishRename(save) {
    const input = tree.querySelector('.layer-rename');
    const id = renaming; renaming = null;
    if (save && input) ctx.commit([{ path: ['nodes', id, 'name'], value: input.value.trim() || undefined }], { label: 'Rename' });
    render();
  }
  tree.addEventListener('click', event => {
    const row = rowOf(event); if (!row || event.target.closest('.layer-rename')) return;
    const id = row.dataset.id, { doc, bp, bpIds } = ctx.state(), node = doc.nodes[id];
    if (event.target.closest('[data-toggle]')) { expanded.has(id) ? expanded.delete(id) : expanded.add(id); return render(); }
    if (event.target.closest('[data-eye]')) {
      const next = !hiddenAt(node, bpIds, bp);
      return ctx.commit([{ path: ['nodes', id, 'hidden', bp], value: bp === 'desktop' && !next ? undefined : next }], { label: next ? 'Hide' : 'Show' });
    }
    if (event.target.closest('[data-lock]')) return ctx.commit([{ path: ['nodes', id, 'locked'], value: node.locked ? undefined : true }], { label: node.locked ? 'Unlock' : 'Lock' });
    ctx.select(id, { source: 'layers' });
  });
  tree.addEventListener('dblclick', event => { const row = rowOf(event); if (!row || !ctx.editable()) return; renaming = row.dataset.id; render(); });
  tree.addEventListener('keydown', event => {
    if (event.target.classList.contains('layer-rename')) {
      if (event.key === 'Enter') finishRename(true);
      if (event.key === 'Escape') { event.stopPropagation(); finishRename(false); }
      return;
    }
    const row = rowOf(event); if (!row) return;
    const visible = [...tree.querySelectorAll('.layer-row')], position = visible.indexOf(row), id = row.dataset.id;
    if (event.altKey && (event.key === 'ArrowUp' || event.key === 'ArrowDown')) {
      event.preventDefault();
      const { doc, index, pageIndex } = ctx.state(), list = listOf(doc, index, id);
      if (!list) return;
      const at = list.items.indexOf(id), to = event.key === 'ArrowUp' ? at - 1 : at + 2;
      if (to < 0 || to > list.items.length) return;
      ctx.commit(moveOps(doc, index, id, { parent: index.get(id).parent, page: pageIndex, position: to }), { label: 'Reorder' });
      return;
    }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); const next = visible[position + (event.key === 'ArrowDown' ? 1 : -1)]; if (next) ctx.select(next.dataset.id, { source: 'layers' }); }
    if (event.key === 'ArrowRight' && row.hasAttribute('aria-expanded')) { expanded.add(id); render(); }
    if (event.key === 'ArrowLeft') { if (expanded.has(id)) { expanded.delete(id); render(); } else { const parent = ctx.state().index.get(id)?.parent; if (parent) ctx.select(parent, { source: 'layers' }); } }
    if (event.key === 'F2' || event.key === 'Enter') { if (!ctx.editable()) return; event.preventDefault(); renaming = id; render(); }
  });
  tree.addEventListener('focusout', event => { if (event.target.classList.contains('layer-rename') && renaming) finishRename(true); });

  // Drag and drop: top quarter = before, bottom quarter = after, middle of a container = inside.
  const clear = () => tree.querySelectorAll('.drop-before,.drop-after,.drop-inside').forEach(row => row.classList.remove('drop-before', 'drop-after', 'drop-inside'));
  function dropTarget(event) {
    const row = rowOf(event); if (!row || !drag) return null;
    const { doc, index, pageIndex } = ctx.state();
    const overId = row.dataset.id, over = doc.nodes[overId], place = index.get(overId);
    const rect = row.getBoundingClientRect(), ratio = (event.clientY - rect.top) / rect.height;
    const candidates = [];
    if (isContainer(over.type) && !(isRoot(doc.nodes[drag].type))) candidates.push(['inside', { parent: overId, page: pageIndex, position: over.children.length }]);
    if (place.list === 'page' || place.list === 'node') {
      const list = listOf(doc, index, overId), at = list.items.indexOf(overId);
      const before = ['before', { parent: place.parent, page: pageIndex, position: at }], after = ['after', { parent: place.parent, page: pageIndex, position: at + 1 }];
      if (ratio < 0.25 || (!candidates.length && ratio < 0.5)) candidates.unshift(before);
      else if (ratio > 0.75 || !candidates.length) candidates.unshift(after);
    }
    const found = candidates.find(([, target]) => canDrop(doc, index, drag, target) && target.parent !== drag);
    return found ? { row, zone: found[0], target: found[1] } : null;
  }
  tree.addEventListener('dragstart', event => {
    const row = rowOf(event);
    if (!row || !ctx.editable()) { event.preventDefault(); return; }
    drag = row.dataset.id; event.dataTransfer.effectAllowed = 'move'; event.dataTransfer.setData('text/plain', drag);
    row.classList.add('dragging');
  });
  tree.addEventListener('dragover', event => {
    const found = dropTarget(event); clear();
    if (!found) return;
    event.preventDefault(); event.dataTransfer.dropEffect = 'move';
    found.row.classList.add('drop-' + found.zone);
  });
  tree.addEventListener('dragleave', event => { if (!tree.contains(event.relatedTarget)) clear(); });
  tree.addEventListener('drop', event => {
    const found = dropTarget(event); clear();
    if (!found) return;
    event.preventDefault();
    const { doc, index } = ctx.state();
    ctx.commit(moveOps(doc, index, drag, found.target), { label: 'Move' });
    if (found.zone === 'inside') expanded.add(found.target.parent);
  });
  tree.addEventListener('dragend', () => { drag = null; clear(); tree.querySelectorAll('.dragging').forEach(row => row.classList.remove('dragging')); });

  // Selection changes only touch classes, so rows survive between the two clicks of a double-click.
  function updateSelection() {
    const { selected, index } = ctx.state();
    const hiddenAncestor = selected && ancestors(index, selected).slice(0, -1).some(id => !expanded.has(id));
    if (hiddenAncestor || (selected && !tree.querySelector('.layer-row[data-id="' + CSS.escape(selected) + '"]'))) return render();
    for (const row of tree.querySelectorAll('.layer-row')) {
      const on = row.dataset.id === selected;
      row.classList.toggle('selected', on); row.setAttribute('aria-selected', String(on)); row.tabIndex = on ? 0 : -1;
    }
  }
  return {
    render, updateSelection,
    focusSelected() { tree.querySelector('.layer-row.selected')?.focus(); },
    reveal() { tree.querySelector('.layer-row.selected')?.scrollIntoView({ block: 'nearest' }); }
  };
}
