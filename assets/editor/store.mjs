// Command store: every edit is a list of `set` operations with recorded inverses, so undo/redo
// never needs whole-document snapshots. The result is validated with the same normalizer as the server.
import { normalizeSiteV2, normalizeNodeV2 } from '/assets/site-model-v2.mjs';

const clone = value => value === undefined ? undefined : structuredClone(value);
export function getAt(target, path) {
  let current = target;
  for (const key of path) { if (current === null || typeof current !== 'object') return undefined; current = current[key]; }
  return current;
}
// Copy-on-write update: only the objects along `path` are copied, the rest is shared with the old document.
function setAt(root, path, value) {
  const copy = item => Array.isArray(item) ? item.slice() : { ...item };
  const next = copy(root);
  let current = next;
  for (let i = 0; i < path.length - 1; i++) {
    const child = current[path[i]];
    if (child === null || typeof child !== 'object') {
      if (value === undefined) return next;
      current[path[i]] = typeof path[i + 1] === 'number' ? [] : {};
    } else current[path[i]] = copy(child);
    current = current[path[i]];
  }
  const key = path[path.length - 1];
  if (value === undefined) { if (Array.isArray(current)) current.splice(key, 1); else delete current[key]; }
  else current[key] = value;
  return next;
}
// Elements whose rendering depends on a path; null means "re-render everything".
function affected(ops) {
  const ids = new Set();
  for (const { path } of ops) {
    if (path[0] !== 'nodes') return null;
    ids.add(path[1]);
  }
  return ids;
}

export function createStore(initial, { limit = 200, onChange = () => {} } = {}) {
  let doc = normalizeSiteV2(initial);
  const undo = [], redo = [];
  // Edits that only change an element's own properties are validated per element, keeping every
  // other node object identical (the canvas caches CSS by node). Structural edits validate everything.
  const local = ops => ops.every(({ path }) => path[0] === 'nodes' && path.length >= 3 && !['id', 'type', 'children'].includes(path[2]) && doc.nodes[path[1]]);
  const run = ops => {
    let next = doc;
    for (const op of ops) next = setAt(next, op.path, clone(op.value));
    if (!local(ops)) return normalizeSiteV2(next);
    for (const id of new Set(ops.map(op => op.path[1]))) next.nodes[id] = normalizeNodeV2(next, id);
    return next;
  };
  const store = {
    get doc() { return doc; },
    get canUndo() { return undo.length > 0; },
    get canRedo() { return redo.length > 0; },
    // Applies operations as one undoable step. Steps with the same merge key within 1.5 s collapse into one.
    commit(ops, { label = 'Edit', merge = null } = {}) {
      if (!ops.length) return false;
      const inverse = ops.map(op => ({ path: op.path, value: clone(getAt(doc, op.path)) })).reverse();
      doc = run(ops);
      const last = undo[undo.length - 1], now = Date.now();
      if (merge && last && last.merge === merge && now - last.time < 1500) {
        const known = new Set(last.inverse.map(op => op.path.join('\u0000')));
        last.inverse.push(...inverse.filter(op => !known.has(op.path.join('\u0000'))));
        last.ops = last.ops.concat(ops); last.time = now;
      }
      else { undo.push({ label, merge, time: now, ops, inverse }); if (undo.length > limit) undo.shift(); }
      redo.length = 0;
      onChange({ ids: affected(ops), reason: 'commit', label });
      return true;
    },
    undo() {
      const step = undo.pop();
      if (!step) return false;
      doc = run(step.inverse);
      redo.push(step);
      onChange({ ids: affected(step.inverse), reason: 'undo', label: step.label });
      return true;
    },
    redo() {
      const step = redo.pop();
      if (!step) return false;
      doc = run(step.ops);
      undo.push({ ...step, merge: null });
      onChange({ ids: affected(step.ops), reason: 'redo', label: step.label });
      return true;
    },
    // Replaces the whole document (recovery, reload). Clears history.
    replace(next) {
      doc = normalizeSiteV2(next);
      undo.length = 0; redo.length = 0;
      onChange({ ids: null, reason: 'replace' });
    }
  };
  return store;
}
