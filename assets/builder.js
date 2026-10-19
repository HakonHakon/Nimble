import { normalizeSite, makeDefaultSite, escapeHtml as esc, themes, fonts, safeUrl, videoSource } from '/assets/site-model.mjs';
import { renderBlock as publicBlock } from '/assets/render.mjs';

const $ = selector => document.querySelector(selector);
const copy = value => structuredClone(value);
const state = { document: makeDefaultSite(), pageId: 'home', selectedId: null, tool: 'build', device: 'desktop', user: null, role: 'viewer', csrf: '', revision: 0, loaded: false, dirty: false, locked: false, history: [], future: [], zoom: 100 };
let saveTimer, saving;
const page = () => state.document.pages.find(page => page.id === state.pageId) || state.document.pages[0];
const selected = () => state.document.blocks[state.selectedId];
const editable = () => state.loaded && !state.locked && ['owner', 'admin', 'editor'].includes(state.role);
const newId = prefix => prefix + '_' + crypto.randomUUID().replaceAll('-', '').slice(0, 16);
const snapshot = () => copy(state.document);
const draftKey = () => 'nimble-draft-v2-' + state.user.id;
const input = (field, label, value = '', extra = '') => '<div class="field"><label>' + esc(label) + '<input data-field="' + field + '" value="' + esc(value) + '" ' + extra + '></label></div>';
const area = (field, label, value = '') => '<div class="field"><label>' + esc(label) + '<textarea data-field="' + field + '">' + esc(value) + '</textarea></label></div>';
function status(message, error = false) {
  const element = $('.save-state');
  element.textContent = message;
  element.style.color = error ? '#aa2626' : '';
  element.setAttribute('role', 'status');
}
function toast(message) {
  $('#toastRoot').replaceChildren();
  const element = document.createElement('div'); element.className = 'toast'; element.textContent = message;
  $('#toastRoot').append(element);
  setTimeout(() => element.remove(), 6500);
}
async function api(url, options = {}) {
  const response = await fetch(url, { ...options, headers: { 'Content-Type': 'application/json', ...(state.csrf ? { 'X-CSRF-Token': state.csrf } : {}), ...(options.headers || {}) } });
  if (response.status === 401) { location.assign('/login.html?next=/builder.html'); throw new Error('Please sign in again.'); }
  let result;
  try { result = await response.json(); } catch { throw new Error('The server returned an invalid response.'); }
  if (!response.ok) throw Object.assign(new Error(result.error || 'Request failed.'), { status: response.status });
  return result;
}
function localDraft() {
  try { localStorage.setItem(draftKey(), JSON.stringify({ document: snapshot(), dirty: state.dirty, revision: state.revision, updatedAt: Date.now() })); } catch {}
}
function change(operation) {
  if (!editable()) return toast(state.locked ? 'Reload the latest saved site before editing.' : 'You have read-only access.');
  const before = snapshot();
  try {
    operation();
    state.document = normalizeSite(state.document);
    state.history.push(before); if (state.history.length > 50) state.history.shift();
    state.future = [];
    markDirty(); render();
  } catch (error) { state.document = before; toast(error.message); render(); }
}
function markDirty() {
  state.dirty = true; localDraft(); status('Unsaved changes');
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => flushSave().catch(() => {}), 500);
}
async function flushSave() {
  clearTimeout(saveTimer);
  if (saving) { await saving; if (state.dirty) return flushSave(); return; }
  if (!state.dirty || !editable()) return;
  const document = snapshot();
  state.dirty = false; status('Saving…');
  saving = (async () => {
    try {
      const result = await api('/api/site', { method: 'PUT', headers: { 'If-Match': '"' + state.revision + '"' }, body: JSON.stringify(document) });
      state.revision = result.revision;
      if (JSON.stringify(state.document) === JSON.stringify(document)) state.document = result.site;
      localDraft(); status(state.dirty ? 'Unsaved changes' : 'All changes saved');
    } catch (error) {
      state.dirty = true;
      if ([409, 428].includes(error.status)) state.locked = true;
      localDraft(); status(error.message, true); toast(error.message); throw error;
    } finally { saving = null; }
  })();
  await saving;
  if (state.dirty && !state.locked) return flushSave();
}
function hydrate(payload) {
  const document = Array.isArray(payload?.pages) ? payload : payload?.site;
  state.document = normalizeSite(document);
  state.pageId = state.document.pages.some(page => page.id === state.pageId) ? state.pageId : 'home';
  state.selectedId = page().blocks[0] || null;
}
async function bootstrap() {
  status('Loading…');
  try {
    const identity = await api('/api/auth/me');
    Object.assign(state, { user: identity.user, csrf: identity.csrf, role: identity.role });
    const result = await api('/api/site');
    hydrate(result.site); state.revision = result.revision; state.loaded = true;
    $('#userAvatar').textContent = state.user.name.split(/\s+/).map(word => word[0]).join('').slice(0, 2).toUpperCase();
    status(editable() ? 'All changes saved' : 'Read-only access');
    $('#publishBtn').disabled = !editable();
    render();
    let draft;
    try { draft = JSON.parse(localStorage.getItem(draftKey())); } catch {}
    if (draft?.dirty && editable()) {
      showDialog('Recover unsaved work?', '<p>A local draft did not reach the server. Recover it or keep the saved website.</p>', [
        ['Recover draft', () => { change(() => { state.document = normalizeSite(draft.document); }); closeDialog(); }],
        ['Keep saved site', () => { localDraft(); closeDialog(); }]
      ]);
    }
  } catch (error) { status('Could not load your site. Reload to retry.', true); toast(error.message); $('#publishBtn').disabled = true; }
}
function render() {
  if ($('#workspaceName')) $('#workspaceName').textContent = state.document.site.name;
  renderLeft(); renderCanvas(); renderInspector();
  document.querySelectorAll('.rail-button[data-tool]').forEach(button => button.classList.toggle('active', button.dataset.tool === state.tool));
  $('#undoBtn').disabled = !editable() || !state.history.length;
  $('#redoBtn').disabled = !editable() || !state.future.length;
}
function renderLeft() {
  const heading = (title, help) => '<h2 class="panel-title">' + title + '</h2><p class="panel-subtitle">' + help + '</p>';
  let html = '';
  if (state.tool === 'build') html = heading('Add blocks', 'Drag a block to any “Drop here” position on your page.') + '<div class="component-list">' + ['hero', 'text', 'image', 'button', 'video', 'services', 'split', 'cta', 'gallery', 'columns', 'quote', 'form'].map(type => '<button class="component" draggable="' + editable() + '" data-add="' + type + '">' + esc(type[0].toUpperCase() + type.slice(1)) + '</button>').join('') + '<div class="tip"><strong>Build by dragging</strong>Drag a block onto a drop zone to place it exactly where you want. You can also click a block to add it at the end.</div>';
  if (state.tool === 'pages') html = heading('Pages', 'Each page has its own content.') + '<button class="btn" data-action="add-page">+ Add page</button><div class="page-list">' + state.document.pages.map(item => '<div class="page-item ' + (item.id === state.pageId ? 'active' : '') + '"><button data-page="' + item.id + '">' + esc(item.name) + '</button><button class="mini-btn" title="Page settings" data-page-settings="' + item.id + '">⋯</button></div>').join('') + '<p class="panel-subtitle">All pages appear in your navigation automatically.</p>';
  if (state.tool === 'media') html = heading('Media', 'Images and videos, stored in your library.') + '<button class="upload" data-action="upload">+ Upload media</button><div class="asset-grid">' + state.document.assets.map(asset => '<button class="asset" data-asset="' + asset.id + '">' + (asset.kind === 'image' ? '<img class="asset-image" src="' + esc(safeUrl(asset.url)) + '" alt="">' : '<span class="asset-image">▶ Video</span>') + '<span class="asset-name">' + esc(asset.name) + '</span></button>').join('') + '</div><p class="panel-subtitle">PNG, JPG, GIF, WebP, MP4 or WebM. Up to 15 MB per file. Larger videos can use a YouTube or Vimeo link.</p>';
  if (state.tool === 'styles') html = heading('Site styles', 'Changes apply to every page.') + '<div class="theme-grid">' + Object.entries(themes).map(([name, color]) => '<button class="theme-swatch ' + (state.document.theme === name ? 'selected' : '') + '" data-theme="' + name + '" style="background:' + color + '" title="' + name + '"></button>').join('') + settingSelect('headingFont', 'Heading font', fonts) + settingSelect('bodyFont', 'Body font', fonts) + '<label class="settings-row"><input type="checkbox" data-site-setting="rounded" ' + (state.document.site.rounded ? 'checked' : '') + '> Rounded corners</label>';
  if (state.tool === 'settings') html = heading('Site settings', 'Your name, search results and social sharing.') + '<div class="settings-row"><label>Website name<input data-site-setting="name" maxlength="120" value="' + esc(state.document.site.name) + '"></label></div><div class="settings-row"><label>Search description<textarea data-site-setting="description" maxlength="2000">' + esc(state.document.site.description) + '</textarea></label></div><div class="settings-row"><label>Social image URL<input data-site-setting="socialImage" value="' + esc(state.document.site.socialImage) + '" placeholder="https://… or choose an upload URL"></label></div><label class="settings-row"><input type="checkbox" data-site-setting="searchVisible" ' + (state.document.site.searchVisible ? 'checked' : '') + '> Allow search engines to index this site</label><div class="tip"><a href="/" target="_blank" rel="noopener">Open your published website ↗</a></div><button class="btn" data-action="export">Export draft</button><button class="btn" data-action="import">Import draft</button><button class="btn" data-action="retry-save">Retry save</button>';
  $('#leftPanel').innerHTML = html;
}
function settingSelect(field, label, values) {
  return '<div class="settings-row"><label>' + label + '<select data-site-setting="' + field + '">' + Object.keys(values).map(value => '<option value="' + value + '" ' + (state.document.site[field] === value ? 'selected' : '') + '>' + ({ sans: 'Modern sans', serif: 'Classic serif', mono: 'Monospace' }[value]) + '</option>').join('') + '</select></label></div>';
}
function renderCanvas() {
  const canvas = $('#siteCanvas'), site = state.document;
  $('#pageName').textContent = page().name;
  canvas.className = 'site-canvas ' + state.device;
  canvas.style.setProperty('--accent', themes[site.theme]);
  canvas.style.setProperty('--radius', site.site.rounded ? '14px' : '0px');
  canvas.style.fontFamily = fonts[site.site.bodyFont];
  const dropZone = beforeId => {
    const label = beforeId ? 'Drop block before ' + (site.blocks[beforeId]?.type || 'this block') : 'Drop block at the end of this page';
    return '<div class="drop-zone" data-drop-zone data-drop-before="' + esc(beforeId || '') + '" role="button" tabindex="0" aria-label="' + esc(label) + '"><span>Drop here</span></div>';
  };
  const blocks = page().blocks.map(id => dropZone(id) + '<div class="canvas-block ' + (state.selectedId === id ? 'selected' : '') + '" data-block-id="' + esc(id) + '" draggable="false"><span class="block-label">' + esc(site.blocks[id].type) + '</span><span class="block-drag-handle" data-drag-handle draggable="' + editable() + '" title="Drag to move this block" role="button" tabindex="0" aria-label="Drag ' + esc(site.blocks[id].type) + ' block">⠿</span>' + publicBlock(site, site.blocks[id]) + '</div>').join('');
  canvas.innerHTML = '<nav class="site-nav"><span class="site-logo">' + esc(site.site.name) + '</span><div class="site-links">' + site.pages.map(item => '<button data-page="' + item.id + '">' + esc(item.name) + '</button>').join('') + '</div></nav>' + blocks + dropZone('') + '<button class="add-section" data-action="add-text">+ Add section</button>';
  canvas.querySelectorAll('h1,h2,h3').forEach(element => { element.style.fontFamily = fonts[site.site.headingFont]; });
}
function renderInspector() {
  const block = selected();
  if (!block) { $('#inspector').innerHTML = '<div class="empty-inspector">Select a block on the page to edit it.</div>'; return; }
  let fields = '';
  if (!['image', 'button', 'gallery'].includes(block.type)) fields += input('title', 'Heading', block.title);
  if (['hero', 'text', 'split', 'video', 'cta', 'services', 'columns', 'quote', 'form'].includes(block.type)) fields += area('text', block.type === 'quote' ? 'Quote' : 'Supporting text', block.text);
  if (block.type === 'hero') fields += input('eyebrow', 'Small heading', block.eyebrow);
  if (['hero', 'split', 'cta', 'button'].includes(block.type)) {
    fields += input(block.type === 'button' ? 'label' : 'button', 'Button text', block.type === 'button' ? block.label : block.button);
    fields += input('buttonLink', 'Link: page, web, email or phone', block.buttonLink, 'list="pageLinks"') + '<datalist id="pageLinks">' + state.document.pages.map(item => '<option value="' + item.path + '">' + esc(item.name) + '</option>').join('') + '</datalist>';
  }
  if (['image', 'split', 'video'].includes(block.type)) fields += input('image', block.type === 'video' ? 'Poster image URL' : 'Image URL', block.image, 'list="mediaLinks"') + '<datalist id="mediaLinks">' + state.document.assets.filter(asset => asset.kind === 'image').map(asset => '<option value="' + esc(asset.url) + '">' + esc(asset.name) + '</option>').join('') + '</datalist>' + input('alt', 'Image description', block.alt);
  if (block.type === 'video') fields += input('videoUrl', 'MP4, WebM, YouTube or Vimeo URL', block.videoUrl);
  if (block.type === 'quote') fields += input('author', 'Attribution', block.author);
  if (['services', 'columns'].includes(block.type)) {
    fields += '<h3>Cards</h3>' + (block.cards || []).map((card, index) => '<div class="field"><label>Card ' + (index + 1) + ' heading<input data-card="' + index + '" data-part="0" value="' + esc(card[0]) + '"></label><label>Description<textarea data-card="' + index + '" data-part="1">' + esc(card[1]) + '</textarea></label><button class="btn" data-remove-card="' + index + '">Remove card</button></div>').join('') + '<button class="btn" data-action="add-card">+ Add card</button>';
  }
  if (block.type === 'gallery') fields += area('images', 'Image URLs, one per line', (block.images || []).join('\n')) + input('alt', 'Image description', block.alt);
  if (block.type === 'form') fields += '<p>Messages are saved securely in the <a href="/control-panel.html#inbox">team inbox</a>.</p>';
  fields += '<div class="field"><label>Background<input type="color" data-field="bg" value="' + esc(block.bg || '#ffffff') + '"></label></div>';
  $('#inspector').innerHTML = '<div class="inspector-header"><h2 class="inspector-title">Edit ' + esc(block.type) + '</h2><button class="btn inspector-dismiss" data-action="close-inspector">Done</button></div><div class="inspector-section">' + fields + '</div><div class="inspector-section"><p class="panel-subtitle">Drag the ⠿ handle on this block to any “Drop here” position on the page.</p><button class="btn" data-action="duplicate-block">Duplicate</button><button class="btn" data-action="delete-block">Delete block</button></div>';
  $('#inspector').querySelectorAll('input,textarea,button').forEach(element => { if (!editable() && element.dataset.action !== 'close-inspector') element.disabled = true; });
}
function blockDefault(type) {
  const block = { id: newId(type), type, title: 'Your heading', text: 'Tell your story in your own words.' };
  if (['hero', 'split', 'cta'].includes(type)) Object.assign(block, { button: 'Get in touch', buttonLink: '#contact' });
  if (type === 'hero') block.eyebrow = 'NIMBLE';
  if (type === 'button') Object.assign(block, { label: 'Learn more', buttonLink: '/' });
  if (['services', 'columns'].includes(type)) block.cards = [['First', 'Your first point.'], ['Second', 'Your second point.'], ['Third', 'Your third point.']];
  if (type === 'quote') block.author = 'A happy client';
  if (type === 'gallery') block.images = state.document.assets.filter(asset => asset.kind === 'image').slice(0, 6).map(asset => asset.url);
  return block;
}
function addBlock(type, asset, beforeId) {
  change(() => {
    const block = blockDefault(type);
    if (asset) block[asset.kind === 'video' ? 'videoUrl' : 'image'] = asset.url;
    state.document.blocks[block.id] = block;
    const index = beforeId ? page().blocks.indexOf(beforeId) : page().blocks.length;
    page().blocks.splice(Math.max(0, index), 0, block.id); state.selectedId = block.id;
  });
  if (innerWidth <= 760 && editable()) document.body.classList.add('inspector-open');
}
function showDialog(title, html, actions = []) {
  const footer = actions.length ? '<div class="modal-footer">' + actions.map((action, index) => '<button class="btn ' + (index === 0 ? 'btn-primary' : '') + '" data-dialog-action="' + index + '">' + esc(action[0]) + '</button>').join('') + '</div>' : '';
  $('#modalRoot').innerHTML = '<div class="modal-layer"><section class="modal" role="dialog" aria-modal="true" aria-label="' + esc(title) + '"><div class="modal-top"><h2>' + esc(title) + '</h2><button class="btn" data-close>Close</button></div><div class="dialog-content">' + html + '</div>' + footer + '</section></div>';
  $('#modalRoot').querySelector('[data-close]').onclick = closeDialog;
  $('#modalRoot').querySelectorAll('[data-dialog-action]').forEach(button => { button.onclick = () => actions[Number(button.dataset.dialogAction)][1](); });
  $('#modalRoot').querySelector('input,button')?.focus();
}
function closeDialog() { $('#modalRoot').replaceChildren(); }
function pageSettings(id) {
  const item = state.document.pages.find(page => page.id === id);
  showDialog('Page settings', '<label>Page name<input id="editPageName" maxlength="120" value="' + esc(item.name) + '"></label>' + (id === 'home' ? '' : '<label>Page address<input id="editPagePath" value="' + esc(item.path) + '"></label>'), [
    ['Save', () => { const name = $('#editPageName').value.trim(), address = $('#editPagePath')?.value; change(() => { item.name = name; if (address) item.path = address; }); closeDialog(); }],
    ['Duplicate page', () => { duplicatePage(item); closeDialog(); }],
    ...(id === 'home' ? [] : [['Delete page', () => { change(() => { state.document.pages = state.document.pages.filter(page => page.id !== id); state.pageId = 'home'; state.selectedId = page().blocks[0]; }); closeDialog(); }]])
  ]);
}
function uniquePageId(name) {
  const base = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 50) || 'page';
  let id = /^[a-z]/.test(base) ? base : 'page-' + base, index = 1;
  while (state.document.pages.some(page => page.id === id)) id = base + '-' + (++index);
  return id;
}
function duplicatePage(item) {
  change(() => {
    const id = uniquePageId(item.name + ' copy'), blocks = item.blocks.map(blockId => {
      const block = copy(state.document.blocks[blockId]); block.id = newId(block.type);
      state.document.blocks[block.id] = block; return block.id;
    });
    state.document.pages.push({ id, name: item.name + ' copy', path: '/' + id, blocks }); state.pageId = id; state.selectedId = blocks[0];
  });
}
function addPage() {
  showDialog('Add page', '<label>Page name<input id="newPageName" maxlength="120" placeholder="About us"></label>', [
    ['Create page', () => { const name = $('#newPageName').value.trim(); if (!name) return; change(() => {
      const id = uniquePageId(name), block = blockDefault('text'); block.title = name;
      state.document.blocks[block.id] = block; state.document.pages.push({ id, name, path: '/' + id, blocks: [block.id] }); state.pageId = id; state.selectedId = block.id; state.tool = 'pages';
    }); closeDialog(); }]
  ]);
}
const builtInTemplates = [
  { name: 'Studio', description: 'A polished starting point for a service business.', theme: 'purple', title: 'Make good things happen.', tone: 't1' },
  { name: 'Build', description: 'Bold sections for a project, product or team.', theme: 'orange', title: 'Build it properly.', tone: 't2' },
  { name: 'Minimal', description: 'A calm, focused layout for a clear message.', theme: 'mint', title: 'Good things, made clear.', tone: 't3' }
];
function templatePreview(tone = 't1') {
  return '<div class="template-preview ' + esc(tone) + '"><div class="fake-browser"><div class="fake-dots"><i></i><i></i><i></i></div><div class="fake-hero"></div><div class="fake-lines"></div><div class="fake-lines short"></div></div></div>';
}
function templateCard(template, index, builtIn = false) {
  const document = template.document || {};
  const pages = Array.isArray(document.pages) ? document.pages.length : 0;
  const blockCount = document.blocks && typeof document.blocks === 'object' ? Object.keys(document.blocks).length : 0;
  const tone = template.tone || ['t1', 't2', 't3'][index % 3];
  const controls = builtIn
    ? '<button class="btn btn-primary" data-template-built-in="' + index + '">Use template</button>'
    : '<button class="btn btn-primary" data-template-apply="' + esc(template.id) + '">Apply</button><button class="btn" data-template-edit="' + esc(template.id) + '">Edit</button><button class="btn" data-template-delete="' + esc(template.id) + '">Delete</button>';
  return '<article class="template-card template-card-manager">' + templatePreview(tone) + '<div class="template-copy"><span class="template-badge">' + (builtIn ? 'Built-in' : 'Saved template') + '</span><h3>' + esc(template.name) + '</h3><span>' + esc(template.description || (pages + ' pages · ' + blockCount + ' blocks')) + '</span><div class="template-card-actions">' + controls + '</div></div></article>';
}
function applyBuiltInTemplate(index) {
  const template = builtInTemplates[index];
  if (!template) return;
  change(() => {
    const name = state.document.site.name;
    state.document = makeDefaultSite();
    state.document.site.name = name || 'Nimble';
    state.document.theme = template.theme;
    state.document.blocks.hero.title = template.title;
    state.pageId = 'home'; state.selectedId = 'hero';
  });
  closeDialog(); toast('Template applied. You can undo it from the top bar.');
}
async function saveTemplateFromDialog(id = '') {
  const name = $('#templateName')?.value.trim() || '';
  const description = $('#templateDescription')?.value.trim() || '';
  if (!name) { toast('Add a template name first.'); $('#templateName')?.focus(); return; }
  try {
    const options = { method: id ? 'PUT' : 'POST', body: JSON.stringify({ name, description, ...(id ? {} : { document: snapshot() }) }) };
    await api('/api/templates' + (id ? '/' + encodeURIComponent(id) : ''), options);
    closeDialog(); toast(id ? 'Template updated.' : 'Template saved.'); templates();
  } catch (error) { toast(error.message); }
}
function editTemplate(template = null) {
  const name = template?.name || '';
  const description = template?.description || '';
  showDialog(template ? 'Edit template' : 'Save current as template', '<p>' + (template ? 'Update the name or description for this saved template.' : 'Save a copy of your current pages, blocks, links and media choices for your team.') + '</p><label>Template name<input id="templateName" maxlength="120" value="' + esc(name) + '" placeholder="Consulting launch"></label><label>Description<textarea id="templateDescription" maxlength="500" placeholder="A short note to help your team choose it later.">' + esc(description) + '</textarea></label>', [['Save template', () => saveTemplateFromDialog(template?.id || '')], ['Cancel', closeDialog]]);
}
async function applySavedTemplate(id) {
  if (!editable()) return toast('Only editors can apply templates.');
  status('Applying template…');
  try {
    const result = await api('/api/templates');
    const template = (result.templates || []).find(item => item.id === id);
    if (!template?.document) { status('Template unavailable', true); return toast('That template is no longer available.'); }
    change(() => { state.document = normalizeSite(template.document); state.pageId = 'home'; state.selectedId = page().blocks[0] || null; });
    closeDialog(); toast('Template applied. Your previous design is available with Undo.');
  } catch (error) { status(error.message, true); toast(error.message); }
}
async function deleteTemplate(id, name) {
  if (!window.confirm('Delete the saved template “' + name + '”?')) return;
  try { await api('/api/templates/' + encodeURIComponent(id), { method: 'DELETE' }); toast('Template deleted.'); templates(); }
  catch (error) { toast(error.message); }
}
async function templates() {
  if (!editable()) return toast('Only editors can manage templates.');
  try {
    const result = await api('/api/templates');
    const custom = result.templates || [];
    const builtIns = builtInTemplates.map((template, index) => templateCard(template, index, true)).join('');
    const saved = custom.length ? custom.map((template, index) => templateCard(template, index)).join('') : '<div class="template-empty">No saved templates yet. Save your current design to make one for the team.</div>';
    showDialog('Template manager', '<div class="template-manager-head"><div><p>Start from a built-in design or reuse a saved layout. Applying a template replaces the current draft; Undo brings it back.</p></div><button class="btn btn-primary" data-template-save>Save current as template</button></div><h3 class="template-section-title">Built-in templates</h3><div class="template-grid">' + builtIns + '</div><h3 class="template-section-title">Your saved templates</h3><div class="template-grid">' + saved + '</div>', []);
    $('#modalRoot').querySelector('[data-template-save]').onclick = () => editTemplate();
    $('#modalRoot').querySelectorAll('[data-template-built-in]').forEach(button => { button.onclick = () => applyBuiltInTemplate(Number(button.dataset.templateBuiltIn)); });
    $('#modalRoot').querySelectorAll('[data-template-apply]').forEach(button => { button.onclick = () => applySavedTemplate(button.dataset.templateApply); });
    $('#modalRoot').querySelectorAll('[data-template-edit]').forEach(button => { button.onclick = () => editTemplate(custom.find(template => template.id === button.dataset.templateEdit)); });
    $('#modalRoot').querySelectorAll('[data-template-delete]').forEach(button => { button.onclick = () => { const item = custom.find(template => template.id === button.dataset.templateDelete); deleteTemplate(button.dataset.templateDelete, item?.name || 'this template'); }; });
  } catch (error) { toast(error.message); }
}
async function preview(pageId = state.pageId) {
  try {
    const response = await fetch('/api/preview', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': state.csrf }, body: JSON.stringify({ site: snapshot(), pageId }) });
    if (!response.ok) { const data = await response.json(); throw new Error(data.error || 'Preview unavailable.'); }
    const html = (await response.text()).replace('<script defer src="/assets/public.js"></script>', '');
    showDialog('Preview', '<p>Preview uses the same layout as your published pages. Forms are disabled here.</p><iframe class="website-preview" title="Website preview" sandbox="allow-same-origin allow-scripts"></iframe>', [['Done', closeDialog]]);
    const frame = $('.website-preview'); frame.srcdoc = html;
    frame.onload = () => { frame.contentDocument?.querySelectorAll('a').forEach(link => {
      link.addEventListener('click', event => {
        event.preventDefault();
        const target = state.document.pages.find(page => link.getAttribute('href') === (page.id === 'home' ? './' : './' + page.id + '.html'));
        if (target) preview(target.id);
      });
    }); };
  } catch (error) { toast(error.message); }
}
async function publish() {
  if (!editable()) return;
  $('#publishBtn').disabled = true;
  try { await flushSave(); const result = await api('/api/publish', { method: 'POST', body: JSON.stringify({ revision: state.revision }) }); toast('Your website is published.'); showDialog('Published', '<p>Your changes are live.</p><a class="btn btn-primary" href="' + esc(result.url) + '" target="_blank" rel="noopener">Open website ↗</a>', [['Back to editing', closeDialog]]); }
  catch (error) { toast(error.message); }
  finally { $('#publishBtn').disabled = !editable(); }
}
async function upload(file) {
  if (!file || !editable()) return;
  if (file.size > 15 * 1024 * 1024) return toast('Choose a file smaller than 15 MB.');
  status('Uploading…');
  try {
    const data = await new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = reject; reader.readAsDataURL(file); });
    const asset = await api('/api/media', { method: 'POST', body: JSON.stringify({ name: file.name, data }) });
    change(() => { state.document.assets.unshift({ ...asset, id: newId('asset') }); state.tool = 'media'; });
    toast('Upload complete.');
  } catch (error) { status('Upload failed', true); toast(error.message); }
  finally { $('#fileInput').value = ''; }
}
function exportDraft() {
  const link = document.createElement('a'); const url = URL.createObjectURL(new Blob([JSON.stringify(snapshot(), null, 2)], { type: 'application/json' }));
  link.href = url; link.download = 'nimble-draft.json'; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}
