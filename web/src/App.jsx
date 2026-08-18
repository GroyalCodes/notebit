import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useCreateBlockNote } from '@blocknote/react';
import * as Y from 'yjs';
import { WebsocketProvider } from 'y-websocket';
import JSZip from 'jszip';
import api from './api.js';
import { BookOpen, MagnifyingGlass as SearchIcon, Plus, Trash as Trash2, Gear as SettingsIcon, User, Users, Globe, Tag as TagIcon, X, CaretDown as ChevronDown, CaretRight as ChevronRight, PencilSimple as Pencil, Eye, ShareNetwork as Share2, DotsSixVertical as GripVertical, List as Menu, Crown, Lock, LockOpen, DotsThree, LinkSimple, Bell, ChatCircle, ClockCounterClockwise, Heart, Star, CopySimple, DownloadSimple, ListBullets, ArrowSquareOut } from '@phosphor-icons/react';
import { ROLE_INFO, THEMES, applyTheme, Logo, treeSig, APP_VERSION, PageIcon, BoardGlyph, BOARD_COLORS, IconPicker, parseJSON, TAG_COLORS, tagColor, normTags, Avatar, fileToAvatar, fileToCover, useConfirm, ConfirmProvider, Popover, fmtDate, fmtWhen, renderMentions } from './ui.jsx';
import { feedPageMeta, schema, ReadOnly } from './blocks.jsx';
import { Editor } from './editor.jsx';
// live registry so mention chips always show the page's CURRENT title/icon
// ---------- public read-only ----------
// ---------- confirm modal (replaces window.confirm) ----------
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
function Tree({ pages, currentId, onOpen, onNew, onDelete, onMove, onLink, onContext, canManage, collapsedInit, onCollapse }) {
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
          onContextMenu={e => { if (!onContext) return; e.preventDefault(); onContext(p.id, e.clientX, e.clientY); }}
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
// ---------- search (⌘K) ----------
function Search({ workspace, recent, pages, onOpen, onClose }) {
  const [q, setQ] = useState(''); const [res, setRes] = useState([]); const [hi, setHi] = useState(0);
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    if (!q.trim()) { setRes([]); setHi(0); return; }
    setLoading(true);
    const id = setTimeout(() => api('/search?q=' + encodeURIComponent(q.trim()) + (workspace ? '&workspace=' + workspace : '')).then(r => { setRes(r); setHi(0); }).catch(() => {}).finally(() => setLoading(false)), 120);
    return () => clearTimeout(id);
  }, [q]);
  const recents = !q.trim() ? (recent || []).map(id => pages.find(p => p.id === id)).filter(p => p && p.view !== 'column').slice(0, 8).map(p => ({ id: p.id, title: p.title, icon: p.icon })) : null;
  const list = recents || res;
  const open = (r) => { if (!r) return; onOpen(r.id); onClose(); };
  const listRef = useRef(null);
  useEffect(() => { listRef.current?.children?.[hi]?.scrollIntoView?.({ block: 'nearest' }); }, [hi]);
  const mark = (text) => { const ql = q.trim().toLowerCase(); if (!text) return null; const i = ql ? text.toLowerCase().indexOf(ql) : -1; if (i < 0) return text; return <>{text.slice(0, i)}<mark>{text.slice(i, i + ql.length)}</mark>{text.slice(i + ql.length)}</>; };
  return (
    <div className="modal-bg top" onClick={onClose}>
      <div className="card search-box" onClick={e => e.stopPropagation()}>
        <div className="search-in"><SearchIcon size={17} className="muted" /><input autoFocus placeholder="Search pages and text…" value={q} onChange={e => setQ(e.target.value)} onKeyDown={e => {
          if (e.key === 'Escape') { e.stopPropagation(); onClose(); }
          else if (e.key === 'ArrowDown') { e.preventDefault(); setHi(h => Math.min(h + 1, list.length - 1)); }
          else if (e.key === 'ArrowUp') { e.preventDefault(); setHi(h => Math.max(0, h - 1)); }
          else if (e.key === 'Enter') { e.preventDefault(); open(list[hi]); }
        }} /><kbd>esc</kbd></div>
        <div className="search-res" ref={listRef}>
          {recents && recents.length > 0 && <div className="sr-head">Recent</div>}
          {list.map((r, i) => <div className={'sr' + (i === hi ? ' hi' : '')} key={r.id} onMouseEnter={() => setHi(i)} onClick={() => open(r)}>
            <span className="ic"><PageIcon icon={r.icon} size={17} /></span>
            <span className="sr-main">
              <span className="sr-title">{mark(r.title || 'Untitled')}{r.parent ? <span className="sr-parent"> · {r.parent}</span> : null}</span>
              {r.snippet ? <span className="sr-snip">{mark(r.snippet)}</span> : null}
            </span>
          </div>)}
          {q.trim() && !loading && res.length === 0 && <div className="muted small pad sr-empty">No pages match “{q.trim()}”</div>}
          {!q.trim() && (!recents || recents.length === 0) && <div className="muted small pad sr-empty">Search titles and page text. <kbd className="kbd-inl">↑</kbd> <kbd className="kbd-inl">↓</kbd> to move, <kbd className="kbd-inl">↵</kbd> to open.</div>}
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
      <div className="muted small">Everyone with a NoteBit account. Super-admins manage every workspace and these accounts. Invite people into a workspace from the <b>People</b> tab.</div>
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
  const [busy, setBusy] = useState(false);
  const check = (force) => { setBusy(true); api('/update-check' + (force ? '?force=1' : '')).then(r => { setU(r); setBusy(false); }).catch(() => { setU({ current: APP_VERSION }); setBusy(false); }); };
  useEffect(() => { check(false); }, []);
  if (!u) return null;
  return (
  <>
    <div className="upd">
      <span>NoteBit <b>v{u.current}</b></span>
      <span className="row gap">
        {u.updateAvailable
          ? <a className="upd-new" href={u.url} target="_blank" rel="noreferrer">Update to v{u.latest} →</a>
          : <span className="muted small">You're up to date</span>}
        <button className="mini" disabled={busy} onClick={() => check(true)}>{busy ? 'Checking…' : 'Check now'}</button>
      </span>
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
        <div className="row gap">
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
  const [aurl, setAurl] = useState('');
  const [autostart, setAutostart] = useState(null);
  useEffect(() => { api('/admin/settings').then(r => { setS(r); setEfrom(r.mail_from || ''); setAurl(r.app_url || ''); }).catch(() => {}); api('/admin/autostart').then(setAutostart).catch(() => {}); }, []);
  const toggleAutostart = async () => { try { const r = await api('/admin/autostart', { method: 'POST', body: { enabled: !autostart?.enabled } }); setAutostart(r); } catch (e) { setEmsg(e.data?.error || 'error'); setTimeout(() => setEmsg(''), 3000); } };
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
      <h3>Access</h3>
      <div className="set-group">
        <div className="row between"><div className="col"><b>Open sign-up</b><span className="muted small">Let anyone with the link create an account</span></div>
          <label className="sw"><input type="checkbox" checked={!!s.allow_signup} onChange={toggle} /><span /></label></div>
      </div>
      <h3>Email invites</h3>
      <div className="set-group">
        <div className="row between"><div className="col"><span className="muted small">{s.email_configured ? (s.email_key_source === 'env' ? 'Configured via environment. ' : '') + 'Invites are emailed automatically.' : 'Not configured. Invites still work, but you must share the link by hand.'}</span></div>
          <span className={'role-badge'} style={{ color: s.email_configured ? '#5fc18a' : 'var(--muted)' }}>{s.email_configured ? 'On' : 'Off'}</span></div>
        <label className="fld"><span>Resend API key <a href="https://resend.com/api-keys" target="_blank" rel="noreferrer" style={{ color: 'var(--accent)' }}>(get one free)</a></span>
          <input type="password" placeholder={s.email_key_source === 'app' ? 'saved, enter a new key to replace' : 're_...'} value={ekey} onChange={e => setEkey(e.target.value)} /></label>
        <label className="fld"><span>From address (a domain verified at Resend, or leave blank)</span>
          <input placeholder="NoteBit <notes@yourdomain.com>" value={efrom} onChange={e => setEfrom(e.target.value)} /></label>
        <div className="row gap">
          <button className="mini gold" onClick={async () => { const body = { mail_from: efrom }; if (ekey.trim()) body.resend_key = ekey.trim(); const r = await api('/admin/settings', { method: 'PUT', body }); setS(r); setEkey(''); setEmsg('Saved ✓'); setTimeout(() => setEmsg(''), 2000); }}>Save email settings</button>
          <button className="mini" disabled={!s.email_configured} onClick={async () => { setEmsg('Sending…'); try { const r = await api('/admin/test-email', { method: 'POST', body: {} }); setEmsg(r.ok ? '✓ ' + r.detail : '✗ ' + r.detail); } catch { setEmsg('✗ failed'); } }}>Send test email</button>
          {emsg && <span className="muted small">{emsg}</span>}
        </div>
      </div>
      <h3>Server</h3>
      <div className="set-group">
        {autostart && (autostart.supported
          ? <div className="row between"><div className="col"><b>Start on boot</b><span className="muted small">Keep NoteBit running as a background service, and bring it back after a restart.</span></div>
              <label className="sw"><input type="checkbox" checked={!!autostart.enabled} onChange={toggleAutostart} /><span /></label></div>
          : <div className="row between"><div className="col"><b>Start on boot</b><span className="muted small">{autostart.managed === 'container' ? 'Managed by the host (Docker restart policy).' : 'Not available on this system.'}</span></div>
              <span className="role-badge muted small">{autostart.managed === 'container' ? 'Auto' : 'n/a'}</span></div>)}
        <div className="col"><b>Public URL</b><span className="muted small">Used in invite links. Set this when you serve NoteBit on your own domain.</span></div>
        <div className="row gap"><input className="grow" placeholder="https://notes.yourdomain.com" value={aurl} onChange={e => setAurl(e.target.value)} />
          <button className="mini gold" onClick={async () => { const r = await api('/admin/settings', { method: 'PUT', body: { app_url: aurl } }); setS(r); setEmsg('Saved ✓'); setTimeout(() => setEmsg(''), 2000); }}>Save</button></div>
      </div>
      <h3>Danger zone</h3>
      <div className="set-group danger">
        <div className="row between"><div className="col"><b>Delete this workspace</b><span className="muted small">Every page in it moves to trash and the workspace disappears for all members.</span></div>
          <button className="btn-danger" onClick={del}>Delete</button></div>
      </div>
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
function PageMenu({ page, canManage, canEdit, isFav, wordCount, onFav, onLock, onDelete, onLog, onVersions, onDuplicate, onExport, onCopyLink }) {
  return (
    <Popover width={236} align="right" trigger={<button className="icon-btn" title="Page options"><DotsThree size={20} weight="bold" /></button>}>
      {(close) => <>
        <div className="popmenu-info">
          <span>Edited {fmtDate(page.updated_at)}{page.is_public ? <span className="pm-pub"> · <Globe size={11} /> Published</span> : null}</span>
          {page.view !== 'board' && <span>{wordCount} word{wordCount === 1 ? '' : 's'}</span>}
        </div>
        <div className="popmenu-item" onClick={() => { close(); onFav(); }}><Star size={15} weight={isFav ? 'fill' : 'regular'} /> {isFav ? 'Remove from favorites' : 'Add to favorites'}</div>
        <div className="popmenu-item" onClick={() => { close(); onCopyLink(); }}><LinkSimple size={15} /> Copy link</div>
        {page.is_public && <div className="popmenu-item" onClick={() => { navigator.clipboard?.writeText(location.origin + '/p/' + page.id).catch(() => {}); close(); }}><Globe size={15} /> Copy public link</div>}
        <div className="popmenu-sep" />
        {canManage && <div className="popmenu-item" onClick={() => { close(); onDuplicate(); }}><CopySimple size={15} /> Duplicate</div>}
        {page.view !== 'board' && <div className="popmenu-item" onClick={() => { close(); onExport(); }}><DownloadSimple size={15} /> Export as Markdown</div>}
        {page.view !== 'board' && <div className="popmenu-item" onClick={() => { close(); onVersions(); }}><ClockCounterClockwise size={15} /> Version history</div>}
        <div className="popmenu-item" onClick={() => { close(); onLog(); }}><ListBullets size={15} /> Changelog</div>
        {canManage && <div className="popmenu-item" onClick={() => { onLock(); close(); }}><span className="lock-ico" key={page.locked ? 'l' : 'u'}>{page.locked ? <Lock size={15} weight="fill" /> : <LockOpen size={15} weight="fill" />}</span> {page.locked ? 'Unlock page' : 'Lock (read-only)'}</div>}
        {canManage && <><div className="popmenu-sep" /><div className="popmenu-item danger" onClick={() => { close(); onDelete(); }}><Trash2 size={15} /> Delete page</div></>}
      </>}
    </Popover>
  );
}
// ---------- version history ----------
function Versions({ page, canEdit, onRestore, onClose }) {
  const [items, setItems] = useState(null);
  const [sel, setSel] = useState(null);       // { id, title, content, created_at }
  const [busy, setBusy] = useState(false);
  const load = () => api('/pages/' + page.id + '/versions').then(setItems).catch(() => setItems([]));
  useEffect(() => { setItems(null); setSel(null); load(); }, [page.id]);
  const open = (v) => api('/versions/' + v.id).then(setSel).catch(() => {});
  const saveNow = async () => { setBusy(true); try { await api('/pages/' + page.id + '/versions', { method: 'POST' }); await load(); } finally { setBusy(false); } };
  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="card versions" onClick={e => e.stopPropagation()}>
        <div className="ver-list">
          <div className="clog-head"><ClockCounterClockwise size={16} /> Version history<span className="grow" />{canEdit && <button className="mini" disabled={busy} onClick={saveNow}>{busy ? '…' : 'Save version now'}</button>}</div>
          <div className="ver-items">
            {items === null && <div className="muted small clog-empty">Loading…</div>}
            {items && items.length === 0 && <div className="muted small clog-empty">No versions yet. NoteBit keeps a snapshot before edits (at most one every 10 minutes), or save one by hand.</div>}
            {(items || []).map(v => <div key={v.id} className={'ver-item' + (sel?.id === v.id ? ' on' : '')} onClick={() => open(v)}>
              <div className="ver-when">{fmtWhen(v.created_at)} <span className="muted">· {new Date(String(v.created_at).replace(' ', 'T') + 'Z').toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</span></div>
              <div className="muted small row gap"><Avatar user={v.user} size={16} /> {v.user?.name}{v.title !== page.title ? <> · “{v.title || 'Untitled'}”</> : null}</div>
            </div>)}
          </div>
        </div>
        <div className="ver-preview">
          <div className="ver-preview-head">
            <span className="muted small">{sel ? 'Preview from ' + fmtWhen(sel.created_at) : 'Pick a version to preview it'}</span>
            <span className="grow" />
            {sel && canEdit && <button className="btn-gold mini-gold" onClick={() => onRestore(sel.content)}>Restore this version</button>}
            <X size={17} className="x" onClick={onClose} />
          </div>
          <div className="ver-preview-body">{sel ? <ReadOnly key={sel.id} content={sel.content} /> : <div className="muted small pad">Restoring keeps a snapshot of the current text first, so nothing is lost.</div>}</div>
        </div>
      </div>
    </div>
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
  const [workspaces, setWorkspaces] = useState(null); // null = not loaded yet
  const [currentWsId, setCurrentWsId] = useState(() => localStorage.getItem('wsId') || null);
  const [wsPicker, setWsPicker] = useState(false);
  const [wsMenu, setWsMenu] = useState(false);
  const [wsModal, setWsModal] = useState(false);
  const [users, setUsers] = useState([]);
  // pages have real URLs (/page/<id>, optional #blockId), so refresh, back/forward and
  // shared links all work
  const pageIdFromUrl = () => (location.pathname.match(/^\/page\/([\w-]+)/) || [])[1] || null;
  const [currentId, setCurrentId] = useState(pageIdFromUrl);
  const currentIdRef = useRef(null); currentIdRef.current = currentId;
  const popRef = useRef(false);
  useEffect(() => {
    history.replaceState({ pageId: currentId }, '', currentId ? '/page/' + currentId + location.hash : '/');
    const onPop = (e) => { popRef.current = true; setCurrentId(e.state?.pageId ?? pageIdFromUrl()); };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);
  useEffect(() => {
    if (popRef.current) { popRef.current = false; return; }
    if (history.state && history.state.pageId === currentId) return;
    history.pushState({ pageId: currentId }, '', currentId ? '/page/' + currentId : '/');
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
  const [versionsOpen, setVersionsOpen] = useState(false);
  const [treeMenu, setTreeMenu] = useState(null); // { id, x, y }
  const titleRef = useRef(null);
  const focusTitleNext = useRef(false);
  const narrow = () => window.matchMedia('(max-width: 760px)').matches;
  // per-user UI prefs (tree collapse, sidebar open/width) saved to the account, debounced
  const prefs = useMemo(() => { try { return JSON.parse(me.prefs || '{}'); } catch { return {}; } }, []);
  const prefsRef = useRef(prefs);
  const prefTimer = useRef(null);
  const savePref = (patch) => {
    prefsRef.current = { ...prefsRef.current, ...patch };
    clearTimeout(prefTimer.current);
    prefTimer.current = setTimeout(() => api('/me', { method: 'PUT', body: { prefs: prefsRef.current } }).catch(() => {}), 700);
  };
  const [sidebar, setSidebar] = useState(() => prefs.sidebar !== false && !narrow());
  const setSidebarOpen = (v) => { setSidebar(v); if (!narrow()) savePref({ sidebar: v }); };
  const [favs, setFavs] = useState(() => Array.isArray(prefs.favs) ? prefs.favs : []);
  const toggleFav = (id) => setFavs(f => { const n = f.includes(id) ? f.filter(x => x !== id) : [...f, id]; savePref({ favs: n }); return n; });
  const [recent, setRecent] = useState(() => Array.isArray(prefs.recent) ? prefs.recent : []);
  const noteRecent = (id) => setRecent(r => { const n = [id, ...r.filter(x => x !== id)].slice(0, 10); savePref({ recent: n }); return n; });
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
  const editorApi = useRef(null);
  const coverInputRef = useRef(null);
  const onLink = (pageId, x, y) => { const p = pages.find(pp => pp.id === pageId); if (p && editorApi.current) editorApi.current.insertPageLink(p, x, y); };
  const noWorkspace = workspaces && workspaces.length === 0;
  const currentWs = (workspaces || []).find(w => w.id === currentWsId) || (workspaces || [])[0] || { name: noWorkspace ? 'No workspace' : '…', icon: 'ph:BookOpen' };
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
  useEffect(() => {
    if (!currentId) { setPage(null); return; }
    api('/pages/' + currentId).then(p => {
      if (p.view === 'column' && p.parent_id) { setCurrentId(p.parent_id); return; }
      if (p.workspace_id && p.workspace_id !== currentWsId) { localStorage.setItem('wsId', p.workspace_id); setCurrentWsId(p.workspace_id); }
      setPage(p); noteRecent(p.id);
      if (narrow()) setSidebar(false);
    }).catch(() => setPage(null));
  }, [currentId]);
  // "#blockId" deep links: scroll + flash once the editor has synced
  useEffect(() => {
    const hash = location.hash.slice(1); if (!page || !hash) return;
    let tries = 0; const t = setInterval(() => { if (editorApi.current?.scrollToBlock(hash) || ++tries > 30) { clearInterval(t); if (tries <= 30) history.replaceState(history.state, '', location.pathname); } }, 150);
    return () => clearInterval(t);
  }, [page?.id]);
  useEffect(() => { if (page && focusTitleNext.current) { focusTitleNext.current = false; setTimeout(() => { titleRef.current?.focus(); titleRef.current?.select?.(); }, 30); } }, [page?.id]);
  useEffect(() => { if (!currentId) { setBacklinks([]); return; } api('/pages/' + currentId + '/backlinks').then(setBacklinks).catch(() => setBacklinks([])); }, [currentId]);
  // shortcuts: ⌘K search · ⌘\ sidebar · ⌘⇧N new page (managers) · Esc closes the top-most panel
  const closersRef = useRef(null);
  closersRef.current = () => {
    if (searching) return setSearching(false);
    if (tagFilter) return setTagFilter(null);
    if (treeMenu) return setTreeMenu(null);
    if (sharing) return setSharing(false);
    if (versionsOpen) return setVersionsOpen(false);
    if (logOpen) return setLogOpen(false);
    if (settings) return setSettings(false);
    if (wsModal) return setWsModal(false);
    return false;
  };
  const shortcutRef = useRef(null);
  useEffect(() => {
    const h = (e) => {
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === 'k') { e.preventDefault(); setSearching(v => !v); }
      else if (mod && e.key === '\\') { e.preventDefault(); setSidebar(v => { if (!narrow()) savePref({ sidebar: !v }); return !v; }); }
      else if (mod && e.shiftKey && e.key.toLowerCase() === 'n') { e.preventDefault(); shortcutRef.current?.newPage?.(); }
      else if (e.key === 'Escape') { if (closersRef.current?.() !== false) e.preventDefault(); }
    };
    window.addEventListener('keydown', h); return () => window.removeEventListener('keydown', h);
  }, []);

  const newPage = async (parent_id = null) => { const p = await api('/pages', { method: 'POST', body: { parent_id, title: '', workspace_id: currentWsId } }); await refreshTree(); bumpTree(); focusTitleNext.current = true; setCurrentId(p.id); };
  shortcutRef.current = { newPage: () => { if (canManage) newPage(null); } };
  const pageUrl = (id) => location.origin + '/page/' + id;
  const copyLink = (id) => navigator.clipboard?.writeText(pageUrl(id)).catch(() => {});
  // duplicate: content comes from the live editor when it is the open page (unsaved keystrokes included)
  const duplicatePage = async (id) => {
    const src = await api('/pages/' + id);
    const content = (page && page.id === id && editorApi.current?.getContent()) || src.content || '[]';
    const p = await api('/pages', { method: 'POST', body: { parent_id: src.parent_id, title: (src.title || 'Untitled') + ' (copy)', workspace_id: currentWsId } });
    await api('/pages/' + p.id, { method: 'PUT', body: { content, icon: src.icon, tags: parseJSON(src.tags, []), cover: src.cover, description: src.description, view: src.view === 'board' ? 'doc' : src.view } });
    await refreshTree(); bumpTree(); setCurrentId(p.id);
  };
  const exportMarkdown = async () => {
    if (!page) return;
    const md = (await editorApi.current?.toMarkdown()) || '';
    const blob = new Blob([`# ${page.title || 'Untitled'}\n\n${md}`], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = (page.title || 'Untitled').replace(/[\/\\:*?"<>|]/g, '-').slice(0, 80) + '.md'; a.click(); setTimeout(() => URL.revokeObjectURL(url), 2000);
  };
  const uploadFile = async (file) => {
    const r = await fetch('/api/upload', { method: 'POST', credentials: 'include', headers: { 'Content-Type': file.type && /^image\//.test(file.type) ? file.type : 'application/octet-stream' }, body: file });
    if (!r.ok) { let m = 'upload failed'; try { m = (await r.json()).error || m; } catch {} throw new Error(m); }
    return (await r.json()).url;
  };
  const restoreVersion = async (content) => {
    const blocks = parseJSON(content, null);
    if (!Array.isArray(blocks) || !editorApi.current) return;
    await api('/pages/' + page.id + '/versions', { method: 'POST' }); // keep a snapshot of "now" before restoring
    editorApi.current.replaceAll(blocks.length ? blocks : [{ type: 'paragraph' }]);
    setVersionsOpen(false);
  };
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
  // debounced save; pending fields are MERGED, so a title change followed quickly by
  // typing in the body (or vice versa) never drops one of them. Flushes on page switch/unload.
  const pendingRef = useRef({ id: null, patch: null });
  const flushSave = async () => {
    clearTimeout(saveTimer.current);
    const { id, patch } = pendingRef.current; if (!id || !patch) return;
    pendingRef.current = { id: null, patch: null };
    try {
      const u = await api('/pages/' + id, { method: 'PUT', body: patch });
      setPages(ps => ps.map(p => p.id === u.id ? { ...p, title: u.title, icon: u.icon, is_public: u.is_public } : p));
      if (patch.title !== undefined || patch.icon !== undefined) bumpTree();
    } catch (e) { if (import.meta.env.DEV) console.warn('save failed', e); }
  };
  const flushRef = useRef(flushSave); flushRef.current = flushSave;
  const save = (patch) => {
    if (!page) return;
    if (pendingRef.current.id && pendingRef.current.id !== page.id) flushRef.current();
    pendingRef.current = { id: page.id, patch: { ...(pendingRef.current.patch || {}), ...patch } };
    clearTimeout(saveTimer.current); saveTimer.current = setTimeout(() => flushRef.current(), 450);
  };
  useEffect(() => { return () => { flushRef.current(); }; }, [page?.id]);
  useEffect(() => { const h = () => { const { id, patch } = pendingRef.current; if (id && patch) { pendingRef.current = { id: null, patch: null }; try { fetch('/api/pages/' + id, { method: 'PUT', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(patch), keepalive: true }); } catch {} } }; window.addEventListener('pagehide', h); return () => window.removeEventListener('pagehide', h); }, []);
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
                    {(workspaces || []).map(w => <div className={'ws-item' + (w.id === currentWsId ? ' on' : '')} key={w.id} onClick={() => switchWs(w.id)}><PageIcon icon={w.icon} size={17} /><span className="grow">{w.name}</span></div>)}
                    {me.is_admin === 1 && <div className="ws-item new" onClick={() => { setWsMenu(false); setWsModal(true); }}><Plus size={15} /> New workspace</div>}
                  </div>
                </>}
              </span>
            </div>
            <span className="row" style={{ gap: 2 }}>
              <Inbox onOpen={setCurrentId} />
              <button className="icon-btn" onClick={() => setSearching(true)} title="Search (⌘K)"><SearchIcon size={18} /></button>
              <button className="icon-btn" onClick={() => setSidebarOpen(false)} title="Collapse sidebar (⌘\)"><Menu size={18} /></button>
            </span>
          </div>
        </div>
        <div className="tree-scroll">
          <div className={'root-node' + (!currentId ? ' on' : '')} onClick={() => setCurrentId(null)} title="Workspace overview & map"><Share2 size={17} /><span>Overview</span></div>
          {favs.some(id => pages.some(p => p.id === id)) && <div className="sb-section">
            <div className="sb-section-head"><Star size={12} weight="fill" /> Favorites</div>
            {favs.map(id => pages.find(p => p.id === id)).filter(Boolean).map(p => <div key={p.id} className={'tree-row fav-row' + (p.id === currentId ? ' active' : '')} onClick={() => setCurrentId(p.id)} onContextMenu={(e) => { e.preventDefault(); setTreeMenu({ id: p.id, x: e.clientX, y: e.clientY }); }}><span className="tree-label"><span className="ic"><PageIcon icon={p.icon} size={17} /></span><span className="tl-text">{p.title || 'Untitled'}</span></span></div>)}
            <div className="sb-section-head" style={{ marginTop: 8 }}>Pages</div>
          </div>}
          <Tree pages={pages} currentId={currentId} onOpen={setCurrentId} onNew={newPage} onDelete={del} onMove={move} onLink={onLink} onContext={(id, x, y) => setTreeMenu({ id, x, y })} canManage={canManage} collapsedInit={prefs.treeCollapsed} onCollapse={(ids) => savePref({ treeCollapsed: ids })} />
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
      {!sidebar && <button className="reopen-btn" onClick={() => setSidebarOpen(true)} title="Open sidebar (⌘\)"><Menu size={18} /></button>}
      {sidebar && <div className="sb-backdrop" onClick={() => setSidebarOpen(false)} />}
      <main className={'main' + (sidebar ? '' : ' no-sidebar')}>
        {!page && noWorkspace && <div className="empty-home">
              <Logo size={52} />
              <div className="empty-title">You're not in a workspace yet</div>
              <div className="empty-sub">Ask a workspace manager to invite you (Settings → People). Once they do, its pages appear here.</div>
            </div>}
        {!page && !noWorkspace && (pages.length === 0
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
                {!!page.locked && <span className="chip-mini" title={page.can_admin ? 'Locked — read-only' : 'Locked by a manager'}><Lock size={11} weight="fill" /> Locked</span>}
                {!page.can_edit && !page.locked && <span className="chip-mini"><Eye size={11} /> View only</span>}
                <FacePile members={wsMembers} onClick={() => page.can_admin && setSharing(true)} />
                {page.can_admin && <button className="btn-share" onClick={() => setSharing(true)}><Share2 size={13} /> Share</button>}
                <PageMenu page={page} canManage={page.can_admin} canEdit={!!page.can_edit} isFav={favs.includes(page.id)} wordCount={editorApi.current?.getWordCount?.() || 0} onFav={() => toggleFav(page.id)} onCopyLink={() => copyLink(page.id)} onDuplicate={() => duplicatePage(page.id)} onExport={exportMarkdown} onVersions={() => setVersionsOpen(true)} onLog={() => setLogOpen(true)} onLock={() => setLocked(!page.locked)} onDelete={async () => { if (await confirm('Delete this page? It moves to Trash.', { danger: true, confirmLabel: 'Delete page' })) { const parent = page.parent_id; await api('/pages/' + page.id, { method: 'DELETE' }); setCurrentId(parent || null); refreshTree(); bumpTree(); } }} />
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
                <textarea className="title-in" value={page.title} placeholder="Untitled" disabled={!page.can_edit} rows={1} ref={el => { titleRef.current = el; if (el) { el.style.height = 'auto'; el.style.height = el.scrollHeight + 'px'; } }} onKeyDown={e => { if (e.key === 'Enter' || (e.key === 'ArrowDown' && e.target.selectionStart === e.target.value.length)) { e.preventDefault(); if (page.view === 'board') return; editorApi.current?.focusStart(); } }} onInput={e => { e.target.style.height = 'auto'; e.target.style.height = e.target.scrollHeight + 'px'; }} onChange={e => { setPage({ ...page, title: e.target.value.replace(/\n/g, '') }); save({ title: e.target.value.replace(/\n/g, '') }); }} />
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
                <Editor page={page} editable={!!page.can_edit} pages={pages} apiRef={editorApi} me={me} uploadFile={uploadFile} onChange={(content) => save({ content })} />
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
      {versionsOpen && page && <Versions page={page} canEdit={!!page.can_edit} onRestore={restoreVersion} onClose={() => setVersionsOpen(false)} />}
      {treeMenu && (() => { const tp = pages.find(p => p.id === treeMenu.id); if (!tp) return null; const act = (fn) => { setTreeMenu(null); fn(); }; return createPortal(<>
        <div className="picker-overlay" onClick={() => setTreeMenu(null)} onContextMenu={(e) => { e.preventDefault(); setTreeMenu(null); }} />
        <div className="popmenu tree-menu" style={{ position: 'fixed', left: Math.min(treeMenu.x, window.innerWidth - 230), top: Math.min(treeMenu.y, window.innerHeight - 330), width: 220 }}>
          <div className="popmenu-item" onClick={() => act(() => window.open(pageUrl(tp.id), '_blank'))}><ArrowSquareOut size={15} /> Open in new tab</div>
          <div className="popmenu-item" onClick={() => act(() => toggleFav(tp.id))}><Star size={15} weight={favs.includes(tp.id) ? 'fill' : 'regular'} /> {favs.includes(tp.id) ? 'Remove from favorites' : 'Add to favorites'}</div>
          <div className="popmenu-item" onClick={() => act(() => copyLink(tp.id))}><LinkSimple size={15} /> Copy link</div>
          {canManage && <>
            <div className="popmenu-sep" />
            <div className="popmenu-item" onClick={() => act(() => newPage(tp.id))}><Plus size={15} /> New subpage</div>
            <div className="popmenu-item" onClick={() => act(() => { focusTitleNext.current = true; if (currentId === tp.id) { titleRef.current?.focus(); titleRef.current?.select?.(); focusTitleNext.current = false; } else setCurrentId(tp.id); })}><Pencil size={15} /> Rename</div>
            {tp.view !== 'board' && tp.view !== 'column' && <div className="popmenu-item" onClick={() => act(() => duplicatePage(tp.id))}><CopySimple size={15} /> Duplicate</div>}
            <div className="popmenu-sep" />
            <div className="popmenu-item danger" onClick={() => act(async () => { if (await confirm('Delete this page? It moves to Trash.', { danger: true, confirmLabel: 'Delete page' })) del(tp.id); })}><Trash2 size={15} /> Delete</div>
          </>}
        </div>
      </>, document.body); })()}
      {settings && <Settings me={me} setMe={setMe} currentWs={currentWs} onWsChange={loadWs} onLogout={onLogout} onImported={() => { refreshTree(); bumpTree(); }} onClose={() => setSettings(false)} />}
      {searching && <Search workspace={currentWsId} recent={recent} pages={pages} onOpen={setCurrentId} onClose={() => setSearching(false)} />}
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

