// BlockNote schema: page mentions, callout, toggle, quote, divider + block-level helpers.
import React, { useMemo, useState, useSyncExternalStore } from 'react';
import { useCreateBlockNote, createReactInlineContentSpec } from '@blocknote/react';
import { BlockNoteView } from '@blocknote/mantine';
import { BlockNoteSchema, defaultInlineContentSpecs, defaultBlockSpecs, createBlockSpec } from '@blocknote/core';
import { createRoot } from 'react-dom/client';
import EmojiPicker from 'emoji-picker-react';
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
function CalloutControl({ emoji, bg, onEmoji, onBg }) {
  const [open, setOpen] = useState(false);
  return (
    <span className="callout-emoji" contentEditable={false}>
      <span className="ce-btn" onClick={() => setOpen(v => !v)} title="Change emoji & color">{emoji}</span>
      {open && <>
        <div className="picker-overlay" onClick={e => { e.stopPropagation(); setOpen(false); }} />
        <div className="ce-pop">
          <div className="ce-colors">{Object.entries(CALLOUT_COLORS).map(([k, v]) => <span key={k} className={'cc-dot' + (k === bg ? ' on' : '')} style={{ background: v.dot }} onClick={() => onBg(k)} title={k} />)}</div>
          <EmojiPicker onEmojiClick={e => { onEmoji(e.emoji); setOpen(false); }} theme="dark" emojiStyle="native" width={328} height={300} previewConfig={{ showPreview: false }} skinTonesDisabled lazyLoadEmojis />
        </div>
      </>}
    </span>
  );
}
// Vanilla (non-React) node view: the content area exists synchronously, so remote
// collaborators' text inside callouts renders reliably. Only the emoji/color control
// is React, mounted beside the content, never wrapping it.
export const Callout = createBlockSpec(
  { type: 'callout', propSchema: { emoji: { default: '💡' }, bg: { default: 'accent' } }, content: 'inline' },
  {
    render: (block, editor) => {
      const dom = document.createElement('div');
      dom.className = 'callout';
      dom.style.background = (CALLOUT_COLORS[block.props.bg] || CALLOUT_COLORS.accent).bg;
      const ctl = document.createElement('span');
      ctl.contentEditable = 'false';
      ctl.style.flex = 'none';
      const content = document.createElement('div');
      content.className = 'callout-content';
      dom.append(ctl, content);
      const emoji = block.props.emoji || '💡';
      let root = null;
      if (editor.isEditable) {
        root = createRoot(ctl);
        root.render(<CalloutControl emoji={emoji} bg={block.props.bg}
          onEmoji={(em) => { try { editor.updateBlock(block, { props: { emoji: em || '💡' } }); } catch {} }}
          onBg={(bg) => { try { editor.updateBlock(block, { props: { bg } }); } catch {} }} />);
      } else {
        ctl.className = 'callout-emoji';
        const b = document.createElement('span');
        b.className = 'ce-btn';
        b.textContent = emoji;
        ctl.appendChild(b);
      }
      return { dom, contentDOM: content, destroy: () => { const r = root; root = null; if (r) queueMicrotask(() => r.unmount()); } };
    },
  }
);
// Collapsible toggle: the line is the editable title, Tab-nested children collapse.
// collapsed is a block prop, so state persists and syncs to collaborators.
export const ToggleBlock = createBlockSpec(
  { type: 'toggle', propSchema: { collapsed: { default: false }, level: { default: 0 } }, content: 'inline' },
  {
    render: (block, editor) => {
      const dom = document.createElement('div');
      dom.className = 'toggle-blk' + (block.props.collapsed ? ' closed' : '') + (block.props.level ? ' h' + block.props.level : '');
      const btn = document.createElement('button');
      btn.className = 'tg-btn'; btn.type = 'button'; btn.contentEditable = 'false'; btn.title = 'Toggle';
      btn.innerHTML = '<svg width="13" height="13" viewBox="0 0 256 256" fill="currentColor"><path d="M181.66,133.66l-80,80A8,8,0,0,1,88,208V48a8,8,0,0,1,13.66-5.66l80,80A8,8,0,0,1,181.66,133.66Z"></path></svg>';
      const content = document.createElement('div');
      content.className = 'tg-title';
      dom.append(btn, content);
      const applyChildren = () => {
        const grp = dom.closest('.bn-block')?.querySelector(':scope > .bn-block-group');
        if (grp) grp.style.display = block.props.collapsed ? 'none' : '';
      };
      queueMicrotask(applyChildren);
      btn.onclick = () => {
        if (editor.isEditable) {
          try {
            const cur = editor.getBlock(block.id);
            if (cur && block.props.collapsed && !(cur.children || []).length) {
              editor.updateBlock(block.id, { props: { collapsed: false }, children: [{ type: 'paragraph' }] });
            } else editor.updateBlock(block.id, { props: { collapsed: !block.props.collapsed } });
          } catch {}
        } else { // read-only viewers can still open/close locally
          dom.classList.toggle('closed');
          const grp = dom.closest('.bn-block')?.querySelector(':scope > .bn-block-group');
          if (grp) grp.style.display = dom.classList.contains('closed') ? 'none' : '';
        }
      };
      return { dom, contentDOM: content };
    },
  }
);
export const QuoteBlock = createBlockSpec(
  { type: 'quote', propSchema: {}, content: 'inline' },
  { render: () => { const dom = document.createElement('blockquote'); dom.className = 'quote-blk'; return { dom, contentDOM: dom }; } }
);
export const DividerBlock = createBlockSpec(
  { type: 'divider', propSchema: {}, content: 'none' },
  { render: () => { const dom = document.createElement('div'); dom.className = 'divider-blk'; dom.contentEditable = 'false'; dom.appendChild(document.createElement('hr')); return { dom }; } }
);
export const schema = BlockNoteSchema.create({
  blockSpecs: { ...defaultBlockSpecs, callout: Callout, toggle: ToggleBlock, quote: QuoteBlock, divider: DividerBlock },
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
