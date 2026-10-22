// Breakpoints: the manager dialog (add, rename, resize, remove custom breakpoints), the mapping from
// a preview width to the breakpoint in effect, and per-element override summaries.
import { escapeHtml as esc } from '/assets/render-v2.mjs';
import { normalizeSiteV2, spec } from '/assets/site-model-v2.mjs';
import { replaceOps } from './site-panels.mjs';

const GROUPS = ['layout', 'place', 'style'];
export const MIN_WIDTH = spec.breakpointRange[0], MAX_WIDTH = spec.breakpointRange[1];

// The breakpoint whose range contains `width`: the narrowest one with max ≥ width, else desktop.
export function breakpointForWidth(breakpoints, width) {
  let match = 'desktop';
  for (const bp of breakpoints) if (width <= bp.max) match = bp.id;
  return match;
}
// Range of widths a breakpoint covers.
export function rangeOf(breakpoints, id) {
  if (id === 'desktop') return { min: (breakpoints[0]?.max ?? MIN_WIDTH - 1) + 1, max: Infinity };
  const at = breakpoints.findIndex(bp => bp.id === id);
  return { min: (breakpoints[at + 1]?.max ?? MIN_WIDTH - 1) + 1, max: breakpoints[at].max };
}
// Keys an element overrides on one breakpoint, as [group, key] pairs.
export function overridesAt(node, bp) {
  const list = [];
  for (const group of GROUPS) for (const key of Object.keys(node[group]?.[bp] || {})) list.push([group, key]);
  if (bp !== 'desktop' && typeof node.hidden?.[bp] === 'boolean') list.push(['hidden', bp]);
  return list;
}
export function resetOps(node, bp) {
  return [...GROUPS.filter(group => node[group]?.[bp]).map(group => ({ path: ['nodes', node.id, group, bp], value: undefined })),
    ...(bp !== 'desktop' && typeof node.hidden?.[bp] === 'boolean' ? [{ path: ['nodes', node.id, 'hidden', bp], value: undefined }] : [])];
}

export function createBreakpointManager(ctx) {
  // Structural edits normalize the whole site first, so overrides of a removed breakpoint are part of
  // the undo step and come back with Undo.
  function apply(breakpoints, label) {
    const { doc } = ctx.state();
    let next;
    try { next = normalizeSiteV2({ ...doc, breakpoints }); }
    catch (error) { ctx.toast(error.message); return false; }
    return ctx.commit(replaceOps(doc, next), { label });
  }
  function freshId(list) {
    let n = list.length + 1, id;
    do id = 'bp' + n++; while (list.some(bp => bp.id === id) || id === 'desktop');
    return id;
  }
  function html() {
    const { doc } = ctx.state(), list = doc.breakpoints;
    const usage = id => Object.values(doc.nodes).filter(node => overridesAt(node, id).length).length;
    return '<p>Desktop is the base design. Each breakpoint applies at its maximum width and below, and only stores what you change there.</p>'
      + '<table class="bp-table"><thead><tr><th>Name</th><th>Applies up to</th><th>Elements changed</th><th></th></tr></thead><tbody>'
      + '<tr><td><strong>Desktop</strong></td><td>wider than ' + ((list[0]?.max ?? 0)) + ' px</td><td>base</td><td></td></tr>'
      + list.map(bp => '<tr data-bp-row="' + esc(bp.id) + '"><td><input data-bp-name value="' + esc(bp.name) + '" maxlength="40" aria-label="Name of ' + esc(bp.name) + '"></td>'
        + '<td><span class="len"><input type="number" data-bp-max min="' + MIN_WIDTH + '" max="' + MAX_WIDTH + '" value="' + bp.max + '" aria-label="Maximum width of ' + esc(bp.name) + '"><span class="unit">px</span></span></td>'
        + '<td>' + usage(bp.id) + '</td><td><button class="btn btn-small" data-bp-remove' + (ctx.editable() ? '' : ' disabled') + '>Remove</button></td></tr>').join('')
      + '</tbody></table>'
      + (list.length < spec.limits.breakpoints ? '<form class="bp-add"><input name="name" placeholder="Name, e.g. Small laptop" maxlength="40" required><span class="len"><input name="max" type="number" min="' + MIN_WIDTH + '" max="' + MAX_WIDTH + '" placeholder="max width" required><span class="unit">px</span></span><button class="btn"' + (ctx.editable() ? '' : ' disabled') + '>Add breakpoint</button></form>' : '<p class="hint">You can have up to ' + spec.limits.breakpoints + ' breakpoints.</p>')
      + '<p class="hint">Removing a breakpoint also removes the changes made on it. Undo restores both.</p>';
  }
  function open() {
    ctx.dialog('Breakpoints', '<div class="bp-manager">' + html() + '</div>');
    const root = document.querySelector('.bp-manager');
    const refresh = () => { root.innerHTML = html(); };
    root.addEventListener('change', event => {
      const row = event.target.closest('[data-bp-row]');
      if (!row || !ctx.editable()) return;
      const list = structuredClone(ctx.state().doc.breakpoints), bp = list.find(item => item.id === row.dataset.bpRow);
      if (event.target.matches('[data-bp-name]')) bp.name = event.target.value.trim() || bp.name;
      if (event.target.matches('[data-bp-max]')) bp.max = Math.round(Number(event.target.value));
      apply(list, 'Edit breakpoint');
      refresh();
    });
    root.addEventListener('click', event => {
      const remove = event.target.closest('[data-bp-remove]');
      if (!remove || !ctx.editable()) return;
      const id = remove.closest('[data-bp-row]').dataset.bpRow;
      if (apply(ctx.state().doc.breakpoints.filter(bp => bp.id !== id), 'Remove breakpoint')) { ctx.breakpointRemoved(id); refresh(); }
    });
    root.addEventListener('submit', event => {
      event.preventDefault();
      if (!ctx.editable()) return;
      const form = event.target, list = structuredClone(ctx.state().doc.breakpoints);
      const id = freshId(list);
      list.push({ id, name: form.elements.name.value.trim(), max: Math.round(Number(form.elements.max.value)) });
      if (apply(list, 'Add breakpoint')) { ctx.switchBreakpoint(id); refresh(); }
    });
  }
  return { open };
}
