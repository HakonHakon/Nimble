// Site-wide panels: Media library, Site (settings, colours, fonts) and Templates/import/export.
import { escapeHtml as esc } from '/assets/render-v2.mjs';
import { normalizeSite, makeDefaultSite } from '/assets/site-model.mjs';
import { migrateV1 } from '/assets/migrate-v1.mjs';
import { createNode, insertionTarget } from './tree.mjs';

const TOP_KEYS = ['site', 'design', 'breakpoints', 'assets', 'header', 'footer', 'pages', 'nodes'];
const BUILT_IN = [
  { name: 'Studio', description: 'A polished starting point for a service business.', theme: 'purple', title: 'Make good things happen.' },
  { name: 'Build', description: 'Bold sections for a project, product or team.', theme: 'orange', title: 'Build it properly.' },
  { name: 'Minimal', description: 'A calm, focused layout for a clear message.', theme: 'mint', title: 'Good things, made clear.' }
];
const FONT_NAMES = { sans: 'Modern sans', serif: 'Classic serif', mono: 'Monospace' };

// Replaces the whole document as one undoable step.
export function replaceOps(doc, next) {
  return TOP_KEYS.map(key => ({ path: [key], value: next[key] === undefined ? undefined : structuredClone(next[key]) })).filter(op => JSON.stringify(op.value) !== JSON.stringify(doc[op.path[0]]));
}
// Any accepted document (v1 or v2) as a normalized v2 site.
export function asV2(document) {
  const site = normalizeSite(document);
  return site.version === 2 ? site : migrateV1(site);
}

export function createMediaPanel(root, ctx) {
  function render() {
    const { doc } = ctx.state();
    root.innerHTML = '<div class="panel-head"><h2 class="panel-title">Media</h2></div><p class="panel-subtitle">Click an image to use it in the selected image, or to add it to the page.</p>'
      + '<div class="pair media-actions"><button class="btn btn-small" data-media-upload="image">Upload image</button><button class="btn btn-small" data-media-upload="video">Upload video</button></div>'
      + (doc.assets.length ? '<div class="asset-grid">' + doc.assets.map(asset => '<div class="asset" data-asset="' + esc(asset.id) + '"><button class="asset-use" data-use="' + esc(asset.id) + '" title="' + esc(asset.name) + '">'
        + (asset.kind === 'image' ? '<img src="' + esc(asset.url) + '" alt="" loading="lazy">' : '<span class="asset-video">▶</span>') + '<span class="asset-name">' + esc(asset.name) + '</span></button>'
        + '<button class="asset-remove" data-remove-asset="' + esc(asset.id) + '" title="Remove from library" aria-label="Remove ' + esc(asset.name) + ' from library">×</button></div>').join('') + '</div>'
        : '<p class="empty">No media yet. Uploaded images and videos appear here.</p>');
    if (!ctx.editable()) root.querySelectorAll('button').forEach(button => { button.disabled = true; });
  }
  root.addEventListener('click', async event => {
    if (!ctx.editable()) return;
    const upload = event.target.closest('[data-media-upload]');
    if (upload) { await ctx.upload(upload.dataset.mediaUpload); render(); return; }
    const remove = event.target.closest('[data-remove-asset]');
    const { doc, index, page, selected } = ctx.state();
    if (remove) return void ctx.commit([{ path: ['assets'], value: doc.assets.filter(asset => asset.id !== remove.dataset.removeAsset) }], { label: 'Remove media' });
    const use = event.target.closest('[data-use]');
    if (!use) return;
    const asset = doc.assets.find(item => item.id === use.dataset.use);
    const node = selected && doc.nodes[selected];
    const kind = asset.kind === 'video' ? 'video' : 'image';
    if (node && node.type === kind) return void ctx.commit([{ path: ['nodes', selected, 'props', 'src'], value: asset.url }], { label: 'Change ' + kind });
    const { id, node: created } = createNode(doc, kind);
    created.props = { ...(created.props || {}), src: asset.url, ...(kind === 'image' ? { alt: '' } : {}) };
    const target = insertionTarget(doc, index, page, selected, kind);
    if (!target) return ctx.toast('Add a section first.');
    const list = target.parent === null ? page.children : doc.nodes[target.parent].children;
    const next = list.slice(); next.splice(target.position, 0, id);
    if (ctx.commit([{ path: ['nodes', id], value: created }, { path: ['nodes', target.parent, 'children'], value: next }], { label: 'Add ' + kind })) ctx.select(id, { source: 'add', reveal: true });
  });
  return { render };
}

