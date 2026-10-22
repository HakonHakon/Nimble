// Site document v2: an element tree with per-breakpoint layout, placement and style.
// Every rule here has a 1:1 port in php-backend/lib/site-model-v2.php; keep them in sync
// (test/v2-parity.test.mjs compares both implementations on the same fixtures).
import spec from './nimble-spec.json' with { type: 'json' };

export { spec };
const P = Object.fromEntries(Object.entries(spec.patterns).map(([key, source]) => [key, new RegExp(source)]));
const L = spec.limits;
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
const chars = value => [...value].length;
export function fail(message) { throw Object.assign(new Error(message), { statusCode: 400 }); }

export function text(value, limit, label = 'Text') {
  if (value === undefined || value === null) return '';
  if (typeof value !== 'string' || chars(value) > limit) fail(label + ' must be text of at most ' + limit + ' characters.');
  return value.replace(/\u0000/g, '');
}
export function safeUrl(value) {
  if (typeof value !== 'string' || value.length > 3000 || /[\u0000- \u007f\\<>"']/.test(value)) return '';
  if (value.startsWith('/') && !value.startsWith('//')) return value;
  return P.url.test(value) ? value : '';
}
export function audioSource(value) {
  const candidate = safeUrl(value);
  return candidate && /\.(mp3|m4a|ogg|oga|wav)(?:[?#]|$)/i.test(candidate) ? candidate : null;
}
export function videoSource(value) {
  const candidate = safeUrl(value);
  if (!candidate) return null;
  if (candidate.startsWith('/uploads/') || /\.(mp4|webm)(?:[?#]|$)/i.test(candidate)) return { kind: 'file', url: candidate };
  try {
    const url = new URL(candidate);
    const host = url.hostname.replace(/^www\./, '');
    let id;
    if (host === 'youtu.be') id = url.pathname.slice(1);
    if (['youtube.com', 'm.youtube.com', 'youtube-nocookie.com'].includes(host)) id = url.searchParams.get('v') || url.pathname.match(/^\/(?:embed|shorts)\/([^/]+)/)?.[1];
    if (id && /^[a-z0-9_-]{6,24}$/i.test(id)) return { kind: 'embed', url: 'https://www.youtube-nocookie.com/embed/' + id };
    if (['vimeo.com', 'player.vimeo.com'].includes(host)) {
      const number = url.pathname.match(/(?:^|\/)(\d{3,15})$/)?.[1];
      if (number) return { kind: 'embed', url: 'https://player.vimeo.com/video/' + number };
    }
  } catch {}
  return null;
}
function round(value) {
  const result = Math.round(value * 1000) / 1000;
  return result === 0 ? 0 : result;
}
function length(value, { signed = false, auto = false } = {}) {
  if (auto && value === 'auto') return 'auto';
  if (value === 0 || value === '0') return '0px';
  if (typeof value !== 'string') return null;
  const match = value.match(P.length);
  if (!match || (match[1] && !signed)) return null;
  const number = Number(match[2]);
  return number === 0 ? '0px' : match[1] + number + match[3];
}
function track(value) {
  if (typeof value !== 'string' || value.length > 80) return null;
  const token = value.replace(/\s+/g, '');
  if (token === 'auto') return token;
  if (P.fr.test(token)) return Number(token.slice(0, -2)) + 'fr';
  const plain = length(token);
  if (plain) return plain;
  let match = token.match(P.minmax);
  if (match) {
    const low = match[1] === 'auto' ? 'auto' : length(match[1]);
    const high = match[2] === 'auto' ? 'auto' : P.fr.test(match[2]) ? Number(match[2].slice(0, -2)) + 'fr' : length(match[2]);
    return low && high ? 'minmax(' + low + ',' + high + ')' : null;
  }
  match = token.match(P.repeat);
  if (match) {
    const low = length(match[2]);
    return low ? 'repeat(' + match[1] + ',minmax(' + low + ',' + Number(match[3].slice(0, -2)) + 'fr))' : null;
  }
  return null;
}
function hex(value) {
  if (typeof value !== 'string') return null;
  const lower = value.toLowerCase();
  if (P.hex.test(lower)) return lower;
  return P.shortHex.test(lower) ? '#' + [...lower.slice(1)].map(char => char + char).join('') : null;
}
function color(value, ctx) {
  if (typeof value !== 'string') return null;
  if (value.toLowerCase() === 'transparent') return 'transparent';
  if (hex(value)) return hex(value);
  if (value.startsWith('@') && ctx.colors && own(ctx.colors, value.slice(1))) return value;
  return null;
}
function ints(value, count, min, max) {
  if (!Array.isArray(value) || value.length !== count || value.some(item => !Number.isInteger(item) || item < min || item > max)) return null;
  return value.slice();
}

// Validates one value against a spec type string. Returns null for invalid values.
function value(type, input, ctx) {
  const [kind, ...args] = type.split(':');
  if (kind === 'enum') return typeof input === 'string' && args[0].split(',').includes(input) ? input : null;
  if (kind === 'bool') return typeof input === 'boolean' ? input : null;
  if (kind === 'num' || kind === 'int') {
    if (typeof input !== 'number' || !Number.isFinite(input) || (kind === 'int' && !Number.isInteger(input))) return null;
    if (input < Number(args[0]) || input > Number(args[1])) return null;
    return kind === 'int' ? input : round(input);
  }
  if (kind === 'length') return length(input);
  if (kind === 'slength') return length(input, { signed: true });
  if (kind === 'size') return length(input, { auto: true });
  if (kind === 'box' || kind === 'margin') {
    if (!Array.isArray(input) || input.length !== 4) return null;
    const result = input.map(item => length(item, kind === 'margin' ? { signed: true, auto: true } : {}));
    return result.includes(null) ? null : result;
  }
  if (kind === 'tracks') {
    if (!Array.isArray(input) || input.length < 1 || input.length > L.tracks) return null;
    const result = input.map(track);
    return result.includes(null) ? null : result;
  }
  if (kind === 'cell') return ints(input, 4, 1, L.gridLines);
  if (kind === 'color') return color(input, ctx);
  if (kind === 'font') return typeof input === 'string' && ctx.fonts && ctx.fonts.has(input) ? input : null;
  if (kind === 'icon') return typeof input === 'string' && own(spec.icons, input) ? input : null;
  if (kind === 'point') {
    if (!Array.isArray(input) || input.length !== 2) return null;
    const point = input.map(item => value('num:0:100', item, ctx));
    return point.includes(null) ? null : point;
  }
  if (kind === 'background') return background(input, ctx);
  if (kind === 'border') return border(input, ctx);
  if (kind === 'shadows') return shadows(input, ctx);
  fail('Unknown specification type ' + kind + '.');
}
function background(input, ctx) {
  if (!object(input)) return null;
  if (input.kind === 'color') { const c = color(input.color, ctx); return c ? { kind: 'color', color: c } : null; }
  if (input.kind === 'gradient') {
    const type = input.type === 'radial' ? 'radial' : 'linear';
    const angle = input.angle === undefined ? 180 : value('num:0:360', input.angle, ctx);
    if (angle === null || !Array.isArray(input.stops) || input.stops.length < 2 || input.stops.length > L.gradientStops) return null;
    const stops = input.stops.map(stop => {
      if (!object(stop)) return null;
      const c = color(stop.color, ctx), at = value('num:0:100', stop.at, ctx);
      return c && at !== null ? { color: c, at } : null;
    });
    return stops.includes(null) ? null : { kind: 'gradient', type, angle, stops };
  }
  if (input.kind === 'image') {
    const src = safeUrl(input.src);
    if (!src) return null;
    const result = { kind: 'image', src };
    result.size = value('enum:cover,contain,auto', input.size ?? 'cover', ctx);
    result.position = value('enum:center,top,bottom,left,right,top-left,top-right,bottom-left,bottom-right', input.position ?? 'center', ctx);
    result.repeat = input.repeat === true;
    if (!result.size || !result.position) return null;
    if (input.focal != null) {
      // Focal point in percent of the image, used instead of a named position.
      if (!Array.isArray(input.focal) || input.focal.length !== 2) return null;
      const focal = input.focal.map(item => value('num:0:100', item, ctx));
      if (focal.includes(null)) return null;
      result.focal = focal;
    }
    for (const key of ['overlay', 'color']) {
      if (input[key] == null) continue;
      const c = color(input[key], ctx);
      if (!c) return null;
      result[key] = c;
    }
    return result;
  }
  if (input.kind === 'video') {
    // Video backgrounds play a muted MP4/WebM file; only sections and containers may use them.
    const src = safeUrl(input.src);
    if (!src || videoSource(src)?.kind !== 'file') return null;
    const result = { kind: 'video', src };
    if (input.poster != null && input.poster !== '') { const poster = safeUrl(input.poster); if (!poster) return null; result.poster = poster; }
    for (const key of ['overlay', 'color']) {
      if (input[key] == null) continue;
      const c = color(input[key], ctx);
      if (!c) return null;
      result[key] = c;
    }
    return result;
  }
  return null;
}
function border(input, ctx) {
  if (!object(input)) return null;
  const width = length(input.width ?? '1px'), style = value('enum:solid,dashed,dotted,double,none', input.style ?? 'solid', ctx), c = color(input.color ?? '@line', ctx);
  if (!width || !style || !c) return null;
  const sides = input.sides == null ? ['top', 'right', 'bottom', 'left'] : input.sides;
  if (!Array.isArray(sides) || !sides.length || sides.some(side => !['top', 'right', 'bottom', 'left'].includes(side))) return null;
  return { width, style, color: c, sides: ['top', 'right', 'bottom', 'left'].filter(side => sides.includes(side)) };
}
function shadows(input, ctx) {
  if (!Array.isArray(input) || input.length > L.shadows) return null;
  const result = input.map(item => {
    if (!object(item)) return null;
    const x = length(item.x ?? '0px', { signed: true }), y = length(item.y ?? '0px', { signed: true }), blur = length(item.blur ?? '0px'), spread = length(item.spread ?? '0px', { signed: true }), c = color(item.color ?? '#00000033', ctx);
    if (!x || !y || !blur || !spread || !c) return null;
    const shadow = { x, y, blur, spread, color: c };
    if (item.inset === true) shadow.inset = true;
    return shadow;
  });
  return result.includes(null) ? null : result;
}
// A map of property → value validated against a spec section; unknown keys are dropped.
function props(schema, input, ctx, label) {
  const output = {};
  if (input == null) return output;
  if (!object(input)) fail(label + ' must be an object.');
  for (const [key, type] of Object.entries(schema)) {
    if (!own(input, key) || input[key] === undefined || input[key] === null) continue;
    const result = value(type, input[key], ctx);
    if (result === null) fail('Invalid ' + label + ' value for ' + key + '.');
    output[key] = result;
  }
  return output;
}
// { desktop: {...}, tablet: {...} } with only known breakpoints, in breakpoint order.
function responsive(schema, input, ctx, label) {
  if (input === undefined || input === null) return undefined;
  if (!object(input)) fail(label + ' must be an object keyed by breakpoint.');
  const output = {};
  for (const bp of ctx.bpIds) {
    if (!own(input, bp)) continue;
    const result = props(schema, input[bp], ctx, label);
    if (Object.keys(result).length) output[bp] = result;
  }
  return Object.keys(output).length ? output : undefined;
}
function link(input, ctx) {
  if (!object(input)) return null;
  let result = null;
  if (input.to === 'page' && typeof input.page === 'string' && ctx.pageIds.has(input.page)) {
    result = { to: 'page', page: input.page };
    if (typeof input.anchor === 'string' && ctx.nodeIds.has(input.anchor)) result.anchor = input.anchor;
  }
  if (input.to === 'anchor' && typeof input.node === 'string' && ctx.nodeIds.has(input.node)) result = { to: 'anchor', node: input.node };
  if ((input.to === 'url' || input.to === 'asset') && safeUrl(input.href)) result = { to: input.to, href: safeUrl(input.href) };
  if (input.to === 'email' && typeof input.address === 'string' && P.email.test(input.address)) result = { to: 'email', address: input.address };
  if (input.to === 'phone' && typeof input.number === 'string' && P.phone.test(input.number)) result = { to: 'phone', number: input.number };
  if (result && input.newTab === true) result.newTab = true;
  return result;
}
function runs(input, ctx, budget) {
  if (!Array.isArray(input)) fail('Rich text content must be a list of text runs.');
  return input.map(run => {
    if (!object(run)) fail('Rich text runs must be objects.');
    if (--budget.runs < 0) fail('Rich text has too many runs.');
    const output = { text: text(run.text ?? '', L.textChars, 'Rich text') };
    budget.chars -= chars(output.text);
    if (budget.chars < 0) fail('Rich text must be at most ' + L.textChars + ' characters.');
    for (const mark of ['b', 'i', 'u', 's']) if (run[mark] === true) output[mark] = true;
    if (run.color != null) { const c = color(run.color, ctx); if (!c) fail('Invalid rich text colour.'); output.color = c; }
    for (const [key, type] of Object.entries(spec.richRun)) {
      if (run[key] == null) continue;
      const v = value(type, run[key], ctx);
      if (v === null) fail('Invalid rich text ' + key + '.');
      output[key] = v;
    }
    if (run.link != null) { const l = link(run.link, ctx); if (l) output.link = l; }
    if (run.token === 'year' || run.token === 'siteName') { output.token = run.token; output.text = ''; }
    return output;
  });
}
function richText(input, ctx) {
  if (input == null) return [];
  if (!Array.isArray(input) || input.length > L.richBlocks) fail('Rich text must be a list of at most ' + L.richBlocks + ' blocks.');
  const budget = { runs: L.richRuns, chars: L.textChars };
  return input.map(block => {
    if (!object(block) || !spec.richBlockTags.includes(block.t)) fail('Rich text blocks need a valid tag.');
    const output = { t: block.t };
    if (block.style != null) {
      if (!spec.textStyleKeys.includes(block.style)) fail('Unknown text style.');
      output.style = block.style;
    }
    if (block.align != null) {
      if (!['left', 'center', 'right', 'justify'].includes(block.align)) fail('Invalid text alignment.');
      output.align = block.align;
    }
    for (const [key, type] of Object.entries(spec.richBlock)) {
      if (block[key] == null) continue;
      const v = value(type, block[key], ctx);
      if (v === null) fail('Invalid rich text ' + key + '.');
      output[key] = v;
    }
    if (block.t === 'ul' || block.t === 'ol') {
      if (!Array.isArray(block.items) || block.items.length > L.listItems) fail('Lists need at most ' + L.listItems + ' items.');
      output.items = block.items.map(item => runs(item, ctx, budget));
    } else output.c = runs(block.c ?? [], ctx, budget);
    return output;
  });
}
function nodeProps(type, input, ctx) {
  const schema = spec.nodeTypes[type].props || {};
  const output = {};
  if (input == null) return output;
  if (!object(input)) fail('Element properties must be an object.');
  for (const [key, kind] of Object.entries(schema)) {
    if (!own(input, key) || input[key] === undefined || input[key] === null) continue;
    const source = input[key];
    let result;
    if (kind === 'richtext') result = richText(source, ctx);
    else if (kind.startsWith('text:')) result = text(source, Number(kind.slice(5)), key);
    else if (kind === 'media') { if (source === '') continue; result = safeUrl(source); if (!result) fail('Use a valid HTTP(S) URL or local path for ' + key + '.'); }
    else if (kind === 'video') { if (source === '') continue; if (!videoSource(source)) fail('Videos must be MP4/WebM files or YouTube/Vimeo URLs.'); result = safeUrl(source); }
    else if (kind === 'audio') { if (source === '') continue; result = audioSource(source); if (!result) fail('Audio must be an MP3, M4A, OGG or WAV file.'); }
    else if (kind === 'formFields') { result = formFields(source); if (!result.length) continue; }
    else if (kind === 'socialList') {
      if (!Array.isArray(source) || source.length > L.socialItems) fail('Use no more than ' + L.socialItems + ' social links.');
      result = source.map(entry => {
        if (!object(entry)) fail('Social links need a URL.');
        const url = socialUrl(entry.url);
        if (!url) fail('Social links need a web address, mailto: or tel: link.');
        const icon = entry.icon == null ? 'link' : value('icon', entry.icon, ctx);
        if (icon === null) fail('Choose an icon from the icon set.');
        return { label: text(entry.label ?? '', 80, 'Social link label').trim(), url, icon };
      });
    }
    else if (kind === 'textList') {
      if (!Array.isArray(source) || source.length > L.galleryImages) fail('Use no more than ' + L.galleryImages + ' captions.');
      result = source.map(item => text(item ?? '', 300, 'Caption'));
      while (result.length && result[result.length - 1] === '') result.pop();
      if (!result.length) continue;
    }
    else if (kind === 'mediaList') {
      if (!Array.isArray(source) || source.length > L.galleryImages) fail('Use no more than ' + L.galleryImages + ' gallery images.');
      result = source.map(item => safeUrl(item) || fail('Gallery images need valid URLs.'));
    } else if (kind === 'link') { result = link(source, ctx); if (!result) continue; }
    else { result = value(kind, source, ctx); if (result === null) fail('Invalid element property ' + key + '.'); }
    output[key] = result;
  }
  return output;
}
function normalizeNode(id, source, info, ctx) {
  const type = source.type, definition = spec.nodeTypes[type];
  const node = { id, type };
  if (source.name != null && source.name !== '') node.name = text(source.name, 80, 'Element name');
  if (source.tag != null) {
    if (!definition.tags || !definition.tags.includes(source.tag)) fail('Invalid HTML tag for ' + type + '.');
    node.tag = source.tag;
  }
  const content = nodeProps(type, source.props, ctx);
  if (Object.keys(content).length) node.props = content;
  if (definition.container) node.children = info.children;
  const layout = definition.container ? responsive(spec.layout, source.layout, ctx, 'layout') : undefined;
  if (layout) node.layout = layout;
  const place = info.root ? undefined : responsive(spec.place, source.place, ctx, 'placement');
  if (place) node.place = place;
  const style = responsive(spec.style, source.style, ctx, 'style');
  if (style) node.style = style;
  if (style && !definition.container && Object.values(style).some(values => values.background?.kind === 'video')) fail('Video backgrounds are only available for sections and containers.');
  if (source.hover != null) {
    const hover = props(spec.hover, source.hover, ctx, 'hover');
    if (hover.background?.kind === 'video') fail('Hover backgrounds cannot be videos.');
    if (Object.keys(hover).length) node.hover = hover;
  }
  if (source.hidden != null) {
    if (!object(source.hidden)) fail('Hidden must be an object keyed by breakpoint.');
    const hidden = {};
    for (const bp of ctx.bpIds) if (typeof source.hidden[bp] === 'boolean' && !(bp === 'desktop' && !source.hidden[bp])) hidden[bp] = source.hidden[bp];
    if (Object.keys(hidden).length) node.hidden = hidden;
  }
  if (source.locked === true) node.locked = true;
  return node;
}
function customFont(font) {
  const result = { id: font.id, source: 'custom', family: font.family };
  if (font.src != null) {
    if (typeof font.src !== 'string' || !P.fontFile.test(font.src)) fail('Fonts must be a system font or an uploaded font file.');
    result.src = font.src;
  }
  if (font.files != null) {
    if (!Array.isArray(font.files) || font.files.length < 1 || font.files.length > L.fontFiles) fail('Fonts can have 1–' + L.fontFiles + ' files.');
    result.files = font.files.map(file => {
      if (!object(file) || typeof file.src !== 'string' || !P.fontFile.test(file.src)) fail('Font files must be uploaded font files.');
      const weight = file.weight == null ? 400 : value('int:100:900', file.weight, {});
      const style = file.style == null ? 'normal' : value('enum:normal,italic', file.style, {});
      if (weight === null || style === null) fail('Font files need a weight of 100–900 and a normal or italic style.');
      return { src: file.src, weight, style };
    });
  }
  if (!result.src && !result.files) fail('Fonts must be a system font or an uploaded font file.');
  return result;
}
function normalizeDesign(input, ctx) {
  const design = object(input) ? input : {};
  const colors = {};
  if (design.colors != null) {
    if (!object(design.colors) || Object.keys(design.colors).length > L.colors) fail('Use no more than ' + L.colors + ' theme colours.');
    for (const [key, code] of Object.entries(design.colors)) {
      if (!P.key.test(key) || !hex(code)) fail('Theme colours need a short lowercase name and a hex value.');
      colors[key] = hex(code);
    }
  }
  for (const [key, code] of Object.entries(spec.defaultColors)) if (!own(colors, key)) colors[key] = code;
  ctx.colors = colors;
  const fonts = [];
  const fontIds = new Set();
  const sourceFonts = design.fonts === undefined ? spec.defaultFonts : design.fonts;
  if (!Array.isArray(sourceFonts) || sourceFonts.length > L.fonts) fail('Use no more than ' + L.fonts + ' fonts.');
  for (const font of sourceFonts) {
    if (!object(font) || typeof font.id !== 'string' || !P.key.test(font.id) || fontIds.has(font.id)) fail('Fonts need unique short lowercase IDs.');
    if (font.source === 'system' && own(spec.systemFonts, font.family)) fonts.push({ id: font.id, source: 'system', family: font.family });
    else if (font.source === 'custom' && typeof font.family === 'string' && P.fontFamily.test(font.family)) fonts.push(customFont(font));
    else fail('Fonts must be a system font or an uploaded font file.');
    fontIds.add(font.id);
  }
  for (const font of spec.defaultFonts) if (!fontIds.has(font.id)) { fonts.push({ ...font }); fontIds.add(font.id); }
  ctx.fonts = fontIds;
  const textStyles = {};
  const sourceStyles = object(design.textStyles) ? design.textStyles : {};
  for (const key of spec.textStyleKeys) {
    textStyles[key] = (own(sourceStyles, key) && responsive(spec.textStyle, sourceStyles[key], ctx, 'text style')) || responsive(spec.textStyle, spec.defaultTextStyles[key], ctx, 'text style');
  }
  const body = props({ font: 'font', color: 'color', background: 'color' }, own(design, 'body') ? design.body : { font: 'body', color: '@ink', background: '@bg' }, ctx, 'body style');
  const output = Object.keys(body).length ? { colors, fonts, textStyles, body } : { colors, fonts, textStyles };
  // Saved designs ("presets") are reusable style maps for one element type.
  if (design.presets != null) {
    if (!Array.isArray(design.presets) || design.presets.length > L.presets) fail('Use no more than ' + L.presets + ' saved designs.');
    const ids = new Set();
    const presets = design.presets.map(preset => {
      if (!object(preset) || typeof preset.id !== 'string' || !P.key.test(preset.id) || ids.has(preset.id)) fail('Saved designs need unique short lowercase IDs.');
      if (typeof preset.type !== 'string' || !own(spec.nodeTypes, preset.type)) fail('Saved designs need an element type.');
      ids.add(preset.id);
      const name = text(preset.name, 60, 'Design name').trim();
      if (!name) fail('Saved designs need a name.');
      const result = { id: preset.id, name, type: preset.type };
      const style = responsive(spec.style, preset.style, ctx, 'style');
      if (style) result.style = style;
      return result;
    });
    if (presets.length) output.presets = presets;
  }
  return output;
}
// The site menu: items with a label and a link, one level of sub-items. Items whose link points to
// a deleted page or element are dropped. Without a menu, menus list all pages.
function normalizeMenu(input, ctx) {
  if (!Array.isArray(input)) fail('The site menu must be a list.');
  const ids = new Set();
  let count = 0;
  const item = (source, depth) => {
    if (!object(source) || typeof source.id !== 'string' || !P.id.test(source.id) || ids.has(source.id)) fail('Menu items need unique IDs.');
    ids.add(source.id);
    if (++count > L.menuItems) fail('Use no more than ' + L.menuItems + ' menu items.');
    const target = source.link == null ? null : link(source.link, ctx);
    const result = { id: source.id, label: text(source.label ?? '', 80, 'Menu label').trim() };
    if (target) result.link = target;
    if (source.children != null) {
      if (depth > 0 || !Array.isArray(source.children)) fail('Menu items can have one level of sub-items.');
      const children = source.children.map(child => item(child, 1)).filter(Boolean);
      if (children.length) result.children = children;
    }
    // An item without a link is kept only as a dropdown title for its sub-items.
    if (!target && !result.children) return null;
    if (!target && !result.label) fail('Dropdown titles need a label.');
    return result;
  };
  return input.map(source => item(source, 0)).filter(Boolean);
}
// Form builder fields. "step" splits the form into steps; its label is the step title.
function formFields(input) {
  if (!Array.isArray(input) || input.length > L.formFields) fail('Forms can have at most ' + L.formFields + ' fields.');
  const ids = new Set();
  let files = 0;
  const fields = input.map(field => {
    if (!object(field) || typeof field.id !== 'string' || !/^[a-z][a-z0-9_-]{0,31}$/.test(field.id) || ids.has(field.id) || ['token', 'website'].includes(field.id)) fail('Form fields need unique short IDs.');
    ids.add(field.id);
    if (!spec.formFieldTypes.includes(field.type)) fail('Unknown form field type.');
    const result = { id: field.id, type: field.type, label: text(field.label ?? '', 200, 'Field label').trim() };
    if (!result.label && field.type !== 'step') fail('Form fields need a label.');
    if (field.type === 'step') return result;
    if (field.required === true) result.required = true;
    if (field.placeholder != null && field.placeholder !== '') result.placeholder = text(field.placeholder, 200, 'Placeholder');
    if (field.width != null) { if (!['full', 'half'].includes(field.width)) fail('Field width must be full or half.'); if (field.width === 'half') result.width = 'half'; }
    if (['select', 'radio', 'checkbox'].includes(field.type) && field.options != null) {
      if (!Array.isArray(field.options) || field.options.length > L.formOptions) fail('Use at most ' + L.formOptions + ' options.');
      const options = [...new Set(field.options.map(option => text(option, 120, 'Option').trim()).filter(Boolean))];
      if (options.length) result.options = options;
    }
    if ((field.type === 'select' || field.type === 'radio') && !result.options) fail('Choice fields need at least one option.');
    if (field.type === 'file' && ++files > L.formFiles) fail('Forms can have at most ' + L.formFiles + ' file fields.');
    return result;
  });
  return fields;
}
// The fields a published form accepts; forms without a field list use name, email and message.
export const DEFAULT_FORM_FIELDS = [
  { id: 'name', type: 'text', label: 'Your name', required: true },
  { id: 'email', type: 'email', label: 'Email address', required: true },
  { id: 'message', type: 'textarea', label: 'Your message', required: true }
];
export function formDefinition(site, id) {
  const node = site?.version === 2 ? site.nodes?.[id] : null;
  return node?.type === 'form' && node.props?.fields ? node.props.fields.filter(field => field.type !== 'step') : null;
}
function socialUrl(value) {
  if (typeof value !== 'string') return '';
  if (/^mailto:[^\s<>"']{3,254}$/i.test(value) || /^tel:\+?[0-9() -]{3,30}$/i.test(value)) return value;
  return safeUrl(value);
}
function normalizeBreakpoints(input) {
  const source = input == null ? spec.defaultBreakpoints : input;
  if (!Array.isArray(source) || source.length > L.breakpoints) fail('Use no more than ' + L.breakpoints + ' breakpoints.');
  const ids = new Set(['desktop']);
  const output = source.map(bp => {
    if (!object(bp) || typeof bp.id !== 'string' || !P.key.test(bp.id) || ids.has(bp.id)) fail('Breakpoints need unique short lowercase IDs.');
    if (!Number.isInteger(bp.max) || bp.max < spec.breakpointRange[0] || bp.max > spec.breakpointRange[1]) fail('Breakpoint widths must be ' + spec.breakpointRange.join('–') + ' pixels.');
    ids.add(bp.id);
    return { id: bp.id, name: text(bp.name ?? bp.id, 40, 'Breakpoint name') || bp.id, max: bp.max };
  });
  output.sort((a, b) => b.max - a.max);
  if (new Set(output.map(bp => bp.max)).size !== output.length) fail('Breakpoints need different widths.');
  return output;
}

export function normalizeSiteV2(input) {
  if (!object(input) || input.version !== 2 || !object(input.site) || !Array.isArray(input.pages) || !object(input.nodes)) fail('A v2 site needs metadata, pages, and an element map.');
  if (input.pages.length < 1 || input.pages.length > L.pages) fail('Use 1–' + L.pages + ' pages.');
  if (Object.keys(input.nodes).length > L.nodes) fail('Use no more than ' + L.nodes + ' elements.');
  const settings = input.site;
  const name = text(settings.name, 120, 'Site name').trim() || (settings.name === undefined ? 'Nimble' : '');
  if (!name) fail('Site name is required.');
  const domain = text(settings.domain, 253, 'Domain').trim();
  if (domain && !P.domain.test(domain)) fail('Enter a hostname without a protocol or path.');
  const lang = settings.lang === undefined ? 'en' : settings.lang;
  if (typeof lang !== 'string' || !P.lang.test(lang)) fail('Enter a valid language code such as en or nb-NO.');
  const socialImage = settings.socialImage != null && settings.socialImage !== '' ? safeUrl(text(settings.socialImage, 3000)) || fail('Use a valid HTTP(S) URL or local path for the social image.') : '';
  const site = { name, domain, description: text(settings.description, 2000, 'Description'), lang, searchVisible: settings.searchVisible !== false, socialImage };

  const breakpoints = normalizeBreakpoints(input.breakpoints);
  const ctx = { bpIds: ['desktop', ...breakpoints.map(bp => bp.id)] };
  const design = normalizeDesign(input.design, ctx);

  if (input.assets != null && (!Array.isArray(input.assets) || input.assets.length > L.assets)) fail('Use no more than ' + L.assets + ' media assets.');
  const assets = [], assetIds = new Set();
  for (const asset of input.assets || []) {
    if (!object(asset) || typeof asset.id !== 'string' || !P.id.test(asset.id) || assetIds.has(asset.id) || !['image', 'video', 'audio'].includes(asset.kind)) fail('Each media asset needs a unique valid ID and media type.');
    assetIds.add(asset.id);
    const url = safeUrl(text(asset.url, 3000, 'Media URL'));
    if (!url) fail('Media assets need a valid URL.');
    assets.push({ id: asset.id, name: text(asset.name, 200, 'Media name') || 'Media', kind: asset.kind, url });
  }

  // Pages: identity and addresses first, so links can refer to them.
  const pageIds = new Set(), paths = new Set(), pages = [];
  for (const item of input.pages) {
    if (!object(item) || typeof item.id !== 'string' || !P.pageId.test(item.id) || pageIds.has(item.id)) fail('Pages need unique lowercase IDs.');
    pageIds.add(item.id);
    const path = item.id === 'home' ? '/' : (item.path === undefined ? '/' + item.id : text(item.path, 200, 'Page address'));
    if (!P.pagePath.test(path) || paths.has(path) || P.reservedPath.test(path)) fail('Choose a unique page address outside reserved application paths.');
    paths.add(path);
    const pageName = text(item.name, 120, 'Page name').trim();
    if (!pageName) fail('Every page needs a name.');
    if (!Array.isArray(item.children) || item.children.length > L.children) fail('Pages need a list of at most ' + L.children + ' sections.');
    const page = { id: item.id, name: pageName, path, children: item.children.slice() };
    for (const key of ['title', 'description']) if (item[key] != null && item[key] !== '') page[key] = text(item[key], key === 'title' ? 200 : 2000, 'Page ' + key);
    page.showHeader = item.showHeader !== false;
    page.showFooter = item.showFooter !== false;
    pages.push(page);
  }
  if (!pageIds.has('home')) fail('The site needs a home page.');

  // Tree walk: every reachable element appears exactly once, roots are sections.
  const infos = new Map();
  const visit = (id, depth, root) => {
    if (typeof id !== 'string' || !P.id.test(id) || !own(input.nodes, id)) fail('An element reference is missing or invalid.');
    if (infos.has(id)) fail('An element can only appear once in the site.');
    const source = input.nodes[id];
    if (!object(source) || !own(spec.nodeTypes, source.type)) fail('An element has an invalid type.');
    const definition = spec.nodeTypes[source.type];
    if (root !== !!definition.root) fail(root ? 'Pages, headers and footers may only contain sections.' : 'Sections can only be placed directly on a page.');
    if (depth > L.depth) fail('Elements can be nested at most ' + L.depth + ' levels deep.');
    const info = { root, children: [] };
    infos.set(id, info);
    if (definition.container) {
      const children = source.children === undefined ? [] : source.children;
      if (!Array.isArray(children) || children.length > L.children) fail('Containers can hold at most ' + L.children + ' elements.');
      info.children = children.slice();
      for (const child of children) visit(child, depth + 1, false);
    }
  };
  const header = input.header === undefined || input.header === null ? null : input.header;
  const footer = input.footer === undefined || input.footer === null ? null : input.footer;
  if (header !== null) visit(header, 1, true);
  if (footer !== null) visit(footer, 1, true);
  for (const page of pages) for (const id of page.children) visit(id, 1, true);
  ctx.pageIds = pageIds;
  ctx.nodeIds = new Set(infos.keys());
  const nodes = {};
  for (const [id, info] of infos) nodes[id] = normalizeNode(id, input.nodes[id], info, ctx);
  for (const id of [header, footer]) if (id !== null && nodes[id]?.props?.popup) fail('Headers and footers cannot be popups.');
  const menu = input.menu == null ? null : normalizeMenu(input.menu, ctx);

  const output = { version: 2, site, design, breakpoints, assets };
  if (header !== null) output.header = header;
  if (footer !== null) output.footer = footer;
  if (menu !== null) output.menu = menu;
  output.pages = pages;
  output.nodes = nodes;
  return output;
}

export function pageHref(site, pageId) {
  const page = site.pages.find(item => item.id === pageId);
  return !page ? '#' : page.id === 'home' ? './' : './' + page.id + '.html';
}
export function hasForm(site, id) {
  return site?.version === 2 ? site.nodes?.[id]?.type === 'form' : !!site?.pages?.some(page => page.blocks.includes(id)) && site.blocks?.[id]?.type === 'form';
}

// Re-validates one element of an already normalized site whose tree structure is unchanged
// (same id, type and children). The editor uses this for fast commits; the server always runs normalizeSiteV2.
export function normalizeNodeV2(site, id) {
  const source = site.nodes[id];
  if (!object(source) || !own(spec.nodeTypes, source.type)) fail('An element has an invalid type.');
  const ctx = {
    bpIds: ['desktop', ...site.breakpoints.map(bp => bp.id)],
    colors: site.design.colors,
    fonts: new Set(site.design.fonts.map(font => font.id)),
    pageIds: new Set(site.pages.map(page => page.id)),
    nodeIds: new Set(Object.keys(site.nodes))
  };
  const root = site.header === id || site.footer === id || site.pages.some(page => page.children.includes(id));
  return normalizeNode(id, source, { root, children: (source.children || []).slice() }, ctx);
}
