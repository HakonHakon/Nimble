// Renders a normalized v2 site to static HTML + CSS. Ported 1:1 in php-backend/lib/render-v2.php.
import { spec, safeUrl, videoSource, pageHref } from './site-model-v2.mjs';

export const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
const e = escapeHtml;
const SIDES = ['top', 'right', 'bottom', 'left'];
const RESET = { 'grid-area': 'auto', 'justify-self': 'auto', 'align-self': 'auto', order: '0', transform: 'none', 'z-index': 'auto', 'grid-template-columns': 'none', 'grid-template-rows': 'none', 'flex-direction': 'row', 'flex-wrap': 'nowrap', 'justify-content': 'normal', 'justify-items': 'normal', 'align-items': 'normal', 'row-gap': 'normal', 'column-gap': 'normal', margin: '0', padding: '0', 'min-height': 'auto', width: 'auto', height: 'auto', 'min-width': 'auto', 'max-width': 'none', 'max-height': 'none' };
const FLEX = { start: 'flex-start', end: 'flex-end', center: 'center', stretch: 'stretch', baseline: 'baseline', 'space-between': 'space-between', 'space-around': 'space-around', 'space-evenly': 'space-evenly' };

export const colorValue = value => value.startsWith('@') ? 'var(--c-' + value.slice(1) + ')' : value;
const bpIds = site => ['desktop', ...site.breakpoints.map(bp => bp.id)];
function cascade(map, ids, index) {
  const result = {};
  if (!map) return result;
  for (let i = 0; i <= index; i++) if (map[ids[i]]) Object.assign(result, map[ids[i]]);
  return result;
}
function hiddenAt(node, ids, index) {
  let hidden = false;
  if (node.hidden) for (let i = 0; i <= index; i++) if (typeof node.hidden[ids[i]] === 'boolean') hidden = node.hidden[ids[i]];
  return hidden;
}
class Rules {
  constructor() { this.map = new Map(); }
  set(selector, property, value) {
    if (!this.map.has(selector)) this.map.set(selector, new Map());
    this.map.get(selector).set(property, value);
  }
}
const sizeValue = (value, max = false) => value === 'auto' && max ? 'none' : value;
function background(value) {
  if (value.kind === 'color') return colorValue(value.color);
  if (value.kind === 'gradient') {
    const stops = value.stops.map(stop => colorValue(stop.color) + ' ' + stop.at + '%').join(',');
    return value.type === 'radial' ? 'radial-gradient(circle,' + stops + ')' : 'linear-gradient(' + value.angle + 'deg,' + stops + ')';
  }
  if (value.kind === 'video') return value.color ? colorValue(value.color) : 'transparent';
  const overlay = value.overlay ? 'linear-gradient(' + colorValue(value.overlay) + ',' + colorValue(value.overlay) + '),' : '';
  const position = value.focal ? value.focal[0] + '% ' + value.focal[1] + '%' : value.position.replace('-', ' ');
  return overlay + 'url("' + value.src + '") ' + position + '/' + value.size + ' ' + (value.repeat ? 'repeat' : 'no-repeat') + (value.color ? ' ' + colorValue(value.color) : '');
}
const shadowText = list => list.length ? list.map(item => (item.inset ? 'inset ' : '') + item.x + ' ' + item.y + ' ' + item.blur + ' ' + item.spread + ' ' + colorValue(item.color)).join(',') : 'none';
// Distinct video backgrounds of an element across breakpoints, in breakpoint order.
export function videoBackgrounds(node) {
  const list = [];
  for (const values of Object.values(node.style || {})) {
    const value = values.background;
    if (value?.kind === 'video' && !list.some(item => item.src === value.src)) list.push({ src: value.src, poster: value.poster });
  }
  return list;
}
const HOVER_PROPERTIES = ['color', 'background', 'border-color', 'box-shadow', 'opacity', 'scale', 'translate'];
function typography(rules, selector, style) {
  if (style.color) rules.set(selector, 'color', colorValue(style.color));
  if (style.font) rules.set(selector, 'font-family', 'var(--f-' + style.font + ')');
  if (style.fontSize) rules.set(selector, 'font-size', style.fontSize);
  if (style.fontWeight !== undefined) rules.set(selector, 'font-weight', String(style.fontWeight));
  if (style.lineHeight !== undefined) rules.set(selector, 'line-height', String(style.lineHeight));
  if (style.letterSpacing) rules.set(selector, 'letter-spacing', style.letterSpacing);
  if (style.textAlign) rules.set(selector, 'text-align', style.textAlign);
  if (style.textTransform) rules.set(selector, 'text-transform', style.textTransform);
}
function nodeRules(rules, site, node, parentLayout, ids, index) {
  const selector = '.n-' + node.id, definition = spec.nodeTypes[node.type];
  const layout = cascade(node.layout, ids, index), place = cascade(node.place, ids, index), style = cascade(node.style, ids, index);
  let display = definition.display;
  if (definition.container) display = layout.mode === 'stack' ? 'flex' : 'grid';
  rules.set(selector, 'display', hiddenAt(node, ids, index) ? 'none' : display);
  if (definition.container) {
    if (display === 'flex') {
      rules.set(selector, 'flex-direction', layout.direction || 'column');
      rules.set(selector, 'flex-wrap', layout.wrap ? 'wrap' : 'nowrap');
      if (layout.justify) rules.set(selector, 'justify-content', FLEX[layout.justify]);
      if (layout.align) rules.set(selector, 'align-items', FLEX[layout.align]);
    } else {
      if (layout.columns) rules.set(selector, 'grid-template-columns', layout.columns.join(' '));
      if (layout.rows) rules.set(selector, 'grid-template-rows', layout.rows.join(' '));
      if (layout.justify && ['start', 'center', 'end', 'stretch'].includes(layout.justify)) rules.set(selector, 'justify-items', layout.justify);
      if (layout.align) rules.set(selector, 'align-items', layout.align);
    }
    if (layout.rowGap) rules.set(selector, 'row-gap', layout.rowGap);
    if (layout.columnGap) rules.set(selector, 'column-gap', layout.columnGap);
    if (layout.padding || (layout.contentWidth && layout.contentWidth !== 'auto')) {
      const [top, right, bottom, left] = layout.padding || ['0px', '0px', '0px', '0px'];
      const width = layout.contentWidth && layout.contentWidth !== 'auto' ? layout.contentWidth : '';
      const side = value => width ? 'max(' + value + ',calc((100% - ' + width + ') / 2))' : value;
      rules.set(selector, 'padding', top + ' ' + side(right) + ' ' + bottom + ' ' + side(left));
    }
    if (layout.minHeight) rules.set(selector, 'min-height', layout.minHeight);
  }
  if (parentLayout) {
    if (parentLayout.mode === 'stack') {
      if (place.alignSelf) rules.set(selector, 'align-self', FLEX[place.alignSelf]);
      if (place.order !== undefined) rules.set(selector, 'order', String(place.order));
    } else {
      if (place.cell) rules.set(selector, 'grid-area', place.cell[0] + ' / ' + place.cell[1] + ' / span ' + place.cell[2] + ' / span ' + place.cell[3]);
      if (place.justifySelf) rules.set(selector, 'justify-self', place.justifySelf);
      if (place.alignSelf) rules.set(selector, 'align-self', place.alignSelf);
    }
    if (place.margin) rules.set(selector, 'margin', place.margin.join(' '));
    for (const [key, property] of [['width', 'width'], ['height', 'height'], ['minWidth', 'min-width'], ['maxWidth', 'max-width'], ['minHeight', 'min-height'], ['maxHeight', 'max-height']]) {
      if (place[key]) rules.set(selector, property, sizeValue(place[key], key.startsWith('max')));
    }
    if (place.rotate) rules.set(selector, 'transform', 'rotate(' + place.rotate + 'deg)');
    if (place.z !== undefined) rules.set(selector, 'z-index', String(place.z));
  }
  const props = node.props || {};
  if (node.type === 'image' && props.fit) rules.set(selector + ' img', 'object-fit', props.fit);
  if (node.type === 'gallery') {
    rules.set(selector, 'grid-template-columns', 'repeat(auto-fill,minmax(' + (props.minItemWidth || '180px') + ',1fr))');
    rules.set(selector, 'gap', props.gap || '16px');
    rules.set(selector + '>img', 'height', props.itemHeight || '250px');
  }
  if (node.type === 'shape' && props.shape === 'ellipse') rules.set(selector, 'border-radius', '50%');
  if (node.type === 'shape' && props.shape === 'blob') rules.set(selector, 'border-radius', '38% 62% 58% 42%');
  if (node.type === 'menu') {
    rules.set(selector, 'flex-direction', props.orientation === 'vertical' ? 'column' : 'row');
    if (props.activeColor) rules.set(selector + ' a[aria-current]', 'color', colorValue(props.activeColor));
  }
  typography(rules, node.type === 'text' ? selector + '.t-text,' + selector + '.t-text>*' : selector, style);
  if (style.background) rules.set(selector, 'background', background(style.background));
  if (style.opacity !== undefined) rules.set(selector, 'opacity', String(style.opacity));
  if (style.border) for (const side of SIDES) rules.set(selector, 'border-' + side, style.border.sides.includes(side) ? style.border.width + ' ' + style.border.style + ' ' + colorValue(style.border.color) : 'none');
  if (style.radius) rules.set(selector, 'border-radius', style.radius.join(' '));
  if (style.shadow) rules.set(selector, 'box-shadow', shadowText(style.shadow));
  const videos = videoBackgrounds(node);
  if (videos.length) {
    const active = style.background?.kind === 'video' ? style.background : null;
    rules.set(selector, 'isolation', 'isolate');
    videos.forEach((item, i) => rules.set(selector + '>.bg-v' + i, 'display', active?.src === item.src ? 'block' : 'none'));
    rules.set(selector + '>.bg-overlay', 'background', active?.overlay ? colorValue(active.overlay) : 'transparent');
  }
  if (style.blendMode) rules.set(selector, 'mix-blend-mode', style.blendMode);
  if (style.scrollEffect) {
    rules.set(selector, '--fx', style.scrollEffect);
    rules.set(selector, 'background-attachment', style.scrollEffect === 'reveal' ? 'fixed' : 'scroll');
  }
  if (node.hover) {
    const hover = node.hover, on = selector + ':hover';
    rules.set(selector, 'transition', HOVER_PROPERTIES.map(property => property + ' ' + (hover.duration ?? 200) + 'ms ease').join(','));
    if (hover.color) rules.set(node.type === 'text' ? selector + '.t-text:hover,' + selector + '.t-text:hover>*' : on, 'color', colorValue(hover.color));
    if (hover.background) rules.set(on, 'background', background(hover.background));
    if (hover.borderColor) rules.set(on, 'border-color', colorValue(hover.borderColor));
    if (hover.shadow) rules.set(on, 'box-shadow', shadowText(hover.shadow));
    if (hover.opacity !== undefined) rules.set(on, 'opacity', String(hover.opacity));
    if (hover.scale !== undefined) rules.set(on, 'scale', String(hover.scale));
    if (hover.translateY) rules.set(on, 'translate', '0 ' + hover.translateY);
  }
  if (style.linkUnderline !== undefined) rules.set(selector + ' a', 'text-decoration', style.linkUnderline ? 'underline' : 'none');
  if (style.padding && !definition.container) rules.set(selector, 'padding', style.padding.join(' '));
}
function cssText(rules) {
  let output = '';
  for (const [selector, declarations] of rules.map) {
    if (!declarations.size) continue;
    output += selector + '{' + [...declarations].map(([property, value]) => property + ':' + value).join(';') + '}';
  }
  return output;
}
function diff(previous, current) {
  const result = new Rules();
  for (const [selector, declarations] of current.map) {
    const before = previous.map.get(selector) || new Map();
    for (const [property, value] of declarations) if (before.get(property) !== value) result.set(selector, property, value);
  }
  for (const [selector, declarations] of previous.map) {
    const after = current.map.get(selector) || new Map();
    for (const [property] of declarations) if (!after.has(property)) result.set(selector, property, Object.hasOwn(RESET, property) ? RESET[property] : 'unset');
  }
  return result;
}
// CSS is assembled per element: its desktop rules plus, for each breakpoint, only what changes there.
// An element's CSS depends on itself and its parent's layout, so the editor can cache it per node object.
function chunk(ids, build) {
  const parts = [];
  let previous = null;
  for (let index = 0; index < ids.length; index++) {
    const rules = new Rules();
    build(rules, index);
    parts.push(index === 0 ? cssText(rules) : cssText(diff(previous, rules)));
    previous = rules;
  }
  return parts;
}
function parentLayoutAt(parent, ids, index) {
  const layout = cascade(parent.layout, ids, index);
  return layout.mode === 'stack' ? layout : { ...layout, mode: 'grid' };
}
export function nodeCss(site, node, parent, ids = bpIds(site)) {
  return chunk(ids, (rules, index) => nodeRules(rules, site, node, parent ? parentLayoutAt(parent, ids, index) : null, ids, index));
}
export function createCssCache() { return { nodes: new WeakMap(), breakpoints: null }; }
export function siteCss(site, roots, cache = null) {
  const ids = bpIds(site);
  if (cache && cache.breakpoints !== site.breakpoints) { cache.nodes = new WeakMap(); cache.breakpoints = site.breakpoints; }
  let css = ':root{' + Object.entries(site.design.colors).map(([key, hex]) => '--c-' + key + ':' + hex).join(';');
  for (const font of site.design.fonts) css += ';--f-' + font.id + ':' + (font.source === 'system' ? spec.systemFonts[font.family] : '"' + font.family + '",system-ui,sans-serif');
  css += '}';
  // Several font IDs can share one family (e.g. "heading" copied from an imported font); each face is declared once.
  const faces = new Set();
  const face = rule => { if (!faces.has(rule)) { faces.add(rule); css += rule; } };
  for (const font of site.design.fonts) {
    if (font.source !== 'custom') continue;
    if (font.src) face('@font-face{font-family:"' + font.family + '";src:url("' + font.src + '");font-display:swap}');
    for (const file of font.files || []) face('@font-face{font-family:"' + font.family + '";src:url("' + file.src + '");font-weight:' + file.weight + ';font-style:' + file.style + ';font-display:swap}');
  }
  const body = site.design.body || {};
  css += 'body{' + [body.font && 'font-family:var(--f-' + body.font + ')', body.color && 'color:' + colorValue(body.color), body.background && 'background:' + colorValue(body.background)].filter(Boolean).join(';') + '}';
  const out = ids.map(() => '');
  const add = parts => parts.forEach((part, index) => { out[index] += part; });
  for (const key of spec.textStyleKeys) add(chunk(ids, (rules, index) => typography(rules, '.ts-' + key, cascade(site.design.textStyles[key], ids, index))));
  const walk = (id, parent) => {
    const node = site.nodes[id];
    let entry = cache?.nodes.get(node);
    if (!entry || entry.parent !== parent) { entry = { parent, parts: nodeCss(site, node, parent, ids) }; cache?.nodes.set(node, entry); }
    add(entry.parts);
    for (const child of node.children || []) walk(child, node);
  };
  for (const id of roots) walk(id, null);
  css += out[0];
  site.breakpoints.forEach((bp, offset) => { if (out[offset + 1]) css += '@media (max-width:' + bp.max + 'px){' + out[offset + 1] + '}'; });
  return css;
}
export function linkHref(site, link) {
  if (link.to === 'page') return pageHref(site, link.page) + (link.anchor ? '#' + link.anchor : '');
  if (link.to === 'anchor') return '#' + link.node;
  if (link.to === 'email') return 'mailto:' + link.address;
  if (link.to === 'phone') return 'tel:' + link.number.replace(/[^0-9+]/g, '');
  return link.href;
}
const linkAttributes = (site, link) => ' href="' + e(linkHref(site, link)) + '"' + (link.newTab ? ' target="_blank" rel="noopener noreferrer"' : '');
function runsHtml(site, runs, options) {
  return runs.map(run => {
    let html = e(run.token === 'year' ? String(options.year) : run.token === 'siteName' ? site.site.name : run.text).replace(/\n/g, '<br>');
    if (run.b) html = '<strong>' + html + '</strong>';
    if (run.i) html = '<em>' + html + '</em>';
    if (run.u) html = '<u>' + html + '</u>';
    if (run.s) html = '<s>' + html + '</s>';
    if (run.color) html = '<span style="color:' + e(colorValue(run.color)) + '">' + html + '</span>';
    if (run.link) html = '<a' + linkAttributes(site, run.link) + '>' + html + '</a>';
    return html;
  }).join('');
}
function richHtml(site, doc, options) {
  return doc.map(block => {
    const className = 'ts-' + (block.style || spec.richDefaultStyle[block.t]) + (block.align ? ' ta-' + block.align : '');
    if (block.items) return '<' + block.t + ' class="' + className + '">' + block.items.map(item => '<li>' + runsHtml(site, item, options) + '</li>').join('') + '</' + block.t + '>';
    return '<' + block.t + ' class="' + className + '">' + runsHtml(site, block.c, options) + '</' + block.t + '>';
  }).join('');
}
export function renderNode(site, id, page, options) {
  const node = site.nodes[id], props = node.props || {}, definition = spec.nodeTypes[node.type];
  const effect = Object.values(node.style || {}).some(values => values.scrollEffect && values.scrollEffect !== 'none');
  const attributes = ' id="' + e(node.id) + '" class="n n-' + e(node.id) + ' t-' + node.type + '"' + (effect ? ' data-fx' : '');
  if (definition.container) {
    const tag = node.tag || (node.type === 'section' ? 'section' : 'div');
    const videos = videoBackgrounds(node);
    const media = videos.map((item, i) => '<video class="bg-video bg-v' + i + '" src="' + e(item.src) + '"' + (item.poster ? ' poster="' + e(item.poster) + '"' : '') + ' autoplay muted loop playsinline preload="metadata" aria-hidden="true"></video>').join('') + (videos.length ? '<span class="bg-overlay" aria-hidden="true"></span>' : '');
    return '<' + tag + attributes + '>' + media + node.children.map(child => renderNode(site, child, page, options)).join('') + '</' + tag + '>';
  }
  if (node.type === 'text') return '<div' + attributes + '>' + richHtml(site, props.doc || [], options) + '</div>';
  if (node.type === 'image') {
    const image = props.src ? '<img loading="lazy" decoding="async" src="' + e(props.src) + '" alt="' + e(props.alt || '') + '">' : '';
    return props.link ? '<a' + attributes + linkAttributes(site, props.link) + '>' + image + '</a>' : '<div' + attributes + '>' + image + '</div>';
  }
  if (node.type === 'button') {
    const label = e(props.label || 'Learn more');
    return props.link ? '<a' + attributes + linkAttributes(site, props.link) + '>' + label + '</a>' : '<button type="button"' + attributes + '>' + label + '</button>';
  }
  if (node.type === 'video') {
    const video = props.src ? videoSource(props.src) : null;
    let body = '<p class="muted">Video coming soon.</p>';
    if (video?.kind === 'file') {
      const flags = (props.controls === false ? '' : ' controls') + (props.autoplay ? ' autoplay playsinline' : '') + (props.loop ? ' loop' : '') + (props.muted || props.autoplay ? ' muted' : '');
      body = '<video' + flags + ' preload="metadata"' + (props.poster ? ' poster="' + e(props.poster) + '"' : '') + ' src="' + e(video.url) + '">Your browser does not support this video.</video>';
    } else if (video) body = '<iframe loading="lazy" src="' + e(video.url) + '" title="' + e(props.title || 'Video') + '" allow="fullscreen; picture-in-picture; encrypted-media" referrerpolicy="strict-origin-when-cross-origin" allowfullscreen></iframe>';
    return '<div' + attributes + '>' + body + '</div>';
  }
  if (node.type === 'gallery') {
    const images = props.images || site.assets.filter(asset => asset.kind === 'image').slice(0, 6).map(asset => asset.url);
    return '<div' + attributes + '>' + images.map(url => '<img loading="lazy" decoding="async" src="' + e(safeUrl(url)) + '" alt="' + e(props.alt || '') + '">').join('') + '</div>';
  }
  if (node.type === 'form') {
    return '<div' + attributes + '><form action="/api/contact" method="post" data-contact-form data-block="' + e(node.id) + '"><label>Your name<input name="name" autocomplete="name" maxlength="120" required></label><label>Email address<input name="email" type="email" autocomplete="email" maxlength="254" required></label><label>Your message<textarea name="message" maxlength="5000" required></textarea></label><div class="honeypot" aria-hidden="true"><label>Leave blank<input name="website" tabindex="-1" autocomplete="off"></label></div><input type="hidden" name="token"><button class="button" type="submit">' + e(props.submitLabel || 'Send message ↗') + '</button><p role="status" class="form-status" aria-live="polite"></p><small>' + e(props.note ?? 'We use these details only to respond to your enquiry.') + '</small></form></div>';
  }
  if (node.type === 'divider') return '<hr' + attributes + '>';
  if (node.type === 'menu') return '<nav' + attributes + ' aria-label="Main navigation">' + site.pages.map(item => '<a' + (item.id === page.id ? ' aria-current="page"' : '') + ' href="' + e(pageHref(site, item.id)) + '">' + e(item.name) + '</a>').join('') + '</nav>';
  return '<div' + attributes + ' aria-hidden="true"></div>';
}
export function pageRoots(site, page) {
  return [...(site.header && page.showHeader ? [site.header] : []), ...page.children, ...(site.footer && page.showFooter ? [site.footer] : [])];
}
export function pageHtmlV2(site, page, options = {}) {
  const settings = { year: options.year ?? new Date().getFullYear() };
  const roots = pageRoots(site, page);
  const header = site.header && page.showHeader ? renderNode(site, site.header, page, settings) : '';
  const footer = site.footer && page.showFooter ? renderNode(site, site.footer, page, settings) : '';
  const title = page.title || page.name + ' — ' + site.site.name;
  const description = page.description || site.site.description;
  return '<!doctype html><html lang="' + e(site.site.lang) + '"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>' + e(title) + '</title><meta name="description" content="' + e(description) + '"><meta name="robots" content="' + (site.site.searchVisible ? 'index,follow' : 'noindex,nofollow') + '"><meta property="og:title" content="' + e(title) + '"><meta property="og:description" content="' + e(description) + '">' + (site.site.socialImage ? '<meta property="og:image" content="' + e(site.site.socialImage) + '">' : '') + '<link rel="stylesheet" href="/assets/public-v2.css"><style>' + siteCss(site, roots) + '</style><script defer src="/assets/public.js"></script></head><body><a class="skip" href="#content">Skip to content</a>' + header + '<main id="content">' + page.children.map(id => renderNode(site, id, page, settings)).join('') + '</main>' + footer + '</body></html>';
}