export function createSitePanel(root, ctx) {
  let addingColor = false;
  function render() {
    const { doc } = ctx.state(), site = doc.site, design = doc.design;
    const field = (key, title, value, extra = '') => '<label>' + title + '<input data-site="' + key + '" value="' + esc(value) + '"' + extra + '></label>';
    const fontSelect = id => {
      const font = design.fonts.find(item => item.id === id);
      return '<label>' + (id === 'heading' ? 'Headings' : 'Body text') + '<select data-font="' + id + '">' + Object.entries(FONT_NAMES).map(([key, name]) => '<option value="' + key + '"' + (font?.source === 'system' && font.family === key ? ' selected' : '') + '>' + name + '</option>').join('')
        + (font?.source === 'custom' ? '<option selected value="">' + esc(font.family) + ' (uploaded)</option>' : '') + '</select></label>';
    };
    root.innerHTML = '<div class="panel-head"><h2 class="panel-title">Site</h2></div><div class="page-settings">'
      + '<h3>Settings</h3>' + field('name', 'Website name', site.name, ' maxlength="120"')
      + '<label>Description<textarea data-site="description" rows="3" maxlength="2000">' + esc(site.description) + '</textarea></label>'
      + field('lang', 'Language code', site.lang, ' maxlength="12" spellcheck="false"') + field('socialImage', 'Social sharing image URL', site.socialImage, ' list="siteImages" spellcheck="false"')
      + '<datalist id="siteImages">' + doc.assets.filter(asset => asset.kind === 'image').map(asset => '<option value="' + esc(asset.url) + '">' + esc(asset.name) + '</option>').join('') + '</datalist>'
      + '<label class="check"><input type="checkbox" data-site="searchVisible"' + (site.searchVisible ? ' checked' : '') + '>Show in search engines</label>'
      + '<h3>Colours</h3><div class="palette">' + Object.entries(design.colors).map(([key, hex]) => '<label class="swatch-row"><input type="color" data-color="' + esc(key) + '" value="' + esc(hex.slice(0, 7)) + '"><span>' + esc(key) + '</span><code>' + esc(hex) + '</code>'
        + (['bg', 'ink', 'muted', 'line', 'accent', 'soft'].includes(key) ? '' : '<button class="icon-btn" data-remove-color="' + esc(key) + '" aria-label="Remove colour ' + esc(key) + '">−</button>') + '</label>').join('') + '</div>'
      + (addingColor ? '<form class="add-color"><input name="key" placeholder="name, e.g. brand" pattern="[a-z][a-z0-9-]{0,31}" required aria-label="Colour name"><input type="color" name="hex" value="#3366ff" aria-label="Colour"><button class="btn btn-small">Add</button></form>' : '<button class="btn btn-small" data-add-color>+ Colour</button>')
      + '<p class="hint">Elements that use a theme colour (shown as @name) update everywhere when you change it.</p>'
      + '<h3>Fonts</h3>' + fontSelect('heading') + fontSelect('body') + '</div>';
    if (!ctx.editable()) root.querySelectorAll('input,textarea,select,button').forEach(element => { element.disabled = true; });
  }
  root.addEventListener('change', event => {
    if (!ctx.editable()) return;
    const t = event.target, { doc } = ctx.state();
    if (t.dataset.site) {
      const value = t.type === 'checkbox' ? t.checked : t.value.trim();
      if (t.dataset.site === 'name' && !value) return render();
      return void ctx.commit([{ path: ['site', t.dataset.site], value }], { label: 'Site ' + t.dataset.site });
    }
    if (t.dataset.color) return void ctx.commit([{ path: ['design', 'colors', t.dataset.color], value: t.value }], { label: 'Colour ' + t.dataset.color, merge: 'color:' + t.dataset.color });
    if (t.dataset.font && t.value) {
      const fonts = doc.design.fonts.map(font => font.id === t.dataset.font ? { id: font.id, source: 'system', family: t.value } : font);
      return void ctx.commit([{ path: ['design', 'fonts'], value: fonts }], { label: 'Font' });
    }
  });
  root.addEventListener('click', event => {
    if (!ctx.editable()) return;
    if (event.target.closest('[data-add-color]')) { addingColor = true; render(); root.querySelector('.add-color input')?.focus(); return; }
    const remove = event.target.closest('[data-remove-color]');
    if (remove) {
      const used = JSON.stringify(ctx.state().doc.nodes).includes('"@' + remove.dataset.removeColor + '"') || JSON.stringify(ctx.state().doc.design.textStyles).includes('"@' + remove.dataset.removeColor + '"');
      if (used) return ctx.toast('This colour is still used on the site.');
      ctx.commit([{ path: ['design', 'colors', remove.dataset.removeColor], value: undefined }], { label: 'Remove colour' });
    }
  });
  root.addEventListener('submit', event => {
    event.preventDefault();
    const form = event.target, key = form.elements.key.value.trim();
    if (ctx.state().doc.design.colors[key]) return ctx.toast('A colour with that name exists.');
    if (ctx.commit([{ path: ['design', 'colors', key], value: form.elements.hex.value }], { label: 'Add colour' })) addingColor = false;
    render();
  });
  return { render };
}

