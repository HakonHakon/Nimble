import { pageHtmlV2 } from './render-v2.mjs';
import { escapeHtml as e, safeUrl, videoSource, pageLink, themes, fonts } from './site-model.mjs';
const image = value => e(safeUrl(value) || '');
const button = (site, block) => '<a class="button" href="' + e(pageLink(site, block.buttonLink || '#contact')) + '">' + e(block.button || block.label || 'Learn more') + ' ↗</a>';
export function renderBlock(site, block) {
  if (!block) return '';
  let body = '';
  const heading = '<h2>' + e(block.title || '') + '</h2>';
  const paragraph = '<p>' + e(block.text || '').replace(/\n/g, '<br>') + '</p>';
  if (block.type === 'hero') body = '<div><span class="eyebrow">' + e(block.eyebrow) + '</span><h1>' + e(block.title) + '</h1>' + paragraph + button(site, block) + '</div><div class="hero-art" aria-hidden="true"></div>';
  if (['services', 'columns'].includes(block.type)) {
    const cards = block.cards || (block.type === 'columns' ? [['One', 'A simple column.'], ['Two', 'Another useful point.'], ['Three', 'One more thing.']] : []);
    body = heading + paragraph + '<div class="cards">' + cards.map(card => '<article><h3>' + e(card[0]) + '</h3><p>' + e(card[1]) + '</p></article>').join('') + '</div>';
  }
  if (block.type === 'split') body = '<img loading="lazy" src="' + image(block.image) + '" alt="' + e(block.alt || '') + '"><div>' + heading + paragraph + button(site, block) + '</div>';
  if (block.type === 'video') {
    const video = videoSource(block.videoUrl);
    body = heading + paragraph;
    if (video?.kind === 'file') body += '<video controls preload="metadata"' + (block.image ? ' poster="' + image(block.image) + '"' : '') + ' src="' + e(video.url) + '">Your browser does not support this video.</video>';
    else if (video) body += '<iframe loading="lazy" src="' + e(video.url) + '" title="' + e(block.title || 'Video') + '" allow="fullscreen; picture-in-picture; encrypted-media" referrerpolicy="strict-origin-when-cross-origin" allowfullscreen></iframe>';
    else body += '<p class="muted">Video coming soon.</p>';
  }
  if (block.type === 'cta') body = '<div>' + heading + paragraph + '</div>' + button(site, block);
  if (block.type === 'text') body = heading + paragraph;
  if (block.type === 'image') body = '<img loading="lazy" src="' + image(block.image) + '" alt="' + e(block.alt || '') + '">';
  if (block.type === 'button') body = button(site, block);
  if (block.type === 'gallery') body = (block.images || site.assets.filter(asset => asset.kind === 'image').slice(0, 6).map(asset => asset.url)).map(url => '<img loading="lazy" src="' + image(url) + '" alt="' + e(block.alt || '') + '">').join('');
  if (block.type === 'quote') body = '<blockquote>' + paragraph + '<cite>' + e(block.author || 'A happy client') + '</cite></blockquote>';
  if (block.type === 'form') body = heading + paragraph + '<form action="/api/contact" method="post" data-contact-form data-block="' + e(block.id) + '"><label>Your name<input name="name" autocomplete="name" maxlength="120" required></label><label>Email address<input name="email" type="email" autocomplete="email" maxlength="254" required></label><label>Your message<textarea name="message" maxlength="5000" required></textarea></label><div class="honeypot" aria-hidden="true"><label>Leave blank<input name="website" tabindex="-1" autocomplete="off"></label></div><input type="hidden" name="token"><button class="button" type="submit">Send message ↗</button><p role="status" class="form-status" aria-live="polite"></p><small>We use these details only to respond to your enquiry.</small></form>';
  return '<section id="' + e(block.id) + '" class="block ' + e(block.type) + '"' + (block.bg ? ' style="background-color:' + e(block.bg) + '"' : '') + '>' + body + '</section>';
}
export function pageHtml(site, page, options = {}) {
  if (site.version === 2) return pageHtmlV2(site, page, options);
  const style = ':root{--accent:' + themes[site.theme] + ';--radius:' + (site.site.rounded ? '14px' : '0') + ';font-family:' + fonts[site.site.bodyFont || 'sans'] + '}h1,h2,h3{font-family:' + fonts[site.site.headingFont || 'sans'] + '}';
  const nav = '<nav aria-label="Main navigation"><a class="logo" href="./">' + e(site.site.name) + '</a><div class="links">' + site.pages.map(item => '<a' + (item.id === page.id ? ' aria-current="page"' : '') + ' href="' + e(pageLink(site, item.id)) + '">' + e(item.name) + '</a>').join('') + '</div></nav>';
  return '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>' + e(page.name) + ' — ' + e(site.site.name) + '</title><meta name="description" content="' + e(site.site.description) + '"><meta name="robots" content="' + (site.site.searchVisible ? 'index,follow' : 'noindex,nofollow') + '"><meta property="og:title" content="' + e(site.site.name) + '"><meta property="og:description" content="' + e(site.site.description) + '">' + (site.site.socialImage ? '<meta property="og:image" content="' + image(site.site.socialImage) + '">' : '') + '<link rel="stylesheet" href="/assets/public.css"><style>' + style + '</style><script defer src="/assets/public.js"></script></head><body><a class="skip" href="#content">Skip to content</a><div class="wrap">' + nav + '<main id="content">' + page.blocks.map(id => renderBlock(site, site.blocks[id])).join('') + '</main><footer>© ' + new Date().getFullYear() + ' ' + e(site.site.name) + '</footer></div></body></html>';
}
