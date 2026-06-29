// BitQuest Wiki — fully self-hosted Notion-style wiki. No external services required.
// Local SQLite, local scrypt auth, top-down per-page permissions (Notion-style, inherited).
import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import fstatic from '@fastify/static';
import websocket from '@fastify/websocket';
import * as Y from 'yjs';
import * as syncProtocol from 'y-protocols/sync';
import * as awarenessProtocol from 'y-protocols/awareness';
import * as encoding from 'lib0/encoding';
import * as decoding from 'lib0/decoding';
import Database from 'better-sqlite3';
import crypto from 'node:crypto';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = process.env.WIKI_DB || path.join(__dirname, 'data', 'wiki.db');
const PORT = Number(process.env.PORT || 8200);
const VERSION = '1.0.0';
const ALLOW_SIGNUP = process.env.ALLOW_SIGNUP !== 'false';
const WEB_DIR = path.join(__dirname, '..', 'web', 'dist');

fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY, email TEXT UNIQUE NOT NULL, name TEXT,
  password_hash TEXT NOT NULL, is_admin INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now')));
CREATE TABLE IF NOT EXISTS pages (
  id TEXT PRIMARY KEY, parent_id TEXT, owner_id INTEGER,
  title TEXT NOT NULL DEFAULT 'Untitled', icon TEXT DEFAULT '📄',
  content TEXT, is_public INTEGER DEFAULT 0, position REAL DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now')), updated_at TEXT DEFAULT (datetime('now')));
CREATE TABLE IF NOT EXISTS page_access (
  page_id TEXT NOT NULL, user_id INTEGER NOT NULL, role TEXT NOT NULL DEFAULT 'view',
  PRIMARY KEY (page_id, user_id));
CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY, user_id INTEGER NOT NULL, expires_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT);
`);
try { db.exec('ALTER TABLE users ADD COLUMN avatar TEXT'); } catch {}
try { db.exec('ALTER TABLE users ADD COLUMN theme TEXT'); } catch {}
try { db.exec("ALTER TABLE pages ADD COLUMN tags TEXT DEFAULT '[]'"); } catch {}
try { db.exec('ALTER TABLE pages ADD COLUMN deleted_at TEXT'); } catch {}
try { db.exec('ALTER TABLE pages ADD COLUMN cover TEXT'); } catch {}
try { db.exec("ALTER TABLE pages ADD COLUMN view TEXT DEFAULT 'doc'"); } catch {}
try { db.exec('ALTER TABLE pages ADD COLUMN status TEXT'); } catch {}
try { db.exec('ALTER TABLE pages ADD COLUMN board_cols TEXT'); } catch {}
try { db.exec('ALTER TABLE pages ADD COLUMN locked INTEGER DEFAULT 0'); } catch {}
try { db.exec('ALTER TABLE pages ADD COLUMN list_cards INTEGER DEFAULT 0'); } catch {}
try { db.exec('ALTER TABLE pages ADD COLUMN description TEXT'); } catch {}
try { db.exec("ALTER TABLE pages ADD COLUMN col_perm TEXT DEFAULT 'member'"); } catch {}
try { db.exec('ALTER TABLE pages ADD COLUMN workspace_id TEXT'); } catch {}
db.exec(`CREATE TABLE IF NOT EXISTS workspaces (id TEXT PRIMARY KEY, name TEXT NOT NULL, icon TEXT DEFAULT 'ph:BookOpen', position REAL DEFAULT 0, created_at TEXT DEFAULT (datetime('now')));`);
db.exec('CREATE TABLE IF NOT EXISTS ydocs (page_id TEXT PRIMARY KEY, data BLOB)');
db.exec("CREATE TABLE IF NOT EXISTS workspace_member (workspace_id TEXT NOT NULL, user_id INTEGER NOT NULL, role TEXT NOT NULL DEFAULT 'write', PRIMARY KEY (workspace_id, user_id))");
db.exec("CREATE TABLE IF NOT EXISTS templates (id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, name TEXT NOT NULL, icon TEXT, content TEXT, created_at TEXT DEFAULT (datetime('now')))");
const persistYDoc = (name, ydoc) => { try { const u = Y.encodeStateAsUpdate(ydoc); db.prepare('INSERT INTO ydocs (page_id,data) VALUES (?,?) ON CONFLICT(page_id) DO UPDATE SET data=excluded.data').run(name, Buffer.from(u)); } catch {} };
const collabDocs = new Map(); // room -> { ydoc, awareness, conns: Map<ws, Set<clientID>>, saveTimer }
function getCollabDoc(room) {
  let d = collabDocs.get(room);
  if (d) return d;
  const ydoc = new Y.Doc();
  const row = db.prepare('SELECT data FROM ydocs WHERE page_id=?').get(room);
  if (row?.data) Y.applyUpdate(ydoc, new Uint8Array(row.data));
  const awareness = new awarenessProtocol.Awareness(ydoc);
  awareness.setLocalState(null);
  d = { ydoc, awareness, conns: new Map(), saveTimer: null };
  ydoc.on('update', (update, origin) => {
    const enc = encoding.createEncoder(); encoding.writeVarUint(enc, 0); syncProtocol.writeUpdate(enc, update);
    const msg = encoding.toUint8Array(enc);
    d.conns.forEach((_, c) => { if (c !== origin && c.readyState === 1) c.send(msg); });
    clearTimeout(d.saveTimer); d.saveTimer = setTimeout(() => persistYDoc(room, ydoc), 1200);
  });
  awareness.on('update', ({ added, updated, removed }, origin) => {
    const changed = added.concat(updated, removed);
    if (origin && d.conns.has(origin)) { const ids = d.conns.get(origin); added.forEach(id => ids.add(id)); removed.forEach(id => ids.delete(id)); }
    const enc = encoding.createEncoder(); encoding.writeVarUint(enc, 1);
    encoding.writeVarUint8Array(enc, awarenessProtocol.encodeAwarenessUpdate(awareness, changed));
    const msg = encoding.toUint8Array(enc);
    d.conns.forEach((_, c) => { if (c.readyState === 1) c.send(msg); });
  });
  collabDocs.set(room, d);
  return d;
}
function collabConnect(conn, room) {
  conn.binaryType = 'arraybuffer';
  const d = getCollabDoc(room);
  d.conns.set(conn, new Set());
  { const enc = encoding.createEncoder(); encoding.writeVarUint(enc, 0); syncProtocol.writeSyncStep1(enc, d.ydoc); conn.send(encoding.toUint8Array(enc)); }
  { const states = d.awareness.getStates(); if (states.size) { const enc = encoding.createEncoder(); encoding.writeVarUint(enc, 1); encoding.writeVarUint8Array(enc, awarenessProtocol.encodeAwarenessUpdate(d.awareness, Array.from(states.keys()))); conn.send(encoding.toUint8Array(enc)); } }
  conn.on('message', (data) => {
    try {
      const dec = decoding.createDecoder(new Uint8Array(data));
      const type = decoding.readVarUint(dec);
      if (type === 0) { const enc = encoding.createEncoder(); encoding.writeVarUint(enc, 0); syncProtocol.readSyncMessage(dec, enc, d.ydoc, conn); if (encoding.length(enc) > 1) conn.send(encoding.toUint8Array(enc)); }
      else if (type === 1) { awarenessProtocol.applyAwarenessUpdate(d.awareness, decoding.readVarUint8Array(dec), conn); }
    } catch {}
  });
  conn.on('close', () => {
    const ids = d.conns.get(conn); d.conns.delete(conn);
    if (ids && ids.size) awarenessProtocol.removeAwarenessStates(d.awareness, Array.from(ids), 'disconnect');
    if (d.conns.size === 0) persistYDoc(room, d.ydoc);
  });
}
const getSetting = (k, d = null) => db.prepare('SELECT value FROM settings WHERE key=?').get(k)?.value ?? d;
const setSetting = (k, v) => db.prepare('INSERT INTO settings (key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(k, String(v));
if (getSetting('allow_signup') === null) setSetting('allow_signup', ALLOW_SIGNUP ? '1' : '0');
if (getSetting('workspace_name') === null) setSetting('workspace_name', 'BitQuest Wiki');
if (getSetting('workspace_icon') === null) setSetting('workspace_icon', 'ph:BookOpen');
if (!db.prepare('SELECT 1 FROM workspaces LIMIT 1').get()) {
  const wid = crypto.randomUUID();
  db.prepare('INSERT INTO workspaces (id,name,icon,position) VALUES (?,?,?,0)').run(wid, getSetting('workspace_name', 'BitQuest Wiki'), getSetting('workspace_icon', 'ph:BookOpen'));
  db.prepare('UPDATE pages SET workspace_id=? WHERE workspace_id IS NULL').run(wid);
}
try { db.prepare("UPDATE page_access SET role='read' WHERE role='view'").run(); db.prepare("UPDATE page_access SET role='write' WHERE role='edit'").run(); } catch {}
if (!db.prepare('SELECT 1 FROM workspace_member LIMIT 1').get()) {
  for (const w of db.prepare('SELECT id FROM workspaces').all())
    for (const usr of db.prepare('SELECT id,is_admin FROM users').all())
      db.prepare('INSERT OR IGNORE INTO workspace_member (workspace_id,user_id,role) VALUES (?,?,?)').run(w.id, usr.id, usr.is_admin ? 'manage' : 'write');
}
// one-time: convert legacy board_cols JSON into real column pages + reparent cards (status -> column)
for (const board of db.prepare("SELECT id,owner_id,workspace_id,board_cols FROM pages WHERE view='board' AND deleted_at IS NULL").all()) {
  if (db.prepare("SELECT 1 FROM pages WHERE parent_id=? AND view='column'").get(board.id)) continue;
  let cols; try { cols = board.board_cols ? JSON.parse(board.board_cols) : null; } catch { cols = null; }
  if (!Array.isArray(cols) || !cols.length) cols = [{ id: 'todo', name: 'To do', color: 'gray', perm: 'member' }, { id: 'doing', name: 'In progress', color: 'amber', perm: 'member' }, { id: 'done', name: 'Approved', color: 'green', perm: 'manager' }];
  const map = {};
  db.transaction(() => {
    cols.forEach((col, idx) => {
      const cid = crypto.randomUUID();
      db.prepare("INSERT INTO pages (id,parent_id,owner_id,workspace_id,title,icon,view,col_perm,position,content) VALUES (?,?,?,?,?,?,?,?,?,?)")
        .run(cid, board.id, board.owner_id, board.workspace_id, col.name || 'Column', 'dot:' + (col.color || 'gray'), 'column', col.perm === 'manager' ? 'manager' : 'member', idx, '[]');
      map[col.id] = cid;
    });
    const first = map[cols[0].id]; let pos = 0;
    for (const card of db.prepare("SELECT id,status FROM pages WHERE parent_id=? AND (view IS NULL OR view='doc') AND deleted_at IS NULL ORDER BY position").all(board.id))
      db.prepare('UPDATE pages SET parent_id=?, status=NULL, position=? WHERE id=?').run(map[card.status] || first, ++pos, card.id);
    db.prepare('UPDATE pages SET board_cols=NULL WHERE id=?').run(board.id);
  })();
}
const allowSignup = () => getSetting('allow_signup', '1') === '1';
const workspaceInfo = () => ({ name: getSetting('workspace_name', 'Wiki'), icon: getSetting('workspace_icon', 'ph:BookOpen') });

// ---- email (Resend HTTP API) ----
async function sendEmail(to, subject, html) {
  const key = process.env.RESEND_API_KEY; if (!key) return { ok: false, error: 'no RESEND_API_KEY' };
  try {
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: process.env.MAIL_FROM || 'NoteBit <info@playbitquest.com>', to, subject, html }),
    });
    const body = await r.json().catch(() => ({}));
    return { ok: r.ok, status: r.status, body };
  } catch (e) { return { ok: false, error: String(e) }; }
}
function inviteEmail(email, password, inviter, wsName) {
  const url = process.env.APP_URL || 'https://wiki.playbitquest.com';
  return `<div style="font-family:ui-sans-serif,system-ui,sans-serif;max-width:480px;margin:24px auto;color:#1f1f1f">
    <div style="font-size:22px;font-weight:700;color:#8a6fc4">📝 NoteBit</div>
    <h2 style="margin:14px 0 6px">You're invited!</h2>
    <p style="color:#555">${inviter ? inviter + ' added you' : "You've been added"} to <b>${wsName || 'NoteBit'}</b>.</p>
    <div style="background:#f5f2fb;border:1px solid #e6e0f2;border-radius:12px;padding:16px;margin:16px 0;line-height:1.8">
      <b>Sign in:</b> <a href="${url}" style="color:#8a6fc4">${url.replace(/^https?:\/\//, '')}</a><br>
      <b>Email:</b> ${email}<br>
      <b>Temporary password:</b> <code style="background:#fff;border:1px solid #e6e0f2;border-radius:5px;padding:2px 7px">${password}</code>
    </div>
    <p style="color:#888;font-size:13px">Change your password after signing in — Settings → My account.</p>
  </div>`;
}

// ---- auth helpers (Node scrypt, no deps) ----
const hashPw = (pw) => { const s = crypto.randomBytes(16); return s.toString('hex') + ':' + crypto.scryptSync(pw, s, 64).toString('hex'); };
const verifyPw = (pw, st) => { try { const [s, h] = st.split(':'); return crypto.timingSafeEqual(crypto.scryptSync(pw, Buffer.from(s, 'hex'), 64), Buffer.from(h, 'hex')); } catch { return false; } };
const SDAYS = 30;
const newSession = (uid) => { const t = crypto.randomBytes(32).toString('hex'); db.prepare('INSERT INTO sessions (token,user_id,expires_at) VALUES (?,?,?)').run(t, uid, Date.now() + SDAYS * 864e5); return t; };
const userFromReq = (req) => { const t = req.cookies?.sid; if (!t) return null; const s = db.prepare('SELECT * FROM sessions WHERE token=?').get(t); if (!s || s.expires_at < Date.now()) return null; return db.prepare('SELECT id,email,name,is_admin,avatar,theme FROM users WHERE id=?').get(s.user_id) || null; };

// ---- permissions (Notion-style: owner + admin override + grants, inherited down the tree) ----
function ancestors(pageId) { const out = []; let cur = pageId, g = 0; while (cur && g++ < 200) { const p = db.prepare('SELECT id,parent_id,owner_id,locked FROM pages WHERE id=?').get(cur); if (!p) break; out.push(p); cur = p.parent_id; } return out; }
function roleAccess(role) {
  if (role === 'manage') return { view: true, edit: true, admin: true };
  if (role === 'write' || role === 'edit') return { view: true, edit: true };
  return { view: true, edit: false };
}
function columnPerm(columnId) { return db.prepare('SELECT col_perm FROM pages WHERE id=?').get(columnId)?.col_perm === 'manager' ? 'manager' : 'member'; }
function access(user, pageId) {
  if (!user) return { view: false, edit: false };
  if (user.is_admin) return { view: true, edit: true, admin: true };
  const page = db.prepare('SELECT workspace_id,parent_id,status FROM pages WHERE id=?').get(pageId);
  let res = null, locked = false;
  if (page?.parent_id) { const par = db.prepare('SELECT view,col_perm FROM pages WHERE id=?').get(page.parent_id); if (par && par.view === 'column' && par.col_perm === 'manager') locked = true; }
  for (const p of ancestors(pageId)) {
    if (p.locked) locked = true;
    if (!res) {
      if (p.owner_id === user.id) res = { view: true, edit: true, admin: true };
      else { const g = db.prepare('SELECT role FROM page_access WHERE page_id=? AND user_id=?').get(p.id, user.id); if (g) res = roleAccess(g.role); }
    }
  }
  if (!res && page?.workspace_id) {
    const m = db.prepare('SELECT role FROM workspace_member WHERE workspace_id=? AND user_id=?').get(page.workspace_id, user.id);
    if (m) res = roleAccess(m.role);
  }
  if (!res) res = { view: false, edit: false };
  if (locked && res.view) {
    const isManager = page?.workspace_id && db.prepare('SELECT role FROM workspace_member WHERE workspace_id=? AND user_id=?').get(page.workspace_id, user.id)?.role === 'manage';
    if (!isManager) res = { view: true, edit: false, admin: false };
  }
  return res;
}

const app = Fastify({ bodyLimit: 25 * 1024 * 1024 });
app.addContentTypeParser('application/json', { parseAs: 'string' }, (req, body, done) => {
  if (!body || !body.trim()) return done(null, {});
  try { done(null, JSON.parse(body)); } catch (err) { err.statusCode = 400; done(err); }
});
await app.register(cookie);
await app.register(websocket);
app.get('/collab/:room', { websocket: true }, (socket, req) => {
  const cookieHdr = req.raw.headers.cookie || '';
  const sid = (cookieHdr.match(/(?:^|;\s*)sid=([^;]+)/) || [])[1] || req.query?.token;
  const s = sid && db.prepare('SELECT * FROM sessions WHERE token=?').get(sid);
  const user = s && s.expires_at > Date.now() ? db.prepare('SELECT id,is_admin FROM users WHERE id=?').get(s.user_id) : null;
  const room = req.params.room;
  let ok = false;
  if (!user) ok = false;
  else if (room.startsWith('tree-')) { const wsId = room.slice(5); ok = user.is_admin || !!db.prepare('SELECT 1 FROM workspace_member WHERE workspace_id=? AND user_id=?').get(wsId, user.id); }
  else ok = access(user, room).view;
  if (!ok) { try { socket.close(); } catch {} return; }
  collabConnect(socket, room);
});
app.addHook('onRequest', async (req, reply) => {
  if (req.method === 'GET' && (req.raw.url === '/' || req.raw.url === '/index.html')) {
    const ph = getSetting('public_host'), home = getSetting('public_home');
    if (ph && home && (req.headers.host || '').toLowerCase() === ph.toLowerCase()) return reply.redirect('/p/' + home);
  }
});
app.addHook('onSend', async (req, reply, payload) => {
  const ct = reply.getHeader('content-type');
  if (ct && String(ct).includes('text/html')) reply.header('cache-control', 'no-cache, no-store, must-revalidate');
  return payload;
});
app.addHook('onResponse', async (req, reply) => {
  if (req.method !== 'GET') console.log(`[req] ${req.method} ${req.url} -> ${reply.statusCode}`);
});
const setSid = (reply, t) => reply.setCookie('sid', t, { httpOnly: true, sameSite: 'lax', secure: true, path: '/', maxAge: SDAYS * 86400 });
const requireUser = (req, reply) => { const u = userFromReq(req); if (!u) { reply.code(401).send({ error: 'unauthorized' }); return null; } return u; };

// ---- auth ----
app.get('/api/config', async () => ({ allowSignup: allowSignup(), hasUsers: !!db.prepare('SELECT 1 FROM users LIMIT 1').get(), workspace: db.prepare('SELECT id,name,icon FROM workspaces ORDER BY position,created_at LIMIT 1').get() || workspaceInfo() }));
app.get('/api/workspaces', async (req, reply) => {
  const u = requireUser(req, reply); if (!u) return;
  if (u.is_admin) return db.prepare('SELECT id,name,icon FROM workspaces ORDER BY position,created_at').all();
  return db.prepare('SELECT w.id,w.name,w.icon FROM workspaces w JOIN workspace_member m ON m.workspace_id=w.id WHERE m.user_id=? ORDER BY w.position,w.created_at').all(u.id);
});
const canManageWs = (user, wsId) => user.is_admin || db.prepare('SELECT role FROM workspace_member WHERE workspace_id=? AND user_id=?').get(wsId, user.id)?.role === 'manage';
app.get('/api/workspaces/:id/members', async (req, reply) => {
  const u = requireUser(req, reply); if (!u) return;
  if (!u.is_admin && !db.prepare('SELECT 1 FROM workspace_member WHERE workspace_id=? AND user_id=?').get(req.params.id, u.id)) return reply.code(403).send({ error: 'not a member' });
  return db.prepare("SELECT u.id,u.name,u.email,u.avatar,m.role FROM workspace_member m JOIN users u ON u.id=m.user_id WHERE m.workspace_id=? ORDER BY CASE m.role WHEN 'manage' THEN 0 WHEN 'write' THEN 1 ELSE 2 END, u.name").all(req.params.id);
});
app.post('/api/workspaces/:id/members', async (req, reply) => {
  const u = requireUser(req, reply); if (!u) return;
  if (!canManageWs(u, req.params.id)) return reply.code(403).send({ error: 'only managers can invite' });
  const ws = db.prepare('SELECT name FROM workspaces WHERE id=?').get(req.params.id);
  if (!ws) return reply.code(404).send({ error: 'workspace not found' });
  const { email, name, role = 'write' } = req.body || {};
  const em = (email || '').toLowerCase().trim(); if (!em) return reply.code(400).send({ error: 'email required' });
  const r = role === 'manage' ? 'manage' : role === 'read' ? 'read' : 'write';
  let user = db.prepare('SELECT id FROM users WHERE email=?').get(em);
  let tempPw = null;
  if (!user) { tempPw = (crypto.randomBytes(8).toString('base64').replace(/[^a-zA-Z0-9]/g, '') + 'a1').slice(0, 10); const info = db.prepare('INSERT INTO users (email,name,password_hash,is_admin) VALUES (?,?,?,0)').run(em, name || em.split('@')[0], hashPw(tempPw)); user = { id: info.lastInsertRowid }; }
  db.prepare('INSERT INTO workspace_member (workspace_id,user_id,role) VALUES (?,?,?) ON CONFLICT(workspace_id,user_id) DO UPDATE SET role=excluded.role').run(req.params.id, user.id, r);
  const sent = await sendEmail(em, `You're invited to ${ws.name} on NoteBit`, inviteEmail(em, tempPw || '(use your existing NoteBit password)', u.name || u.email, ws.name));
  return { ok: true, emailed: sent.ok, isNew: !!tempPw, error: sent.ok ? undefined : sent.error };
});
app.put('/api/workspaces/:id/members/:uid', async (req, reply) => {
  const u = requireUser(req, reply); if (!u) return;
  if (!canManageWs(u, req.params.id)) return reply.code(403).send({ error: 'only managers' });
  const { role } = req.body || {};
  if (role) db.prepare('UPDATE workspace_member SET role=? WHERE workspace_id=? AND user_id=?').run(role === 'manage' ? 'manage' : role === 'read' ? 'read' : 'write', req.params.id, req.params.uid);
  return { ok: true };
});
app.delete('/api/workspaces/:id/members/:uid', async (req, reply) => {
  const u = requireUser(req, reply); if (!u) return;
  if (!canManageWs(u, req.params.id)) return reply.code(403).send({ error: 'only managers' });
  db.prepare('DELETE FROM workspace_member WHERE workspace_id=? AND user_id=?').run(req.params.id, req.params.uid);
  return { ok: true };
});
app.post('/api/workspaces', async (req, reply) => {
  const u = requireUser(req, reply); if (!u) return;
  if (!u.is_admin) return reply.code(403).send({ error: 'only admins can create workspaces' });
  const { name = 'New Workspace', icon = 'ph:BookOpen' } = req.body || {};
  const id = crypto.randomUUID();
  const pos = (db.prepare('SELECT MAX(position) m FROM workspaces').get()?.m || 0) + 1;
  db.prepare('INSERT INTO workspaces (id,name,icon,position) VALUES (?,?,?,?)').run(id, String(name).slice(0, 60) || 'New Workspace', String(icon).slice(0, 64), pos);
  db.prepare('INSERT OR IGNORE INTO workspace_member (workspace_id,user_id,role) VALUES (?,?,?)').run(id, u.id, 'manage');
  return db.prepare('SELECT id,name,icon FROM workspaces WHERE id=?').get(id);
});
app.put('/api/workspaces/:id', async (req, reply) => {
  const u = requireUser(req, reply); if (!u) return;
  const w = db.prepare('SELECT * FROM workspaces WHERE id=?').get(req.params.id);
  if (!w) return reply.code(404).send({ error: 'not found' });
  if (!canManageWs(u, w.id)) return reply.code(403).send({ error: 'only managers can edit this workspace' });
  const { name, icon } = req.body || {};
  db.prepare('UPDATE workspaces SET name=?, icon=? WHERE id=?').run(name !== undefined ? (String(name).slice(0, 60) || 'Workspace') : w.name, icon !== undefined ? String(icon).slice(0, 64) : w.icon, w.id);
  return db.prepare('SELECT id,name,icon FROM workspaces WHERE id=?').get(w.id);
});
app.delete('/api/workspaces/:id', async (req, reply) => {
  const u = requireUser(req, reply); if (!u) return;
  if (!u.is_admin) return reply.code(403).send({ error: 'only admins can delete workspaces' });
  if (db.prepare('SELECT COUNT(*) c FROM workspaces').get().c <= 1) return reply.code(400).send({ error: 'cannot delete the last workspace' });
  db.transaction(() => {
    db.prepare("UPDATE pages SET deleted_at=datetime('now') WHERE workspace_id=? AND deleted_at IS NULL").run(req.params.id);
    db.prepare('DELETE FROM workspace_member WHERE workspace_id=?').run(req.params.id);
    db.prepare('DELETE FROM workspaces WHERE id=?').run(req.params.id);
  })();
  return { ok: true };
});
app.get('/api/workspaces/:id/export', async (req, reply) => {
  const u = requireUser(req, reply); if (!u) return;
  if (!u.is_admin) return reply.code(403).send({ error: 'admins only' });
  return db.prepare('SELECT id,title,content,parent_id FROM pages WHERE workspace_id=? AND deleted_at IS NULL ORDER BY position,created_at').all(req.params.id);
});
app.get('/api/workspaces/:id/templates', async (req, reply) => {
  const u = requireUser(req, reply); if (!u) return;
  if (!u.is_admin && !db.prepare('SELECT 1 FROM workspace_member WHERE workspace_id=? AND user_id=?').get(req.params.id, u.id)) return reply.code(403).send({ error: 'not a member' });
  return db.prepare('SELECT id,name,icon FROM templates WHERE workspace_id=? ORDER BY created_at').all(req.params.id);
});
app.get('/api/templates/:tid', async (req, reply) => {
  const u = requireUser(req, reply); if (!u) return;
  const t = db.prepare('SELECT * FROM templates WHERE id=?').get(req.params.tid);
  if (!t) return reply.code(404).send({ error: 'not found' });
  if (!u.is_admin && !db.prepare('SELECT 1 FROM workspace_member WHERE workspace_id=? AND user_id=?').get(t.workspace_id, u.id)) return reply.code(403).send({ error: 'no access' });
  return t;
});
app.post('/api/workspaces/:id/templates', async (req, reply) => {
  const u = requireUser(req, reply); if (!u) return;
  if (!canManageWs(u, req.params.id)) return reply.code(403).send({ error: 'only managers' });
  const { name, icon, content } = req.body || {};
  const id = crypto.randomUUID();
  db.prepare('INSERT INTO templates (id,workspace_id,name,icon,content) VALUES (?,?,?,?,?)').run(id, req.params.id, String(name || 'Template').slice(0, 80), icon || null, content || '[]');
  return { id };
});
app.delete('/api/templates/:tid', async (req, reply) => {
  const u = requireUser(req, reply); if (!u) return;
  const t = db.prepare('SELECT workspace_id FROM templates WHERE id=?').get(req.params.tid);
  if (!t) return { ok: true };
  if (!canManageWs(u, t.workspace_id)) return reply.code(403).send({ error: 'only managers' });
  db.prepare('DELETE FROM templates WHERE id=?').run(req.params.tid);
  return { ok: true };
});
app.post('/api/auth/register', async (req, reply) => {
  const { email, password, name } = req.body || {};
  if (!email || !password) return reply.code(400).send({ error: 'email and password required' });
  const first = !db.prepare('SELECT 1 FROM users LIMIT 1').get();
  if (!first && !allowSignup()) return reply.code(403).send({ error: 'signup disabled' });
  const em = email.toLowerCase().trim();
  if (db.prepare('SELECT 1 FROM users WHERE email=?').get(em)) return reply.code(409).send({ error: 'email already registered' });
  const info = db.prepare('INSERT INTO users (email,name,password_hash,is_admin) VALUES (?,?,?,?)').run(em, name || em.split('@')[0], hashPw(password), first ? 1 : 0);
  setSid(reply, newSession(info.lastInsertRowid));
  return { id: info.lastInsertRowid, email: em, name: name || em.split('@')[0], is_admin: first ? 1 : 0 };
});
app.post('/api/auth/login', async (req, reply) => {
  const { email, password } = req.body || {};
  const u = db.prepare('SELECT * FROM users WHERE email=?').get((email || '').toLowerCase().trim());
  if (!u || !verifyPw(password || '', u.password_hash)) return reply.code(401).send({ error: 'invalid email or password' });
  setSid(reply, newSession(u.id));
  return { id: u.id, email: u.email, name: u.name, is_admin: u.is_admin };
});
app.post('/api/auth/logout', async (req, reply) => { if (req.cookies?.sid) db.prepare('DELETE FROM sessions WHERE token=?').run(req.cookies.sid); reply.clearCookie('sid', { path: '/' }); return { ok: true }; });
app.get('/api/version', async () => ({ name: 'NoteBit', version: VERSION }));
app.get('/api/me', async (req, reply) => { const u = userFromReq(req); if (!u) return reply.code(401).send({ error: 'unauthorized' }); return u; });
app.get('/api/users', async (req, reply) => { if (!requireUser(req, reply)) return; return db.prepare('SELECT id,email,name,is_admin,avatar,theme FROM users ORDER BY name').all(); });

