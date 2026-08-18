// BlockNote schema: page mentions, callout, toggle, quote, divider + block-level helpers.
import React, { useMemo, useSyncExternalStore } from 'react';
import { useCreateBlockNote, createReactInlineContentSpec } from '@blocknote/react';
import { BlockNoteView } from '@blocknote/mantine';
import { BlockNoteSchema, defaultInlineContentSpecs, defaultBlockSpecs, createBlockSpec } from '@blocknote/core';
import { TextT, TextHOne, TextHTwo, TextHThree, ListBullets, ListNumbers, CheckSquare, Code as CodeIcon, Lightbulb, Quotes, CaretRight as ChevronRight } from '@phosphor-icons/react';
import { PageIcon, parseContent } from './ui.jsx';
export const pageMetaStore = { map: new Map(), v: 0, subs: new Set() };
export function feedPageMeta(pages) {
  pageMetaStore.map = new Map(pages.map(p => [p.id, (p.title || '') + '\u0000' + (p.icon || '')]));
  pageMetaStore.v++;
  pageMetaStore.subs.forEach(f => { try { f(); } catch {} });
}
export function usePageLive(id) {
  return useSyncExternalStore(
    (cb) => { pageMetaStore.subs.add(cb); return () => pageMetaStore.subs.delete(cb); },
    () => pageMetaStore.map.get(id) ?? (pageMetaStore.v ? '__gone__' : null)
  );
}
export const PageLink = createReactInlineContentSpec(
  { type: 'pageLink', propSchema: { pageId: { default: '' }, title: { default: '' }, icon: { default: '📄' } }, content: 'none' },
  { render: (props) => {
      const { pageId, title, icon } = props.inlineContent.props;
      const live = usePageLive(pageId);
      const gone = live === '__gone__';
      const [t, ic] = live && !gone ? live.split('\u0000') : [title, icon];
      return <span className={'page-mention' + (gone ? ' gone' : '')} data-page={pageId} title={gone ? 'This page was moved or deleted' : undefined}><PageIcon icon={ic || icon} size={18} /><span>{t || title || 'Untitled'}</span></span>;
    } }
);
export const CALLOUT_COLORS = {
  accent: { bg: 'color-mix(in srgb, var(--accent) 16%, transparent)', dot: 'var(--accent)' },
  blue:   { bg: 'rgba(111,159,224,.16)', dot: '#6f9fe0' },
  green:  { bg: 'rgba(95,193,138,.16)', dot: '#5fc18a' },
  amber:  { bg: 'rgba(225,168,69,.16)', dot: '#e1a845' },
  red:    { bg: 'rgba(255,93,82,.15)', dot: '#ff5d52' },
  purple: { bg: 'rgba(154,109,215,.16)', dot: '#9a6dd7' },
  gray:   { bg: 'rgba(155,154,151,.13)', dot: '#9b9a97' },
};
// Requests from vanilla (non-React) node views for UI that must render OUTSIDE the
// editor DOM (pickers, menus). React must never mount inside ProseMirror-managed
// nodes: PM's mutation observer treats those DOM writes as edits, marks the block
// dirty and redraws it on every keystroke, which stomps the caret and can loop.
export const blockUI = {
  req: null, subs: new Set(),
  open(req) { this.req = req; this.subs.forEach(f => { try { f(); } catch {} }); },
  close() { this.open(null); },
};
export const useBlockUI = () => useSyncExternalStore((cb) => { blockUI.subs.add(cb); return () => blockUI.subs.delete(cb); }, () => blockUI.req);
// Callout: pure DOM node view. The emoji tile asks the Editor (via blockUI) to show
// the emoji + color picker in a portal anchored to the tile.
export const Callout = createBlockSpec(
  { type: 'callout', propSchema: { emoji: { default: '💡' }, bg: { default: 'accent' } }, content: 'inline' },
  {
    render: (block, editor) => {
      const dom = document.createElement('div');
      dom.className = 'callout';
      dom.style.background = (CALLOUT_COLORS[block.props.bg] || CALLOUT_COLORS.accent).bg;
      const tile = document.createElement('button');
      tile.type = 'button'; tile.className = 'ce-btn'; tile.contentEditable = 'false'; tile.tabIndex = -1;
      tile.textContent = block.props.emoji || '💡';
      tile.title = editor.isEditable ? 'Change emoji & color' : '';
      const content = document.createElement('div');
      content.className = 'callout-content';
      dom.append(tile, content);
      if (editor.isEditable) {
        tile.onmousedown = (e) => e.preventDefault(); // keep the text caret where it is
        tile.onclick = (e) => {
          e.preventDefault(); e.stopPropagation();
          const r = tile.getBoundingClientRect();
          blockUI.open({ kind: 'callout', editor, blockId: block.id, emoji: block.props.emoji, bg: block.props.bg, rect: { left: r.left, top: r.top, bottom: r.bottom, right: r.right } });
        };
      }
      return { dom, contentDOM: content };
    },
  }
);
// Collapsible toggle: the line is the editable title, Tab-nested children collapse.
// `collapsed` is a block prop (persists + syncs). Hiding the children is pure CSS on
// the `.closed` class set at render time (see styles: .bn-block:has(> ... .toggle-blk.closed)),
// so nothing mutates ProseMirror-managed DOM after the fact.
const toggleLocal = new Map(); // read-only viewers: block id -> collapsed override
export const ToggleBlock = createBlockSpec(
  { type: 'toggle', propSchema: { collapsed: { default: false }, level: { default: 0 } }, content: 'inline' },
  {
    render: (block, editor) => {
      const collapsed = editor.isEditable ? !!block.props.collapsed : (toggleLocal.has(block.id) ? toggleLocal.get(block.id) : !!block.props.collapsed);
      const dom = document.createElement('div');
      dom.className = 'toggle-blk' + (collapsed ? ' closed' : '') + (block.props.level ? ' h' + block.props.level : '');
      const btn = document.createElement('button');
      btn.className = 'tg-btn'; btn.type = 'button'; btn.contentEditable = 'false'; btn.tabIndex = -1; btn.title = collapsed ? 'Expand' : 'Collapse';
      btn.innerHTML = '<svg width="13" height="13" viewBox="0 0 256 256" fill="currentColor"><path d="M181.66,133.66l-80,80A8,8,0,0,1,88,208V48a8,8,0,0,1,13.66-5.66l80,80A8,8,0,0,1,181.66,133.66Z"></path></svg>';
      const content = document.createElement('div');
      content.className = 'tg-title';
      dom.append(btn, content);
      btn.onmousedown = (e) => e.preventDefault();
      btn.onclick = (e) => {
        e.preventDefault(); e.stopPropagation();
        if (editor.isEditable) {
          try {
            const cur = editor.getBlock(block.id);
            if (cur && collapsed && !(cur.children || []).length) editor.updateBlock(block.id, { props: { collapsed: false }, children: [{ type: 'paragraph' }] });
            else editor.updateBlock(block.id, { props: { collapsed: !collapsed } });
          } catch {}
        } else {
          toggleLocal.set(block.id, !collapsed);
          dom.classList.toggle('closed', !collapsed);
        }
      };
      return { dom, contentDOM: content };
    },
  }
);
export const QuoteBlock = createBlockSpec(
  { type: 'quote', propSchema: {}, content: 'inline' },
  {
    render: () => { const dom = document.createElement('blockquote'); dom.className = 'quote-blk'; return { dom, contentDOM: dom }; },
    parse: (el) => (el.tagName === 'BLOCKQUOTE' && !el.closest('[data-content-type]') ? {} : undefined), // pasted HTML / Markdown "> quote"
  }
);
export const DividerBlock = createBlockSpec(
  { type: 'divider', propSchema: {}, content: 'none' },
  {
    render: () => { const dom = document.createElement('div'); dom.className = 'divider-blk'; dom.contentEditable = 'false'; dom.appendChild(document.createElement('hr')); return { dom }; },
    parse: (el) => (el.tagName === 'HR' && !el.closest('[data-content-type]') ? {} : undefined),      // pasted HTML / Markdown "---"
  }
);
// BlockNote 0.25 bug: its `input[type=checkbox]` parse rule also fires for the checkbox
// INSIDE an internally-copied checklist block, so pasting to-dos produced an empty item
// with the text nested under it. Ignore checkboxes that live inside a block-content
// wrapper or an <li> (the wrapper's/li's own rule + `data-checked` carry the state);
// bare <input> checkboxes from other apps still parse as before.
const CheckListFixed = (() => {
  const base = defaultBlockSpecs.checkListItem;
  const node = base.implementation.node.extend({
    // tiptap's configure() merges into `this.options`; without addOptions that is
    // undefined and the merge yields {} (the editor option would be lost)
    addOptions() { return {}; },
    parseHTML() {
      return (this.parent?.() || []).map(rule => rule.tag === 'input'
        ? { ...rule, getAttrs: (el) => (typeof el !== 'string' && el.closest?.('[data-content-type], li')) ? false : rule.getAttrs(el) }
        : rule);
    },
  });
  return { ...base, implementation: { ...base.implementation, node } };
})();
// prosemirror-model >= 1.25 changed how the parser places nodes that don't fit their
// context (solid parents no longer stop the search). BlockNote 0.25's internal clipboard
// HTML wraps every block's text in <p class="bn-inline-content">, and its generic <p>
// rules then created a NEW paragraph that got nested under an empty copy of the block:
// pasting anything copied inside NoteBit produced doubled, nested blocks. Inside block
// content wrappers a <p> is only formatting, so skip the element and parse its text.
const ParagraphFixed = (() => {
  const base = defaultBlockSpecs.paragraph;
  const node = base.implementation.node.extend({
    addOptions() { return {}; },
    parseHTML() {
      return [
        { tag: 'p', priority: 1000, skip: true, getAttrs: (el) => (typeof el !== 'string' && el.closest?.('[data-content-type]')) ? null : false },
        ...(this.parent?.() || []),
      ];
    },
  });
  return { ...base, implementation: { ...base.implementation, node } };
})();
export const schema = BlockNoteSchema.create({
  blockSpecs: { ...defaultBlockSpecs, paragraph: ParagraphFixed, checkListItem: CheckListFixed, callout: Callout, toggle: ToggleBlock, quote: QuoteBlock, divider: DividerBlock },
  inlineContentSpecs: { ...defaultInlineContentSpecs, pageLink: PageLink },
});

