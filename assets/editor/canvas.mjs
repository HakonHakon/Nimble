// Canvas: the page renders inside a sandboxed same-origin iframe with the exact published HTML and CSS,
// so breakpoint media queries apply for real. Selection chrome lives in an overlay above the iframe.
import { renderNode, siteCss, pageRoots } from '/assets/render-v2.mjs';
import { label } from './tree.mjs';

const EDITOR_CSS = 'html,body{min-height:100%}iframe,video{pointer-events:none}a,button,summary{cursor:default}'
  + '.t-section:empty,.t-container:empty{min-height:72px;outline:1px dashed #c8c5d7;outline-offset:-1px}'
  + '.t-image:empty{min-height:120px;background:repeating-linear-gradient(45deg,#f1f0f6 0 10px,#e7e5f0 10px 20px)}'
  + '.t-text:empty{min-height:1.4em}';

export function createCanvas({ frame, overlay, onSelect, onHover, onKey }) {
  let currentScale = 1, doc = null, page = null, hoverId = null, selectedId = null, ready = null, scheduled = false;
  const year = new Date().getFullYear();
  const frameDoc = () => frame.contentDocument;
  const element = id => id ? frameDoc()?.getElementById(id) : null;
  const target = event => event.target?.closest?.('.n');

  function boot() {
    ready = new Promise(resolve => {
      frame.addEventListener('load', () => {
        const d = frameDoc();
        d.addEventListener('pointermove', event => { const id = target(event)?.id || null; if (id !== hoverId) { hoverId = id; onHover(id); schedule(); } });
        d.addEventListener('pointerleave', () => { hoverId = null; onHover(null); schedule(); });
        d.addEventListener('click', event => { event.preventDefault(); const id = target(event)?.id || null; onSelect(id, { source: 'canvas', event }); }, true);
        d.addEventListener('submit', event => event.preventDefault(), true);
        d.addEventListener('dragstart', event => event.preventDefault(), true);
        d.addEventListener('keydown', event => onKey(event));
        d.addEventListener('scroll', schedule, { passive: true });
        d.addEventListener('load', schedule, true);
        resolve();
      }, { once: true });
    });
    frame.srcdoc = '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'
      + '<link rel="stylesheet" href="/assets/public-v2.css"><style id="nimble-site"></style><style>' + EDITOR_CSS + '</style></head>'
      + '<body><div id="nimble-root"></div></body></html>';
    new ResizeObserver(schedule).observe(frame);
    addEventListener('resize', schedule);
  }
  const options = () => ({ year });
  function css() { frameDoc().getElementById('nimble-site').textContent = siteCss(doc, pageRoots(doc, page)); }
  function renderAll() {
    const d = frameDoc();
    d.documentElement.lang = doc.site.lang;
    const header = doc.header && page.showHeader ? renderNode(doc, doc.header, page, options()) : '';
    const footer = doc.footer && page.showFooter ? renderNode(doc, doc.footer, page, options()) : '';
    d.getElementById('nimble-root').innerHTML = header + '<main id="content">' + page.children.map(id => renderNode(doc, id, page, options())).join('') + '</main>' + footer;
    css();
  }
  // Re-renders only the changed elements; falls back to a full render when an element is not on screen yet.
  function renderSome(ids) {
    const roots = [...ids].filter(id => doc.nodes[id]);
    const skip = new Set();
    for (const id of roots) {
      let parent = element(id)?.parentElement?.closest('.n');
      for (; parent; parent = parent.parentElement?.closest('.n')) if (ids.has(parent.id)) skip.add(id);
    }
    for (const id of roots) {
      if (skip.has(id)) continue;
      const current = element(id);
      if (!current) return renderAll();
      current.outerHTML = renderNode(doc, id, page, options());
    }
    css();
  }
  function schedule() {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => { scheduled = false; draw(); });
  }
  function box(className, id, withTag) {
    const node = doc?.nodes[id], el = element(id);
    let item = overlay.querySelector('.' + className);
    if (!node || !el || !el.getClientRects().length) { item?.remove(); return; }
    if (!item) { item = document.createElement('div'); item.className = 'ov-box ' + className; overlay.append(item); }
    const rect = el.getBoundingClientRect();
    Object.assign(item.style, { left: rect.left + 'px', top: rect.top + 'px', width: rect.width + 'px', height: rect.height + 'px' });
    item.classList.toggle('ov-locked', !!node.locked);
    if (withTag) {
      let tag = item.querySelector('.ov-tag');
      if (!tag) { tag = document.createElement('span'); tag.className = 'ov-tag'; item.append(tag); }
      tag.textContent = (node.locked ? '🔒 ' : '') + label(node);
      tag.classList.toggle('ov-tag-below', rect.top < 22 / currentScale);
    }
  }
  function draw() {
    if (!doc || !frameDoc()) return;
    box('ov-hover', hoverId !== selectedId ? hoverId : null, false);
    box('ov-select', selectedId, true);
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
    select(id, { reveal = false } = {}) {
      selectedId = id;
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
      return scale;
    },
    element,
    redraw: schedule
  };
}
