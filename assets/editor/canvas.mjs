// Canvas: the page renders inside a sandboxed same-origin iframe with the exact published HTML and CSS,
// so breakpoint media queries apply for real. Selection chrome, handles, guides and gesture feedback
// live in an overlay above the iframe that uses the same (iframe) coordinates.
import { renderNode, siteCss, pageRoots, createCssCache } from '/assets/render-v2.mjs';
import { label } from './tree.mjs';
import { layoutBox, rotationOf, gridGeometry, isGrid } from './geometry.mjs';

const EDITOR_CSS = 'html,body{min-height:100%}iframe,video{pointer-events:none}a,button,summary{cursor:default}body{-webkit-user-select:none;user-select:none}'
  + '.t-section:empty,.t-container:empty{min-height:72px;outline:1px dashed #c8c5d7;outline-offset:-1px}'
  + '.t-image:empty{min-height:120px;background:repeating-linear-gradient(45deg,#f1f0f6 0 10px,#e7e5f0 10px 20px)}'
  + '.t-text:empty{min-height:1.4em}'
  + 'dialog.popup{display:block;position:relative;inset:auto;margin:40px auto;outline:2px dashed #9b8cff;outline-offset:6px}dialog.popup::before{content:"Popup";position:absolute;top:-30px;left:0;font:600 12px/1 system-ui,sans-serif;color:#6957ff}'
  + '[contenteditable=true]{-webkit-user-select:text;user-select:text;cursor:text;outline:none}[contenteditable=true] *{-webkit-user-select:text;user-select:text}[contenteditable=true] a{cursor:text}';

