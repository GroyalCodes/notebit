import React, { useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import { useCreateBlockNote, createReactInlineContentSpec, createReactBlockSpec, SuggestionMenuController, getDefaultReactSlashMenuItems, SideMenu, SideMenuController, DragHandleMenu, RemoveBlockItem, useBlockNoteEditor, useComponentsContext, AddBlockButton } from '@blocknote/react';
import { BlockNoteView } from '@blocknote/mantine';
import { BlockNoteSchema, defaultInlineContentSpecs, defaultBlockSpecs, filterSuggestionItems, insertOrUpdateBlock, createBlockSpec } from '@blocknote/core';
import { createRoot } from 'react-dom/client';
import { TextSelection } from 'prosemirror-state';
import * as GameIcons from 'react-icons/gi';
import '@blocknote/mantine/style.css';
import * as Y from 'yjs';
import { WebsocketProvider } from 'y-websocket';
import JSZip from 'jszip';
import api from './api.js';
import { BookOpen, MagnifyingGlass as SearchIcon, Plus, Trash as Trash2, Gear as SettingsIcon, User, Users, Globe, Tag as TagIcon, X, CaretDown as ChevronDown, CaretRight as ChevronRight, PencilSimple as Pencil, Eye, ShareNetwork as Share2, DotsSixVertical as GripVertical, List as Menu, NotePencil, Crown, Lock, LockOpen, DotsThree, LinkSimple, Bell, ChatCircle, TextT, TextHOne, TextHTwo, TextHThree, ListBullets, ListNumbers, CheckSquare, Code as CodeIcon, Lightbulb, CopySimple, ClockCounterClockwise, TextB, TextItalic, TextUnderline, TextStrikethrough, TextIndent, TextOutdent, ArrowUp, ArrowDown, Scissors, ClipboardText, Quotes, Minus, Heart } from '@phosphor-icons/react';
const ROLE_INFO = { read: { label: 'Read', icon: Eye }, write: { label: 'Write', icon: Pencil }, manage: { label: 'Manage', icon: Crown } };
import EmojiPicker from 'emoji-picker-react';
import * as Phosphor from '@phosphor-icons/react';
const PH = {};
for (const [k, v] of Object.entries(Phosphor)) {
  if (/^[A-Z]/.test(k) && !/Icon$/.test(k) && !['IconBase', 'IconContext', 'SSR'].includes(k) && v && (typeof v === 'object' || typeof v === 'function')) PH[k] = v;
}
const PH_NAMES = Object.keys(PH);
const GI = {};
for (const [k, v] of Object.entries(GameIcons)) { if (k.startsWith('Gi') && typeof v === 'function') GI[k.slice(2)] = v; }
const GI_NAMES = Object.keys(GI);
const THEMES = [
  { id: 'amethyst', name: 'Amethyst', color: '#a78bdb' },
  { id: 'ocean', name: 'Ocean', color: '#6f9fe0' },
  { id: 'forest', name: 'Forest', color: '#5fc18a' },
  { id: 'slate', name: 'Slate', color: '#9aa6c0' },
  { id: 'rose', name: 'Rose', color: '#e08bb0' },
];
const applyTheme = (t) => document.documentElement.setAttribute('data-theme', t || 'amethyst');
const USER_COLORS = ['#a78bdb', '#6f9fe0', '#5fc18a', '#e08bb0', '#e1a845', '#ff5d52', '#9a6dd7', '#2fb3a8'];
const userColor = (id) => USER_COLORS[Math.abs(Number(id) || 0) % USER_COLORS.length];
function Logo({ size = 32 }) {
  // chunky pixel "N" — top-right pixel flown off
  const cells = [[0, 0], [0, 1], [0, 2], [0, 3], [3, 1], [3, 2], [3, 3], [1, 1], [2, 2]];
  const X = c => 1.5 + c * 7.5, Y = r => 1.5 + r * 7.5;
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="none" aria-hidden="true" style={{ flex: 'none' }}>
      {cells.map(([c, r], i) => <rect key={i} x={X(c)} y={Y(r)} width="6.5" height="6.5" rx="1.8" fill="var(--accent)" />)}
      <rect x="24.5" y="0.4" width="5.5" height="5.5" rx="1.6" fill="var(--accent-soft)" transform="rotate(18 27.25 3.15)" />
    </svg>
  );
}
const treeSig = (list) => (list || []).map(p => `${p.id}:${p.title}:${p.parent_id}:${p.position}:${p.icon}:${p.is_public}:${p.status}:${p.view}:${p.locked}:${p.list_cards}`).join('|');
const APP_VERSION = '1.2.0';
function PageIcon({ icon, size = 18 }) {
  if (icon && icon.startsWith('dot:')) { const c = icon.slice(4); return <span style={{ width: Math.round(size * 0.62), height: Math.round(size * 0.62), borderRadius: '50%', background: BOARD_COLORS[c] || c || 'var(--muted)', display: 'inline-block', flex: 'none' }} />; }
  if (icon && icon.startsWith('ph:')) { const p = icon.split(':'); const I = PH[p[1]]; if (I) return <I size={size} weight="fill" color={p[2] || undefined} />; }
  if (icon && icon.startsWith('gi:')) { const p = icon.split(':'); const I = GI[p[1]]; if (I) return <I size={size} color={p[2] || undefined} style={{ flex: 'none' }} />; }
  const emoji = icon && !icon.startsWith('ph:') && !icon.startsWith('gi:') && !icon.startsWith('li:') ? icon : '📄';
  return <span style={{ fontSize: size, lineHeight: 1 }}>{emoji}</span>;
}
function BoardGlyph({ size = 15 }) {
  return <svg width={size} height={size} viewBox="0 0 16 16" fill="currentColor" aria-hidden="true" style={{ flex: 'none' }}><rect x="1.5" y="2.5" width="3.4" height="11" rx="1.2" /><rect x="6.3" y="2.5" width="3.4" height="7.5" rx="1.2" /><rect x="11.1" y="2.5" width="3.4" height="9.3" rx="1.2" /></svg>;
}
// page reference inline content (#mention) + schema
// live registry so mention chips always show the page's CURRENT title/icon
const pageMetaStore = { map: new Map(), v: 0, subs: new Set() };
function feedPageMeta(pages) {
  pageMetaStore.map = new Map(pages.map(p => [p.id, (p.title || '') + '\u0000' + (p.icon || '')]));
  pageMetaStore.v++;
  pageMetaStore.subs.forEach(f => { try { f(); } catch {} });
}
function usePageLive(id) {
  return useSyncExternalStore(
    (cb) => { pageMetaStore.subs.add(cb); return () => pageMetaStore.subs.delete(cb); },
    () => pageMetaStore.map.get(id) ?? (pageMetaStore.v ? '__gone__' : null)
  );
}
const PageLink = createReactInlineContentSpec(
  { type: 'pageLink', propSchema: { pageId: { default: '' }, title: { default: '' }, icon: { default: '📄' } }, content: 'none' },
  { render: (props) => {
      const { pageId, title, icon } = props.inlineContent.props;
      const live = usePageLive(pageId);
      const gone = live === '__gone__';
      const [t, ic] = live && !gone ? live.split('\u0000') : [title, icon];
      return <span className={'page-mention' + (gone ? ' gone' : '')} data-page={pageId} title={gone ? 'This page was moved or deleted' : undefined}><PageIcon icon={ic || icon} size={18} /><span>{t || title || 'Untitled'}</span></span>;
    } }
);
const CALLOUT_COLORS = {
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
const Callout = createBlockSpec(
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
const ToggleBlock = createBlockSpec(
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
const QuoteBlock = createBlockSpec(
  { type: 'quote', propSchema: {}, content: 'inline' },
  { render: () => { const dom = document.createElement('blockquote'); dom.className = 'quote-blk'; return { dom, contentDOM: dom }; } }
);
const DividerBlock = createBlockSpec(
  { type: 'divider', propSchema: {}, content: 'none' },
  { render: () => { const dom = document.createElement('div'); dom.className = 'divider-blk'; dom.contentEditable = 'false'; dom.appendChild(document.createElement('hr')); return { dom }; } }
);
const schema = BlockNoteSchema.create({
  blockSpecs: { ...defaultBlockSpecs, callout: Callout, toggle: ToggleBlock, quote: QuoteBlock, divider: DividerBlock },
  inlineContentSpecs: { ...defaultInlineContentSpecs, pageLink: PageLink },
});

function IconPicker({ onPick, onClose }) {
  const [tab, setTab] = useState('emoji');
  const [q, setQ] = useState('');
  const [color, setColor] = useState('');
  const [iset, setIset] = useState('ph'); // ph = classic (Phosphor), gi = fantasy (Game Icons)
  const popRef = useRef(null);
  // one search across both tabs: mirror our query into the emoji picker's own field
  useEffect(() => {
    if (tab !== 'emoji') return;
    const inp = popRef.current?.querySelector('input.epr-search, .epr-search-container input');
    if (!inp) return;
    if (q && inp.value !== q) {
      const set = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      set.call(inp, q); inp.dispatchEvent(new Event('input', { bubbles: true }));
    }
    const h = (e) => setQ(e.target.value);
    inp.addEventListener('input', h);
    return () => inp.removeEventListener('input', h);
  }, [tab]);
  const results = useMemo(() => {
    const s = q.trim().toLowerCase();
    const names = iset === 'gi' ? GI_NAMES : PH_NAMES;
    return (s ? names.filter(n => n.toLowerCase().includes(s)) : names).slice(0, 220);
  }, [q, iset]);
  return (
    <>
      <div className="picker-overlay" onClick={e => { e.stopPropagation(); onClose(); }} />
      <div className="icon-pop" ref={popRef} onClick={e => e.stopPropagation()}>
        <div className="icon-tabs">
          <span className={tab === 'emoji' ? 'on' : ''} onClick={() => setTab('emoji')}>Emoji</span>
          <span className={tab === 'icons' ? 'on' : ''} onClick={() => setTab('icons')}>Icons</span>
          <span className="ip-rm" onClick={() => { onPick('📄'); onClose(); }}>Reset</span>
        </div>
        {tab === 'emoji'
          ? <EmojiPicker onEmojiClick={e => { onPick(e.emoji); onClose(); }} theme="dark" emojiStyle="native" width={352} height={358} previewConfig={{ showPreview: false }} skinTonesDisabled lazyLoadEmojis />
          : <div className="icon-tab">
              <input className="icon-search" autoFocus placeholder={`Search ${(iset === 'gi' ? GI_NAMES : PH_NAMES).length.toLocaleString()} ${iset === 'gi' ? 'fantasy' : 'classic'} icons…`} value={q} onChange={e => setQ(e.target.value)} />
              <div className="icon-colors">
                <span className={'iset-chip' + (iset === 'ph' ? ' on' : '')} onClick={() => setIset('ph')}>Classic</span>
                <span className={'iset-chip' + (iset === 'gi' ? ' on' : '')} onClick={() => setIset('gi')}>Fantasy</span>
                <span className="grow" />
                <span className={'cdot none' + (color === '' ? ' on' : '')} title="Default" onClick={() => setColor('')} />
                {TAG_COLORS.map(c => <span key={c} className={'cdot' + (c === color ? ' on' : '')} style={{ background: c }} onClick={() => setColor(c)} />)}
              </div>
              <div className="icon-grid">{results.map(name => { const I = iset === 'gi' ? GI[name] : PH[name]; return <button key={iset + name} title={name} onClick={() => { onPick(iset + ':' + name + (color ? ':' + color : '')); onClose(); }}>{iset === 'gi' ? <I size={22} color={color || undefined} /> : <I size={22} weight="fill" color={color || undefined} />}</button>; })}</div>
              {q && results.length === 0 && <div className="muted small pad">No icons match “{q}”</div>}
            </div>}
      </div>
    </>
  );
}

const parseJSON = (s, fb) => { try { const v = JSON.parse(s ?? ''); return v ?? fb; } catch { return fb; } };
const parseContent = (c) => { const a = parseJSON(c, null); return Array.isArray(a) && a.length ? a : undefined; };
// Notion palette (gray, brown, orange, yellow, green, blue, purple, pink, red) + 3 extra (teal, indigo, coral) — shared by tags & icons
const TAG_COLORS = ['#9b9a97', '#bb8264', '#e3902f', '#dfab01', '#4dab6d', '#3f9cdb', '#9a6dd7', '#e255a1', '#ff5d52', '#2fb3a8', '#6d77e0', '#ff8a4c'];
const tagColor = (t) => TAG_COLORS[[...String(t)].reduce((a, c) => a + c.charCodeAt(0), 0) % TAG_COLORS.length];
const normTags = (arr) => (Array.isArray(arr) ? arr : []).map(t => typeof t === 'string' ? { name: t, color: tagColor(t) } : t).filter(t => t && t.name);

function Avatar({ user, size = 24 }) {
  const ch = (user?.name || user?.email || '?').trim().slice(0, 1).toUpperCase();
  return user?.avatar
    ? <img className="avatar" src={user.avatar} alt="" style={{ width: size, height: size }} />
    : <span className="avatar ph" style={{ width: size, height: size, fontSize: size * 0.46 }}>{ch}</span>;
}

function fileToAvatar(file) {
  return new Promise((resolve) => {
    const r = new FileReader();
    r.onload = () => { const img = new Image(); img.onload = () => {
      const s = 160, c = document.createElement('canvas'); c.width = s; c.height = s;
      const x = c.getContext('2d'); const m = Math.min(img.width, img.height);
      x.drawImage(img, (img.width - m) / 2, (img.height - m) / 2, m, m, 0, 0, s, s);
      resolve(c.toDataURL('image/jpeg', 0.85));
    }; img.src = r.result; };
    r.readAsDataURL(file);
  });
}
function fileToCover(file) {
  return new Promise((resolve) => {
    const r = new FileReader();
    r.onload = () => { const img = new Image(); img.onload = () => {
      const maxW = 1600; const scale = Math.min(1, maxW / img.width);
      const w = Math.round(img.width * scale), h = Math.round(img.height * scale);
      const c = document.createElement('canvas'); c.width = w; c.height = h;
      c.getContext('2d').drawImage(img, 0, 0, w, h);
      resolve(c.toDataURL('image/jpeg', 0.82));
    }; img.src = r.result; };
    r.readAsDataURL(file);
  });
}

// ---------- public read-only ----------
// ---------- confirm modal (replaces window.confirm) ----------
const ConfirmCtx = React.createContext(async () => true);
const useConfirm = () => React.useContext(ConfirmCtx);
function ConfirmProvider({ children }) {
  const [st, setSt] = useState(null);
  const confirm = (message, opts = {}) => new Promise(resolve => setSt({ message, resolve, ...opts }));
  const close = (val) => { if (st) st.resolve(val); setSt(null); };
  return (
    <ConfirmCtx.Provider value={confirm}>
      {children}
      {st && <div className="modal-bg" onClick={() => close(false)}>
        <div className="card confirm-modal" onClick={e => e.stopPropagation()}>
          {st.title && <div className="cm-title">{st.title}</div>}
          <div className="cm-msg">{st.message}</div>
          <div className="cm-actions">
            <button className="btn-soft" onClick={() => close(false)}>{st.cancelLabel || 'Cancel'}</button>
            <button className={st.danger ? 'btn-danger' : 'btn-gold'} onClick={() => close(true)}>{st.confirmLabel || 'Confirm'}</button>
          </div>
        </div>
      </div>}
    </ConfirmCtx.Provider>
  );
}

// ---------- new workspace modal ----------
function NewWorkspaceModal({ onCreate, onClose }) {
  const [name, setName] = useState('');
  const [icon, setIcon] = useState('ph:BookOpen');
  const [picker, setPicker] = useState(false);
  const [busy, setBusy] = useState(false);
  const create = async () => { if (!name.trim() || busy) return; setBusy(true); try { await onCreate({ name: name.trim(), icon }); } finally { setBusy(false); } };
  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="card ws-modal" onClick={e => e.stopPropagation()}>
        <div className="share-head"><b>New workspace</b><X size={18} className="x" onClick={onClose} /></div>
        <div className="ws-modal-top">
          <span className="ws-modal-icon" onClick={() => setPicker(v => !v)} style={{ position: 'relative' }}>
            <PageIcon icon={icon} size={40} />
            {picker && <IconPicker onPick={(v) => { setIcon(v); setPicker(false); }} onClose={() => setPicker(false)} />}
          </span>
          <input autoFocus placeholder="Workspace name" value={name} onChange={e => setName(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') create(); }} />
        </div>
        <div className="muted small">Click the icon to choose a logo — rename or change it anytime.</div>
        <button className="btn-gold" disabled={busy || !name.trim()} onClick={create}>{busy ? 'Creating…' : 'Create workspace'}</button>
      </div>
    </div>
  );
}

function PublicView({ id }) {
  const [page, setPage] = useState(undefined);
  useEffect(() => {
    let alive = true;
    const load = () => api('/public/' + id).then(d => { if (alive) setPage(d); }).catch(() => { if (alive) setPage(p => p === undefined ? null : p); });
    load();
    const t = setInterval(load, 20000);
    const onVis = () => { if (document.visibilityState === 'visible') load(); };
    document.addEventListener('visibilitychange', onVis);
    return () => { alive = false; clearInterval(t); document.removeEventListener('visibilitychange', onVis); };
  }, [id]);
  if (page === undefined) return <div className="center muted">Loading…</div>;
  if (page === null) return <div className="center muted">This page isn’t public.</div>;
  const isBoard = page.view === 'board';
  return (
    <div className="public-wrap">
      {page.crumbs && page.crumbs.length > 0 && <div className="public-bar">
        <div className="crumbs-trail">
          {page.crumbs.map((c, i) => <a className="crumb" key={c.id} href={'/p/' + c.id}>{i > 0 && <ChevronRight size={13} className="cr-sep" />}<PageIcon icon={c.icon} size={14} /><span className="cr-txt">{c.title || 'Untitled'}</span></a>)}
          <ChevronRight size={13} className="cr-sep" /><span className="crumb cur"><PageIcon icon={page.icon} size={14} /><span className="cr-txt">{page.title || 'Untitled'}</span></span>
        </div>
      </div>}
      {page.cover && <div className="cover" style={{ backgroundImage: `url(${page.cover})` }} />}
      <div className={'public-doc' + (isBoard ? ' board-view' : '')}>
        <div className="page-title-row"><span className="page-icon"><PageIcon icon={page.icon} size={48} /></span><h1>{page.title}</h1></div>
        {isBoard && page.description ? <div className="board-desc-text pub">{page.description}</div> : null}
        {isBoard ? <PublicBoard page={page} /> : <ReadOnly content={page.content} />}
      </div>
      <a className="public-foot row gap" href="/"><Logo size={15} /> NoteBit</a>
    </div>
  );
}
function PublicBoard({ page }) {
  const cols = page.columns || [];
  return (
    <div className="board">
      {cols.map(col => (
        <div key={col.id} className="bcol">
          <div className="bcol-head"><span className="bdot" style={{ background: BOARD_COLORS[col.color] || BOARD_COLORS.gray }} /><span className="bcol-name">{col.name}</span><span className="bcol-count">{(col.cards || []).length}</span></div>
          <div className="bcards">{(col.cards || []).map(c => <a key={c.id} className="bcard" href={'/p/' + c.id}><PageIcon icon={c.icon} size={16} /><span className="bcard-t">{c.title || 'Untitled'}</span></a>)}</div>
        </div>
      ))}
    </div>
  );
}
function ReadOnly({ content }) {
  const editor = useCreateBlockNote({ schema, initialContent: useMemo(() => parseContent(content), []) });
  return <BlockNoteView editor={editor} editable={false} theme="dark" />;
}

// ---------- login ----------
function Login({ onAuth, ws }) {
  const [mode, setMode] = useState('login');
  const [cfg, setCfg] = useState({ allowSignup: true, hasUsers: true });
  const [f, setF] = useState({ email: '', password: '', name: '' });
  const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  useEffect(() => { api('/config').then(c => { setCfg(c); if (!c.hasUsers) setMode('register'); }).catch(() => {}); }, []);
  const first = !cfg.hasUsers;
  const submit = async (e) => { e.preventDefault(); setErr(''); setBusy(true);
    try { onAuth(await api('/auth/' + mode, { method: 'POST', body: f })); }
    catch (e) { setErr(e.data?.error || 'Something went wrong'); } finally { setBusy(false); } };
  return (
    <div className="center bg-grid">
      <form className="card login" onSubmit={submit}>
        <div className="brand big logo"><Logo size={36} /> <span>NoteBit</span></div>
        <p className="muted sub">{first ? 'Create the first (admin) account' : mode === 'login' ? 'Sign in to your workspace' : 'Create your account'}</p>
        {mode === 'register' && <input placeholder="Display name" value={f.name} onChange={e => setF({ ...f, name: e.target.value })} />}
        <input placeholder="Email" type="email" value={f.email} onChange={e => setF({ ...f, email: e.target.value })} autoFocus required />
        <input placeholder="Password" type="password" value={f.password} onChange={e => setF({ ...f, password: e.target.value })} required />
        {err && <div className="err">{err}</div>}
        <button className="btn-gold" disabled={busy}>{busy ? '…' : mode === 'login' ? 'Sign in' : first ? 'Create admin' : 'Sign up'}</button>
        {!first && cfg.allowSignup && <div className="switch" onClick={() => { setMode(mode === 'login' ? 'register' : 'login'); setErr(''); }}>
          {mode === 'login' ? 'Need an account? Sign up' : 'Have an account? Sign in'}</div>}
        <div className="login-ver">NoteBit v{APP_VERSION} · <a href="https://github.com/GroyalCodes/notebit" target="_blank" rel="noreferrer">open source</a> · <a href="https://notebit.org" target="_blank" rel="noreferrer">cloud</a></div>
      </form>
    </div>
  );
}

// ---------- sidebar tree — pointer-based drag & drop ----------
function Tree({ pages, currentId, onOpen, onNew, onDelete, onMove, onLink, canManage, collapsedInit, onCollapse }) {
  const [over, setOver] = useState(null);          // { id, zone } drop indicator
  const [drag, setDrag] = useState(null);          // page being dragged (floating preview)
  const [pos, setPos] = useState({ x: 0, y: 0 });
  const [collapsed, setCollapsed] = useState(() => new Set(collapsedInit || []));
  const di = useRef(null);                          // { id, startX, startY, active }
  const overRef = useRef(null);
  const draggedRef = useRef(false);
  const pagesRef = useRef(pages); pagesRef.current = pages;
  const onMoveRef = useRef(onMove); onMoveRef.current = onMove;
  const onLinkRef = useRef(onLink); onLinkRef.current = onLink;
  const canManageRef = useRef(canManage); canManageRef.current = canManage;

  const byParent = useMemo(() => {
    const ids = new Set(pages.map(p => p.id));
    const m = {};
    for (const p of pages) {
      const par = p.parent_id && ids.has(p.parent_id) ? p.parent_id : '__root';
      (m[par] ||= []).push(p);
    }
    return m;
  }, [pages]);
  const isDescendant = (anc, node) => { const bid = Object.fromEntries(pagesRef.current.map(p => [p.id, p])); let cur = node; while (cur) { if (cur === anc) return true; cur = bid[cur]?.parent_id; } return false; };
  const setOv = v => { overRef.current = v; setOver(v); };
  const toggle = id => setCollapsed(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); onCollapse?.([...n]); return n; });

  useEffect(() => {
    const mm = e => {
      const d = di.current; if (!d) return;
      if (!d.active) {
        if (Math.abs(e.clientX - d.startX) + Math.abs(e.clientY - d.startY) < 5) return;
        d.active = true; setDrag(pagesRef.current.find(p => p.id === d.id)); document.body.style.userSelect = 'none'; document.body.style.cursor = 'grabbing';
      }
      setPos({ x: e.clientX, y: e.clientY });
      const row = document.elementFromPoint(e.clientX, e.clientY)?.closest?.('.tree-row');
      const id = row?.getAttribute?.('data-id');
      if (id && id !== d.id && !isDescendant(d.id, id)) {
        const r = row.getBoundingClientRect(); const y = (e.clientY - r.top) / r.height;
        let zone = y < 0.25 ? 'before' : y > 0.75 ? 'after' : 'inside';
        const tgt = pagesRef.current.find(pp => pp.id === id);
        if (zone === 'inside' && tgt?.locked && !canManageRef.current) zone = y < 0.5 ? 'before' : 'after'; // can't nest into a locked section
        setOv({ id, zone });
      } else setOv(null);
    };
    const mu = (e) => {
      const d = di.current, o = overRef.current;
      if (d?.active) {
        draggedRef.current = true; setTimeout(() => { draggedRef.current = false; }, 60);
        if (o) onMoveRef.current(d.id, o.id, o.zone);
        else { const ed = document.elementFromPoint(e.clientX, e.clientY)?.closest?.('.bn-editor, .ProseMirror'); if (ed && onLinkRef.current) onLinkRef.current(d.id, e.clientX, e.clientY); }
      }
      di.current = null; overRef.current = null; setDrag(null); setOver(null);
      document.body.style.userSelect = ''; document.body.style.cursor = '';
    };
    document.addEventListener('mousemove', mm);
    document.addEventListener('mouseup', mu);
    return () => { document.removeEventListener('mousemove', mm); document.removeEventListener('mouseup', mu); document.body.style.userSelect = ''; document.body.style.cursor = ''; };
  }, []);

  const renderNode = (p, depth) => {
    const kids = byParent[p.id] || [];
    const open = !collapsed.has(p.id);
    const dz = over?.id === p.id ? over.zone : null;
    return (
      <div key={p.id}>
        <div
          className={'tree-row' + (p.id === currentId ? ' active' : '') + (dz === 'inside' ? ' drop-in' : '')}
          data-id={p.id}
          style={{ paddingLeft: 6 + depth * 13 }}
          onMouseDown={e => { if (e.button !== 0 || e.target.closest('button, .twist')) return; di.current = { id: p.id, startX: e.clientX, startY: e.clientY, active: false }; }}
        >
          {dz === 'before' && <span className="drop-line top" />}
          {dz === 'after' && <span className="drop-line bot" />}
          <span className="grip"><GripVertical size={12} /></span>
          <span className="twist" onClick={() => toggle(p.id)}>{kids.length ? (open ? <ChevronDown size={12} /> : <ChevronRight size={12} />) : ''}</span>
          <span className="tree-label" onClick={() => { if (draggedRef.current) return; onOpen(p.id); }}><span className="ic"><PageIcon icon={p.icon} size={17} /></span>{p.view === 'board' && <span className="tree-bglyph" title="Board" style={{ color: (p.icon || '').split(':')[2] || undefined }}><BoardGlyph size={11} /></span>}<span className="tl-text">{p.title || 'Untitled'}</span></span>
          {canManage && <span className="row-actions" onMouseDown={e => e.stopPropagation()}>
            <button title="New subpage" onClick={e => { e.stopPropagation(); onNew(p.id); }}><Plus size={13} /></button>
            <button title="Delete" onClick={e => { e.stopPropagation(); onDelete(p.id); }}><Trash2 size={12} /></button>
          </span>}
        </div>
        {open && kids.map(k => renderNode(k, depth + 1))}
      </div>
    );
  };
  return (
    <>
      <div className="tree">{(byParent['__root'] || []).map(p => renderNode(p, 0))}</div>
      {drag && <div className="drag-ghost" style={{ left: pos.x + 14, top: pos.y + 6 }}><PageIcon icon={drag.icon} size={14} /><span>{drag.title || 'Untitled'}</span></div>}
    </>
  );
}

// ---------- page properties (collapsible, Notion-style) + tag colors ----------
function Tags({ tags, editable, workspace, onChange, onTagClick }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [all, setAll] = useState([]);
  const [color, setColor] = useState(null);
  const [hi, setHi] = useState(0);
  const [pos, setPos] = useState({ x: 0, y: 0 });
  const anchorRef = useRef(null);
  useEffect(() => { if (open) api('/tags' + (workspace ? '?workspace=' + workspace : '')).then(setAll).catch(() => {}); else { setQ(''); setColor(null); } }, [open]);
  useEffect(() => { setHi(0); }, [q]);
  const names = new Set(tags.map(t => t.name.toLowerCase()));
  const ql = q.trim().toLowerCase();
  const matches = all.filter(t => !names.has(t.name.toLowerCase()) && t.name.toLowerCase().includes(ql));
  const exact = matches.find(t => t.name.toLowerCase() === ql) || tags.find(t => t.name.toLowerCase() === ql);
  const showCreate = !!ql && !exact;
  const opts = [...matches, ...(showCreate ? [{ create: true }] : [])];
  const newColor = color || tagColor(q.trim() || 'tag');
  const add = (name, c) => { name = String(name).trim(); if (name && !names.has(name.toLowerCase())) onChange([...tags, { name, color: c || tagColor(name) }]); setQ(''); setColor(null); };
  const remove = (name) => onChange(tags.filter(t => t.name !== name));
  const choose = (o) => { if (!o) return; o.create ? add(q.trim(), newColor) : add(o.name, o.color); };
  return (
    <div className="tags">
      {tags.map(t => <span className={'tag' + (onTagClick ? ' clickable' : '')} key={t.name} style={{ '--tc': t.color || tagColor(t.name) }} onClick={() => onTagClick && onTagClick(t.name, t.color)}>{t.name}{editable && <X size={11} className="tx" onClick={e => { e.stopPropagation(); remove(t.name); }} />}</span>)}
      {editable && <span style={{ position: 'relative' }} ref={anchorRef}>
        <span className="tag add" onClick={() => { if (!open && anchorRef.current) { const r = anchorRef.current.getBoundingClientRect(); setPos({ x: Math.min(r.left, window.innerWidth - 246), y: Math.min(r.bottom + 6, window.innerHeight - 320) }); } setOpen(v => !v); }}><Plus size={12} /> Tag</span>
        {open && createPortal(<>
          <div className="picker-overlay" onClick={e => { e.stopPropagation(); setOpen(false); }} />
          <div className="tag-pop portal" style={{ left: pos.x, top: pos.y }}>
            <input autoFocus value={q} onChange={e => setQ(e.target.value)} placeholder="Search or create a tag…" onKeyDown={e => {
              if (e.key === 'ArrowDown') { e.preventDefault(); setHi(h => Math.min(h + 1, opts.length - 1)); }
              else if (e.key === 'ArrowUp') { e.preventDefault(); setHi(h => Math.max(0, h - 1)); }
              else if (e.key === 'Enter') { e.preventDefault(); choose(opts[hi] || (showCreate ? { create: true } : null)); }
              else if (e.key === 'Escape') setOpen(false);
            }} />
            {showCreate && <div className="swatches tag-sw" style={{ gridTemplateColumns: 'repeat(6, 1fr)' }}>{TAG_COLORS.map(c => <span key={c} className={'swatch' + (newColor === c ? ' on' : '')} style={{ background: c }} onClick={() => setColor(c)} />)}</div>}
            <div className="tag-options">
              {opts.map((o, i) => o.create
                ? <div key="__create" className={'tag-opt create' + (hi === i ? ' hi' : '')} onMouseEnter={() => setHi(i)} onClick={() => choose(o)}>Create <span className="tag" style={{ '--tc': newColor }}>{q.trim()}</span></div>
                : <div key={o.name} className={'tag-opt' + (hi === i ? ' hi' : '')} onMouseEnter={() => setHi(i)} onClick={() => choose(o)}><span className="tag" style={{ '--tc': o.color || tagColor(o.name) }}>{o.name}</span></div>)}
              {!opts.length && <div className="muted small tag-empty">{ql ? 'Press Enter to create' : 'Type to search or create a tag'}</div>}
            </div>
          </div>
        </>, document.body)}
      </span>}
    </div>
  );
}
function Properties({ tags, editable, workspace, onChange, onTagClick }) {
  const [open, setOpen] = useState(true);
  const has = (tags || []).length > 0;
  if (!has && !editable) return null;
  return (
    <div className={'props' + (has ? '' : ' empty')}>
      <span className="props-toggle" onClick={() => setOpen(!open)}>{open ? <ChevronDown size={12} /> : <ChevronRight size={12} />} Properties</span>
      {open && <div className="prop-row"><span className="prop-key"><TagIcon size={13} /> Tags</span><Tags tags={tags} editable={editable} workspace={workspace} onChange={onChange} onTagClick={onTagClick} /></div>}
    </div>
  );
}

// ---------- editor ----------
const TURN_INTO = [
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
const stripIds = (b) => ({ ...b, id: undefined, children: (b.children || []).map(stripIds) });
function TurnIntoMenu(props) {
  const editor = useBlockNoteEditor();
  const Components = useComponentsContext();
  const turn = (t, p) => { try { editor.updateBlock(props.block, { type: t, props: p }); } catch {} };
  const dup = () => { try { editor.insertBlocks([stripIds(props.block)], props.block, 'after'); } catch {} };
  const leaf = (it) => (
    <Components.Generic.Menu.Item key={it.label} onClick={() => turn(it.type, it.props)}><it.icon size={15} /> {it.label}</Components.Generic.Menu.Item>
  );
  return (
    <DragHandleMenu {...props}>
      <div className="tim">
        <Components.Generic.Menu.Label>Turn into</Components.Generic.Menu.Label>
        {TURN_INTO.map(it => it.sub ? (
          <div className="tim-parent" key={it.label}>
            <span className="tim-row"><it.icon size={15} /> {it.label}</span>
            <ChevronRight size={12} className="tim-caret" />
            <div className="tim-sub">{it.sub.map(leaf)}</div>
          </div>
        ) : leaf(it))}
        <Components.Generic.Menu.Divider />
        <Components.Generic.Menu.Item onClick={dup}><CopySimple size={15} /> Duplicate</Components.Generic.Menu.Item>
        <RemoveBlockItem {...props}><span className="tim-danger"><Trash2 size={15} /> Delete</span></RemoveBlockItem>
      </div>
    </DragHandleMenu>
  );
}
// custom drag handle: identical to BlockNote's, but the dropdown's TOP aligns with the
// handle (left-start) instead of being vertically centered on it
function DragHandle(p) {
  const Components = useComponentsContext();
  return (
    <Components.Generic.Menu.Root onOpenChange={(o) => { o ? p.freezeMenu() : p.unfreezeMenu(); }} position="left-start">
      <Components.Generic.Menu.Trigger>
        <Components.SideMenu.Button label="Open block menu" draggable={true} onDragStart={(e) => p.blockDragStart(e, p.block)} onDragEnd={p.blockDragEnd} className="bn-button" icon={<GripVertical size={24} />} />
      </Components.Generic.Menu.Trigger>
      <TurnIntoMenu block={p.block} />
    </Components.Generic.Menu.Root>
  );
}
const looksLikeMarkdown = (t) =>
  /^#{1,6}\s/m.test(t) || /^\s*[-*+]\s+\S/m.test(t) || /^\s*\d+\.\s+\S/m.test(t) ||
  /^\s*>\s/m.test(t) || /^\s*([-*_])(\s*\1){2,}\s*$/m.test(t) || /\*\*[^*\n]+\*\*/.test(t) ||
  /\[[^\]]+\]\([^)\s]+\)/.test(t);
function Editor({ page, editable, pages, onChange, insertRef, me }) {
  const { ydoc, provider } = useMemo(() => {
    const ydoc = new Y.Doc();
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const provider = new WebsocketProvider(`${proto}://${location.host}/collab`, page.id, ydoc);
    return { ydoc, provider };
  }, [page.id]);
  useEffect(() => () => { provider.destroy(); ydoc.destroy(); }, [provider, ydoc]);
  const editor = useCreateBlockNote({
    schema,
    collaboration: { provider, fragment: ydoc.getXmlFragment('document'), user: { name: me?.name || me?.email || 'Someone', color: userColor(me?.id) } },
    pasteHandler: ({ event, editor, defaultPasteHandler }) => {
      try {
        // rich clipboard data (copied blocks, HTML from other apps) always takes the
        // native path; only bare plain text gets the markdown treatment
        const types = Array.from(event.clipboardData?.types || []);
        if (types.includes('blocknote/html') || types.includes('text/html')) return defaultPasteHandler();
        const text = event.clipboardData?.getData('text/plain');
        if (text && looksLikeMarkdown(text)) {
          editor.tryParseMarkdownToBlocks(text).then(blocks => {
            blocks = (blocks || []).filter(Boolean).filter(b => !(b.type === 'paragraph' && (!b.content || b.content.length === 0)));
            if (!blocks.length) return;
            const ref = editor.getTextCursorPosition?.().block || editor.document[editor.document.length - 1];
            const empty = ref && (!ref.content || (Array.isArray(ref.content) && ref.content.length === 0));
            const res = empty ? editor.replaceBlocks([ref], blocks) : editor.insertBlocks(blocks, ref, 'after');
            try { const ins = res?.insertedBlocks || blocks; const lb = ins[ins.length - 1]; if (lb?.id) editor.setTextCursorPosition(lb.id, 'end'); } catch {}
          }).catch(() => {});
          return true;
        }
      } catch {}
      return defaultPasteHandler();
    },
  });
  useEffect(() => {
    const initial = parseContent(page.content);
    const seed = () => {
      if (!initial || !initial.length) return;
      const meta = ydoc.getMap('_meta');
      const doc = editor.document;
      const empty = doc.length === 0 || (doc.length === 1 && doc[0].type === 'paragraph' && (!doc[0].content || doc[0].content.length === 0));
      if (empty && !meta.get('seeded')) { try { editor.replaceBlocks(editor.document, initial); meta.set('seeded', true); } catch {} }
    };
    const onSync = (s) => { if (s) seed(); };
    if (provider.synced) seed(); else provider.on('sync', onSync);
    return () => { try { provider.off('sync', onSync); } catch {} };
  }, [provider, editor, ydoc]);
  useEffect(() => {
    if (!insertRef) return;
    insertRef.current = (p, x, y) => {
      if (!editor.isEditable) return;
      const blockEl = document.elementFromPoint(x, y)?.closest?.('[data-id]');
      const blockId = blockEl?.getAttribute('data-id');
      try { if (blockId) editor.setTextCursorPosition(blockId, 'end'); editor.focus(); } catch {}
      editor.insertInlineContent([{ type: 'pageLink', props: { pageId: p.id, title: p.title || 'Untitled', icon: p.icon || '📄' } }, ' ']);
    };
    return () => { insertRef.current = null; };
  }, [editor, insertRef]);
  const pageItems = async (query) =>
    (pages || []).filter(p => p.id !== page.id && (p.title || 'Untitled').toLowerCase().includes((query || '').toLowerCase())).slice(0, 12).map(p => ({
      title: p.title || 'Untitled',
      icon: <PageIcon icon={p.icon} size={15} />,
      onItemClick: () => editor.insertInlineContent([{ type: 'pageLink', props: { pageId: p.id, title: p.title || 'Untitled', icon: p.icon || '📄' } }, ' ']),
    }));
  const wrapRef = useRef(null);
  const dragRef = useRef(null);
  // Handle-drags are moved by US, not ProseMirror. PM's native drop picks the deepest
  // slot and will split a paragraph mid-text (leaving a blank block) or nest into
  // neighbors. On drop we cancel PM entirely and do a clean structural move: the
  // dragged block(s) become siblings of the block nearest the drop point. Tab nests.
  useEffect(() => {
    const contentRect = (el) => (el.querySelector(':scope > .bn-block > .bn-block-content') || el.querySelector('.bn-block-content') || el).getBoundingClientRect();
    const onDragStart = (e) => {
      try {
        const ed = wrapRef.current; if (!ed || !ed.contains(e.target)) return;
        if (dragRef.current?.handle) return;                  // handle recorder already ran
        const blocks = editor.getSelection()?.blocks;
        if (!blocks || blocks.length < 2) return;             // inline text drags stay native
        dragRef.current = { ids: blocks.map(b => b.id), handle: false };
      } catch {}
    };
    const onDrop = (e) => {
      const d = dragRef.current;
      if (!d || e.synthetic) return;
      if (!e.dataTransfer?.types?.includes('blocknote/html')) return;
      dragRef.current = null;
      const wrap = wrapRef.current; if (!wrap) return;
      e.preventDefault(); e.stopPropagation();
      // PM never sees this drop, so its drop-cursor line would linger: clear it now
      try { editor.prosemirrorView?.dom?.dispatchEvent(new DragEvent('dragend', { bubbles: false })); } catch {}
      // handle-drags keep the pointer LEFT of the text column, so accept drops anywhere
      // over the page; only real app chrome cancels the move
      if (e.target.closest?.('.sidebar, .clog, .inbox-pop, .search-box, .card')) return;
      try {
        const dropY = e.clientY;
        const dragSet = new Set(d.ids);
        const inDragSubtree = (el) => { let a = el; while (a) { if (dragSet.has(a.getAttribute?.('data-id'))) return true; a = a.parentElement?.closest?.('[data-id]'); } return false; };
        const cands = [];
        wrap.querySelectorAll('.bn-editor [data-id]').forEach(el => { if (!inDragSubtree(el)) cands.push({ el, r: contentRect(el) }); });
        if (!cands.length) return;
        // seam: after the last block whose row center is above the pointer (stable +
        // predictable), else before the first
        let ref = null, place = 'after';
        for (const cd of cands) if ((cd.r.top + cd.r.bottom) / 2 < dropY) ref = cd;
        if (!ref) { ref = cands[0]; place = 'before'; }
        // at a subtree end, "after inner item" and "after its parent" are the same line;
        // pick the depth whose indent is closest to the pointer X (Notion behavior)
        if (place === 'after') {
          const parentOf = (el) => el.parentElement?.closest?.('[data-id]');
          const isLastChild = (el) => { let s = el.nextElementSibling; while (s && !(s.nodeType === 1 && s.hasAttribute('data-id'))) s = s.nextElementSibling; return !s; };
          let el = ref.el;
          while (true) {
            const par = parentOf(el);
            if (!par || !isLastChild(el) || inDragSubtree(par)) break;
            if (Math.abs(contentRect(par).left - e.clientX) < Math.abs(contentRect(el).left - e.clientX)) el = par; else break;
          }
          ref = { el, r: contentRect(el) };
        }
        const refId = ref.el.getAttribute('data-id');
        const blocks = d.ids.map(id => editor.getBlock(id)).filter(Boolean);
        if (!blocks.length) return;
        editor.removeBlocks(d.ids);
        editor.insertBlocks(blocks, refId, place);
        if (d.ids.length > 1) editor.setSelection(d.ids[0], d.ids[d.ids.length - 1]);
        else editor.setTextCursorPosition(d.ids[0], 'end');
        editor.focus();
      } catch {}
    };
    const onDragEnd = () => setTimeout(() => { dragRef.current = null; }, 300);
    window.addEventListener('dragstart', onDragStart, true);
    window.addEventListener('drop', onDrop, true);
    window.addEventListener('dragend', onDragEnd, true);
    return () => { window.removeEventListener('dragstart', onDragStart, true); window.removeEventListener('drop', onDrop, true); window.removeEventListener('dragend', onDragEnd, true); };
  }, [editor]);
  // hover tint via a floating overlay OUTSIDE the editor DOM. Never mutate classes on
  // ProseMirror-managed nodes: PM's mutation observer re-syncs on any change inside the
  // editor and stomps the selection (broke click-to-place-caret, froze big pages).
  const hlRef = useRef(null);
  const hlLockRef = useRef(false);
  const placeHl = (el, strong) => {
    const root = wrapRef.current, ov = hlRef.current; if (!root || !ov) return;
    if (!el) { ov.style.display = 'none'; ov.classList.remove('strong'); return; }
    const c = el.querySelector(':scope > .bn-block > .bn-block-content') || el.querySelector('.bn-block-content') || el;
    const r = c.getBoundingClientRect(), wr = root.getBoundingClientRect();
    ov.classList.toggle('strong', !!strong);
    ov.style.display = 'block';
    // inset vertically so adjacent rows keep a visible gap; pad horizontally for breathing room
    ov.style.left = (r.left - wr.left - 5) + 'px';
    ov.style.top = (r.top - wr.top + 1.5) + 'px';
    ov.style.width = (r.width + 10) + 'px';
    ov.style.height = (r.height - 3) + 'px';
  };
  const hlRoRef = useRef(null);
  useEffect(() => {
    const root = wrapRef.current; if (!root) return;
    let cur = null;
    // live re-measure: the box grows/shrinks as the hovered block changes height
    // (Shift+Enter, typing wraps). Observing is safe; mutating editor DOM is not.
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => {
      const lock = hlLockRef.current;
      if (lock && lock !== true) placeHl(lock, true);
      else if (cur) placeHl(cur, false);
    }) : null;
    hlRoRef.current = ro;
    const over = (e) => {
      const el = e.target.closest?.('[data-id]');
      if (el === cur) return;
      cur = el;
      ro?.disconnect();
      if (el) ro?.observe(el);
      if (!hlLockRef.current) placeHl(el, false);
    };
    const out = () => { cur = null; ro?.disconnect(); if (!hlLockRef.current) placeHl(null); };
    const onScroll = () => { if (!hlLockRef.current) placeHl(null); };
    root.addEventListener('mouseover', over);
    root.addEventListener('mouseleave', out);
    document.addEventListener('scroll', onScroll, true);
    return () => { ro?.disconnect(); root.removeEventListener('mouseover', over); root.removeEventListener('mouseleave', out); document.removeEventListener('scroll', onScroll, true); };
  }, []);
  // minimal code-block chrome: add a copy button next to the language picker
  useEffect(() => {
    const root = wrapRef.current; if (!root) return;
    const ensure = () => {
      root.querySelectorAll('.bn-block-content[data-content-type="codeBlock"]').forEach(cb => {
        const bar = cb.querySelector(':scope > div');
        if (!bar || bar.querySelector('.code-copy')) return;
        const btn = document.createElement('button');
        btn.className = 'code-copy'; btn.type = 'button'; btn.title = 'Copy code';
        const ic = '<svg width="13" height="13" viewBox="0 0 256 256" fill="currentColor"><path d="M216,32H88a8,8,0,0,0-8,8V80H40a8,8,0,0,0-8,8V216a8,8,0,0,0,8,8H168a8,8,0,0,0,8-8V176h40a8,8,0,0,0,8-8V40A8,8,0,0,0,216,32ZM160,208H48V96H160Zm48-48H176V88a8,8,0,0,0-8-8H96V48H208Z"></path></svg>';
        btn.innerHTML = ic + '<span>Copy</span>';
        btn.onclick = (ev) => {
          ev.preventDefault(); ev.stopPropagation();
          navigator.clipboard?.writeText(cb.querySelector('pre')?.textContent || '').then(() => {
            btn.classList.add('ok'); btn.innerHTML = ic + '<span>Copied</span>';
            setTimeout(() => { btn.classList.remove('ok'); btn.innerHTML = ic + '<span>Copy</span>'; }, 1400);
          }).catch(() => {});
        };
        bar.appendChild(btn);
      });
    };
    ensure();
    let raf = 0;
    const mo = new MutationObserver(() => { cancelAnimationFrame(raf); raf = requestAnimationFrame(ensure); });
    mo.observe(root, { childList: true, subtree: true });
    return () => { mo.disconnect(); cancelAnimationFrame(raf); };
  }, [editor]);
  // Notion-style box selection: drag from the background (gutters or blank space below
  // the doc) to select whole blocks; release sets a real block selection, so native
  // shortcuts apply (Mod+Shift+Up/Down moves the selection, Backspace deletes, Cmd+C copies)
  const [box, setBox] = useState(null);
  const marqueeRef = useRef(false);
  const marqueeSelRef = useRef(null);
  const startBox = (e) => {
    if (!editor.isEditable || e.button !== 0) return;
    const wrap = wrapRef.current; if (!wrap) return;
    const docEl = wrap.closest('.doc');
    const isWrap = e.target === wrap || e.target === docEl; // gutters + page margins
    const isBlank = e.target.classList?.contains('bn-editor') && (() => {
      const doc = editor.document; const last = doc[doc.length - 1];
      const el = last && wrap.querySelector(`[data-id="${last.id}"]`);
      return el ? e.clientY > el.getBoundingClientRect().bottom : true;
    })();
    if (!isWrap && !isBlank) return;
    if (isBlank) e.preventDefault();
    const wr = wrap.getBoundingClientRect();
    const sx = e.clientX, sy = e.clientY; let active = false;
    let hits = []; // hit tint drawn in an overlay layer, never as classes on editor DOM
    const tops = () => Array.from(wrap.querySelectorAll('.bn-editor > .bn-block-group > .bn-block-outer'));
    const move = (ev) => {
      if (!active && Math.hypot(ev.clientX - sx, ev.clientY - sy) < 5) return;
      active = true; marqueeRef.current = true;
      const x1 = Math.min(sx, ev.clientX), x2 = Math.max(sx, ev.clientX), y1 = Math.min(sy, ev.clientY), y2 = Math.max(sy, ev.clientY);
      setBox({ l: x1 - wr.left, t: y1 - wr.top, w: x2 - x1, h: y2 - y1 });
      hits = [];
      const layer = selLayerRef.current;
      if (layer) layer.innerHTML = '';
      tops().forEach(el => {
        const r = el.getBoundingClientRect();
        if (r.bottom > y1 && r.top < y2 && r.right > x1 && r.left < x2) {
          hits.push(el.getAttribute('data-id'));
          if (layer) { const d = document.createElement('div'); d.style.cssText = `left:${r.left - wr.left - 5}px;top:${r.top - wr.top + 1.5}px;width:${r.width + 10}px;height:${r.height - 3}px`; layer.appendChild(d); }
        }
      });
      ev.preventDefault();
    };
    const up = () => {
      document.removeEventListener('pointermove', move); document.removeEventListener('pointerup', up);
      setBox(null);
      if (!active || !hits.length) { if (selLayerRef.current) selLayerRef.current.innerHTML = ''; return; }
      marqueeSelRef.current = hits.length > 1 ? hits.slice() : null;
      if (hits.length === 1 && selLayerRef.current) selLayerRef.current.innerHTML = '';
      try { hits.length === 1 ? editor.setTextCursorPosition(hits[0], 'start') : editor.setSelection(hits[0], hits[hits.length - 1]); editor.focus(); } catch {}
    };
    document.addEventListener('pointermove', move); document.addEventListener('pointerup', up);
  };
  // drag-select starting from the empty area right of a line: ProseMirror only moves the
  // caret there, so run the selection drag ourselves from the position under the pointer
  const rightDrag = (e) => {
    if (!editor.isEditable || e.button !== 0) return;
    const bc = e.target.closest?.('.bn-block-content'); if (!bc) return;
    if (bc.dataset.contentType === 'codeBlock' || bc.dataset.contentType === 'table') return;
    const inline = bc.querySelector(':scope .bn-inline-content'); if (!inline) return;
    if (e.clientX <= inline.getBoundingClientRect().right + 2) return;
    const view = editor.prosemirrorView; if (!view) return;
    // clamp lookups into the text element at the pointer's line, otherwise ProseMirror
    // resolves points in the blank zone to the START of the line
    const posAt = (x, y) => {
      const el = document.elementFromPoint(x, y);
      const inl = el?.closest?.('.bn-block-content')?.querySelector(':scope .bn-inline-content');
      if (inl) { const r = inl.getBoundingClientRect(); x = Math.max(r.left + 1, Math.min(x, r.right - 2)); y = Math.max(r.top + 2, Math.min(y, r.bottom - 2)); }
      return view.posAtCoords({ left: x, top: y })?.pos;
    };
    const anchor = posAt(e.clientX, e.clientY); if (anchor == null) return;
    e.preventDefault();
    view.focus();
    const setSel = (a, h) => { try { view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, a, h))); } catch {} };
    setSel(anchor, anchor);
    let lastH = anchor;
    const move = (ev) => { const h = posAt(ev.clientX, ev.clientY); if (h != null && h !== lastH) { lastH = h; setSel(anchor, h); } };
    const up = () => { document.removeEventListener('pointermove', move); document.removeEventListener('pointerup', up); };
    document.addEventListener('pointermove', move); document.addEventListener('pointerup', up);
  };
  // click in the blank space below the doc starts a fresh paragraph (Notion behavior)
  const clickBlank = (e) => {
    if (!editor.isEditable) return;
    if (marqueeRef.current) { marqueeRef.current = false; return; }
    if (e.target !== e.currentTarget && !e.target.classList?.contains('bn-editor')) return;
    try {
      const doc = editor.document; const last = doc[doc.length - 1]; if (!last) return;
      const el = wrapRef.current?.querySelector(`[data-id="${last.id}"]`);
      if (el && e.clientY < el.getBoundingClientRect().bottom) return;
      const empty = last.type === 'paragraph' && (!last.content || last.content.length === 0);
      if (empty) editor.setTextCursorPosition(last.id, 'end');
      else { const r = editor.insertBlocks([{ type: 'paragraph' }], last.id, 'after'); editor.setTextCursorPosition(r?.insertedBlocks?.[0]?.id || last.id, 'end'); }
      editor.focus();
    } catch {}
  };
  // highlight the block you're about to grab while hovering its handle
  const hl = (id, on) => {
    const el = on && id ? wrapRef.current?.querySelector(`[data-id="${id}"]`) : null;
    hlLockRef.current = el || false;
    if (el) { hlRoRef.current?.disconnect(); hlRoRef.current?.observe(el); }
    placeHl(el, true);
  };
  // marquee can start from the page margins (outside editor-wrap), so listen at document level
  const startBoxRef = useRef(startBox); startBoxRef.current = startBox;
  useEffect(() => {
    const h = (e) => startBoxRef.current(e);
    document.addEventListener('pointerdown', h);
    return () => document.removeEventListener('pointerdown', h);
  }, []);
  const selLayerRef = useRef(null);
  // while a marquee-made block selection is alive, render Notion-style block tints
  // instead of ProseMirror's per-character text highlight
  useEffect(() => {
    let raf = 0;
    const same = (a, b) => a.length === b.length && a.every(x => b.includes(x));
    const sync = () => {
      const wrap = wrapRef.current, layer = selLayerRef.current; if (!wrap || !layer) return;
      let ids = null;
      try {
        const bs = editor.getSelection()?.blocks;
        const m = marqueeSelRef.current;
        if (bs?.length > 1 && m?.length > 1 && same(bs.map(b => b.id), m)) ids = bs.map(b => b.id);
      } catch {}
      layer.innerHTML = '';
      wrap.classList.toggle('blocksel', !!ids);
      if (!ids) { if (!document.getSelection()?.rangeCount || document.getSelection().isCollapsed) marqueeSelRef.current = marqueeSelRef.current; return; }
      const wr = wrap.getBoundingClientRect();
      for (const id of ids) {
        const el = wrap.querySelector(`[data-id="${id}"]`); if (!el) continue;
        const cEl = el.querySelector(':scope > .bn-block > .bn-block-content') || el.querySelector('.bn-block-content') || el;
        const cr = cEl.getBoundingClientRect(), orr = el.getBoundingClientRect();
        const d = document.createElement('div');
        d.style.cssText = `left:${cr.left - wr.left - 5}px;top:${orr.top - wr.top + 1.5}px;width:${cr.width + 10}px;height:${orr.height - 3}px`;
        layer.appendChild(d);
      }
    };
    const onSel = () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(sync); };
    document.addEventListener('selectionchange', onSel);
    return () => { document.removeEventListener('selectionchange', onSel); cancelAnimationFrame(raf); };
  }, [editor]);
  // Notion-style right-click menu on blocks
  const [ctx, setCtx] = useState(null);
  const onCtxMenu = (e) => {
    if (!editor.isEditable) return;
    const blk = e.target.closest?.('[data-id]');
    if (!blk || e.target.closest('.code-copy, select, a')) return;
    e.preventDefault();
    setCtx({ x: Math.min(e.clientX, window.innerWidth - 240), y: Math.min(e.clientY, window.innerHeight - 420), id: blk.getAttribute('data-id') });
  };
  const ctxAct = async (fn) => { setCtx(null); try { await fn(); } catch {} };
  // the blocks a context action applies to: live multi-selection, else the remembered
  // marquee set (right-click collapses the live one), else just the clicked block
  const ctxBlocks = (id) => {
    try { const bs = editor.getSelection()?.blocks; if (bs?.length > 1 && bs.some(b => b.id === id)) return bs; } catch {}
    const m = marqueeSelRef.current;
    if (m?.length > 1 && m.includes(id)) { const bs = m.map(x => editor.getBlock(x)).filter(Boolean); if (bs.length > 1) return bs; }
    const b = editor.getBlock(id); return b ? [b] : [];
  };
  const ctxCursor = (id) => {
    const bs = ctxBlocks(id);
    try { bs.length > 1 ? editor.setSelection(bs[0].id, bs[bs.length - 1].id) : editor.setTextCursorPosition(id); } catch {}
  };
  const ctxStyle = (id, s) => ctxAct(() => {
    const sel = editor.getSelection();
    if (!sel?.blocks?.length && window.getSelection()?.isCollapsed) editor.setSelection(id, id);
    editor.toggleStyles(s);
    editor.focus();
  });
  const CtxItem = ({ icon: I, label, kbd, danger, onClick }) => (
    <div className={'popmenu-item' + (danger ? ' danger' : '')} onClick={onClick}><I size={15} /> {label}{kbd && <span className="ctx-kbd">{kbd}</span>}</div>
  );
  return (
    <div className="editor-wrap" ref={wrapRef} onClick={clickBlank} onPointerDown={(e) => { if (e.button === 0) marqueeSelRef.current = null; rightDrag(e); }} onContextMenu={onCtxMenu}>
    <div className="blk-hl" ref={hlRef} />
    <div className="box-sel-layer" ref={selLayerRef} />
    {box && <div className="box-rect" style={{ left: box.l, top: box.t, width: box.w, height: box.h }} />}
    {ctx && createPortal(<>
      <div className="picker-overlay" onClick={() => setCtx(null)} onContextMenu={(e) => { e.preventDefault(); setCtx(null); }} />
      <div className="ctx-menu" style={{ left: ctx.x, top: ctx.y }}>
        <div className="ctx-fmt">
          <button title="Bold" onClick={() => ctxStyle(ctx.id, { bold: true })}><TextB size={15} weight="bold" /></button>
          <button title="Italic" onClick={() => ctxStyle(ctx.id, { italic: true })}><TextItalic size={15} /></button>
          <button title="Underline" onClick={() => ctxStyle(ctx.id, { underline: true })}><TextUnderline size={15} /></button>
          <button title="Strikethrough" onClick={() => ctxStyle(ctx.id, { strike: true })}><TextStrikethrough size={15} /></button>
          <button title="Inline code" onClick={() => ctxStyle(ctx.id, { code: true })}><CodeIcon size={15} /></button>
        </div>
        <div className="popmenu-sep" />
        <CtxItem icon={Scissors} label="Cut" onClick={() => ctxAct(async () => { const bs = ctxBlocks(ctx.id); const md = await editor.blocksToMarkdownLossy(bs); await navigator.clipboard?.writeText(md); editor.removeBlocks(bs.map(b => b.id)); })} />
        <CtxItem icon={CopySimple} label="Copy" onClick={() => ctxAct(async () => { const bs = ctxBlocks(ctx.id); const s = window.getSelection(); const txt = bs.length > 1 ? await editor.blocksToMarkdownLossy(bs) : (s && !s.isCollapsed ? s.toString() : await editor.blocksToMarkdownLossy(bs)); await navigator.clipboard?.writeText(txt); })} />
        <CtxItem icon={ClipboardText} label="Paste below" onClick={() => ctxAct(async () => { const t = await navigator.clipboard?.readText(); if (!t) return; const blocks = (await editor.tryParseMarkdownToBlocks(t) || []).filter(Boolean); const bs = ctxBlocks(ctx.id); if (blocks.length) editor.insertBlocks(blocks, bs[bs.length - 1].id, 'after'); })} />
        <div className="popmenu-sep" />
        <div className="tim-parent popmenu-item" style={{ padding: '7px 12px' }}>
          <span className="tim-row"><TextT size={15} /> Turn into</span>
          <ChevronRight size={12} className="tim-caret" />
          <div className="tim-sub">
            {TURN_INTO.flatMap(it => it.sub ? it.sub : [it]).map(it => (
              <div className="popmenu-item" key={it.label} onClick={() => ctxAct(() => ctxBlocks(ctx.id).forEach(b => { try { editor.updateBlock(b.id, { type: it.type, props: it.props }); } catch {} }))}><it.icon size={15} /> {it.label}</div>
            ))}
          </div>
        </div>
        <div className="popmenu-sep" />
        <CtxItem icon={TextIndent} label="Indent" kbd="Tab" onClick={() => ctxAct(() => { ctxCursor(ctx.id); editor.nestBlock(); })} />
        <CtxItem icon={TextOutdent} label="Un-indent" kbd="⇧Tab" onClick={() => ctxAct(() => { ctxCursor(ctx.id); editor.unnestBlock(); })} />
        <CtxItem icon={ArrowUp} label="Move up" kbd="⌘⇧↑" onClick={() => ctxAct(() => { ctxCursor(ctx.id); editor.moveBlocksUp(); })} />
        <CtxItem icon={ArrowDown} label="Move down" kbd="⌘⇧↓" onClick={() => ctxAct(() => { ctxCursor(ctx.id); editor.moveBlocksDown(); })} />
        <div className="popmenu-sep" />
        <CtxItem icon={CopySimple} label="Duplicate" onClick={() => ctxAct(() => { const bs = ctxBlocks(ctx.id); editor.insertBlocks(bs.map(stripIds), bs[bs.length - 1].id, 'after'); })} />
        <CtxItem icon={Trash2} label="Delete" danger onClick={() => ctxAct(() => editor.removeBlocks(ctxBlocks(ctx.id).map(b => b.id)))} />
      </div>
    </>, document.body)}
    <BlockNoteView editor={editor} editable={editable} theme="dark" slashMenu={false} sideMenu={false} onChange={() => onChange(JSON.stringify(editor.document))}>
      <SideMenuController sideMenu={(p) => (
        <div ref={(el) => {
            if (!el) return;
            let dx = 0;
            try {
              const b = wrapRef.current?.querySelector(`[data-id="${p.block?.id}"] > .bn-block > .bn-block-content`);
              const ed = wrapRef.current?.querySelector('.bn-editor');
              if (b && ed) dx = Math.max(0, b.getBoundingClientRect().left - ed.getBoundingClientRect().left);
            } catch {}
            el.style.transform = dx > 2 ? `translateX(${dx}px)` : '';
          }}
          onMouseEnter={() => hl(p.block?.id, true)} onMouseLeave={() => hl(null, false)}
          onDragStartCapture={() => {
            if (p.block?.id) {
              let ids = [p.block.id];
              try { const bs = editor.getSelection()?.blocks; if (bs?.length > 1 && bs.some(b => b.id === p.block.id)) ids = bs.map(b => b.id); } catch {}
              dragRef.current = { ids, handle: true };
            }
            hl(null, false);
          }}>
          <SideMenu {...p}><AddBlockButton {...p} /><DragHandle {...p} /></SideMenu>
        </div>
      )} />
      <SuggestionMenuController triggerCharacter="/" getItems={async (query) => filterSuggestionItems([
        ...getDefaultReactSlashMenuItems(editor).filter(i => !['Image', 'Video', 'Audio', 'File'].includes(i.title)),
        { title: 'Callout', subtext: 'Tip box with an emoji', aliases: ['callout', 'tip', 'note', 'info', 'box', 'warning'], group: 'Basic blocks', icon: <span style={{ fontSize: 16 }}>💡</span>, onItemClick: () => insertOrUpdateBlock(editor, { type: 'callout' }) },
        { title: 'Toggle', subtext: 'Collapsible section: title line, Tab content under it', aliases: ['toggle', 'collapse', 'collapsible', 'details', 'dropdown', 'fold'], group: 'Basic blocks', icon: <ChevronRight size={16} />, onItemClick: () => insertOrUpdateBlock(editor, { type: 'toggle' }) },
        { title: 'Toggle heading', subtext: 'Heading-sized collapsible section', aliases: ['toggleheading', 'theading', 'collapsibleheading'], group: 'Basic blocks', icon: <ChevronRight size={16} weight="bold" />, onItemClick: () => insertOrUpdateBlock(editor, { type: 'toggle', props: { level: 2 } }) },
        { title: 'Quote', subtext: 'Citation with an accent bar', aliases: ['quote', 'blockquote', 'citation'], group: 'Basic blocks', icon: <Quotes size={16} />, onItemClick: () => insertOrUpdateBlock(editor, { type: 'quote' }) },
        { title: 'Divider', subtext: 'Horizontal rule', aliases: ['divider', 'hr', 'line', 'separator', 'rule'], group: 'Basic blocks', icon: <Minus size={16} />, onItemClick: () => insertOrUpdateBlock(editor, { type: 'divider' }) },
      ], query)} />
      <SuggestionMenuController triggerCharacter="#" getItems={pageItems} />
      <SuggestionMenuController triggerCharacter="@" getItems={pageItems} />
    </BlockNoteView>
    </div>
  );
}

