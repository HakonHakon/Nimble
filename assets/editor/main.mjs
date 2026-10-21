// Nimble v2 editor: wires the command store, iframe canvas, layers, inspector and side panels together.
import { normalizeSite } from '/assets/site-model.mjs';
import { migrateV1 } from '/assets/migrate-v1.mjs';
import { escapeHtml as esc } from '/assets/render-v2.mjs';
import { createStore } from './store.mjs';
import { createCanvas } from './canvas.mjs';
import { createLayers } from './layers.mjs';
import { createInspector } from './inspector.mjs';
import { createAddPanel, createPagesPanel } from './panels.mjs';
import { createTransformer } from './transform.mjs';
import { createRulers } from './rulers.mjs';
import { createArranger } from './arrange.mjs';
import { createMenu, shortcutSheet } from './menu.mjs';
import { createMediaPanel, createSitePanel, createTemplates } from './site-panels.mjs';
import { indexTree, ancestors, descendants, listOf, label } from './tree.mjs';

const $ = selector => document.querySelector(selector);
const app = { store: null, user: null, role: 'viewer', csrf: '', revision: 0, loaded: false, locked: false, dirty: false, pageId: 'home', bp: 'desktop', selected: null, selection: [], tool: 'layers', converted: false };
let saveTimer = null, saving = null, cachedIndex = null, cachedFor = null, transformer = null, rulers = null, arranger = null, menu = null;
const prefs = (() => { try { return { snap: true, rulers: true, grid: false, ...JSON.parse(localStorage.getItem('nimble-editor-prefs') || '{}') }; } catch { return { snap: true, rulers: true, grid: false }; } })();
const savePrefs = () => { try { localStorage.setItem('nimble-editor-prefs', JSON.stringify(prefs)); } catch {} };

const editable = () => app.loaded && !app.locked && ['owner', 'admin', 'editor'].includes(app.role);
const doc = () => app.store.doc;
const page = () => doc().pages.find(item => item.id === app.pageId) || doc().pages[0];
const bpIds = () => ['desktop', ...doc().breakpoints.map(bp => bp.id)];
function index() {
  if (cachedFor !== doc()) { cachedIndex = indexTree(doc()); cachedFor = doc(); }
  return cachedIndex;
}
const draftKey = () => 'nimble-editor-draft-v1-' + app.user.id;

function status(message, error = false) { const element = $('#saveState'); element.textContent = message; element.classList.toggle('error', error); }
function toast(message) {
  const element = document.createElement('div'); element.className = 'toast'; element.setAttribute('role', 'status'); element.textContent = message;
  $('#toastRoot').replaceChildren(element); setTimeout(() => element.remove(), 6000);
}
function banner(html, kind = 'info') {
  const element = $('#banner');
  element.className = 'banner ' + kind; element.innerHTML = html; element.hidden = !html;
}
async function api(url, options = {}) {
  const response = await fetch(url, { ...options, headers: { 'Content-Type': 'application/json', ...(app.csrf ? { 'X-CSRF-Token': app.csrf } : {}), ...(options.headers || {}) } });
  if (response.status === 401) { location.assign('/login.html?next=/editor.html'); throw new Error('Please sign in again.'); }
  const type = response.headers.get('content-type') || '';
  const result = type.includes('json') ? await response.json() : await response.text();
  if (!response.ok) throw Object.assign(new Error(result?.error || 'Request failed.'), { status: response.status });
  return result;
}

// Saving: debounced PUT with optimistic revision locking, plus a local draft for crash recovery.
function localDraft() { try { localStorage.setItem(draftKey(), JSON.stringify({ document: doc(), dirty: app.dirty, revision: app.revision, updatedAt: Date.now() })); } catch {} }
function markDirty() {
  app.dirty = true; localDraft(); status('Unsaved changes');
  clearTimeout(saveTimer); saveTimer = setTimeout(() => flushSave().catch(() => {}), 700);
}
async function flushSave() {
  clearTimeout(saveTimer);
  if (saving) { await saving; if (app.dirty) return flushSave(); return; }
  if (!app.dirty || !editable()) return;
  const snapshot = doc();
  app.dirty = false; status('Saving…');
  saving = (async () => {
    try {
      const result = await api('/api/site', { method: 'PUT', headers: { 'If-Match': '"' + app.revision + '"' }, body: JSON.stringify(snapshot) });
      app.revision = result.revision;
      if (app.converted) { app.converted = false; banner(''); }
      localDraft(); status(app.dirty ? 'Unsaved changes' : 'All changes saved');
    } catch (error) {
      app.dirty = true;
      if ([409, 428].includes(error.status)) { app.locked = true; banner('Someone else saved a newer version. Your changes are kept in this browser. <button class="btn btn-small" data-reload>Reload latest</button>', 'error'); renderChrome(); }
      localDraft(); status(error.message, true); toast(error.message); throw error;
    } finally { saving = null; }
  })();
  await saving;
  if (app.dirty && !app.locked) return flushSave();
}

