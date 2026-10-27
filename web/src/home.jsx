// Workspace home: the Overview (stats, recent pages, activity) and the Map, an
// Obsidian-style force graph on a canvas: zoom, pan, drag nodes, search, filters.
import React, { useEffect, useMemo, useRef, useState } from 'react';
import api from './api.js';
import { renderToStaticMarkup } from 'react-dom/server';
import { PageIcon, BoardGlyph, Avatar, tagColor, fmtWhen, PH, GI } from './ui.jsx';
import { PencilSimple as Pencil, MagnifyingGlass, Plus, Minus, ArrowsOut, Star, Graph as GraphIcon, ClockCounterClockwise, Users } from '@phosphor-icons/react';

// ---------- Overview ----------
export function Overview({ workspace, pages, members, favs, canCreate, onOpen, onNewPage, onNewBoard, onTag, onMap }) {
  const [stats, setStats] = useState(null);
  const [tags, setTags] = useState([]);
  useEffect(() => {
    let alive = true;
    api('/workspaces/' + workspace.id + '/stats').then(s => alive && setStats(s)).catch(() => alive && setStats({ pages: 0, boards: 0, cards: 0, words: 0, links: 0, members: 0, editedThisWeek: 0, recent: [], activity: [] }));
    api('/tags?workspace=' + workspace.id).then(t => alive && setTags(t)).catch(() => {});
    return () => { alive = false; };
  }, [workspace.id, pages.length]);
  const favPages = (favs || []).map(id => pages.find(p => p.id === id)).filter(Boolean);
  const tile = (n, label) => <div className="ov-tile" key={label}><b>{typeof n === 'number' ? n.toLocaleString() : '–'}</b><span>{label}</span></div>;
  return (
    <div className="ov">
      <div className="ov-head">
        <PageIcon icon={workspace.icon} size={40} />
        <div className="col grow" style={{ gap: 2 }}>
          <div className="ov-title">{workspace.name}</div>
          <div className="muted small">{members?.length ? `${members.length} member${members.length === 1 ? '' : 's'}` : ''}{stats ? ` · ${stats.editedThisWeek} page${stats.editedThisWeek === 1 ? '' : 's'} edited this week` : ''}</div>
        </div>
        <div className="row gap">
          <button className="btn-soft" onClick={onMap}><GraphIcon size={15} /> Map</button>
          {canCreate && <><button className="btn-soft" onClick={onNewPage}><Pencil size={14} /> New page</button><button className="btn-soft" onClick={onNewBoard}><BoardGlyph size={14} /> New board</button></>}
        </div>
      </div>
      <div className="ov-tiles">
        {tile(stats?.pages, 'Pages')}{tile(stats?.boards, 'Boards')}{tile(stats?.cards, 'Cards')}{tile(stats?.words, 'Words')}{tile(stats?.links, 'Page links')}
      </div>
      <div className="ov-grid">
        <div className="ov-col">
          <div className="ov-sec"><ClockCounterClockwise size={14} /> Recently edited</div>
          {(stats?.recent || []).map(p => <div className="ov-item" key={p.id} onClick={() => onOpen(p.id)}><PageIcon icon={p.icon} size={17} /><span className="grow trunc">{p.title || 'Untitled'}</span>{p.view === 'board' && <span className="ov-kind">board</span>}<span className="muted small">{fmtWhen(p.updated_at)}</span></div>)}
          {stats && stats.recent.length === 0 && <div className="muted small">Nothing yet. Create a page to get started.</div>}
          {favPages.length > 0 && <>
            <div className="ov-sec" style={{ marginTop: 18 }}><Star size={14} weight="fill" /> Favorites</div>
            {favPages.map(p => <div className="ov-item" key={p.id} onClick={() => onOpen(p.id)}><PageIcon icon={p.icon} size={17} /><span className="grow trunc">{p.title || 'Untitled'}</span></div>)}
          </>}
        </div>
        <div className="ov-col">
          <div className="ov-sec"><Users size={14} /> Activity</div>
          {(stats?.activity || []).map(l => <div className="ov-act" key={l.id} onClick={() => onOpen(l.page.id)}>
            <Avatar user={l.user} size={22} />
            <div className="ov-act-main"><span><b>{l.user.name}</b> {l.detail} <span className="ov-act-page"><PageIcon icon={l.page.icon} size={12} /> {l.page.title || 'Untitled'}</span></span><span className="muted" style={{ fontSize: 11 }}>{fmtWhen(l.created_at)}</span></div>
          </div>)}
          {stats && stats.activity.length === 0 && <div className="muted small">Edits, renames and comments will show up here.</div>}
        </div>
      </div>
      {tags.length > 0 && <div className="ov-tags">{tags.slice(0, 30).map(t => <span className="tag clickable" key={t.name} style={{ '--tc': t.color || tagColor(t.name) }} onClick={() => onTag(t.name, t.color)}>{t.name}<span className="ws-tag-n">{t.count}</span></span>)}</div>}
    </div>
  );
}

