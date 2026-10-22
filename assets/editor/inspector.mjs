// Inspector: tabs generated from lib/nimble-spec.json. Responsive groups (layout, placement, style)
// write to the current breakpoint only and show the inherited value when no override exists.
import { spec } from '/assets/site-model-v2.mjs';
import { escapeHtml as esc } from '/assets/render-v2.mjs';
import { TYPES, label, ancestors } from './tree.mjs';
import { hiddenAt } from './layers.mjs';
import { createLayoutPanel } from './layout-panel.mjs';
import { overridesAt, resetOps } from './breakpoints.mjs';
import { colorField, createColorPicker } from './color-picker.mjs';

const LABELS = {
  mode: 'Layout', columns: 'Columns', rows: 'Rows', rowGap: 'Row gap', columnGap: 'Column gap', direction: 'Direction', wrap: 'Wrap', justify: 'Justify', align: 'Align items',
  padding: 'Padding', minHeight: 'Min height', contentWidth: 'Content width', cell: 'Grid cell', justifySelf: 'Horizontal dock', alignSelf: 'Vertical dock', margin: 'Margin',
  width: 'Width', height: 'Height', minWidth: 'Min width', maxWidth: 'Max width', maxHeight: 'Max height', rotate: 'Rotation (°)', z: 'Layer order (z)', order: 'Order in stack',
  color: 'Text colour', background: 'Background', opacity: 'Opacity', border: 'Border', radius: 'Corner radius', shadow: 'Shadow', font: 'Font', fontSize: 'Font size',
  fontWeight: 'Font weight', lineHeight: 'Line height', letterSpacing: 'Letter spacing', textAlign: 'Text align', textTransform: 'Text case', linkUnderline: 'Underline links',
  src: 'Source', alt: 'Alt text', fit: 'Image fit', link: 'Link', label: 'Label', poster: 'Poster image', title: 'Title', controls: 'Show controls', autoplay: 'Autoplay (muted)',
  loop: 'Loop', muted: 'Muted', images: 'Images (one URL per line)', minItemWidth: 'Min item width', itemHeight: 'Item height', gap: 'Gap', submitLabel: 'Button label',
  note: 'Privacy note', shape: 'Shape', orientation: 'Orientation', activeColor: 'Current page colour', doc: 'Text',
  blendMode: 'Blend mode', scrollEffect: 'Scroll effect', borderColor: 'Border colour', scale: 'Scale', translateY: 'Move up/down', duration: 'Transition (ms)'
};
const HOVER_LABELS = { color: 'Text colour', background: 'Background', borderColor: 'Border colour', shadow: 'Shadow', opacity: 'Opacity', scale: 'Scale', translateY: 'Move up/down', duration: 'Transition (ms)' };
const SIDES = ['Top', 'Right', 'Bottom', 'Left'];
const CORNERS = ['Top left', 'Top right', 'Bottom right', 'Bottom left'];
const SHADOW_DEFAULT = { x: '0px', y: '4px', blur: '12px', spread: '0px', color: '#00000033' };
const FOCAL_SRC = /^[^"'()\\\s]+$/;
const TABS = [['content', 'Content'], ['layout', 'Layout'], ['design', 'Design'], ['settings', 'Settings']];
const RICH_TAGS = ['p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6'];

export function cascade(map, bpIds, bp, key) {
  let value;
  for (const id of bpIds.slice(0, bpIds.indexOf(bp) + 1)) if (map?.[id] && Object.hasOwn(map[id], key)) value = map[id][key];
  return value;
}
const display = value => value === undefined ? '' : Array.isArray(value) ? value.join(' ') : typeof value === 'object' ? 'set' : String(value);
const isPlain = runs => runs.every(run => !run.b && !run.i && !run.u && !run.s && !run.color && !run.link && !run.token);
function length(value) {
  const text = String(value ?? '').trim();
  if (!text) return undefined;
  return /^-?\d+(\.\d+)?$/.test(text) ? text + 'px' : text;
}
function splitTracks(text) {
  const tokens = []; let depth = 0, current = '';
  for (const char of text.trim()) {
    if (char === '(') depth++;
    if (char === ')') depth--;
    if (/\s/.test(char) && depth === 0) { if (current) tokens.push(current); current = ''; } else current += char;
  }
  if (current) tokens.push(current);
  return tokens;
}

export function createInspector(root, ctx) {
  const layoutPanel = createLayoutPanel(ctx);
  let tab = 'content', linkDraft = null, bgDraft = null, presetDraft = false, hoverOpen = false;
  const picker = createColorPicker({ colors: () => ctx.state().doc.design.colors });
  picker.attach(root);
  const colorOptions = () => Object.keys(ctx.state().doc.design.colors).map(key => '<option value="@' + esc(key) + '">').join('');
  const colorInput = (value, placeholder, attrs = '') => colorField(ctx.state().doc.design.colors, value, typeof placeholder === 'string' ? placeholder : '', attrs);
  // One editable value. `own` is the value at this breakpoint, `inherited` what applies without it.
  function control(type, own, inherited, key = '', options = {}) {
    const [kind, ...args] = type.split(':');
    const ph = esc(display(inherited));
    if (kind === 'enum') return '<select data-part="value"><option value="">' + (inherited !== undefined ? 'Inherit (' + esc(inherited) + ')' : 'Default') + '</option>' + args[0].split(',').map(option => '<option' + (own === option ? ' selected' : '') + '>' + esc(option) + '</option>').join('') + '</select>';
    if (kind === 'bool') return '<select data-part="value"><option value="">' + (inherited !== undefined ? 'Inherit (' + (inherited ? 'yes' : 'no') + ')' : 'Default') + '</option><option value="true"' + (own === true ? ' selected' : '') + '>Yes</option><option value="false"' + (own === false ? ' selected' : '') + '>No</option></select>';
    if (kind === 'num' || kind === 'int') return '<input data-part="value" type="number" min="' + args[0] + '" max="' + args[1] + '" step="' + (kind === 'int' ? (args[1] > 100 ? 100 : 1) : 0.05) + '" value="' + esc(display(own)) + '" placeholder="' + ph + '">';
    if (kind === 'length' || kind === 'slength' || kind === 'size' || kind === 'tracks') return '<input data-part="value" value="' + esc(display(own)) + '" placeholder="' + ph + '" spellcheck="false">';
    if (kind === 'box' || kind === 'margin') return '<span class="quad">' + (key === 'radius' ? CORNERS : SIDES).map((side, i) => '<input data-part="' + i + '" aria-label="' + side + '" title="' + side + '" value="' + esc(own?.[i] ?? '') + '" placeholder="' + esc(inherited?.[i] ?? '0px') + '" spellcheck="false">').join('') + '</span>';
    if (kind === 'cell') return '<span class="quad">' + ['Row', 'Column', 'Row span', 'Column span'].map((name, i) => '<input type="number" min="1" max="48" data-part="' + i + '" aria-label="' + name + '" title="' + name + '" value="' + esc(own?.[i] ?? '') + '" placeholder="' + esc(inherited?.[i] ?? (i > 1 ? 1 : '')) + '">').join('') + '</span>';
    if (kind === 'color') return colorInput(own, inherited);
    if (kind === 'font') return '<select data-part="value"><option value="">' + (inherited ? 'Inherit (' + esc(inherited) + ')' : 'Default') + '</option>' + ctx.state().doc.design.fonts.map(font => '<option value="' + esc(font.id) + '"' + (own === font.id ? ' selected' : '') + '>' + esc(font.id + ' — ' + font.family) + '</option>').join('') + '</select>';
    if (kind === 'border') {
      const value = own || inherited || {};
      return '<span class="stack-field"><span class="pair"><input data-part="width" value="' + esc(own?.width ?? '') + '" placeholder="' + esc(inherited?.width ?? '1px') + '" aria-label="Border width"><select data-part="style" aria-label="Border style">' + ['', 'solid', 'dashed', 'dotted', 'double', 'none'].map(option => '<option value="' + option + '"' + (own?.style === option ? ' selected' : '') + '>' + (option || 'Style…') + '</option>').join('') + '</select></span>'
        + colorInput(own?.color, inherited?.color || '@line') + '<span class="sides">' + ['top', 'right', 'bottom', 'left'].map(side => '<label><input type="checkbox" data-part="side-' + side + '"' + ((value.sides || ['top', 'right', 'bottom', 'left']).includes(side) ? ' checked' : '') + '>' + side + '</label>').join('') + '</span>'
        + (own ? '<button class="link-button" data-part="clear">Remove border here</button>' : '') + '</span>';
    }
    if (kind === 'shadows') return shadowControl(own, inherited);
    if (kind === 'background') return backgroundControl(own, inherited, options);
    return '<span class="muted">Not editable yet</span>';
  }
  function shadowRow(shadow, base, removable) {
    return '<div class="shadow-row" data-shadow-row><span class="quad">' + ['x', 'y', 'blur', 'spread'].map(key => '<input data-shadow="' + key + '" aria-label="Shadow ' + key + '" title="' + key + '" value="' + esc(shadow?.[key] ?? '') + '" placeholder="' + esc(base[key]) + '" spellcheck="false">').join('') + '</span>'
      + '<span class="pair">' + colorInput(shadow?.color, base.color, ' data-shadow="color"') + '<label class="check"><input type="checkbox" data-shadow="inset"' + ((shadow || base).inset ? ' checked' : '') + '>Inner</label>'
      + (removable ? '<button type="button" class="link-button" data-shadow-remove>Remove</button>' : '') + '</span></div>';
  }
  // Up to four shadows. Without an own value the inherited shadows show as placeholders.
  function shadowControl(own, inherited) {
    const rows = own ? own.map(shadow => shadowRow(shadow, SHADOW_DEFAULT, true)) : (inherited || []).map(shadow => shadowRow(null, { ...SHADOW_DEFAULT, ...shadow }, false));
    return '<span class="stack-field shadows">' + (rows.join('') || '<span class="muted">No shadow</span>')
      + (rows.length < spec.limits.shadows ? '<button type="button" class="btn btn-small" data-shadow-add>+ Shadow</button>' : '') + '</span>';
  }
  function backgroundControl(own, inherited, { video = false, draftKey = '' } = {}) {
    const current = bgDraft?.key === draftKey ? bgDraft.value : own;
    const kind = current?.kind || '';
    const kinds = ['color', 'gradient', 'image', ...(video ? ['video'] : [])];
    let html = '<select data-part="kind" aria-label="Background type"><option value="">' + (inherited ? 'Inherit (' + inherited.kind + ')' : 'None') + '</option>' + kinds.map(option => '<option' + (kind === option ? ' selected' : '') + '>' + option + '</option>').join('') + '</select>';
    if (kind === 'color') html += colorInput(current.color, '');
    if (kind === 'gradient') {
      const stops = current.stops || [{ color: '#ffffff', at: 0 }, { color: '@accent', at: 100 }];
      const cssColor = value => value.startsWith('@') ? 'var(--c-' + value.slice(1) + ',#ccc)' : value;
      html += '<span class="pair"><input type="number" data-part="angle" min="0" max="360" value="' + esc(current.angle ?? 180) + '" aria-label="Angle"><select data-part="gtype" aria-label="Gradient type"><option' + (current.type !== 'radial' ? ' selected' : '') + '>linear</option><option' + (current.type === 'radial' ? ' selected' : '') + '>radial</option></select></span>'
        + '<span class="gradient-preview" style="background:linear-gradient(90deg,' + esc(stops.map(stop => cssColor(stop.color) + ' ' + stop.at + '%').join(',')) + ')"></span>'
        + stops.map((stop, i) => '<span class="stop-row" data-stop-row>' + colorInput(stop.color, '', ' data-stop="' + i + '"') + '<input type="number" data-at min="0" max="100" value="' + esc(stop.at) + '" aria-label="Stop ' + (i + 1) + ' position (%)">'
          + (stops.length > 2 ? '<button type="button" class="icon-btn" data-stop-remove aria-label="Remove stop ' + (i + 1) + '">−</button>' : '') + '</span>').join('')
        + (stops.length < spec.limits.gradientStops ? '<button type="button" class="btn btn-small" data-stop-add>+ Colour stop</button>' : '');
    }
    if (kind === 'image') {
      const focal = current.focal;
      html += '<span class="pair"><input data-part="src" list="mediaImages" value="' + esc(current.src || '') + '" placeholder="/uploads/… or https://…" aria-label="Image URL"><button type="button" class="btn btn-small" data-bg-upload="image">Upload</button></span>'
        + '<span class="pair"><select data-part="size" aria-label="Image size">' + ['cover', 'contain', 'auto'].map(option => '<option' + (current.size === option ? ' selected' : '') + '>' + option + '</option>').join('') + '</select>'
        + '<select data-part="position" aria-label="Image position"' + (focal ? ' title="The focal point is used instead"' : '') + '>' + ['center', 'top', 'bottom', 'left', 'right', 'top-left', 'top-right', 'bottom-left', 'bottom-right'].map(option => '<option' + (current.position === option ? ' selected' : '') + '>' + option + '</option>').join('') + '</select></span>'
        + (current.src ? '<span class="focal" data-focal role="button" aria-label="Set focal point" title="Click to set the focal point"' + (FOCAL_SRC.test(current.src) ? ' style="background-image:url(' + esc(current.src) + ')"' : '') + '>' + (focal ? '<span class="focal-dot" style="left:' + focal[0] + '%;top:' + focal[1] + '%"></span>' : '') + '</span>' : '')
        + '<span class="pair focal-values"><input type="number" min="0" max="100" data-part="focal-x" value="' + esc(focal?.[0] ?? '') + '" placeholder="50" aria-label="Focal point X (%)"><input type="number" min="0" max="100" data-part="focal-y" value="' + esc(focal?.[1] ?? '') + '" placeholder="50" aria-label="Focal point Y (%)">'
        + (focal ? '<button type="button" class="link-button" data-focal-clear>Clear</button>' : '') + '</span>'
        + '<label class="mini-label">Overlay</label>' + colorInput(current.overlay, '', ' data-overlay');
    }
    if (kind === 'video') {
      html += '<span class="pair"><input data-part="src" list="mediaVideos" value="' + esc(current.src || '') + '" placeholder="/uploads/….mp4" aria-label="Video URL"><button type="button" class="btn btn-small" data-bg-upload="video">Upload</button></span>'
        + '<input data-part="poster" list="mediaImages" value="' + esc(current.poster || '') + '" placeholder="Poster image (optional)" aria-label="Poster image">'
        + '<label class="mini-label">Overlay</label>' + colorInput(current.overlay, '', ' data-overlay')
        + '<p class="hint">Plays muted and looped. Visitors who prefer reduced motion see the background colour instead.</p>';
    }
    return '<span class="stack-field">' + html + '</span>';
  }
  function readColor(field, attrs = '') {
    const text = field.querySelector('[data-part=value]' + attrs);
    return text?.value.trim() || undefined;
  }
  // Reads a control back into a spec value. Returns undefined to remove the override.
  function read(type, field, own, inherited) {
    const [kind] = type.split(':');
    const part = name => field.querySelector('[data-part="' + name + '"]');
    if (kind === 'enum' || kind === 'font') return part('value').value || undefined;
    if (kind === 'bool') return part('value').value === '' ? undefined : part('value').value === 'true';
    if (kind === 'num' || kind === 'int') return part('value').value === '' ? undefined : Number(part('value').value);
    if (kind === 'length' || kind === 'slength' || kind === 'size') return part('value').value.trim() === 'auto' ? 'auto' : length(part('value').value);
    if (kind === 'tracks') { const tokens = splitTracks(part('value').value); return tokens.length ? tokens : undefined; }
    if (kind === 'box' || kind === 'margin') {
      const values = [0, 1, 2, 3].map(i => part(i).value.trim());
      if (values.every(value => !value)) return undefined;
      return values.map((value, i) => value === 'auto' && kind === 'margin' ? 'auto' : length(value) || inherited?.[i] || '0px');
    }
    if (kind === 'cell') {
      const values = [0, 1, 2, 3].map(i => part(i).value);
      if (values.every(value => !value)) return undefined;
      return values.map((value, i) => Number(value) || inherited?.[i] || 1);
    }
    if (kind === 'color') return readColor(field);
    if (kind === 'border') {
      if (part('clear')?.dataset.clicked) return undefined;
      const sides = ['top', 'right', 'bottom', 'left'].filter(side => part('side-' + side).checked);
      return { width: length(part('width').value) || inherited?.width || '1px', style: part('style').value || inherited?.style || 'solid', color: readColor(field) || inherited?.color || '@line', sides: sides.length ? sides : ['top', 'right', 'bottom', 'left'] };
    }
    if (kind === 'shadows') {
      return [...field.querySelectorAll('[data-shadow-row]')].map(row => {
        const get = name => row.querySelector('[data-shadow="' + name + '"]');
        const shadow = {};
        for (const key of ['x', 'y', 'blur', 'spread']) shadow[key] = length(get(key).value) || get(key).placeholder;
        shadow.color = get('color').value.trim() || get('color').placeholder || SHADOW_DEFAULT.color;
        if (get('inset').checked) shadow.inset = true;
        return shadow;
      });
    }
    if (kind === 'background') {
      const choice = part('kind').value;
      if (!choice) return undefined;
      const overlay = field.querySelector('[data-overlay]')?.value.trim();
      if (choice === 'color') return { kind: 'color', color: readColor(field) || '#ffffff' };
      if (choice === 'gradient') {
        const rows = [...field.querySelectorAll('[data-stop-row]')];
        const stops = rows.map(row => ({ color: row.querySelector('[data-part=value]').value.trim() || '#ffffff', at: Math.max(0, Math.min(100, Number(row.querySelector('[data-at]').value) || 0)) }));
        return { kind: 'gradient', type: part('gtype')?.value || 'linear', angle: Number(part('angle')?.value || 180), stops: stops.length >= 2 ? stops : [{ color: '#ffffff', at: 0 }, { color: '@accent', at: 100 }] };
      }
      const src = part('src')?.value.trim();
      if (!src) return null;
      if (choice === 'video') {
        const poster = part('poster')?.value.trim();
        return { kind: 'video', src, ...(poster ? { poster } : {}), ...(overlay ? { overlay } : {}) };
      }
      const fx = part('focal-x')?.value ?? '', fy = part('focal-y')?.value ?? '';
      const focal = fx === '' && fy === '' ? undefined : [Number(fx || 50), Number(fy || 50)];
      return { kind: 'image', src, size: part('size')?.value || 'cover', position: part('position')?.value || 'center', ...(focal ? { focal } : {}), ...(overlay ? { overlay } : {}) };
    }
    return undefined;
  }

  function responsiveFields(group, schema, node, keys) {
    const { bp, bpIds } = ctx.state();
    return keys.filter(key => schema[key]).map(key => {
      const own = node[group]?.[bp]?.[key];
      const inherited = bp === 'desktop' ? undefined : cascade(node[group], bpIds.slice(0, bpIds.indexOf(bp)), bpIds[bpIds.indexOf(bp) - 1], key);
      return '<div class="field' + (own !== undefined ? ' has-own' : '') + '" data-group="' + group + '" data-key="' + key + '" data-type="' + esc(schema[key]) + '"><div class="field-head"><label>' + esc(LABELS[key] || key) + '</label>'
        + (own !== undefined ? '<button class="reset" data-reset title="' + (bp === 'desktop' ? 'Clear' : 'Reset to inherited') + '" aria-label="Reset ' + esc(LABELS[key] || key) + '">×</button>' : '') + '</div>' + control(schema[key], own, inherited, key, { video: key === 'background' && group === 'style' && !!spec.nodeTypes[node.type].container, draftKey: group + ':' + key }) + '</div>';
    }).join('');
  }
  // Hover state: one set of values for all breakpoints, rendered as :hover rules with a transition.
  function hoverFields(node) {
    return '<details class="design-group" data-group-name="hover"' + (node.hover || hoverOpen ? ' open' : '') + '><summary>Hover' + (node.hover ? ' <span class="badge">' + Object.keys(node.hover).length + '</span>' : '') + '</summary>'
      + Object.entries(spec.hover).map(([key, type]) => {
        const own = node.hover?.[key];
        return '<div class="field' + (own !== undefined ? ' has-own' : '') + '" data-group="hover" data-key="' + key + '" data-type="' + esc(type) + '"><div class="field-head"><label>' + esc(HOVER_LABELS[key]) + '</label>'
          + (own !== undefined ? '<button class="reset" data-reset title="Clear" aria-label="Clear hover ' + esc(HOVER_LABELS[key]) + '">×</button>' : '') + '</div>' + control(type, own, undefined, key, { draftKey: 'hover:' + key }) + '</div>';
      }).join('') + '<p class="hint">The same hover design applies on every breakpoint. Point at the element on the canvas to preview it.</p></details>';
  }
  // Saved designs: the element's style on every breakpoint, reusable on elements of the same type.
  function presetBar(node) {
    const presets = (ctx.state().doc.design.presets || []).filter(preset => preset.type === node.type);
    return '<div class="preset-bar">' + (presets.length ? '<select data-preset-apply aria-label="Apply a saved design"><option value="">Apply saved design…</option>' + presets.map(preset => '<option value="' + esc(preset.id) + '">' + esc(preset.name) + '</option>').join('') + '</select>' : '')
      + (presetDraft ? '<form class="preset-save"><input name="name" maxlength="60" required placeholder="Design name" aria-label="Design name"><button class="btn btn-small">Save</button></form>' : '<button type="button" class="btn btn-small" data-preset-save>Save design…</button>') + '</div>';
  }

  function linkControl(key, value) {
    const { doc, page } = ctx.state();
    const to = linkDraft?.key === key ? linkDraft.to : value?.to || '';
    let html = '<select data-part="to" aria-label="Link type">' + [['', 'No link'], ['page', 'Page'], ['anchor', 'Section on this page'], ['url', 'Web address'], ['email', 'Email'], ['phone', 'Phone'], ['asset', 'File']].map(([option, text]) => '<option value="' + option + '"' + (to === option ? ' selected' : '') + '>' + text + '</option>').join('') + '</select>';
    if (to === 'page') html += '<select data-part="page" aria-label="Page"><option value="">Choose a page…</option>' + doc.pages.map(item => '<option value="' + esc(item.id) + '"' + (value?.page === item.id ? ' selected' : '') + '>' + esc(item.name) + '</option>').join('') + '</select>';
    if (to === 'anchor') html += '<select data-part="node" aria-label="Section"><option value="">Choose a section…</option>' + page.children.map(id => '<option value="' + esc(id) + '"' + (value?.node === id ? ' selected' : '') + '>' + esc(label(doc.nodes[id])) + '</option>').join('') + '</select>';
    if (to === 'url') html += '<input data-part="href" value="' + esc(value?.to === 'url' ? value.href : '') + '" placeholder="https://…">';
    if (to === 'asset') html += '<select data-part="href" aria-label="File"><option value="">Choose a file…</option>' + doc.assets.map(asset => '<option value="' + esc(asset.url) + '"' + (value?.href === asset.url ? ' selected' : '') + '>' + esc(asset.name) + '</option>').join('') + '</select>';
    if (to === 'email') html += '<input data-part="address" value="' + esc(value?.address || '') + '" placeholder="name@example.com">';
    if (to === 'phone') html += '<input data-part="number" value="' + esc(value?.number || '') + '" placeholder="+47 …">';
    if (to) html += '<label><input type="checkbox" data-part="newTab"' + (value?.newTab ? ' checked' : '') + '>Open in a new tab</label>';
    return '<span class="stack-field">' + html + '</span>';
  }
  function propFields(node) {
    const schema = spec.nodeTypes[node.type].props || {};
    const props = node.props || {};
    return Object.entries(schema).map(([key, type]) => {
      const value = props[key];
      const head = '<div class="field-head"><label>' + esc(LABELS[key] || key) + '</label></div>';
      let body;
      if (type === 'richtext') body = richControl(value || []);
      else if (type.startsWith('text:')) body = Number(type.slice(5)) > 200 ? '<textarea data-part="value" rows="3">' + esc(value || '') + '</textarea>' : '<input data-part="value" value="' + esc(value || '') + '">';
      else if (type === 'media' || type === 'video') body = '<span class="pair"><input data-part="value" list="' + (type === 'video' ? 'mediaVideos' : 'mediaImages') + '" value="' + esc(value || '') + '" placeholder="/uploads/… or https://…"><button class="btn btn-small" data-upload="' + (type === 'video' ? 'video' : 'image') + '">Upload</button></span>';
      else if (type === 'mediaList') body = '<textarea data-part="value" rows="4" placeholder="Empty = first 6 library images">' + esc((value || []).join('\n')) + '</textarea>';
      else if (type === 'link') body = linkControl(key, value);
      else body = control(type, value, undefined);
      return '<div class="field" data-group="props" data-key="' + key + '" data-type="' + esc(type) + '">' + head + body + '</div>';
    }).join('');
  }
  function richControl(doc) {
    return '<div class="rich">' + doc.map((block, i) => {
      const runs = block.items ? block.items.flat() : block.c;
      const plain = !block.items && isPlain(runs);
      const tag = block.items ? '<span class="tag">' + block.t + '</span>' : '<select data-block="' + i + '" data-part="tag" aria-label="Block type">' + RICH_TAGS.map(option => '<option' + (option === block.t ? ' selected' : '') + '>' + option + '</option>').join('') + '</select>';
      const text = plain ? '<textarea data-block="' + i + '" data-part="text" rows="' + (block.t === 'p' ? 3 : 2) + '" aria-label="Block ' + (i + 1) + ' text">' + esc(runs.map(run => run.text).join('')) + '</textarea>'
        : '<p class="formatted">' + esc(runs.map(run => run.token ? '{' + run.token + '}' : run.text).join('')) + '</p><p class="hint">Formatted text: edit it on the canvas.</p>';
      return '<div class="rich-block"><div class="pair">' + tag + '<button class="link-button" data-block="' + i + '" data-part="remove" aria-label="Remove block ' + (i + 1) + '">Remove</button></div>' + text + '</div>';
    }).join('') + '<div class="pair"><button class="btn btn-small" data-part="add-block">+ Paragraph</button><button class="btn btn-small btn-primary" data-edit-text>Edit on canvas</button></div><p class="hint">Double-click text on the canvas (or press Enter) to type and format it there.</p></div>';
  }

  function render() {
    const { doc, bp, selected, index, selection } = ctx.state();
    if (selection.length > 1) { root.innerHTML = multiHtml(doc, selection); return; }
    const node = selected && doc.nodes[selected];
    if (!node) { root.innerHTML = '<div class="empty-inspector"><p>Select an element on the page or in Layers to edit it.</p></div>'; return; }
    const bpInfo = bp === 'desktop' ? 'Desktop — base design' : (doc.breakpoints.find(item => item.id === bp)?.name || bp) + ' — overrides at ≤' + doc.breakpoints.find(item => item.id === bp)?.max + 'px';
    const chain = ancestors(index, selected).map(id => '<button class="crumb' + (id === selected ? ' current' : '') + '" data-crumb="' + esc(id) + '">' + esc(label(doc.nodes[id])) + '</button>').join('<span>›</span>');
    let body = '';
    if (tab === 'content') body = spec.nodeTypes[node.type].props ? propFields(node) : '<p class="hint">' + esc(TYPES[node.type].label) + ' with ' + (node.children?.length || 0) + ' element(s). Use Add to place elements inside it, or drag them in Layers.</p>';
    // Below desktop, show how many values this element overrides here, with a one-click reset.
    const overrides = bp === 'desktop' ? [] : overridesAt(node, bp);
    const bpName = doc.breakpoints.find(item => item.id === bp)?.name || bp;
    const summary = overrides.length && (tab === 'layout' || tab === 'design') ? '<div class="override-summary"><span>' + overrides.length + ' change' + (overrides.length === 1 ? '' : 's') + ' on ' + esc(bpName) + '</span><button class="link-button" data-reset-bp>Reset to inherited</button></div>' : '';
    if (tab === 'layout') body = summary + layoutPanel.render(node);
    if (tab === 'design') body = presetBar(node) + summary + responsiveFields('style', spec.style, node, Object.keys(spec.style).filter(key => !(key === 'padding' && spec.nodeTypes[node.type].container))) + hoverFields(node);
    if (tab === 'settings') {
      const { bpIds } = ctx.state();
      const tags = spec.nodeTypes[node.type].tags;
      body = '<div class="field" data-setting="name"><div class="field-head"><label>Name in Layers</label></div><input data-part="value" value="' + esc(node.name || '') + '" placeholder="' + esc(label({ ...node, name: '' })) + '"></div>'
        + (tags ? '<div class="field" data-setting="tag"><div class="field-head"><label>HTML tag</label></div><select data-part="value"><option value="">Default (' + (node.type === 'section' ? 'section' : 'div') + ')</option>' + tags.map(tag => '<option' + (node.tag === tag ? ' selected' : '') + '>' + tag + '</option>').join('') + '</select></div>' : '')
        + '<div class="field" data-setting="locked"><label class="check"><input type="checkbox" data-part="value"' + (node.locked ? ' checked' : '') + '>Locked (cannot be moved)</label></div>'
        + '<div class="field" data-setting="hidden"><div class="field-head"><label>Visible on</label></div>' + bpIds.map(id => '<label class="check"><input type="checkbox" data-bp="' + esc(id) + '"' + (hiddenAt(node, bpIds, id) ? '' : ' checked') + '>' + esc(id === 'desktop' ? 'Desktop' : doc.breakpoints.find(item => item.id === id).name) + '</label>').join('') + '</div>'
        + '<div class="field"><div class="field-head"><label>Anchor ID</label></div><code>#' + esc(node.id) + '</code></div>'
        + '<div class="multi-actions">' + (ctx.canArrange('ungroup') ? '<button class="btn" data-arrange="ungroup">Ungroup</button>' : '') + '<button class="btn" data-arrange="duplicate">Duplicate</button></div>'
        + (index.get(selected)?.list === 'header' || index.get(selected)?.list === 'footer' ? '' : '<button class="btn btn-danger" data-delete>Delete element</button>');
    }
    root.innerHTML = '<div class="inspector-top"><div class="crumbs">' + chain + '</div><h2 class="inspector-title"><span aria-hidden="true">' + (TYPES[node.type]?.icon || '') + '</span> ' + esc(label(node)) + '</h2><p class="bp-note">' + esc(bpInfo) + '</p>'
      + '<div class="tabs" role="tablist">' + TABS.map(([id, text]) => '<button role="tab" data-tab="' + id + '" aria-selected="' + (tab === id) + '">' + text + '</button>').join('') + '</div></div>'
      + '<div class="tab-body" role="tabpanel">' + body + '</div>'
      + '<datalist id="paletteColors">' + colorOptions() + '</datalist><datalist id="mediaImages">' + doc.assets.filter(asset => asset.kind === 'image').map(asset => '<option value="' + esc(asset.url) + '">' + esc(asset.name) + '</option>').join('') + '</datalist><datalist id="mediaVideos">' + doc.assets.filter(asset => asset.kind === 'video').map(asset => '<option value="' + esc(asset.url) + '">' + esc(asset.name) + '</option>').join('') + '</datalist>';
    if (node.locked) root.querySelector('.inspector-top').insertAdjacentHTML('beforeend', '<p class="lock-note">Locked: content and style can still be edited.</p>');
    if (!ctx.editable()) root.querySelectorAll('.tab-body input,.tab-body select,.tab-body textarea,.tab-body button').forEach(element => { element.disabled = true; });
  }

  function commitField(field, live = false) {
    const { doc, bp, selected } = ctx.state();
    const node = doc.nodes[selected], group = field.dataset.group, key = field.dataset.key, type = field.dataset.type;
    if (group === 'props') {
      let value;
      if (type === 'richtext') return;
      if (type === 'link') {
        const part = name => field.querySelector('[data-part="' + name + '"]')?.value?.trim();
        const to = part('to');
        if (!to) { linkDraft = null; return ctx.commit([{ path: ['nodes', selected, 'props', key], value: undefined }], { label: 'Remove link' }); }
        const candidate = { to, ...(to === 'page' ? { page: part('page') } : {}), ...(to === 'anchor' ? { node: part('node') } : {}), ...(to === 'url' || to === 'asset' ? { href: part('href') } : {}), ...(to === 'email' ? { address: part('address') } : {}), ...(to === 'phone' ? { number: part('number') } : {}), ...(field.querySelector('[data-part=newTab]')?.checked ? { newTab: true } : {}) };
        const complete = Object.entries(candidate).every(([, item]) => item !== undefined && item !== '');
        if (!complete) { linkDraft = { key, to }; return render(); }
        linkDraft = null;
        return ctx.commit([{ path: ['nodes', selected, 'props', key], value: candidate }], { label: 'Link' });
      }
      const input = field.querySelector('[data-part=value]');
      if (type.startsWith('text:')) value = input.value;
      else if (type === 'media' || type === 'video') value = input.value.trim() || undefined;
      else if (type === 'mediaList') { const lines = input.value.split('\n').map(line => line.trim()).filter(Boolean); value = lines.length ? lines : undefined; }
      else value = read(type, field, node.props?.[key], undefined);
      return ctx.commit([{ path: ['nodes', selected, 'props', key], value }], { label: LABELS[key] || key, merge: live ? selected + ':' + key : null });
    }
    if (group === 'hover') {
      const value = read(type, field, node.hover?.[key], undefined);
      if (value === null) return;
      if (type === 'background') bgDraft = null;
      return ctx.commit([{ path: ['nodes', selected, 'hover', key], value }], { label: 'Hover ' + (HOVER_LABELS[key] || key) });
    }
    const own = node[group]?.[bp]?.[key];
    const { bpIds } = ctx.state();
    const inherited = bp === 'desktop' ? undefined : cascade(node[group], bpIds.slice(0, bpIds.indexOf(bp)), bpIds[bpIds.indexOf(bp) - 1], key);
    let value = read(type, field, own, inherited);
    if (value === null) return; // incomplete compound value (e.g. an image background without a URL yet)
    if (type === 'background') bgDraft = null;
    ctx.commit([{ path: ['nodes', selected, group, bp, key], value }], { label: (LABELS[key] || key) + (bp === 'desktop' ? '' : ' (' + bp + ')') });
  }
  function commitRich(target) {
    const { doc, selected } = ctx.state();
    const blocks = structuredClone(doc.nodes[selected].props?.doc || []);
    const i = Number(target.dataset.block);
    const part = target.dataset.part;
    if (part === 'text') blocks[i].c = [{ text: target.value }];
    if (part === 'tag') { blocks[i].t = target.value; delete blocks[i].style; }
    if (part === 'remove') blocks.splice(i, 1);
    if (part === 'add-block') blocks.push({ t: 'p', c: [{ text: 'New paragraph' }] });
    ctx.commit([{ path: ['nodes', selected, 'props', 'doc'], value: blocks }], { label: 'Edit text', merge: part === 'text' ? selected + ':text:' + i : null });
  }
  function commitSetting(field, target) {
    const { doc, selected, bpIds } = ctx.state();
    const node = doc.nodes[selected], setting = field.dataset.setting;
    if (setting === 'name') return ctx.commit([{ path: ['nodes', selected, 'name'], value: target.value.trim() || undefined }], { label: 'Rename' });
    if (setting === 'tag') return ctx.commit([{ path: ['nodes', selected, 'tag'], value: target.value || undefined }], { label: 'HTML tag' });
    if (setting === 'locked') return ctx.commit([{ path: ['nodes', selected, 'locked'], value: target.checked ? true : undefined }], { label: target.checked ? 'Lock' : 'Unlock' });
    if (setting === 'hidden') {
      const bp = target.dataset.bp, hide = !target.checked;
      const before = bp === 'desktop' ? false : hiddenAt(node, bpIds, bpIds[bpIds.indexOf(bp) - 1]);
      return ctx.commit([{ path: ['nodes', selected, 'hidden', bp], value: hide === before && bp !== 'desktop' ? undefined : (bp === 'desktop' && !hide ? undefined : hide) }], { label: hide ? 'Hide' : 'Show' });
    }
  }

  function multiHtml(doc, selection) {
    const tool = (action, icon, title) => '<button class="tool" data-arrange="' + action + '" title="' + esc(title) + '" aria-label="' + esc(title) + '"' + (ctx.canArrange(action) ? '' : ' disabled') + '>' + icon + '</button>';
    return '<div class="inspector-top"><h2 class="inspector-title">' + selection.length + ' elements selected</h2><p class="bp-note">' + esc(selection.map(id => label(doc.nodes[id])).join(', ')) + '</p></div><div class="tab-body multi">'
      + '<h3>Align</h3><div class="toolrow">' + tool('alignLeft', '⇤', 'Align left') + tool('alignCenter', '↔', 'Align centre') + tool('alignRight', '⇥', 'Align right') + tool('alignTop', '⤒', 'Align top') + tool('alignMiddle', '⇕', 'Align middle') + tool('alignBottom', '⤓', 'Align bottom') + '</div>'
      + '<h3>Distribute and size</h3><div class="toolrow">' + tool('distributeX', '⇹', 'Distribute horizontally') + tool('distributeY', '⇳', 'Distribute vertically') + tool('matchWidth', '↔=', 'Match width') + tool('matchHeight', '↕=', 'Match height') + tool('matchSize', '⧉', 'Match size') + '</div>'
      + '<h3>Arrange</h3><div class="toolrow">' + tool('front', '⤒▢', 'Bring to front') + tool('forward', '↑▢', 'Bring forward') + tool('backward', '↓▢', 'Send backward') + tool('back', '⤓▢', 'Send to back') + '</div>'
      + '<div class="multi-actions"><button class="btn" data-arrange="group"' + (ctx.canArrange('group') ? '' : ' disabled') + '>Group</button><button class="btn" data-arrange="duplicate">Duplicate</button><button class="btn" data-arrange="lock">Lock / unlock</button><button class="btn btn-danger" data-arrange="delete">Delete</button></div>'
      + '<p class="hint">Align and distribute work on elements in the same freeform grid. Group needs elements in the same container, on Desktop.</p></div>';
  }
  root.addEventListener('click', event => {
    if (event.target.closest('[data-reset-bp]') && ctx.editable()) {
      const { doc, bp, selected } = ctx.state();
      return void ctx.commit(resetOps(doc.nodes[selected], bp), { label: 'Reset changes on ' + bp });
    }
    const arrange = event.target.closest('[data-arrange]');
    if (arrange) { ctx.arrange(arrange.dataset.arrange); return; }
    if (event.target.closest('.lp') && layoutPanel.onClick(event, root)) return;
    const tabButton = event.target.closest('[data-tab]');
    if (tabButton) { tab = tabButton.dataset.tab; linkDraft = null; bgDraft = null; return render(); }
    const crumb = event.target.closest('[data-crumb]');
    if (crumb) return ctx.select(crumb.dataset.crumb, { source: 'inspector' });
    if (!ctx.editable()) return;
    const field = event.target.closest('.field');
    if (event.target.closest('[data-reset]') && field) {
      const { bp, selected } = ctx.state();
      const path = field.dataset.group === 'hover' ? ['nodes', selected, 'hover', field.dataset.key] : ['nodes', selected, field.dataset.group, bp, field.dataset.key];
      return ctx.commit([{ path, value: undefined }], { label: 'Reset ' + (LABELS[field.dataset.key] || field.dataset.key) });
    }
    if (event.target.closest('[data-preset-save]')) { presetDraft = true; render(); root.querySelector('.preset-save input')?.focus(); return; }
    if (field && editDesignList(event, field)) return;
    if (event.target.closest('[data-part=clear]') && field) { event.target.dataset.clicked = '1'; return commitField(field); }
    if (event.target.closest('[data-part=remove],[data-part=add-block]')) return commitRich(event.target.closest('[data-part]'));
    if (event.target.closest('[data-delete]')) return ctx.remove(ctx.state().selected);
    if (event.target.closest('[data-edit-text]')) return void ctx.editText(ctx.state().selected);
    const upload = event.target.closest('[data-upload]');
    if (upload && field) {
      ctx.upload(upload.dataset.upload).then(url => {
        if (!url) return;
        field.querySelector('[data-part=value]').value = url;
        commitField(field);
      });
    }
  });
  root.addEventListener('input', event => {
    if (!ctx.editable()) return;
    const target = event.target, field = target.closest('.field');
    if (target.dataset.part === 'text' && target.dataset.block !== undefined) return commitRich(target);
    if (field?.dataset.group === 'props' && /^text:/.test(field.dataset.type)) return commitField(field, true);
  });
  root.addEventListener('change', event => {
    if (event.target.closest('.lp')) { layoutPanel.onChange(event, root); return; }
    if (!ctx.editable()) return;
    if (event.target.matches('[data-preset-apply]')) return applyPreset(event.target.value);
    const target = event.target, field = target.closest('.field');
    if (!field) return;
    if (target.dataset.block !== undefined && target.dataset.part === 'tag') return commitRich(target);
    if (target.dataset.part === 'text') return;
    if (field.dataset.setting) return commitSetting(field, target);
    if (field.dataset.group === 'props' && /^text:/.test(field.dataset.type)) return;
    if (field.dataset.type === 'background' && target.dataset.part === 'kind') {
      const kind = target.value, draftKey = field.dataset.group + ':' + field.dataset.key;
      bgDraft = kind === 'image' ? { key: draftKey, value: { kind: 'image', size: 'cover', position: 'center' } } : kind === 'video' ? { key: draftKey, value: { kind: 'video' } } : null;
      if (bgDraft) return render();
    }
    commitField(field);
  });
  root.addEventListener('keydown', event => {
    if (event.key === 'Enter' && event.target.matches('input:not([type=checkbox])') && !event.target.form) event.target.blur();
  });
  root.addEventListener('submit', event => {
    if (!event.target.matches('.preset-save')) return;
    event.preventDefault();
    savePreset(event.target.elements.name.value.trim());
  });
  root.addEventListener('toggle', event => { if (event.target.dataset?.groupName === 'hover') hoverOpen = event.target.open; }, true);

  // List editors inside a field (gradient stops, shadows, focal point, uploads). Returns true when handled.
  function editDesignList(event, field) {
    const t = event.target;
    const commitWith = mutate => { mutate(); commitField(field); return true; };
    if (t.closest('[data-stop-add]')) {
      const rows = field.querySelectorAll('[data-stop-row]'), last = rows[rows.length - 1];
      return commitWith(() => { const copy = last.cloneNode(true); last.after(copy); });
    }
    if (t.closest('[data-stop-remove]')) return commitWith(() => t.closest('[data-stop-row]').remove());
    if (t.closest('[data-shadow-remove]')) return commitWith(() => t.closest('[data-shadow-row]').remove());
    if (t.closest('[data-shadow-add]')) {
      const holder = document.createElement('div');
      holder.innerHTML = shadowRow(null, SHADOW_DEFAULT, true);
      return commitWith(() => t.closest('[data-shadow-add]').before(holder.firstChild));
    }
    if (t.closest('[data-focal-clear]')) return commitWith(() => { field.querySelector('[data-part=focal-x]').value = ''; field.querySelector('[data-part=focal-y]').value = ''; });
    const focal = t.closest('[data-focal]');
    if (focal) {
      const r = focal.getBoundingClientRect();
      const pct = (value, size) => Math.round(Math.max(0, Math.min(100, value / size * 100)));
      return commitWith(() => { field.querySelector('[data-part=focal-x]').value = pct(event.clientX - r.left, r.width); field.querySelector('[data-part=focal-y]').value = pct(event.clientY - r.top, r.height); });
    }
    const upload = t.closest('[data-bg-upload]');
    if (upload) {
      const key = field.dataset.group + ':' + field.dataset.key, kind = field.querySelector('[data-part=kind]').value;
      ctx.upload(upload.dataset.bgUpload).then(url => {
        if (!url) return;
        const current = root.querySelector('.field[data-group="' + key.split(':')[0] + '"][data-key="' + key.split(':')[1] + '"]');
        if (!current) return;
        if (current.querySelector('[data-part=kind]').value !== kind) current.querySelector('[data-part=kind]').value = kind;
        current.querySelector('[data-part=src]') ? (current.querySelector('[data-part=src]').value = url) : null;
        commitField(current);
      });
      return true;
    }
    return false;
  }
  function savePreset(name) {
    const { doc, selected } = ctx.state(), node = doc.nodes[selected];
    if (!name || !node) return;
    const presets = doc.design.presets || [];
    if (presets.length >= spec.limits.presets) return ctx.toast('You can save up to ' + spec.limits.presets + ' designs. Remove one in Site › Saved designs.');
    let id;
    do id = 'd' + Math.random().toString(36).slice(2, 10); while (presets.some(preset => preset.id === id));
    presetDraft = false;
    if (ctx.commit([{ path: ['design', 'presets'], value: [...presets, { id, name, type: node.type, ...(node.style ? { style: structuredClone(node.style) } : {}) }] }], { label: 'Save design' })) ctx.toast('Saved “' + name + '”. Apply it to any ' + TYPES[node.type].label.toLowerCase() + ' from the Design tab.');
  }
  // Applies a saved design to every selected element of the same type, replacing their style.
  function applyPreset(id) {
    const { doc, selection } = ctx.state();
    const preset = (doc.design.presets || []).find(item => item.id === id);
    if (!preset) return;
    const ids = selection.filter(item => doc.nodes[item]?.type === preset.type);
    ctx.commit(ids.map(item => ({ path: ['nodes', item, 'style'], value: preset.style ? structuredClone(preset.style) : undefined })), { label: 'Apply ' + preset.name });
  }
  return { render, setTab(id) { tab = id; render(); }, closePopups: () => picker.close() };

}