function commit(ops, options) {
  if (!editable()) { toast(app.locked ? 'Reload the latest saved site before editing.' : 'You have read-only access.'); return false; }
  try { return app.store.commit(ops, options); }
  catch (error) { toast(error.message); renderPanels(); return false; }
}
// The selection is a list of element ids; `selected` is the primary one (last clicked) that the
// inspector and handles act on. Parents and children are never selected together.
function applySelection(ids, primary, { source = 'api', reveal = source !== 'canvas' } = {}) {
  const valid = ids.filter((id, i) => doc().nodes[id] && ids.indexOf(id) === i);
  const chosen = valid.filter(id => !valid.some(other => other !== id && ancestors(index(), id).includes(other)));
  app.selection = chosen;
  app.selected = chosen.includes(primary) ? primary : chosen[chosen.length - 1] || null;
  canvas.select(app.selected, { reveal, also: app.selection });
  if (app.tool === 'layers') layers.updateSelection(); else renderPanels();
  inspector.render();
  if (source !== 'layers') layers.reveal();
  else layers.focusSelected();
}
function select(id, { source = 'api', reveal, toggle = false } = {}) {
  if (toggle && id) {
    if (app.selection.includes(id)) return applySelection(app.selection.filter(item => item !== id), null, { source, reveal });
    // Adding an element replaces its selected ancestors or descendants.
    const keep = app.selection.filter(item => !ancestors(index(), id).includes(item) && !ancestors(index(), item).includes(id));
    return applySelection([...keep, id], id, { source, reveal });
  }
  applySelection(id ? [id] : [], id, { source, reveal });
}
function selectMany(ids, primary = ids[ids.length - 1]) { applySelection(ids, primary, { source: 'api', reveal: false }); }
function remove(id) {
  if (!id || !editable()) return;
  const where = index().get(id), list = listOf(doc(), index(), id);
  if (!list) return toast('Headers and footers can be hidden per page, not deleted.');
  const siblings = list.items.filter(item => item !== id);
  const next = siblings[Math.min(list.items.indexOf(id), siblings.length - 1)] || where.parent;
  if (commit([{ path: list.path, value: siblings }, ...descendants(doc(), id).map(item => ({ path: ['nodes', item], value: undefined }))], { label: 'Delete ' + label(doc().nodes[id]) })) select(next || null);
}
async function upload(kind) {
  const input = $('#fileInput');
  input.accept = kind === 'video' ? 'video/mp4,video/webm' : 'image/*';
  const file = await new Promise(resolve => { input.onchange = () => resolve(input.files[0]); input.click(); });
  input.value = '';
  if (!file || !editable()) return null;
  if (file.size > 15 * 1024 * 1024) { toast('Choose a file smaller than 15 MB.'); return null; }
  status('Uploading…');
  try {
    const data = await new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = reject; reader.readAsDataURL(file); });
    const asset = await api('/api/media', { method: 'POST', body: JSON.stringify({ name: file.name, data }) });
    const id = 'asset-' + crypto.randomUUID().replaceAll('-', '').slice(0, 12);
    commit([{ path: ['assets'], value: [{ ...asset, id }, ...doc().assets] }], { label: 'Upload' });
    return asset.url;
  } catch (error) { status('Upload failed', true); toast(error.message); return null; }
}

const ctx = {
  state: () => ({ doc: doc(), page: page(), pageIndex: doc().pages.indexOf(page()), bp: app.bp, bpIds: bpIds(), selected: app.selected, selection: app.selection, index: index() }),
  commit, select, selectMany, remove, upload, editable, toast,
  arrange: action => arranger.run(action),
  canArrange: action => arranger.available(action),
  api: (url, options) => api(url, options),
  dialog: (title, html) => showDialog(title, html),
  closeDialog: () => closeDialog(),
  contextMenu: (x, y) => menu.open(x, y),
  refresh: () => inspector.render(),
  showLayout: () => inspector.setTab('layout'),
  snapping: () => prefs.snap,
  guides: () => rulers ? rulers.guides : { x: [], y: [] },
  openPage(id) { app.pageId = id; app.selected = null; app.selection = []; canvas.select(null); canvas.render(doc(), page()); renderPanels(); renderChrome(); rulers.load(); }
};

