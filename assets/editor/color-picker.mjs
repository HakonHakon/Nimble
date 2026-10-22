// Colour picker popover shared by the inspector and the Site panel. Any `.color-field` holds a
// swatch button and a text input (`[data-part=value]`); picking writes the input and fires `change`,
// so the field's owner commits it exactly like a typed value.
import { escapeHtml as esc } from '/assets/render-v2.mjs';

const RECENT_KEY = 'nimble.recentColors';
const HEX = /^#([0-9a-f]{6})([0-9a-f]{2})?$/i;

export function resolveColor(colors, value) {
  if (typeof value !== 'string' || !value) return '';
  if (value === 'transparent') return '#00000000';
  const resolved = value.startsWith('@') ? colors[value.slice(1)] || '' : value;
  if (/^#[0-9a-f]{3,4}$/i.test(resolved)) return '#' + [...resolved.slice(1)].map(c => c + c).join('');
  return resolved;
}
// Swatch button + text input. `attrs` go on the text input (e.g. data-stop="0").
export function colorField(colors, value, placeholder, attrs = '') {
  const shown = resolveColor(colors, value || placeholder);
  return '<span class="color-field"><button type="button" class="swatch-btn' + (value ? '' : ' inherited') + '" data-picker aria-label="Choose colour" style="--swatch:' + esc(shown || 'transparent') + '"></button>'
    + '<input data-part="value" list="paletteColors" value="' + esc(value || '') + '" placeholder="' + esc(placeholder || '') + '" spellcheck="false"' + attrs + '></span>';
}
export function recentColors() {
  try { const list = JSON.parse(localStorage.getItem(RECENT_KEY) || '[]'); return Array.isArray(list) ? list.filter(item => typeof item === 'string').slice(0, 10) : []; } catch { return []; }
}
function remember(value) {
  try { localStorage.setItem(RECENT_KEY, JSON.stringify([value, ...recentColors().filter(item => item !== value)].slice(0, 10))); } catch { /* storage unavailable */ }
}

export function createColorPicker({ colors }) {
  let popover = null, input = null;
  const close = () => { popover?.remove(); popover = null; input = null; document.removeEventListener('pointerdown', outside, true); window.removeEventListener('keydown', escape, true); };
  // Escape closes the picker before the editor sees it (where it would select the parent element).
  const escape = event => { if (event.key === 'Escape') { event.stopPropagation(); event.preventDefault(); const back = input; close(); back?.focus(); } };
  const outside = event => { if (popover && !popover.contains(event.target) && !event.target.closest('[data-picker]')) close(); };
  // Picking commits and closes: the owner re-renders, which replaces the input element.
  function set(value) {
    if (!input) return;
    input.value = value;
    const swatch = input.closest('.color-field')?.querySelector('[data-picker]');
    if (swatch) { swatch.style.setProperty('--swatch', resolveColor(colors(), value) || 'transparent'); swatch.classList.remove('inherited'); }
    input.dispatchEvent(new Event('change', { bubbles: true }));
    if (value !== 'transparent') remember(value);
    close();
  }
  function sync(value) {
    if (!popover) return;
    const hex = resolveColor(colors(), value);
    const match = hex.match(HEX);
    popover.querySelector('[data-cp=hex]').value = value || '';
    if (match) {
      popover.querySelector('[data-cp=native]').value = '#' + match[1];
      popover.querySelector('[data-cp=alpha]').value = Math.round((match[2] ? parseInt(match[2], 16) : 255) / 2.55);
    }
    popover.querySelectorAll('[data-pick]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.pick === value)));
  }
  function open(target) {
    if (input === target) return close();
    close();
    input = target;
    const palette = colors();
    const chip = (value, title) => '<button type="button" class="cp-chip" data-pick="' + esc(value) + '" title="' + esc(title) + '" style="--swatch:' + esc(resolveColor(palette, value) || 'transparent') + '"></button>';
    popover = document.createElement('div');
    popover.className = 'color-popover';
    popover.setAttribute('role', 'dialog');
    popover.setAttribute('aria-label', 'Colour');
    popover.innerHTML = '<p class="cp-title">Theme colours</p><div class="cp-chips">' + Object.keys(palette).map(key => chip('@' + key, key)).join('') + chip('transparent', 'Transparent') + '</div>'
      + (recentColors().length ? '<p class="cp-title">Recent</p><div class="cp-chips cp-recent">' + recentColors().map(value => chip(value, value)).join('') + '</div>' : '')
      + '<p class="cp-title">Custom</p><div class="cp-custom"><input type="color" data-cp="native" aria-label="Colour"><input data-cp="hex" aria-label="Hex or @theme colour" spellcheck="false">'
      + (window.EyeDropper ? '<button type="button" class="btn btn-small" data-cp="eyedropper" title="Pick a colour from the screen">Eyedropper</button>' : '') + '</div>'
      + '<label class="cp-alpha">Opacity <input type="range" data-cp="alpha" min="0" max="100" value="100"></label>';
    document.body.append(popover);
    const r = target.closest('.color-field').getBoundingClientRect(), p = popover.getBoundingClientRect();
    popover.style.left = Math.max(8, Math.min(r.left, innerWidth - p.width - 8)) + 'px';
    popover.style.top = (r.bottom + p.height + 8 > innerHeight ? Math.max(8, r.top - p.height - 4) : r.bottom + 4) + 'px';
    sync(target.value || target.placeholder);
    const custom = () => {
      const base = popover.querySelector('[data-cp=native]').value.toLowerCase();
      const alpha = Number(popover.querySelector('[data-cp=alpha]').value);
      return alpha >= 100 ? base : base + Math.round(alpha * 2.55).toString(16).padStart(2, '0');
    };
    popover.addEventListener('click', async event => {
      const pick = event.target.closest('[data-pick]');
      if (pick) return set(pick.dataset.pick);
      if (event.target.closest('[data-cp=eyedropper]')) {
        try { const result = await new window.EyeDropper().open(); set(result.sRGBHex.toLowerCase()); } catch { /* cancelled */ }
      }
    });
    popover.addEventListener('input', event => {
      if (event.target.dataset.cp === 'native' || event.target.dataset.cp === 'alpha') { popover.querySelector('[data-cp=hex]').value = custom(); }
    });
    popover.addEventListener('change', event => {
      event.stopPropagation();
      const cp = event.target.dataset.cp;
      if (cp === 'native' || cp === 'alpha') set(custom());
      if (cp === 'hex') { const value = event.target.value.trim().toLowerCase(); if (value) set(value); }
    });
    popover.addEventListener('keydown', event => {
      if (event.key === 'Enter' && event.target.dataset.cp === 'hex') event.target.blur();
    });
    window.addEventListener('keydown', escape, true);
    (popover.querySelector('[data-pick][aria-pressed=true]') || popover.querySelector('[data-cp=hex]')).focus();
    setTimeout(() => document.addEventListener('pointerdown', outside, true));
  }
  // Delegated: one listener per root handles every swatch button inside it.
  function attach(root) {
    root.addEventListener('click', event => {
      const button = event.target.closest('[data-picker]');
      if (!button || button.disabled) return;
      event.preventDefault();
      open(button.closest('.color-field').querySelector('[data-part=value]'));
    });
  }
  return { attach, close, get isOpen() { return !!popover; } };
}