// ---- profile / account ----
app.put('/api/me', async (req, reply) => {
  const u = requireUser(req, reply); if (!u) return;
  const { name, avatar, theme } = req.body || {};
  if (name !== undefined) db.prepare('UPDATE users SET name=? WHERE id=?').run(String(name).slice(0, 80), u.id);
  if (avatar !== undefined) db.prepare('UPDATE users SET avatar=? WHERE id=?').run(avatar ? String(avatar).slice(0, 400000) : null, u.id);
  if (theme !== undefined) db.prepare('UPDATE users SET theme=? WHERE id=?').run(theme ? String(theme).slice(0, 20) : null, u.id);
  return db.prepare('SELECT id,email,name,is_admin,avatar,theme FROM users WHERE id=?').get(u.id);
});
app.post('/api/auth/change-password', async (req, reply) => {
  const u = requireUser(req, reply); if (!u) return;
  const { current_password, new_password } = req.body || {};
  if (!new_password || new_password.length < 6) return reply.code(400).send({ error: 'new password too short (min 6)' });
  const full = db.prepare('SELECT password_hash FROM users WHERE id=?').get(u.id);
  if (!verifyPw(current_password || '', full.password_hash)) return reply.code(401).send({ error: 'current password is wrong' });
  db.prepare('UPDATE users SET password_hash=? WHERE id=?').run(hashPw(new_password), u.id);
  db.prepare('DELETE FROM sessions WHERE user_id=? AND token != ?').run(u.id, req.cookies.sid);
  return { ok: true };
});

