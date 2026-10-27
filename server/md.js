// Markdown <-> BlockNote blocks, dependency free. Used by the Claude Code (MCP) endpoint
// and the Markdown export so pages can be read and written as plain text on the server.
// Covers the blocks NoteBit ships: paragraphs, headings, bullet/numbered/check lists,
// code, quotes, callouts, toggles, dividers, images, tables, links and page links,
// with bold/italic/strike/code styles. Nesting is indentation (two spaces per level).
import crypto from 'node:crypto';

const EMOJI_RE = /^(\p{Extended_Pictographic}(?:️|‍\p{Extended_Pictographic})*)\s+/u;

// ---------- blocks -> markdown ----------
function styleWrap(text, styles) {
  if (!text) return '';
  const s = styles || {};
  if (s.code) return '`' + text + '`';
  // keep leading/trailing spaces outside the markers so they still parse back
  const m = text.match(/^(\s*)(.*?)(\s*)$/s);
  let [_, lead, core, trail] = m;
  if (!core) return text;
  if (s.bold) core = '**' + core + '**';
  if (s.italic) core = '*' + core + '*';
  if (s.strike) core = '~~' + core + '~~';
  return lead + core + trail;
}
export function inlineToMd(arr) {
  let out = '';
  for (const c of arr || []) {
    if (!c) continue;
    if (c.type === 'text') out += styleWrap(c.text, c.styles);
    else if (c.type === 'link') out += '[' + inlineToMd(c.content).replace(/\]/g, '\\]') + '](' + (c.href || '') + ')';
    else if (c.type === 'pageLink') out += '[' + (c.props?.title || 'Untitled') + '](/page/' + (c.props?.pageId || '') + ')';
    else if (typeof c.text === 'string') out += c.text;
  }
  return out;
}
const prefixLines = (text, first, rest = first) => String(text).split('\n').map((l, i) => (i ? rest : first) + l).join('\n');
function blockToMd(b, depth, ctx) {
  const ind = '  '.repeat(depth);
  const text = inlineToMd(Array.isArray(b.content) ? b.content : []);
  const lines = [];
  const p = b.props || {};
  switch (b.type) {
    case 'heading': lines.push(ind + '#'.repeat(Math.max(1, Math.min(6, p.level || 1))) + ' ' + text.replace(/\n/g, ' ')); break;
    case 'bulletListItem': lines.push(prefixLines(text, ind + '- ', ind + '  ')); break;
    case 'numberedListItem': { const n = (ctx.num[depth] = (ctx.prevType === 'numberedListItem' && ctx.prevDepth === depth ? (ctx.num[depth] || 0) : 0) + 1); lines.push(prefixLines(text, ind + n + '. ', ind + '   ')); break; }
    case 'checkListItem': lines.push(prefixLines(text, ind + (p.checked ? '- [x] ' : '- [ ] '), ind + '  ')); break;
    case 'codeBlock': { const code = (b.content || []).map(c => c.text || '').join(''); lines.push(ind + '```' + (p.language && p.language !== 'text' ? p.language : ''), ...code.split('\n').map(l => ind + l), ind + '```'); break; }
    case 'quote': lines.push(prefixLines(text, ind + '> ')); break;
    case 'callout': lines.push(prefixLines((p.emoji || '💡') + ' ' + text, ind + '> ', ind + '> ')); break;
    case 'toggle': lines.push(ind + '▸ ' + text.replace(/\n/g, ' ')); break;
    case 'divider': lines.push(ind + '---'); break;
    case 'image': lines.push(ind + '![' + (p.caption || p.name || '') + '](' + (p.url || '') + ')'); break;
    case 'table': {
      const rows = b.content?.rows || [];
      rows.forEach((r, i) => {
        const cells = (r.cells || []).map(c => inlineToMd(Array.isArray(c) ? c : c?.content).replace(/\|/g, '\\|').replace(/\n/g, ' '));
        lines.push(ind + '| ' + cells.join(' | ') + ' |');
        if (i === 0) lines.push(ind + '|' + cells.map(() => ' --- ').join('|') + '|');
      });
      break;
    }
    default: lines.push(prefixLines(text, ind)); // paragraph and anything unknown with text
  }
  ctx.prevType = b.type; ctx.prevDepth = depth;
  let out = lines.join('\n');
  for (const k of b.children || []) out += '\n' + blockToMd(k, depth + 1, ctx);
  return out;
}
const LISTY = new Set(['bulletListItem', 'numberedListItem', 'checkListItem']);
export function blocksToMarkdown(blocks) {
  const ctx = { num: {}, prevType: null, prevDepth: 0 };
  const parts = [];
  let prev = null;
  for (const b of blocks || []) {
    if (!b) continue;
    const md = blockToMd(b, 0, ctx);
    // blank line between blocks, except inside a run of list items
    if (prev && !(LISTY.has(prev.type) && LISTY.has(b.type))) parts.push('');
    parts.push(md); prev = b;
  }
  return parts.join('\n').replace(/\n{3,}/g, '\n\n').trim() + '\n';
}
export function blocksToText(blocks) {
  const out = [];
  const walk = (b) => { if (!b) return; if (Array.isArray(b.content)) out.push(inlineToMd(b.content).replace(/[*`~]/g, '')); for (const k of b.children || []) walk(k); };
  (blocks || []).forEach(walk);
  return out.join('\n');
}

// ---------- markdown -> blocks ----------
const newId = () => crypto.randomUUID();
const block = (type, content, props = {}, children = []) => ({ id: newId(), type, props, content, children });
const txt = (text, styles = {}) => ({ type: 'text', text, styles });

// inline parser: `code`, **bold**, *italic* / _italic_, ~~strike~~, [text](href)
export function parseInline(src, base = {}) {
  const out = [];
  let i = 0, buf = '';
  const flush = () => { if (buf) { out.push(txt(buf, { ...base })); buf = ''; } };
  const s = src || '';
  const findClose = (marker, from) => { let j = s.indexOf(marker, from); while (j > 0 && s[j - 1] === '\\') j = s.indexOf(marker, j + 1); return j; };
  while (i < s.length) {
    const ch = s[i];
    if (ch === '\\' && i + 1 < s.length && '*_~`[]\\|'.includes(s[i + 1])) { buf += s[i + 1]; i += 2; continue; }
    if (ch === '`') { const j = s.indexOf('`', i + 1); if (j > i + 1) { flush(); out.push(txt(s.slice(i + 1, j), { ...base, code: true })); i = j + 1; continue; } }
    if (s.startsWith('**', i)) { const j = findClose('**', i + 2); if (j > i + 2) { flush(); out.push(...parseInline(s.slice(i + 2, j), { ...base, bold: true })); i = j + 2; continue; } }
    if (s.startsWith('~~', i)) { const j = findClose('~~', i + 2); if (j > i + 2) { flush(); out.push(...parseInline(s.slice(i + 2, j), { ...base, strike: true })); i = j + 2; continue; } }
    if ((ch === '*' || ch === '_') && i + 1 < s.length && !/\s/.test(s[i + 1])) {
      const j = findClose(ch, i + 1);
      if (j > i + 1 && !/\s/.test(s[j - 1]) && (ch === '*' || !/\w/.test(s[j + 1] || ' '))) { flush(); out.push(...parseInline(s.slice(i + 1, j), { ...base, italic: true })); i = j + 1; continue; }
    }
    if (ch === '[') {
      const close = s.indexOf('](', i + 1); const end = close > 0 ? s.indexOf(')', close + 2) : -1;
      if (close > 0 && end > 0 && !s.slice(i + 1, close).includes('\n')) {
        const label = s.slice(i + 1, close), href = s.slice(close + 2, end).trim();
        flush();
        const pm = href.match(/^(?:https?:\/\/[^/]+)?\/page\/([\w-]+)(?:#.*)?$/);
        if (pm) out.push({ type: 'pageLink', props: { pageId: pm[1], title: label || 'Untitled', icon: '📄' } });
        else out.push({ type: 'link', href, content: parseInline(label, base) });
        i = end + 1; continue;
      }
    }
    buf += ch; i++;
  }
  flush();
  return out;
}

export function markdownToBlocks(md) {
  const lines = String(md || '').replace(/\r\n?/g, '\n').split('\n');
  const root = []; // top-level blocks
  const stack = [];  // [{ depth, block }]
  const add = (depth, b) => {
    while (stack.length && stack[stack.length - 1].depth >= depth) stack.pop();
    if (stack.length) stack[stack.length - 1].block.children.push(b); else root.push(b);
    stack.push({ depth, block: b });
    return b;
  };
  const depthOf = (ws) => Math.floor(ws.replace(/\t/g, '  ').length / 2);
  let para = null; // { depth, lines }
  const flushPara = () => { if (para) { add(para.depth, block('paragraph', parseInline(para.lines.join('\n')))); para = null; } };
  let i = 0;
  while (i < lines.length) {
    const raw = lines[i];
    const m = raw.match(/^(\s*)(.*)$/s); const ws = m[1], line = m[2];
    const depth = depthOf(ws);
    if (!line.trim()) { flushPara(); i++; continue; }
    let r;
    if ((r = line.match(/^```\s*(\S*)\s*$/))) {              // fenced code
      flushPara(); const lang = r[1] || 'text'; const code = [];
      i++;
      while (i < lines.length && !/^\s*```\s*$/.test(lines[i])) { code.push(lines[i].replace(new RegExp('^' + ws), '')); i++; }
      i++;
      add(depth, block('codeBlock', [txt(code.join('\n'))], { language: lang }));
      continue;
    }
    if ((r = line.match(/^(#{1,6})\s+(.*)$/))) { flushPara(); add(depth, block('heading', parseInline(r[2].replace(/\s+#+\s*$/, '')), { level: Math.min(3, r[1].length) })); i++; continue; }
    if (/^(-{3,}|\*{3,}|_{3,})\s*$/.test(line)) { flushPara(); add(depth, block('divider', undefined, {})); i++; continue; }
    if ((r = line.match(/^!\[([^\]]*)\]\(([^)\s]+)\)\s*$/))) { flushPara(); add(depth, block('image', undefined, { url: r[2], caption: r[1] })); i++; continue; }
    if ((r = line.match(/^▸\s+(.*)$/))) { flushPara(); add(depth, block('toggle', parseInline(r[1]), { collapsed: false, level: 0 })); i++; continue; }
    if ((r = line.match(/^[-*+]\s+\[([ xX])\]\s+(.*)$/))) { flushPara(); add(depth, block('checkListItem', parseInline(r[2]), { checked: r[1] !== ' ' })); i++; continue; }
    if ((r = line.match(/^[-*+]\s+(.*)$/))) { flushPara(); add(depth, block('bulletListItem', parseInline(r[1]))); i++; continue; }
    if ((r = line.match(/^\d+[.)]\s+(.*)$/))) { flushPara(); add(depth, block('numberedListItem', parseInline(r[1]))); i++; continue; }
    if (line.startsWith('>')) {                               // quote or callout (consecutive lines merge)
      flushPara(); const q = [];
      while (i < lines.length && /^\s*>/.test(lines[i])) { q.push(lines[i].replace(/^\s*>\s?/, '')); i++; }
      const body = q.join('\n'); const em = body.match(EMOJI_RE);
      if (em) add(depth, block('callout', parseInline(body.slice(em[0].length)), { emoji: em[1], bg: 'accent' }));
      else add(depth, block('quote', parseInline(body)));
      continue;
    }
    if (line.startsWith('|') && i + 1 < lines.length && /^\s*\|?\s*:?-{2,}/.test(lines[i + 1])) { // table
      flushPara(); const rows = [];
      const cells = (l) => l.trim().replace(/^\|/, '').replace(/\|$/, '').split(/(?<!\\)\|/).map(c => parseInline(c.trim().replace(/\\\|/g, '|')));
      rows.push({ cells: cells(line) }); i += 2;
      while (i < lines.length && /^\s*\|/.test(lines[i])) { rows.push({ cells: cells(lines[i]) }); i++; }
      const w = Math.max(...rows.map(r => r.cells.length));
      rows.forEach(r => { while (r.cells.length < w) r.cells.push([]); });
      add(depth, block('table', { type: 'tableContent', rows }, {}));
      continue;
    }
    // paragraph text: consecutive lines at the same depth join with line breaks
    if (para && para.depth === depth) para.lines.push(line);
    else { flushPara(); para = { depth, lines: [line] }; }
    i++;
  }
  flushPara();
  return root.length ? root : [block('paragraph', [])];
}
