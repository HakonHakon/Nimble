// Right-click menu for the canvas and Layers. Items come from the arranger, so menu,
// shortcuts and the multi-selection inspector always agree on what is possible.
const MAC = /Mac|iPhone|iPad/.test(navigator.platform);
export const key = combo => combo.replace('Mod', MAC ? '⌘' : 'Ctrl').replace('Alt', MAC ? '⌥' : 'Alt').replace('Shift', MAC ? '⇧' : 'Shift').replaceAll('+', MAC ? '' : '+');

export const MENU = [
  [['copy', 'Copy', 'Mod+C'], ['cut', 'Cut', 'Mod+X'], ['paste', 'Paste', 'Mod+V'], ['duplicate', 'Duplicate', 'Mod+D']],
  [['copyStyle', 'Copy design', 'Mod+Alt+C'], ['pasteStyle', 'Paste design', 'Mod+Alt+V']],
  [['group', 'Group', 'Mod+G'], ['ungroup', 'Ungroup', 'Mod+Shift+G']],
  [['front', 'Bring to front', 'Mod+Shift+]'], ['forward', 'Bring forward', 'Mod+]'], ['backward', 'Send backward', 'Mod+['], ['back', 'Send to back', 'Mod+Shift+[']],
  [['alignLeft', 'Align left'], ['alignCenter', 'Align centre'], ['alignRight', 'Align right'], ['alignTop', 'Align top'], ['alignMiddle', 'Align middle'], ['alignBottom', 'Align bottom'], ['distributeX', 'Distribute horizontally'], ['distributeY', 'Distribute vertically']],
  [['lock', 'Lock / unlock', 'Mod+Shift+L'], ['hide', 'Hide / show here', 'Mod+Shift+H'], ['selectAll', 'Select all siblings', 'Mod+A']],
  [['delete', 'Delete', 'Del']]
];

export function createMenu(arranger) {
  let element = null;
  const close = () => { element?.remove(); element = null; document.removeEventListener('pointerdown', outside, true); };
  const outside = event => { if (!element?.contains(event.target)) close(); };
  function open(x, y) {
    close();
    element = document.createElement('div');
    element.className = 'context-menu';
    element.setAttribute('role', 'menu');
    element.innerHTML = MENU.map(group => group.filter(([action]) => !action.startsWith('align') && !action.startsWith('distribute') || arranger.available(action))
      .map(([action, text, combo]) => '<button role="menuitem" data-menu="' + action + '"' + (arranger.available(action) ? '' : ' disabled') + '><span>' + text + '</span>' + (combo ? '<kbd>' + key(combo) + '</kbd>' : '') + '</button>').join(''))
      .filter(Boolean).join('<hr>');
    document.body.append(element);
    const r = element.getBoundingClientRect();
    element.style.left = Math.min(x, innerWidth - r.width - 8) + 'px';
    element.style.top = Math.min(y, innerHeight - r.height - 8) + 'px';
    element.addEventListener('click', event => {
      const item = event.target.closest('[data-menu]');
      if (!item || item.disabled) return;
      close();
      arranger.run(item.dataset.menu);
    });
    element.addEventListener('keydown', event => {
      const items = [...element.querySelectorAll('button:not(:disabled)')], at = items.indexOf(document.activeElement);
      if (event.key === 'ArrowDown') { event.preventDefault(); items[(at + 1) % items.length]?.focus(); }
      if (event.key === 'ArrowUp') { event.preventDefault(); items[(at - 1 + items.length) % items.length]?.focus(); }
      if (event.key === 'Escape') { event.stopPropagation(); close(); }
    });
    element.querySelector('button:not(:disabled)')?.focus();
    setTimeout(() => document.addEventListener('pointerdown', outside, true));
  }
  return { open, close, get isOpen() { return !!element; } };
}

export function shortcutSheet() {
  const rows = [
    ['Mod+Z / Mod+Shift+Z', 'Undo / redo'], ['Mod+S', 'Save now'], ['Click, Shift+click', 'Select, add to selection'], ['Drag on empty space', 'Select with a rectangle'],
    ['Mod+A', 'Select all siblings'], ['Esc', 'Select parent / cancel drag'], ['Arrows, Shift+arrows', 'Nudge 1 px / 10 px'],
    ['Mod+C / Mod+X / Mod+V', 'Copy / cut / paste'], ['Mod+D', 'Duplicate'], ['Mod+Alt+C / Mod+Alt+V', 'Copy / paste design'],
    ['Mod+G / Mod+Shift+G', 'Group / ungroup'], ['Mod+] / Mod+[', 'Bring forward / send backward'], ['Mod+Shift+] / Mod+Shift+[', 'Bring to front / send to back'],
    ['Mod+Shift+L', 'Lock / unlock'], ['Mod+Shift+H', 'Hide / show on this breakpoint'], ['Delete', 'Delete'], ['Right-click', 'Context menu'], ['?', 'This list']
  ];
  return '<table class="shortcuts">' + rows.map(([combo, text]) => '<tr><td>' + combo.split(' / ').map(part => '<kbd>' + key(part) + '</kbd>').join(' / ') + '</td><td>' + text + '</td></tr>').join('') + '</table>';
}