const canvas = createCanvas({
  frame: $('#canvasFrame'), overlay: $('#canvasOverlay'),
  onPointerDown: (event, id) => transformer.pointerDown(event, id),
  onHandleDown: (event, handle) => transformer.handleDown(event, handle),
  onGuideDown: (event, axis, position) => rulers.beginGuideDrag(event, axis, position),
  getHandles: id => transformer ? transformer.handles(id) : [],
  getColumnHandles: id => transformer ? transformer.columnHandles(id) : false,
  onScroll: () => rulers?.draw(),
  onHover: id => { document.querySelectorAll('.layer-row.hovered').forEach(row => row.classList.remove('hovered')); if (id) document.querySelector('.layer-row[data-id="' + CSS.escape(id) + '"]')?.classList.add('hovered'); },
  onKey: event => keyboard(event),
  onContextMenu: (event, id) => {
    if (id && !app.selection.includes(id)) select(id, { source: 'canvas' });
    const r = $('#canvasFrame').getBoundingClientRect();
    menu.open(r.left + event.clientX * canvas.scale, r.top + event.clientY * canvas.scale);
  }
});
transformer = createTransformer(canvas, ctx);
arranger = createArranger(canvas, transformer, ctx);
menu = createMenu(arranger);
rulers = createRulers({ area: $('.canvas-area'), canvas, key: () => 'nimble-guides-' + (app.store ? page().id : 'home') + '-' + app.bp });
const layers = createLayers($('#layersPanel'), ctx);
const inspector = createInspector($('#inspector'), ctx);
const addPanel = createAddPanel($('#addPanel'), ctx);
const pagesPanel = createPagesPanel($('#pagesPanel'), ctx);
const mediaPanel = createMediaPanel($('#mediaPanel'), ctx);
const sitePanel = createSitePanel($('#sitePanel'), ctx);
const templates = createTemplates(ctx);

