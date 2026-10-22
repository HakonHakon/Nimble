// Editing operations on the rich text AST (`props.doc` of a text element). Pure functions, no DOM.
// The document is read as a list of lines: each paragraph or heading is one line, and so is each
// list item. Positions are { line, offset }; offsets count UTF-16 code units, and a token counts as 1.
export const MARKS = ['b', 'i', 'u', 's'];
export const RUN_PROPS = ['color', 'highlight', 'font', 'size', 'weight', 'link'];
export const BLOCK_PROPS = ['align', 'lineHeight', 'letterSpacing'];
export const TEXT_TAGS = ['p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6'];
const RUN_ORDER = ['text', 'b', 'i', 'u', 's', 'color', 'font', 'size', 'weight', 'highlight', 'link', 'token'];
const BLOCK_ORDER = ['t', 'style', 'align', 'lineHeight', 'letterSpacing'];

export const isList = block => block.t === 'ul' || block.t === 'ol';
export const runLength = run => run.token ? 1 : run.text.length;
export const lineLength = runs => runs.reduce((total, run) => total + runLength(run), 0);
const compare = (a, b) => a.line - b.line || a.offset - b.offset;
export const ordered = range => compare(range.start, range.end) <= 0 ? range : { start: range.end, end: range.start };
export const collapsed = range => compare(range.start, range.end) === 0;

// Runs and blocks with keys in the order the normalizer writes them, so JSON comparisons are stable.
export function canonicalRun(run) {
  const out = {};
  for (const key of RUN_ORDER) if (run[key] !== undefined && run[key] !== false) out[key] = run[key];
  if (out.token) out.text = '';
  if (out.text === undefined) out.text = '';
  return out;
}
function canonicalBlock(block) {
  const out = {};
  for (const key of BLOCK_ORDER) if (block[key] !== undefined) out[key] = block[key];
  if (isList(block)) out.items = block.items.map(runs => mergeRuns(runs));
  else out.c = mergeRuns(block.c || []);
  return out;
}
export const canonical = doc => doc.map(canonicalBlock);
const style = run => JSON.stringify(canonicalRun({ ...run, text: '' }));

// Drops empty runs and joins neighbours with identical formatting.
export function mergeRuns(runs) {
  const out = [];
  for (const source of runs) {
    const run = canonicalRun(source);
    if (!run.token && run.text === '') continue;
    const last = out[out.length - 1];
    if (last && !last.token && !run.token && style(last) === style(run)) last.text += run.text;
    else out.push(run);
  }
  return out;
}

// The document as lines. `group` identifies the block a line came from, so lists can be rebuilt.
export function lines(doc) {
  const out = [];
  doc.forEach((block, index) => {
    const template = {};
    for (const key of BLOCK_ORDER) if (block[key] !== undefined) template[key] = block[key];
    if (isList(block)) block.items.forEach(runs => out.push({ group: index, template, runs }));
    else out.push({ group: index, template, runs: block.c || [] });
  });
  return out;
}
// Rebuilds blocks from lines; consecutive lines of the same list group become one list.
export function fromLines(list) {
  const doc = [];
  let previous = null;
  for (const line of list) {
    if (isList(line.template)) {
      if (previous && previous.group === line.group && isList(previous.template)) doc[doc.length - 1].items.push(mergeRuns(line.runs));
      else doc.push({ ...line.template, items: [mergeRuns(line.runs)] });
    } else doc.push({ ...line.template, c: mergeRuns(line.runs) });
    previous = line;
  }
  return canonical(doc);
}
export const ensureLine = doc => doc.length ? doc : [{ t: 'p', c: [] }];

export function splitRuns(runs, offset) {
  const before = [], after = [];
  let position = 0;
  for (const run of runs) {
    const length = runLength(run);
    if (position + length <= offset) before.push(run);
    else if (position >= offset) after.push(run);
    else {
      const cut = offset - position;
      before.push({ ...run, text: run.text.slice(0, cut) });
      after.push({ ...run, text: run.text.slice(cut) });
    }
    position += length;
  }
  return [before, after];
}
// Calls fn on every run inside the range (split at the range edges) and returns a new document.
function mapSelected(doc, range, fn) {
  const { start, end } = ordered(range);
  const list = lines(doc).map((line, index) => {
    if (index < start.line || index > end.line) return line;
    const from = index === start.line ? start.offset : 0;
    const to = index === end.line ? end.offset : lineLength(line.runs);
    const [before, rest] = splitRuns(line.runs, from);
    const [middle, after] = splitRuns(rest, to - from);
    return { ...line, runs: [...before, ...middle.map(fn), ...after] };
  });
  return fromLines(list);
}
// Runs the range covers; a collapsed range looks at the character before the caret.
export function selectedRuns(doc, range) {
  const { start, end } = ordered(range);
  const list = lines(doc);
  if (!list.length) return [];
  if (collapsed(range)) {
    const runs = list[start.line]?.runs || [];
    const [before, after] = splitRuns(runs, start.offset);
    return before.length ? [before[before.length - 1]] : after.slice(0, 1);
  }
  const out = [];
  for (let index = start.line; index <= end.line; index++) {
    const runs = list[index].runs;
    const from = index === start.line ? start.offset : 0;
    const to = index === end.line ? end.offset : lineLength(runs);
    out.push(...splitRuns(splitRuns(runs, from)[1], to - from)[0].filter(run => runLength(run) > 0));
  }
  return out;
}
// What the toolbar shows: marks on when every selected run has them; a property only when all runs agree.
export function markState(doc, range) {
  const runs = selectedRuns(doc, range), state = {};
  for (const mark of MARKS) state[mark] = runs.length > 0 && runs.every(run => run[mark] === true);
  for (const key of RUN_PROPS) {
    const values = new Set(runs.map(run => JSON.stringify(run[key] ?? null)));
    state[key] = values.size === 1 ? runs[0]?.[key] : undefined;
  }
  return state;
}
export function setRunProp(doc, range, key, value) {
  return mapSelected(doc, range, run => {
    const next = { ...run };
    if (value === undefined || value === null || value === '') delete next[key]; else next[key] = value;
    return next;
  });
}
export function toggleMark(doc, range, mark) {
  return setRunProp(doc, range, mark, markState(doc, range)[mark] ? undefined : true);
}
// Removes character and paragraph formatting; links and tokens stay.
export function clearFormatting(doc, range) {
  const plain = mapSelected(doc, range, run => ({ text: run.text, ...(run.link ? { link: run.link } : {}), ...(run.token ? { token: run.token } : {}) }));
  return setBlockProps(plain, range, { align: undefined, lineHeight: undefined, letterSpacing: undefined, style: undefined });
}
// The range widened to the whole link under the caret (or around a selection inside one link).
export function linkRange(doc, range) {
  const { start } = ordered(range);
  const runs = lines(doc)[start.line]?.runs || [];
  let position = 0;
  for (const run of runs) {
    const length = runLength(run);
    if (run.link && start.offset >= position && start.offset <= position + length) {
      // Extend over neighbouring runs that carry the same link.
      let from = position, to = position + length, at = 0;
      const key = JSON.stringify(run.link);
      const spans = runs.map(item => { const span = [at, at + runLength(item), JSON.stringify(item.link ?? null) === key]; at += runLength(item); return span; });
      const index = runs.indexOf(run);
      for (let i = index - 1; i >= 0 && spans[i][2]; i--) from = spans[i][0];
      for (let i = index + 1; i < spans.length && spans[i][2]; i++) to = spans[i][1];
      return { start: { line: start.line, offset: from }, end: { line: start.line, offset: to } };
    }
    position += length;
  }
  return null;
}

