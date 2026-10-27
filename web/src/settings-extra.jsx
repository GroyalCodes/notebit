// Settings panes added in 1.4: Permissions (role-by-action grid + per-page access),
// Claude Code (personal tokens + the one-line MCP setup) and Editor preferences.
import React, { useEffect, useMemo, useRef, useState } from 'react';
import api from './api.js';
import { PageIcon, Avatar, useConfirm, fmtWhen } from './ui.jsx';
import { Check, Lock, Globe, Trash as Trash2, CopySimple, MagnifyingGlass, Crown, ArrowCounterClockwise } from '@phosphor-icons/react';

export function Switch({ checked, onChange, disabled, title }) {
  return <label className={'sw' + (disabled ? ' off' : '')} title={title}><input type="checkbox" checked={!!checked} disabled={disabled} onChange={e => onChange?.(e.target.checked)} /><span /></label>;
}

// ---------- Permissions ----------
export function PermissionsPane({ currentWs, pages, me }) {
  const [data, setData] = useState(null);
  const [saving, setSaving] = useState(false);
  const [pick, setPick] = useState(null);     // page id being edited
  const [q, setQ] = useState('');
  const [overview, setOverview] = useState([]);
  const load = () => currentWs?.id && api('/workspaces/' + currentWs.id + '/policy').then(setData).catch(() => setData(null));
  const loadOverview = () => currentWs?.id && api('/workspaces/' + currentWs.id + '/access-overview').then(setOverview).catch(() => setOverview([]));
  useEffect(() => { load(); loadOverview(); }, [currentWs?.id]);
  if (!data) return <div className="set-pane"><h3>Permissions</h3><div className="muted small">Loading…</div></div>;
  const set = async (role, key, val) => {
    const next = { ...data, policy: { ...data.policy, [role]: { ...data.policy[role], [key]: val } } };
    setData(next); setSaving(true);
    try { const r = await api('/workspaces/' + currentWs.id + '/policy', { method: 'PUT', body: { policy: { [role]: { [key]: val } } } }); setData(d => ({ ...d, policy: r.policy })); } catch { load(); } finally { setSaving(false); }
  };
  const candidates = q.trim() ? pages.filter(p => p.view !== 'column' && (p.title || 'Untitled').toLowerCase().includes(q.trim().toLowerCase())).slice(0, 8) : [];
  const picked = pick ? pages.find(p => p.id === pick) : null;
  return (
    <div className="set-pane wide">
      <h3>What each role can do</h3>
      <div className="muted small">Workspace roles are set per person in <b>People</b>. Managers can always do everything. Flip a switch to change what Read and Write members may do in <b>{currentWs?.name}</b>.{saving && ' Saving…'}</div>
      <div className="perm-grid">
        <div className="perm-head"><span>Action</span><span>Read</span><span>Write</span><span>Manage</span></div>
        {data.actions.map(a => (
          <div className="perm-row" key={a.key}>
            <div className="perm-label"><b>{a.label}</b><span className="muted small">{a.desc}</span></div>
            <span><Switch checked={data.policy.read[a.key]} onChange={v => set('read', a.key, v)} disabled={!data.manage} /></span>
            <span><Switch checked={data.policy.write[a.key]} onChange={v => set('write', a.key, v)} disabled={!data.manage} /></span>
            <span className="perm-always" title="Managers always can"><Check size={15} weight="bold" /></span>
          </div>
        ))}
      </div>
      <div className="muted small">Also fixed: only managers invite people, change roles, share pages, lock pages and manage columns. Everyone can read every page they have access to, search, favorite and export.</div>

      <h3>Page access</h3>
      <div className="muted small">Pick a page to give someone more or less access than their workspace role, lock it, or publish it. Access flows down to sub-pages.</div>
      <div className="perm-pick">
        <div className="perm-search"><MagnifyingGlass size={15} /><input placeholder="Find a page…" value={q} onChange={e => { setQ(e.target.value); }} onKeyDown={e => { if (e.key === 'Enter' && candidates[0]) { setPick(candidates[0].id); setQ(''); } }} /></div>
        {candidates.length > 0 && <div className="perm-cands">{candidates.map(p => <div className="perm-cand" key={p.id} onClick={() => { setPick(p.id); setQ(''); }}><PageIcon icon={p.icon} size={16} /><span className="trunc">{p.title || 'Untitled'}</span>{p.view === 'board' && <span className="ov-kind">board</span>}</div>)}</div>}
      </div>
      {picked && <PageAccess page={picked} me={me} onChange={loadOverview} onClose={() => setPick(null)} />}
      {overview.length > 0 && <>
        <div className="perm-sub">Pages with their own rules</div>
        <div className="perm-list">
          {overview.map(p => <div className="perm-item" key={p.id} onClick={() => setPick(p.id)}>
            <PageIcon icon={p.icon} size={16} /><span className="trunc grow">{p.title || 'Untitled'}</span>
            {p.locked && <span className="chip-mini"><Lock size={11} weight="fill" /> Locked</span>}
            {p.is_public && <span className="chip-mini"><Globe size={11} /> Published</span>}
            {p.grants.length > 0 && <span className="chip-mini">{p.grants.length} custom</span>}
          </div>)}
        </div>
      </>}
    </div>
  );
}
function PageAccess({ page, me, onChange, onClose }) {
  const [data, setData] = useState(null);
  const [pg, setPg] = useState(null);
  const load = () => { api('/pages/' + page.id + '/access').then(setData).catch(() => setData({ members: [] })); api('/pages/' + page.id).then(setPg).catch(() => {}); };
  useEffect(() => { setData(null); load(); }, [page.id]);
  const setRole = async (uid, role) => { await api('/pages/' + page.id + '/access', { method: 'POST', body: { user_id: uid, role } }); load(); onChange?.(); };
  const reset = async (uid) => { await api('/pages/' + page.id + '/access/' + uid, { method: 'DELETE' }); load(); onChange?.(); };
  const patch = async (b) => { await api('/pages/' + page.id, { method: 'PUT', body: b }); load(); onChange?.(); };
  return (
    <div className="perm-page">
      <div className="perm-page-head"><PageIcon icon={page.icon} size={20} /><b className="grow trunc">{page.title || 'Untitled'}</b>
        <span className="row gap8">
          <span className="chip-mini"><Lock size={11} weight="fill" /> Locked <Switch checked={!!pg?.locked} onChange={v => patch({ locked: v })} /></span>
          <span className="chip-mini"><Globe size={11} /> Published <Switch checked={!!pg?.is_public} onChange={v => patch({ is_public: v })} /></span>
          <button className="mini" onClick={onClose}>Done</button>
        </span>
      </div>
      {!data ? <div className="muted small">Loading…</div> : (data.members || []).map(m => (
        <div className="prow" key={m.id}>
          <Avatar user={m} size={28} />
          <span className="col grow" style={{ gap: 0 }}><b style={{ fontSize: 13.5 }}>{m.name || m.email}{m.id === me.id ? ' (you)' : ''}</b><span className="muted small">{m.pageRole ? 'custom for this page' : m.isOwner ? 'created this page' : 'workspace role: ' + m.wsRole}</span></span>
          <span className="row gap8">
            {m.isOwner && <span className="role-badge" title="Created this page"><Crown size={13} weight="fill" /></span>}
            <select className="role-sel" value={m.role} onChange={e => setRole(m.id, e.target.value)}><option value="read">Read</option><option value="write">Write</option><option value="manage">Manage</option></select>
            {m.pageRole && <button className="mini icon" title="Back to the workspace role" onClick={() => reset(m.id)}><ArrowCounterClockwise size={14} /></button>}
          </span>
        </div>
      ))}
    </div>
  );
}