// ---------- Map (canvas force graph) ----------
const isEmoji = (icon) => !!icon && !/^(ph|gi|dot|li):/.test(icon);
// Phosphor / Game Icons are React components; the canvas needs bitmaps. Render each one
// to SVG markup once per color, load it as an image and cache it. The paint loop picks
// it up on the next frame once loaded.
const iconCache = new Map();
function iconImage(icon, fallbackColor, force = false) {
  const [set, name, ownColor] = String(icon).split(':');
  const color = force ? fallbackColor : (ownColor || fallbackColor);
  const key = icon + '|' + color;
  const hit = iconCache.get(key); if (hit) return hit.img.complete && hit.img.naturalWidth ? hit.img : null;
  const Comp = set === 'ph' ? PH[name] : set === 'gi' ? GI[name] : null;
  if (!Comp) return null;
  let svg; try { svg = renderToStaticMarkup(set === 'ph' ? <Comp size={64} weight="fill" color={color} /> : <Comp size={64} color={color} />); } catch { return null; }
  if (!/^<svg/.test(svg)) return null;
  if (!/xmlns=/.test(svg)) svg = svg.replace('<svg', '<svg xmlns="http://www.w3.org/2000/svg"');
  const img = new Image(); img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
  iconCache.set(key, { img });
  return null;
}
const cssVar = (name, fb) => { try { return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fb; } catch { return fb; } };
const mix = (hex, alpha) => { const h = hex.replace('#', ''); const n = h.length === 3 ? h.split('').map(c => c + c).join('') : h; const r = parseInt(n.slice(0, 2), 16), g = parseInt(n.slice(2, 4), 16), b = parseInt(n.slice(4, 6), 16); return `rgba(${r},${g},${b},${alpha})`; };

