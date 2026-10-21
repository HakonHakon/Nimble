// Left-panel tools other than Layers: Add elements and Pages.
import { escapeHtml as esc } from '/assets/render-v2.mjs';
import { ADDABLE, TYPES, createNode, insertionTarget, newId, descendants } from './tree.mjs';

export function createAddPanel(root, ctx) {
  const groups = [];
  for (const [kind, text, group = 'Elements'] of ADDABLE) {
    if (!groups.length || groups[groups.length - 1].name !== group) groups.push({ name: group, items: [] });
    groups[groups.length - 1].items.push([kind, text]);
  }
  const icon = kind => ({ heading: 'H', grid: '▦', 'grid-3': '▦', stack: '☰', 'stack-row': '⇉', 'section-columns': '◫', 'section-screen': '⛶', 'section-full': '▭' })[kind] || TYPES[kind]?.icon || '•';
  root.innerHTML = '<div class="panel-head"><h2 class="panel-title">Add elements</h2></div><p class="panel-subtitle">Elements go into the selected container, or after the selected element.</p>'
    + groups.map(group => '<h3>' + esc(group.name) + '</h3><div class="add-grid">' + group.items.map(([kind, text]) => '<button class="add-item" data-add="' + kind + '"><span aria-hidden="true">' + icon(kind) + '</span>' + esc(text) + '</button>').join('') + '</div>').join('');
  root.addEventListener('click', event => {
    const button = event.target.closest('[data-add]');
    if (!button || !ctx.editable()) return;
    const { doc, index, page, selected } = ctx.state();
    const { id, node } = createNode(doc, button.dataset.add);
    let target = insertionTarget(doc, index, page, selected, node.type);
    const ops = [{ path: ['nodes', id], value: node }];
    if (!target) {
      // Empty page: create a section first and put the element inside it.
      const section = createNode(doc, 'section');
      ops.unshift({ path: ['nodes', section.id], value: { ...section.node, children: [id] } });
      ops.push({ path: ['pages', doc.pages.indexOf(page), 'children'], value: [...page.children, section.id] });
    } else {
      const list = target.parent === null ? page.children : doc.nodes[target.parent].children;
      const next = list.slice(); next.splice(target.position, 0, id);
      ops.push({ path: target.parent === null ? ['pages', target.page, 'children'] : ['nodes', target.parent, 'children'], value: next });
    }
    if (ctx.commit(ops, { label: 'Add ' + button.textContent.trim() })) ctx.select(id, { source: 'add', reveal: true });
    else return;
    if (node.children) ctx.showLayout?.();
  });
  return { render() {} };
}

function slug(text) {
  const base = text.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 50);
  return /^[a-z]/.test(base) ? base : 'page-' + (base || 'new');
}
export function createPagesPanel(root, ctx) {
  function render() {
    const { doc, page } = ctx.state();
    root.innerHTML = '<div class="panel-head"><h2 class="panel-title">Pages</h2></div><div class="page-list" role="list">'
      + doc.pages.map(item => '<button role="listitem" class="page-item' + (item.id === page.id ? ' active' : '') + '" data-page="' + esc(item.id) + '"><span>' + esc(item.name) + '</span><small>' + esc(item.path) + '</small></button>').join('')
      + '</div><form class="add-page"><input name="name" placeholder="New page name" aria-label="New page name" maxlength="120"><button class="btn btn-small">Add page</button></form>'
      + '<h3>Page settings</h3><div class="page-settings">'
      + '<label>Name<input data-page-field="name" value="' + esc(page.name) + '" maxlength="120"></label>'
      + (page.id === 'home' ? '' : '<label>Address<input data-page-field="path" value="' + esc(page.path) + '" spellcheck="false"></label>')
      + '<label>SEO title<input data-page-field="title" value="' + esc(page.title || '') + '" placeholder="' + esc(page.name + ' — ' + doc.site.name) + '" maxlength="200"></label>'
      + '<label>SEO description<textarea data-page-field="description" rows="3" maxlength="2000" placeholder="' + esc(doc.site.description) + '">' + esc(page.description || '') + '</textarea></label>'
      + '<label class="check"><input type="checkbox" data-page-field="showHeader"' + (page.showHeader ? ' checked' : '') + '>Show header</label>'
      + '<label class="check"><input type="checkbox" data-page-field="showFooter"' + (page.showFooter ? ' checked' : '') + '>Show footer</label>'
      + (page.id === 'home' ? '' : '<button class="btn btn-danger" data-delete-page>Delete page</button>') + '</div>';
    if (!ctx.editable()) root.querySelectorAll('input,textarea,form button,[data-delete-page]').forEach(element => { element.disabled = true; });
  }
  root.addEventListener('click', event => {
    const item = event.target.closest('[data-page]');
    if (item) return ctx.openPage(item.dataset.page);
    if (event.target.closest('[data-delete-page]') && ctx.editable()) {
      const { doc, page } = ctx.state();
      if (!confirm('Delete the page “' + page.name + '”? Undo can bring it back.')) return;
      const removed = page.children.flatMap(id => descendants(doc, id));
      ctx.openPage('home');
      ctx.commit([{ path: ['pages'], value: doc.pages.filter(item => item.id !== page.id) }, ...removed.map(id => ({ path: ['nodes', id], value: undefined }))], { label: 'Delete page' });
    }
  });
  root.addEventListener('submit', event => {
    event.preventDefault();
    if (!ctx.editable()) return;
    const { doc } = ctx.state();
    const name = event.target.elements.name.value.trim();
    if (!name) return;
    let id = slug(name), counter = 1;
    while (doc.pages.some(item => item.id === id || item.path === '/' + id)) id = slug(name) + '-' + (++counter);
    const sectionId = newId(doc, 'section');
    const section = { id: sectionId, type: 'section', name: 'Section', children: [], layout: { desktop: { mode: 'stack', direction: 'column', align: 'start', rowGap: '16px', padding: ['60px', '35px', '60px', '35px'], contentWidth: '1022px' }, mobile: { padding: ['40px', '20px', '40px', '20px'] } } };
    if (ctx.commit([{ path: ['nodes', sectionId], value: section }, { path: ['pages'], value: [...doc.pages, { id, name, path: '/' + id, children: [sectionId], showHeader: true, showFooter: true }] }], { label: 'Add page' })) ctx.openPage(id);
  });
  root.addEventListener('change', event => {
    const field = event.target.dataset.pageField;
    if (!field || !ctx.editable()) return;
    const { doc, page } = ctx.state();
    const value = event.target.type === 'checkbox' ? event.target.checked : event.target.value.trim() || (field === 'title' || field === 'description' ? undefined : event.target.value.trim());
    if ((field === 'name' || field === 'path') && !value) return render();
    ctx.commit([{ path: ['pages', doc.pages.indexOf(page), field], value }], { label: 'Page ' + field });
  });
  return { render };
}
