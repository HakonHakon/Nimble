// Layout tab: visual controls for container layout (grid editor, stack controls, gaps, padding,
// section width and height) and for the selected element's placement (docking, grid cell, size, margin).
// Every value is written to the current breakpoint only; inherited values show as placeholders.
import { escapeHtml as esc } from '/assets/render-v2.mjs';
import { effective, label, isRoot } from './tree.mjs';

const SIDES = ['Top', 'Right', 'Bottom', 'Left'];
const LENGTH_UNITS = ['px', '%', 'vw', 'vh', 'rem', 'em'];
const TRACK_UNITS = ['fr', 'px', '%', 'auto'];
const COLUMN_PRESETS = [['1', ['1fr']], ['2', ['1fr', '1fr']], ['3', ['1fr', '1fr', '1fr']], ['4', ['1fr', '1fr', '1fr', '1fr']], ['1:2', ['1fr', '2fr']], ['2:1', ['2fr', '1fr']], ['Auto-fit', ['repeat(auto-fit,minmax(220px,1fr))']]];
const JUSTIFY = [['start', '⇤', 'Start'], ['center', '↔', 'Centre'], ['end', '⇥', 'End'], ['space-between', '⇹', 'Space between'], ['space-around', '⟷', 'Space around'], ['space-evenly', '≡', 'Space evenly']];
const ALIGN = [['start', '⤒', 'Start'], ['center', '⇕', 'Centre'], ['end', '⤓', 'End'], ['stretch', '↕', 'Stretch'], ['baseline', 'ab', 'Baseline']];

export function parseLength(value) {
  if (value === undefined || value === null || value === '') return null;
  if (value === 'auto') return { auto: true };
  const match = String(value).match(/^(-?\d+(?:\.\d+)?)(px|%|vw|vh|rem|em|fr)$/);
  return match ? { n: Number(match[1]), u: match[2] } : { raw: String(value) };
}
// "24" → "24px", "50%" stays, "auto" stays; empty → undefined.
export function toLength(text, unit = 'px', { allowAuto = false } = {}) {
  const value = String(text ?? '').trim();
  if (!value) return undefined;
  if (value === 'auto') return allowAuto ? 'auto' : undefined;
  if (/^-?\d+(\.\d+)?$/.test(value)) return value + unit;
  return value;
}