export function MapView({ workspace, onOpen }) {
  const [graph, setGraph] = useState(null);
  const [q, setQ] = useState('');
  const [showBoards, setShowBoards] = useState(true);
  const [showOrphans, setShowOrphans] = useState(true);
  const [hiddenTags, setHiddenTags] = useState(() => new Set());
  const [tags, setTags] = useState([]);
  const [hover, setHover] = useState(null);     // { id, x, y } for the tooltip
  const [count, setCount] = useState({ n: 0, e: 0 });
  const canvasRef = useRef(null);
  const wrapRef = useRef(null);
  const S = useRef({ nodes: [], edges: [], byId: new Map(), view: { x: 0, y: 0, k: 1 }, alpha: 1, raf: 0, hover: null, drag: null, w: 0, h: 0, colors: {}, q: '', fitPending: true });
  useEffect(() => { setGraph(null); api('/workspaces/' + workspace.id + '/graph').then(setGraph).catch(() => setGraph({ nodes: [], edges: [] })); api('/tags?workspace=' + workspace.id).then(setTags).catch(() => {}); setHiddenTags(new Set()); S.current.fitPending = true; }, [workspace.id]);

  // derive the visible graph
  const visible = useMemo(() => {
    if (!graph) return null;
    const kinds = new Map(); // id -> 'board' | 'column' | 'card' | 'page'
    const parentOf = new Map();
    graph.edges.forEach(e => { if (e.kind === 'tree') parentOf.set(e.to, e.from); });
    graph.nodes.forEach(n => { kinds.set(n.id, n.board ? 'board' : n.column ? 'column' : 'page'); });
    graph.nodes.forEach(n => { if (n.view === 'board') kinds.set(n.id, 'board'); else if (n.view === 'column') kinds.set(n.id, 'column'); });
    graph.nodes.forEach(n => { const p = parentOf.get(n.id); if (p && kinds.get(p) === 'column') kinds.set(n.id, 'card'); });
    let nodes = graph.nodes.filter(n => !(n.tags || []).some(t => hiddenTags.has(t)));
    if (!showBoards) nodes = nodes.filter(n => !['board', 'column', 'card'].includes(kinds.get(n.id)));
    else nodes = nodes.filter(n => kinds.get(n.id) !== 'column'); // columns are structure, not pages: cards hang off the board
    const ids = new Set(nodes.map(n => n.id));
    // re-route card edges to the board (skipping the hidden column node)
    const edges = [];
    const seen = new Set();
    for (const e of graph.edges) {
      let from = e.from, to = e.to;
      if (kinds.get(from) === 'column') from = parentOf.get(from);
      if (kinds.get(to) === 'column') continue; // board -> column edge, dropped
      if (!ids.has(from) || !ids.has(to) || from === to) continue;
      const k = from + '>' + to; if (seen.has(k)) continue; seen.add(k);
      edges.push({ from, to, kind: e.kind });
    }
    const deg = {}; edges.forEach(e => { deg[e.from] = (deg[e.from] || 0) + 1; deg[e.to] = (deg[e.to] || 0) + 1; });
    if (!showOrphans) { nodes = nodes.filter(n => deg[n.id]); }
    const finalIds = new Set(nodes.map(n => n.id));
    return { nodes: nodes.map(n => ({ ...n, kind: kinds.get(n.id) || 'page', deg: deg[n.id] || 0 })), edges: edges.filter(e => finalIds.has(e.from) && finalIds.has(e.to)), parentOf };
  }, [graph, showBoards, showOrphans, hiddenTags]);

  // (re)build the simulation when the visible set changes; keep positions of nodes we already had
  useEffect(() => {
    if (!visible) return;
    const st = S.current;
    const old = st.byId;
    const byId = new Map();
    const w = st.w || 800, h = st.h || 600;
    const roots = visible.nodes.filter(n => n.root);
    const R = Math.min(w, h) * 0.32;
    const placed = new Map();
    roots.forEach((r, i) => { const a = (i / Math.max(1, roots.length)) * Math.PI * 2; placed.set(r.id, { x: Math.cos(a) * R, y: Math.sin(a) * R }); });
    const nodes = visible.nodes.map(n => {
      const prev = old.get(n.id);
      let x, y;
      if (prev) { x = prev.x; y = prev.y; }
      else if (placed.has(n.id)) { ({ x, y } = placed.get(n.id)); }
      else {
        const p = visible.parentOf.get(n.id); const pp = (p && (old.get(p) || placed.get(p))) || null;
        const a = Math.random() * Math.PI * 2, d = 40 + Math.random() * 60;
        x = (pp ? pp.x : 0) + Math.cos(a) * d; y = (pp ? pp.y : 0) + Math.sin(a) * d;
      }
      const nd = { ...n, x, y, vx: 0, vy: 0, r: (n.root ? 9 : n.kind === 'card' ? 4 : n.kind === 'board' ? 8 : 6) + Math.sqrt(n.deg) * 1.4 };
      byId.set(n.id, nd); return nd;
    });
    st.nodes = nodes; st.byId = byId;
    st.edges = visible.edges.map(e => ({ a: byId.get(e.from), b: byId.get(e.to), kind: e.kind })).filter(e => e.a && e.b);
    st.neighbors = new Map(); st.edges.forEach(e => { (st.neighbors.get(e.a.id) || st.neighbors.set(e.a.id, new Set()).get(e.a.id)).add(e.b.id); (st.neighbors.get(e.b.id) || st.neighbors.set(e.b.id, new Set()).get(e.b.id)).add(e.a.id); });
    st.alpha = 1;
    for (let i = 0; i < 120; i++) step(st);           // settle most of the way before the first paint
    setCount({ n: nodes.length, e: st.edges.length });
    if (st.fitPending && nodes.length) { fit(st); st.fitPending = false; }
  }, [visible]);

  useEffect(() => { S.current.q = q.trim().toLowerCase(); }, [q]);

  // canvas sizing + render loop
  useEffect(() => {
    const st = S.current; const cv = canvasRef.current, wrap = wrapRef.current; if (!cv || !wrap) return;
    const resize = () => { const r = wrap.getBoundingClientRect(); st.w = r.width; st.h = r.height; const dpr = window.devicePixelRatio || 1; cv.width = Math.round(r.width * dpr); cv.height = Math.round(r.height * dpr); cv.style.width = r.width + 'px'; cv.style.height = r.height + 'px'; };
    resize();
    const ro = new ResizeObserver(resize); ro.observe(wrap);
    const readColors = () => { st.colors = { accent: cssVar('--accent', '#a78bdb'), text: cssVar('--text', '#ece6f5'), dim: cssVar('--text-dim', '#c8c0d6'), muted: cssVar('--muted', '#8d8499'), line: cssVar('--line2', '#362c48'), panel: cssVar('--panel2', '#1e1828'), bg: cssVar('--bg', '#0c0a12'), green: '#5fc18a', blue: '#6f9fe0' }; };
    readColors();
    const mo = new MutationObserver(readColors); mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    const frame = () => { if (st.alpha > 0.004 || st.drag) step(st); paint(st, cv); st.raf = requestAnimationFrame(frame); };
    st.raf = requestAnimationFrame(frame);
    return () => { cancelAnimationFrame(st.raf); ro.disconnect(); mo.disconnect(); };
  }, []);

  // interactions
  const toWorld = (cx, cy) => { const st = S.current; const r = canvasRef.current.getBoundingClientRect(); return { x: (cx - r.left - st.w / 2 - st.view.x) / st.view.k, y: (cy - r.top - st.h / 2 - st.view.y) / st.view.k }; };
  const nodeAt = (cx, cy) => { const st = S.current; const p = toWorld(cx, cy); let best = null, bd = 1e9; for (const n of st.nodes) { const d = Math.hypot(n.x - p.x, n.y - p.y); const hit = n.r + 6 / st.view.k; if (d < hit && d < bd) { bd = d; best = n; } } return best; };
  const onPointerDown = (e) => {
    if (e.button !== 0) return;
    const st = S.current; const n = nodeAt(e.clientX, e.clientY);
    const start = { x: e.clientX, y: e.clientY, vx: st.view.x, vy: st.view.y, moved: false };
    e.currentTarget.setPointerCapture?.(e.pointerId);
    if (n) { st.drag = n; n.fx = n.x; n.fy = n.y; st.alpha = Math.max(st.alpha, 0.3); }
    const move = (ev) => {
      if (Math.hypot(ev.clientX - start.x, ev.clientY - start.y) > 3) start.moved = true;
      if (st.drag) { const p = toWorld(ev.clientX, ev.clientY); st.drag.x = st.drag.fx = p.x; st.drag.y = st.drag.fy = p.y; st.drag.vx = st.drag.vy = 0; st.alpha = Math.max(st.alpha, 0.25); }
      else { st.view.x = start.vx + (ev.clientX - start.x); st.view.y = start.vy + (ev.clientY - start.y); }
    };
    const up = (ev) => {
      document.removeEventListener('pointermove', move); document.removeEventListener('pointerup', up);
      if (st.drag) { const d = st.drag; delete d.fx; delete d.fy; st.drag = null; if (!start.moved) onOpen(d.id); }
      canvasRef.current && (canvasRef.current.style.cursor = '');
    };
    document.addEventListener('pointermove', move); document.addEventListener('pointerup', up);
  };
  const onPointerMove = (e) => {
    const st = S.current; if (st.drag) return;
    const n = nodeAt(e.clientX, e.clientY);
    const id = n ? n.id : null;
    if (id !== st.hover) { st.hover = id; setHover(n ? { id: n.id, title: n.title, icon: n.icon, deg: n.deg, kind: n.kind } : null); }
    if (canvasRef.current) canvasRef.current.style.cursor = n ? 'pointer' : 'grab';
  };
  const onWheel = (e) => {
    e.preventDefault(); const st = S.current;
    const r = canvasRef.current.getBoundingClientRect(); const mx = e.clientX - r.left - st.w / 2, my = e.clientY - r.top - st.h / 2;
    const factor = Math.exp(-e.deltaY * 0.0015); const k2 = Math.max(0.12, Math.min(5, st.view.k * factor)); const s = k2 / st.view.k;
    st.view.x = mx - (mx - st.view.x) * s; st.view.y = my - (my - st.view.y) * s; st.view.k = k2;
  };
  useEffect(() => { const cv = canvasRef.current; if (!cv) return; cv.addEventListener('wheel', onWheel, { passive: false }); return () => cv.removeEventListener('wheel', onWheel); }, []);
  const zoom = (f) => { const st = S.current; const k2 = Math.max(0.12, Math.min(5, st.view.k * f)); const s = k2 / st.view.k; st.view.x *= s; st.view.y *= s; st.view.k = k2; };
  const toggleTag = (name) => setHiddenTags(s => { const n = new Set(s); const k = name.toLowerCase(); n.has(k) ? n.delete(k) : n.add(k); return n; });
  const onSearchKey = (e) => { if (e.key === 'Enter') { const st = S.current; const m = st.nodes.find(n => (n.title || '').toLowerCase().includes(st.q)); if (m) onOpen(m.id); } else if (e.key === 'Escape') setQ(''); };
  const matches = q.trim() ? S.current.nodes.filter(n => (n.title || 'untitled').toLowerCase().includes(q.trim().toLowerCase())).length : null;

  if (graph && !graph.nodes.length) return <div className="map-wrap"><div className="center muted small" style={{ flex: 1 }}>No pages to map yet.</div></div>;
  return (
    <div className="map-wrap" ref={wrapRef}>
      <canvas ref={canvasRef} className="map-canvas" onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerLeave={() => { S.current.hover = null; setHover(null); }} onDoubleClick={() => fit(S.current)} />
      <div className="map-top">
        <div className="map-search"><MagnifyingGlass size={15} /><input placeholder="Find a page on the map" value={q} onChange={e => setQ(e.target.value)} onKeyDown={onSearchKey} />{matches !== null && <span className="muted small">{matches}</span>}</div>
        <div className="map-toggles">
          <button className={'chip' + (showBoards ? ' on' : '')} onClick={() => setShowBoards(v => !v)}>Boards</button>
          <button className={'chip' + (showOrphans ? ' on' : '')} onClick={() => setShowOrphans(v => !v)}>Unlinked</button>
        </div>
      </div>
      {tags.length > 0 && <div className="map-tags">{tags.slice(0, 24).map(t => { const off = hiddenTags.has(t.name.toLowerCase()); return <span className={'tag clickable' + (off ? ' off' : '')} key={t.name} style={{ '--tc': t.color || tagColor(t.name) }} title={off ? 'Show' : 'Hide'} onClick={() => toggleTag(t.name)}>{t.name}<span className="ws-tag-n">{t.count}</span></span>; })}</div>}
      <div className="map-ctl">
        <button title="Zoom in" onClick={() => zoom(1.3)}><Plus size={15} /></button>
        <button title="Zoom out" onClick={() => zoom(1 / 1.3)}><Minus size={15} /></button>
        <button title="Fit (double-click the map)" onClick={() => fit(S.current)}><ArrowsOut size={15} /></button>
      </div>
      <div className="map-foot muted small">{count.n} page{count.n === 1 ? '' : 's'} · {count.e} link{count.e === 1 ? '' : 's'} · scroll to zoom, drag to pan, click a page to open it</div>
      {hover && <div className="map-tip" style={{ left: 16, bottom: 44 }}><PageIcon icon={hover.icon} size={16} /><b>{hover.title || 'Untitled'}</b><span className="muted small">{hover.kind === 'board' ? 'board' : hover.kind === 'card' ? 'card' : 'page'} · {hover.deg} link{hover.deg === 1 ? '' : 's'}</span></div>}
      {!graph && <div className="map-loading muted small">Building map…</div>}
    </div>
  );
}

