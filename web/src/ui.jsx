// Shared UI primitives: icons, themes, avatars, popovers, confirm dialog, formatting helpers.
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import * as GameIcons from 'react-icons/gi';
import * as Phosphor from '@phosphor-icons/react';
import { Eye, PencilSimple as Pencil, Crown } from '@phosphor-icons/react';
import EmojiPicker from 'emoji-picker-react';
export const ROLE_INFO = { read: { label: 'Read', icon: Eye }, write: { label: 'Write', icon: Pencil }, manage: { label: 'Manage', icon: Crown } };
export const PH = {};
for (const [k, v] of Object.entries(Phosphor)) {
  if (/^[A-Z]/.test(k) && !/Icon$/.test(k) && !['IconBase', 'IconContext', 'SSR'].includes(k) && v && (typeof v === 'object' || typeof v === 'function')) PH[k] = v;
}
export const PH_NAMES = Object.keys(PH);
export const GI = {};
for (const [k, v] of Object.entries(GameIcons)) { if (k.startsWith('Gi') && typeof v === 'function') GI[k.slice(2)] = v; }
export const GI_NAMES = Object.keys(GI);
export const THEMES = [
  { id: 'amethyst', name: 'Amethyst', color: '#a78bdb' },
  { id: 'ocean', name: 'Ocean', color: '#6f9fe0' },
  { id: 'forest', name: 'Forest', color: '#5fc18a' },
  { id: 'slate', name: 'Slate', color: '#9aa6c0' },
  { id: 'rose', name: 'Rose', color: '#e08bb0' },
  { id: 'paper', name: 'Paper', color: '#f3f0f8', light: true },
];
export const isLightTheme = () => document.documentElement.getAttribute('data-theme') === 'paper';
export const applyTheme = (t) => { const id = THEMES.some(x => x.id === t) ? t : 'amethyst'; document.documentElement.setAttribute('data-theme', id); document.documentElement.style.colorScheme = id === 'paper' ? 'light' : 'dark'; };
export const USER_COLORS = ['#a78bdb', '#6f9fe0', '#5fc18a', '#e08bb0', '#e1a845', '#ff5d52', '#9a6dd7', '#2fb3a8'];
export const userColor = (id) => USER_COLORS[Math.abs(Number(id) || 0) % USER_COLORS.length];
export function Logo({ size = 32 }) {
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
export const treeSig = (list) => (list || []).map(p => `${p.id}:${p.title}:${p.parent_id}:${p.position}:${p.icon}:${p.is_public}:${p.status}:${p.view}:${p.locked}:${p.list_cards}`).join('|');
export const APP_VERSION = '1.4.0';
export function PageIcon({ icon, size = 18 }) {
  if (icon && icon.startsWith('dot:')) { const c = icon.slice(4); return <span style={{ width: Math.round(size * 0.62), height: Math.round(size * 0.62), borderRadius: '50%', background: BOARD_COLORS[c] || c || 'var(--muted)', display: 'inline-block', flex: 'none' }} />; }
  if (icon && icon.startsWith('ph:')) { const p = icon.split(':'); const I = PH[p[1]]; if (I) return <I size={size} weight="fill" color={p[2] || undefined} />; }
  if (icon && icon.startsWith('gi:')) { const p = icon.split(':'); const I = GI[p[1]]; if (I) return <I size={size} color={p[2] || undefined} style={{ flex: 'none' }} />; }
  const emoji = icon && !icon.startsWith('ph:') && !icon.startsWith('gi:') && !icon.startsWith('li:') ? icon : '📄';
  return <span style={{ fontSize: size, lineHeight: 1 }}>{emoji}</span>;
}
export function BoardGlyph({ size = 15 }) {
  return <svg width={size} height={size} viewBox="0 0 16 16" fill="currentColor" aria-hidden="true" style={{ flex: 'none' }}><rect x="1.5" y="2.5" width="3.4" height="11" rx="1.2" /><rect x="6.3" y="2.5" width="3.4" height="7.5" rx="1.2" /><rect x="11.1" y="2.5" width="3.4" height="9.3" rx="1.2" /></svg>;
}
// page reference inline content (#mention) + schema
export const BOARD_COLORS = { gray: '#9b9a97', blue: '#6f9fe0', green: '#5fc18a', amber: '#e1a845', red: '#ff5d52', purple: '#9a6dd7', pink: '#e08bb0' };
export function IconPicker({ onPick, onClose }) {
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
          ? <EmojiPicker onEmojiClick={e => { onPick(e.emoji); onClose(); }} theme={isLightTheme() ? 'light' : 'dark'} emojiStyle="native" width={352} height={358} previewConfig={{ showPreview: false }} skinTonesDisabled lazyLoadEmojis />
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

export const parseJSON = (s, fb) => { try { const v = JSON.parse(s ?? ''); return v ?? fb; } catch { return fb; } };
export const parseContent = (c) => { const a = parseJSON(c, null); return Array.isArray(a) && a.length ? a : undefined; };
// Notion palette (gray, brown, orange, yellow, green, blue, purple, pink, red) + 3 extra (teal, indigo, coral) — shared by tags & icons
export const TAG_COLORS = ['#9b9a97', '#bb8264', '#e3902f', '#dfab01', '#4dab6d', '#3f9cdb', '#9a6dd7', '#e255a1', '#ff5d52', '#2fb3a8', '#6d77e0', '#ff8a4c'];
export const tagColor = (t) => TAG_COLORS[[...String(t)].reduce((a, c) => a + c.charCodeAt(0), 0) % TAG_COLORS.length];
export const normTags = (arr) => (Array.isArray(arr) ? arr : []).map(t => typeof t === 'string' ? { name: t, color: tagColor(t) } : t).filter(t => t && t.name);

export function Avatar({ user, size = 24 }) {
  const ch = (user?.name || user?.email || '?').trim().slice(0, 1).toUpperCase();
  return user?.avatar
    ? <img className="avatar" src={user.avatar} alt="" style={{ width: size, height: size }} />
    : <span className="avatar ph" style={{ width: size, height: size, fontSize: size * 0.46 }}>{ch}</span>;
}

export function fileToAvatar(file) {
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
export function fileToCover(file) {
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

export const ConfirmCtx = React.createContext(async () => true);
export const useConfirm = () => React.useContext(ConfirmCtx);
export function ConfirmProvider({ children }) {
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

export function Popover({ trigger, width = 220, align = 'right', children }) {
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
export const fmtDate = (s) => { try { return new Date(String(s).replace(' ', 'T') + 'Z').toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }); } catch { return ''; } };
export function fmtWhen(s) { try { const d = new Date(String(s).replace(' ', 'T') + 'Z'); const sec = (Date.now() - d) / 1000; if (sec < 60) return 'just now'; if (sec < 3600) return Math.floor(sec / 60) + 'm ago'; if (sec < 86400) return Math.floor(sec / 3600) + 'h ago'; if (sec < 604800) return Math.floor(sec / 86400) + 'd ago'; return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }); } catch { return ''; } }
export function escHtml(s) { return String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
export function renderMentions(body) { return escHtml(body).replace(/(^|\s)@(\w+)/g, '$1<span class="mention">@$2</span>'); }