export function createLayoutPanel(ctx) {
  // Explicit link choices per box; otherwise sides count as linked when they are all equal.
  const linkChoice = new Map();
  const equalNow = new Map();
  const linked = { has: name => linkChoice.has(name) ? linkChoice.get(name) : name !== 'gap' && !!equalNow.get(name) };
  let limitsOpen = false;

  const st = () => ctx.state();
  const bpIdsUpTo = (bp, offset = 0) => { const { bpIds } = st(); return bpIds.slice(0, bpIds.indexOf(bp) + 1 + offset); };
  const eff = (node, group) => effective(node[group], st().bpIds, st().bp);
  const inherited = (node, group, key) => {
    const { bp, bpIds } = st();
    if (bp === 'desktop') return undefined;
    return effective(node[group], bpIds, bpIds[bpIds.indexOf(bp) - 1])[key];
  };
  const own = (node, group, key) => node[group]?.[st().bp]?.[key];
  const op = (id, group, key, value) => ({ path: ['nodes', id, group, st().bp, key], value });

  // ---- small widgets ----
  function row(node, group, key, title, body, { keys = [key], hint = '' } = {}) {
    const has = keys.some(item => own(node, group, item) !== undefined);
    return '<div class="lp-row' + (has ? ' has-own' : '') + '" data-g="' + group + '" data-k="' + keys.join(',') + '"><div class="lp-head"><span class="lp-label">' + esc(title) + '</span>'
      + (has ? '<button class="reset" data-lp-reset title="' + (st().bp === 'desktop' ? 'Clear' : 'Reset to inherited') + '" aria-label="Reset ' + esc(title) + '">×</button>' : '') + '</div>' + body + (hint ? '<p class="lp-hint">' + hint + '</p>' : '') + '</div>';
  }
  function segmented(name, options, current, extra = '') {
    return '<div class="seg" role="group">' + options.map(([value, icon, title]) => '<button data-lp-set="' + name + '" data-value="' + esc(value) + '" aria-pressed="' + (current === value) + '" title="' + esc(title || value) + '"' + extra + '>' + esc(icon) + '</button>').join('') + '</div>';
  }
  function lengthInput(name, value, placeholder, { units = LENGTH_UNITS, auto = false, autoLabel = 'auto' } = {}) {
    const parsed = parseLength(value), ph = parseLength(placeholder);
    const unit = parsed?.auto ? 'auto' : parsed?.u || (ph?.auto ? 'auto' : ph?.u) || units[0];
    const number = parsed?.n ?? (parsed?.raw ?? '');
    const phText = ph?.auto ? autoLabel : ph?.n ?? ph?.raw ?? '';
    return '<span class="len"><input data-lp-len="' + name + '" value="' + esc(number) + '" placeholder="' + esc(phText) + '" inputmode="decimal" aria-label="' + esc(name) + '"' + (unit === 'auto' ? ' disabled' : '') + '>'
      + '<select data-lp-unit="' + name + '" aria-label="' + esc(name) + ' unit">' + [...units, ...(auto ? ['auto'] : [])].map(item => '<option' + (item === unit ? ' selected' : '') + '>' + item + '</option>').join('') + '</select></span>';
  }
  function boxInput(name, values, placeholders, { signed = false, auto = false } = {}) {
    const shown = values || placeholders;
    equalNow.set(name, !!shown && shown.every(item => item === shown[0]));
    const isLinked = linked.has(name);
    const cell = (i, area) => '<input class="box-' + area + '" data-lp-box="' + name + '" data-side="' + i + '" value="' + esc(values?.[i] ?? '') + '" placeholder="' + esc(placeholders?.[i] ?? '0px') + '" aria-label="' + esc(name + ' ' + SIDES[i]) + '" title="' + SIDES[i] + (auto ? ' (number, unit or auto)' : '') + '">';
    return '<div class="boxer' + (signed ? ' signed' : '') + '">' + cell(0, 't') + cell(3, 'l') + '<button class="box-link" data-lp-link="' + name + '" aria-pressed="' + isLinked + '" title="' + (isLinked ? 'Sides linked' : 'Sides independent') + '">' + (isLinked ? '🔗' : '⛓') + '</button>' + cell(1, 'r') + cell(2, 'b') + '</div>';
  }
  function trackEditor(axis, tracks, inheritedTracks) {
    const list = tracks || inheritedTracks || (axis === 'rows' ? [] : ['1fr']);
    const items = list.map((track, i) => {
      const parsed = parseLength(track);
      const unit = parsed?.auto ? 'auto' : parsed?.u && TRACK_UNITS.includes(parsed.u) ? parsed.u : 'custom';
      return '<div class="track"><span class="track-index">' + (i + 1) + '</span>'
        + (unit === 'custom' ? '<input data-lp-track="' + axis + '" data-i="' + i + '" data-raw value="' + esc(track) + '" aria-label="' + axis + ' ' + (i + 1) + '" spellcheck="false">'
          : '<input data-lp-track="' + axis + '" data-i="' + i + '" value="' + esc(parsed?.n ?? '') + '"' + (unit === 'auto' ? ' disabled' : '') + ' inputmode="decimal" aria-label="' + axis + ' ' + (i + 1) + ' size">'
            + '<select data-lp-track-unit="' + axis + '" data-i="' + i + '" aria-label="' + axis + ' ' + (i + 1) + ' unit">' + TRACK_UNITS.map(item => '<option' + (item === unit ? ' selected' : '') + '>' + item + '</option>').join('') + '</select>')
        + '<button class="icon-btn" data-lp-track-remove="' + axis + '" data-i="' + i + '" title="Remove" aria-label="Remove ' + axis + ' ' + (i + 1) + '"' + (axis === 'columns' && list.length < 2 ? ' disabled' : '') + '>−</button></div>';
    }).join('');
    return '<div class="tracks">' + (items || '<p class="lp-hint">Rows size to their content.</p>') + '<button class="btn btn-small" data-lp-track-add="' + axis + '">+ ' + (axis === 'columns' ? 'Column' : 'Row') + '</button></div>';
  }
  function gridPreview(node, columns, rows) {
    const { doc, bpIds, bp } = st();
    const colCount = Math.max(1, columns.length), rowCount = Math.max(1, rows.length);
    const template = columns.map(track => /fr$/.test(track) ? track : /^repeat/.test(track) ? '1fr' : 'minmax(18px,auto)').join(' ');
    const cells = Array.from({ length: colCount * rowCount }, (_, i) => '<i style="grid-area:' + (Math.floor(i / colCount) + 1) + '/' + (i % colCount + 1) + '"></i>').join('');
    const children = node.children.map(child => {
      const cell = effective(doc.nodes[child].place, bpIds, bp).cell;
      if (!cell) return '';
      return '<b data-lp-pick="' + esc(child) + '" style="grid-area:' + cell[0] + '/' + cell[1] + '/span ' + cell[2] + '/span ' + cell[3] + '" title="' + esc(label(doc.nodes[child])) + '">' + esc(label(doc.nodes[child]).slice(0, 14)) + '</b>';
    }).join('');
    return '<div class="grid-preview" style="grid-template-columns:' + esc(template) + ';grid-template-rows:repeat(' + rowCount + ',minmax(26px,auto))">' + cells + children + '</div>';
  }

  // ---- container section ----
  const rowFor = (node, key, title, body) => row(node, 'layout', key, title, body);
  function containerHtml(node) {
    const layout = eff(node, 'layout'), mode = layout.mode || 'grid', section = isRoot(node.type);
    let html = '<h3>' + (section ? 'Section' : 'Container') + ' layout</h3>';
    html += row(node, 'layout', 'mode', 'Arrange items', segmented('mode', [['grid', '▦ Grid', 'Grid: place items in cells, freely positioned'], ['stack', '☰ Stack', 'Stack: items flow one after another']], mode));
    if (mode === 'grid') {
      const columns = layout.columns || ['1fr'], rows = layout.rows || [];
      html += row(node, 'layout', 'columns', 'Columns', '<div class="presets">' + COLUMN_PRESETS.map(([name, value]) => '<button class="chip" data-lp-preset="' + esc(JSON.stringify(value)) + '" aria-pressed="' + (JSON.stringify(columns) === JSON.stringify(value)) + '">' + name + '</button>').join('') + '</div>' + trackEditor('columns', own(node, 'layout', 'columns'), inherited(node, 'layout', 'columns') || ['1fr']));
      html += row(node, 'layout', 'rows', 'Rows', trackEditor('rows', own(node, 'layout', 'rows'), inherited(node, 'layout', 'rows')));
      html += '<div class="lp-row"><div class="lp-head"><span class="lp-label">Preview</span></div>' + gridPreview(node, columns, rows) + '</div>';
      html += row(node, 'layout', 'justify', 'Align items horizontally', segmented('justify', JUSTIFY.slice(0, 3).concat([['stretch', '↔', 'Stretch']]), layout.justify));
      html += row(node, 'layout', 'align', 'Align items vertically', segmented('align', ALIGN.slice(0, 4), layout.align));
    } else {
      html += row(node, 'layout', 'direction', 'Direction', segmented('direction', [['column', '↓ Vertical', 'Top to bottom'], ['row', '→ Horizontal', 'Left to right']], layout.direction || 'column'));
      html += row(node, 'layout', 'wrap', 'Wrap', segmented('wrap', [['false', 'No wrap'], ['true', 'Wrap']], String(!!layout.wrap)));
      // Icons follow the axis: the main axis runs along the stack direction.
      const isRow = layout.direction === 'row';
      const vertical = { start: '⤒', center: '⇕', end: '⤓', stretch: '↕' }, horizontal = { start: '⇤', center: '↔', end: '⇥', stretch: '⟷' };
      const withIcons = (list, icons) => list.map(([value, icon, title]) => [value, icons[value] || icon, title]);
      html += rowFor(node, 'justify', isRow ? 'Distribute horizontally' : 'Distribute vertically', segmented('justify', withIcons(JUSTIFY, isRow ? horizontal : vertical), layout.justify || 'start'));
      html += rowFor(node, 'align', isRow ? 'Align vertically' : 'Align horizontally', segmented('align', withIcons(ALIGN, isRow ? vertical : horizontal), layout.align || 'stretch'));
    }
    const gapLinked = linked.has('gap');
    html += row(node, 'layout', 'rowGap', 'Gap', '<div class="pair gap-pair"><label>Rows ' + lengthInput('rowGap', own(node, 'layout', 'rowGap'), inherited(node, 'layout', 'rowGap') || '0px') + '</label><button class="box-link" data-lp-link="gap" aria-pressed="' + gapLinked + '" title="Link row and column gap">' + (gapLinked ? '🔗' : '⛓') + '</button><label>Columns ' + lengthInput('columnGap', own(node, 'layout', 'columnGap'), inherited(node, 'layout', 'columnGap') || '0px') + '</label></div>', { keys: ['rowGap', 'columnGap'] });
    html += row(node, 'layout', 'padding', 'Padding', boxInput('padding', own(node, 'layout', 'padding'), inherited(node, 'layout', 'padding')));
    if (section) {
      const width = layout.contentWidth && layout.contentWidth !== 'auto' ? 'boxed' : 'full';
      html += row(node, 'layout', 'contentWidth', 'Content width', segmented('sectionWidth', [['full', 'Full width', 'Content uses the whole section'], ['boxed', 'Boxed', 'Content stays centred within a maximum width']], width)
        + (width === 'boxed' ? lengthInput('contentWidth', own(node, 'layout', 'contentWidth'), inherited(node, 'layout', 'contentWidth') || '1022px', { units: ['px', '%', 'vw', 'rem'] }) : ''),
        { hint: 'The background always spans the full page width.' });
      html += row(node, 'layout', 'minHeight', 'Height', '<div class="presets">' + [['auto', 'Fit content'], ['50vh', 'Half screen'], ['100vh', 'Full screen']].map(([value, text]) => '<button class="chip" data-lp-height="' + value + '" aria-pressed="' + ((layout.minHeight || 'auto') === value) + '">' + text + '</button>').join('') + '</div>'
        + lengthInput('minHeight', own(node, 'layout', 'minHeight'), inherited(node, 'layout', 'minHeight') || 'auto', { units: ['px', 'vh'], auto: true, autoLabel: 'fit' }));
    } else {
      html += row(node, 'layout', 'minHeight', 'Min height', lengthInput('minHeight', own(node, 'layout', 'minHeight'), inherited(node, 'layout', 'minHeight') || 'auto', { units: ['px', 'vh', '%'], auto: true }));
    }
    return html;
  }

  // ---- placement section ----
  function placementHtml(node, parent) {
    const parentLayout = effective(parent.layout, st().bpIds, st().bp), parentMode = parentLayout.mode || 'grid';
    const place = eff(node, 'place');
    let html = '<h3>Position in ' + (parentMode === 'stack' ? 'stack' : 'grid') + ' <button class="crumb-link" data-lp-pick="' + esc(parent.id) + '">' + esc(label(parent)) + '</button></h3>';
    if (parentMode === 'grid') {
      // Without an own value an element follows the grid's item alignment.
      const h = place.justifySelf || (['start', 'center', 'end'].includes(parentLayout.justify) ? parentLayout.justify : 'stretch'), v = place.alignSelf || (['start', 'center', 'end'].includes(parentLayout.align) ? parentLayout.align : 'stretch');
      const dock = ['start', 'center', 'end'].flatMap(vv => ['start', 'center', 'end'].map(hh => '<button data-lp-dock="' + hh + ',' + vv + '" aria-pressed="' + (h === hh && v === vv) + '" title="Dock ' + vv + ' ' + hh + '"></button>')).join('');
      html += row(node, 'place', 'justifySelf', 'Docking', '<div class="dock-row"><div class="dock">' + dock + '</div><div class="dock-stretch">'
        + '<button class="chip" data-lp-stretch="h" aria-pressed="' + (h === 'stretch') + '">↔ Stretch width</button><button class="chip" data-lp-stretch="v" aria-pressed="' + (v === 'stretch') + '">↕ Stretch height</button></div></div>',
        { keys: ['justifySelf', 'alignSelf'], hint: 'Margins are measured from the docked edge. Docking resets them.' });
      const cell = own(node, 'place', 'cell'), cellPh = inherited(node, 'place', 'cell');
      const columns = (parentLayout.columns || ['1fr']).length;
      html += row(node, 'place', 'cell', 'Grid cell', '<div class="cell-grid">' + [['Row', 0], ['Column', 1], ['Row span', 2], ['Column span', 3]].map(([title, i]) => '<label>' + title + '<input type="number" min="1" max="48" data-lp-cell="' + i + '" value="' + esc(cell?.[i] ?? '') + '" placeholder="' + esc(cellPh?.[i] ?? (i > 1 ? 1 : 'auto')) + '"></label>').join('') + '</div>'
        + '<button class="chip" data-lp-span-all="' + columns + '">Span all ' + columns + ' columns</button>');
    } else {
      const horizontal = (parentLayout.direction || 'column') === 'row';
      html += row(node, 'place', 'alignSelf', horizontal ? 'Align vertically' : 'Align horizontally', segmented('alignSelf', [['start', horizontal ? '⤒' : '⇤', 'Start'], ['center', horizontal ? '⇕' : '↔', 'Centre'], ['end', horizontal ? '⤓' : '⇥', 'End'], ['stretch', horizontal ? '↕' : '↔︎', 'Stretch']], place.alignSelf));
      html += row(node, 'place', 'order', 'Order', '<input type="number" min="-999" max="999" data-lp-num="order" value="' + esc(own(node, 'place', 'order') ?? '') + '" placeholder="' + esc(inherited(node, 'place', 'order') ?? 'as in Layers') + '">', { hint: st().bp === 'desktop' ? 'Drag in Layers or on the canvas to change the order.' : 'Changes the order on this screen size only.' });
    }
    const full = place.width === '100%' || (parentMode === 'grid' && place.justifySelf === 'stretch' && (!place.width || place.width === 'auto'));
    html += row(node, 'place', 'width', 'Size', '<div class="size-grid"><label>W ' + lengthInput('width', own(node, 'place', 'width'), inherited(node, 'place', 'width') || 'auto', { auto: true }) + '</label>'
      + '<label>H ' + lengthInput('height', own(node, 'place', 'height'), inherited(node, 'place', 'height') || 'auto', { auto: true }) + '</label></div>'
      + '<button class="chip" data-lp-full aria-pressed="' + full + '">' + (full ? '✓ ' : '') + 'Stretch to full width</button>', { keys: ['width', 'height'] });
    html += '<details class="limits"' + (limitsOpen ? ' open' : '') + '><summary>Size limits</summary>' + ['minWidth', 'maxWidth', 'minHeight', 'maxHeight'].map(key => row(node, 'place', key, { minWidth: 'Min width', maxWidth: 'Max width', minHeight: 'Min height', maxHeight: 'Max height' }[key], lengthInput(key, own(node, 'place', key), inherited(node, 'place', key) || (key.startsWith('max') ? 'none' : 'auto'), { auto: true, autoLabel: key.startsWith('max') ? 'none' : 'auto' }))).join('') + '</details>';
    html += row(node, 'place', 'margin', 'Margin', boxInput('margin', own(node, 'place', 'margin'), inherited(node, 'place', 'margin'), { signed: true, auto: true }));
    html += '<div class="pair">' + row(node, 'place', 'rotate', 'Rotation', '<span class="len"><input type="number" min="-360" max="360" data-lp-num="rotate" value="' + esc(own(node, 'place', 'rotate') ?? '') + '" placeholder="' + esc(inherited(node, 'place', 'rotate') ?? 0) + '"><span class="unit">°</span></span>')
      + row(node, 'place', 'z', 'Layer (z)', '<input type="number" min="0" max="9999" data-lp-num="z" value="' + esc(own(node, 'place', 'z') ?? '') + '" placeholder="' + esc(inherited(node, 'place', 'z') ?? 'auto') + '">') + '</div>';
    return html;
  }

  function render(node) {
    const { doc, index } = st();
    const where = index.get(node.id);
    let html = '';
    if (node.children) html += containerHtml(node);
    if (where?.parent) html += placementHtml(node, doc.nodes[where.parent]);
    return '<div class="lp">' + (html || '<p class="hint">Sections fill the page width. Select an element inside to position it.</p>') + '</div>';
  }

  // ---- events ----
  function commit(ops, labelText) { return ctx.commit(ops.filter(Boolean), { label: labelText }); }
  function tracksFrom(root, axis) {
    return [...root.querySelectorAll('[data-lp-track="' + axis + '"]')].map(input => {
      if (input.hasAttribute('data-raw')) return input.value.trim();
      const unit = root.querySelector('[data-lp-track-unit="' + axis + '"][data-i="' + input.dataset.i + '"]').value;
      if (unit === 'auto') return 'auto';
      const value = input.value.trim() || (unit === 'fr' ? '1' : '100');
      return value + unit;
    });
  }
  // Children placed beyond the last column or row are moved back inside after removing a track.
  function clampChildren(node, axis, count) {
    const { doc, bpIds, bp } = st();
    return node.children.map(child => {
      const cell = effective(doc.nodes[child].place, bpIds, bp).cell;
      if (!cell) return null;
      const i = axis === 'columns' ? 1 : 0, span = i + 2;
      if (cell[i] + cell[span] - 1 <= count) return null;
      const next = cell.slice();
      next[i] = Math.min(cell[i], count); next[span] = Math.max(1, Math.min(cell[span], count - next[i] + 1));
      return op(child, 'place', 'cell', next);
    });
  }

  function onClick(event, root) {
    const { doc, selected } = st();
    const node = doc.nodes[selected], id = selected;
    const t = event.target;
    const pick = t.closest('[data-lp-pick]');
    if (pick) { ctx.select(pick.dataset.lpPick, { source: 'inspector' }); return true; }
    if (t.closest('summary')) { limitsOpen = !t.closest('details').open; return false; }
    if (!ctx.editable()) return true;
    const reset = t.closest('[data-lp-reset]');
    if (reset) {
      const rowEl = reset.closest('.lp-row');
      commit(rowEl.dataset.k.split(',').map(key => op(id, rowEl.dataset.g, key, undefined)), 'Reset');
      return true;
    }
    const link = t.closest('[data-lp-link]');
    if (link) { const name = link.dataset.lpLink; linkChoice.set(name, !linked.has(name)); ctx.refresh(); return true; }
    const set = t.closest('[data-lp-set]');
    if (set) {
      const name = set.dataset.lpSet, value = set.dataset.value;
      if (name === 'mode') {
        const ops = [op(id, 'layout', 'mode', value)];
        if (value === 'grid' && !eff(node, 'layout').columns) ops.push(op(id, 'layout', 'columns', ['1fr']));
        return commit(ops, value === 'grid' ? 'Switch to grid' : 'Switch to stack'), true;
      }
      if (name === 'wrap') return commit([op(id, 'layout', 'wrap', value === 'true')], 'Wrap'), true;
      if (name === 'sectionWidth') return commit([op(id, 'layout', 'contentWidth', value === 'full' ? 'auto' : (inherited(node, 'layout', 'contentWidth') && inherited(node, 'layout', 'contentWidth') !== 'auto' ? undefined : '1022px'))], value === 'full' ? 'Full width' : 'Boxed width'), true;
      if (name === 'alignSelf') return commit([op(id, 'place', 'alignSelf', value)], 'Align'), true;
      return commit([op(id, 'layout', name, value)], name), true;
    }
    const preset = t.closest('[data-lp-preset]');
    if (preset) {
      const columns = JSON.parse(preset.dataset.lpPreset);
      return commit([op(id, 'layout', 'columns', columns), ...clampChildren(node, 'columns', /^repeat/.test(columns[0]) ? 48 : columns.length)], 'Columns'), true;
    }
    const height = t.closest('[data-lp-height]');
    if (height) return commit([op(id, 'layout', 'minHeight', height.dataset.lpHeight)], 'Section height'), true;
    const add = t.closest('[data-lp-track-add]');
    if (add) {
      const axis = add.dataset.lpTrackAdd, current = eff(node, 'layout')[axis] || (axis === 'columns' ? ['1fr'] : []);
      return commit([op(id, 'layout', axis, [...current, axis === 'columns' ? '1fr' : 'auto'])], 'Add ' + (axis === 'columns' ? 'column' : 'row')), true;
    }
    const remove = t.closest('[data-lp-track-remove]');
    if (remove) {
      const axis = remove.dataset.lpTrackRemove, current = (eff(node, 'layout')[axis] || []).slice();
      current.splice(Number(remove.dataset.i), 1);
      return commit([op(id, 'layout', axis, current.length ? current : (axis === 'columns' ? ['1fr'] : (st().bp === 'desktop' ? undefined : ['auto']))), ...clampChildren(node, axis, Math.max(1, current.length))], 'Remove ' + (axis === 'columns' ? 'column' : 'row')), true;
    }
    const dock = t.closest('[data-lp-dock]');
    if (dock) {
      const [h, v] = dock.dataset.lpDock.split(',');
      return commit([op(id, 'place', 'justifySelf', h), op(id, 'place', 'alignSelf', v), op(id, 'place', 'margin', ['0px', '0px', '0px', '0px'])], 'Dock'), true;
    }
    const stretch = t.closest('[data-lp-stretch]');
    if (stretch) {
      const axis = stretch.dataset.lpStretch, place = eff(node, 'place');
      const key = axis === 'h' ? 'justifySelf' : 'alignSelf', sizeKey = axis === 'h' ? 'width' : 'height';
      if (place[key] === 'stretch') return commit([op(id, 'place', key, 'start')], 'Stop stretching'), true;
      const margin = (place.margin || ['0px', '0px', '0px', '0px']).slice();
      if (axis === 'h') { margin[1] = '0px'; margin[3] = '0px'; } else { margin[0] = '0px'; margin[2] = '0px'; }
      return commit([op(id, 'place', key, 'stretch'), op(id, 'place', sizeKey, 'auto'), op(id, 'place', 'margin', margin)], 'Stretch'), true;
    }
    const spanAll = t.closest('[data-lp-span-all]');
    if (spanAll) {
      const cell = eff(node, 'place').cell || [1, 1, 1, 1];
      return commit([op(id, 'place', 'cell', [cell[0], 1, cell[2], Number(spanAll.dataset.lpSpanAll)])], 'Span all columns'), true;
    }
    if (t.closest('[data-lp-full]')) {
      const { doc: d, index } = st(), parent = d.nodes[index.get(id).parent];
      const grid = (effective(parent.layout, st().bpIds, st().bp).mode || 'grid') === 'grid';
      const place = eff(node, 'place'), margin = (place.margin || ['0px', '0px', '0px', '0px']).slice();
      const on = !(place.width === '100%' || (grid && place.justifySelf === 'stretch' && (!place.width || place.width === 'auto')));
      if (!on) return commit([op(id, 'place', 'width', st().bp === 'desktop' ? undefined : 'auto'), grid ? op(id, 'place', 'justifySelf', 'start') : null], 'Natural width'), true;
      margin[1] = '0px'; margin[3] = '0px';
      return commit([op(id, 'place', 'width', '100%'), op(id, 'place', 'maxWidth', 'auto'), op(id, 'place', 'margin', margin), grid ? op(id, 'place', 'justifySelf', 'start') : null], 'Full width'), true;
    }
    return false;
  }
  function onChange(event, root) {
    const { doc, selected } = st();
    const node = doc.nodes[selected], id = selected, t = event.target;
    if (!ctx.editable()) return true;
    const lengthName = t.dataset.lpLen || t.dataset.lpUnit;
    if (lengthName) {
      const group = ['rowGap', 'columnGap', 'contentWidth'].includes(lengthName) || (lengthName === 'minHeight' && node.children && !t.closest('details')) ? 'layout' : 'place';
      const input = root.querySelector('[data-lp-len="' + lengthName + '"]'), unit = root.querySelector('[data-lp-unit="' + lengthName + '"]').value;
      let value;
      if (unit === 'auto') value = 'auto';
      else {
        const number = input.value.trim() || (/^-?\d/.test(input.placeholder) ? input.placeholder : '');
        if (!number) { if (t.dataset.lpLen) value = undefined; else { input.disabled = false; input.focus(); return true; } }
        else value = toLength(number, unit);
        if (t.dataset.lpLen && !input.value.trim()) value = undefined;
      }
      const ops = [op(id, group, lengthName, value)];
      if (linked.has('gap') && (lengthName === 'rowGap' || lengthName === 'columnGap')) ops.push(op(id, 'layout', lengthName === 'rowGap' ? 'columnGap' : 'rowGap', value));
      commit(ops, lengthName);
      return true;
    }
    if (t.dataset.lpBox) {
      const name = t.dataset.lpBox, group = name === 'padding' ? 'layout' : 'place', allowAuto = name === 'margin';
      const inputs = [...root.querySelectorAll('[data-lp-box="' + name + '"]')].sort((a, b) => a.dataset.side - b.dataset.side);
      const base = eff(node, group)[name] || ['0px', '0px', '0px', '0px'];
      let values = inputs.map((input, i) => toLength(input.value, 'px', { allowAuto }) ?? base[i]);
      if (linked.has(name)) values = values.map(() => toLength(t.value, 'px', { allowAuto }) ?? '0px');
      commit([op(id, group, name, values)], name === 'padding' ? 'Padding' : 'Margin');
      return true;
    }
    if (t.dataset.lpTrack || t.dataset.lpTrackUnit) {
      const axis = t.dataset.lpTrack || t.dataset.lpTrackUnit;
      commit([op(id, 'layout', axis, tracksFrom(root, axis))], axis === 'columns' ? 'Column size' : 'Row size');
      return true;
    }
    if (t.dataset.lpCell !== undefined) {
      const current = eff(node, 'place').cell || [1, 1, 1, 1];
      const values = [...root.querySelectorAll('[data-lp-cell]')].map((input, i) => Math.max(1, Math.min(48, Number(input.value) || current[i])));
      commit([op(id, 'place', 'cell', values)], 'Grid cell');
      return true;
    }
    if (t.dataset.lpNum) {
      const value = t.value === '' ? undefined : Number(t.value);
      commit([op(id, 'place', t.dataset.lpNum, value)], t.dataset.lpNum);
      return true;
    }
    return false;
  }
  return { render, onClick, onChange };
}