document.addEventListener('click', event => {
  const target = event.target.closest('button,[data-page]');
  if (event.target.closest('#siteCanvas a,#siteCanvas form')) event.preventDefault();
  const block = event.target.closest('[data-block-id]');
  if (block) { state.selectedId = block.dataset.blockId; renderInspector(); if (innerWidth <= 760) document.body.classList.add('inspector-open'); $('#siteCanvas').querySelectorAll('[data-block-id]').forEach(element => element.classList.toggle('selected', element === block)); }
  if (!target) return;
  if (target.dataset.page) { state.pageId = target.dataset.page; state.selectedId = page().blocks[0]; render(); return; }
  if (target.dataset.pageSettings) return pageSettings(target.dataset.pageSettings);
  if (target.dataset.add) return addBlock(target.dataset.add);
  if (target.dataset.asset) { const asset = state.document.assets.find(asset => asset.id === target.dataset.asset); return addBlock(asset.kind, asset); }
  if (target.dataset.theme) return change(() => { state.document.theme = target.dataset.theme; });
  if (target.dataset.removeCard) return change(() => selected().cards.splice(Number(target.dataset.removeCard), 1));
  if (target.dataset.tool) { state.tool = target.dataset.tool; document.body.classList.remove('inspector-open'); render(); if (innerWidth <= 760) $('#leftPanel').scrollIntoView({ block: 'start' }); return; }
  const actions = {
    'add-page': addPage, 'add-text': () => addBlock('text'), upload: () => $('#fileInput').click(), 'close-inspector': () => document.body.classList.remove('inspector-open'),
    'add-card': () => change(() => { if (!selected().cards) selected().cards = []; selected().cards.push(['Heading', 'Description']); }),
    'delete-block': () => change(() => { page().blocks = page().blocks.filter(id => id !== state.selectedId); state.selectedId = page().blocks[0]; }),
    'duplicate-block': () => change(() => { const block = copy(selected()); block.id = newId(block.type); state.document.blocks[block.id] = block; page().blocks.splice(page().blocks.indexOf(state.selectedId) + 1, 0, block.id); state.selectedId = block.id; }),
    export: exportDraft,
    import: () => { const picker = document.createElement('input'); picker.type = 'file'; picker.accept = '.json'; picker.onchange = async () => { try { const document = normalizeSite(JSON.parse(await picker.files[0].text())); change(() => { state.document = document; state.pageId = 'home'; state.selectedId = page().blocks[0]; }); } catch (error) { toast(error.message); } }; picker.click(); },
    'retry-save': () => flushSave().catch(error => toast(error.message))
  };
  actions[target.dataset.action]?.();
});
document.addEventListener('change', event => {
  const element = event.target;
  if (element.dataset.field) change(() => { const field = element.dataset.field; selected()[field] = field === 'images' ? element.value.split('\n').map(value => value.trim()).filter(Boolean) : element.value; });
  if (element.dataset.card !== undefined) change(() => { selected().cards[Number(element.dataset.card)][Number(element.dataset.part)] = element.value; });
  if (element.dataset.siteSetting) change(() => { state.document.site[element.dataset.siteSetting] = element.type === 'checkbox' ? element.checked : element.value; });
});
const clearDropIndicators = () => document.querySelectorAll('.drop-zone.drag-over').forEach(zone => zone.classList.remove('drag-over'));
function reorderBlock(move, before) {
  if (!move || move === before) return;
  change(() => {
    const blocks = page().blocks, from = blocks.indexOf(move);
    if (from < 0) return;
    blocks.splice(from, 1);
    const target = before ? blocks.indexOf(before) : blocks.length;
    blocks.splice(Math.max(0, target), 0, move); state.selectedId = move;
  });
}
let pointerDrag = null;
document.addEventListener('pointerdown', event => {
  const handle = event.target.closest('[data-drag-handle]'), block = handle?.closest('[data-block-id]');
  if (!handle || !block || !editable() || event.button !== 0) return;
  pointerDrag = { id: block.dataset.blockId, pointerId: event.pointerId, zone: null };
  handle.setPointerCapture?.(event.pointerId); block.classList.add('dragging'); event.preventDefault();
});
document.addEventListener('pointermove', event => {
  if (!pointerDrag || event.pointerId !== pointerDrag.pointerId) return;
  event.preventDefault();
  const scroll = $('.canvas-scroll'), scrollBox = scroll?.getBoundingClientRect();
  if (scroll && scrollBox) {
    if (event.clientY > scrollBox.bottom - 70) scroll.scrollTop += 18;
    if (event.clientY < scrollBox.top + 70) scroll.scrollTop = Math.max(0, scroll.scrollTop - 18);
  }
  const element = document.elementFromPoint(event.clientX, event.clientY), zone = element?.closest?.('[data-drop-zone]');
  if (zone && $('#siteCanvas').contains(zone)) { clearDropIndicators(); zone.classList.add('drag-over'); pointerDrag.zone = zone; }
  else { clearDropIndicators(); pointerDrag.zone = null; }
});
function finishPointerDrag(cancel = false) {
  if (!pointerDrag) return;
  const { id, zone } = pointerDrag; pointerDrag = null; clearDropIndicators();
  document.querySelector('[data-block-id="' + CSS.escape(id) + '"]')?.classList.remove('dragging');
  if (!cancel && zone) reorderBlock(id, zone.dataset.dropBefore || null);
}
document.addEventListener('pointerup', event => { if (pointerDrag && event.pointerId === pointerDrag.pointerId) finishPointerDrag(); });
document.addEventListener('pointercancel', event => { if (pointerDrag && event.pointerId === pointerDrag.pointerId) finishPointerDrag(true); });
document.addEventListener('dragstart', event => {
  if (!editable()) return event.preventDefault();
  const type = event.target.closest('[data-add]')?.dataset.add;
  const id = event.target.closest('[data-block-id]')?.dataset.blockId;
  if (type) { event.dataTransfer.setData('nimble/type', type); event.dataTransfer.effectAllowed = 'copy'; event.target.closest('[data-add]')?.classList.add('dragging'); }
  if (id) { event.dataTransfer.setData('nimble/block', id); event.dataTransfer.effectAllowed = 'move'; event.target.closest('[data-block-id]')?.classList.add('dragging'); }
});
document.addEventListener('dragend', event => { event.target.closest('[data-add],[data-block-id]')?.classList.remove('dragging'); clearDropIndicators(); });
$('#siteCanvas').addEventListener('dragenter', event => {
  const zone = event.target.closest('[data-drop-zone]');
  if (!editable() || !zone) return;
  event.preventDefault(); clearDropIndicators(); zone.classList.add('drag-over');
});
$('#siteCanvas').addEventListener('dragover', event => {
  const zone = event.target.closest('[data-drop-zone]');
  if (!editable() || !zone) return;
  event.preventDefault(); event.dataTransfer.dropEffect = Array.from(event.dataTransfer.types).includes('nimble/block') ? 'move' : 'copy';
  clearDropIndicators(); zone.classList.add('drag-over');
});
$('#siteCanvas').addEventListener('drop', event => {
  const zone = event.target.closest('[data-drop-zone]');
  if (!editable() || !zone) return;
  event.preventDefault();
  clearDropIndicators();
  const before = zone.dataset.dropBefore || null;
  const type = event.dataTransfer.getData('nimble/type'), move = event.dataTransfer.getData('nimble/block');
  if (type) return addBlock(type, null, before);
  if (move) reorderBlock(move, before);
});
$('#fileInput').addEventListener('change', event => upload(event.target.files[0]));
$('#leftPanel').addEventListener('dragover', event => { if (state.tool === 'media') event.preventDefault(); });
$('#leftPanel').addEventListener('drop', event => { if (state.tool === 'media') { event.preventDefault(); upload(event.dataTransfer.files[0]); } });
$('#templateBtn').addEventListener('click', templates);
$('#previewBtn').addEventListener('click', () => preview());
$('#publishBtn').addEventListener('click', publish);
$('#helpBtn').addEventListener('click', () => toast('Add a block, select it, and edit its text, links or media. Your changes save automatically.'));
$('#undoBtn').addEventListener('click', () => { if (!editable() || !state.history.length) return; state.future.push(snapshot()); state.document = state.history.pop(); state.pageId = state.document.pages.some(page => page.id === state.pageId) ? state.pageId : 'home'; state.selectedId = page().blocks[0]; markDirty(); render(); });
$('#redoBtn').addEventListener('click', () => { if (!editable() || !state.future.length) return; state.history.push(snapshot()); state.document = state.future.pop(); state.pageId = state.document.pages.some(page => page.id === state.pageId) ? state.pageId : 'home'; state.selectedId = page().blocks[0]; markDirty(); render(); });
document.querySelectorAll('[data-device]').forEach(button => button.addEventListener('click', () => { state.device = button.dataset.device; document.querySelectorAll('[data-device]').forEach(item => item.classList.toggle('active', item === button)); renderCanvas(); }));
function zoom(delta) { state.zoom = Math.max(60, Math.min(120, state.zoom + delta)); $('#siteCanvas').style.zoom = state.zoom / 100; $('#zoomLabel').textContent = state.zoom + '%'; }
$('#zoomIn').addEventListener('click', () => zoom(10)); $('#zoomOut').addEventListener('click', () => zoom(-10));
window.addEventListener('beforeunload', event => { if (state.dirty) { localDraft(); event.preventDefault(); event.returnValue = ''; } });
document.addEventListener('keydown', event => { if (event.key === 'Escape') closeDialog(); if ((event.ctrlKey || event.metaKey) && event.key === 's') { event.preventDefault(); flushSave().catch(() => {}); } });
bootstrap();