// ---------- search (⌘K) ----------
function Search({ workspace, onOpen, onClose }) {
  const [q, setQ] = useState(''); const [res, setRes] = useState([]);
  useEffect(() => { const id = setTimeout(() => { q.trim() ? api('/search?q=' + encodeURIComponent(q) + (workspace ? '&workspace=' + workspace : '')).then(setRes).catch(() => {}) : setRes([]); }, 150); return () => clearTimeout(id); }, [q]);
  return (
    <div className="modal-bg top" onClick={onClose}>
      <div className="card search-box" onClick={e => e.stopPropagation()}>
        <input autoFocus placeholder="Search pages…" value={q} onChange={e => setQ(e.target.value)} onKeyDown={e => { if (e.key === 'Escape') onClose(); }} />
        <div className="search-res">
          {res.map(r => <div className="sr" key={r.id} onClick={() => { onOpen(r.id); onClose(); }}><span className="ic"><PageIcon icon={r.icon} size={16} /></span>{r.title || 'Untitled'} <span className="muted small">· {r.where}</span></div>)}
          {q && res.length === 0 && <div className="muted small pad">No matches</div>}
        </div>
      </div>
    </div>
  );
}

// ---------- settings ----------
function AdminUsers({ me }) {
  const confirm = useConfirm();
  const [users, setUsers] = useState([]);
  const load = () => api('/admin/users').then(setUsers).catch(() => {});
  useEffect(() => { load(); }, []);
  const setAdmin = async (u, v) => { await api('/admin/users/' + u.id, { method: 'PUT', body: { is_admin: v } }); load(); };
  const remove = async (u) => { if (!(await confirm(`Remove ${u.name || u.email} from NoteBit entirely? Their owned pages transfer to you.`, { danger: true, confirmLabel: 'Remove user' }))) return; await api('/admin/users/' + u.id, { method: 'DELETE' }); load(); };
  return (
    <div className="set-pane">
      <h3>All users <span className="muted">· {users.length}</span></h3>
      <div className="muted small">Everyone with a NoteBit account. Super-admins manage every workspace and these accounts. Invite people into a workspace from the <b>Members</b> tab.</div>
      {users.map(u => (
        <div className="member" key={u.id}>
          <Avatar user={u} size={34} />
          <div className="col grow"><b>{u.name || u.email}{u.id === me.id ? ' (you)' : ''}</b><span className="muted small">{u.email} · {u.pages} pages</span></div>
          {u.id !== me.id
            ? <span className="row gap8"><label className="adm-toggle"><input type="checkbox" checked={!!u.is_admin} onChange={e => setAdmin(u, e.target.checked)} /> Admin</label><button className="mini" onClick={() => remove(u)}>Remove</button></span>
            : <span className="role-badge"><Crown size={13} weight="fill" /> {u.is_admin ? 'Super-admin' : 'Member'}</span>}
        </div>
      ))}
    </div>
  );
}
function Settings({ me, setMe, currentWs, onWsChange, onLogout, onImported, onClose }) {
  const [tab, setTab] = useState('account');
  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="card settings" onClick={e => e.stopPropagation()}>
        <div className="set-side">
          <div className="set-title">Settings</div>
          <div className={'set-tab' + (tab === 'account' ? ' on' : '')} onClick={() => setTab('account')}><User size={14} /> My account</div>
          <div className={'set-tab' + (tab === 'members' ? ' on' : '')} onClick={() => setTab('members')}><Users size={14} /> People</div>
          <div className={'set-tab' + (tab === 'trash' ? ' on' : '')} onClick={() => setTab('trash')}><Trash2 size={14} /> Trash</div>
          {me.is_admin === 1 && <div className={'set-tab' + (tab === 'workspace' ? ' on' : '')} onClick={() => setTab('workspace')}><SettingsIcon size={14} /> Workspace</div>}
          {me.is_admin === 1 && <div className={'set-tab' + (tab === 'data' ? ' on' : '')} onClick={() => setTab('data')}><BookOpen size={14} /> Import / Export</div>}
          <a className="set-tab set-donate" href="https://ko-fi.com/V7V81I89ME" target="_blank" rel="noreferrer" title="Support the dev on Ko-fi"><Heart size={14} weight="fill" /> Support the dev</a>
          <a className="set-brand" href="https://notebit.org" target="_blank" rel="noreferrer" title="notebit.org">
            <svg width="15" height="15" viewBox="0 0 32 32" aria-hidden="true">
              <g fill="currentColor"><rect x="1.5" y="1.5" width="6.5" height="6.5" rx="1.8"/><rect x="1.5" y="9" width="6.5" height="6.5" rx="1.8"/><rect x="1.5" y="16.5" width="6.5" height="6.5" rx="1.8"/><rect x="1.5" y="24" width="6.5" height="6.5" rx="1.8"/><rect x="24" y="9" width="6.5" height="6.5" rx="1.8"/><rect x="24" y="16.5" width="6.5" height="6.5" rx="1.8"/><rect x="24" y="24" width="6.5" height="6.5" rx="1.8"/><rect x="9" y="9" width="6.5" height="6.5" rx="1.8"/><rect x="16.5" y="16.5" width="6.5" height="6.5" rx="1.8"/></g>
              <rect x="24.5" y="0.4" width="5.5" height="5.5" rx="1.6" fill="currentColor" opacity=".7" transform="rotate(18 27.25 3.15)"/>
            </svg>
            <span>NoteBit</span>
          </a>
        </div>
        <div className="set-body">
          <X size={17} className="x abs" onClick={onClose} />
          {tab === 'account' && <Account me={me} setMe={setMe} onLogout={onLogout} />}
          {tab === 'trash' && <TrashView currentWs={currentWs} />}
          {tab === 'members' && <><Members me={me} currentWs={currentWs} />{me.is_admin === 1 && <AdminUsers me={me} />}</>}
          {tab === 'workspace' && <Workspaces currentWs={currentWs} onWsChange={onWsChange} />}
          {tab === 'data' && <><ImportPane currentWs={currentWs} onImported={onImported} /><ExportPane currentWs={currentWs} /></>}

        </div>
      </div>
    </div>
  );
}
function UpdateNotice() {
  const [u, setU] = useState(null);
  useEffect(() => { api('/update-check').then(setU).catch(() => setU({ current: APP_VERSION })); }, []);
  if (!u) return null;
  return (
  <>
    <div className="upd">
      <span>NoteBit <b>v{u.current}</b></span>
      {u.updateAvailable
        ? <a className="upd-new" href={u.url} target="_blank" rel="noreferrer">Update to v{u.latest} →</a>
        : <span className="muted small">You're up to date</span>}
    </div>
    <div className="upd">
      <span className="muted small">Prefer managed hosting?</span>
      <a className="upd-new" href="https://notebit.org" target="_blank" rel="noreferrer">NoteBit Cloud →</a>
    </div>
  </>
  );
}
function Account({ me, setMe, onLogout }) {
  const [name, setName] = useState(me.name || '');
  const [pw, setPw] = useState({ current_password: '', new_password: '' }); const [msg, setMsg] = useState('');
  const fileRef = useRef();
  const setTheme = async (id) => { applyTheme(id); const u = await api('/me', { method: 'PUT', body: { theme: id } }); setMe(m => ({ ...m, theme: u.theme })); };
  const pickAvatar = async (e) => { const f = e.target.files?.[0]; if (!f) return; const avatar = await fileToAvatar(f); const u = await api('/me', { method: 'PUT', body: { avatar } }); setMe(m => ({ ...m, avatar: u.avatar })); };
  const saveName = async () => { const u = await api('/me', { method: 'PUT', body: { name } }); setMe(m => ({ ...m, name: u.name })); setMsg('Saved ✓'); setTimeout(() => setMsg(''), 1500); };
  const changePw = async () => { setMsg(''); try { await api('/auth/change-password', { method: 'POST', body: pw }); setPw({ current_password: '', new_password: '' }); setMsg('Password changed ✓'); } catch (e) { setMsg(e.data?.error || 'error'); } };
  return (
    <div className="set-pane">
      <h3>My account</h3>
      <div className="row gap14">
        <Avatar user={me} size={64} />
        <div className="col">
          <button className="mini" onClick={() => fileRef.current.click()}>Upload photo</button>
          {me.avatar && <button className="mini" onClick={async () => { await api('/me', { method: 'PUT', body: { avatar: null } }); setMe(m => ({ ...m, avatar: null })); }}>Remove</button>}
          <input ref={fileRef} type="file" accept="image/*" hidden onChange={pickAvatar} />
        </div>
      </div>
      <label className="fld"><span>Display name</span><div className="row gap"><input value={name} onChange={e => setName(e.target.value)} /><button className="mini gold" onClick={saveName}>Save</button></div></label>
      <label className="fld"><span>Email</span><input value={me.email} disabled /></label>
      <h3>Theme</h3>
      <div className="theme-row">
        {THEMES.map(t => <div key={t.id} className={'theme-swatch' + ((me.theme || 'amethyst') === t.id ? ' on' : '')} onClick={() => setTheme(t.id)}><span className="ts-dot" style={{ background: t.color }} /><span>{t.name}</span></div>)}
      </div>
      <h3>Change password</h3>
      <input type="password" placeholder="Current password" value={pw.current_password} onChange={e => setPw({ ...pw, current_password: e.target.value })} />
      <input type="password" placeholder="New password (min 6)" value={pw.new_password} onChange={e => setPw({ ...pw, new_password: e.target.value })} />
      <button className="mini gold" onClick={changePw}>Update password</button>
      {msg && <div className="muted small">{msg}</div>}
      <h3>About</h3>
      <UpdateNotice />
      <button className="btn-soft logout-btn" onClick={onLogout}>Log out</button>
    </div>
  );
}
function Members({ me, currentWs }) {
  const confirm = useConfirm();
  const [members, setMembers] = useState([]);
  const [inv, setInv] = useState({ email: '', name: '', role: 'write' });
  const [msg, setMsg] = useState('');
  const load = () => currentWs?.id && api('/workspaces/' + currentWs.id + '/members').then(setMembers).catch(() => setMembers([]));
  useEffect(() => { load(); }, [currentWs?.id]);
  const canManage = me.is_admin === 1 || members.find(m => m.id === me.id)?.role === 'manage';
  const invite = async () => { setMsg(''); if (!inv.email.trim()) return; try { const r = await api('/workspaces/' + currentWs.id + '/members', { method: 'POST', body: inv }); setInv({ email: '', name: '', role: 'write' }); setMsg(r.emailed ? '✓ Invite emailed' : (r.isNew ? '✓ Added (email failed)' : '✓ Added to workspace')); load(); } catch (e) { setMsg(e.data?.error || 'error'); } };
  const setRole = async (id, role) => { await api('/workspaces/' + currentWs.id + '/members/' + id, { method: 'PUT', body: { role } }); load(); };
  const remove = async (m) => { if (!(await confirm(`Remove ${m.name || m.email} from ${currentWs.name}?`, { danger: true, confirmLabel: 'Remove' }))) return; await api('/workspaces/' + currentWs.id + '/members/' + m.id, { method: 'DELETE' }); load(); };
  const RoleSelect = ({ value, onChange }) => <select className="role-sel" value={value} onChange={onChange}><option value="read">Read</option><option value="write">Write</option><option value="manage">Manage</option></select>;
  return (
    <div className="set-pane">
      <h3>Members of {currentWs?.name} <span className="muted">· {members.length}</span></h3>
      {canManage && <div className="add-member">
        <input placeholder="Email to invite" value={inv.email} onChange={e => setInv({ ...inv, email: e.target.value })} onKeyDown={e => e.key === 'Enter' && invite()} />
        <input placeholder="Name (optional)" value={inv.name} onChange={e => setInv({ ...inv, name: e.target.value })} />
        <div className="row gap8 wrap">
          <RoleSelect value={inv.role} onChange={e => setInv({ ...inv, role: e.target.value })} />
          <button className="mini gold" onClick={invite}>Invite &amp; email</button>
          {msg && <span className="muted small">{msg}</span>}
        </div>
      </div>}
      {members.map(m => {
        const R = ROLE_INFO[m.role] || ROLE_INFO.write;
        return (
          <div className="member" key={m.id}>
            <Avatar user={m} size={34} />
            <div className="col grow"><b>{m.name || m.email}{m.id === me.id ? ' (you)' : ''}</b><span className="muted small">{m.email}</span></div>
            {canManage && m.id !== me.id
              ? <span className="row gap8"><RoleSelect value={m.role} onChange={e => setRole(m.id, e.target.value)} /><button className="mini" onClick={() => remove(m)}>Remove</button></span>
              : <span className="role-badge"><R.icon size={13} weight="fill" /> {R.label}</span>}
          </div>
        );
      })}
    </div>
  );
}
function ImportPane({ currentWs, onImported }) {
  const editor = useCreateBlockNote({ schema });
  const [log, setLog] = useState([]);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef();
  const onFiles = async (e) => {
    const files = [...(e.target.files || [])]; if (!files.length || !currentWs?.id) return;
    setBusy(true); const results = [];
    for (const f of files) {
      try {
        const text = await f.text();
        if (/\.json$/i.test(f.name)) {
          const obj = JSON.parse(text);
          if (!String(obj?.format || '').startsWith('notebit-workspace')) throw new Error('not a NoteBit backup file');
          const r = await api('/workspaces/' + currentWs.id + '/import-native', { method: 'POST', body: { pages: obj.pages } });
          results.push({ name: f.name, ok: true, title: r.imported + ' pages from "' + (obj.name || 'backup') + '" (boards included)' });
          continue;
        }
        let blocks = await editor.tryParseMarkdownToBlocks(text);
        let title = f.name.replace(/\.(md|markdown|txt)$/i, '');
        if (blocks[0]?.type === 'heading' && blocks[0]?.props?.level === 1) {
          const t = (blocks[0].content || []).map(c => c.text || '').join('').trim();
          if (t) { title = t; blocks = blocks.slice(1); }
        }
        if (!blocks.length) blocks = [{ type: 'paragraph' }];
        const page = await api('/pages', { method: 'POST', body: { title, workspace_id: currentWs.id } });
        await api('/pages/' + page.id, { method: 'PUT', body: { content: JSON.stringify(blocks) } });
        results.push({ name: f.name, ok: true, title });
      } catch (err) { results.push({ name: f.name, ok: false, error: String(err?.data?.error || err?.message || err) }); }
    }
    setLog(results); setBusy(false); if (fileRef.current) fileRef.current.value = ''; onImported?.();
  };
  return (
    <div className="set-pane">
      <h3>Import pages</h3>
      <div className="muted small">Drop a <b>.notebit.json</b> backup from another NoteBit instance (full migration: boards, cards, links) or Markdown (<b>.md</b>) files (each becomes a page). A leading <code>#&nbsp;Heading</code> becomes the page title.</div>
      <input ref={fileRef} type="file" accept=".md,.markdown,.txt,.json,text/markdown,text/plain,application/json" multiple hidden onChange={onFiles} />
      <button className="mini gold" disabled={busy} style={{ alignSelf: 'flex-start' }} onClick={() => fileRef.current.click()}>{busy ? 'Importing…' : 'Choose files'}</button>
      {log.length > 0 && <div className="import-log">{log.map((r, i) => <div key={i} className={'imp-row' + (r.ok ? '' : ' err')}>{r.ok ? '✓ ' : '✕ '}{r.ok ? r.title : `${r.name} — ${r.error}`}</div>)}</div>}
    </div>
  );
}
function ExportPane({ currentWs }) {
  const editor = useCreateBlockNote({ schema });
  const [busy, setBusy] = useState(false);
  const exportZip = async () => {
    if (!currentWs?.id) return;
    setBusy(true);
    try {
      const pages = await api('/workspaces/' + currentWs.id + '/export');
      const zip = new JSZip(); const used = {};
      for (const p of pages) {
        let blocks = []; try { blocks = JSON.parse(p.content || '[]'); } catch {}
        const md = blocks.length ? await editor.blocksToMarkdownLossy(blocks) : '';
        let base = (p.title || 'Untitled').replace(/[\/\\:*?"<>|]/g, '-').trim().slice(0, 80) || 'Untitled';
        used[base] = (used[base] || 0) + 1; if (used[base] > 1) base += '-' + used[base];
        zip.file(base + '.md', `# ${p.title || 'Untitled'}\n\n${md}`);
      }
      const blob = await zip.generateAsync({ type: 'blob' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a'); a.href = url; a.download = (currentWs.name || 'workspace').replace(/[^a-z0-9]+/gi, '-') + '-export.zip'; a.click();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
    } catch (e) { /* ignore */ } finally { setBusy(false); }
  };
  const exportNative = async () => {
    if (!currentWs?.id) return;
    setBusy(true);
    try {
      const pages = await api('/workspaces/' + currentWs.id + '/export');
      const payload = { format: 'notebit-workspace@1', exported_from: location.host, name: currentWs.name, pages };
      const blob = new Blob([JSON.stringify(payload, null, 1)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a'); a.href = url; a.download = (currentWs.name || 'workspace').replace(/[^a-z0-9]+/gi, '-') + '.notebit.json'; a.click();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
    } catch (e) {} finally { setBusy(false); }
  };
  return (
    <div className="set-pane">
      <h3>Export</h3>
      <div className="muted small"><b>NoteBit backup</b> keeps everything: tree, boards, columns, cards, tags, links. Import it into any NoteBit instance for a full migration. The Markdown zip is for taking your notes elsewhere.</div>
      <div className="row gap">
        <button className="mini gold" disabled={busy} onClick={exportNative}>{busy ? 'Exporting…' : 'NoteBit backup (.json)'}</button>
        <button className="mini" disabled={busy} onClick={exportZip}>{busy ? '…' : 'Markdown (.zip)'}</button>
      </div>
    </div>
  );
}
function Workspaces({ currentWs, onWsChange }) {
  const confirm = useConfirm();
  const [s, setS] = useState(null);
  const [name, setName] = useState(currentWs?.name || '');
  const [icon, setIcon] = useState(currentWs?.icon || 'ph:BookOpen');
  const [picker, setPicker] = useState(false);
  const [msg, setMsg] = useState('');
  const [ekey, setEkey] = useState('');
  const [efrom, setEfrom] = useState('');
  const [emsg, setEmsg] = useState('');
  useEffect(() => { api('/admin/settings').then(r => { setS(r); setEfrom(r.mail_from || ''); }).catch(() => {}); }, []);
  useEffect(() => { setName(currentWs?.name || ''); setIcon(currentWs?.icon || 'ph:BookOpen'); }, [currentWs?.id]);
  if (!s) return null;
  const toggle = async () => { const r = await api('/admin/settings', { method: 'PUT', body: { allow_signup: !s.allow_signup } }); setS(r); };
  const saveName = async () => { await api('/workspaces/' + currentWs.id, { method: 'PUT', body: { name } }); onWsChange(); setMsg('Saved ✓'); setTimeout(() => setMsg(''), 1500); };
  const setWsIcon = async (v) => { setIcon(v); setPicker(false); await api('/workspaces/' + currentWs.id, { method: 'PUT', body: { icon: v } }); onWsChange(); };
  const del = async () => { if (!(await confirm(`Delete "${currentWs.name}"? All its pages move to trash and the workspace is removed for everyone.`, { danger: true, confirmLabel: 'Delete workspace' }))) return; try { await api('/workspaces/' + currentWs.id, { method: 'DELETE' }); onWsChange(); } catch (e) { setMsg(e.data?.error || 'error'); } };
  return (
    <div className="set-pane">
      <h3>Workspace</h3>
      <div className="row gap14">
        <span className="emoji-wrap"><button className="ws-modal-icon" onClick={() => setPicker(v => !v)}><PageIcon icon={icon} size={34} /></button>
          {picker && <IconPicker onPick={setWsIcon} onClose={() => setPicker(false)} />}</span>
        <label className="fld grow"><span>Workspace name</span><div className="row gap"><input value={name} onChange={e => setName(e.target.value)} /><button className="mini gold" onClick={saveName}>Save</button>{msg && <span className="muted small">{msg}</span>}</div></label>
      </div>
      <div className="row between fld2"><div className="col"><b>Open sign-up</b><span className="muted small">Let anyone with the link create an account</span></div>
        <label className="sw"><input type="checkbox" checked={!!s.allow_signup} onChange={toggle} /><span /></label></div>
      <div className="row between fld2"><div className="col"><b>Email invites</b>
        <span className="muted small">{s.email_configured ? (s.email_key_source === 'env' ? 'Configured via environment.' : 'Configured.') + ' Invites are emailed automatically.' : 'Not configured. Invites still work, but you must share the link by hand.'}</span></div>
        <span className={'role-badge'} style={{ color: s.email_configured ? '#5fc18a' : 'var(--muted)' }}>{s.email_configured ? 'On' : 'Off'}</span></div>
      <div className="col" style={{ gap: 8 }}>
        <label className="fld"><span>Resend API key <a href="https://resend.com/api-keys" target="_blank" rel="noreferrer" style={{ color: 'var(--accent)' }}>(get one free)</a></span>
          <input type="password" placeholder={s.email_key_source === 'app' ? 'saved, enter a new key to replace' : 're_...'} value={ekey} onChange={e => setEkey(e.target.value)} /></label>
        <label className="fld"><span>From address (a domain you verified at Resend, or leave blank)</span>
          <input placeholder="NoteBit <notes@yourdomain.com>" value={efrom} onChange={e => setEfrom(e.target.value)} /></label>
        <div className="row gap">
          <button className="mini gold" onClick={async () => { const body = { mail_from: efrom }; if (ekey.trim()) body.resend_key = ekey.trim(); const r = await api('/admin/settings', { method: 'PUT', body }); setS(r); setEkey(''); setEmsg('Saved ✓'); setTimeout(() => setEmsg(''), 2000); }}>Save email settings</button>
          <button className="mini" disabled={!s.email_configured} onClick={async () => { setEmsg('Sending…'); try { const r = await api('/admin/test-email', { method: 'POST', body: {} }); setEmsg(r.ok ? '✓ ' + r.detail : '✗ ' + r.detail); } catch { setEmsg('✗ failed'); } }}>Send test email</button>
          {emsg && <span className="muted small">{emsg}</span>}
        </div>
      </div>
      <h3>Danger zone</h3>
      <button className="btn-danger" style={{ alignSelf: 'flex-start' }} onClick={del}>Delete this workspace</button>
    </div>
  );
}

function TrashView({ currentWs }) {
  const confirm = useConfirm();
  const [items, setItems] = useState([]);
  const wsId = currentWs?.id;
  const load = () => wsId ? api('/trash?workspace=' + wsId).then(setItems).catch(() => setItems([])) : null;
  useEffect(() => { load(); }, [wsId]);
  const restore = async (id) => { await api('/pages/' + id + '/restore', { method: 'POST' }); load(); };
  const purge = async (id) => { if (!(await confirm('Permanently delete this page? This can’t be undone.', { danger: true, confirmLabel: 'Delete forever' }))) return; await api('/trash/' + id, { method: 'DELETE' }); load(); };
  const empty = async () => { if (!(await confirm(`Permanently delete ALL trashed pages in ${currentWs?.name}? This can’t be undone.`, { danger: true, confirmLabel: 'Empty trash' }))) return; await api('/trash?workspace=' + wsId, { method: 'DELETE' }); load(); };
  return (
    <div className="set-pane">
      <div className="row between"><h3>Trash · {currentWs?.name} ({items.length})</h3>{items.length > 0 && <button className="mini" onClick={empty}>Empty trash</button>}</div>
      {items.length === 0 && <div className="muted small">Trash is empty.</div>}
      {items.map(t => (
        <div className="member" key={t.id}>
          <PageIcon icon={t.icon} size={20} />
          <div className="col grow"><b>{t.title || 'Untitled'}</b><span className="muted small">deleted {t.deleted_at}</span></div>
          <span className="row gap"><button className="mini gold" onClick={() => restore(t.id)}>Restore</button><button className="mini" onClick={() => purge(t.id)}>Delete forever</button></span>
        </div>
      ))}
    </div>
  );
}

// ---------- share ----------
function FacePile({ members, onClick }) {
  if (!members?.length) return null;
  const shown = members.slice(0, 4);
  return (
    <div className="facepile" onClick={onClick} title={members.map(m => m.name || m.email).join(', ')}>
      {shown.map(m => <Avatar key={m.id} user={m} size={26} />)}
      {members.length > 4 && <span className="fp-more">+{members.length - 4}</span>}
    </div>
  );
}
function Share({ pageId, onClose, origin }) {
  const [data, setData] = useState(null);
  const [copied, setCopied] = useState(false);
  const load = () => api(`/pages/${pageId}/access`).then(setData).catch(() => setData({ members: [], is_public: false }));
  useEffect(() => { load(); }, [pageId]);
  const setRole = async (uid, role) => { await api(`/pages/${pageId}/access`, { method: 'POST', body: { user_id: uid, role } }); load(); };
  const resetRole = async (uid) => { await api(`/pages/${pageId}/access/${uid}`, { method: 'DELETE' }); load(); };
  const togglePublic = async (val) => { await api(`/pages/${pageId}`, { method: 'PUT', body: { is_public: val } }); load(); };
  const pub = `${origin}/p/${pageId}`;
  return (
    <>
      <div className="picker-overlay sidebar-ov" onClick={onClose} />
      <div className="share-panel" onClick={e => e.stopPropagation()}>
        <div className="share-head"><b>Share this page</b><X size={18} className="x" onClick={onClose} /></div>
        {!data ? <div className="muted small">Loading…</div> : <>
          <div className="share-vis">
            <button className={'vis-opt' + (!data.is_public ? ' on' : '')} onClick={() => togglePublic(false)}>
              <Users size={17} /><span className="col"><b>Private</b><span className="muted small">Workspace members only</span></span>
            </button>
            <button className={'vis-opt' + (data.is_public ? ' on' : '')} onClick={() => togglePublic(true)}>
              <Globe size={17} /><span className="col"><b>Published</b><span className="muted small">Anyone with the link can read</span></span>
            </button>
          </div>
          {data.is_public && <div className="pub-row">
            <input className="pub-input" readOnly value={pub} onFocus={e => e.target.select()} />
            <button className="mini" onClick={() => { try { navigator.clipboard.writeText(pub); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch {} }}>{copied ? 'Copied ✓' : 'Copy'}</button>
            <a className="mini open" href={pub} target="_blank" rel="noreferrer">Open ↗</a>
          </div>}
          <div className="share-sec">
            <div className="muted small">People with access · {data.members?.length || 0}</div>
            {(data.members || []).map(m => (
              <div className="prow" key={m.id}>
                <Avatar user={m} size={30} />
                <span className="col grow"><b>{m.name || m.email}</b><span className="muted small">{m.email}</span></span>
                <span className="row gap8">
                  {m.isOwner && <span className="role-badge" title="Created this page"><Crown size={13} weight="fill" /></span>}
                  <select className="role-sel" value={m.role} onChange={e => setRole(m.id, e.target.value)}>
                    <option value="read">Read</option><option value="write">Write</option><option value="manage">Manage</option>
                  </select>
                  {m.pageRole && <button className="mini" title={m.isOwner ? 'Reset to full owner access' : `Reset to workspace role (${m.wsRole})`} onClick={() => resetRole(m.id)}>↺</button>}
                </span>
              </div>
            ))}
          </div>
        </>}
      </div>
    </>
  );
}

// ---------- board (kanban) ----------
const BOARD_COLORS = { gray: '#9b9a97', blue: '#6f9fe0', green: '#5fc18a', amber: '#e1a845', red: '#ff5d52', purple: '#9a6dd7', pink: '#e08bb0' };
const DEFAULT_COLS = [{ id: 'todo', name: 'To do', color: 'gray', perm: 'member' }, { id: 'doing', name: 'In progress', color: 'blue', perm: 'member' }, { id: 'done', name: 'Approved', color: 'green', perm: 'manager' }];
function Popover({ trigger, width = 220, align = 'right', children }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState({ top: 0, left: 0 });
  const ref = useRef();
  const openIt = (e) => { e.stopPropagation(); const r = ref.current.getBoundingClientRect(); setPos({ top: Math.round(r.bottom + 6), left: Math.round(align === 'right' ? Math.max(8, r.right - width) : Math.min(r.left, window.innerWidth - width - 8)) }); setOpen(true); };
  const close = () => setOpen(false);
  return (
    <span className="pop-trigger" ref={ref} onClick={openIt}>
      {trigger}
      {open && createPortal(<>
        <div className="picker-overlay" onClick={e => { e.stopPropagation(); close(); }} />
        <div className="popmenu" style={{ position: 'fixed', top: pos.top, left: pos.left, width }} onClick={e => e.stopPropagation()}>{typeof children === 'function' ? children(close) : children}</div>
      </>, document.body)}
    </span>
  );
}
function ColMenu({ col, onColor, onPerm, onDelete }) {
  const color = (col.icon || '').startsWith('dot:') ? col.icon.slice(4) : 'gray';
  return (
    <Popover width={210} align="right" trigger={<button className="bcol-mbtn">⋯</button>}>
      {(close) => <>
        <div className="popmenu-head">Color</div>
        <div className="swatches" style={{ gridTemplateColumns: 'repeat(7, 1fr)' }}>{Object.entries(BOARD_COLORS).map(([k, v]) => <span key={k} className={'swatch' + (color === k ? ' on' : '')} style={{ background: v }} onClick={() => onColor(col.id, k)} />)}</div>
        <div className="popmenu-head">Who can use</div>
        <div className="segmented"><button className={col.col_perm !== 'manager' ? 'on' : ''} onClick={() => onPerm(col.id, 'member')}>Members</button><button className={col.col_perm === 'manager' ? 'on' : ''} onClick={() => onPerm(col.id, 'manager')}>Managers</button></div>
        <div className="popmenu-sep" />
        <div className="popmenu-item danger" onClick={() => { close(); onDelete(col.id); }}><Trash2 size={15} /> Delete column</div>
      </>}
    </Popover>
  );
}
function Board({ page, pages, canManage, canContribute, onOpen, onAddCard, onMoveCard, onDeleteCard, onAddColumn, onUpdateColumn, onDeleteColumn }) {
  const [dragId, setDragId] = useState(null);
  const [colDragId, setColDragId] = useState(null);
  const [overCol, setOverCol] = useState(null);
  const [dropBefore, setDropBefore] = useState(null);
  const boardRef = useRef();
  const flip = useRef(null);
  const captureFlip = (sel) => {
    const el = boardRef.current; if (!el) return;
    const m = new Map();
    el.querySelectorAll(sel).forEach(n => m.set(n.dataset.flip, n.getBoundingClientRect()));
    flip.current = { first: m, sel };
  };
  useLayoutEffect(() => {
    const f = flip.current; if (!f || !boardRef.current) return; flip.current = null;
    boardRef.current.querySelectorAll(f.sel).forEach(n => {
      const old = f.first.get(n.dataset.flip); if (!old) return;
      const r = n.getBoundingClientRect();
      const dx = old.left - r.left, dy = old.top - r.top;
      if (Math.abs(dx) > 0.5 || Math.abs(dy) > 0.5) {
        n.style.transition = 'none'; n.style.transform = `translate(${dx}px,${dy}px)`;
        n.getBoundingClientRect();
        requestAnimationFrame(() => { n.style.transition = 'transform .28s cubic-bezier(.2,.8,.2,1)'; n.style.transform = ''; });
        n.addEventListener('transitionend', () => { n.style.transition = ''; n.style.transform = ''; }, { once: true });
      }
    });
  });
  const cols = pages.filter(p => p.parent_id === page.id && p.view === 'column').sort((a, b) => (a.position || 0) - (b.position || 0));
  const cardsOf = (colId) => pages.filter(p => p.parent_id === colId).sort((a, b) => (a.position || 0) - (b.position || 0));
  const drop = (colId, beforeId) => {
    if (colDragId && colDragId !== colId) {
      const order = cols.map(c => c.id); const from = order.indexOf(colDragId), to = order.indexOf(colId);
      if (from > -1 && to > -1) { captureFlip('.bcol'); order.splice(from, 1); order.splice(to, 0, colDragId); order.forEach((id, i) => onUpdateColumn(id, { position: i })); }
    } else if (dragId && dragId !== beforeId) {
      const tgt = cols.find(c => c.id === colId);
      if (!(tgt && (tgt.col_perm || 'member') === 'manager' && !canManage)) { captureFlip('.bcard'); onMoveCard(dragId, colId, beforeId); }
    }
    setDragId(null); setColDragId(null); setOverCol(null); setDropBefore(null);
  };
  return (
    <div className="board" ref={boardRef}>
      {cols.map(col => {
        const perm = col.col_perm || 'member';
        const canAdd = canManage || (canContribute && perm === 'member');
        const cards = cardsOf(col.id);
        return (
        <div key={col.id} data-flip={col.id} className={'bcol' + (overCol === col.id ? ' over' : '') + (colDragId === col.id ? ' dragging' : '')}
          onDragOver={e => { e.preventDefault(); setOverCol(col.id); if (dragId) setDropBefore(null); }} onDragLeave={() => setOverCol(o => o === col.id ? null : o)} onDrop={() => drop(col.id, null)}>
          <div className="bcol-head">
            {canManage && <span className="bcol-grip" draggable onDragStart={() => setColDragId(col.id)} onDragEnd={() => setColDragId(null)} title="Drag to reorder column">⠿</span>}
            <span className="bdot" style={{ background: BOARD_COLORS[(col.icon || '').slice(4)] || BOARD_COLORS.gray }} />
            {canManage ? <input className="bcol-name" value={col.title} onChange={e => onUpdateColumn(col.id, { title: e.target.value })} /> : <span className="bcol-name">{col.title}</span>}
            {perm === 'manager' && <span className="bcol-lock" title="Managers only">🔒</span>}
            <span className="bcol-count">{cards.length}</span>
            {canManage && <ColMenu col={col} onColor={(id, color) => onUpdateColumn(id, { icon: 'dot:' + color })} onPerm={(id, pm) => onUpdateColumn(id, { col_perm: pm })} onDelete={onDeleteColumn} />}
          </div>
          <div className="bcards">
            {cards.map(c => (
              <div key={c.id} data-flip={c.id} className={'bcard' + (c.locked ? ' locked' : '') + (dragId === c.id ? ' dragging' : '') + (dragId && dragId !== c.id && dropBefore === c.id ? ' drop-above' : '')} draggable={canContribute && !c.locked}
                onDragStart={() => setDragId(c.id)} onDragEnd={() => { setDragId(null); setOverCol(null); setDropBefore(null); }}
                onDragOver={e => { if (dragId) { e.preventDefault(); e.stopPropagation(); setDropBefore(c.id); setOverCol(col.id); } }}
                onDrop={e => { if (dragId) { e.stopPropagation(); drop(col.id, c.id); } }}
                onClick={() => onOpen(c.id)}>
                <PageIcon icon={c.icon} size={16} /><span className="bcard-t">{c.title || 'Untitled'}</span>{c.locked ? <Lock size={12} weight="fill" className="bcard-lock" /> : (canContribute && <button className="bcard-del" title="Delete card" onMouseDown={e => e.stopPropagation()} onClick={e => { e.stopPropagation(); captureFlip('.bcard'); onDeleteCard(c.id); }}><Trash2 size={13} /></button>)}
              </div>
            ))}
            {canAdd && <button className="bcard-add" onClick={() => onAddCard(col.id)}><Plus size={14} /> New</button>}
          </div>
        </div>
        );
      })}
      {canManage && <button className="bcol-add" onClick={() => onAddColumn(page.id)}><Plus size={16} /> Add column</button>}
    </div>
  );
}
// ---------- knowledge graph ----------
function nmPhysics(st, t) {
  // positions are NORMALIZED (0..1 of container) so any size at any moment renders
  // correctly; forces integrate in pixel space derived fresh each frame
  const { pos, nodes, edges, w, h } = st; const n = nodes.length;
  if (!n || w < 120 || h < 120) return;
  const X = {}, Y = {};
  for (const nd of nodes) { const p = pos[nd.id]; if (p) { X[nd.id] = p.x * w; Y[nd.id] = p.y * h; } }
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
    const ai = nodes[i].id, bi = nodes[j].id, a = pos[ai], b = pos[bi]; if (!a || !b) continue;
    let dx = X[ai] - X[bi], dy = Y[ai] - Y[bi], d = Math.sqrt(dx * dx + dy * dy) || 0.1;
    const f = Math.min(8, 2400 / (d * d)); dx /= d; dy /= d;
    a.vx += dx * f; a.vy += dy * f; b.vx -= dx * f; b.vy -= dy * f;
  }
  for (const e of edges) {
    const a = pos[e.from], b = pos[e.to]; if (!a || !b) continue;
    let dx = X[e.to] - X[e.from], dy = Y[e.to] - Y[e.from], d = Math.sqrt(dx * dx + dy * dy) || 0.1;
    const f = (d - 112) * 0.011; dx /= d; dy /= d;
    a.vx += dx * f; a.vy += dy * f; b.vx -= dx * f; b.vy -= dy * f;
  }
  for (const nd of nodes) {
    const p = pos[nd.id]; if (!p || st.drag === nd.id) continue;
    let px = X[nd.id], py = Y[nd.id];
    p.vx += (w / 2 - px) * 0.0006; p.vy += (h / 2 - py) * 0.0006;
    if (t) { p.vx += Math.cos(t * 0.0002 + p.ph) * 0.02; p.vy += Math.sin(t * 0.0002 + p.ph * 1.3) * 0.02; }
    px += Math.max(-3.2, Math.min(3.2, p.vx)); py += Math.max(-3.2, Math.min(3.2, p.vy));
    p.vx *= 0.94; p.vy *= 0.94;
    px = Math.max(46, Math.min(w - 120, px)); py = Math.max(56, Math.min(h - 62, py));
    p.x = px / w; p.y = py / h;
  }
  // keep the whole cloud in frame: ease it toward fit if it outgrows the box
  let minX = 1e9, maxX = -1e9, minY = 1e9, maxY = -1e9;
  for (const nd of nodes) { const p = pos[nd.id]; if (!p) continue; const px = p.x * w, py = p.y * h; if (px < minX) minX = px; if (px > maxX) maxX = px; if (py < minY) minY = py; if (py > maxY) maxY = py; }
  const aw = w - 170, ah = h - 124, bw = maxX - minX, bh = maxY - minY;
  if (n > 1 && (bw > aw || bh > ah)) {
    const target = Math.min(aw / Math.max(bw, 1), ah / Math.max(bh, 1));
    const s = 1 - (1 - target) * 0.18;
    const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
    for (const nd of nodes) { const p = pos[nd.id]; if (!p || st.drag === nd.id) continue; p.x = (w / 2 + (p.x * w - cx) * s) / w; p.y = (h / 2 + (p.y * h - cy) * s) / h; }
  }
}
function nmPaint(st, nodeEls, edgeEls) {
  const { w, h } = st;
  for (const nd of st.nodes) { const p = st.pos[nd.id], el = nodeEls[nd.id]; if (el && p) el.style.transform = `translate(${p.x * w}px,${p.y * h}px) translate(-50%,-50%)`; }
  st.edges.forEach((e, i) => { const l = edgeEls[i], a = st.pos[e.from], b = st.pos[e.to]; if (l && a && b) { l.setAttribute('x1', a.x * w); l.setAttribute('y1', a.y * h); l.setAttribute('x2', b.x * w); l.setAttribute('y2', b.y * h); } });
}
function NodeMap({ workspace, onOpen, hiddenTags }) {
  const hidden = hiddenTags || new Set();
  const hiddenKey = [...hidden].sort().join(',');
  const [graph, setGraph] = useState(null);
  const [hover, setHover] = useState(null);
  const wrapRef = useRef();
  const nodeEls = useRef({});
  const edgeEls = useRef([]);
  const S = useRef({ pos: {}, nodes: [], edges: [], w: 820, h: 460, drag: null, moved: false, raf: 0 });
  useEffect(() => { api('/workspaces/' + workspace.id + '/graph').then(setGraph).catch(() => setGraph({ nodes: [], edges: [] })); }, [workspace.id]);
  const visNodes = useMemo(() => !graph ? [] : graph.nodes.filter(nd => !(nd.tags || []).some(t => hidden.has(t))), [graph, hiddenKey]);
  const visEdges = useMemo(() => { if (!graph) return []; const ids = new Set(visNodes.map(n => n.id)); return graph.edges.filter(e => ids.has(e.from) && ids.has(e.to)); }, [graph, visNodes]);
  useEffect(() => {
    if (!graph || !visNodes.length) return;
    const st = S.current; st.w = wrapRef.current?.clientWidth || 820; st.h = wrapRef.current?.clientHeight || 460;
    const nodes = visNodes, n = nodes.length;
    nodes.forEach((nd, i) => { if (!st.pos[nd.id]) { const a = (i / n) * Math.PI * 2, R = Math.min(st.w, st.h) / 2.5; st.pos[nd.id] = { x: (st.w / 2 + Math.cos(a) * R) / st.w, y: (st.h / 2 + Math.sin(a) * R) / st.h, vx: 0, vy: 0, ph: Math.random() * 6.28 }; } });
    st.nodes = nodes; st.edges = visEdges.filter(e => st.pos[e.from] && st.pos[e.to]); st.drag = null;
    for (let it = 0; it < 160; it++) nmPhysics(st, 0);
    const frame = (t) => { const el = wrapRef.current; if (el) { st.w = el.clientWidth || st.w; st.h = el.clientHeight || st.h; } nmPhysics(st, t); nmPaint(st, nodeEls.current, edgeEls.current); st.raf = requestAnimationFrame(frame); };
    cancelAnimationFrame(st.raf); st.raf = requestAnimationFrame(frame);
    const onResize = () => { if (wrapRef.current) { st.w = wrapRef.current.clientWidth || st.w; st.h = wrapRef.current.clientHeight || st.h; } };
    window.addEventListener('resize', onResize);
    const ro = typeof ResizeObserver !== 'undefined' && wrapRef.current ? new ResizeObserver(onResize) : null;
    if (ro) ro.observe(wrapRef.current);
    return () => { cancelAnimationFrame(st.raf); window.removeEventListener('resize', onResize); ro?.disconnect(); };
  }, [graph, hiddenKey]);
  const onDown = (id, e) => {
    if (e.button != null && e.button !== 0) return;
    e.preventDefault();
    const st = S.current; st.drag = id; st.moved = false;
    const rect = wrapRef.current.getBoundingClientRect();
    const move = (ev) => { st.moved = true; const p = st.pos[id]; if (!p) return; p.x = Math.max(46, Math.min(st.w - 120, ev.clientX - rect.left)) / st.w; p.y = Math.max(56, Math.min(st.h - 62, ev.clientY - rect.top)) / st.h; p.vx = 0; p.vy = 0; };
    const up = () => { document.removeEventListener('pointermove', move); document.removeEventListener('pointerup', up); const moved = st.moved; st.drag = null; if (!moved) onOpen(id); };
    document.addEventListener('pointermove', move); document.addEventListener('pointerup', up);
  };
  if (!graph) return <div className="nodemap loading muted small">Building map…</div>;
  if (!graph.nodes.length) return null;
  const linked = (id) => hover && (hover === id || visEdges.some(e => (e.from === hover && e.to === id) || (e.to === hover && e.from === id)));
  // Obsidian-style sizing: nodes grow with their connection count, so hub pages read as hubs
  const degree = {}, rootOf = {};
  visNodes.forEach(n => { rootOf[n.id] = !!n.root; });
  visEdges.forEach(e => { degree[e.from] = (degree[e.from] || 0) + 1; degree[e.to] = (degree[e.to] || 0) + 1; });
  // roots anchor the map: big by right, links add growth; children never outgrow roots
  const sizeOf = (id) => rootOf[id]
    ? Math.min(1.95, 1.5 + Math.sqrt(degree[id] || 0) * 0.08)
    : Math.min(1.4, 1 + Math.sqrt(degree[id] || 0) * 0.13);
  return (
    <div className="nodemap" ref={wrapRef}>
      <svg className="nm-edges" width="100%" height="100%">
        {visEdges.map((e, i) => { const on = hover && (e.from === hover || e.to === hover); return <line key={e.from + e.to} ref={el => (edgeEls.current[i] = el)} className={'nm-edge ' + e.kind + (on ? ' on' : hover ? ' dim' : '')} />; })}
      </svg>
      {visNodes.map(nd => { const active = !hover || linked(nd.id); const s = sizeOf(nd.id); return (
        <div key={nd.id} ref={el => (nodeEls.current[nd.id] = el)} className={'nm-node' + (active ? '' : ' dim') + (hover === nd.id ? ' hl' : '') + (nd.root ? ' hub' : '')} style={{ '--ns': s }}
          onMouseEnter={() => setHover(nd.id)} onMouseLeave={() => setHover(null)} onPointerDown={e => onDown(nd.id, e)} title={nd.title || 'Untitled'}>
          <span className="nm-dot"><PageIcon icon={nd.icon} size={18} /></span>
          <span className="nm-label">{nd.title || 'Untitled'}</span>
        </div>
      ); })}
    </div>
  );
}
function WorkspaceHome({ workspace, pages, canManage, onOpen, onNewDoc, onNewBoard, onTagClick }) {
  const boards = new Set(pages.filter(p => p.view === 'board').map(p => p.id));
  const list = pages.filter(p => !(p.parent_id && boards.has(p.parent_id)));
  const [tags, setTags] = useState([]);
  const [hiddenTags, setHiddenTags] = useState(() => new Set());
  const toggleTag = (name) => setHiddenTags(s => { const n = new Set(s); const k = name.toLowerCase(); n.has(k) ? n.delete(k) : n.add(k); return n; });
  useEffect(() => { api('/tags?workspace=' + workspace.id).then(setTags).catch(() => {}); setHiddenTags(new Set()); }, [workspace.id]);
  return (
    <div className="ws-home">
      <div className="ws-home-head">
        <PageIcon icon={workspace.icon} size={36} />
        <div className="col grow"><div className="ws-home-title">{workspace.name}</div><div className="muted small">{list.length} page{list.length === 1 ? '' : 's'}</div></div>
        {canManage && <div className="row gap"><button className="btn-soft" onClick={onNewDoc}><Pencil size={14} /> New doc</button><button className="btn-soft" onClick={onNewBoard}><BoardGlyph size={14} /> New board</button></div>}
      </div>
      {tags.length > 0 && <div className="ws-tags">{tags.slice(0, 28).map(t => { const off = hiddenTags.has(t.name.toLowerCase()); return <span className={'tag clickable' + (off ? ' off' : '')} key={t.name} style={{ '--tc': t.color || tagColor(t.name) }} title={off ? 'Show these pages in the graph' : 'Hide these pages from the graph'} onClick={() => toggleTag(t.name)}>{t.name}<span className="ws-tag-n">{t.count}</span></span>; })}</div>}
      <NodeMap workspace={workspace} onOpen={onOpen} hiddenTags={hiddenTags} />
    </div>
  );
}
function TagView({ tag, color, workspace, onOpen, onClose }) {
  const [pages, setPages] = useState(null);
  useEffect(() => { api('/tagpages?tag=' + encodeURIComponent(tag) + (workspace ? '&workspace=' + workspace : '')).then(setPages).catch(() => setPages([])); }, [tag]);
  return (
    <div className="modal-bg top" onClick={onClose}>
      <div className="card search-box" onClick={e => e.stopPropagation()}>
        <div className="tagview-head"><span className="tag" style={{ '--tc': color || tagColor(tag) }}>{tag}</span><span className="muted small grow">{pages ? pages.length + ' page' + (pages.length === 1 ? '' : 's') : '…'}</span><X size={16} className="x" onClick={onClose} /></div>
        <div className="search-res">
          {pages && pages.length === 0 && <div className="muted small" style={{ padding: '14px 16px' }}>No pages with this tag yet.</div>}
          {(pages || []).map(p => <div className="sr" key={p.id} onClick={() => { onOpen(p.id); onClose(); }}><PageIcon icon={p.icon} size={18} /><span>{p.title || 'Untitled'}</span></div>)}
        </div>
      </div>
    </div>
  );
}
const fmtDate = (s) => { try { return new Date(String(s).replace(' ', 'T') + 'Z').toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }); } catch { return ''; } };
function PageMenu({ page, canManage, onLock, onDelete, onLog }) {
  return (
    <Popover width={226} align="right" trigger={<button className="icon-btn" title="Page options"><DotsThree size={20} weight="bold" /></button>}>
      {(close) => <>
        <div className="popmenu-info">Edited {fmtDate(page.updated_at)}{page.is_public ? <span className="pm-pub"><Globe size={11} /> Published</span> : null}</div>
        <div className="popmenu-item" onClick={() => { close(); onLog(); }}><ClockCounterClockwise size={15} /> Changelog</div>
        {canManage && <div className="popmenu-item" onClick={() => { onLock(); close(); }}><span className="lock-ico" key={page.locked ? 'l' : 'u'}>{page.locked ? <Lock size={15} weight="fill" /> : <LockOpen size={15} weight="fill" />}</span> {page.locked ? 'Unlock page' : 'Lock (read-only)'}</div>}
        {page.is_public && <div className="popmenu-item" onClick={() => { navigator.clipboard?.writeText(location.origin + '/p/' + page.id).catch(() => {}); close(); }}><LinkSimple size={15} /> Copy public link</div>}
        {canManage && <><div className="popmenu-sep" /><div className="popmenu-item danger" onClick={() => { close(); onDelete(); }}><Trash2 size={15} /> Delete page</div></>}
      </>}
    </Popover>
  );
}
function Changelog({ pageId, onClose }) {
  const [items, setItems] = useState(null);
  useEffect(() => { setItems(null); api('/pages/' + pageId + '/log').then(setItems).catch(() => setItems([])); }, [pageId]);
  return (
    <div className="clog">
      <div className="clog-head"><ClockCounterClockwise size={16} /> Changelog<span className="grow" /><X size={16} className="x" onClick={onClose} /></div>
      <div className="clog-list">
        {items === null && <div className="muted small clog-empty">Loading…</div>}
        {items && items.length === 0 && <div className="muted small clog-empty">No activity yet. Edits, renames, and moves will show up here.</div>}
        {(items || []).map(l => (
          <div className="clog-item" key={l.id}>
            <span className={'clog-act a' + (l.act === '+' ? 'add' : l.act === '-' ? 'del' : 'mod')}>{l.act === '-' ? '−' : l.act}</span>
            <Avatar user={l.user} size={24} />
            <div className="clog-main">
              <div className="clog-line"><b>{l.user.name}</b> {l.detail}</div>
              <div className="muted" style={{ fontSize: 11 }}>{fmtWhen(l.created_at)}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
function fmtWhen(s) { try { const d = new Date(String(s).replace(' ', 'T') + 'Z'); const sec = (Date.now() - d) / 1000; if (sec < 60) return 'just now'; if (sec < 3600) return Math.floor(sec / 60) + 'm ago'; if (sec < 86400) return Math.floor(sec / 3600) + 'h ago'; if (sec < 604800) return Math.floor(sec / 86400) + 'd ago'; return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }); } catch { return ''; } }
function escHtml(s) { return String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
function renderMentions(body) { return escHtml(body).replace(/(^|\s)@(\w+)/g, '$1<span class="mention">@$2</span>'); }
function Comments({ pageId, members, me }) {
  const [list, setList] = useState([]);
  const [text, setText] = useState('');
  const [mentions, setMentions] = useState([]);
  const [mq, setMq] = useState(null);
  const ta = useRef();
  const [composing, setComposing] = useState(false);
  const load = () => api('/pages/' + pageId + '/comments').then(setList).catch(() => setList([]));
  useEffect(() => { setText(''); setMentions([]); setComposing(false); load(); }, [pageId]);
  useEffect(() => { if (composing) ta.current?.focus(); }, [composing]);
  const onChange = (e) => { setText(e.target.value); const m = e.target.value.slice(0, e.target.selectionStart).match(/@(\w*)$/); setMq(m ? m[1].toLowerCase() : null); };
  const pick = (mem) => { const nm = (mem.name || mem.email).split(' ')[0]; const caret = ta.current.selectionStart; const before = text.slice(0, caret).replace(/@(\w*)$/, '@' + nm + ' '); setText(before + text.slice(caret)); setMentions(ms => ms.find(x => x.id === mem.id) ? ms : [...ms, { id: mem.id, name: nm }]); setMq(null); setTimeout(() => ta.current?.focus(), 0); };
  const post = async () => { const body = text.trim(); if (!body) return; const ids = mentions.filter(m => body.includes('@' + m.name)).map(m => m.id); try { await api('/pages/' + pageId + '/comments', { method: 'POST', body: { body, mentions: ids } }); } catch {} setText(''); setMentions([]); load(); };
  const matches = mq != null ? members.filter(m => m.id !== me.id && (m.name || m.email).toLowerCase().includes(mq)).slice(0, 6) : [];
  if (!list.length && !composing) return (
    <div className="comments"><div className="cm-mini" onClick={() => setComposing(true)}><ChatCircle size={15} /> Add a comment</div></div>
  );
  return (
    <div className="comments">
      <div className="cm-head"><ChatCircle size={16} weight="fill" /> Comments{list.length ? <span className="muted small"> {list.length}</span> : null}</div>
      {list.map(c => (
        <div className="cm" key={c.id}>
          <Avatar user={c.author} size={28} />
          <div className="cm-main">
            <div className="cm-meta"><b>{c.author.name}</b> <span className="muted small">{fmtWhen(c.created_at)}</span>{c.mine && <button className="cm-del" title="Delete" onClick={() => api('/comments/' + c.id, { method: 'DELETE' }).then(load)}><X size={11} /></button>}</div>
            <div className="cm-text" dangerouslySetInnerHTML={{ __html: renderMentions(c.body) }} />
          </div>
        </div>
      ))}
      <div className="cm-compose">
        <Avatar user={me} size={28} />
        <div className="cm-input">
          <textarea ref={ta} value={text} placeholder="Add a comment…  @ to mention" rows={1} onChange={onChange}
            onInput={e => { e.target.style.height = 'auto'; e.target.style.height = e.target.scrollHeight + 'px'; }}
            onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); post(); } }} />
          {matches.length > 0 && <div className="cm-ment">{matches.map(m => <div className="cm-mopt" key={m.id} onMouseDown={e => { e.preventDefault(); pick(m); }}><Avatar user={m} size={20} /> {m.name || m.email}</div>)}</div>}
          {text.trim() && <div className="cm-act"><span className="muted small">⌘↵ to send</span><button className="btn-soft" onClick={post}>Comment</button></div>}
        </div>
      </div>
    </div>
  );
}
function Inbox({ onOpen }) {
  const [open, setOpen] = useState(false);
  const [data, setData] = useState({ unread: 0, items: [] });
  const load = () => api('/inbox').then(setData).catch(() => {});
  useEffect(() => { load(); const t = setInterval(load, 30000); return () => clearInterval(t); }, []);
  const clickItem = (n) => { api('/inbox/read', { method: 'POST', body: { id: n.id } }).then(load).catch(() => {}); setOpen(false); if (n.page_id) onOpen(n.page_id); };
  return (
    <span className="inbox-wrap">
      <button className="icon-btn" onClick={() => { setOpen(v => !v); if (!open) load(); }} title="Inbox"><Bell size={18} />{data.unread > 0 && <span className="inbox-badge">{data.unread > 9 ? '9+' : data.unread}</span>}</button>
      {open && <>
        <div className="picker-overlay" onClick={() => setOpen(false)} />
        <div className="inbox-pop">
          <div className="inbox-head"><span>Inbox</span>{data.unread > 0 && <span className="inbox-mark" onClick={() => api('/inbox/read', { method: 'POST', body: {} }).then(load)}>Mark all read</span>}</div>
          <div className="inbox-list">
            {data.items.length === 0 && <div className="inbox-empty muted small">No notifications yet. Mentions and comments land here.</div>}
            {data.items.map(n => (
              <div className={'inbox-item' + (n.read ? '' : ' unread')} key={n.id} onClick={() => clickItem(n)}>
                <Avatar user={n.actor} size={26} />
                <div className="ib-main">
                  <div className="ib-line"><b>{n.actor.name}</b> {n.type === 'mention' ? 'mentioned you' : 'commented'}{n.page ? <> on <PageIcon icon={n.page.icon} size={12} /> {n.page.title || 'Untitled'}</> : null}</div>
                  {n.body && <div className="ib-snip muted small">{n.body}</div>}
                  <div className="muted" style={{ fontSize: 11 }}>{fmtWhen(n.created_at)}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </>}
    </span>
  );
}
// ---------- workspace ----------
function Workspace({ me, setMe, onLogout }) {
  const confirm = useConfirm();
  const [pages, setPages] = useState([]);
  useEffect(() => { feedPageMeta(pages); }, [pages]);
  const [workspaces, setWorkspaces] = useState([]);
  const [currentWsId, setCurrentWsId] = useState(() => localStorage.getItem('wsId') || null);
  const [wsPicker, setWsPicker] = useState(false);
  const [wsMenu, setWsMenu] = useState(false);
  const [wsModal, setWsModal] = useState(false);
  const [users, setUsers] = useState([]);
  const [currentId, setCurrentId] = useState(null);
  const currentIdRef = useRef(null); currentIdRef.current = currentId;
  const popRef = useRef(false);
  useEffect(() => {
    history.replaceState({ pageId: currentId }, '');
    const onPop = (e) => { popRef.current = true; setCurrentId(e.state?.pageId ?? null); };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);
  useEffect(() => {
    if (popRef.current) { popRef.current = false; return; }
    if (history.state && history.state.pageId === currentId) return;
    history.pushState({ pageId: currentId }, '');
  }, [currentId]);
  const [page, setPage] = useState(null);
  const [sharing, setSharing] = useState(false);
  const [logOpen, setLogOpen] = useState(false);
  const [tagFilter, setTagFilter] = useState(null);
  const [settings, setSettings] = useState(false);
  const [searching, setSearching] = useState(false);
  const [iconPicker, setIconPicker] = useState(false);
  const [backlinks, setBacklinks] = useState([]);
  const [blOpen, setBlOpen] = useState(false);
  // per-user UI prefs (tree collapse, sidebar open/width) saved to the account, debounced
  const prefs = useMemo(() => { try { return JSON.parse(me.prefs || '{}'); } catch { return {}; } }, []);
  const prefsRef = useRef(prefs);
  const prefTimer = useRef(null);
  const savePref = (patch) => {
    prefsRef.current = { ...prefsRef.current, ...patch };
    clearTimeout(prefTimer.current);
    prefTimer.current = setTimeout(() => api('/me', { method: 'PUT', body: { prefs: prefsRef.current } }).catch(() => {}), 700);
  };
  const [sidebar, setSidebar] = useState(prefs.sidebar !== false);
  const [sbWidth, setSbWidth] = useState(() => Math.max(200, Math.min(480, prefs.sbWidth || 260)));
  const startSbResize = (e) => {
    e.preventDefault();
    const startX = e.clientX, startW = sbWidth;
    const move = (ev) => setSbWidth(Math.max(200, Math.min(480, startW + ev.clientX - startX)));
    const up = (ev) => {
      document.removeEventListener('pointermove', move); document.removeEventListener('pointerup', up);
      document.body.classList.remove('sb-resizing');
      savePref({ sbWidth: Math.max(200, Math.min(480, startW + ev.clientX - startX)) });
    };
    document.body.classList.add('sb-resizing');
    document.addEventListener('pointermove', move); document.addEventListener('pointerup', up);
  };
  const saveTimer = useRef(null);
  const editorInsertRef = useRef(null);
  const coverInputRef = useRef(null);
  const onLink = (pageId, x, y) => { const p = pages.find(pp => pp.id === pageId); if (p && editorInsertRef.current) editorInsertRef.current(p, x, y); };
  const currentWs = workspaces.find(w => w.id === currentWsId) || workspaces[0] || { name: 'Wiki', icon: 'ph:BookOpen' };
  const [wsMembers, setWsMembers] = useState([]);
  useEffect(() => { if (currentWsId) api('/workspaces/' + currentWsId + '/members').then(setWsMembers).catch(() => setWsMembers([])); }, [currentWsId]);
  const canManage = me.is_admin === 1 || wsMembers.find(m => m.id === me.id)?.role === 'manage';
  const crumbs = useMemo(() => {
    const byId = Object.fromEntries(pages.map(p => [p.id, p]));
    const chain = []; const seen = new Set(); let c = byId[currentId];
    while (c && !seen.has(c.id)) { seen.add(c.id); chain.unshift(c); c = c.parent_id ? byId[c.parent_id] : null; }
    return chain;
  }, [pages, currentId]);
  const loadWs = () => api('/workspaces').then(list => { setWorkspaces(list); setCurrentWsId(cur => (cur && list.find(w => w.id === cur)) ? cur : (list[0]?.id || null)); });
  const refreshTree = () => currentWsId ? api('/pages?workspace=' + currentWsId).then(list => setPages(prev => treeSig(prev) === treeSig(list) ? prev : list)) : Promise.resolve();
  const treeSync = useMemo(() => {
    if (!currentWsId) return null;
    const doc = new Y.Doc();
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const provider = new WebsocketProvider(`${proto}://${location.host}/collab`, 'tree-' + currentWsId, doc);
    return { doc, provider, map: doc.getMap('tree') };
  }, [currentWsId]);
  useEffect(() => () => { if (treeSync) { treeSync.provider.destroy(); treeSync.doc.destroy(); } }, [treeSync]);
  useEffect(() => {
    if (!treeSync) return;
    const obs = (e) => {
      refreshTree();
      // live page-meta refresh: if someone bumps the page we're viewing (lock/unlock,
      // publish, etc.), refetch it so read-only state updates without a reload
      try { const cid = currentIdRef.current; if (cid && e?.keysChanged?.has('p:' + cid)) api('/pages/' + cid).then(setPage).catch(() => {}); } catch {}
    };
    treeSync.map.observe(obs);
    return () => { try { treeSync.map.unobserve(obs); } catch {} };
  }, [treeSync]);
  const bumpTree = () => { try { if (treeSync) treeSync.map.set('v', (treeSync.map.get('v') || 0) + 1); } catch {} };
  const bumpPage = (id) => { try { if (treeSync) treeSync.map.set('p:' + id, (treeSync.map.get('p:' + id) || 0) + 1); } catch {} };
  const switchWs = (id) => { localStorage.setItem('wsId', id); setCurrentWsId(id); setCurrentId(null); setWsMenu(false); };
  const createWs = async ({ name, icon }) => { const w = await api('/workspaces', { method: 'POST', body: { name, icon } }); await loadWs(); switchWs(w.id); setWsModal(false); };
  useEffect(() => { loadWs(); api('/users').then(setUsers).catch(() => {}); }, []);
  useEffect(() => { if (currentWsId) refreshTree(); }, [currentWsId]);
  useEffect(() => { if (!currentId) { setPage(null); return; } api('/pages/' + currentId).then(p => { if (p.view === 'column' && p.parent_id) setCurrentId(p.parent_id); else setPage(p); }).catch(() => setPage(null)); }, [currentId]);
  useEffect(() => { if (!currentId) { setBacklinks([]); return; } api('/pages/' + currentId + '/backlinks').then(setBacklinks).catch(() => setBacklinks([])); }, [currentId]);
  useEffect(() => { const h = (e) => { if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setSearching(true); } }; window.addEventListener('keydown', h); return () => window.removeEventListener('keydown', h); }, []);

  const newPage = async (parent_id = null) => { const p = await api('/pages', { method: 'POST', body: { parent_id, title: 'Untitled', workspace_id: currentWsId } }); await refreshTree(); bumpTree(); setCurrentId(p.id); };
  const del = async (id) => { await api('/pages/' + id, { method: 'DELETE' }); if (currentId === id) setCurrentId(null); refreshTree(); bumpTree(); };
  const move = async (dragId, targetId, zone) => {
    let parent_id, position;
    if (zone === 'root') { parent_id = null; position = (Math.max(0, ...pages.filter(p => !p.parent_id).map(p => p.position)) || 0) + 1; }
    else if (zone === 'inside') { parent_id = targetId; position = (Math.max(0, ...pages.filter(p => p.parent_id === targetId).map(p => p.position)) || 0) + 1; }
    else {
      const t = pages.find(p => p.id === targetId); parent_id = t.parent_id;
      const sibs = pages.filter(p => p.parent_id === parent_id && p.id !== dragId).sort((a, b) => a.position - b.position);
      const ti = sibs.findIndex(p => p.id === targetId);
      const before = zone === 'before' ? sibs[ti - 1] : sibs[ti]; const after = zone === 'before' ? sibs[ti] : sibs[ti + 1];
      position = ((before?.position ?? (after?.position ?? 1) - 1) + (after?.position ?? (before?.position ?? 0) + 1)) / 2;
    }
    setPages(ps => ps.map(p => p.id === dragId ? { ...p, parent_id, position } : p));
    try { await api('/pages/' + dragId, { method: 'PUT', body: { parent_id, position } }); }
    catch { /* rejected (e.g. locked / read-only target) — refreshTree below reverts the optimistic move */ }
    refreshTree(); bumpTree();
  };
  const save = (patch) => { clearTimeout(saveTimer.current); saveTimer.current = setTimeout(async () => {
    const u = await api('/pages/' + page.id, { method: 'PUT', body: patch });
    setPages(ps => ps.map(p => p.id === u.id ? { ...p, title: u.title, icon: u.icon, is_public: u.is_public } : p));
    if (patch.title !== undefined || patch.icon !== undefined) bumpTree();
  }, 450); };
  const pickCover = async (e) => { const f = e.target.files?.[0]; if (!f) return; const data = await fileToCover(f); setPage(pg => ({ ...pg, cover: data })); save({ cover: data }); e.target.value = ''; };
  const setCover = (v) => { setPage(pg => ({ ...pg, cover: v })); save({ cover: v }); };
  const [templates, setTemplates] = useState([]);
  const [tplMenu, setTplMenu] = useState(false);
  const loadTemplates = () => { if (currentWsId) api('/workspaces/' + currentWsId + '/templates').then(setTemplates).catch(() => setTemplates([])); };
  useEffect(() => { loadTemplates(); }, [currentWsId]);
  const newFromTemplate = async (tid) => { const t = await api('/templates/' + tid); const p = await api('/pages', { method: 'POST', body: { title: t.name, workspace_id: currentWsId } }); await api('/pages/' + p.id, { method: 'PUT', body: { content: t.content, icon: t.icon } }); await refreshTree(); bumpTree(); setCurrentId(p.id); };
  const newBoard = async () => {
    const p = await api('/pages', { method: 'POST', body: { title: 'Untitled', workspace_id: currentWsId } });
    await api('/pages/' + p.id, { method: 'PUT', body: { view: 'board', icon: 'ph:SquaresFour' } });
    const defs = [['To do', 'dot:gray', 'member'], ['In progress', 'dot:blue', 'member'], ['Approved', 'dot:green', 'manager']];
    for (let i = 0; i < defs.length; i++) { const c = await api('/pages', { method: 'POST', body: { title: defs[i][0], workspace_id: currentWsId, parent_id: p.id } }); await api('/pages/' + c.id, { method: 'PUT', body: { view: 'column', icon: defs[i][1], col_perm: defs[i][2], position: i } }); }
    await refreshTree(); bumpTree(); setCurrentId(p.id);
  };
  const saveAsTemplate = async () => { if (!page) return; const fresh = await api('/pages/' + page.id); await api('/workspaces/' + currentWsId + '/templates', { method: 'POST', body: { name: fresh.title || 'Untitled', icon: fresh.icon, content: fresh.content } }); loadTemplates(); };
  const delTemplate = async (tid) => { await api('/templates/' + tid, { method: 'DELETE' }); loadTemplates(); };
  const setView = (v) => { setPage(pg => ({ ...pg, view: v })); save({ view: v }); };
  const addColumn = async (boardId) => {
    const n = pages.filter(p => p.parent_id === boardId && p.view === 'column').length;
    const c = await api('/pages', { method: 'POST', body: { title: 'New column', workspace_id: currentWsId, parent_id: boardId } });
    await api('/pages/' + c.id, { method: 'PUT', body: { view: 'column', icon: 'dot:gray', col_perm: 'member', position: n } });
    await refreshTree(); bumpTree();
  };
  const updateColumn = (colId, patch) => { setPages(ps => ps.map(p => p.id === colId ? { ...p, ...patch } : p)); api('/pages/' + colId, { method: 'PUT', body: patch }).then(() => bumpTree()); };
  const deleteColumn = async (colId) => {
    if (!(await confirm('Delete this column? Its cards move to the first remaining column.', { danger: true, confirmLabel: 'Delete column' }))) return;
    const others = pages.filter(p => p.parent_id === page.id && p.view === 'column' && p.id !== colId).sort((a, b) => (a.position || 0) - (b.position || 0));
    if (others.length) for (const c of pages.filter(p => p.parent_id === colId)) await api('/pages/' + c.id, { method: 'PUT', body: { parent_id: others[0].id } });
    await api('/pages/' + colId, { method: 'DELETE' }); await refreshTree(); bumpTree();
  };
  const addCard = async (columnId) => { await api('/pages', { method: 'POST', body: { parent_id: columnId, title: 'Untitled', workspace_id: currentWsId } }); await refreshTree(); bumpTree(); };
  const deleteCard = async (cardId) => { setPages(ps => ps.filter(p => p.id !== cardId)); try { await api('/pages/' + cardId, { method: 'DELETE' }); } catch {} refreshTree(); bumpTree(); };
  const moveCard = async (cardId, columnId, beforeId) => {
    const sibs = pages.filter(p => p.parent_id === columnId && p.id !== cardId).sort((a, b) => (a.position || 0) - (b.position || 0));
    let position;
    if (!beforeId) position = (sibs.length ? (sibs[sibs.length - 1].position || 0) : 0) + 1;
    else { const i = sibs.findIndex(s => s.id === beforeId); const bef = sibs[i - 1], aft = sibs[i]; position = ((bef?.position ?? ((aft?.position ?? 1) - 1)) + (aft?.position ?? ((bef?.position ?? 0) + 1))) / 2; }
    setPages(ps => ps.map(p => p.id === cardId ? { ...p, parent_id: columnId, position } : p));
    await api('/pages/' + cardId, { method: 'PUT', body: { parent_id: columnId, position } }); bumpTree();
  };
  const setListCards = (v) => { setPage(pg => ({ ...pg, list_cards: v ? 1 : 0 })); save({ list_cards: v }); bumpTree(); };
  const setLocked = async (v) => { setPage(pg => ({ ...pg, locked: v ? 1 : 0, can_edit: v ? canManage : true })); await api('/pages/' + page.id, { method: 'PUT', body: { locked: v } }); bumpTree(); bumpPage(page.id); api('/pages/' + page.id).then(setPage).catch(() => {}); };
  const tags = page ? normTags(parseJSON(page.tags, [])) : [];

  return (
    <div className="app">
      <aside className="sidebar" style={{ display: sidebar ? 'flex' : 'none', width: sbWidth, minWidth: sbWidth }}>
        <div className="sb-resize" onPointerDown={startSbResize} title="Drag to resize" />
        <div className="sidebar-head">
          <div className="row between">
            <div className="brand">
              <span className="ws-icon" onClick={() => setWsPicker(v => !v)} style={{ cursor: 'pointer', position: 'relative' }}>
                <PageIcon icon={currentWs.icon} size={22} />
                {wsPicker && <IconPicker onPick={async (v) => { await api('/workspaces/' + currentWsId, { method: 'PUT', body: { icon: v } }); loadWs(); setWsPicker(false); }} onClose={() => setWsPicker(false)} />}
              </span>
              <span className="ws-name" onClick={() => setWsMenu(v => !v)} style={{ position: 'relative' }}>
                <span className="tl-text">{currentWs.name}</span><ChevronDown size={15} className="ws-caret" />
                {wsMenu && <>
                  <div className="picker-overlay" onClick={e => { e.stopPropagation(); setWsMenu(false); }} />
                  <div className="ws-menu" onClick={e => e.stopPropagation()}>
                    {workspaces.map(w => <div className={'ws-item' + (w.id === currentWsId ? ' on' : '')} key={w.id} onClick={() => switchWs(w.id)}><PageIcon icon={w.icon} size={17} /><span className="grow">{w.name}</span></div>)}
                    {me.is_admin === 1 && <div className="ws-item new" onClick={() => { setWsMenu(false); setWsModal(true); }}><Plus size={15} /> New workspace</div>}
                  </div>
                </>}
              </span>
            </div>
            <span className="row" style={{ gap: 2 }}>
              <Inbox onOpen={setCurrentId} />
              <button className="icon-btn" onClick={() => setSearching(true)} title="Search (⌘K)"><SearchIcon size={18} /></button>
              <button className="icon-btn" onClick={() => { setSidebar(false); savePref({ sidebar: false }); }} title="Collapse sidebar"><Menu size={18} /></button>
            </span>
          </div>
        </div>
        <div className="tree-scroll">
          <div className={'root-node' + (!currentId ? ' on' : '')} onClick={() => setCurrentId(null)} title="Workspace overview & map"><Share2 size={17} /><span>Overview</span></div>
          <Tree pages={pages} currentId={currentId} onOpen={setCurrentId} onNew={newPage} onDelete={del} onMove={move} onLink={onLink} canManage={canManage} collapsedInit={prefs.treeCollapsed} onCollapse={(ids) => savePref({ treeCollapsed: ids })} />
          {canManage && <div className="newpage-wrap">
            <button className="newpage" onClick={() => setTplMenu(v => !v)}><Plus size={16} /> New page</button>
            {tplMenu && <>
              <div className="picker-overlay" onClick={() => setTplMenu(false)} />
              <div className="tpl-menu">
                <div className="tpl-item" onClick={() => { setTplMenu(false); newPage(null); }}><Pencil size={15} /> New doc</div>
                <div className="tpl-item" onClick={() => { setTplMenu(false); newBoard(); }}><BoardGlyph size={15} /> New board</div>
                {templates.length > 0 && <div className="tpl-sec">Templates</div>}
                {templates.map(t => <div className="tpl-item" key={t.id} onClick={() => { setTplMenu(false); newFromTemplate(t.id); }}><PageIcon icon={t.icon || 'ph:File'} size={16} /><span className="grow">{t.name}</span><span className="tpl-x" onClick={e => { e.stopPropagation(); delTemplate(t.id); }}>×</span></div>)}
                {page && <div className="tpl-item save" onClick={() => { setTplMenu(false); saveAsTemplate(); }}><Plus size={14} /> Save current page as template</div>}
              </div>
            </>}
          </div>}
        </div>
        <div className="sidebar-foot" onClick={() => setSettings(true)} title="Settings">
          <Avatar user={me} size={30} /><span className="who">{me.name || me.email}{me.is_admin ? ' ★' : ''}</span><SettingsIcon size={17} className="cog" />
        </div>
      </aside>
      {!sidebar && <button className="reopen-btn" onClick={() => { setSidebar(true); savePref({ sidebar: true }); }} title="Open sidebar"><Menu size={18} /></button>}
      <main className={'main' + (sidebar ? '' : ' no-sidebar')}>
        {!page && (pages.length === 0
          ? <div className="empty-home">
              <Logo size={52} />
              <div className="empty-title">{currentWs.name}</div>
              <div className="empty-sub">{canManage ? 'Create your first page or board to get started.' : 'No pages here yet.'}</div>
              {canManage && <div className="row gap" style={{ marginTop: 18 }}>
                <button className="btn-soft" onClick={() => newPage(null)}><Pencil size={15} /> New doc</button>
                <button className="btn-soft" onClick={() => newBoard()}><BoardGlyph size={15} /> New board</button>
              </div>}
            </div>
          : <WorkspaceHome workspace={currentWs} pages={pages} canManage={canManage} onOpen={setCurrentId} onNewDoc={() => newPage(null)} onNewBoard={() => newBoard()} onTagClick={(name, color) => setTagFilter({ name, color })} />)}
        {page && (
          <>
            <div className="page-bar">
              <div className="crumbs-trail">
                <span className="crumb" onClick={() => setCurrentId(null)}><PageIcon icon={currentWs.icon} size={14} /><span className="cr-txt">{currentWs.name}</span></span>
                {crumbs.map(c => <span className="crumb" key={c.id} onClick={() => setCurrentId(c.id)}><ChevronRight size={13} className="cr-sep" /><PageIcon icon={c.icon} size={14} /><span className="cr-txt">{c.title || 'Untitled'}</span></span>)}
              </div>
              <div className="page-bar-right">
                {page.locked && <span className="chip-mini" title={page.can_admin ? 'Locked — read-only' : 'Locked by a manager'}><Lock size={11} weight="fill" /> Locked</span>}
                {!page.can_edit && !page.locked && <span className="chip-mini"><Eye size={11} /> View only</span>}
                <FacePile members={wsMembers} onClick={() => page.can_admin && setSharing(true)} />
                {page.can_admin && <button className="btn-share" onClick={() => setSharing(true)}><Share2 size={13} /> Share</button>}
                <PageMenu page={page} canManage={page.can_admin} onLog={() => setLogOpen(true)} onLock={() => setLocked(!page.locked)} onDelete={async () => { if (await confirm('Delete this page? It moves to Trash.', { danger: true, confirmLabel: 'Delete page' })) { const parent = page.parent_id; await api('/pages/' + page.id, { method: 'DELETE' }); setCurrentId(parent || null); refreshTree(); bumpTree(); } }} />
              </div>
            </div>
            <input ref={coverInputRef} type="file" accept="image/*" hidden onChange={pickCover} />
            {page.cover && <div className="cover" style={{ backgroundImage: `url(${page.cover})` }}>
              {page.can_edit && <div className="cover-actions">
                <button className="cover-btn" onClick={() => coverInputRef.current.click()}>Change cover</button>
                <button className="cover-btn" onClick={() => setCover(null)}>Remove</button>
              </div>}
            </div>}
            <div className={'doc' + (page.view === 'board' ? ' board-view' : '')} key={page.id} onClick={e => { const m = e.target.closest?.('.page-mention'); if (m) setCurrentId(m.getAttribute('data-page')); }}>
              {page.can_edit && !page.cover && <button className="add-cover-btn" onClick={() => coverInputRef.current.click()}>🖼 Add cover</button>}
              <div className="page-title-row">
                <span className="emoji-wrap">
                  <button className="emoji-in" disabled={!page.can_edit} onClick={() => setIconPicker(v => !v)}><PageIcon icon={page.icon} size={48} /></button>
                  {iconPicker && <IconPicker onPick={(v) => { setPage({ ...page, icon: v }); save({ icon: v }); }} onClose={() => setIconPicker(false)} />}
                </span>
                <textarea className="title-in" value={page.title} placeholder="Untitled" disabled={!page.can_edit} rows={1} ref={el => { if (el) { el.style.height = 'auto'; el.style.height = el.scrollHeight + 'px'; } }} onKeyDown={e => { if (e.key === 'Enter') e.preventDefault(); }} onInput={e => { e.target.style.height = 'auto'; e.target.style.height = e.target.scrollHeight + 'px'; }} onChange={e => { setPage({ ...page, title: e.target.value.replace(/\n/g, '') }); save({ title: e.target.value.replace(/\n/g, '') }); }} />
              </div>
              {page.view === 'board'
                ? <>
                {page.can_edit
                  ? <textarea className="board-desc-in" placeholder="Add a description…" rows={1} ref={el => { if (el) { el.style.height = 'auto'; el.style.height = el.scrollHeight + 'px'; } }} value={page.description || ''} onInput={e => { e.target.style.height = 'auto'; e.target.style.height = e.target.scrollHeight + 'px'; }} onChange={e => { setPage({ ...page, description: e.target.value }); save({ description: e.target.value }); }} />
                  : (page.description ? <div className="board-desc-text">{page.description}</div> : null)}
                <Board page={page} pages={pages} canManage={canManage} canContribute={!!page.can_edit} onOpen={setCurrentId} onAddCard={addCard} onMoveCard={moveCard} onDeleteCard={deleteCard} onAddColumn={addColumn} onUpdateColumn={updateColumn} onDeleteColumn={deleteColumn} />
                </>
                : <>
                <Properties tags={tags} editable={!!page.can_edit} workspace={currentWsId} onTagClick={(name, color) => setTagFilter({ name, color })} onChange={(t) => { setPage({ ...page, tags: JSON.stringify(t) }); save({ tags: t }); }} />
                <Editor page={page} editable={!!page.can_edit} pages={pages} insertRef={editorInsertRef} me={me} onChange={(content) => save({ content })} />
                {backlinks.length > 0 && <div className="backlinks">
                  <div className="bl-head clickable" onClick={() => setBlOpen(v => !v)}>{blOpen ? <ChevronDown size={11} /> : <ChevronRight size={11} />} Linked references <span className="muted">({backlinks.length})</span></div>
                  {blOpen && backlinks.map(b => <div className="bl" key={b.id} onClick={() => setCurrentId(b.id)}><PageIcon icon={b.icon} size={14} /><span>{b.title || 'Untitled'}</span></div>)}
                </div>}
                </>}
                <Comments pageId={page.id} members={wsMembers} me={me} />
            </div>
          </>
        )}
      </main>
      {tagFilter && <TagView tag={tagFilter.name} color={tagFilter.color} workspace={currentWsId} onOpen={setCurrentId} onClose={() => setTagFilter(null)} />}
      {sharing && page && <Share pageId={page.id} origin={location.origin} onClose={() => { setSharing(false); refreshTree(); }} />}
      {logOpen && page && <Changelog pageId={page.id} onClose={() => setLogOpen(false)} />}
      {settings && <Settings me={me} setMe={setMe} currentWs={currentWs} onWsChange={loadWs} onLogout={onLogout} onImported={() => { refreshTree(); bumpTree(); }} onClose={() => setSettings(false)} />}
      {searching && <Search workspace={currentWsId} onOpen={setCurrentId} onClose={() => setSearching(false)} />}
      {wsModal && <NewWorkspaceModal onCreate={createWs} onClose={() => setWsModal(false)} />}
    </div>
  );
}

// ---------- root ----------
function AppInner() {
  const pub = location.pathname.match(/^\/p\/(.+)$/);
  if (pub) return <PublicView id={pub[1]} />;
  const [me, setMe] = useState(undefined);
  const [ws, setWs] = useState({ name: 'Wiki', icon: 'ph:BookOpen' });
  useEffect(() => { api('/me').then(setMe).catch(() => setMe(null)); }, []);
  useEffect(() => { applyTheme(me && me.theme); }, [me]);
  useEffect(() => { api('/config').then(c => c.workspace && setWs(c.workspace)).catch(() => {}); }, []);
  if (me === undefined) return <div className="center muted">Loading…</div>;
  if (!me) return <Login onAuth={setMe} ws={ws} />;
  return <Workspace me={me} setMe={setMe} onLogout={async () => { await api('/auth/logout', { method: 'POST' }); setMe(null); }} />;
}

export default function App() { return <ConfirmProvider><AppInner /></ConfirmProvider>; }
