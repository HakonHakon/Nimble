// Inline text editing on the canvas. Double-click a text element: its HTML is replaced by an editable
// copy with data attributes that carry the exact AST values, the browser handles typing, and the DOM is
// read back into the rich text AST. Formatting from the toolbar is applied to the AST and re-rendered.
import { escapeHtml as esc, runCss, blockCss } from '/assets/render-v2.mjs';
import { spec } from '/assets/site-model-v2.mjs';
import * as R from './rich-model.mjs';
import { colorField, createColorPicker } from './color-picker.mjs';
import { label } from './tree.mjs';

const STYLE_NAMES = { h1: 'Heading 1', h2: 'Heading 2', h3: 'Heading 3', h4: 'Heading 4', h5: 'Heading 5', h6: 'Heading 6', p1: 'Paragraph 1', p2: 'Paragraph 2', p3: 'Paragraph 3' };
const BLOCK_ELEMENTS = new Set(['P', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'DIV', 'BLOCKQUOTE', 'PRE', 'SECTION', 'ARTICLE', 'HEADER', 'FOOTER', 'ASIDE', 'NAV', 'MAIN', 'FIGURE', 'TABLE', 'TBODY', 'THEAD', 'TR', 'TD', 'TH', 'DL', 'DT', 'DD', 'ADDRESS', 'FIELDSET', 'FORM', 'HR']);
const SKIP = new Set(['SCRIPT', 'STYLE', 'TEMPLATE', 'NOSCRIPT', 'IFRAME', 'OBJECT', 'EMBED', 'SVG', 'MATH', 'IMG', 'VIDEO', 'AUDIO', 'CANVAS', 'INPUT', 'TEXTAREA', 'SELECT', 'BUTTON', 'HEAD', 'TITLE', 'META', 'LINK']);
const DATA_RUN = ['color', 'highlight', 'font', 'size', 'weight'];

// ---- AST → editable HTML -------------------------------------------------------------------------
export function editHtml(doc, site) {
  const year = String(new Date().getFullYear());
  const runsHtml = runs => runs.map(run => {
    let html = run.token ? '<span data-token="' + run.token + '" contenteditable="false">' + esc(run.token === 'year' ? year : site.site.name) + '</span>' : esc(run.text).replace(/\n/g, '<br>');
    if (run.b) html = '<strong>' + html + '</strong>';
    if (run.i) html = '<em>' + html + '</em>';
    if (run.u) html = '<u>' + html + '</u>';
    if (run.s) html = '<s>' + html + '</s>';
    const css = runCss(run);
    if (css) html = '<span data-r="' + esc(JSON.stringify(Object.fromEntries(DATA_RUN.filter(key => run[key] !== undefined).map(key => [key, run[key]])))) + '" style="' + esc(css) + '">' + html + '</span>';
    if (run.link) html = '<a href="#" data-link="' + esc(JSON.stringify(run.link)) + '">' + html + '</a>';
    return html;
  }).join('');
  // An empty line, or one ending in a line break, needs a trailing <br> to be visible and editable.
  const line = runs => { const text = runs.map(run => run.token ? 'x' : run.text).join(''); return runsHtml(runs) + (!text || text.endsWith('\n') ? '<br>' : ''); };
  return R.ensureLine(doc).map(block => {
    const props = Object.fromEntries(['style', 'align', 'lineHeight', 'letterSpacing'].filter(key => block[key] !== undefined).map(key => [key, block[key]]));
    const css = blockCss(block);
    const open = '<' + block.t + ' class="ts-' + (block.style || spec.richDefaultStyle[block.t]) + (block.align ? ' ta-' + block.align : '') + '"' + (Object.keys(props).length ? ' data-b="' + esc(JSON.stringify(props)) + '"' : '') + (css ? ' style="' + esc(css) + '"' : '') + '>';
    if (block.items) return open + block.items.map(item => '<li>' + line(item) + '</li>').join('') + '</' + block.t + '>';
    return open + line(block.c) + '</' + block.t + '>';
  }).join('');
}