function fit(st) {
  if (!st.nodes.length) return;
  let minX = 1e9, maxX = -1e9, minY = 1e9, maxY = -1e9;
  for (const n of st.nodes) { minX = Math.min(minX, n.x - n.r); maxX = Math.max(maxX, n.x + n.r); minY = Math.min(minY, n.y - n.r); maxY = Math.max(maxY, n.y + n.r); }
  const bw = Math.max(60, maxX - minX + 120), bh = Math.max(60, maxY - minY + 160);
  const k = Math.max(0.12, Math.min(2.2, Math.min(st.w / bw, st.h / bh)));
  st.view.k = k; st.view.x = -((minX + maxX) / 2) * k; st.view.y = -((minY + maxY) / 2) * k;
}
// one simulation tick: charge repulsion (with cutoff), springs on edges, weak gravity, damping
function step(st) {
  const nodes = st.nodes, n = nodes.length; if (!n) return;
  const a = st.alpha;
  const rep = 1800 * a, cutoff = 420;
  for (let i = 0; i < n; i++) {
    const A = nodes[i];
    for (let j = i + 1; j < n; j++) {
      const B = nodes[j];
      let dx = A.x - B.x, dy = A.y - B.y;
      if (Math.abs(dx) > cutoff || Math.abs(dy) > cutoff) continue;
      let d2 = dx * dx + dy * dy; if (d2 < 1) { dx = (Math.random() - .5); dy = (Math.random() - .5); d2 = 1; }
      const d = Math.sqrt(d2);
      const minD = A.r + B.r + 10;
      let f = rep / d2;
      if (d < minD) f += (minD - d) * 0.6 * a; // soft collision
      const fx = dx / d * f, fy = dy / d * f;
      A.vx += fx; A.vy += fy; B.vx -= fx; B.vy -= fy;
    }
  }
  for (const e of st.edges) {
    const dx = e.b.x - e.a.x, dy = e.b.y - e.a.y, d = Math.sqrt(dx * dx + dy * dy) || 1;
    const rest = e.kind === 'tree' ? 70 + (e.a.r + e.b.r) * 2 : 110;
    const f = (d - rest) * (e.kind === 'tree' ? 0.05 : 0.025) * a;
    const fx = dx / d * f, fy = dy / d * f;
    e.a.vx += fx; e.a.vy += fy; e.b.vx -= fx; e.b.vy -= fy;
  }
  for (const nd of nodes) {
    if (nd.fx != null) { nd.x = nd.fx; nd.y = nd.fy; nd.vx = nd.vy = 0; continue; }
    nd.vx -= nd.x * 0.004 * a; nd.vy -= nd.y * 0.004 * a;
    nd.vx *= 0.82; nd.vy *= 0.82;
    nd.x += Math.max(-12, Math.min(12, nd.vx)); nd.y += Math.max(-12, Math.min(12, nd.vy));
  }
  st.alpha = st.drag ? Math.max(st.alpha, 0.2) : st.alpha * 0.985;
}
function paint(st, cv) {
  const ctx = cv.getContext('2d'); if (!ctx) return;
  const dpr = window.devicePixelRatio || 1; const { w, h, view, colors: C } = st;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, w, h);
  ctx.translate(w / 2 + view.x, h / 2 + view.y); ctx.scale(view.k, view.k);
  const k = view.k;
  const hov = st.hover ? st.byId.get(st.hover) : null;
  const nb = hov ? st.neighbors.get(hov.id) || new Set() : null;
  const q = st.q;
  const focus = (id) => (!hov && !q) || (hov && (id === hov.id || nb.has(id))) || (q && (st.byId.get(id)?.title || 'untitled').toLowerCase().includes(q));
  // edges
  for (const e of st.edges) {
    const on = hov && (e.a.id === hov.id || e.b.id === hov.id);
    const dimmed = (hov || q) && !on && !(q && focus(e.a.id) && focus(e.b.id));
    ctx.beginPath(); ctx.moveTo(e.a.x, e.a.y); ctx.lineTo(e.b.x, e.b.y);
    ctx.lineWidth = (on ? 2 : e.kind === 'link' ? 1.4 : 1) / Math.sqrt(k);
    ctx.strokeStyle = on ? C.accent : e.kind === 'link' ? mix(C.accent, dimmed ? .08 : .45) : mix(C.muted, dimmed ? .06 : .32);
    if (e.kind === 'tree') ctx.setLineDash([3 / k, 4 / k]); else ctx.setLineDash([]);
    ctx.stroke();
  }
  ctx.setLineDash([]);
  // nodes
  const fontPx = Math.max(10.5, 12 / Math.max(k, .6)) / k * Math.min(k, 1.6);
  for (const nd of st.nodes) {
    const f = focus(nd.id);
    const alpha = f ? 1 : 0.18;
    const col = nd.root || nd.kind === 'board' ? C.accent : nd.kind === 'card' ? C.blue : C.dim;
    ctx.globalAlpha = alpha;
    ctx.beginPath(); ctx.arc(nd.x, nd.y, nd.r, 0, Math.PI * 2);
    ctx.fillStyle = hov && hov.id === nd.id ? C.accent : mix(col, nd.root || nd.kind === 'board' ? .9 : .75); ctx.fill();
    if (nd.root || nd.kind === 'board') { ctx.lineWidth = 1.5 / k; ctx.strokeStyle = mix(C.accent, .35); ctx.beginPath(); ctx.arc(nd.x, nd.y, nd.r + 3 / k, 0, Math.PI * 2); ctx.stroke(); }
    if (nd.r * k >= 11 && nd.icon && nd.icon !== '📄') {
      if (isEmoji(nd.icon)) { ctx.font = `${nd.r * 1.25}px ui-sans-serif, system-ui, "Apple Color Emoji", "Segoe UI Emoji"`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(nd.icon, nd.x, nd.y + nd.r * 0.08); }
      else if (/^(ph|gi):/.test(nd.icon)) { const img = iconImage(nd.icon, C.bg, nd.root || nd.kind === 'board'); if (img) { const sz = nd.r * 1.25; ctx.drawImage(img, nd.x - sz / 2, nd.y - sz / 2, sz, sz); } }
    }
    const showLabel = (hov && (hov.id === nd.id || nb.has(nd.id))) || (q && f) || nd.root || nd.kind === 'board' || nd.r * k >= 7.5 || k >= 1.25;
    if (showLabel) {
      const label = (nd.title || 'Untitled').length > 28 ? (nd.title || 'Untitled').slice(0, 27) + '…' : (nd.title || 'Untitled');
      ctx.font = `${nd.root || nd.kind === 'board' ? '600 ' : ''}${fontPx}px ui-sans-serif, system-ui, sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'top';
      ctx.fillStyle = hov && hov.id === nd.id ? C.text : nd.root || nd.kind === 'board' ? C.text : C.dim;
      ctx.globalAlpha = alpha * (nd.root || nd.kind === 'board' || (hov && (hov.id === nd.id || nb.has(nd.id))) || q ? 1 : Math.min(1, Math.max(.35, (k - .5) * 1.2)));
      ctx.fillText(label, nd.x, nd.y + nd.r + 4 / k);
    }
  }
  ctx.globalAlpha = 1;
}