// ---- admin (top-down control) ----
const requireAdmin = (req, reply) => { const u = requireUser(req, reply); if (!u) return null; if (!u.is_admin) { reply.code(403).send({ error: 'admin only' }); return null; } return u; };
app.get('/api/admin/users', async (req, reply) => {
  if (!requireAdmin(req, reply)) return;
  return db.prepare("SELECT id,email,name,is_admin,avatar,created_at,(SELECT COUNT(*) FROM pages WHERE owner_id=users.id) AS pages FROM users ORDER BY created_at").all();
});
app.post('/api/admin/users', async (req, reply) => {
  const u = requireAdmin(req, reply); if (!u) return;
  const { email, password, name } = req.body || {};
  if (!email || !password) return reply.code(400).send({ error: 'email and password required' });
  if (password.length < 6) return reply.code(400).send({ error: 'password too short (min 6)' });
  const em = email.toLowerCase().trim();
  if (db.prepare('SELECT 1 FROM users WHERE email=?').get(em)) return reply.code(409).send({ error: 'email already registered' });
  const info = db.prepare('INSERT INTO users (email,name,password_hash,is_admin) VALUES (?,?,?,0)').run(em, name || em.split('@')[0], hashPw(password));
  const sent = await sendEmail(em, "You're invited to NoteBit", inviteEmail(em, password, u.name || u.email));
  return { id: info.lastInsertRowid, email: em, name: name || em.split('@')[0], emailed: sent.ok };
});
app.put('/api/admin/users/:id', async (req, reply) => {
  const u = requireAdmin(req, reply); if (!u) return;
  const id = Number(req.params.id); const { is_admin } = req.body || {};
  if (is_admin !== undefined) {
    if (id === u.id && !is_admin) return reply.code(400).send({ error: "you can't remove your own admin" });
    db.prepare('UPDATE users SET is_admin=? WHERE id=?').run(is_admin ? 1 : 0, id);
  }
  return db.prepare('SELECT id,email,name,is_admin FROM users WHERE id=?').get(id);
});
app.delete('/api/admin/users/:id', async (req, reply) => {
  const u = requireAdmin(req, reply); if (!u) return;
  const id = Number(req.params.id);
  if (id === u.id) return reply.code(400).send({ error: "you can't delete yourself" });
  db.transaction(() => {
    db.prepare('UPDATE pages SET owner_id=? WHERE owner_id=?').run(u.id, id);
    db.prepare('DELETE FROM page_access WHERE user_id=?').run(id);
    db.prepare('DELETE FROM sessions WHERE user_id=?').run(id);
    db.prepare('DELETE FROM users WHERE id=?').run(id);
  })();
  return { ok: true };
});
app.get('/api/admin/settings', async (req, reply) => { if (!requireAdmin(req, reply)) return; return { allow_signup: allowSignup() }; });
app.put('/api/admin/settings', async (req, reply) => {
  if (!requireAdmin(req, reply)) return;
  const { allow_signup } = req.body || {};
  if (allow_signup !== undefined) setSetting('allow_signup', allow_signup ? '1' : '0');
  return { allow_signup: allowSignup() };
});