// Templates, import and export live in one dialog.
export function createTemplates(ctx) {
  async function open() {
    let saved = [];
    try { saved = (await ctx.api('/api/templates')).templates || []; } catch (error) { if (ctx.editable()) ctx.toast(error.message); }
    const card = (title, text, buttons) => '<article class="template-card"><div><h3>' + esc(title) + '</h3><p>' + esc(text) + '</p></div><div class="pair">' + buttons + '</div></article>';
    const html = '<p>Applying a template replaces the current draft; Undo brings it back. Nothing is published until you publish.</p>'
      + '<h3>Built-in</h3><div class="template-list">' + BUILT_IN.map((item, i) => card(item.name, item.description, '<button class="btn btn-primary" data-builtin="' + i + '">Use</button>')).join('') + '</div>'
      + '<h3>Saved templates</h3><div class="template-list">' + (saved.length ? saved.map(item => card(item.name, item.description || (item.document?.version === 2 ? 'New editor format' : 'Classic format'), '<button class="btn btn-primary" data-apply="' + esc(item.id) + '">Apply</button><button class="btn" data-delete-template="' + esc(item.id) + '">Delete</button>')).join('') : '<p class="empty">No saved templates yet.</p>') + '</div>'
      + '<form class="save-template"><h3>Save the current site as a template</h3><input name="name" maxlength="120" placeholder="Template name" required><input name="description" maxlength="500" placeholder="Description (optional)"><button class="btn">Save template</button></form>'
      + '<h3>Import and export</h3><div class="pair"><button class="btn" data-export>Export draft (JSON)</button><button class="btn" data-import>Import draft…</button></div>';
    ctx.dialog('Templates', html);
    const modal = document.querySelector('.modal');
    if (!ctx.editable()) modal.querySelectorAll('[data-builtin],[data-apply],[data-delete-template],.save-template button,[data-import]').forEach(button => { button.disabled = true; });
    modal.addEventListener('click', async event => {
      const t = event.target;
      if (t.closest('[data-export]')) {
        const url = URL.createObjectURL(new Blob([JSON.stringify(ctx.state().doc, null, 2)], { type: 'application/json' }));
        const link = document.createElement('a'); link.href = url; link.download = 'nimble-site.json'; link.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
        return;
      }
      if (t.closest('[data-import]')) {
        const input = document.createElement('input'); input.type = 'file'; input.accept = 'application/json,.json';
        input.onchange = async () => {
          try { apply(asV2(JSON.parse(await input.files[0].text())), 'Import draft'); }
          catch (error) { ctx.toast('That file is not a valid Nimble site: ' + error.message); }
        };
        input.click();
        return;
      }
      const builtin = t.closest('[data-builtin]');
      if (builtin) {
        const item = BUILT_IN[Number(builtin.dataset.builtin)], base = makeDefaultSite();
        base.site.name = ctx.state().doc.site.name; base.theme = item.theme; base.blocks.hero.title = item.title;
        const next = migrateV1(base);
        next.assets = ctx.state().doc.assets;
        return apply(next, 'Use template ' + item.name);
      }
      const applyButton = t.closest('[data-apply]');
      if (applyButton) {
        const item = saved.find(entry => entry.id === applyButton.dataset.apply);
        try { return apply(asV2(item.document), 'Apply template ' + item.name); } catch (error) { return ctx.toast(error.message); }
      }
      const remove = t.closest('[data-delete-template]');
      if (remove && confirm('Delete this saved template?')) {
        try { await ctx.api('/api/templates/' + encodeURIComponent(remove.dataset.deleteTemplate), { method: 'DELETE' }); open(); } catch (error) { ctx.toast(error.message); }
      }
    });
    modal.querySelector('.save-template').addEventListener('submit', async event => {
      event.preventDefault();
      const form = event.target;
      try {
        await ctx.api('/api/templates', { method: 'POST', body: JSON.stringify({ name: form.elements.name.value.trim(), description: form.elements.description.value.trim(), document: ctx.state().doc }) });
        ctx.toast('Template saved.'); open();
      } catch (error) { ctx.toast(error.message); }
    });
  }
  function apply(next, label) {
    if (ctx.commit(replaceOps(ctx.state().doc, next), { label })) { ctx.closeDialog(); ctx.openPage('home'); ctx.toast(label + '. Undo brings back the previous draft.'); }
  }
  return { open };
}