function deviceWidth(bp) {
  const available = $('#canvasScroll').clientWidth - 48;
  const list = doc().breakpoints;
  if (bp === 'desktop') return Math.max((list[0]?.max ?? 0) + 1, Math.min(1440, Math.max(available, 1280)));
  const at = list.findIndex(item => item.id === bp), low = (list[at + 1]?.max ?? 319) + 1, high = list[at].max;
  return Math.max(low, Math.min(high, at === list.length - 1 ? 390 : 820));
}
function renderChrome() {
  const site = doc();
  $('#siteName').textContent = site.site.name;
  $('#pageSelect').innerHTML = site.pages.map(item => '<option value="' + esc(item.id) + '"' + (item.id === page().id ? ' selected' : '') + '>' + esc(item.name) + '</option>').join('');
  $('#devices').innerHTML = bpIds().map(id => {
    const bp = site.breakpoints.find(item => item.id === id);
    return '<button data-bp="' + esc(id) + '" aria-pressed="' + (app.bp === id) + '" title="' + esc(bp ? bp.name + ' (≤' + bp.max + 'px)' : 'Desktop') + '">' + esc(bp ? bp.name : 'Desktop') + '</button>';
  }).join('');
  updateViewport();
  $('#undoBtn').disabled = !editable() || !app.store.canUndo;
  $('#redoBtn').disabled = !editable() || !app.store.canRedo;
  $('#publishBtn').disabled = !editable();
  for (const [id, on] of [['#snapToggle', prefs.snap], ['#rulerToggle', prefs.rulers], ['#gridToggle', prefs.grid]]) $(id).setAttribute('aria-pressed', String(on));
  document.querySelectorAll('.rail-button[data-tool]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.tool === app.tool)));
  document.querySelectorAll('.tool-panel').forEach(panel => { panel.hidden = panel.dataset.panel !== app.tool; });
}
function updateViewport() {
  const scroll = $('#canvasScroll'), width = deviceWidth(app.bp);
  const scale = canvas.setViewport(width, scroll.clientWidth - 48, scroll.clientHeight - 40);
  $('#widthLabel').textContent = width + 'px' + (scale < 1 ? ' · ' + Math.round(scale * 100) + '%' : '');
  rulers.draw();
}
function renderPanels() {
  if (app.tool === 'layers') layers.render();
  if (app.tool === 'pages') pagesPanel.render();
  if (app.tool === 'media') mediaPanel.render();
  if (app.tool === 'site') sitePanel.render();
  inspector.render();
}

function keyboard(event) {
  const typing = event.target.closest?.('input,textarea,select,[contenteditable=true]');
  const mod = event.ctrlKey || event.metaKey;
  if (mod && event.key.toLowerCase() === 's') { event.preventDefault(); flushSave().catch(() => {}); return; }
  if (typing) return;
  if (mod && event.key.toLowerCase() === 'z') { event.preventDefault(); if (editable()) event.shiftKey ? app.store.redo() : app.store.undo(); return; }
  if (mod && event.key.toLowerCase() === 'y') { event.preventDefault(); if (editable()) app.store.redo(); return; }
  if ((event.key === 'Delete' || event.key === 'Backspace') && app.selected) { event.preventDefault(); arranger.run('delete'); return; }
  if (mod) {
    const k = event.key.toLowerCase();
    const map = event.altKey ? { c: 'copyStyle', v: 'pasteStyle' } : event.shiftKey ? { g: 'ungroup', l: 'lock', h: 'hide', ']': 'front', '}': 'front', '[': 'back', '{': 'back' } : { c: 'copy', x: 'cut', v: 'paste', d: 'duplicate', g: 'group', a: 'selectAll', ']': 'forward', '[': 'backward' };
    const code = event.code === 'BracketRight' ? ']' : event.code === 'BracketLeft' ? '[' : event.code === 'KeyC' ? 'c' : event.code === 'KeyV' ? 'v' : k;
    const action = map[code];
    if (action) { event.preventDefault(); arranger.run(action); return; }
  }
  if (event.key === '?' && !mod) { event.preventDefault(); showDialog('Keyboard shortcuts', shortcutSheet()); return; }
  const arrows = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
  if (arrows[event.key] && app.selected && !event.target.closest?.('.layers')) {
    event.preventDefault();
    const [dx, dy] = arrows[event.key], step = event.shiftKey ? 10 : 1;
    transformer.nudge(dx * step, dy * step);
    return;
  }
  if (event.key === 'Escape' && transformer.cancel()) return;
  if (event.key === 'Escape') { if (menu.isOpen) return menu.close(); if ($('#modalRoot').firstChild) return closeDialog(); if (app.selection.length > 1) return select(app.selected); const parent = index().get(app.selected)?.parent; select(parent || null); }
}
document.addEventListener('keydown', keyboard);

function showDialog(title, html) {
  $('#modalRoot').innerHTML = '<div class="modal-layer"><section class="modal" role="dialog" aria-modal="true" aria-label="' + esc(title) + '"><div class="modal-top"><h2>' + esc(title) + '</h2><button class="btn" data-close>Close</button></div>' + html + '</section></div>';
  $('#modalRoot [data-close]').onclick = closeDialog;
}
function closeDialog() { $('#modalRoot').replaceChildren(); }
async function preview(pageId = app.pageId) {
  try {
    const html = (await api('/api/preview', { method: 'POST', body: JSON.stringify({ site: doc(), pageId }) })).replace('<script defer src="/assets/public.js"></script>', '');
    showDialog('Preview', '<iframe class="preview-frame" title="Website preview" sandbox="allow-same-origin"></iframe>');
    const frame = $('.preview-frame'); frame.srcdoc = html;
    frame.onload = () => frame.contentDocument?.addEventListener('click', event => {
      const link = event.target.closest('a'); if (!link) return;
      event.preventDefault();
      const target = doc().pages.find(item => link.getAttribute('href') === (item.id === 'home' ? './' : './' + item.id + '.html'));
      if (target) preview(target.id);
    });
  } catch (error) { toast(error.message); }
}
async function publish() {
  if (!editable()) return;
  $('#publishBtn').disabled = true;
  try {
    await flushSave();
    const result = await api('/api/publish', { method: 'POST', body: JSON.stringify({ revision: app.revision }) });
    showDialog('Published', '<p>Your changes are live.</p><a class="btn btn-primary" href="' + esc(result.publicUrl || result.url) + '" target="_blank" rel="noopener">Open website ↗</a>');
  } catch (error) { toast(error.message); }
  finally { $('#publishBtn').disabled = !editable(); }
}

document.addEventListener('click', event => {
  const bp = event.target.closest('[data-bp]');
  if (bp && bp.closest('#devices')) { app.bp = bp.dataset.bp; renderChrome(); inspector.render(); layers.render(); rulers.load(); return; }
  const toggle = event.target.closest('[data-pref]');
  if (toggle) {
    prefs[toggle.dataset.pref] = !prefs[toggle.dataset.pref]; savePrefs();
    rulers.setVisible(prefs.rulers); canvas.setGridlines(prefs.grid); renderChrome();
    return;
  }
  const tool = event.target.closest('.rail-button[data-tool]');
  if (tool) { app.tool = tool.dataset.tool; renderChrome(); renderPanels(); return; }
  if (event.target.closest('#undoBtn')) return app.store.undo();
  if (event.target.closest('#redoBtn')) return app.store.redo();
  if (event.target.closest('#previewBtn')) return preview();
  if (event.target.closest('#templatesBtn')) return templates.open();
  if (event.target.closest('#helpBtn')) return showDialog('Keyboard shortcuts', shortcutSheet());
  if (event.target.closest('#publishBtn')) return publish();
  if (event.target.closest('[data-reload]')) { try { localStorage.removeItem(draftKey()); } catch {} return location.reload(); }
});
$('#pageSelect').addEventListener('change', event => ctx.openPage(event.target.value));
$('#layersPanel').addEventListener('mouseover', event => canvas.hover(event.target.closest('.layer-row')?.dataset.id || null));
$('#layersPanel').addEventListener('mouseleave', () => canvas.hover(null));
new ResizeObserver(() => { if (app.loaded) updateViewport(); }).observe($('#canvasScroll'));
addEventListener('beforeunload', event => { if (app.dirty) { localDraft(); event.preventDefault(); } });

function onChange({ ids, reason }) {
  app.selection = app.selection.filter(id => doc().nodes[id]);
  if (app.selected && !doc().nodes[app.selected]) app.selected = app.selection[app.selection.length - 1] || null;
  if (!doc().pages.some(item => item.id === app.pageId)) app.pageId = 'home';
  canvas.render(doc(), page(), ids);
  canvas.select(app.selected, { also: app.selection });
  renderPanels(); renderChrome();
  if (reason !== 'replace') markDirty();
}

async function bootstrap() {
  status('Loading…');
  try {
    const identity = await api('/api/auth/me');
    Object.assign(app, { user: identity.user, csrf: identity.csrf, role: identity.role });
    const result = await api('/api/site');
    const source = result.site;
    if (source.version !== 2) {
      app.converted = true;
      banner('This site was made with the classic builder. It is shown here in the new format; your first change saves it in that format, after which the classic builder can no longer open it. <a href="/builder.html">Back to the classic builder</a>', 'info');
    }
    app.store = createStore(source.version === 2 ? source : migrateV1(normalizeSite(source)), { onChange });
    app.revision = result.revision; app.loaded = true;
    $('#userAvatar').textContent = app.user.name.split(/\s+/).map(word => word[0]).join('').slice(0, 2).toUpperCase();
    status(editable() ? 'All changes saved' : 'Read-only access');
    renderChrome(); renderPanels();
    await canvas.render(doc(), page());
    rulers.setVisible(prefs.rulers); canvas.setGridlines(prefs.grid); rulers.load();
    let draft;
    try { draft = JSON.parse(localStorage.getItem(draftKey())); } catch {}
    if (draft?.dirty && editable()) {
      showDialog('Recover unsaved work?', '<p>Changes from an earlier session did not reach the server.</p><div class="modal-actions"><button class="btn btn-primary" data-recover>Recover draft</button><button class="btn" data-discard>Keep saved site</button></div>');
      $('[data-recover]').onclick = () => { closeDialog(); try { app.store.replace(draft.document); markDirty(); } catch (error) { toast(error.message); } };
      $('[data-discard]').onclick = () => { closeDialog(); localDraft(); };
    }
  } catch (error) {
    status('Could not load your site. Reload to retry.', true);
    toast(error.message);
  }
}
bootstrap();
window.nimbleEditor = { get doc() { return app.store?.doc; }, get selected() { return app.selected; }, get selection() { return app.selection.slice(); }, get bp() { return app.bp; } };