// ---- search ----
app.get('/api/search', async (req, reply) => {
  const u = requireUser(req, reply); if (!u) return;
  const q = String(req.query.q || '').toLowerCase().trim();
  const ws = req.query.workspace;
  if (!q) return [];
  const hits = [];
  for (const p of db.prepare('SELECT id,title,icon,content,workspace_id FROM pages WHERE deleted_at IS NULL').all()) {
    if (ws && p.workspace_id !== ws) continue;
    if (!access(u, p.id).view) continue;
    const inTitle = (p.title || '').toLowerCase().includes(q);
    const inBody = (p.content || '').toLowerCase().includes(q);
    if (inTitle || inBody) hits.push({ id: p.id, title: p.title, icon: p.icon, where: inTitle ? 'title' : 'body' });
    if (hits.length >= 40) break;
  }
  return hits;
});

// ---- pages ----
app.get('/api/pages', async (req, reply) => {
  const u = requireUser(req, reply); if (!u) return;
  const ws = req.query.workspace;
  const all = ws
    ? db.prepare('SELECT id,parent_id,owner_id,title,icon,is_public,position,updated_at,status,view,locked,list_cards,col_perm FROM pages WHERE deleted_at IS NULL AND workspace_id=? ORDER BY position,created_at').all(ws)
    : db.prepare('SELECT id,parent_id,owner_id,title,icon,is_public,position,updated_at,status,view,locked,list_cards,col_perm FROM pages WHERE deleted_at IS NULL ORDER BY position,created_at').all();
  return all.filter(p => access(u, p.id).view).map(p => ({ ...p, can_edit: access(u, p.id).edit }));
});
app.post('/api/pages', async (req, reply) => {
  const u = requireUser(req, reply); if (!u) return;
  const { parent_id = null, title = 'Untitled', workspace_id = null, status = null } = req.body || {};
  let wsId = workspace_id;
  if (parent_id) wsId = db.prepare('SELECT workspace_id FROM pages WHERE id=?').get(parent_id)?.workspace_id || wsId;
  if (!wsId) wsId = db.prepare('SELECT id FROM workspaces ORDER BY position,created_at LIMIT 1').get()?.id;
  const parentRow = parent_id ? db.prepare('SELECT view,col_perm FROM pages WHERE id=?').get(parent_id) : null;
  let mayAdd;
  if (!parent_id) mayAdd = canManageWs(u, wsId);                                                                            // new top-level page → workspace managers
  else if (parentRow?.view === 'column') mayAdd = canManageWs(u, wsId) || (parentRow.col_perm !== 'manager' && access(u, parent_id).edit); // card into a column
  else mayAdd = canManageWs(u, wsId) || access(u, parent_id).edit;                                                          // sub-page → must be able to edit the parent (blocks locked / read-only)
  if (!mayAdd) return reply.code(403).send({ error: 'no permission to add here — that section may be locked or read-only' });
  const id = crypto.randomUUID();
  const pos = (db.prepare('SELECT MAX(position) m FROM pages WHERE parent_id IS ?').get(parent_id)?.m || 0) + 1;
  db.prepare('INSERT INTO pages (id,parent_id,owner_id,workspace_id,title,position,content,status) VALUES (?,?,?,?,?,?,?,?)').run(id, parent_id, u.id, wsId, title, pos, '[]', status);
  return db.prepare('SELECT * FROM pages WHERE id=?').get(id);
});
app.get('/api/pages/:id', async (req, reply) => {
  const u = requireUser(req, reply); if (!u) return;
  const a = access(u, req.params.id); if (!a.view) return reply.code(403).send({ error: 'no access' });
  const p = db.prepare('SELECT * FROM pages WHERE id=?').get(req.params.id);
  if (!p) return reply.code(404).send({ error: 'not found' });
  return { ...p, can_edit: a.edit, can_admin: !!a.admin };
});
app.put('/api/pages/:id', async (req, reply) => {
  const u = requireUser(req, reply); if (!u) return;
  if (!access(u, req.params.id).edit) return reply.code(403).send({ error: 'no edit permission' });
  const p = db.prepare('SELECT * FROM pages WHERE id=?').get(req.params.id);
  if (!p) return reply.code(404).send({ error: 'not found' });
  const b = req.body || {};
  if (b.locked !== undefined && !(u.is_admin || canManageWs(u, p.workspace_id))) return reply.code(403).send({ error: 'only managers can lock pages' });
  if (b.col_perm !== undefined && !(u.is_admin || canManageWs(u, p.workspace_id))) return reply.code(403).send({ error: 'only managers can set column access' });
  if (b.parent_id !== undefined && b.parent_id !== p.parent_id) {
    const tgt = b.parent_id ? db.prepare('SELECT view,col_perm FROM pages WHERE id=?').get(b.parent_id) : null;
    const src = p.parent_id ? db.prepare('SELECT view,col_perm FROM pages WHERE id=?').get(p.parent_id) : null;
    if (((tgt?.view === 'column' && tgt.col_perm === 'manager') || (src?.view === 'column' && src.col_perm === 'manager')) && !(u.is_admin || canManageWs(u, p.workspace_id))) return reply.code(403).send({ error: 'only managers can move cards in/out of that column' });
    // can only move a page INTO a section you can edit — blocks dropping into a locked or read-only page
    if (b.parent_id && tgt?.view !== 'column' && !(canManageWs(u, p.workspace_id) || access(u, b.parent_id).edit)) return reply.code(403).send({ error: "can't move into a locked or read-only page" });
  }
  db.prepare(`UPDATE pages SET title=?,icon=?,content=?,tags=?,parent_id=?,position=?,is_public=?,cover=?,view=?,status=?,board_cols=?,locked=?,list_cards=?,description=?,col_perm=?,updated_at=datetime('now') WHERE id=?`)
    .run(b.title ?? p.title, b.icon ?? p.icon, b.content ?? p.content,
         b.tags !== undefined ? JSON.stringify(b.tags) : (p.tags ?? '[]'),
         b.parent_id !== undefined ? b.parent_id : p.parent_id,
         b.position ?? p.position, b.is_public !== undefined ? (b.is_public ? 1 : 0) : p.is_public,
         b.cover !== undefined ? b.cover : (p.cover ?? null),
         b.view !== undefined ? b.view : (p.view ?? 'doc'),
         b.status !== undefined ? b.status : (p.status ?? null),
         b.board_cols !== undefined ? (typeof b.board_cols === 'string' ? b.board_cols : JSON.stringify(b.board_cols)) : (p.board_cols ?? null),
         b.locked !== undefined ? (b.locked ? 1 : 0) : (p.locked ?? 0),
         b.list_cards !== undefined ? (b.list_cards ? 1 : 0) : (p.list_cards ?? 0),
         b.description !== undefined ? b.description : (p.description ?? null),
         b.col_perm !== undefined ? (b.col_perm === 'manager' ? 'manager' : 'member') : (p.col_perm ?? 'member'),
         p.id);
  return db.prepare('SELECT * FROM pages WHERE id=?').get(p.id);
});
app.delete('/api/pages/:id', async (req, reply) => {
  const u = requireUser(req, reply); if (!u) return;
  if (!access(u, req.params.id).admin) return reply.code(403).send({ error: 'only owner/admin can delete' });
  const ids = [], stack = [req.params.id];
  while (stack.length) { const c = stack.pop(); ids.push(c); for (const k of db.prepare('SELECT id FROM pages WHERE parent_id=? AND deleted_at IS NULL').all(c)) stack.push(k.id); }
  const upd = db.prepare("UPDATE pages SET deleted_at=datetime('now') WHERE id=?");
  db.transaction(() => ids.forEach(i => upd.run(i)))();
  return { ok: true, trashed: ids.length };
});

