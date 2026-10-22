// Tree helpers for the v2 editor: parent lookup, labels, defaults, and move rules.
import { spec } from '/assets/site-model-v2.mjs';

export const TYPES = {
  section: { label: 'Section', icon: '▭' }, container: { label: 'Container', icon: '▢' }, text: { label: 'Text', icon: 'T' },
  image: { label: 'Image', icon: '▨' }, button: { label: 'Button', icon: '⬭' }, video: { label: 'Video', icon: '▶' },
  gallery: { label: 'Gallery', icon: '▦' }, form: { label: 'Contact form', icon: '✉' }, shape: { label: 'Shape', icon: '◆' },
  spacer: { label: 'Spacer', icon: '↕' }, divider: { label: 'Line', icon: '―' }, menu: { label: 'Menu', icon: '☰' }, icon: { label: 'Icon', icon: '★' },
  audio: { label: 'Audio', icon: '♪' }
};
export const isContainer = type => !!spec.nodeTypes[type]?.container;
export const isRoot = type => !!spec.nodeTypes[type]?.root;

export function newId(doc, prefix) {
  const alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let id;
  do {
    const bytes = crypto.getRandomValues(new Uint8Array(8));
    id = prefix + '-' + [...bytes].map(byte => alphabet[byte % alphabet.length]).join('');
  } while (doc.nodes[id]);
  return id;
}

// Where every element lives: { parent: node id or null, list: 'header' | 'footer' | 'page' | 'node', page: page index }.
export function indexTree(doc) {
  const index = new Map();
  const walk = (id, parent, list, page) => {
    const node = doc.nodes[id];
    if (!node) return;
    index.set(id, { parent, list, page });
    for (const child of node.children || []) walk(child, id, 'node', page);
  };
  if (doc.header) walk(doc.header, null, 'header', -1);
  if (doc.footer) walk(doc.footer, null, 'footer', -1);
  doc.pages.forEach((page, position) => page.children.forEach(id => walk(id, null, 'page', position)));
  return index;
}
export function ancestors(index, id) {
  const chain = [];
  for (let current = id; current; current = index.get(current)?.parent) chain.unshift(current);
  return chain;
}
export function descendants(doc, id) {
  const result = [];
  const walk = current => { result.push(current); for (const child of doc.nodes[current]?.children || []) walk(child); };
  walk(id);
  return result;
}
function plainText(node) {
  const runs = (node.props?.doc || []).flatMap(block => block.items ? block.items.flat() : block.c);
  return runs.map(run => run.token ? '{' + run.token + '}' : run.text).join('').replace(/\s+/g, ' ').trim();
}
export function label(node) {
  if (node.name) return node.name;
  if (node.type === 'text') return plainText(node).slice(0, 40) || 'Text';
  if (node.type === 'button' && node.props?.label) return node.props.label;
  return TYPES[node.type]?.label || node.type;
}
// The path of the list that holds an element, and the list itself.
export function listOf(doc, index, id) {
  const place = index.get(id);
  if (!place) return null;
  if (place.list === 'node') return { path: ['nodes', place.parent, 'children'], items: doc.nodes[place.parent].children };
  if (place.list === 'page') return { path: ['pages', place.page, 'children'], items: doc.pages[place.page].children };
  return null;
}
// A drop target is { parent: container id | null (page root), page: page index, position: index in that list }.
export function canDrop(doc, index, id, target) {
  const node = doc.nodes[id], place = index.get(id);
  if (!node || !place || place.list === 'header' || place.list === 'footer') return false;
  if (target.parent === null) return isRoot(node.type);
  const parent = doc.nodes[target.parent];
  if (!parent || !isContainer(parent.type) || isRoot(node.type)) return false;
  return !ancestors(index, target.parent).includes(id);
}
export function moveOps(doc, index, id, target) {
  const from = listOf(doc, index, id);
  const toPath = target.parent === null ? ['pages', target.page, 'children'] : ['nodes', target.parent, 'children'];
  const sameList = from.path.join('/') === toPath.join('/');
  const source = from.items.filter(item => item !== id);
  let position = target.position;
  if (sameList && from.items.indexOf(id) < position) position -= 1;
  const destination = sameList ? source : (target.parent === null ? doc.pages[target.page].children : doc.nodes[target.parent].children).slice();
  destination.splice(Math.max(0, Math.min(position, destination.length)), 0, id);
  return sameList ? [{ path: from.path, value: destination }] : [{ path: from.path, value: source }, { path: toPath, value: destination }];
}