// ---- DOM → AST ---------------------------------------------------------------------------------------
const json = text => { try { return JSON.parse(text); } catch { return null; } };
function linkFromHref(href) {
  const value = String(href || '').trim();
  if (/^https?:\/\//i.test(value)) return { to: 'url', href: value };
  if (/^mailto:/i.test(value)) return { to: 'email', address: decodeURIComponent(value.slice(7).split('?')[0]) };
  if (/^tel:/i.test(value)) return { to: 'phone', number: value.slice(4) };
  return null;
}
// Reads a block-level container (the edited element, or a pasted fragment) into blocks.
// `editing` trusts the data attributes written by editHtml; pasted HTML keeps only semantic formatting.
export function readBlocks(root, { editing = false } = {}) {
  const blocks = [];
  let loose = null;
  const flush = () => { if (loose) { blocks.push({ t: 'p', c: trimBreak(loose.runs, loose.lastBr) }); loose = null; } };
  const template = element => (editing && json(element.dataset?.b)) || {};
  const walk = container => {
    for (const node of container.childNodes) {
      if (node.nodeType === 1 && SKIP.has(node.tagName)) continue;
      if (node.nodeType === 1 && (node.tagName === 'UL' || node.tagName === 'OL')) {
        flush();
        const items = [];
        const collect = list => {
          for (const li of list.children) {
            if (li.tagName === 'UL' || li.tagName === 'OL') { collect(li); continue; }
            items.push(trimBreak(inline(li, {}, editing), endsWithBr(li)));
            for (const nested of li.querySelectorAll(':scope > ul, :scope > ol')) collect(nested);
          }
        };
        collect(node);
        blocks.push({ ...template(node), t: node.tagName.toLowerCase(), items });
        continue;
      }
      if (node.nodeType === 1 && BLOCK_ELEMENTS.has(node.tagName)) {
        flush();
        const hasBlocks = [...node.children].some(child => BLOCK_ELEMENTS.has(child.tagName) || child.tagName === 'UL' || child.tagName === 'OL');
        if (hasBlocks) { walk(node); continue; }
        if (node.tagName === 'HR') continue;
        const tag = node.tagName.toLowerCase();
        blocks.push({ ...template(node), t: /^h[1-6]$/.test(tag) ? tag : 'p', c: trimBreak(inline(node, {}, editing, tag === 'pre'), endsWithBr(node)) });
        continue;
      }
      // Text or inline content directly in the container becomes its own paragraph.
      if (node.nodeType === 3 && !node.data.trim() && !loose) continue;
      loose ??= { runs: [] };
      loose.runs.push(...inline({ childNodes: [node] }, {}, editing));
      loose.lastBr = node.nodeType === 1 && node.tagName === 'BR';
    }
    flush();
  };
  walk(root);
  return R.canonical(blocks.map(block => {
    if (block.style && block.style === spec.richDefaultStyle[block.t]) delete block.style;
    if (!editing) for (const key of ['style', 'align', 'lineHeight', 'letterSpacing']) delete block[key];
    return block;
  }));
}
function endsWithBr(element) {
  let last = element.lastChild;
  while (last && last.nodeType === 3 && last.data === '') last = last.previousSibling;
  while (last && last.nodeType === 1 && last.tagName !== 'BR' && !last.dataset?.token && last.lastChild) last = last.lastChild;
  return !!last && last.nodeType === 1 && last.tagName === 'BR';
}
// The browser keeps a <br> at the end of a line so it stays visible; it is not content.
function trimBreak(runs, hasTrailingBr) {
  if (!hasTrailingBr) return runs;
  for (let i = runs.length - 1; i >= 0; i--) {
    if (runs[i].token) break;
    if (runs[i].text.endsWith('\n')) { runs[i] = { ...runs[i], text: runs[i].text.slice(0, -1) }; break; }
    if (runs[i].text) break;
  }
  return runs;
}
function inline(element, marks, editing, pre = false) {
  const out = [];
  for (const node of element.childNodes) {
    if (node.nodeType === 3) {
      const text = editing || pre ? node.data : node.data.replace(/[\t\n\r ]+/g, ' ');
      if (text) out.push({ ...marks, text });
      continue;
    }
    if (node.nodeType !== 1 || SKIP.has(node.tagName)) continue;
    if (node.tagName === 'BR') { out.push({ ...marks, text: '\n' }); continue; }
    if (node.dataset.token && editing) { out.push({ ...marks, text: '', token: node.dataset.token }); continue; }
    const next = { ...marks };
    const tag = node.tagName;
    if (tag === 'STRONG' || tag === 'B') next.b = true;
    if (tag === 'EM' || tag === 'I') next.i = true;
    if (tag === 'U' || tag === 'INS') next.u = true;
    if (tag === 'S' || tag === 'STRIKE' || tag === 'DEL') next.s = true;
    if (tag === 'A') { const link = editing ? json(node.dataset.link) : linkFromHref(node.getAttribute('href')); if (link) next.link = link; }
    if (editing && node.dataset.r) Object.assign(next, json(node.dataset.r) || {});
    if (!editing && node.style) {
      if (/^(bold|[6-9]00)$/.test(node.style.fontWeight)) next.b = true;
      if (node.style.fontStyle === 'italic') next.i = true;
      if (/underline/.test(node.style.textDecoration || node.style.textDecorationLine)) next.u = true;
    }
    out.push(...inline(node, next, editing, pre || tag === 'PRE'));
    if (BLOCK_ELEMENTS.has(tag)) out.push({ ...marks, text: '\n' });
  }
  return R.mergeRuns(out);
}

// ---- DOM positions -----------------------------------------------------------------------------------
const domLines = root => [...root.children].flatMap(child => child.tagName === 'UL' || child.tagName === 'OL' ? [...child.children].filter(li => li.tagName === 'LI') : [child]);
function measure(node) {
  if (node.nodeType === 3) return node.data.length;
  if (node.nodeType !== 1 && node.nodeType !== 11) return 0;
  if (node.nodeType === 1 && (node.tagName === 'BR' || node.dataset.token)) return 1;
  let total = 0;
  for (const child of node.childNodes) total += measure(child);
  return total;
}
function toPosition(root, node, offset) {
  const list = domLines(root);
  if (node === root) {
    const child = root.childNodes[Math.min(offset, root.childNodes.length - 1)];
    const line = list.findIndex(item => item === child || item.parentNode === child);
    return line < 0 ? R.endOf([]) : { line, offset: offset >= root.childNodes.length ? measure(list[line]) : 0 };
  }
  const line = list.findIndex(item => item === node || item.contains(node));
  if (line < 0) return null;
  const range = root.ownerDocument.createRange();
  range.setStart(list[line], 0);
  range.setEnd(node, offset);
  return { line, offset: measure(range.cloneContents()) };
}
function toDom(root, position) {
  const list = domLines(root);
  const line = list[Math.max(0, Math.min(position.line, list.length - 1))];
  if (!line) return [root, 0];
  let remaining = position.offset;
  const find = parent => {
    for (let i = 0; i < parent.childNodes.length; i++) {
      const node = parent.childNodes[i];
      if (node.nodeType === 3) { if (remaining <= node.data.length) return [node, remaining]; remaining -= node.data.length; continue; }
      if (node.nodeType !== 1) continue;
      if (node.tagName === 'BR' || node.dataset.token) { if (remaining === 0) return [parent, i]; remaining -= 1; continue; }
      const found = find(node);
      if (found) return found;
    }
    return null;
  };
  const found = find(line);
  if (found) return found;
  const last = line.lastChild;
  return last && last.nodeType === 1 && last.tagName === 'BR' ? [line, line.childNodes.length - 1] : [line, line.childNodes.length];
}
// Wraps loose text in paragraphs so every top-level child is a block. The caret is put back afterwards,
// because moving nodes collapses selection ranges inside them.
function tidy(root) {
  const loose = [...root.childNodes].some(node => !(node.nodeType === 1 && (BLOCK_ELEMENTS.has(node.tagName) || node.tagName === 'UL' || node.tagName === 'OL')));
  if (!loose && root.firstChild) return;
  const sel = root.ownerDocument.getSelection();
  const keep = sel?.rangeCount ? [sel.anchorNode, sel.anchorOffset, sel.focusNode, sel.focusOffset] : null;
  let wrapper = null;
  for (const node of [...root.childNodes]) {
    const block = node.nodeType === 1 && (BLOCK_ELEMENTS.has(node.tagName) || node.tagName === 'UL' || node.tagName === 'OL');
    if (block) { wrapper = null; continue; }
    if (node.nodeType === 3 && !node.data.trim() && !wrapper) { node.remove(); continue; }
    if (!wrapper) { wrapper = root.ownerDocument.createElement('p'); wrapper.className = 'ts-p1'; root.insertBefore(wrapper, node); }
    wrapper.append(node);
  }
  if (!root.firstChild) { root.innerHTML = '<p class="ts-p1"><br></p>'; sel?.collapse(root.firstChild, 0); return; }
  if (keep && root.contains(keep[0]) && root.contains(keep[2])) { try { sel.setBaseAndExtent(...keep); } catch { /* moved */ } }
}

// ---- Editor ------------------------------------------------------------------------------------------
export function createRichEditor(canvas, ctx) {
  let id = null, element = null, saved = null, timer = null, lastJson = '', storeJson = '', toolbar = null, linkOpen = false;
  const picker = createColorPicker({ colors: () => ctx.state().doc.design.colors });
  const frameDoc = () => canvas.document();
  const node = () => ctx.state().doc.nodes[id];

  function read() { tidy(element); return readBlocks(element, { editing: true }); }
  function selection() {
    const sel = frameDoc().getSelection();
    if (!sel?.rangeCount || !element.contains(sel.anchorNode) || !element.contains(sel.focusNode)) return null;
    const start = toPosition(element, sel.anchorNode, sel.anchorOffset), end = toPosition(element, sel.focusNode, sel.focusOffset);
    return start && end ? R.ordered({ start, end }) : null;
  }
  function restore(range) {
    const sel = frameDoc().getSelection();
    const [a, ao] = toDom(element, range.start), [b, bo] = toDom(element, range.end);
    try { sel.setBaseAndExtent(a, ao, b, bo); } catch { /* the DOM changed underneath */ }
    saved = range;
  }
  function paint(doc) {
    element.innerHTML = editHtml(doc, ctx.state().doc);
    lastJson = JSON.stringify(R.canonical(R.ensureLine(doc)));
    canvas.redraw();
  }
  function commit(doc, options = {}) {
    clearTimeout(timer);
    const value = R.canonical(doc);
    const text = JSON.stringify(value);
    if (text === JSON.stringify(R.canonical(node()?.props?.doc || []))) { lastJson = text; return; }
    lastJson = text;
    // The empty paragraph shown in an empty element is not content.
    const stored = value.length === 1 && !value[0].items && !value[0].c.length ? [] : value;
    if (ctx.commit([{ path: ['nodes', id, 'props', 'doc'], value: stored }], { label: options.label || 'Edit text', merge: options.merge ?? null })) storeJson = JSON.stringify(node()?.props?.doc || []);
  }
  function flush() { if (id && element) commit(read(), { merge: 'rich:' + id }); }

  function start(target, point = null) {
    if (!ctx.editable()) return false;
    const current = ctx.state().doc.nodes[target];
    if (current?.type !== 'text') return false;
    if (id) stop();
    const el = canvas.element(target);
    if (!el) return false;
    id = target; element = el;
    canvas.setEditing(id);
    enter(point);
    return true;
  }
  function enter(point) {
    paint(node().props?.doc || []);
    storeJson = JSON.stringify(node().props?.doc || []);
    element.setAttribute('contenteditable', 'true');
    element.spellcheck = true;
    try { frameDoc().execCommand('defaultParagraphSeparator', false, 'p'); } catch { /* not supported */ }
    element.addEventListener('input', onInput);
    element.addEventListener('keydown', onKeyDown);
    element.addEventListener('paste', onPaste);
    element.addEventListener('drop', onDrop);
    frameDoc().addEventListener('selectionchange', onSelection);
    element.focus({ preventScroll: true });
    let placed = false;
    if (point) {
      const d = frameDoc();
      const caret = d.caretRangeFromPoint?.(point.x, point.y) || (d.caretPositionFromPoint && (pos => { if (!pos) return null; const r = d.createRange(); r.setStart(pos.offsetNode, pos.offset); return r; })(d.caretPositionFromPoint(point.x, point.y)));
      if (caret && element.contains(caret.startContainer)) { const sel = d.getSelection(); sel.removeAllRanges(); sel.addRange(caret); placed = true; }
    }
    if (!placed) { const end = R.endOf(R.ensureLine(node().props?.doc || [])); restore({ start: end, end }); }
    saved = selection() || saved;
    showToolbar();
  }
  function detach() {
    element?.removeEventListener('input', onInput);
    element?.removeEventListener('keydown', onKeyDown);
    element?.removeEventListener('paste', onPaste);
    element?.removeEventListener('drop', onDrop);
    frameDoc()?.removeEventListener('selectionchange', onSelection);
    element?.removeAttribute('contenteditable');
  }
  function stop() {
    if (!id) return;
    const done = id;
    if (element?.isConnected) flush();
    detach();
    id = null; element = null; saved = null;
    canvas.setEditing(null);
    hideToolbar();
    const { doc, page } = ctx.state();
    if (doc.nodes[done]) canvas.render(doc, page, new Set([done]));
  }
  // Called after every store change: picks up undo/redo, and re-enters if the element was re-rendered.
  function refresh() {
    if (!id) return;
    if (!node()) { detach(); id = null; element = null; canvas.setEditing(null); hideToolbar(); return; }
    const current = canvas.element(id);
    const external = JSON.stringify(node().props?.doc || []) !== storeJson;
    if (current !== element) { detach(); element = current; if (!element) return stop(); enter(null); return; }
    if (external) {
      const range = saved;
      paint(node().props?.doc || []);
      storeJson = JSON.stringify(node().props?.doc || []);
      const end = R.endOf(R.ensureLine(node().props?.doc || []));
      restore(range && range.end.line <= end.line ? range : { start: end, end });
    }
    syncToolbar();
  }

  function onInput() {
    clearTimeout(timer);
    timer = setTimeout(flush, 400);
    canvas.redraw(); placeToolbar();
  }
  function onSelection() {
    const range = selection();
    if (!range) return;
    saved = range;
    syncToolbar();
  }
  // Applies an AST operation to the current selection, re-renders, restores the selection and commits.
  function apply(operation, label = 'Format text') {
    clearTimeout(timer);
    const doc = R.ensureLine(read());
    const range = saved || (end => ({ start: end, end }))(R.endOf(doc));
    const result = operation(doc, range);
    const next = Array.isArray(result) ? result : result.doc;
    paint(next);
    element.focus({ preventScroll: true });
    restore(result.caret ? { start: result.caret, end: result.caret } : result.range || range);
    commit(next, { label });
    syncToolbar();
  }
  function onKeyDown(event) {
    const mod = event.ctrlKey || event.metaKey, key = event.key.toLowerCase();
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); const done = id; stop(); ctx.select(done, { source: 'canvas' }); return; }
    if (mod && ['b', 'i', 'u'].includes(key)) { event.preventDefault(); event.stopPropagation(); apply((doc, range) => R.toggleMark(doc, range, key)); return; }
    if (mod && key === 'k') { event.preventDefault(); event.stopPropagation(); openLink(); return; }
    if (mod && (key === 'z' || key === 'y')) {
      event.preventDefault(); event.stopPropagation();
      flush();
      const store = ctx.store();
      if (key === 'y' || event.shiftKey) store.redo(); else store.undo();
      return;
    }
    if (mod && key === 's') return; // the editor saves; let it bubble
    event.stopPropagation();
  }
  function onPaste(event) {
    event.preventDefault();
    const data = event.clipboardData;
    const html = data?.getData('text/html'), text = data?.getData('text/plain') || '';
    let blocks;
    if (html) {
      const parsed = new DOMParser().parseFromString(html, 'text/html');
      blocks = readBlocks(parsed.body, { editing: false });
    } else blocks = R.textToBlocks(text);
    apply((doc, range) => R.insertBlocks(doc, range, blocks), 'Paste text');
  }
  function onDrop(event) { event.preventDefault(); }

  // ---- Toolbar ---------------------------------------------------------------------------------------
  function toolbarHtml() {
    const { doc } = ctx.state();
    const option = (value, text) => '<option value="' + esc(value) + '">' + esc(text) + '</option>';
    return '<div class="rt-row">'
      + '<select data-rt="style" aria-label="Text style" title="Text style">' + spec.textStyleKeys.map(key => option(key, STYLE_NAMES[key])).join('') + option('ul', 'Bulleted list') + option('ol', 'Numbered list') + '</select>'
      + '<select data-rt="tag" aria-label="HTML tag" title="HTML tag (for search engines and screen readers)">' + R.TEXT_TAGS.map(tag => option(tag, tag === 'p' ? 'P' : tag.toUpperCase())).join('') + '</select>'
      + '<select data-rt="font" aria-label="Font" title="Font"><option value="">Style font</option>' + doc.design.fonts.map(font => option(font.id, font.source === 'system' ? font.id + ' — ' + font.family : font.family)).join('') + '</select>'
      + '<input data-rt="size" aria-label="Font size" title="Font size" placeholder="Size" spellcheck="false">'
      + '<select data-rt="weight" aria-label="Font weight" title="Font weight"><option value="">Weight</option>' + [100, 200, 300, 400, 500, 600, 700, 800, 900].map(weight => option(String(weight), String(weight))).join('') + '</select>'
      + '</div><div class="rt-row">'
      + [['b', '<b>B</b>', 'Bold (Ctrl+B)'], ['i', '<i>I</i>', 'Italic (Ctrl+I)'], ['u', '<u>U</u>', 'Underline (Ctrl+U)'], ['s', '<s>S</s>', 'Strikethrough']].map(([key, icon, title]) => '<button type="button" class="rt-btn" data-rt="' + key + '" aria-label="' + title + '" title="' + title + '" aria-pressed="false">' + icon + '</button>').join('')
      + '<span class="rt-color" title="Text colour"><span aria-hidden="true">A</span>' + colorField(doc.design.colors, '', '', ' data-rt="color" aria-label="Text colour"') + '</span>'
      + '<span class="rt-color" title="Highlight"><span aria-hidden="true">▮</span>' + colorField(doc.design.colors, '', '', ' data-rt="highlight" aria-label="Highlight colour"') + '</span>'
      + [['left', '⇤'], ['center', '↔'], ['right', '⇥'], ['justify', '☰']].map(([align, icon]) => '<button type="button" class="rt-btn" data-rt-align="' + align + '" aria-label="Align ' + align + '" title="Align ' + align + '" aria-pressed="false">' + icon + '</button>').join('')
      + '<input data-rt="lineHeight" type="number" min="0.5" max="4" step="0.1" aria-label="Line height" title="Line height" placeholder="Line">'
      + '<input data-rt="letterSpacing" aria-label="Letter spacing" title="Letter spacing (e.g. 0.05em)" placeholder="Spacing" spellcheck="false">'
      + '<button type="button" class="rt-btn" data-rt="link" aria-label="Link (Ctrl+K)" title="Link (Ctrl+K)">🔗</button>'
      + '<button type="button" class="rt-btn" data-rt="clear" aria-label="Clear formatting" title="Clear formatting">⌫</button>'
      + '<button type="button" class="btn btn-small btn-primary" data-rt="done">Done</button></div>'
      + '<form class="rt-link" hidden></form>';
  }
  function showToolbar() {
    hideToolbar();
    toolbar = document.createElement('div');
    toolbar.className = 'rt-toolbar';
    toolbar.setAttribute('role', 'toolbar');
    toolbar.setAttribute('aria-label', 'Text formatting');
    toolbar.innerHTML = toolbarHtml();
    document.body.append(toolbar);
    picker.attach(toolbar);
    // Buttons must not take focus away from the text, or the selection would be lost.
    toolbar.addEventListener('mousedown', event => { if (event.target.closest('button')) event.preventDefault(); });
    toolbar.addEventListener('click', onToolbarClick);
    toolbar.addEventListener('change', onToolbarChange);
    toolbar.addEventListener('submit', onLinkSubmit);
    toolbar.addEventListener('keydown', event => {
      if (event.key === 'Escape' && !picker.isOpen) { event.preventDefault(); if (linkOpen) return closeLink(); const done = id; stop(); ctx.select(done, { source: 'canvas' }); }
      if (event.key === 'Enter' && event.target.matches('input:not([type=checkbox])') && !event.target.closest('.rt-link')) { event.preventDefault(); event.target.blur(); }
    });
    frameDoc().defaultView.addEventListener('scroll', placeToolbar, { passive: true });
    placeToolbar(); syncToolbar();
  }
  function hideToolbar() {
    picker.close();
    toolbar?.remove(); toolbar = null; linkOpen = false;
    frameDoc()?.defaultView?.removeEventListener('scroll', placeToolbar);
  }
  function placeToolbar() {
    if (!toolbar || !element) return;
    const frame = canvas.frame.getBoundingClientRect(), r = element.getBoundingClientRect(), scale = canvas.scale;
    const top = frame.top + r.top * scale, bottom = frame.top + r.bottom * scale, left = frame.left + r.left * scale;
    const height = toolbar.offsetHeight, width = toolbar.offsetWidth;
    toolbar.style.left = Math.max(8, Math.min(left, innerWidth - width - 8)) + 'px';
    toolbar.style.top = (top - height - 10 >= 60 ? top - height - 10 : Math.min(bottom + 10, innerHeight - height - 8)) + 'px';
  }
  function syncToolbar() {
    if (!toolbar || !element) return;
    const doc = R.ensureLine(read()), range = saved || (end => ({ start: end, end }))(R.endOf(doc));
    const marks = R.markState(doc, range), block = R.blockState(doc, range);
    const set = (name, value) => { const input = toolbar.querySelector('[data-rt="' + name + '"]'); if (input && toolbar.ownerDocument.activeElement !== input) input.value = value ?? ''; };
    for (const mark of R.MARKS) toolbar.querySelector('[data-rt="' + mark + '"]').setAttribute('aria-pressed', String(marks[mark]));
    set('style', R.isList(block) ? block.t : block.style || spec.richDefaultStyle[block.t]);
    set('tag', R.isList(block) ? 'p' : block.t);
    toolbar.querySelector('[data-rt=tag]').disabled = R.isList(block);
    set('font', marks.font); set('size', marks.size); set('weight', marks.weight); set('lineHeight', block.lineHeight); set('letterSpacing', block.letterSpacing);
    for (const key of ['color', 'highlight']) {
      const input = toolbar.querySelector('[data-rt="' + key + '"]');
      if (toolbar.ownerDocument.activeElement !== input) input.value = marks[key] || '';
      const colors = ctx.state().doc.design.colors, value = marks[key];
      input.closest('.color-field').querySelector('[data-picker]').style.setProperty('--swatch', value ? (value.startsWith('@') ? colors[value.slice(1)] : value) : 'transparent');
    }
    toolbar.querySelectorAll('[data-rt-align]').forEach(button => button.setAttribute('aria-pressed', String((block.align || 'left') === button.dataset.rtAlign && !!block.align)));
    toolbar.querySelector('[data-rt=link]').setAttribute('aria-pressed', String(!!marks.link));
  }
  function onToolbarClick(event) {
    const button = event.target.closest('button');
    if (!button || !id) return;
    const rt = button.dataset.rt, align = button.dataset.rtAlign;
    if (R.MARKS.includes(rt)) return apply((doc, range) => R.toggleMark(doc, range, rt));
    if (align) return apply((doc, range) => R.setBlockProps(doc, range, { align: R.blockState(doc, range).align === align ? undefined : align }));
    if (rt === 'clear') return apply((doc, range) => R.clearFormatting(doc, range), 'Clear formatting');
    if (rt === 'link') return linkOpen ? closeLink() : openLink();
    if (rt === 'done') { const done = id; stop(); ctx.select(done, { source: 'canvas' }); return; }
    if (button.dataset.linkRemove !== undefined) {
      closeLink();
      return apply((doc, range) => { const target = R.linkRange(doc, range) || range; return { doc: R.setRunProp(doc, target, 'link', undefined), range: target }; }, 'Remove link');
    }
  }
  function onToolbarChange(event) {
    const t = event.target, rt = t.dataset.rt;
    if (!id || !rt || t.closest('.rt-link')) return;
    const value = t.value.trim();
    if (rt === 'style') {
      if (value === 'ul' || value === 'ol') return apply((doc, range) => R.setBlockType(doc, range, value, undefined, spec.richDefaultStyle));
      const tag = /^h/.test(value) ? value : 'p';
      return apply((doc, range) => R.setBlockType(doc, range, tag, value, spec.richDefaultStyle));
    }
    if (rt === 'tag') return apply((doc, range) => { const current = R.blockState(doc, range); return R.setBlockType(doc, range, value, current.style || spec.richDefaultStyle[current.t], spec.richDefaultStyle); });
    if (rt === 'font') return apply((doc, range) => R.setRunProp(doc, range, 'font', value));
    if (rt === 'weight') return apply((doc, range) => R.setRunProp(doc, range, 'weight', value ? Number(value) : undefined));
    if (rt === 'size') return apply((doc, range) => R.setRunProp(doc, range, 'size', /^\d+(\.\d+)?$/.test(value) ? value + 'px' : value));
    if (rt === 'color' || rt === 'highlight') return apply((doc, range) => R.setRunProp(doc, range, rt, value));
    if (rt === 'lineHeight') return apply((doc, range) => R.setBlockProps(doc, range, { lineHeight: value === '' ? undefined : Number(value) }));
    if (rt === 'letterSpacing') return apply((doc, range) => R.setBlockProps(doc, range, { letterSpacing: /^-?\d+(\.\d+)?$/.test(value) ? value + 'px' : value }));
  }

  // Link form: the same destinations as the Link field of buttons and images.
  function openLink() {
    if (!toolbar) return;
    const doc = R.ensureLine(read()), range = saved;
    if (!range) return;
    const current = R.markState(doc, R.linkRange(doc, range) || range).link;
    if (R.collapsed(range) && !current) return ctx.toast('Select the text you want to link first.');
    linkOpen = true;
    const { doc: site, page } = ctx.state();
    const value = current || { to: 'page' };
    const form = toolbar.querySelector('.rt-link');
    const option = (v, text, selected) => '<option value="' + esc(v) + '"' + (selected ? ' selected' : '') + '>' + esc(text) + '</option>';
    form.innerHTML = '<label>Link to<select name="to">' + [['page', 'Page'], ['anchor', 'Section on this page'], ['url', 'Web address'], ['email', 'Email'], ['phone', 'Phone'], ['asset', 'File']].map(([v, text]) => option(v, text, value.to === v)).join('') + '</select></label>'
      + '<label data-for="page">Page<select name="page">' + site.pages.map(item => option(item.id, item.name, value.page === item.id)).join('') + '</select></label>'
      + '<label data-for="anchor">Section<select name="node">' + page.children.map(child => option(child, label(site.nodes[child]), value.node === child)).join('') + '</select></label>'
      + '<label data-for="url">Address<input name="href" value="' + esc(value.to === 'url' ? value.href : '') + '" placeholder="https://…" spellcheck="false"></label>'
      + '<label data-for="email">Email<input name="address" value="' + esc(value.address || '') + '" placeholder="name@example.com"></label>'
      + '<label data-for="phone">Phone<input name="number" value="' + esc(value.number || '') + '" placeholder="+47 …"></label>'
      + '<label data-for="asset">File<select name="asset">' + site.assets.map(asset => option(asset.url, asset.name, value.href === asset.url)).join('') + '</select></label>'
      + '<label class="check"><input type="checkbox" name="newTab"' + (value.newTab ? ' checked' : '') + '>Open in a new tab</label>'
      + '<div class="pair"><button class="btn btn-small btn-primary">Apply</button>' + (current ? '<button type="button" class="btn btn-small" data-link-remove>Remove link</button>' : '') + '</div>';
    const show = () => form.querySelectorAll('[data-for]').forEach(item => { item.hidden = item.dataset.for !== form.elements.to.value; });
    form.elements.to.onchange = show;
    show();
    form.hidden = false;
    placeToolbar();
    (form.querySelector('[data-for]:not([hidden]) input,[data-for]:not([hidden]) select') || form.elements.to).focus();
  }
  function closeLink() { linkOpen = false; const form = toolbar?.querySelector('.rt-link'); if (form) { form.hidden = true; form.innerHTML = ''; } placeToolbar(); }
  function onLinkSubmit(event) {
    event.preventDefault();
    const f = event.target.elements, to = f.to.value;
    const link = { to, ...(to === 'page' ? { page: f.page.value } : {}), ...(to === 'anchor' ? { node: f.node.value } : {}), ...(to === 'url' ? { href: f.href.value.trim() } : {}), ...(to === 'asset' ? { href: f.asset.value } : {}), ...(to === 'email' ? { address: f.address.value.trim() } : {}), ...(to === 'phone' ? { number: f.number.value.trim() } : {}), ...(f.newTab.checked ? { newTab: true } : {}) };
    if (Object.values(link).some(item => item === '' || item === undefined)) return ctx.toast('Complete the link first.');
    if (to === 'url' && !/^https?:\/\//i.test(link.href)) return ctx.toast('Web addresses start with https:// or http://.');
    closeLink();
    apply((doc, range) => { const target = R.collapsed(range) ? R.linkRange(doc, range) || range : range; return { doc: R.setRunProp(doc, target, 'link', link), range: target }; }, 'Link');
  }

  return {
    start, stop, refresh, flush,
    get editing() { return id; },
    // True when a pointer event belongs to the text being edited (the browser handles it).
    owns(event) { return !!id && !!element && element.contains(event.target); }
  };
}