// ---- sharing (top-down control) ----
const ROLE_RANK = { manage: 0, write: 1, read: 2 };
app.get('/api/pages/:id/access', async (req, reply) => {
  const u = requireUser(req, reply); if (!u) return;
  if (!access(u, req.params.id).admin) return reply.code(403).send({ error: 'only managers' });
  const p = db.prepare('SELECT owner_id,is_public,workspace_id FROM pages WHERE id=?').get(req.params.id);
  if (!p) return reply.code(404).send({ error: 'not found' });
  const grants = Object.fromEntries(db.prepare('SELECT user_id,role FROM page_access WHERE page_id=?').all(req.params.id).map(g => [g.user_id, g.role]));
  const seen = new Set();
  const members = (p.workspace_id ? db.prepare('SELECT u.id,u.name,u.email,u.avatar,m.role FROM workspace_member m JOIN users u ON u.id=m.user_id WHERE m.workspace_id=?').all(p.workspace_id) : []).map(m => {
    seen.add(m.id); const pageRole = grants[m.id] || null; const isOwner = m.id === p.owner_id;
    return { id: m.id, name: m.name, email: m.email, avatar: m.avatar, wsRole: m.role, pageRole, isOwner, role: isOwner ? 'manage' : (pageRole || m.role) };
  });
  for (const [uid, role] of Object.entries(grants)) {
    const idn = Number(uid); if (seen.has(idn)) continue;
    const usr = db.prepare('SELECT id,name,email,avatar FROM users WHERE id=?').get(idn);
    if (usr) members.push({ ...usr, wsRole: null, pageRole: role, isOwner: usr.id === p.owner_id, role });
  }
  members.sort((a, b) => (b.isOwner - a.isOwner) || (ROLE_RANK[a.role] - ROLE_RANK[b.role]) || String(a.name || a.email).localeCompare(b.name || b.email));
  return { owner_id: p.owner_id, is_public: !!p.is_public, members };
});
app.post('/api/pages/:id/access', async (req, reply) => {
  const u = requireUser(req, reply); if (!u) return;
  if (!access(u, req.params.id).admin) return reply.code(403).send({ error: 'only managers' });
  const { user_id, role = 'read' } = req.body || {};
  if (!user_id) return reply.code(400).send({ error: 'user_id required' });
  const r = role === 'manage' ? 'manage' : role === 'write' ? 'write' : 'read';
  db.prepare('INSERT INTO page_access (page_id,user_id,role) VALUES (?,?,?) ON CONFLICT(page_id,user_id) DO UPDATE SET role=excluded.role').run(req.params.id, user_id, r);
  return { ok: true };
});
app.delete('/api/pages/:id/access/:userId', async (req, reply) => {
  const u = requireUser(req, reply); if (!u) return;
  if (!access(u, req.params.id).admin) return reply.code(403).send({ error: 'only owner/admin' });
  db.prepare('DELETE FROM page_access WHERE page_id=? AND user_id=?').run(req.params.id, req.params.userId);
  return { ok: true };
});

