// Converts a v1 block document into a v2 element tree that reproduces the v1 look.
// Runs wherever a v1 document is opened by the v2 editor; the result is normalized by normalizeSiteV2.
import { normalizeSiteV2 } from './site-model-v2.mjs';

const THEMES = { purple: '#6957ff', orange: '#df754e', mint: '#3b9c7a', dark: '#4c4a92', lemon: '#b38f19' };
const PADDING = ['70px', '35px', '70px', '35px'], MOBILE_PADDING = ['40px', '20px', '40px', '20px'];
const CONTENT_WIDTH = '1022px', SITE_WIDTH = '1092px';
const DEFAULT_CARDS = [['One', 'A simple column.'], ['Two', 'Another useful point.'], ['Three', 'One more thing.']];

export function migrateV1(v1) {
  if (v1?.version === 2) return normalizeSiteV2(v1);
  const nodes = {}, used = new Set(Object.keys(v1.blocks || {}));
  const radius = v1.site.rounded === false ? '0px' : '14px';
  const corners = [radius, radius, radius, radius];
  const unique = (base, suffix) => {
    const stem = base.slice(0, 60) + '__' + suffix;
    let id = stem, count = 1;
    while (used.has(id)) id = stem + (++count);
    used.add(id);
    return id;
  };
  const add = (id, node) => { nodes[id] = { type: node.type, ...node }; return id; };
  const toLink = value => {
    if (!value) return undefined;
    const page = v1.pages.find(item => item.path === value || item.id === value);
    if (page) return { to: 'page', page: page.id };
    if (value.startsWith('#')) return { to: 'anchor', node: value.slice(1) };
    if (/^mailto:/i.test(value)) return { to: 'email', address: value.slice(7) };
    if (/^tel:/i.test(value)) return { to: 'phone', number: value.slice(4) };
    return { to: value.startsWith('/uploads/') ? 'asset' : 'url', href: value };
  };
  const textNode = (base, suffix, block, extra = {}) => add(unique(base, suffix), { type: 'text', props: { doc: [block] }, place: { desktop: { width: '100%' } }, ...extra });
  const heading = (base, title, tag = 'h2') => title ? [textNode(base, 'title', { t: tag, c: [{ text: title }] })] : [];
  const paragraph = (base, value) => value ? [textNode(base, 'text', { t: 'p', c: [{ text: value }] }, { place: { desktop: { width: '100%', maxWidth: '700px' } } })] : [];
  const button = (base, label, link, cell) => add(unique(base, 'button'), {
    type: 'button', props: { label: label + ' ↗', link: toLink(link || '#contact') },
    ...(cell ? { place: cell } : {}),
    style: { desktop: { background: { kind: 'color', color: '@accent' }, color: '#ffffff', padding: ['13px', '20px', '13px', '20px'], radius: corners, fontWeight: 700 } }
  });
  const stack = (extra = {}) => ({ desktop: { mode: 'stack', direction: 'column', align: 'start', rowGap: '16px', padding: PADDING, contentWidth: CONTENT_WIDTH, ...extra }, mobile: { padding: MOBILE_PADDING } });
  const fill = (block, fallback) => block.bg ? { kind: 'color', color: block.bg } : fallback;
  const section = (block, children, layout, background) => add(block.id, { type: 'section', name: block.type[0].toUpperCase() + block.type.slice(1), children, layout, ...(background ? { style: { desktop: { background } } } : {}) });
  const copyColumn = (base, children, place, gap = '16px') => add(unique(base, 'copy'), { type: 'container', children, layout: { desktop: { mode: 'stack', direction: 'column', align: 'start', rowGap: gap } }, place });

  const convert = block => {
    const id = block.id;
    if (block.type === 'hero') {
      const eyebrow = block.eyebrow ? [textNode(id, 'eyebrow', { t: 'p', style: 'p3', c: [{ text: block.eyebrow }] }, { style: { desktop: { color: '@accent', letterSpacing: '0.12em', fontWeight: 800 } } })] : [];
      const copy = copyColumn(id, [...eyebrow, ...heading(id, block.title, 'h1'), ...paragraph(id, block.text), button(id, block.button || 'Learn more', block.buttonLink)], { desktop: { cell: [1, 1, 1, 1] } }, '24px');
      const art = add(unique(id, 'art'), { type: 'shape', props: { shape: 'blob' }, place: { desktop: { cell: [1, 2, 1, 1], justifySelf: 'center', width: '220px', height: '220px' }, mobile: { cell: [2, 1, 1, 1], width: '150px', height: '150px' } }, style: { desktop: { background: { kind: 'gradient', type: 'linear', angle: 145, stops: [{ color: '#a0f1de', at: 0 }, { color: '@accent', at: 100 }] } } } });
      // v1 painted the hero gradient over any block background colour, so the gradient is what visitors saw.
      return section(block, [copy, art], { desktop: { mode: 'grid', columns: ['1.2fr', '0.8fr'], columnGap: '30px', rowGap: '30px', align: 'center', padding: PADDING, contentWidth: CONTENT_WIDTH }, mobile: { columns: ['1fr'], padding: MOBILE_PADDING } },
        { kind: 'gradient', type: 'linear', angle: 125, stops: [{ color: '#fffaf1', at: 0 }, { color: '#f3edff', at: 100 }] });
    }
    if (block.type === 'services' || block.type === 'columns') {
      const cards = (block.cards || (block.type === 'columns' ? DEFAULT_CARDS : [])).map((card, index) => add(unique(id, 'card' + (index + 1)), {
        type: 'container', tag: 'article',
        children: [...(card[0] ? [textNode(id + '__card' + (index + 1), 'title', { t: 'h3', c: [{ text: card[0] }] })] : []), ...paragraph(id + '__card' + (index + 1), card[1])],
        layout: { desktop: { mode: 'stack', direction: 'column', align: 'start', rowGap: '8px', padding: ['24px', '24px', '24px', '24px'] } },
        style: { desktop: { border: { width: '1px', style: 'solid', color: '@line' }, radius: corners } }
      }));
      const grid = add(unique(id, 'cards'), { type: 'container', children: cards, layout: { desktop: { mode: 'grid', columns: ['repeat(auto-fit,minmax(200px,1fr))'], columnGap: '20px', rowGap: '20px' } }, place: { desktop: { width: '100%', margin: ['12px', '0px', '0px', '0px'] } } });
      return section(block, [...heading(id, block.title), ...paragraph(id, block.text), grid], stack(), fill(block));
    }
    if (block.type === 'split') {
      const image = add(unique(id, 'image'), { type: 'image', props: { src: block.image || '', alt: block.alt || '', fit: 'cover' }, place: { desktop: { cell: [1, 1, 1, 1], width: '100%', minHeight: '280px' } }, style: { desktop: { radius: corners } } });
      const copy = copyColumn(id, [...heading(id, block.title), ...paragraph(id, block.text), button(id, block.button || 'Learn more', block.buttonLink)], { desktop: { cell: [1, 2, 1, 1] }, mobile: { cell: [2, 1, 1, 1] } });
      return section(block, [image, copy], { desktop: { mode: 'grid', columns: ['1fr', '1fr'], columnGap: '40px', rowGap: '40px', align: 'center', padding: PADDING, contentWidth: CONTENT_WIDTH }, mobile: { columns: ['1fr'], padding: MOBILE_PADDING } }, fill(block));
    }
    if (block.type === 'video') {
      const video = add(unique(id, 'video'), { type: 'video', props: { src: block.videoUrl || '', poster: block.image || '', title: block.title || 'Video' }, place: { desktop: { width: '100%' } }, style: { desktop: { radius: corners } } });
      return section(block, [...heading(id, block.title), ...paragraph(id, block.text), video], stack(), fill(block));
    }
    if (block.type === 'cta') {
      const copy = copyColumn(id, [...heading(id, block.title), ...paragraph(id, block.text)]);
      return section(block, [copy, button(id, block.button || 'Learn more', block.buttonLink)], { desktop: { mode: 'stack', direction: 'row', justify: 'space-between', align: 'center', columnGap: '30px', rowGap: '16px', padding: PADDING, contentWidth: CONTENT_WIDTH }, mobile: { direction: 'column', align: 'start', padding: MOBILE_PADDING } }, fill(block, { kind: 'color', color: '#d9f6ed' }));
    }
    if (block.type === 'text') return section(block, [...heading(id, block.title), ...paragraph(id, block.text)], stack(), fill(block));
    if (block.type === 'image') return section(block, [add(unique(id, 'image'), { type: 'image', props: { src: block.image || '', alt: block.alt || '', fit: 'cover' }, place: { desktop: { width: '100%' } }, style: { desktop: { radius: corners } } })], stack(), fill(block));
    if (block.type === 'button') return section(block, [button(id, block.label || 'Learn more', block.buttonLink)], stack(), fill(block));
    if (block.type === 'gallery') return section(block, [add(unique(id, 'gallery'), { type: 'gallery', props: { ...(block.images ? { images: block.images } : {}), alt: block.alt || '' }, place: { desktop: { width: '100%' } }, style: { desktop: { radius: corners } } })], stack(), fill(block));
    if (block.type === 'quote') {
      const quote = textNode(id, 'quote', { t: 'p', c: [{ text: block.text || '' }] }, { place: { desktop: { width: '100%', maxWidth: '700px' } }, style: { desktop: { fontSize: '28px', textAlign: 'center' }, mobile: { fontSize: '22px' } } });
      const author = textNode(id, 'author', { t: 'p', c: [{ text: block.author || 'A happy client', i: true }] }, { style: { desktop: { textAlign: 'center' } } });
      return section(block, [quote, author], stack({ align: 'center' }), fill(block, { kind: 'color', color: '#f8f5ff' }));
    }
    const form = add(unique(id, 'form'), { type: 'form', props: {}, place: { desktop: { width: '100%', maxWidth: '650px' } } });
    return section(block, [...heading(id, block.title), ...paragraph(id, block.text), form], stack(), fill(block));
  };

  const pages = v1.pages.map(page => ({ id: page.id, name: page.name, path: page.path, children: page.blocks.map(blockId => convert({ ...v1.blocks[blockId], id: blockId })) }));
  const header = add(unique('site', 'header'), {
    type: 'section', name: 'Header', tag: 'header',
    children: [
      textNode('site', 'logo', { t: 'p', c: [{ text: '', token: 'siteName', link: { to: 'page', page: 'home' } }] }, { place: undefined, style: { desktop: { fontSize: '24px', fontWeight: 850, letterSpacing: '-0.06em', color: '@ink', linkUnderline: false } } }),
      add(unique('site', 'menu'), { type: 'menu', props: { orientation: 'horizontal', activeColor: '@accent' }, style: { desktop: { fontSize: '14px', color: '@ink' } } })
    ],
    layout: { desktop: { mode: 'stack', direction: 'row', justify: 'space-between', align: 'center', columnGap: '20px', rowGap: '12px', padding: ['0px', '24px', '0px', '24px'], minHeight: '86px', contentWidth: SITE_WIDTH }, mobile: { direction: 'column', align: 'start', padding: ['20px', '18px', '20px', '18px'] } },
    style: { desktop: { border: { width: '1px', style: 'solid', color: '@line', sides: ['bottom'] } } }
  });
  const footer = add(unique('site', 'footer'), {
    type: 'section', name: 'Footer', tag: 'footer',
    children: [textNode('site', 'copyright', { t: 'p', c: [{ text: '© ' }, { text: '', token: 'year' }, { text: ' ' }, { text: '', token: 'siteName' }] }, { style: { desktop: { color: '#77768a', fontSize: '13px' } } })],
    layout: { desktop: { mode: 'stack', direction: 'column', padding: ['40px', '24px', '40px', '24px'], contentWidth: SITE_WIDTH } },
    style: { desktop: { border: { width: '1px', style: 'solid', color: '@line', sides: ['top'] } } }
  });
  for (const node of Object.values(nodes)) if (node.place === undefined) delete node.place;
  return normalizeSiteV2({
    version: 2,
    site: { name: v1.site.name, domain: v1.site.domain || '', description: v1.site.description || '', lang: 'en', searchVisible: v1.site.searchVisible !== false, socialImage: v1.site.socialImage || '' },
    design: {
      colors: { bg: '#ffffff', ink: '#19192c', muted: '#5f5e71', line: '#e9e8ef', accent: THEMES[v1.theme] || THEMES.purple, soft: '#f8f5ff' },
      fonts: [{ id: 'heading', source: 'system', family: v1.site.headingFont || 'sans' }, { id: 'body', source: 'system', family: v1.site.bodyFont || 'sans' }]
    },
    assets: v1.assets || [],
    header, footer, pages, nodes
  });
}