const touchedGroups = (doc, range) => {
  const { start, end } = ordered(range);
  return new Set(lines(doc).slice(start.line, end.line + 1).map(line => line.group));
};
export function blockState(doc, range) {
  const list = lines(doc);
  return list[ordered(range).start.line]?.template || { t: 'p' };
}
export function setBlockProps(doc, range, patch) {
  const groups = touchedGroups(doc, range);
  return canonical(doc.map((block, index) => {
    if (!groups.has(index)) return block;
    const next = { ...block };
    for (const [key, value] of Object.entries(patch)) { if (value === undefined || value === null || value === '') delete next[key]; else next[key] = value; }
    return next;
  }));
}
// Changes the touched blocks to a paragraph/heading tag (with an optional text style) or to a list.
// The lines stay in order, so positions remain valid.
export function setBlockType(doc, range, t, styleKey, defaults) {
  const groups = touchedGroups(doc, range);
  const first = Math.min(...groups), last = Math.max(...groups);
  const list = lines(doc);
  const merged = isList({ t }) ? 'list:' + first : null;
  return fromLines(list.map(line => {
    if (line.group < first || line.group > last) return line;
    const template = { ...line.template, t };
    const wanted = styleKey ?? (TEXT_TAGS.includes(line.template.t) && line.template.t === t ? line.template.style : undefined);
    if (wanted && wanted !== defaults[t]) template.style = wanted; else delete template.style;
    return { ...line, template, group: merged ?? line.group };
  }));
}

export function deleteRange(doc, range) {
  const { start, end } = ordered(range);
  if (collapsed(range)) return { doc, caret: start };
  const list = lines(doc);
  const [keep] = splitRuns(list[start.line].runs, start.offset);
  const [, tail] = splitRuns(list[end.line].runs, end.offset);
  const next = [...list.slice(0, start.line), { ...list[start.line], runs: [...keep, ...tail] }, ...list.slice(end.line + 1)];
  return { doc: fromLines(next), caret: start };
}
// Inserts pasted blocks at the range (replacing the selection). Returns the new document and caret.
export function insertBlocks(doc, range, blocks) {
  const removed = deleteRange(ensureLine(doc), range);
  const list = lines(removed.doc), at = removed.caret;
  const pasted = lines(blocks).map(line => ({ ...line, group: 'paste:' + line.group }));
  if (!pasted.length) return removed;
  const current = list[at.line];
  const [before, after] = splitRuns(current.runs, at.offset);
  if (pasted.length === 1) {
    const runs = [...before, ...pasted[0].runs, ...after];
    return { doc: fromLines([...list.slice(0, at.line), { ...current, runs }, ...list.slice(at.line + 1)]), caret: { line: at.line, offset: at.offset + lineLength(pasted[0].runs) } };
  }
  const head = { ...current, runs: [...before, ...pasted[0].runs] };
  const middle = pasted.slice(1, -1);
  const last = pasted[pasted.length - 1];
  const tail = { ...last, runs: [...last.runs, ...after] };
  const next = [...list.slice(0, at.line), head, ...middle, tail, ...list.slice(at.line + 1)];
  return { doc: fromLines(next), caret: { line: at.line + pasted.length - 1, offset: lineLength(last.runs) } };
}
// Plain text: each line becomes a paragraph.
export const textToBlocks = text => String(text).replace(/\r\n?/g, '\n').split('\n').map(line => ({ t: 'p', c: line ? [{ text: line }] : [] }));
export function lineCount(doc) { return lines(doc).length; }
export function endOf(doc) { const list = lines(doc); return list.length ? { line: list.length - 1, offset: lineLength(list[list.length - 1].runs) } : { line: 0, offset: 0 }; }