// ---- workspace tag list (for Notion-style reuse) ----
app.get('/api/tags', async (req, reply) => {
  const u = requireUser(req, reply); if (!u) return;
  const ws = req.query.workspace;
  const rows = ws
    ? db.prepare('SELECT id,tags FROM pages WHERE deleted_at IS NULL AND workspace_id=?').all(ws)
    : db.prepare('SELECT id,tags FROM pages WHERE deleted_at IS NULL').all();
  const map = new Map();
  for (const r of rows) {
    if (!access(u, r.id).view) continue;
    let arr; try { arr = JSON.parse(r.tags || '[]'); } catch { arr = []; }
    for (const t of (Array.isArray(arr) ? arr : [])) { const o = typeof t === 'string' ? { name: t } : t; if (o && o.name) { const e = map.get(o.name) || { name: o.name, color: o.color || null, count: 0 }; e.count++; if (!e.color && o.color) e.color = o.color; map.set(o.name, e); } }
  }
  return [...map.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
});
app.get('/api/tagpages', async (req, reply) => {
  const u = requireUser(req, reply); if (!u) return;
  const ws = req.query.workspace, tag = (req.query.tag || '').toLowerCase();
  if (!tag) return [];
  const rows = ws ? db.prepare('SELECT id,title,icon,tags FROM pages WHERE deleted_at IS NULL AND workspace_id=?').all(ws) : db.prepare('SELECT id,title,icon,tags FROM pages WHERE deleted_at IS NULL').all();
  const out = [];
  for (const r of rows) {
    let arr; try { arr = JSON.parse(r.tags || '[]'); } catch { arr = []; }
    if ((Array.isArray(arr) ? arr : []).some(t => (typeof t === 'string' ? t : t?.name || '').toLowerCase() === tag) && access(u, r.id).view) out.push({ id: r.id, title: r.title, icon: r.icon });
  }
  return out;
});

// ---- trash (soft-deleted pages) ----
app.get('/api/trash', async (req, reply) => {
  const u = requireUser(req, reply); if (!u) return;
  const ws = req.query?.workspace;
  const all = db.prepare("SELECT id,parent_id,title,icon,deleted_at,workspace_id FROM pages WHERE deleted_at IS NOT NULL ORDER BY deleted_at DESC").all();
  const del = new Set(all.map(p => p.id));
  return all.filter(p => (!ws || p.workspace_id === ws) && (!p.parent_id || !del.has(p.parent_id)) && access(u, p.id).admin)
            .map(p => ({ id: p.id, title: p.title, icon: p.icon, deleted_at: p.deleted_at }));
});
app.post('/api/pages/:id/restore', async (req, reply) => {
  const u = requireUser(req, reply); if (!u) return;
  if (!access(u, req.params.id).admin) return reply.code(403).send({ error: 'no permission' });
  const ids = [], stack = [req.params.id];
  while (stack.length) { const c = stack.pop(); ids.push(c); for (const k of db.prepare('SELECT id FROM pages WHERE parent_id=? AND deleted_at IS NOT NULL').all(c)) stack.push(k.id); }
  const p = db.prepare('SELECT parent_id FROM pages WHERE id=?').get(req.params.id);
  const parentGone = !p.parent_id || !db.prepare('SELECT 1 FROM pages WHERE id=? AND deleted_at IS NULL').get(p.parent_id);
  db.transaction(() => {
    ids.forEach(i => db.prepare('UPDATE pages SET deleted_at=NULL WHERE id=?').run(i));
    if (parentGone) db.prepare('UPDATE pages SET parent_id=NULL WHERE id=?').run(req.params.id);
  })();
  return { ok: true };
});
app.delete('/api/trash/:id', async (req, reply) => {
  const u = requireUser(req, reply); if (!u) return;
  if (!access(u, req.params.id).admin) return reply.code(403).send({ error: 'no permission' });
  const ids = [], stack = [req.params.id];
  while (stack.length) { const c = stack.pop(); ids.push(c); for (const k of db.prepare('SELECT id FROM pages WHERE parent_id=?').all(c)) stack.push(k.id); }
  db.transaction(() => ids.forEach(i => { db.prepare('DELETE FROM pages WHERE id=?').run(i); db.prepare('DELETE FROM page_access WHERE page_id=?').run(i); db.prepare('DELETE FROM ydocs WHERE page_id=?').run(i); }))();
  return { ok: true };
});
app.delete('/api/trash', async (req, reply) => {
  const u = requireUser(req, reply); if (!u) return;
  const ws = req.query?.workspace;
  const all = db.prepare("SELECT id,workspace_id FROM pages WHERE deleted_at IS NOT NULL").all().filter(p => (!ws || p.workspace_id === ws) && access(u, p.id).admin);
  db.transaction(() => all.forEach(p => { db.prepare('DELETE FROM pages WHERE id=?').run(p.id); db.prepare('DELETE FROM page_access WHERE page_id=?').run(p.id); db.prepare('DELETE FROM ydocs WHERE page_id=?').run(p.id); }))();
  return { ok: true, purged: all.length };
});

// ---- backlinks (pages that reference this one) ----
app.get('/api/pages/:id/backlinks', async (req, reply) => {
  const u = requireUser(req, reply); if (!u) return;
  const id = req.params.id; const hits = [];
  for (const p of db.prepare('SELECT id,title,icon,content FROM pages WHERE deleted_at IS NULL').all()) {
    if (p.id === id) continue;
    if (!(p.content || '').includes(id)) continue;
    if (!access(u, p.id).view) continue;
    hits.push({ id: p.id, title: p.title, icon: p.icon });
  }
  return hits;
});
// ---- workspace knowledge graph (nodes = pages, edges = page-links + parent/child) ----
app.get('/api/workspaces/:id/graph', async (req, reply) => {
  const u = requireUser(req, reply); if (!u) return;
  if (!u.is_admin && !db.prepare('SELECT 1 FROM workspace_member WHERE workspace_id=? AND user_id=?').get(req.params.id, u.id)) return reply.code(403).send({ error: 'not a member' });
  const all = db.prepare('SELECT id,title,icon,content,parent_id,view FROM pages WHERE workspace_id=? AND deleted_at IS NULL').all(req.params.id);
  const columns = new Set(all.filter(p => p.view === 'column').map(p => p.id));
  const pages = all.filter(p => !(p.parent_id && columns.has(p.parent_id)) && access(u, p.id).view);
  const ids = new Set(pages.map(p => p.id));
  const nodes = pages.map(p => ({ id: p.id, title: p.title, icon: p.icon }));
  const seen = new Set(); const edges = [];
  for (const a of pages) {
    if (a.parent_id && ids.has(a.parent_id)) { const k = a.parent_id + '>' + a.id; if (!seen.has(k)) { seen.add(k); edges.push({ from: a.parent_id, to: a.id, kind: 'tree' }); } }
    const c = a.content || '';
    if (c.includes('pageLink')) for (const b of pages) { if (b.id === a.id) continue; if (c.includes(b.id)) { const k = a.id + '>' + b.id; if (!seen.has(k)) { seen.add(k); edges.push({ from: a.id, to: b.id, kind: 'link' }); } } }
  }
  return { nodes, edges };
});

// ---- public read-only ----
app.get('/api/public/:id', async (req, reply) => {
  const p = db.prepare('SELECT id,title,icon,content,is_public,updated_at,view,board_cols,cover,parent_id,description FROM pages WHERE id=? AND deleted_at IS NULL').get(req.params.id);
  if (!p) return reply.code(404).send({ error: 'not found' });
  let publicOk = p.is_public === 1, anc = p.parent_id, g0 = 0; // inherit published state from any ancestor (card -> column -> board)
  while (!publicOk && anc && g0++ < 20) { const a = db.prepare('SELECT is_public,parent_id FROM pages WHERE id=?').get(anc); if (!a) break; if (a.is_public === 1) { publicOk = true; break; } anc = a.parent_id; }
  if (!publicOk) return reply.code(404).send({ error: 'not found or not public' });
  const out = { id: p.id, title: p.title, icon: p.icon, content: p.content, updated_at: p.updated_at, view: p.view, cover: p.cover, description: p.description };
  if (p.view === 'board') out.columns = db.prepare("SELECT id,title,icon FROM pages WHERE parent_id=? AND view='column' AND deleted_at IS NULL ORDER BY position").all(p.id).map(c => ({ id: c.id, name: c.title, color: (c.icon || '').startsWith('dot:') ? c.icon.slice(4) : 'gray', cards: db.prepare('SELECT id,title,icon FROM pages WHERE parent_id=? AND deleted_at IS NULL ORDER BY position').all(c.id) }));
  const crumbs = []; let cur = p.parent_id, guard = 0;
  while (cur && guard++ < 50) { const a = db.prepare('SELECT id,title,icon,is_public,parent_id,view FROM pages WHERE id=? AND deleted_at IS NULL').get(cur); if (!a) break; if (a.view === 'column') { cur = a.parent_id; continue; } if (a.is_public !== 1) break; crumbs.unshift({ id: a.id, title: a.title, icon: a.icon }); cur = a.parent_id; }
  out.crumbs = crumbs;
  return out;
});

// ---- serve frontend ----
if (fs.existsSync(WEB_DIR)) {
  await app.register(fstatic, { root: WEB_DIR });
  app.setNotFoundHandler((req, reply) => req.raw.url.startsWith('/api/') ? reply.code(404).send({ error: 'not found' }) : reply.sendFile('index.html'));
}
const HOST = process.env.HOST || '127.0.0.1';
app.listen({ port: PORT, host: HOST }).then(() => console.log(`NoteBit v${VERSION} on ${HOST}:${PORT} (db ${DB_PATH})`));
