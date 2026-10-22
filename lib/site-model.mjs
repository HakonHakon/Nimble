import { normalizeSiteV2 } from './site-model-v2.mjs';
export { normalizeSiteV2, hasForm } from './site-model-v2.mjs';
export const blockTypes = ['hero', 'services', 'split', 'video', 'cta', 'text', 'image', 'button', 'gallery', 'columns', 'quote', 'form'];
export const themes = { purple: '#6957ff', orange: '#df754e', mint: '#3b9c7a', dark: '#4c4a92', lemon: '#b38f19' };
export const fonts = { sans: 'Inter, system-ui, sans-serif', serif: 'Georgia, serif', mono: 'ui-monospace, monospace' };
export const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
const object = value => value && typeof value === 'object' && !Array.isArray(value);
const identifier = /^[a-z][a-z0-9_-]{0,79}$/;
const fail = message => { throw Object.assign(new Error(message), { statusCode: 400 }); };
function text(value, fallback = '', limit = 10000) {
  if (value === undefined || value === null) return fallback;
  if (typeof value !== 'string' || value.length > limit) fail('Text fields must be strings of at most ' + limit + ' characters.');
  return value.replace(/\u0000/g, '');
}
export function safeUrl(value, { links = false, data = false } = {}) {
  if (typeof value !== 'string' || value.length > 3000 || /[\u0000-\u0020\u007f\\<>"']/.test(value)) return '';
  if (value.startsWith('/') && !value.startsWith('//')) return value;
  if (links && /^#[a-z0-9_-]*$/i.test(value)) return value;
  if (links && /^(mailto:[^\s@]+@[^\s@]+|tel:\+?[0-9()-]+)$/i.test(value)) return value;
  if (data && /^data:image\/(png|jpeg|webp|gif);base64,[a-z0-9+/=]+$/i.test(value)) return value;
  try {
    const url = new URL(value);
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) return '';
    return url.href;
  } catch { return ''; }
}
function urlField(value, links = false) {
  if (!value) return '';
  const result = safeUrl(text(value, '', 3000), { links });
  if (!result) fail('Use a valid HTTP(S) URL, local path, email link, or telephone link.');
  return result;
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
export function normalizeSite(input) {
  if (object(input) && input.version === 2) return normalizeSiteV2(input);
  if (!object(input) || !object(input.site) || !Array.isArray(input.pages) || !object(input.blocks)) fail('A site needs metadata, a page list, and a block map.');
  if (input.pages.length < 1 || input.pages.length > 100 || Object.keys(input.blocks).length > 2000) fail('Use 1–100 pages and no more than 2,000 blocks.');
  const settings = input.site;
  const name = text(settings.name, 'Nimble', 120).trim();
  if (!name) fail('Site name is required.');
  const domain = text(settings.domain, '', 253).trim();
  if (domain && !/^(localhost|[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?)(?::\d{1,5})?$/i.test(domain)) fail('Enter a hostname without a protocol or path.');
  const output = {
    version: 1,
    site: {
      name, domain, description: text(settings.description, '', 2000),
      searchVisible: settings.searchVisible !== false,
      socialImage: urlField(settings.socialImage),
      headingFont: Object.hasOwn(fonts, settings.headingFont) ? settings.headingFont : 'sans',
      bodyFont: Object.hasOwn(fonts, settings.bodyFont) ? settings.bodyFont : 'sans',
      rounded: settings.rounded !== false
    },
    theme: Object.hasOwn(themes, input.theme) ? input.theme : 'purple', assets: [], pages: [], blocks: {}
  };
  if (input.assets !== undefined && (!Array.isArray(input.assets) || input.assets.length > 500)) fail('Use no more than 500 media assets.');
  const assetIds = new Set();
  for (const asset of input.assets || []) {
    if (!object(asset) || !identifier.test(asset.id) || assetIds.has(asset.id) || !['image', 'video'].includes(asset.kind)) fail('Each media asset needs a unique valid ID and media type.');
    assetIds.add(asset.id);
    output.assets.push({ id: asset.id, name: text(asset.name, 'Media', 200), kind: asset.kind, url: urlField(asset.url) });
  }
  for (const [id, source] of Object.entries(input.blocks)) {
    if (!identifier.test(id) || !object(source) || !blockTypes.includes(source.type)) fail('A block has an invalid ID or type.');
    const block = { id, type: source.type };
    for (const field of ['title', 'eyebrow', 'text', 'button', 'label', 'alt', 'author']) {
      if (source[field] !== undefined) block[field] = text(source[field], '', field === 'text' ? 20000 : 1000);
    }
    for (const field of ['image', 'videoUrl']) if (source[field]) block[field] = urlField(source[field]);
    if (source.videoUrl && !videoSource(source.videoUrl)) fail('Videos must be MP4/WebM files or YouTube/Vimeo URLs.');
    if (source.buttonLink) block.buttonLink = urlField(source.buttonLink, true);
    if (source.bg) {
      if (!/^#[0-9a-f]{6}$/i.test(source.bg)) fail('Choose a valid background colour.');
      block.bg = source.bg;
    }
    if (source.cards !== undefined) {
      if (!Array.isArray(source.cards) || source.cards.length > 12 || source.cards.some(card => !Array.isArray(card) || card.length !== 2)) fail('Cards need a heading and description.');
      block.cards = source.cards.map(card => [text(card[0], '', 500), text(card[1], '', 3000)]);
    }
    if (source.images !== undefined) {
      if (!Array.isArray(source.images) || source.images.length > 24) fail('Use no more than 24 gallery images.');
      block.images = source.images.map(value => urlField(value));
    }
    output.blocks[id] = block;
  }
  const ids = new Set(), paths = new Set(), usedBlocks = new Set();
  for (const item of input.pages) {
    if (!object(item) || !/^[a-z][a-z0-9-]{0,63}$/.test(item.id) || ids.has(item.id)) fail('Pages need unique lowercase IDs.');
    ids.add(item.id);
    const pagePath = item.id === 'home' ? '/' : text(item.path, '/' + item.id, 200);
    if (!/^\/(?:[a-z0-9-]+(?:\/[a-z0-9-]+)*)?$/.test(pagePath) || paths.has(pagePath) || /^\/(?:api|assets|uploads|published|builder|control-panel|login)(?:\/|$)/.test(pagePath)) fail('Choose a unique page address outside reserved application paths.');
    paths.add(pagePath);
    if (!Array.isArray(item.blocks) || item.blocks.length > 200 || new Set(item.blocks).size !== item.blocks.length || item.blocks.some(id => !Object.hasOwn(output.blocks, id))) fail('Pages must reference existing blocks without duplicates.');
    const pageName = text(item.name, '', 120).trim();
    if (!pageName) fail('Every page needs a name.');
    const references = item.blocks.map(id => {
      if (!usedBlocks.has(id)) { usedBlocks.add(id); return id; }
      let independent = (item.id + '_' + id).slice(0, 76), suffix = 1;
      while (Object.hasOwn(output.blocks, independent)) independent = (item.id + '_' + id).slice(0, 72) + '_' + (++suffix);
      output.blocks[independent] = { ...structuredClone(output.blocks[id]), id: independent };
      usedBlocks.add(independent);
      return independent;
    });
    output.pages.push({ id: item.id, name: pageName, path: pagePath, blocks: references });
  }
  if (!ids.has('home')) fail('The site needs a home page.');
  output.blocks = Object.fromEntries([...usedBlocks].map(id => [id, output.blocks[id]]));
  return output;
}
export function pageLink(site, value) {
  const page = site.pages.find(item => item.id === value || item.path === value);
  return page ? (page.id === 'home' ? './' : './' + page.id + '.html') : safeUrl(value, { links: true }) || '#';
}
export function makeDefaultSite() {
  return normalizeSite({
    site: { name: 'Nimble', description: 'Build a clear, useful website with ease.' }, theme: 'purple', assets: [],
    pages: [{ id: 'home', name: 'Home', path: '/', blocks: ['hero', 'services', 'contact'] }],
    blocks: {
      hero: { type: 'hero', eyebrow: 'NIMBLE WEBSITE BUILDER', title: 'Make good things happen.', text: 'Start with a clear idea, shape it visually, and publish when it feels right.', button: 'Get in touch', buttonLink: '#contact' },
      services: { type: 'services', title: 'Built around you.', text: 'Design, craftsmanship, and advice.', cards: [['Design', 'Clear ideas, carefully developed.'], ['Build', 'Practical work, beautifully finished.'], ['Advice', 'A second pair of eyes for the important decisions.']] },
      contact: { type: 'form', title: 'Let’s talk', text: 'Tell us about your project.' }
    }
  });
}