export function createCanvas({ frame, overlay, onPointerDown, onHover, onKey, onHandleDown, onGuideDown, getHandles, getColumnHandles = () => false, onScroll, onContextMenu = () => {}, onDoubleClick = () => {} }) {
  let currentScale = 1, doc = null, page = null, hoverId = null, selectedId = null, others = [], ready = null, scheduled = false;
  let gesture = null, gridlines = false, guides = { x: [], y: [] }, editingId = null;
  // Which tab panel is shown and which accordion items are open in the editor (not saved).
  const shownTabs = new Map(), openItems = new Set();
  const year = new Date().getFullYear(), cssCache = createCssCache();
  const frameDoc = () => frame.contentDocument;
  const element = id => id ? frameDoc()?.getElementById(id) : null;
  const target = event => event.target?.closest?.('.n');
  const layer = name => {
    let item = overlay.querySelector('.' + name);
    if (!item) { item = document.createElement('div'); item.className = name; overlay.append(item); }
    return item;
  };

  function boot() {
    ready = new Promise(resolve => {
      frame.addEventListener('load', () => {
        const d = frameDoc();
        d.addEventListener('pointermove', event => {
          if (gesture) return;
          const id = target(event)?.id || null;
          if (id !== hoverId) { hoverId = id; onHover(id); schedule(); }
        });
        d.addEventListener('pointerleave', () => { hoverId = null; onHover(null); schedule(); });
        d.addEventListener('pointerdown', event => { if (event.button === 0) onPointerDown(event, target(event)?.id || null); }, true);
        d.addEventListener('click', event => event.preventDefault(), true);
        d.addEventListener('contextmenu', event => { event.preventDefault(); onContextMenu(event, target(event)?.id || null); });
        d.addEventListener('dblclick', event => onDoubleClick(event, target(event)?.id || null));
        d.addEventListener('submit', event => event.preventDefault(), true);
        d.addEventListener('dragstart', event => event.preventDefault(), true);
        d.addEventListener('keydown', event => onKey(event));
        d.addEventListener('scroll', () => { schedule(); onScroll?.(); }, { passive: true });
        d.addEventListener('load', schedule, true);
        resolve();
      }, { once: true });
    });
    frame.srcdoc = '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'
      + '<link rel="stylesheet" href="/assets/public-v2.css"><style id="nimble-site"></style><style>' + EDITOR_CSS + '</style></head>'
      + '<body><div id="nimble-root"></div></body></html>';
    new ResizeObserver(schedule).observe(frame);
    overlay.addEventListener('pointerdown', event => {
      const handle = event.target.closest('[data-handle]');
      if (handle) { event.preventDefault(); event.stopPropagation(); onHandleDown(event, handle.dataset.handle); return; }
      const guide = event.target.closest('[data-guide]');
      if (guide) { event.preventDefault(); onGuideDown(event, guide.dataset.guide, Number(guide.dataset.index)); }
    });
  }
  const options = () => ({ year, inlineEmbeds: true });
  function applyPanels() {
    const d = frameDoc();
    for (const [tabsId, childId] of shownTabs) {
      const tabs = d.getElementById(tabsId);
      if (!tabs || !d.getElementById('panel-' + childId)) { shownTabs.delete(tabsId); continue; }
      for (const button of tabs.querySelectorAll(':scope > .tab-list > [role=tab]')) {
        const on = button.getAttribute('aria-controls') === 'panel-' + childId;
        button.setAttribute('aria-selected', String(on));
        d.getElementById(button.getAttribute('aria-controls')).hidden = !on;
      }
    }
    for (const childId of openItems) {
      const details = element(childId)?.parentElement?.closest('details.acc-item');
      if (details) details.open = true; else openItems.delete(childId);
    }
  }
  // Shows the tab panel or opens the accordion item that contains an element.
  function revealPanels(id) {
    let el = element(id);
    while (el) {
      const panel = el.closest('.tab-panel'), details = el.closest('details.acc-item');
      if (panel) shownTabs.set(panel.closest('[data-tabs]').id, panel.id.slice(6));
      if (details) openItems.add(details.querySelector(':scope > .acc-body > .n').id);
      el = (panel || details)?.parentElement || null;
      if (!panel && !details) break;
    }
    applyPanels();
  }
  function css() { frameDoc().getElementById('nimble-site').textContent = siteCss(doc, pageRoots(doc, page), cssCache); }
  function renderAll() {
    const d = frameDoc();
    d.documentElement.lang = doc.site.lang;
    const header = doc.header && page.showHeader ? renderNode(doc, doc.header, page, options()) : '';
    const footer = doc.footer && page.showFooter ? renderNode(doc, doc.footer, page, options()) : '';
    d.getElementById('nimble-root').innerHTML = header + '<main id="content">' + page.children.map(id => renderNode(doc, id, page, options())).join('') + '</main>' + footer;
    applyPanels();
    css();
  }
  // Re-renders only the changed elements; falls back to a full render when an element is not on screen yet.
  function renderSome(changed) {
    // Panel titles live in the tabs/accordion markup, so a changed panel re-renders its host.
    const ids = new Set(changed);
    for (const id of changed) { const host = element(id)?.parentElement?.closest('.tab-panel,.acc-body')?.closest('.t-tabs,.t-accordion'); if (host) ids.add(host.id); }
    const roots = [...ids].filter(id => doc.nodes[id]);
    const skip = new Set();
    for (const id of roots) {
      for (let parent = element(id)?.parentElement?.closest('.n'); parent; parent = parent.parentElement?.closest('.n')) if (ids.has(parent.id)) skip.add(id);
    }
    for (const id of roots) {
      // The text being edited inline keeps its editable DOM; the editor re-renders it when done.
      if (skip.has(id) || id === editingId) continue;
      const current = element(id);
      if (!current) return renderAll();
      current.outerHTML = renderNode(doc, id, page, options());
    }
    applyPanels();
    css();
  }
  function schedule() {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => { scheduled = false; draw(); });
  }
  function place(item, b, rotation = 0) {
    Object.assign(item.style, { left: b.left + 'px', top: b.top + 'px', width: b.width + 'px', height: b.height + 'px', transform: rotation ? 'rotate(' + rotation + 'deg)' : '' });
  }
  function drawSelection() {
    const node = doc?.nodes[selectedId], el = element(selectedId);
    let item = overlay.querySelector('.ov-select');
    if (!node || !el || !el.getClientRects().length) { item?.remove(); return; }
    if (!item) { item = document.createElement('div'); item.className = 'ov-box ov-select'; item.innerHTML = '<span class="ov-tag"></span>'; overlay.append(item); }
    const b = layoutBox(el), rotation = rotationOf(el);
    place(item, b, rotation);
    item.classList.toggle('ov-locked', !!node.locked);
    const tag = item.querySelector('.ov-tag');
    tag.textContent = (node.locked ? '🔒 ' : '') + label(node) + (others.length ? ' +' + others.length : '');
    tag.classList.toggle('ov-tag-below', b.top < 22 / currentScale);
    const handles = gesture || others.length ? [] : getHandles(selectedId);
    // Sections are moved by dragging their name tag.
    const movable = handles.includes('move');
    tag.classList.toggle('ov-tag-drag', movable);
    if (movable) { tag.dataset.handle = 'move'; tag.title = 'Drag to move the section up or down'; } else { delete tag.dataset.handle; tag.removeAttribute('title'); }
    const key = handles.join(',');
    if (item.dataset.handles !== key) {
      item.querySelectorAll('.ov-handle,.ov-rotate').forEach(handle => handle.remove());
      for (const name of handles) {
        if (name === 'move') continue;
        const handle = document.createElement('span');
        handle.className = name === 'rotate' ? 'ov-rotate' : 'ov-handle ov-' + name;
        handle.dataset.handle = name;
        handle.title = name === 'rotate' ? 'Rotate (Shift: 15° steps)' : 'Resize (Shift: keep ratio, Alt: from centre)';
        item.append(handle);
      }
      item.dataset.handles = key;
    }
  }
  function drawOthers() {
    const layerEl = layer('ov-multi');
    const boxes = others.map(id => element(id)).filter(el => el && el.getClientRects().length);
    while (layerEl.children.length > boxes.length) layerEl.lastChild.remove();
    while (layerEl.children.length < boxes.length) { const item = document.createElement('div'); item.className = 'ov-box ov-also'; layerEl.append(item); }
    boxes.forEach((el, i) => place(layerEl.children[i], layoutBox(el), rotationOf(el)));
  }
  function drawHover() {
    const el = hoverId !== selectedId && !gesture ? element(hoverId) : null;
    let item = overlay.querySelector('.ov-hover');
    if (!el || !el.getClientRects().length) { item?.remove(); return; }
    if (!item) { item = document.createElement('div'); item.className = 'ov-box ov-hover'; overlay.append(item); }
    place(item, layoutBox(el), rotationOf(el));
  }
  function drawGrid() {
    let el = element(selectedId);
    if (el && !isGrid(el)) el = el.parentElement?.closest('.n');
    if (!gridlines || !el || !isGrid(el)) { overlay.querySelector('.ov-grid')?.remove(); return; }
    const geo = gridGeometry(el), item = layer('ov-grid');
    item.innerHTML = geo.columns.map(([start, end]) => '<i class="ov-track" style="left:' + start + 'px;width:' + (end - start) + 'px;top:' + geo.content.top + 'px;height:' + geo.content.height + 'px"></i>').join('')
      + geo.rows.map(([start, end]) => '<i class="ov-track ov-row" style="top:' + start + 'px;height:' + (end - start) + 'px;left:' + geo.content.left + 'px;width:' + geo.content.width + 'px"></i>').join('');
  }
  // Dividers between the columns of a selected grid container; dragging one resizes the two columns.
  function drawColumnHandles() {
    const el = element(selectedId);
    if (gesture?.keepColumns !== true && (gesture || !el || !isGrid(el) || !getColumnHandles(selectedId))) { overlay.querySelector('.ov-cols')?.remove(); return; }
    if (!el || !isGrid(el)) return;
    const geo = gridGeometry(el), item = layer('ov-cols');
    item.innerHTML = geo.columns.slice(0, -1).map(([, end], i) => {
      const next = geo.columns[i + 1][0];
      return '<i class="ov-col-handle" data-handle="col:' + i + '" title="Drag to resize columns" style="left:' + (end + next) / 2 + 'px;top:' + geo.content.top + 'px;height:' + geo.content.height + 'px"></i>';
    }).join('');
  }
  function drawGuides() {
    const win = frameDoc().defaultView, item = layer('ov-guides');
    const key = JSON.stringify(guides) + ':' + win.scrollX + ':' + win.scrollY;
    if (item.dataset.key === key) return;
    item.dataset.key = key;
    item.innerHTML = guides.x.map((x, index) => '<i class="ov-guide ov-guide-x" data-guide="x" data-index="' + index + '" style="left:' + (x - win.scrollX) + 'px"></i>').join('')
      + guides.y.map((y, index) => '<i class="ov-guide ov-guide-y" data-guide="y" data-index="' + index + '" style="top:' + (y - win.scrollY) + 'px"></i>').join('');
  }
  const rectStyle = (x1, y1, x2, y2) => 'left:' + Math.min(x1, x2) + 'px;top:' + Math.min(y1, y2) + 'px;width:' + Math.abs(x2 - x1) + 'px;height:' + Math.abs(y2 - y1) + 'px';
  function drawGesture() {
    const item = layer('ov-gesture');
    if (!gesture) { item.innerHTML = ''; return; }
    let html = '';
    if (gesture.marquee) html += '<i class="ov-marquee" style="' + rectStyle(gesture.marquee.left, gesture.marquee.top, gesture.marquee.right, gesture.marquee.bottom) + '"></i>';
    if (gesture.target) html += '<i class="ov-target" style="' + rectStyle(gesture.target.left, gesture.target.top, gesture.target.right, gesture.target.bottom) + '"></i>';
    if (gesture.insert) html += '<i class="ov-insert" style="' + rectStyle(gesture.insert.x1, gesture.insert.y1, gesture.insert.x2, gesture.insert.y2) + '"></i>';
    for (const line of gesture.lines || []) html += '<i class="ov-line ov-line-' + line.kind + '" style="' + rectStyle(line.x1, line.y1, line.x2, line.y2) + '"></i>';
    for (const mark of gesture.labels || []) {
      html += '<i class="ov-measure" style="' + rectStyle(mark.x1, mark.y1, mark.x2, mark.y2) + '"></i><b class="ov-label" style="left:' + (mark.x1 + mark.x2) / 2 + 'px;top:' + (mark.y1 + mark.y2) / 2 + 'px">' + mark.text + '</b>';
    }
    if (gesture.info) html += '<b class="ov-info" style="left:' + gesture.info.x + 'px;top:' + gesture.info.y + 'px">' + gesture.info.text + '</b>';
    item.innerHTML = html;
  }
  function draw() {
    if (!doc || !frameDoc()) return;
    drawHover(); drawOthers(); drawSelection(); drawGrid(); drawColumnHandles(); drawGuides(); drawGesture();
  }
  boot();
  return {
    ready: () => ready,
    async render(nextDoc, nextPage, ids = null) {
      await ready;
      const pageChanged = page?.id !== nextPage.id;
      doc = nextDoc; page = nextPage;
      if (!ids || pageChanged) renderAll(); else renderSome(ids);
      schedule();
    },
    select(id, { reveal = false, also = [] } = {}) {
      selectedId = id; others = also.filter(item => item !== id);
      if (id) revealPanels(id);
      if (reveal) element(id)?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
      schedule();
    },
    hover(id) { hoverId = id; schedule(); },
    // Lays the page out at `width` CSS pixels and scales it down to fit the visible area.
    setViewport(width, available, height) {
      const scale = Math.min(1, available / width), wrap = frame.parentElement, stage = wrap.parentElement;
      Object.assign(wrap.style, { width: width + 'px', height: Math.max(400, height / scale) + 'px', transform: scale < 1 ? 'scale(' + scale + ')' : '' });
      Object.assign(stage.style, { width: Math.round(width * scale) + 'px', height: Math.max(400 * scale, height) + 'px' });
      currentScale = scale;
      overlay.style.setProperty('--ov-scale', String(1 / scale));
      schedule();
      onScroll?.();
      return scale;
    },
    get scale() { return currentScale; },
    // Parent-document pointer coordinates → iframe viewport coordinates.
    toFrame(clientX, clientY) { const r = frame.getBoundingClientRect(); return { x: (clientX - r.left) / currentScale, y: (clientY - r.top) / currentScale }; },
    viewport() { const win = frameDoc().defaultView; return { width: win.innerWidth, height: win.innerHeight, scrollX: win.scrollX, scrollY: win.scrollY }; },
    document: frameDoc,
    frame,
    element,
    setGesture(next) { gesture = next; schedule(); },
    setGridlines(on) { gridlines = on; schedule(); },
    setEditing(id) { editingId = id; schedule(); },
    // Clicking a tab or an accordion title in the editor shows that panel.
    showPanel(childId, toggle = false) {
      const details = element(childId)?.parentElement?.closest('details.acc-item');
      if (toggle && details?.open) { details.open = false; openItems.delete(childId); schedule(); return; }
      revealPanels(childId); schedule();
    },
    setGuides(next) { guides = next; schedule(); },
    redraw: schedule
  };
}