const SECTION_LAYOUT = { desktop: { mode: 'stack', direction: 'column', align: 'start', rowGap: '16px', padding: ['60px', '35px', '60px', '35px'], contentWidth: '1022px' }, mobile: { padding: ['40px', '20px', '40px', '20px'] } };
// [kind, label, group, search words] — kinds map to element types in createNode.
export const ADDABLE = [
  ['section', 'Section (boxed)', 'Sections', 'strip band area'], ['section-full', 'Section (full width)', 'Sections', 'strip band wide'], ['section-screen', 'Full-screen section', 'Sections', 'hero cover viewport'], ['section-columns', 'Two-column section', 'Sections', 'split columns'],
  ['grid', 'Grid', 'Layout', 'columns cells'], ['grid-3', '3-column grid', 'Layout', 'columns cards'], ['stack', 'Vertical stack', 'Layout', 'column flex'], ['stack-row', 'Horizontal stack', 'Layout', 'row flex'], ['container', 'Box', 'Layout', 'container card frame'],
  ['title', 'Title', 'Text', 'h1 heading headline'], ['heading', 'Heading', 'Text', 'h2 subtitle'], ['text', 'Paragraph', 'Text', 'body copy text'], ['text-list', 'Bulleted list', 'Text', 'list bullets points'],
  ['button', 'Button', 'Buttons', 'call to action cta link'], ['button-outline', 'Outline button', 'Buttons', 'secondary ghost border'], ['button-icon', 'Button with icon', 'Buttons', 'arrow'], ['icon-button', 'Icon button', 'Buttons', 'round circle'],
  ['image', 'Image', 'Media', 'picture photo svg'], ['video', 'Video', 'Media', 'youtube vimeo mp4 film'], ['gallery', 'Gallery', 'Media', 'images photos grid'], ['gallery-masonry', 'Masonry gallery', 'Media', 'images photos pinterest columns'], ['slideshow', 'Slideshow', 'Media', 'slider carousel images photos'], ['audio', 'Audio player', 'Media', 'music sound podcast mp3'],
  ['shape', 'Rectangle', 'Shapes and icons', 'box square shape'], ['shape-ellipse', 'Circle', 'Shapes and icons', 'ellipse round shape'], ['shape-blob', 'Blob', 'Shapes and icons', 'organic shape'], ['icon', 'Icon', 'Shapes and icons', 'symbol glyph svg'],
  ['divider', 'Horizontal line', 'Shapes and icons', 'divider rule separator'], ['line-vertical', 'Vertical line', 'Shapes and icons', 'divider separator'], ['spacer', 'Spacer', 'Shapes and icons', 'gap space empty'],
  ['menu', 'Menu', 'Navigation', 'navigation nav links pages'], ['form', 'Contact form', 'Forms', 'contact message email']
];
const KIND_TYPES = { heading: 'text', title: 'text', 'text-list': 'text', 'section-full': 'section', 'section-screen': 'section', 'section-columns': 'section', grid: 'container', 'grid-3': 'container', stack: 'container', 'stack-row': 'container', 'button-outline': 'button', 'button-icon': 'button', 'icon-button': 'button', 'shape-ellipse': 'shape', 'shape-blob': 'shape', 'line-vertical': 'divider', 'gallery-masonry': 'gallery', slideshow: 'gallery' };
export const typeOfKind = kind => KIND_TYPES[kind] || kind;
const LAYOUT_PRESETS = {
  'section-full': { desktop: { mode: 'stack', direction: 'column', align: 'start', rowGap: '16px', padding: ['60px', '35px', '60px', '35px'], contentWidth: 'auto' }, mobile: { padding: ['40px', '20px', '40px', '20px'] } },
  'section-screen': { desktop: { mode: 'grid', columns: ['1fr'], align: 'center', padding: ['60px', '35px', '60px', '35px'], contentWidth: '1022px', minHeight: '100vh' }, mobile: { padding: ['40px', '20px', '40px', '20px'] } },
  'section-columns': { desktop: { mode: 'grid', columns: ['1fr', '1fr'], columnGap: '40px', rowGap: '24px', align: 'center', padding: ['60px', '35px', '60px', '35px'], contentWidth: '1022px' }, mobile: { columns: ['1fr'], padding: ['40px', '20px', '40px', '20px'] } },
  grid: { desktop: { mode: 'grid', columns: ['1fr', '1fr'], columnGap: '20px', rowGap: '20px', padding: ['16px', '16px', '16px', '16px'], minHeight: '160px' }, mobile: { columns: ['1fr'] } },
  'grid-3': { desktop: { mode: 'grid', columns: ['1fr', '1fr', '1fr'], columnGap: '20px', rowGap: '20px', padding: ['16px', '16px', '16px', '16px'], minHeight: '160px' }, tablet: { columns: ['1fr', '1fr'] }, mobile: { columns: ['1fr'] } },
  stack: { desktop: { mode: 'stack', direction: 'column', align: 'start', rowGap: '12px', padding: ['16px', '16px', '16px', '16px'] } },
  'stack-row': { desktop: { mode: 'stack', direction: 'row', align: 'center', wrap: true, columnGap: '16px', rowGap: '12px', padding: ['16px', '16px', '16px', '16px'] } }
};
function buttonNode(type, kind) {
  const base = { background: { kind: 'color', color: '@accent' }, color: '#ffffff', padding: ['12px', '20px', '12px', '20px'], radius: ['8px', '8px', '8px', '8px'], fontWeight: 700 };
  if (kind === 'button-outline') return { type, props: { label: 'Learn more' }, style: { desktop: { ...base, background: { kind: 'color', color: 'transparent' }, color: '@accent', border: { width: '2px', style: 'solid', color: '@accent', sides: ['top', 'right', 'bottom', 'left'] } } } };
  if (kind === 'button-icon') return { type, props: { label: 'Learn more', icon: 'arrow-right', iconPosition: 'end' }, style: { desktop: base } };
  if (kind === 'icon-button') return { type, props: { label: 'Next', icon: 'arrow-right', hideLabel: true }, style: { desktop: { ...base, padding: ['12px', '12px', '12px', '12px'], radius: ['999px', '999px', '999px', '999px'] } } };
  return { type, props: { label: 'Learn more' }, style: { desktop: base } };
}
export function createNode(doc, kind) {
  const type = KIND_TYPES[kind] || kind;
  const id = newId(doc, type === 'section' ? 'section' : type);
  const firstImage = doc.assets.find(asset => asset.kind === 'image')?.url || '';
  const full = { desktop: { width: '100%' } };
  const nodes = {
    section: { type, name: 'Section', children: [], layout: structuredClone(SECTION_LAYOUT) },
    container: { type, children: [], layout: { desktop: { mode: 'stack', direction: 'column', align: 'start', rowGap: '12px', padding: ['16px', '16px', '16px', '16px'] } }, place: full },
    text: kind === 'heading' || kind === 'title'
      ? { type, props: { doc: [{ t: kind === 'title' ? 'h1' : 'h2', c: [{ text: kind === 'title' ? 'Your title' : 'Your heading' }] }] }, place: full }
      : kind === 'text-list'
        ? { type, props: { doc: [{ t: 'ul', items: [[{ text: 'First point' }], [{ text: 'Second point' }], [{ text: 'Third point' }]] }] }, place: { desktop: { width: '100%', maxWidth: '700px' } } }
        : { type, props: { doc: [{ t: 'p', c: [{ text: 'Write something your visitors should know.' }] }] }, place: { desktop: { width: '100%', maxWidth: '700px' } } },
    button: buttonNode(type, kind),
    icon: { type, props: { icon: 'star' }, place: { desktop: { width: '40px', height: '40px' } }, style: { desktop: { color: '@accent' } } },
    image: { type, props: { src: firstImage, alt: '', fit: 'cover' }, place: { desktop: { width: '100%', height: '280px' } } },
    video: { type, props: { title: 'Video' }, place: full },
    gallery: kind === 'slideshow' ? { type, props: { layout: 'slider', autoplay: true, interval: 5, lightbox: true }, place: full } : kind === 'gallery-masonry' ? { type, props: { layout: 'masonry', minItemWidth: '220px', lightbox: true }, place: full } : { type, props: {}, place: full },
    audio: { type, props: { title: 'Listen' }, place: { desktop: { width: '100%', maxWidth: '520px' } } },
    shape: { type, props: { shape: kind === 'shape-ellipse' ? 'ellipse' : kind === 'shape-blob' ? 'blob' : 'rect' }, place: { desktop: { width: '120px', height: '120px' } }, style: { desktop: { background: { kind: 'color', color: '@accent' } } } },
    divider: kind === 'line-vertical' ? { type, props: { orientation: 'vertical' }, place: { desktop: { height: '120px' } }, style: { desktop: { color: '@line' } } } : { type, place: full, style: { desktop: { color: '@line' } } },
    spacer: { type, place: { desktop: { height: '40px' } } },
    menu: { type, props: { orientation: 'horizontal', activeColor: '@accent' } },
    form: { type, props: {}, place: { desktop: { width: '100%', maxWidth: '650px' } } }
  };
  const node = { id, ...nodes[type] };
  if (LAYOUT_PRESETS[kind]) {
    // Presets only define breakpoints that exist on this site.
    const ids = new Set(['desktop', ...doc.breakpoints.map(bp => bp.id)]);
    node.layout = Object.fromEntries(Object.entries(structuredClone(LAYOUT_PRESETS[kind])).filter(([bp]) => ids.has(bp)));
    node.name = ADDABLE.find(([item]) => item === kind)[1];
    if (type === 'container') node.style = { desktop: { border: { width: '1px', style: 'dashed', color: '@line' } } };
  }
  return { id, node };
}
// Where a new element goes: inside the selected container, after the selected element, or into the last section.
export function insertionTarget(doc, index, page, selectedId, type) {
  const pageIndex = doc.pages.indexOf(page);
  const selected = selectedId && index.has(selectedId) ? selectedId : null;
  if (isRoot(type)) {
    const root = selected ? ancestors(index, selected)[0] : null;
    const position = root && index.get(root).list === 'page' ? page.children.indexOf(root) + 1 : page.children.length;
    return { parent: null, page: pageIndex, position };
  }
  if (selected && isContainer(doc.nodes[selected].type)) return { parent: selected, page: pageIndex, position: doc.nodes[selected].children.length };
  if (selected) {
    const parent = index.get(selected).parent;
    return { parent, page: pageIndex, position: doc.nodes[parent].children.indexOf(selected) + 1 };
  }
  const last = page.children[page.children.length - 1];
  return last ? { parent: last, page: pageIndex, position: doc.nodes[last].children.length } : null;
}
// Merged per-breakpoint values in effect at `bp` (desktop first, then each smaller breakpoint).
export function effective(map, bpIds, bp) {
  const result = {};
  for (const id of bpIds.slice(0, bpIds.indexOf(bp) + 1)) if (map?.[id]) Object.assign(result, map[id]);
  return result;
}
