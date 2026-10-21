// Tree helpers for the v2 editor: parent lookup, labels, defaults, and move rules.
import { spec } from '/assets/site-model-v2.mjs';

export const TYPES = {
  section: { label: 'Section', icon: '▭' }, container: { label: 'Container', icon: '▢' }, text: { label: 'Text', icon: 'T' },
  image: { label: 'Image', icon: '▨' }, button: { label: 'Button', icon: '⬭' }, video: { label: 'Video', icon: '▶' },
  gallery: { label: 'Gallery', icon: '▦' }, form: { label: 'Contact form', icon: '✉' }, shape: { label: 'Shape', icon: '◆' },
  spacer: { label: 'Spacer', icon: '↕' }, divider: { label: 'Line', icon: '―' }, menu: { label: 'Menu', icon: '☰' }
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
export const ADDABLE = [
  ['section', 'Section'], ['container', 'Container'], ['heading', 'Heading'], ['text', 'Paragraph'], ['button', 'Button'],
  ['image', 'Image'], ['video', 'Video'], ['gallery', 'Gallery'], ['shape', 'Shape'], ['divider', 'Line'], ['spacer', 'Spacer'],
  ['menu', 'Menu'], ['form', 'Contact form']
];
export function createNode(doc, kind) {
  const type = kind === 'heading' ? 'text' : kind;
  const id = newId(doc, type === 'section' ? 'section' : type);
  const firstImage = doc.assets.find(asset => asset.kind === 'image')?.url || '';
  const full = { desktop: { width: '100%' } };
  const nodes = {
    section: { type, name: 'Section', children: [], layout: structuredClone(SECTION_LAYOUT) },
    container: { type, children: [], layout: { desktop: { mode: 'stack', direction: 'column', align: 'start', rowGap: '12px', padding: ['16px', '16px', '16px', '16px'] } }, place: full },
    text: kind === 'heading'
      ? { type, props: { doc: [{ t: 'h2', c: [{ text: 'Your heading' }] }] }, place: full }
      : { type, props: { doc: [{ t: 'p', c: [{ text: 'Write something your visitors should know.' }] }] }, place: { desktop: { width: '100%', maxWidth: '700px' } } },
    button: { type, props: { label: 'Learn more' }, style: { desktop: { background: { kind: 'color', color: '@accent' }, color: '#ffffff', padding: ['12px', '20px', '12px', '20px'], radius: ['8px', '8px', '8px', '8px'], fontWeight: 700 } } },
    image: { type, props: { src: firstImage, alt: '', fit: 'cover' }, place: { desktop: { width: '100%', height: '280px' } } },
    video: { type, props: { title: 'Video' }, place: full },
    gallery: { type, props: {}, place: full },
    shape: { type, props: { shape: 'rect' }, place: { desktop: { width: '120px', height: '120px' } }, style: { desktop: { background: { kind: 'color', color: '@accent' } } } },
    divider: { type, place: full, style: { desktop: { color: '@line' } } },
    spacer: { type, place: { desktop: { height: '40px' } } },
    menu: { type, props: { orientation: 'horizontal', activeColor: '@accent' } },
    form: { type, props: {}, place: { desktop: { width: '100%', maxWidth: '650px' } } }
  };
  return { id, node: { id, ...nodes[type] } };
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
