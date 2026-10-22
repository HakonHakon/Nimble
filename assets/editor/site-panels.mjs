// Site-wide panels: Media library, Site (settings, colours, fonts) and Templates/import/export.
import { escapeHtml as esc } from '/assets/render-v2.mjs';
import { normalizeSite, makeDefaultSite } from '/assets/site-model.mjs';
import { migrateV1 } from '/assets/migrate-v1.mjs';
import { createNode, insertionTarget, TYPES } from './tree.mjs';
import { spec } from '/assets/site-model-v2.mjs';
import { GOOGLE_FONTS } from '/assets/fonts.mjs';
import { colorField, createColorPicker } from './color-picker.mjs';
import { cascade } from './inspector.mjs';

const TOP_KEYS = ['site', 'design', 'breakpoints', 'assets', 'header', 'footer', 'pages', 'nodes'];
const BUILT_IN = [
  { name: 'Studio', description: 'A polished starting point for a service business.', theme: 'purple', title: 'Make good things happen.' },
  { name: 'Build', description: 'Bold sections for a project, product or team.', theme: 'orange', title: 'Build it properly.' },
  { name: 'Minimal', description: 'A calm, focused layout for a clear message.', theme: 'mint', title: 'Good things, made clear.' }
];
const FONT_NAMES = { sans: 'Modern sans', serif: 'Classic serif', mono: 'Monospace' };
const STYLE_NAMES = { h1: 'Heading 1', h2: 'Heading 2', h3: 'Heading 3', h4: 'Heading 4', h5: 'Heading 5', h6: 'Heading 6', p1: 'Paragraph 1', p2: 'Paragraph 2', p3: 'Paragraph 3' };
const STYLE_LABELS = { font: 'Font', fontSize: 'Size', fontWeight: 'Weight', lineHeight: 'Line height', letterSpacing: 'Letter spacing', color: 'Colour', textTransform: 'Text case' };
const FONT_TYPES = { woff2: 'font/woff2', woff: 'font/woff', ttf: 'font/ttf', otf: 'font/otf' };
// A font ID for a family name: lowercase letters, digits and dashes, unique among the site's fonts.
export function fontId(family, fonts) {
  const base = ('f-' + family.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')).slice(0, 28).replace(/-+$/, '');
  let id = base, n = 2;
  while (fonts.some(font => font.id === id)) id = base + '-' + n++;
  return id;
}
// True when a font ID is referenced anywhere in the design or the elements.
export function fontInUse(doc, id) {
  if (id === 'heading' || id === 'body') return true;
  const needle = '"font":"' + id + '"';
  return [doc.nodes, doc.design.textStyles, doc.design.body, doc.design.presets].some(part => JSON.stringify(part || {}).includes(needle));
}

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
  let addingColor = false, styleKey = 'h1', busy = false;
  const picker = createColorPicker({ colors: () => ctx.state().doc.design.colors });
  picker.attach(root);
  const fontLabel = font => font.source === 'system' ? FONT_NAMES[font.family] : font.family + (font.files ? ' (self-hosted)' : ' (uploaded)');
  function fontSelect(design, id) {
    const font = design.fonts.find(item => item.id === id);
    const others = design.fonts.filter(item => item.source === 'custom' && item.id !== 'heading' && item.id !== 'body');
    return '<label>' + (id === 'heading' ? 'Headings' : 'Body text') + '<select data-font="' + id + '">' + Object.entries(FONT_NAMES).map(([key, name]) => '<option value="system:' + key + '"' + (font?.source === 'system' && font.family === key ? ' selected' : '') + '>' + name + '</option>').join('')
      + (font?.source === 'custom' ? '<option selected value="">' + esc(fontLabel(font)) + '</option>' : '')
      + others.filter(item => item.family !== font?.family).map(item => '<option value="font:' + esc(item.id) + '">' + esc(fontLabel(item)) + '</option>').join('') + '</select></label>';
  }
  function textStyleEditor(doc, bp, bpIds) {
    const styles = doc.design.textStyles[styleKey];
    const bpName = bp === 'desktop' ? 'Desktop' : doc.breakpoints.find(item => item.id === bp)?.name || bp;
    const fields = Object.entries(spec.textStyle).map(([key, type]) => {
      const own = styles?.[bp]?.[key];
      const inherited = bp === 'desktop' ? undefined : cascade(styles, bpIds, bpIds[bpIds.indexOf(bp) - 1], key);
      const [kind, ...args] = type.split(':');
      let control;
      if (kind === 'font') control = '<select data-ts-value><option value="">' + (inherited ? 'Inherit (' + esc(inherited) + ')' : 'Default') + '</option>' + doc.design.fonts.map(font => '<option value="' + esc(font.id) + '"' + (own === font.id ? ' selected' : '') + '>' + esc(font.id + ' — ' + fontLabel(font)) + '</option>').join('') + '</select>';
      else if (kind === 'enum') control = '<select data-ts-value><option value="">' + (inherited ? 'Inherit (' + esc(inherited) + ')' : 'Default') + '</option>' + args[0].split(',').map(option => '<option' + (own === option ? ' selected' : '') + '>' + option + '</option>').join('') + '</select>';
      else if (kind === 'color') control = colorField(doc.design.colors, own, inherited || '', ' data-ts-value');
      else if (kind === 'int' || kind === 'num') control = '<input data-ts-value type="number" min="' + args[0] + '" max="' + args[1] + '" step="' + (kind === 'int' ? 100 : 0.05) + '" value="' + esc(own ?? '') + '" placeholder="' + esc(inherited ?? '') + '">';
      else control = '<input data-ts-value value="' + esc(own ?? '') + '" placeholder="' + esc(inherited ?? '') + '" spellcheck="false">';
      return '<div class="field ts-field' + (own !== undefined ? ' has-own' : '') + '" data-ts-key="' + key + '" data-type="' + esc(type) + '"><div class="field-head"><label>' + STYLE_LABELS[key] + '</label>'
        + (own !== undefined && bp !== 'desktop' ? '<button class="reset" data-ts-reset aria-label="Reset ' + STYLE_LABELS[key] + '">×</button>' : '') + '</div>' + control + '</div>';
    }).join('');
    return '<h3>Text styles</h3><label>Style<select data-ts-key-select>' + spec.textStyleKeys.map(key => '<option value="' + key + '"' + (key === styleKey ? ' selected' : '') + '>' + STYLE_NAMES[key] + '</option>').join('') + '</select></label>'
      + '<p class="hint">Editing on <strong>' + esc(bpName) + '</strong>' + (bp === 'desktop' ? '. Smaller breakpoints inherit these values.' : '. Values override the larger breakpoints; empty fields inherit.') + ' Every text that uses ' + STYLE_NAMES[styleKey] + ' updates.</p>' + fields;
  }
  function render() {
    const { doc, bp, bpIds } = ctx.state(), site = doc.site, design = doc.design;
    const field = (key, title, value, extra = '') => '<label>' + title + '<input data-site="' + key + '" value="' + esc(value) + '"' + extra + '></label>';
    const custom = design.fonts.filter(font => font.id !== 'heading' && font.id !== 'body');
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
      + '<h3>Fonts</h3>' + fontSelect(design, 'heading') + fontSelect(design, 'body')
      + (custom.length ? '<ul class="font-list">' + custom.map(font => '<li><span style="font-family:' + esc(font.source === 'system' ? spec.systemFonts[font.family] : '"' + font.family + '",system-ui') + '">' + esc(fontLabel(font)) + '</span><code>' + esc(font.id) + '</code>'
        + '<button class="icon-btn" data-remove-font="' + esc(font.id) + '" aria-label="Remove font ' + esc(font.family) + '">−</button></li>').join('') + '</ul>' : '')
      + '<form class="google-font"><label>Add a Google font<input name="family" list="googleFonts" placeholder="e.g. Playfair Display" maxlength="60" required spellcheck="false"></label>'
      + '<datalist id="googleFonts">' + GOOGLE_FONTS.map(name => '<option value="' + esc(name) + '">').join('') + '</datalist>'
      + '<fieldset class="weights"><legend>Weights</legend>' + [300, 400, 500, 600, 700, 800].map(weight => '<label class="check"><input type="checkbox" name="weight" value="' + weight + '"' + (weight === 400 || weight === 700 ? ' checked' : '') + '>' + weight + '</label>').join('') + '<label class="check"><input type="checkbox" name="italic">Italic</label></fieldset>'
      + '<button class="btn btn-small"' + (busy ? ' disabled' : '') + '>' + (busy ? 'Importing…' : 'Import font') + '</button></form>'
      + '<p class="hint">Google fonts are downloaded once and served from your site, so visitors never connect to Google.</p>'
      + '<button class="btn btn-small" data-upload-font' + (busy ? ' disabled' : '') + '>Upload font file…</button>'
      + textStyleEditor(doc, bp, bpIds)
      + '<h3>Saved designs</h3>' + ((design.presets || []).length ? '<ul class="preset-list">' + design.presets.map(preset => '<li><span>' + esc(preset.name) + '</span><small>' + esc(TYPES[preset.type]?.label || preset.type) + '</small><button class="icon-btn" data-remove-preset="' + esc(preset.id) + '" aria-label="Remove saved design ' + esc(preset.name) + '">−</button></li>').join('') + '</ul>' : '<p class="empty">Save an element’s design from its Design tab to reuse it.</p>')
      + '</div>';
    if (!ctx.editable()) root.querySelectorAll('input,textarea,select,button').forEach(element => { element.disabled = true; });
  }
  async function addFont(font, label) {
    const fonts = ctx.state().doc.design.fonts;
    if (fonts.length >= spec.limits.fonts) { ctx.toast('A site can use up to ' + spec.limits.fonts + ' fonts.'); return; }
    const existing = fonts.find(item => item.source === 'custom' && item.family === font.family && item.id !== 'heading' && item.id !== 'body');
    const id = existing?.id || fontId(font.family, fonts);
    const next = existing ? fonts.map(item => item.id === id ? { id, ...font } : item) : [...fonts, { id, ...font }];
    if (ctx.commit([{ path: ['design', 'fonts'], value: next }], { label })) ctx.toast(font.family + ' is ready. Choose it for headings, body text or a text style.');
  }
  async function uploadFont() {
    const input = document.createElement('input');
    input.type = 'file'; input.accept = '.woff2,.woff,.ttf,.otf';
    const file = await new Promise(resolve => { input.onchange = () => resolve(input.files[0]); input.click(); });
    if (!file) return;
    const extension = file.name.split('.').pop().toLowerCase();
    if (!FONT_TYPES[extension]) return ctx.toast('Choose a WOFF2, WOFF, TTF or OTF font file.');
    if (file.size > 5 * 1024 * 1024) return ctx.toast('Choose a font file smaller than 5 MB.');
    busy = true; render();
    try {
      // Browsers often report an empty or generic type for fonts, so build the data URL with the right one.
      const bytes = new Uint8Array(await file.arrayBuffer());
      let binary = '';
      for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
      const asset = await ctx.api('/api/media', { method: 'POST', body: JSON.stringify({ name: file.name, data: 'data:' + FONT_TYPES[extension] + ';base64,' + btoa(binary) }) });
      const family = file.name.replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' ').replace(/[^A-Za-z0-9 ]/g, '').replace(/\s+/g, ' ').trim().slice(0, 60) || 'Custom font';
      await addFont({ source: 'custom', family, src: asset.url }, 'Upload font');
    } catch (error) { ctx.toast(error.message); }
    finally { busy = false; render(); }
  }
  root.addEventListener('change', event => {
    if (!ctx.editable()) return;
    const t = event.target, { doc, bp } = ctx.state();
    if (t.dataset.site) {
      const value = t.type === 'checkbox' ? t.checked : t.value.trim();
      if (t.dataset.site === 'name' && !value) return render();
      return void ctx.commit([{ path: ['site', t.dataset.site], value }], { label: 'Site ' + t.dataset.site });
    }
    if (t.dataset.color) return void ctx.commit([{ path: ['design', 'colors', t.dataset.color], value: t.value }], { label: 'Colour ' + t.dataset.color, merge: 'color:' + t.dataset.color });
    if (t.dataset.font && t.value) {
      const [kind, value] = t.value.split(':');
      const source = kind === 'system' ? { source: 'system', family: value } : (({ id, ...rest }) => rest)(doc.design.fonts.find(font => font.id === value));
      const fonts = doc.design.fonts.map(font => font.id === t.dataset.font ? { id: font.id, ...source } : font);
      return void ctx.commit([{ path: ['design', 'fonts'], value: fonts }], { label: 'Font' });
    }
    if (t.matches('[data-ts-key-select]')) { styleKey = t.value; return render(); }
    const tsField = t.closest('[data-ts-key]');
    if (tsField) {
      const key = tsField.dataset.tsKey, [kind] = tsField.dataset.type.split(':');
      const raw = t.value.trim();
      let value = raw === '' ? undefined : kind === 'int' || kind === 'num' ? Number(raw) : (kind === 'length' || kind === 'slength') && /^-?\d+(\.\d+)?$/.test(raw) ? raw + 'px' : raw;
      if (bp === 'desktop' && value === undefined) return render(); // desktop values are the base and cannot be emptied
      return void ctx.commit([{ path: ['design', 'textStyles', styleKey, bp, key], value }], { label: STYLE_NAMES[styleKey] + ' ' + STYLE_LABELS[key].toLowerCase() });
    }
  });
  root.addEventListener('click', event => {
    if (!ctx.editable()) return;
    if (event.target.closest('[data-add-color]')) { addingColor = true; render(); root.querySelector('.add-color input')?.focus(); return; }
    const { doc, bp } = ctx.state();
    const remove = event.target.closest('[data-remove-color]');
    if (remove) {
      const used = JSON.stringify(doc.nodes).includes('"@' + remove.dataset.removeColor + '"') || JSON.stringify(doc.design.textStyles).includes('"@' + remove.dataset.removeColor + '"');
      if (used) return ctx.toast('This colour is still used on the site.');
      ctx.commit([{ path: ['design', 'colors', remove.dataset.removeColor], value: undefined }], { label: 'Remove colour' });
      return;
    }
    const removeFont = event.target.closest('[data-remove-font]');
    if (removeFont) {
      if (fontInUse(doc, removeFont.dataset.removeFont)) return ctx.toast('This font is still used. Change the text styles or elements that use it first.');
      return void ctx.commit([{ path: ['design', 'fonts'], value: doc.design.fonts.filter(font => font.id !== removeFont.dataset.removeFont) }], { label: 'Remove font' });
    }
    if (event.target.closest('[data-upload-font]')) return void uploadFont();
    const resetTs = event.target.closest('[data-ts-reset]');
    if (resetTs) return void ctx.commit([{ path: ['design', 'textStyles', styleKey, bp, resetTs.closest('[data-ts-key]').dataset.tsKey], value: undefined }], { label: 'Reset ' + STYLE_NAMES[styleKey] });
    const removePreset = event.target.closest('[data-remove-preset]');
    if (removePreset) {
      const presets = doc.design.presets.filter(preset => preset.id !== removePreset.dataset.removePreset);
      ctx.commit([{ path: ['design', 'presets'], value: presets.length ? presets : undefined }], { label: 'Remove saved design' });
    }
  });
  root.addEventListener('submit', async event => {
    event.preventDefault();
    const form = event.target;
    if (form.matches('.google-font')) {
      const body = JSON.stringify({ family: form.elements.family.value.trim(), weights: [...form.querySelectorAll('[name=weight]:checked')].map(input => Number(input.value)), italic: form.elements.italic.checked });
      busy = true; render();
      try {
        const result = await ctx.api('/api/fonts/google', { method: 'POST', body });
        await addFont({ source: 'custom', family: result.family, files: result.files }, 'Add font ' + result.family);
      } catch (error) { ctx.toast(error.message); }
      finally { busy = false; render(); }
      return;
    }
    const key = form.elements.key.value.trim();
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