// ---------- Claude Code ----------
export function ClaudePane({ me, canUse }) {
  const confirm = useConfirm();
  const [tokens, setTokens] = useState([]);
  const [fresh, setFresh] = useState(null); // { token, mcp_url }
  const [name, setName] = useState('');
  const [copied, setCopied] = useState('');
  const load = () => api('/me/tokens').then(setTokens).catch(() => setTokens([]));
  useEffect(() => { load(); }, []);
  const create = async () => { const r = await api('/me/tokens', { method: 'POST', body: { name: name.trim() || 'Claude Code' } }); setFresh(r); setName(''); load(); };
  const revoke = async (t) => { if (!(await confirm(`Revoke "${t.name}"? Claude Code will lose access until you add a new token.`, { danger: true, confirmLabel: 'Revoke' }))) return; await api('/me/tokens/' + t.id, { method: 'DELETE' }); if (fresh?.id === t.id) setFresh(null); load(); };
  const base = (fresh?.mcp_url && /^https?:\/\//.test(fresh.mcp_url)) ? fresh.mcp_url : location.origin + '/mcp';
  const cmd = fresh ? `claude mcp add --transport http notebit ${base} --header "Authorization: Bearer ${fresh.token}"` : '';
  const copy = (text, k) => { navigator.clipboard?.writeText(text).then(() => { setCopied(k); setTimeout(() => setCopied(''), 1500); }).catch(() => {}); };
  return (
    <div className="set-pane">
      <h3>Claude Code</h3>
      <div className="muted small">Connect <a href="https://claude.com/claude-code" target="_blank" rel="noreferrer" className="lnk">Claude Code</a> to this NoteBit. Claude can then list, search and read your pages, create and edit pages, move them around, add cards to boards and leave comments. It acts as you, so it only sees what you can see.</div>
      {canUse === false && <div className="set-note warn">A workspace manager has turned off Claude Code for your role in this workspace. Tokens still work in other workspaces.</div>}
      <div className="set-group">
        <div className="col"><b>1. Create a token</b><span className="muted small">Give it a name so you remember where it is used. The token is shown once.</span></div>
        <div className="row gap"><input className="grow" placeholder="My laptop" value={name} onChange={e => setName(e.target.value)} onKeyDown={e => e.key === 'Enter' && create()} /><button className="mini gold" onClick={create}>Create token</button></div>
        {fresh && <>
          <div className="col"><b>2. Run this once in your terminal</b><span className="muted small">Then ask Claude Code something like "list my NoteBit pages" or "add a page called Release notes with a summary of this repo".</span></div>
          <div className="cmd-box"><code>{cmd}</code><button className="mini" onClick={() => copy(cmd, 'cmd')}><CopySimple size={14} /> {copied === 'cmd' ? 'Copied' : 'Copy'}</button></div>
          <div className="muted small">Other MCP clients: URL <code className="inl">{base}</code>, header <code className="inl">Authorization: Bearer {fresh.token.slice(0, 10)}…</code> <button className="lnk-btn" onClick={() => copy(fresh.token, 'tok')}>{copied === 'tok' ? 'copied' : 'copy token'}</button></div>
        </>}
      </div>
      {tokens.length > 0 && <>
        <h3>Your tokens</h3>
        {tokens.map(t => <div className="member" key={t.id}>
          <div className="col grow" style={{ gap: 1 }}><b>{t.name}</b><span className="muted small">{t.prefix}… · created {fmtWhen(t.created_at)}{t.last_used_at ? ' · last used ' + fmtWhen(t.last_used_at) : ' · never used'}</span></div>
          <button className="mini" onClick={() => revoke(t)}><Trash2 size={13} /> Revoke</button>
        </div>)}
      </>}
    </div>
  );
}

// ---------- Editor preferences ----------
export const PREF_DEFAULTS = { enterMode: 'newline', pointers: true };
export function EditorPrefs({ me, setMe }) {
  const prefs = useMemo(() => { try { return { ...PREF_DEFAULTS, ...JSON.parse(me.prefs || '{}') }; } catch { return { ...PREF_DEFAULTS }; } }, [me.prefs]);
  const save = async (patch) => { const u = await api('/me', { method: 'PUT', body: { prefs: patch } }); setMe(m => ({ ...m, prefs: u.prefs })); };
  return (
    <>
      <h3>Editor</h3>
      <div className="set-group">
        <div className="col"><b>Enter key</b><span className="muted small">What Enter does while you type in a page.</span></div>
        <div className="seg-col">
          <label className={'seg-opt' + (prefs.enterMode === 'newline' ? ' on' : '')}><input type="radio" name="enterMode" checked={prefs.enterMode === 'newline'} onChange={() => save({ enterMode: 'newline' })} /><span><b>Enter starts a new line, Shift+Enter starts a new block</b><span className="muted small">Keeps your thoughts in one block. The slash menu and lists still work with Enter.</span></span></label>
          <label className={'seg-opt' + (prefs.enterMode === 'block' ? ' on' : '')}><input type="radio" name="enterMode" checked={prefs.enterMode === 'block'} onChange={() => save({ enterMode: 'block' })} /><span><b>Enter starts a new block, Shift+Enter starts a new line</b><span className="muted small">The classic Notion behavior.</span></span></label>
        </div>
        <div className="row between"><div className="col"><b>Teammates' pointers</b><span className="muted small">Show where people on the same page are pointing, faded so the text stays readable.</span></div><Switch checked={prefs.pointers !== false} onChange={v => save({ pointers: v })} /></div>
      </div>
    </>
  );
}
