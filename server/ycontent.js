// Writes BlockNote block JSON into a Yjs document in exactly the shape y-prosemirror
// + BlockNote produce in the browser (blockGroup > blockContainer > content node,
// text as deltas with mark attributes, line breaks as hardBreak elements). This is what
// lets the server (Claude Code / MCP) change a page while people have it open: the
// change arrives at every editor as an ordinary collaborative update.
import * as Y from 'yjs';
import crypto from 'node:crypto';

const CONTENT_ATTRS = {
  paragraph: () => ({ textAlignment: 'left' }),
  heading: (p) => ({ textAlignment: 'left', level: Math.max(1, Math.min(3, Number(p.level) || 1)) }),
  bulletListItem: () => ({ textAlignment: 'left' }),
  numberedListItem: () => ({ textAlignment: 'left' }),
  checkListItem: (p) => ({ textAlignment: 'left', checked: !!p.checked }),
  codeBlock: (p) => ({ language: p.language || 'text' }),
  quote: () => ({}),
  divider: () => ({}),
  callout: (p) => ({ emoji: p.emoji || '💡', bg: p.bg || 'accent' }),
  toggle: (p) => ({ collapsed: !!p.collapsed, level: Number(p.level) || 0 }),
  image: (p) => ({ textAlignment: 'left', backgroundColor: 'default', url: p.url || '', caption: p.caption || '', name: p.name || '', showPreview: true, previewWidth: Number(p.previewWidth) || 512 }),
};
function marksOf(styles) {
  const a = {}; const s = styles || {};
  if (s.bold) a.bold = {}; if (s.italic) a.italic = {}; if (s.underline) a.underline = {}; if (s.strike) a.strike = {}; if (s.code) a.code = {};
  if (s.textColor && s.textColor !== 'default') a.textColor = { stringValue: s.textColor };
  if (s.backgroundColor && s.backgroundColor !== 'default') a.backgroundColor = { stringValue: s.backgroundColor };
  return a;
}
// inline content -> array of Y.XmlText / Y.XmlElement children (text runs split on "\n" into hardBreak elements)
function inlineToY(arr) {
  const out = [];
  let run = []; // pending delta ops for one XmlText
  const flush = () => { if (run.length) { const t = new Y.XmlText(); t.applyDelta(run); out.push(t); run = []; } };
  const pushText = (text, attrs) => {
    const parts = String(text).split('\n');
    parts.forEach((p, i) => {
      if (i) { flush(); out.push(new Y.XmlElement('hardBreak')); }
      if (p) run.push(Object.keys(attrs).length ? { insert: p, attributes: attrs } : { insert: p });
    });
  };
  for (const c of arr || []) {
    if (!c) continue;
    if (c.type === 'text') pushText(c.text || '', marksOf(c.styles));
    else if (c.type === 'link') { const base = { link: { href: c.href || '' } }; for (const t of c.content || []) if (t && t.type === 'text') pushText(t.text || '', { ...marksOf(t.styles), ...base }); }
    else if (c.type === 'pageLink') { flush(); const el = new Y.XmlElement('pageLink'); el.setAttribute('pageId', c.props?.pageId || ''); el.setAttribute('title', c.props?.title || ''); el.setAttribute('icon', c.props?.icon || '📄'); out.push(el); }
    else if (typeof c.text === 'string') pushText(c.text, {});
  }
  flush();
  return out;
}
function cellToY(cell) {
  const td = new Y.XmlElement('tableCell');
  for (const [k, v] of Object.entries({ textColor: 'default', backgroundColor: 'default', textAlignment: 'left', colspan: 1, rowspan: 1 })) td.setAttribute(k, v);
  const p = new Y.XmlElement('tableParagraph');
  p.insert(0, inlineToY(Array.isArray(cell) ? cell : cell?.content));
  td.insert(0, [p]);
  return td;
}
function contentToY(b) {
  const type = CONTENT_ATTRS[b.type] ? b.type : (b.type === 'table' ? 'table' : 'paragraph');
  const el = new Y.XmlElement(type);
  if (type === 'table') {
    const rows = (b.content?.rows || []).map(r => { const tr = new Y.XmlElement('tableRow'); tr.insert(0, (r.cells || []).map(cellToY)); return tr; });
    el.insert(0, rows);
    return el;
  }
  const attrs = CONTENT_ATTRS[type](b.props || {});
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  if (type === 'codeBlock') { const code = (b.content || []).map(c => c?.text || '').join(''); if (code) { const t = new Y.XmlText(); t.insert(0, code); el.insert(0, [t]); } }
  else if (type !== 'divider' && type !== 'image') el.insert(0, inlineToY(Array.isArray(b.content) ? b.content : []));
  return el;
}
export function containerToY(b) {
  const c = new Y.XmlElement('blockContainer');
  c.setAttribute('id', b.id || crypto.randomUUID());
  c.setAttribute('textColor', 'default'); c.setAttribute('backgroundColor', 'default');
  const kids = [contentToY(b)];
  if (b.children && b.children.length) kids.push(groupToY(b.children));
  c.insert(0, kids);
  return c;
}
export function groupToY(blocks) {
  const g = new Y.XmlElement('blockGroup');
  g.insert(0, (blocks || []).filter(Boolean).map(containerToY));
  return g;
}
// Replace the whole document, or append blocks to the end of the top-level group.
export function writeBlocks(ydoc, blocks, { append = false } = {}) {
  const frag = ydoc.getXmlFragment('document');
  ydoc.transact(() => {
    let group = frag.length ? frag.get(0) : null;
    if (append && group instanceof Y.XmlElement && group.nodeName === 'blockGroup') {
      group.push((blocks || []).filter(Boolean).map(containerToY));
    } else {
      if (frag.length) frag.delete(0, frag.length);
      frag.insert(0, [groupToY(blocks)]);
    }
    ydoc.getMap('_meta').set('seeded', true);
  });
}
// Read the live document back as block JSON (used so the server sees unsaved keystrokes).
export function readBlocks(ydoc) {
  const frag = ydoc.getXmlFragment('document');
  if (!frag.length) return null;
  const group = frag.get(0);
  if (!(group instanceof Y.XmlElement) || group.nodeName !== 'blockGroup') return null;
  const inline = (el) => {
    const out = [];
    for (const c of el.toArray()) {
      if (c instanceof Y.XmlText) {
        for (const op of c.toDelta()) {
          const a = op.attributes || {}; const styles = {};
          for (const k of ['bold', 'italic', 'underline', 'strike', 'code']) if (a[k]) styles[k] = true;
          if (a.textColor?.stringValue) styles.textColor = a.textColor.stringValue;
          if (a.backgroundColor?.stringValue) styles.backgroundColor = a.backgroundColor.stringValue;
          if (a.link) out.push({ type: 'link', href: a.link.href || '', content: [{ type: 'text', text: op.insert, styles }] });
          else out.push({ type: 'text', text: op.insert, styles });
        }
      } else if (c instanceof Y.XmlElement) {
        if (c.nodeName === 'hardBreak') out.push({ type: 'text', text: '\n', styles: {} });
        else if (c.nodeName === 'pageLink') out.push({ type: 'pageLink', props: { pageId: c.getAttribute('pageId') || '', title: c.getAttribute('title') || '', icon: c.getAttribute('icon') || '📄' } });
      }
    }
    // merge adjacent plain text ops (hard breaks produce separate items)
    const merged = [];
    for (const it of out) { const last = merged[merged.length - 1]; if (last && last.type === 'text' && it.type === 'text' && JSON.stringify(last.styles) === JSON.stringify(it.styles)) last.text += it.text; else merged.push(it); }
    return merged;
  };
  const container = (c) => {
    const kids = c.toArray(); const content = kids.find(k => k instanceof Y.XmlElement && k.nodeName !== 'blockGroup'); const group = kids.find(k => k instanceof Y.XmlElement && k.nodeName === 'blockGroup');
    const type = content ? content.nodeName : 'paragraph';
    const props = content ? { ...content.getAttributes() } : {};
    delete props.textAlignment;
    const b = { id: c.getAttribute('id'), type, props, children: group ? group.toArray().map(container) : [] };
    if (type === 'table') b.content = { type: 'tableContent', rows: content.toArray().map(tr => ({ cells: tr.toArray().map(td => { const p = td.toArray()[0]; return p ? inline(p) : []; }) })) };
    else if (type === 'codeBlock') b.content = [{ type: 'text', text: content.toArray().map(t => t instanceof Y.XmlText ? t.toString() : '').join(''), styles: {} }];
    else if (type !== 'divider' && type !== 'image' && content) b.content = inline(content);
    return b;
  };
  return group.toArray().map(container);
}