export function ReadOnly({ content }) {
  const editor = useCreateBlockNote({ schema, initialContent: useMemo(() => parseContent(content), []) });
  return <BlockNoteView editor={editor} editable={false} theme="dark" />;
}

export const TURN_INTO = [
  { label: 'Text', icon: TextT, type: 'paragraph', props: {} },
  { label: 'Heading', icon: TextHOne, sub: [
    { label: 'Heading 1', icon: TextHOne, type: 'heading', props: { level: 1 } },
    { label: 'Heading 2', icon: TextHTwo, type: 'heading', props: { level: 2 } },
    { label: 'Heading 3', icon: TextHThree, type: 'heading', props: { level: 3 } },
    { label: 'Toggle heading', icon: ChevronRight, type: 'toggle', props: { level: 2 } },
  ] },
  { label: 'List', icon: ListBullets, sub: [
    { label: 'Bulleted', icon: ListBullets, type: 'bulletListItem', props: {} },
    { label: 'Numbered', icon: ListNumbers, type: 'numberedListItem', props: {} },
    { label: 'To-do', icon: CheckSquare, type: 'checkListItem', props: {} },
  ] },
  { label: 'Code', icon: CodeIcon, type: 'codeBlock', props: {} },
  { label: 'Callout', icon: Lightbulb, type: 'callout', props: {} },
  { label: 'Toggle', icon: ChevronRight, type: 'toggle', props: {} },
  { label: 'Quote', icon: Quotes, type: 'quote', props: {} },
];
export const stripIds = (b) => ({ ...b, id: undefined, children: (b.children || []).map(stripIds) });
export const looksLikeMarkdown = (t) =>
  /^#{1,6}\s/m.test(t) || /^\s*[-*+]\s+\S/m.test(t) || /^\s*\d+\.\s+\S/m.test(t) ||
  /^\s*>\s/m.test(t) || /^\s*([-*_])(\s*\1){2,}\s*$/m.test(t) || /\*\*[^*\n]+\*\*/.test(t) ||
  /\[[^\]]+\]\([^)\s]+\)/.test(t);
