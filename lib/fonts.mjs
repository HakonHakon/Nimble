// Self-hosted Google Fonts: the server downloads the WOFF2 files once and serves them from /uploads,
// so visitors never contact Google. Ported 1:1 in php-backend/lib/fonts.php.
export const FAMILY = /^[A-Za-z0-9 ]{1,60}$/;
export const GOOGLE_FONTS = [
  'Inter', 'Roboto', 'Open Sans', 'Lato', 'Montserrat', 'Poppins', 'Raleway', 'Nunito', 'Work Sans', 'DM Sans', 'Manrope', 'Rubik',
  'Source Sans 3', 'Noto Sans', 'IBM Plex Sans', 'Outfit', 'Karla', 'Mulish', 'Barlow', 'Space Grotesk', 'Archivo', 'Figtree',
  'Playfair Display', 'Merriweather', 'Lora', 'Libre Baskerville', 'EB Garamond', 'Cormorant Garamond', 'DM Serif Display', 'Fraunces',
  'Crimson Pro', 'Source Serif 4', 'Bebas Neue', 'Oswald', 'Anton', 'Abril Fatface', 'Archivo Black', 'Pacifico', 'Caveat', 'Dancing Script',
  'JetBrains Mono', 'IBM Plex Mono', 'Space Mono'
];

// Normalized request: family, weights (100–900 in steps of 100, at most 6) and italics.
export function fontRequest(input) {
  const family = typeof input?.family === 'string' ? input.family.trim().replace(/\s+/g, ' ') : '';
  if (!FAMILY.test(family)) return { error: 'Enter a font family name using letters, numbers and spaces.' };
  const weights = [...new Set(Array.isArray(input.weights) && input.weights.length ? input.weights : [400, 700])].sort((a, b) => a - b);
  if (weights.length > 6 || weights.some(weight => !Number.isInteger(weight) || weight < 100 || weight > 900 || weight % 100)) return { error: 'Choose up to 6 weights between 100 and 900.' };
  return { family, weights, italic: input.italic === true };
}
export function cssUrl(base, request) {
  const axis = request.italic ? 'ital,wght@' + [0, 1].flatMap(italic => request.weights.map(weight => italic + ',' + weight)).join(';') : 'wght@' + request.weights.join(';');
  return base.replace(/\/+$/, '') + '/css2?family=' + request.family.replace(/ /g, '+') + ':' + axis + '&display=swap';
}
// Picks one WOFF2 file per weight and style, preferring the "latin" subset when the CSS names subsets.
export function parseFontCss(css) {
  const faces = [];
  const pattern = /(?:\/\*\s*([a-z0-9-]+)\s*\*\/\s*)?@font-face\s*\{([^}]*)\}/gi;
  let match;
  while ((match = pattern.exec(String(css)))) {
    const body = match[2];
    const url = body.match(/src:\s*url\(\s*['"]?([^'")\s]+)['"]?\s*\)\s*format\(\s*['"]woff2['"]\s*\)/i)?.[1];
    const weight = Number(body.match(/font-weight:\s*(\d{3})\s*;/i)?.[1] || 400);
    const style = /font-style:\s*italic/i.test(body) ? 'italic' : 'normal';
    if (url) faces.push({ subset: match[1] || '', weight, style, url });
  }
  const pick = new Map();
  for (const face of faces) {
    const key = face.weight + ':' + face.style, current = pick.get(key);
    if (!current || (face.subset === 'latin' && current.subset !== 'latin')) pick.set(key, face);
  }
  return [...pick.values()].sort((a, b) => a.weight - b.weight || a.style.localeCompare(b.style)).map(({ weight, style, url }) => ({ weight, style, url }));
}
// Font files may only come from the Google font host, or from the configured CSS host (tests, mirrors).
export function allowedFontUrl(url, base) {
  try {
    const target = new URL(url), origin = new URL(base);
    if (target.username || target.password) return false;
    if (target.protocol === 'https:' && target.hostname === 'fonts.gstatic.com') return true;
    return target.origin === origin.origin;
  } catch { return false; }
}
export const isWoff2 = bytes => bytes.length > 4 && bytes[0] === 0x77 && bytes[1] === 0x4f && bytes[2] === 0x46 && bytes[3] === 0x32;
