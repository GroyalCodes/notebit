// NoteBit: a fully self-hosted Notion-style workspace. No external services required.
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
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { markdownToBlocks, blocksToMarkdown } from './md.js';
import { writeBlocks, readBlocks } from './ycontent.js';
import { makeMcp } from './mcp.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = process.env.WIKI_DB || path.join(__dirname, 'data', 'wiki.db');
const PORT = Number(process.env.PORT || 8200);
const VERSION = '1.4.2';
const ALLOW_SIGNUP = process.env.ALLOW_SIGNUP !== 'false';
const WEB_DIR = process.env.WEB_DIR || path.join(__dirname, '..', 'web', 'dist');

// ---------- autostart (start NoteBit on boot; native installs only) ----------
// enable = register with the OS so NoteBit comes back after a reboot. We never
// launch a second copy here, so this never conflicts with the running instance.
const AS = (() => {
  const inContainer = () => { try { if (fs.existsSync('/.dockerenv')) return true; } catch {} return !!(process.env.FLY_APP_NAME || process.env.KUBERNETES_SERVICE_HOST); };
  const node = process.execPath;
  const script = path.join(__dirname, 'server.js');
  const wd = path.resolve(__dirname, '..', '..');
  const envVars = () => ({ WIKI_DB: path.resolve(DB_PATH), PORT: String(PORT), HOST: process.env.HOST || '127.0.0.1', APP_URL: process.env.APP_URL || `http://localhost:${PORT}` });
  const has = (cmd, args) => { try { execFileSync(cmd, args, { stdio: 'ignore' }); return true; } catch { return false; } };
  const unitPath = () => path.join(os.homedir(), '.config', 'systemd', 'user', 'notebit.service');
  const plistPath = () => path.join(os.homedir(), 'Library', 'LaunchAgents', 'org.notebit.plist');
  const vbsPath = () => path.join(process.env.APPDATA || os.homedir(), 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup', 'NoteBit.vbs');

  function status() {
    if (inContainer()) return { supported: false, enabled: false, managed: 'container' };
    const p = process.platform;
    try {
      if (p === 'win32') return { supported: true, enabled: fs.existsSync(vbsPath()) };
      if (p === 'darwin') return { supported: true, enabled: fs.existsSync(plistPath()) };
      if (p === 'linux') {
        // show-environment needs the user bus; if it fails there is no session to manage
        if (!has('systemctl', ['--user', 'show-environment'])) return { supported: false, enabled: false, managed: 'nosystemd' };
        let en = false; try { en = execFileSync('systemctl', ['--user', 'is-enabled', 'notebit'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim() === 'enabled'; } catch {}
        return { supported: true, enabled: en };
      }
    } catch {}
    return { supported: false, enabled: false };
  }

  function enable() {
    const p = process.platform, e = envVars();
    if (p === 'linux') {
      const q = s => (/\s/.test(s) ? `"${s}"` : s);
      const unit = `[Unit]\nDescription=NoteBit\nAfter=network.target\n\n[Service]\nType=simple\nWorkingDirectory=${wd}\nExecStart=${q(node)} ${q(script)}\n${Object.entries(e).map(([k, v]) => `Environment=${k}=${v}`).join('\n')}\nRestart=on-failure\nRestartSec=3\n\n[Install]\nWantedBy=default.target\n`;
      fs.mkdirSync(path.dirname(unitPath()), { recursive: true });
      fs.writeFileSync(unitPath(), unit);
      execFileSync('systemctl', ['--user', 'daemon-reload']);
      execFileSync('systemctl', ['--user', 'enable', 'notebit']);
      try { execFileSync('loginctl', ['enable-linger', os.userInfo().username]); } catch {}
      return true;
    }
    if (p === 'darwin') {
      const envDict = Object.entries(e).map(([k, v]) => `    <key>${k}</key><string>${v}</string>`).join('\n');
      const plist = `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n<plist version="1.0"><dict>\n  <key>Label</key><string>org.notebit</string>\n  <key>ProgramArguments</key><array><string>${node}</string><string>${script}</string></array>\n  <key>WorkingDirectory</key><string>${wd}</string>\n  <key>EnvironmentVariables</key><dict>\n${envDict}\n  </dict>\n  <key>RunAtLoad</key><true/>\n  <key>KeepAlive</key><true/>\n</dict></plist>\n`;
      fs.mkdirSync(path.dirname(plistPath()), { recursive: true });
      fs.writeFileSync(plistPath(), plist);
      return true;
    }
    if (p === 'win32') {
      const psq = s => String(s).replace(/'/g, "''");
      const setEnv = Object.entries(e).map(([k, v]) => `$env:${k}='${psq(v)}'`).join('; ');
      const ps = `cd '${psq(wd)}'; ${setEnv}; Start-Process -FilePath '${psq(node)}' -ArgumentList '${psq(script)}' -WindowStyle Hidden`;
      const vbs = `Set sh = CreateObject("WScript.Shell")\r\nsh.Run "powershell -WindowStyle Hidden -Command ""${ps}""", 0, False\r\n`;
      fs.mkdirSync(path.dirname(vbsPath()), { recursive: true });
      fs.writeFileSync(vbsPath(), vbs);
      return true;
    }
    return false;
  }

  function disable() {
    const p = process.platform;
    try {
      if (p === 'linux') { try { execFileSync('systemctl', ['--user', 'disable', 'notebit']); } catch {} fs.rmSync(unitPath(), { force: true }); return true; }
      if (p === 'darwin') { try { execFileSync('launchctl', ['unload', plistPath()]); } catch {} fs.rmSync(plistPath(), { force: true }); return true; }
      if (p === 'win32') { fs.rmSync(vbsPath(), { force: true }); return true; }
    } catch {}
    return false;
  }

  return { status, enable, disable };
})();

// CLI: `node server.js autostart <enable|disable|status>` (used by the installer). Exits before opening the DB.
if (process.argv[2] === 'autostart') {
  const cmd = process.argv[3];
  const st = AS.status();
  try {
    if (cmd === 'enable') { if (st.supported) { AS.enable(); console.log('autostart enabled'); } else { console.log('autostart not available here (' + (st.managed || 'unsupported') + ')'); } }
    else if (cmd === 'disable') { AS.disable(); console.log('autostart disabled'); }
    else { console.log(JSON.stringify(AS.status())); }
  } catch (e) { console.log('autostart: ' + e.message); }
  process.exit(0);
}

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
try { db.exec("ALTER TABLE users ADD COLUMN prefs TEXT DEFAULT '{}'"); } catch {}
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
db.exec("CREATE TABLE IF NOT EXISTS comments (id TEXT PRIMARY KEY, page_id TEXT NOT NULL, user_id INTEGER NOT NULL, body TEXT, mentions TEXT DEFAULT '[]', created_at TEXT DEFAULT (datetime('now')))");
db.exec("CREATE TABLE IF NOT EXISTS notifications (id TEXT PRIMARY KEY, user_id INTEGER NOT NULL, actor_id INTEGER, type TEXT, page_id TEXT, comment_id TEXT, body TEXT, read INTEGER DEFAULT 0, created_at TEXT DEFAULT (datetime('now')))");
db.exec("CREATE INDEX IF NOT EXISTS idx_comments_page ON comments(page_id)");
db.exec("CREATE INDEX IF NOT EXISTS idx_notif_user ON notifications(user_id, read)");
db.exec("CREATE TABLE IF NOT EXISTS page_log (id TEXT PRIMARY KEY, page_id TEXT NOT NULL, user_id INTEGER NOT NULL, act TEXT NOT NULL, detail TEXT, created_at TEXT DEFAULT (datetime('now')))");
db.exec("CREATE INDEX IF NOT EXISTS idx_pagelog_page ON page_log(page_id, created_at)");
db.exec("CREATE TABLE IF NOT EXISTS page_versions (id TEXT PRIMARY KEY, page_id TEXT NOT NULL, user_id INTEGER, title TEXT, content TEXT, created_at TEXT DEFAULT (datetime('now')))");
db.exec("CREATE INDEX IF NOT EXISTS idx_pagever ON page_versions(page_id, created_at)");
db.exec("CREATE TABLE IF NOT EXISTS api_tokens (id TEXT PRIMARY KEY, user_id INTEGER NOT NULL, name TEXT, token_hash TEXT UNIQUE NOT NULL, prefix TEXT, created_at TEXT DEFAULT (datetime('now')), last_used_at TEXT)");
try { db.exec("ALTER TABLE workspaces ADD COLUMN policy TEXT"); } catch {}
const UPLOAD_DIR = path.join(path.dirname(path.resolve(DB_PATH)), 'uploads');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });
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
if (getSetting('workspace_name') === null) setSetting('workspace_name', 'My Workspace');
if (getSetting('workspace_icon') === null) setSetting('workspace_icon', 'ph:BookOpen');
if (!db.prepare('SELECT 1 FROM workspaces LIMIT 1').get()) {
  const wid = crypto.randomUUID();
  db.prepare('INSERT INTO workspaces (id,name,icon,position) VALUES (?,?,?,0)').run(wid, getSetting('workspace_name', 'My Workspace'), getSetting('workspace_icon', 'ph:BookOpen'));
  db.prepare('UPDATE pages SET workspace_id=? WHERE workspace_id IS NULL').run(wid);
  // fresh install: seed a welcome page that shows the editor off (fully editable/deletable)
  const t = (text, styles) => ({ type: 'text', text, styles: styles || {} });
  const welcome = [
    { type: 'callout', props: { emoji: '👋', bg: 'accent' }, content: [t('Welcome to NoteBit. This page is yours: edit it, break it, or delete it.')] },
    { type: 'heading', props: { level: 2 }, content: [t('The basics')] },
    { type: 'checkListItem', props: { checked: false }, content: [t('Type '), t('/', { code: true }), t(' anywhere for blocks: headings, lists, to-dos, callouts, toggles, images, tables')] },
    { type: 'checkListItem', props: { checked: false }, content: [t('Drag the '), t('⋮⋮', { code: true }), t(' handle to move a block; box-select from the margins to grab several')] },
    { type: 'checkListItem', props: { checked: false }, content: [t('Click the '), t('⋮⋮', { code: true }), t(' handle (or right-click selected text) for the block menu. Right-click a word for spelling suggestions')] },
    { type: 'checkListItem', props: { checked: false }, content: [t('Enter adds a line, Shift+Enter starts a new block (swap it in Settings). Tab nests, Shift+Tab un-nests. '), t('⌘K', { code: true }), t(' searches, '), t('⌘\\', { code: true }), t(' hides the sidebar')] },
    { type: 'toggle', props: {}, content: [t('Click the arrow on this toggle')], children: [
      { type: 'paragraph', content: [t('Anything can live inside: text, lists, even more toggles.')] },
    ] },
    { type: 'heading', props: { level: 2 }, content: [t('Make it a team')] },
    { type: 'paragraph', content: [t('Invite people in Settings then People. You will see their cursors live on the page, and comments with @mentions land in the inbox by the search bar.')] },
    { type: 'paragraph', content: [t('Overview shows what changed lately; Map draws how your pages connect. New board makes a kanban where every card is a page. Every page has a link you can share, a version history, and a Favorites star.')] },
    { type: 'heading', props: { level: 2 }, content: [t('Bring Claude Code')] },
    { type: 'paragraph', content: [t('Settings then Claude Code gives you a one-line command that connects Claude Code to this workspace. Claude can then read, search, write and move pages for you.')] },
    { type: 'divider', props: {} },
    { type: 'quote', props: {}, content: [t('Notes without the bloat. Or the bill.')] },
  ];
  db.prepare('INSERT INTO pages (id,parent_id,owner_id,workspace_id,title,icon,content,position) VALUES (?,?,?,?,?,?,?,0)')
    .run(crypto.randomUUID(), null, 1, wid, 'Welcome to NoteBit', 'ph:HandWaving:#a78bdb', JSON.stringify(welcome));
}
try { db.prepare("UPDATE page_access SET role='read' WHERE role='view'").run(); db.prepare("UPDATE page_access SET role='write' WHERE role='edit'").run(); } catch {}
for (const usr of db.prepare('SELECT id FROM users WHERE is_admin=1').all())   // super-admins are managers everywhere
  for (const w of db.prepare('SELECT id FROM workspaces').all()) db.prepare('INSERT OR IGNORE INTO workspace_member (workspace_id,user_id,role) VALUES (?,?,?)').run(w.id, usr.id, 'manage');
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
const workspaceInfo = () => ({ name: getSetting('workspace_name', 'My Workspace'), icon: getSetting('workspace_icon', 'ph:BookOpen') });

// ---- email (Resend HTTP API) ----
async function sendEmail(to, subject, html) {
  const key = getSetting('resend_key') || process.env.RESEND_API_KEY; if (!key) return { ok: false, error: 'no RESEND_API_KEY' };
  try {
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: getSetting('mail_from') || process.env.MAIL_FROM || 'NoteBit <onboarding@resend.dev>', to, subject, html }),
    });
    const body = await r.json().catch(() => ({}));
    return { ok: r.ok, status: r.status, body };
  } catch (e) { return { ok: false, error: String(e) }; }
}
function inviteEmail(email, password, inviter, wsName) {
  const url = getSetting('app_url') || process.env.APP_URL || 'http://localhost:8200';
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
const tokenHash = (t) => crypto.createHash('sha256').update(String(t)).digest('hex');
const userFromToken = (tok) => {
  if (!tok || !/^nb_[a-f0-9]{40}$/.test(tok)) return null;
  const row = db.prepare('SELECT id,user_id FROM api_tokens WHERE token_hash=?').get(tokenHash(tok)); if (!row) return null;
  const u = db.prepare('SELECT id,email,name,is_admin,avatar,theme,prefs FROM users WHERE id=?').get(row.user_id); if (!u) return null;
  try { db.prepare("UPDATE api_tokens SET last_used_at=datetime('now') WHERE id=?").run(row.id); } catch {}
  return { ...u, via: 'token' };
};
const userFromReq = (req) => {
  const auth = req.headers?.authorization || '';
  if (/^Bearer\s+nb_/i.test(auth)) return userFromToken(auth.replace(/^Bearer\s+/i, '').trim());
  const t = req.cookies?.sid; if (!t) return null; const s = db.prepare('SELECT * FROM sessions WHERE token=?').get(t); if (!s || s.expires_at < Date.now()) return null; return db.prepare('SELECT id,email,name,is_admin,avatar,theme,prefs FROM users WHERE id=?').get(s.user_id) || null; };

// ---- permissions (Notion-style: owner + admin override + grants, inherited down the tree) ----
function ancestors(pageId) { const out = []; let cur = pageId, g = 0; while (cur && g++ < 200) { const p = db.prepare('SELECT id,parent_id,owner_id,locked FROM pages WHERE id=?').get(cur); if (!p) break; out.push(p); cur = p.parent_id; } return out; }
// ---- workspace permission policy: what the Read and Write roles may do, per action.
// Managers (and super-admins) can always do everything. Stored as JSON on the workspace.
export const ACTIONS = [
  { key: 'edit', label: 'Edit pages', desc: 'Change page text, title, icon, tags and cover', def: { read: false, write: true } },
  { key: 'comment', label: 'Comment', desc: 'Post comments and @mention people', def: { read: true, write: true } },
  { key: 'create', label: 'Create top-level pages', desc: 'Add new pages and boards at the root of the sidebar', def: { read: false, write: false } },
  { key: 'subpage', label: 'Create sub-pages', desc: 'Add pages under pages they can edit', def: { read: false, write: true } },
  { key: 'move', label: 'Move and reorder pages', desc: 'Drag pages around the sidebar and into other pages', def: { read: false, write: true } },
  { key: 'delete', label: 'Delete pages', desc: 'Trash any page they can edit (otherwise only pages they created)', def: { read: false, write: false } },
  { key: 'publish', label: 'Publish to the web', desc: 'Make a page readable by anyone with the link', def: { read: false, write: true } },
  { key: 'cards', label: 'Use boards', desc: 'Add and move cards in member columns', def: { read: false, write: true } },
  { key: 'templates', label: 'Save templates', desc: 'Turn a page into a workspace template', def: { read: false, write: false } },
  { key: 'api', label: 'Connect Claude Code', desc: 'Use a personal token (MCP) to read and change what they can already see', def: { read: true, write: true } },
];
const policyCache = new Map();
function wsPolicy(wsId) {
  if (policyCache.has(wsId)) return policyCache.get(wsId);
  let pol = {}; try { pol = JSON.parse(db.prepare('SELECT policy FROM workspaces WHERE id=?').get(wsId)?.policy || '{}') || {}; } catch {}
  const out = { read: {}, write: {} };
  for (const a of ACTIONS) for (const r of ['read', 'write']) out[r][a.key] = typeof pol?.[r]?.[a.key] === 'boolean' ? pol[r][a.key] : a.def[r];
  policyCache.set(wsId, out);
  return out;
}
const wsRoleOf = (user, wsId) => wsId ? db.prepare('SELECT role FROM workspace_member WHERE workspace_id=? AND user_id=?').get(wsId, user.id)?.role || null : null;
// can(user, workspaceId, action): the policy answer for this user's workspace role
function can(user, wsId, action) {
  if (!user) return false;
  if (user.is_admin) return true;
  const role = wsRoleOf(user, wsId);
  if (role === 'manage') return true;
  if (role !== 'read' && role !== 'write') return false;
  return !!wsPolicy(wsId)[role][action];
}
function roleAccess(role, wsId) {
  if (role === 'manage') return { view: true, edit: true, admin: true };
  const r = role === 'edit' ? 'write' : role;
  if (r === 'write' || r === 'read') return { view: true, edit: wsId ? !!wsPolicy(wsId)[r].edit : r === 'write' };
  return { view: true, edit: false };
}
function columnPerm(columnId) { return db.prepare('SELECT col_perm FROM pages WHERE id=?').get(columnId)?.col_perm === 'manager' ? 'manager' : 'member'; }
function access(user, pageId) {
  if (!user) return { view: false, edit: false };
  const page = db.prepare('SELECT workspace_id,parent_id,status FROM pages WHERE id=?').get(pageId);
  if (user.via === 'token' && page?.workspace_id && !can(user, page.workspace_id, 'api')) return { view: false, edit: false };
  if (user.is_admin) return { view: true, edit: true, admin: true };
  const wsRole = page?.workspace_id ? db.prepare('SELECT role FROM workspace_member WHERE workspace_id=? AND user_id=?').get(page.workspace_id, user.id)?.role : null;
  let res = null, locked = false;
  if (page?.parent_id) { const par = db.prepare('SELECT view,col_perm FROM pages WHERE id=?').get(page.parent_id); if (par && par.view === 'column' && par.col_perm === 'manager') locked = true; }
  for (const p of ancestors(pageId)) {
    if (p.locked) locked = true;
    if (!res) {
      // the creator gets admin by default, but an explicit page grant (set by a
      // workspace manager) overrides it: ownership is a badge, not a superpower
      const g = db.prepare('SELECT role FROM page_access WHERE page_id=? AND user_id=?').get(p.id, user.id);
      if (g) res = roleAccess(g.role, null);
      else if (p.owner_id === user.id) res = { view: true, edit: true, admin: true };
    }
  }
  if (!res && wsRole) res = roleAccess(wsRole, page.workspace_id);
  if (!res) res = { view: false, edit: false };
  if (wsRole === 'manage') res = { view: true, edit: true, admin: true }; // managers always keep control
  if (locked && res.view && wsRole !== 'manage') res = { view: true, edit: false, admin: false };
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
  let ok;
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
  return db.prepare('SELECT id,parent_id,title,icon,content,tags,position,cover,view,status,board_cols,list_cards,description,col_perm FROM pages WHERE workspace_id=? AND deleted_at IS NULL ORDER BY position,created_at').all(req.params.id);
});
// lossless NoteBit-to-NoteBit import: remaps ids (tree, page links, board columns, card
// statuses) so boards and links survive migration between instances
app.post('/api/workspaces/:id/import-native', async (req, reply) => {
  const u = requireUser(req, reply); if (!u) return;
  if (!canManageWs(u, req.params.id)) return reply.code(403).send({ error: 'only managers' });
  const pages = req.body?.pages;
  if (!Array.isArray(pages) || !pages.length) return reply.code(400).send({ error: 'no pages in file' });
  if (pages.length > 5000) return reply.code(400).send({ error: 'file too large (over 5000 pages)' });
  const idMap = new Map();
  for (const p of pages) if (p && p.id) idMap.set(String(p.id), crypto.randomUUID());
  const remap = (s) => { if (!s || typeof s !== 'string') return s; let out = s; for (const [a, b] of idMap) out = out.split(a).join(b); return out; };
  const basePos = db.prepare('SELECT MAX(position) m FROM pages WHERE workspace_id=? AND parent_id IS NULL AND deleted_at IS NULL').get(req.params.id)?.m || 0;
  const ins = db.prepare('INSERT INTO pages (id,parent_id,owner_id,workspace_id,title,icon,content,tags,position,cover,view,status,board_cols,list_cards,description,col_perm) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)');
  let n = 0;
  db.transaction(() => {
    for (const p of pages) {
      if (!p || !p.id || !idMap.has(String(p.id))) continue;
      const par = p.parent_id && idMap.has(String(p.parent_id)) ? idMap.get(String(p.parent_id)) : null;
      ins.run(
        idMap.get(String(p.id)), par, u.id, req.params.id,
        String(p.title || 'Untitled').slice(0, 300), p.icon || '📄',
        remap(typeof p.content === 'string' ? p.content : JSON.stringify(p.content || [])),
        typeof p.tags === 'string' ? p.tags : JSON.stringify(p.tags || []),
        (Number(p.position) || 0) + (par ? 0 : basePos + 1),
        p.cover || null, p.view || 'doc',
        p.status != null ? remap(String(p.status)) : null,
        p.board_cols ? remap(typeof p.board_cols === 'string' ? p.board_cols : JSON.stringify(p.board_cols)) : null,
        p.list_cards ? 1 : 0, p.description || null,
        p.col_perm === 'manager' ? 'manager' : 'member'
      );
      n++;
    }
  })();
  return { ok: true, imported: n };
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
  if (!can(u, req.params.id, 'templates')) return reply.code(403).send({ error: 'saving templates is a manager action in this workspace' });
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
  // the first account is created after the workspace was seeded, so give it a proper
  // membership row too (member lists, face pile and per-workspace roles rely on it)
  if (first) for (const w of db.prepare('SELECT id FROM workspaces').all()) db.prepare('INSERT OR IGNORE INTO workspace_member (workspace_id,user_id,role) VALUES (?,?,?)').run(w.id, info.lastInsertRowid, 'manage');
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
let _upd = { at: 0, data: null };
app.get('/api/update-check', async (req) => {
  if (!req.query?.force && _upd.data && Date.now() - _upd.at < 1800000) return _upd.data;
  let latest = null, url = 'https://github.com/GroyalCodes/notebit/releases';
  try { const r = await fetch('https://api.github.com/repos/GroyalCodes/notebit/releases/latest', { headers: { 'User-Agent': 'notebit', Accept: 'application/vnd.github+json' } }); if (r.ok) { const j = await r.json(); latest = String(j.tag_name || '').replace(/^v/, '') || null; url = j.html_url || url; } } catch {}
  const data = { current: VERSION, latest, updateAvailable: !!latest && latest !== VERSION, url };
  if (latest) _upd = { at: Date.now(), data };   // never cache a failed lookup as "up to date"
  return data;
});
app.get('/api/me', async (req, reply) => { const u = userFromReq(req); if (!u) return reply.code(401).send({ error: 'unauthorized' }); return u; });

// ---------- comments + inbox ----------
const userPub = (id) => { const r = db.prepare('SELECT id,name,email,avatar FROM users WHERE id=?').get(id); return r ? { id: r.id, name: r.name || r.email, avatar: r.avatar } : { id, name: 'Someone' }; };
// ---------- page changelog ----------
// coalesce: same user + page + action within 15 min just refreshes the timestamp (keeps the log readable during active editing)
const logPage = (pageId, userId, act, detail) => {
  try {
    const row = db.prepare("SELECT id FROM page_log WHERE page_id=? AND user_id=? AND act=? AND detail=? AND created_at > datetime('now','-15 minutes') ORDER BY created_at DESC LIMIT 1").get(pageId, userId, act, detail);
    if (row) { db.prepare("UPDATE page_log SET created_at=datetime('now') WHERE id=?").run(row.id); return; }
    db.prepare('INSERT INTO page_log (id,page_id,user_id,act,detail) VALUES (?,?,?,?,?)').run(crypto.randomUUID(), pageId, userId, act, detail);
    db.prepare('DELETE FROM page_log WHERE page_id=? AND id NOT IN (SELECT id FROM page_log WHERE page_id=? ORDER BY created_at DESC LIMIT 60)').run(pageId, pageId);
  } catch {}
};
// ---------- page version history ----------
// a snapshot of the page BEFORE an edit, at most one per 10 minutes, last 40 kept per page
const snapshotVersion = (p, userId, force = false) => {
  try {
    if (!force) { const last = db.prepare("SELECT created_at FROM page_versions WHERE page_id=? AND created_at > datetime('now','-10 minutes') ORDER BY created_at DESC LIMIT 1").get(p.id); if (last) return; }
    db.prepare('INSERT INTO page_versions (id,page_id,user_id,title,content) VALUES (?,?,?,?,?)').run(crypto.randomUUID(), p.id, userId, p.title, p.content);
    db.prepare('DELETE FROM page_versions WHERE page_id=? AND id NOT IN (SELECT id FROM page_versions WHERE page_id=? ORDER BY created_at DESC LIMIT 40)').run(p.id, p.id);
  } catch {}
};
app.get('/api/pages/:id/versions', async (req, reply) => {
  const u = requireUser(req, reply); if (!u) return;
  if (!access(u, req.params.id).view) return reply.code(403).send({ error: 'no access' });
  return db.prepare('SELECT id,title,user_id,created_at,length(content) AS size FROM page_versions WHERE page_id=? ORDER BY created_at DESC').all(req.params.id)
    .map(v => ({ id: v.id, title: v.title, created_at: v.created_at, size: v.size, user: userPub(v.user_id) }));
});
app.post('/api/pages/:id/versions', async (req, reply) => {   // "save a version now"
  const u = requireUser(req, reply); if (!u) return;
  if (!access(u, req.params.id).edit) return reply.code(403).send({ error: 'no edit permission' });
  const p = db.prepare('SELECT id,title,content FROM pages WHERE id=?').get(req.params.id);
  if (!p) return reply.code(404).send({ error: 'not found' });
  snapshotVersion(p, u.id, true);
  return { ok: true };
});
app.get('/api/versions/:vid', async (req, reply) => {
  const u = requireUser(req, reply); if (!u) return;
  const v = db.prepare('SELECT * FROM page_versions WHERE id=?').get(req.params.vid);
  if (!v) return reply.code(404).send({ error: 'not found' });
  if (!access(u, v.page_id).view) return reply.code(403).send({ error: 'no access' });
  return { id: v.id, page_id: v.page_id, title: v.title, content: v.content, created_at: v.created_at, user: userPub(v.user_id) };
});
app.get('/api/pages/:id/log', async (req, reply) => {
  const u = requireUser(req, reply); if (!u) return;
  if (!access(u, req.params.id).view) return reply.code(403).send({ error: 'no access' });
  return db.prepare('SELECT * FROM page_log WHERE page_id=? ORDER BY created_at DESC LIMIT 30').all(req.params.id)
    .map(l => ({ id: l.id, act: l.act, detail: l.detail, created_at: l.created_at, user: userPub(l.user_id) }));
});
app.get('/api/pages/:id/comments', async (req, reply) => {
  const u = requireUser(req, reply); if (!u) return;
  if (!access(u, req.params.id).view) return reply.code(403).send({ error: 'no access' });
  return db.prepare('SELECT * FROM comments WHERE page_id=? ORDER BY created_at').all(req.params.id)
    .map(c => ({ id: c.id, body: c.body, created_at: c.created_at, author: userPub(c.user_id), mine: c.user_id === u.id }));
});
app.post('/api/pages/:id/comments', async (req, reply) => {
  const u = requireUser(req, reply); if (!u) return;
  const pageId = req.params.id;
  if (!access(u, pageId).view) return reply.code(403).send({ error: 'no access' });
  const body = (req.body?.body || '').trim(); const mentions = req.body?.mentions || [];
  if (!body) return reply.code(400).send({ error: 'empty' });
  const wsOf = db.prepare('SELECT workspace_id FROM pages WHERE id=?').get(pageId)?.workspace_id;
  if (!can(u, wsOf, 'comment')) return reply.code(403).send({ error: 'commenting is turned off for your role' });
  const id = crypto.randomUUID();
  db.prepare('INSERT INTO comments (id,page_id,user_id,body,mentions) VALUES (?,?,?,?,?)').run(id, pageId, u.id, body, JSON.stringify(mentions));
  const page = db.prepare('SELECT title,owner_id FROM pages WHERE id=?').get(pageId);
  const sent = new Set([u.id]);
  const notify = (uid, type) => { uid = Number(uid); if (!uid || sent.has(uid)) return; sent.add(uid); db.prepare('INSERT INTO notifications (id,user_id,actor_id,type,page_id,comment_id,body) VALUES (?,?,?,?,?,?,?)').run(crypto.randomUUID(), uid, u.id, type, pageId, id, body.slice(0, 160)); };
  for (const m of mentions) notify(m, 'mention');
  if (page) notify(page.owner_id, 'comment');
  logPage(pageId, u.id, '+', 'commented');
  return { ok: true, id };
});
app.delete('/api/comments/:id', async (req, reply) => {
  const u = requireUser(req, reply); if (!u) return;
  const c = db.prepare('SELECT * FROM comments WHERE id=?').get(req.params.id);
  if (!c) return reply.code(404).send({ error: 'not found' });
  if (c.user_id !== u.id && !u.is_admin) return reply.code(403).send({ error: 'not yours' });
  db.prepare('DELETE FROM comments WHERE id=?').run(req.params.id);
  return { ok: true };
});
app.get('/api/inbox', async (req, reply) => {
  const u = requireUser(req, reply); if (!u) return;
  const items = db.prepare('SELECT * FROM notifications WHERE user_id=? ORDER BY created_at DESC LIMIT 40').all(u.id).map(n => {
    const pg = db.prepare('SELECT title,icon FROM pages WHERE id=? AND deleted_at IS NULL').get(n.page_id);
    return { id: n.id, type: n.type, read: n.read, created_at: n.created_at, body: n.body, page_id: n.page_id, page: pg ? { title: pg.title, icon: pg.icon } : null, actor: userPub(n.actor_id) };
  });
  return { unread: db.prepare('SELECT count(*) c FROM notifications WHERE user_id=? AND read=0').get(u.id).c, items };
});
app.post('/api/inbox/read', async (req, reply) => {
  const u = requireUser(req, reply); if (!u) return;
  if (req.body?.id) db.prepare('UPDATE notifications SET read=1 WHERE id=? AND user_id=?').run(req.body.id, u.id);
  else db.prepare('UPDATE notifications SET read=1 WHERE user_id=?').run(u.id);
  return { ok: true };
});
app.get('/api/users', async (req, reply) => { if (!requireUser(req, reply)) return; return db.prepare('SELECT id,email,name,is_admin,avatar,theme FROM users ORDER BY name').all(); });

// ---- profile / account ----
app.put('/api/me', async (req, reply) => {
  const u = requireUser(req, reply); if (!u) return;
  const { name, avatar, theme, prefs } = req.body || {};
  if (name !== undefined) db.prepare('UPDATE users SET name=? WHERE id=?').run(String(name).slice(0, 80), u.id);
  if (avatar !== undefined) db.prepare('UPDATE users SET avatar=? WHERE id=?').run(avatar ? String(avatar).slice(0, 400000) : null, u.id);
  if (theme !== undefined) db.prepare('UPDATE users SET theme=? WHERE id=?').run(theme ? String(theme).slice(0, 20) : null, u.id);
  if (prefs !== undefined) { // merge, so callers can update one key without clobbering others
    let cur = {}; try { cur = JSON.parse(u.prefs || '{}'); } catch {}
    const next = { ...cur, ...(prefs && typeof prefs === 'object' ? prefs : {}) };
    db.prepare('UPDATE users SET prefs=? WHERE id=?').run(JSON.stringify(next).slice(0, 200000), u.id);
  }
  return db.prepare('SELECT id,email,name,is_admin,avatar,theme,prefs FROM users WHERE id=?').get(u.id);
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
app.get('/api/admin/settings', async (req, reply) => {
  if (!requireAdmin(req, reply)) return;
  const keySource = getSetting('resend_key') ? 'app' : (process.env.RESEND_API_KEY ? 'env' : null);
  return { allow_signup: allowSignup(), email_configured: !!keySource, email_key_source: keySource, mail_from: getSetting('mail_from') || process.env.MAIL_FROM || '', app_url: getSetting('app_url') || process.env.APP_URL || '' };
});
app.post('/api/admin/test-email', async (req, reply) => {
  const u = requireAdmin(req, reply); if (!u) return;
  const r = await sendEmail(u.email, 'NoteBit test email', '<p>Email invites are working. Sent from your NoteBit instance.</p>');
  return { ok: !!r.ok, detail: r.ok ? 'sent to ' + u.email : (r.body?.message || r.error || 'failed') };
});
app.get('/api/admin/autostart', async (req, reply) => { if (!requireAdmin(req, reply)) return; return AS.status(); });
app.post('/api/admin/autostart', async (req, reply) => {
  if (!requireAdmin(req, reply)) return;
  const st = AS.status();
  if (!st.supported) return reply.code(400).send({ error: st.managed === 'container' ? 'This install is managed by its host, which already restarts it.' : 'Autostart is not available on this system.' });
  try { if (req.body?.enabled) AS.enable(); else AS.disable(); return AS.status(); }
  catch (e) { return reply.code(500).send({ error: e.message }); }
});
app.put('/api/admin/settings', async (req, reply) => {
  if (!requireAdmin(req, reply)) return;
  const { allow_signup, resend_key, mail_from, app_url } = req.body || {};
  if (allow_signup !== undefined) setSetting('allow_signup', allow_signup ? '1' : '0');
  if (resend_key !== undefined) setSetting('resend_key', String(resend_key).trim().slice(0, 200));
  if (mail_from !== undefined) setSetting('mail_from', String(mail_from).trim().slice(0, 200));
  if (app_url !== undefined) setSetting('app_url', String(app_url).trim().replace(/\/+$/, '').slice(0, 300));
  const keySource = getSetting('resend_key') ? 'app' : (process.env.RESEND_API_KEY ? 'env' : null);
  return { allow_signup: allowSignup(), email_configured: !!keySource, email_key_source: keySource, mail_from: getSetting('mail_from') || process.env.MAIL_FROM || '', app_url: getSetting('app_url') || process.env.APP_URL || '' };
});

// ---- search ----
// plain text of a page body (BlockNote JSON), cached per page + updated_at
const textCache = new Map();
function blocksText(content) {
  const out = [];
  const inline = (arr) => { for (const c of arr || []) { if (!c) continue; if (typeof c.text === 'string') out.push(c.text); else if (c.type === 'link') inline(c.content); else if (c.type === 'pageLink') out.push(c.props?.title || ''); } };
  const walk = (b) => {
    if (!b) return;
    if (Array.isArray(b.content)) inline(b.content);
    else if (b.content && b.content.type === 'tableContent') for (const row of b.content.rows || []) for (const cell of row.cells || []) inline(cell);
    if (b.props?.caption) out.push(b.props.caption);
    for (const k of b.children || []) walk(k);
  };
  try { const blocks = JSON.parse(content || '[]'); if (Array.isArray(blocks)) blocks.forEach(walk); } catch {}
  return out.join(' ').replace(/\s+/g, ' ').trim();
}
const pageText = (p) => { const c = textCache.get(p.id); if (c && c.at === p.updated_at) return c.text; const text = blocksText(p.content); textCache.set(p.id, { at: p.updated_at, text }); return text; };
app.get('/api/search', async (req, reply) => {
  const u = requireUser(req, reply); if (!u) return;
  const q = String(req.query.q || '').toLowerCase().trim();
  const ws = req.query.workspace;
  if (!q) return [];
  const words = q.split(/\s+/).filter(Boolean);
  const hits = [];
  const titles = new Map(db.prepare('SELECT id,title FROM pages WHERE deleted_at IS NULL').all().map(r => [r.id, r.title]));
  for (const p of db.prepare("SELECT id,title,icon,content,workspace_id,parent_id,updated_at,view FROM pages WHERE deleted_at IS NULL" + (ws ? ' AND workspace_id=?' : '') + ' ORDER BY updated_at DESC').all(...(ws ? [ws] : []))) {
    if (p.view === 'column') continue;
    const title = (p.title || 'Untitled').toLowerCase();
    let text = null;
    let score = 0;
    if (title === q) score += 100; else if (title.startsWith(q)) score += 60; else if (title.includes(q)) score += 40;
    const titleWords = words.every(w => title.includes(w));
    if (!score && titleWords) score += 25;
    if (!score) {
      text = pageText(p).toLowerCase();
      if (text.includes(q)) score += 15; else if (words.every(w => text.includes(w))) score += 8;
    }
    if (!score) continue;
    if (!access(u, p.id).view) continue;
    if (text === null) text = pageText(p).toLowerCase();
    let snippet = null;
    const i = text.indexOf(q) >= 0 ? text.indexOf(q) : text.indexOf(words[0]);
    if (i >= 0) { const raw = pageText(p); const a = Math.max(0, i - 50), b = Math.min(raw.length, i + q.length + 90); snippet = (a > 0 ? '…' : '') + raw.slice(a, b) + (b < raw.length ? '…' : ''); }
    hits.push({ id: p.id, title: p.title, icon: p.icon, score, snippet, updated_at: p.updated_at, parent: p.parent_id ? (titles.get(p.parent_id) || null) : null });
    if (hits.length >= 60) break;
  }
  hits.sort((a, b) => b.score - a.score || (b.updated_at > a.updated_at ? 1 : -1));
  return hits.slice(0, 30);
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
  if (!parent_id) mayAdd = can(u, wsId, 'create');                                                                                   // new top-level page: policy (managers always)
  else if (parentRow?.view === 'column') mayAdd = canManageWs(u, wsId) || (can(u, wsId, 'cards') && parentRow.col_perm !== 'manager' && access(u, parent_id).edit); // card into a column
  else mayAdd = canManageWs(u, wsId) || (can(u, wsId, 'subpage') && access(u, parent_id).edit);                                     // sub-page: must be able to edit the parent
  if (!mayAdd) return reply.code(403).send({ error: 'no permission to add a page here' });
  const id = crypto.randomUUID();
  const pos = (db.prepare('SELECT MAX(position) m FROM pages WHERE parent_id IS ?').get(parent_id)?.m || 0) + 1;
  db.prepare('INSERT INTO pages (id,parent_id,owner_id,workspace_id,title,position,content,status) VALUES (?,?,?,?,?,?,?,?)').run(id, parent_id, u.id, wsId, title, pos, '[]', status);
  logPage(id, u.id, '+', 'created this page');
  if (parent_id) logPage(parent_id, u.id, '+', `added "${String(title).slice(0, 60) || 'Untitled'}"`);
  return db.prepare('SELECT * FROM pages WHERE id=?').get(id);
});
app.get('/api/pages/:id', async (req, reply) => {
  const u = requireUser(req, reply); if (!u) return;
  const a = access(u, req.params.id); if (!a.view) return reply.code(403).send({ error: 'no access' });
  const p = db.prepare('SELECT * FROM pages WHERE id=?').get(req.params.id);
  if (!p) return reply.code(404).send({ error: 'not found' });
  if (req.query?.format === 'md') { reply.header('Content-Type', 'text/markdown; charset=utf-8'); return `# ${p.title || 'Untitled'}\n\n` + blocksToMarkdown(currentBlocks(p)); }
  return { ...p, can_edit: a.edit, can_admin: !!a.admin, can_delete: mayDelete(u, p.id) };
});
app.put('/api/pages/:id', async (req, reply) => {
  const u = requireUser(req, reply); if (!u) return;
  if (!access(u, req.params.id).edit) return reply.code(403).send({ error: 'no edit permission' });
  const p = db.prepare('SELECT * FROM pages WHERE id=?').get(req.params.id);
  if (!p) return reply.code(404).send({ error: 'not found' });
  const b = req.body || {};
  if (b.locked !== undefined && !(u.is_admin || canManageWs(u, p.workspace_id))) return reply.code(403).send({ error: 'only managers can lock pages' });
  if (b.col_perm !== undefined && !(u.is_admin || canManageWs(u, p.workspace_id))) return reply.code(403).send({ error: 'only managers can set column access' });
  if (b.is_public !== undefined && !!b.is_public !== !!p.is_public && !can(u, p.workspace_id, 'publish')) return reply.code(403).send({ error: 'publishing is a manager action in this workspace' });
  if (b.parent_id !== undefined && b.parent_id !== p.parent_id) {
    const tgt = b.parent_id ? db.prepare('SELECT view,col_perm FROM pages WHERE id=?').get(b.parent_id) : null;
    const src = p.parent_id ? db.prepare('SELECT view,col_perm FROM pages WHERE id=?').get(p.parent_id) : null;
    const cardMove = tgt?.view === 'column' || src?.view === 'column';
    if (!can(u, p.workspace_id, cardMove ? 'cards' : 'move')) return reply.code(403).send({ error: cardMove ? 'moving cards is turned off for your role' : 'moving pages is turned off for your role' });
    if (((tgt?.view === 'column' && tgt.col_perm === 'manager') || (src?.view === 'column' && src.col_perm === 'manager')) && !(u.is_admin || canManageWs(u, p.workspace_id))) return reply.code(403).send({ error: 'only managers can move cards in/out of that column' });
    // can only move a page INTO a section you can edit — blocks dropping into a locked or read-only page
    if (b.parent_id && tgt?.view !== 'column' && !(canManageWs(u, p.workspace_id) || access(u, b.parent_id).edit)) return reply.code(403).send({ error: "can't move into a locked or read-only page" });
  }
  if (b.position !== undefined && b.parent_id === undefined && b.position !== p.position && !can(u, p.workspace_id, 'move')) return reply.code(403).send({ error: 'reordering pages is turned off for your role' });
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
  if (b.title !== undefined && b.title !== p.title) logPage(p.id, u.id, '~', `renamed to "${String(b.title).slice(0, 60) || 'Untitled'}"`);
  if (b.content !== undefined && b.content !== p.content) { logPage(p.id, u.id, '~', 'edited'); if (p.content && p.content !== '[]') snapshotVersion(p, u.id); }
  if (b.parent_id !== undefined && b.parent_id !== p.parent_id) logPage(p.id, u.id, '~', 'moved');
  if (b.status !== undefined && b.status !== p.status) logPage(p.id, u.id, '~', 'moved card');
  if (b.locked !== undefined && !!b.locked !== !!p.locked) logPage(p.id, u.id, '~', b.locked ? 'locked the page' : 'unlocked the page');
  if (b.is_public !== undefined && !!b.is_public !== !!p.is_public) logPage(p.id, u.id, '~', b.is_public ? 'published to web' : 'unpublished');
  if (b.tags !== undefined) logPage(p.id, u.id, '~', 'updated tags');
  if (b.icon !== undefined && b.icon !== p.icon) logPage(p.id, u.id, '~', 'changed the icon');
  if (b.cover !== undefined && b.cover !== p.cover) logPage(p.id, u.id, '~', b.cover ? 'updated the cover' : 'removed the cover');
  if (b.board_cols !== undefined) logPage(p.id, u.id, '~', 'updated the board');
  return db.prepare('SELECT * FROM pages WHERE id=?').get(p.id);
});
const mayDelete = (u, pageId) => { const a = access(u, pageId); if (a.admin) return true; const ws = db.prepare('SELECT workspace_id FROM pages WHERE id=?').get(pageId)?.workspace_id; return !!(a.edit && can(u, ws, 'delete')); };
app.delete('/api/pages/:id', async (req, reply) => {
  const u = requireUser(req, reply); if (!u) return;
  if (!mayDelete(u, req.params.id)) return reply.code(403).send({ error: 'only the page creator or a manager can delete this page' });
  const ids = [], stack = [req.params.id];
  while (stack.length) { const c = stack.pop(); ids.push(c); for (const k of db.prepare('SELECT id FROM pages WHERE parent_id=? AND deleted_at IS NULL').all(c)) stack.push(k.id); }
  const upd = db.prepare("UPDATE pages SET deleted_at=datetime('now') WHERE id=?");
  const pg = db.prepare('SELECT title,parent_id FROM pages WHERE id=?').get(req.params.id);
  db.transaction(() => ids.forEach(i => upd.run(i)))();
  logPage(req.params.id, u.id, '-', 'moved to trash');
  if (pg?.parent_id) logPage(pg.parent_id, u.id, '-', `removed "${String(pg.title).slice(0, 60) || 'Untitled'}"`);
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
    return { id: m.id, name: m.name, email: m.email, avatar: m.avatar, wsRole: m.role, pageRole, isOwner, role: pageRole || (isOwner ? 'manage' : m.role) };
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
    logPage(req.params.id, u.id, '+', 'restored from trash');
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
  const all = db.prepare('SELECT id,title,icon,content,parent_id,view,tags FROM pages WHERE workspace_id=? AND deleted_at IS NULL').all(req.params.id);
  const pages = all.filter(p => access(u, p.id).view); // include board columns + cards as nodes
  const ids = new Set(pages.map(p => p.id));
  const nodes = pages.map(p => { let tg = []; try { tg = (JSON.parse(p.tags || '[]') || []).map(t => (typeof t === 'string' ? t : t?.name || '').toLowerCase()).filter(Boolean); } catch {} return { id: p.id, title: p.title, icon: p.icon, tags: tg, root: !p.parent_id, view: p.view || 'doc' }; });
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

// ---- image uploads (stored next to the database, served at /uploads/<id>) ----
const IMAGE_TYPES = { png: [0x89, 0x50, 0x4e, 0x47], jpg: [0xff, 0xd8, 0xff], gif: [0x47, 0x49, 0x46, 0x38], webp: null };
const sniffImage = (buf) => {
  if (buf.length < 12) return null;
  for (const [ext, magic] of Object.entries(IMAGE_TYPES)) if (magic && magic.every((b, i) => buf[i] === b)) return ext;
  if (buf.slice(0, 4).toString('ascii') === 'RIFF' && buf.slice(8, 12).toString('ascii') === 'WEBP') return 'webp';
  return null;
};
app.addContentTypeParser(['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'application/octet-stream'], { parseAs: 'buffer', bodyLimit: 12 * 1024 * 1024 }, (req, body, done) => done(null, body));
app.post('/api/upload', async (req, reply) => {
  const u = requireUser(req, reply); if (!u) return;
  const buf = req.body;
  if (!Buffer.isBuffer(buf) || !buf.length) return reply.code(400).send({ error: 'send the image as the request body' });
  const ext = sniffImage(buf);
  if (!ext) return reply.code(415).send({ error: 'only PNG, JPEG, GIF and WebP images are supported' });
  const name = crypto.randomUUID() + '.' + ext;
  fs.writeFileSync(path.join(UPLOAD_DIR, name), buf);
  return { url: '/uploads/' + name, size: buf.length };
});
await app.register(fstatic, { root: UPLOAD_DIR, prefix: '/uploads/', decorateReply: false, immutable: true, maxAge: '365d' });


// ---- live page content helpers (REST + MCP) ----
// The Yjs document is the source of truth while a page is open; pages.content is the
// saved snapshot. Reads prefer the live doc so unsaved keystrokes are visible; writes go
// to BOTH so open editors update instantly and nothing is lost on reload.
const roomName = (pageId) => pageId;
function currentBlocks(p) {
  const live = collabDocs.get(roomName(p.id));
  if (live) { try { const b = readBlocks(live.ydoc); if (b) return b; } catch {} }
  try { const b = JSON.parse(p.content || '[]'); return Array.isArray(b) ? b : []; } catch { return []; }
}
function setPageBlocks(p, blocks, userId, { append = false } = {}) {
  const hasDoc = collabDocs.has(roomName(p.id)) || !!db.prepare('SELECT 1 FROM ydocs WHERE page_id=?').get(roomName(p.id));
  let next = append ? [...currentBlocks(p), ...blocks] : blocks;
  if (hasDoc) {
    // a live/stored Yjs doc exists: write there so open editors update, then mirror it
    const d = getCollabDoc(roomName(p.id));
    const live = readBlocks(d.ydoc);
    if (append && live) writeBlocks(d.ydoc, blocks, { append: true }); else writeBlocks(d.ydoc, next);
    persistYDoc(roomName(p.id), d.ydoc);
    next = readBlocks(d.ydoc) || next;
  }
  const content = JSON.stringify(next);
  if (p.content && p.content !== '[]' && p.content !== content) snapshotVersion(p, userId);
  db.prepare("UPDATE pages SET content=?, updated_at=datetime('now') WHERE id=?").run(content, p.id);
  logPage(p.id, userId, '~', 'edited');
  return next;
}
const bumpTreeSignal = (wsId, pageId) => { try { const d = collabDocs.get('tree-' + wsId); if (!d) return; const m = d.ydoc.getMap('tree'); d.ydoc.transact(() => { m.set('v', (m.get('v') || 0) + 1); if (pageId) m.set('p:' + pageId, (m.get('p:' + pageId) || 0) + 1); }); } catch {} };

// ---- personal tokens (Claude Code / MCP) ----
app.get('/api/me/tokens', async (req, reply) => {
  const u = requireUser(req, reply); if (!u) return;
  return db.prepare('SELECT id,name,prefix,created_at,last_used_at FROM api_tokens WHERE user_id=? ORDER BY created_at DESC').all(u.id);
});
app.post('/api/me/tokens', async (req, reply) => {
  const u = requireUser(req, reply); if (!u) return;
  if (u.via === 'token') return reply.code(403).send({ error: 'sign in to the app to create tokens' });
  const token = 'nb_' + crypto.randomBytes(20).toString('hex');
  const id = crypto.randomUUID();
  db.prepare('INSERT INTO api_tokens (id,user_id,name,token_hash,prefix) VALUES (?,?,?,?,?)').run(id, u.id, String(req.body?.name || 'Claude Code').slice(0, 60), tokenHash(token), token.slice(0, 10));
  return { id, token, name: String(req.body?.name || 'Claude Code').slice(0, 60), mcp_url: (getSetting('app_url') || process.env.APP_URL || '') + '/mcp' };
});
app.delete('/api/me/tokens/:id', async (req, reply) => {
  const u = requireUser(req, reply); if (!u) return;
  db.prepare('DELETE FROM api_tokens WHERE id=? AND user_id=?').run(req.params.id, u.id);
  return { ok: true };
});

// ---- workspace permission policy ----
app.get('/api/workspaces/:id/policy', async (req, reply) => {
  const u = requireUser(req, reply); if (!u) return;
  const role = u.is_admin ? 'manage' : wsRoleOf(u, req.params.id);
  if (!role) return reply.code(403).send({ error: 'not a member' });
  const caps = {}; for (const a of ACTIONS) caps[a.key] = can(u, req.params.id, a.key);
  return { actions: ACTIONS.map(a => ({ key: a.key, label: a.label, desc: a.desc })), policy: wsPolicy(req.params.id), role, can: caps, manage: role === 'manage' };
});
app.put('/api/workspaces/:id/policy', async (req, reply) => {
  const u = requireUser(req, reply); if (!u) return;
  if (!canManageWs(u, req.params.id)) return reply.code(403).send({ error: 'only managers' });
  const cur = wsPolicy(req.params.id); const b = req.body?.policy || req.body || {};
  const next = { read: { ...cur.read }, write: { ...cur.write } };
  for (const r of ['read', 'write']) for (const a of ACTIONS) if (typeof b?.[r]?.[a.key] === 'boolean') next[r][a.key] = b[r][a.key];
  db.prepare('UPDATE workspaces SET policy=? WHERE id=?').run(JSON.stringify(next), req.params.id);
  policyCache.delete(req.params.id);
  bumpTreeSignal(req.params.id);
  return { policy: wsPolicy(req.params.id) };
});
// pages in a workspace that have their own access rules (grants, locked, published)
app.get('/api/workspaces/:id/access-overview', async (req, reply) => {
  const u = requireUser(req, reply); if (!u) return;
  if (!canManageWs(u, req.params.id)) return reply.code(403).send({ error: 'only managers' });
  const grants = db.prepare('SELECT a.page_id,a.user_id,a.role,u.name,u.email FROM page_access a JOIN users u ON u.id=a.user_id').all();
  const byPage = new Map(); for (const g of grants) { (byPage.get(g.page_id) || byPage.set(g.page_id, []).get(g.page_id)).push({ user_id: g.user_id, name: g.name || g.email, role: g.role }); }
  return db.prepare("SELECT id,title,icon,locked,is_public,view,parent_id FROM pages WHERE workspace_id=? AND deleted_at IS NULL AND view!='column' ORDER BY position,created_at").all(req.params.id)
    .filter(p => p.locked || p.is_public || byPage.has(p.id))
    .map(p => ({ id: p.id, title: p.title, icon: p.icon, locked: !!p.locked, is_public: !!p.is_public, view: p.view, grants: byPage.get(p.id) || [] }));
});

// ---- workspace overview stats ----
app.get('/api/workspaces/:id/stats', async (req, reply) => {
  const u = requireUser(req, reply); if (!u) return;
  if (!u.is_admin && !wsRoleOf(u, req.params.id)) return reply.code(403).send({ error: 'not a member' });
  const all = db.prepare('SELECT id,title,icon,content,parent_id,view,updated_at,created_at FROM pages WHERE workspace_id=? AND deleted_at IS NULL').all(req.params.id).filter(p => access(u, p.id).view);
  const ids = new Set(all.map(p => p.id));
  const columns = new Set(all.filter(p => p.view === 'column').map(p => p.id));
  const boards = all.filter(p => p.view === 'board');
  const cards = all.filter(p => p.parent_id && columns.has(p.parent_id));
  const pages = all.filter(p => p.view !== 'column' && p.view !== 'board' && !(p.parent_id && columns.has(p.parent_id)));
  let words = 0, links = 0;
  for (const p of all) { if (p.view === 'column') continue; const t = pageText(p); if (t) words += t.split(/\s+/).filter(Boolean).length; if ((p.content || '').includes('pageLink')) for (const b of all) if (b.id !== p.id && p.content.includes(b.id)) links++; }
  const recent = all.filter(p => p.view !== 'column').sort((a, b) => (b.updated_at > a.updated_at ? 1 : -1)).slice(0, 8).map(p => ({ id: p.id, title: p.title, icon: p.icon, updated_at: p.updated_at, view: p.view }));
  const activity = db.prepare(`SELECT l.id,l.page_id,l.user_id,l.act,l.detail,l.created_at,p.title,p.icon FROM page_log l JOIN pages p ON p.id=l.page_id WHERE p.workspace_id=? AND p.deleted_at IS NULL ORDER BY l.created_at DESC LIMIT 40`).all(req.params.id)
    .filter(l => ids.has(l.page_id)).slice(0, 14).map(l => ({ id: l.id, act: l.act, detail: l.detail, created_at: l.created_at, user: userPub(l.user_id), page: { id: l.page_id, title: l.title, icon: l.icon } }));
  const members = db.prepare('SELECT COUNT(*) c FROM workspace_member WHERE workspace_id=?').get(req.params.id).c;
  const weekAgo = new Date(Date.now() - 7 * 864e5).toISOString().slice(0, 19).replace('T', ' ');
  const editedThisWeek = all.filter(p => p.view !== 'column' && p.updated_at > weekAgo).length;
  return { pages: pages.length, boards: boards.length, cards: cards.length, words, links, members, editedThisWeek, recent, activity };
});

// ---- Claude Code (MCP) ----
const ops = {
  wsOrFirst(u, wsId) { const list = ops.listWorkspaces(u); const w = wsId ? list.find(x => x.id === wsId) : list[0]; if (!w) throw new Error(wsId ? 'No access to that workspace' : 'No workspaces'); return w; },
  listWorkspaces(u) {
    const rows = u.is_admin ? db.prepare('SELECT id,name,icon FROM workspaces ORDER BY position,created_at').all().map(w => ({ ...w, role: 'manage' }))
      : db.prepare('SELECT w.id,w.name,w.icon,m.role FROM workspaces w JOIN workspace_member m ON m.workspace_id=w.id WHERE m.user_id=? ORDER BY w.position,w.created_at').all(u.id);
    return rows.filter(w => can(u, w.id, 'api'));
  },
  pagesOf(u, wsId) { return db.prepare('SELECT id,parent_id,title,icon,view,position,updated_at FROM pages WHERE workspace_id=? AND deleted_at IS NULL ORDER BY position,created_at').all(wsId).filter(p => access(u, p.id).view); },
  outline(u, wsId) {
    const w = ops.wsOrFirst(u, wsId); const pages = ops.pagesOf(u, w.id); const ids = new Set(pages.map(p => p.id));
    const kids = {}; for (const p of pages) { const par = p.parent_id && ids.has(p.parent_id) ? p.parent_id : '__root'; (kids[par] ||= []).push(p); }
    const lines = [`Workspace: ${w.name} (id: ${w.id})`];
    const walk = (par, d) => { for (const p of kids[par] || []) { const kind = p.view === 'board' ? ' [board]' : p.view === 'column' ? ' [column]' : ''; lines.push('  '.repeat(d) + '- ' + (p.title || 'Untitled') + kind + '  (id: ' + p.id + ')'); walk(p.id, d + 1); } };
    walk('__root', 0);
    return lines.length > 1 ? lines.join('\n') : lines[0] + '\n(no pages yet)';
  },
  search(u, q, wsId) {
    const query = String(q || '').toLowerCase().trim(); if (!query) return [];
    const words = query.split(/\s+/).filter(Boolean); const hits = [];
    const titles = new Map(db.prepare('SELECT id,title FROM pages WHERE deleted_at IS NULL').all().map(r => [r.id, r.title]));
    const wsIds = new Set(ops.listWorkspaces(u).map(w => w.id));
    for (const p of db.prepare('SELECT id,title,icon,content,workspace_id,parent_id,updated_at,view FROM pages WHERE deleted_at IS NULL' + (wsId ? ' AND workspace_id=?' : '') + ' ORDER BY updated_at DESC').all(...(wsId ? [wsId] : []))) {
      if (p.view === 'column' || !wsIds.has(p.workspace_id)) continue;
      const title = (p.title || 'Untitled').toLowerCase(); let score = 0;
      if (title === query) score += 100; else if (title.startsWith(query)) score += 60; else if (title.includes(query)) score += 40; else if (words.every(w => title.includes(w))) score += 25;
      const text = pageText(p).toLowerCase();
      if (!score) { if (text.includes(query)) score += 15; else if (words.every(w => text.includes(w))) score += 8; }
      if (!score || !access(u, p.id).view) continue;
      const i = text.indexOf(query) >= 0 ? text.indexOf(query) : text.indexOf(words[0]);
      const raw = pageText(p); const snippet = i >= 0 ? (i > 50 ? '…' : '') + raw.slice(Math.max(0, i - 50), i + query.length + 90) + '…' : null;
      hits.push({ id: p.id, title: p.title, score, snippet, parent: p.parent_id ? titles.get(p.parent_id) || null : null, updated_at: p.updated_at });
      if (hits.length >= 40) break;
    }
    return hits.sort((a, b) => b.score - a.score || (b.updated_at > a.updated_at ? 1 : -1)).slice(0, 20);
  },
  pageOr404(u, id, need = 'view') {
    const p = db.prepare('SELECT * FROM pages WHERE id=? AND deleted_at IS NULL').get(id); if (!p) throw new Error('Page not found: ' + id);
    const a = access(u, p.id); if (!a.view) throw new Error('No access to that page'); if (need === 'edit' && !a.edit) throw new Error('You can only read that page'); return p;
  },
  readMarkdown(u, id) {
    const p = ops.pageOr404(u, id);
    let tags = []; try { tags = (JSON.parse(p.tags || '[]') || []).map(t => (typeof t === 'string' ? t : t?.name)).filter(Boolean); } catch {}
    const head = [`# ${p.title || 'Untitled'}`, `id: ${p.id}${p.parent_id ? '  parent: ' + p.parent_id : ''}${tags.length ? '  tags: ' + tags.join(', ') : ''}${p.is_public ? '  published' : ''}${p.locked ? '  locked' : ''}`, ''];
    if (p.view === 'board') {
      const cols = db.prepare("SELECT id,title,icon FROM pages WHERE parent_id=? AND view='column' AND deleted_at IS NULL ORDER BY position").all(p.id);
      const out = [...head, p.description ? p.description + '\n' : '', 'Board columns and cards:'];
      for (const c of cols) { out.push(`\n## ${c.title}  (column id: ${c.id})`); for (const card of db.prepare('SELECT id,title FROM pages WHERE parent_id=? AND deleted_at IS NULL ORDER BY position').all(c.id)) if (access(u, card.id).view) out.push(`- ${card.title || 'Untitled'}  (id: ${card.id})`); }
      return out.join('\n');
    }
    const subs = db.prepare("SELECT id,title FROM pages WHERE parent_id=? AND deleted_at IS NULL AND view!='column' ORDER BY position").all(p.id).filter(s => access(u, s.id).view);
    return head.join('\n') + blocksToMarkdown(currentBlocks(p)) + (subs.length ? '\nSub-pages:\n' + subs.map(s => `- ${s.title || 'Untitled'}  (id: ${s.id})`).join('\n') + '\n' : '');
  },
  createPage(u, a) {
    const parent = a.parent_id ? ops.pageOr404(u, a.parent_id) : null;
    const w = ops.wsOrFirst(u, parent ? parent.workspace_id : a.workspace_id);
    const wsId = w.id;
    let mayAdd;
    if (!parent) mayAdd = can(u, wsId, 'create');
    else if (parent.view === 'column') mayAdd = canManageWs(u, wsId) || (can(u, wsId, 'cards') && parent.col_perm !== 'manager' && access(u, parent.id).edit);
    else mayAdd = canManageWs(u, wsId) || (can(u, wsId, 'subpage') && access(u, parent.id).edit);
    if (!mayAdd) throw new Error(parent ? 'No permission to add a page there' : 'Only managers can create top-level pages in this workspace');
    const id = crypto.randomUUID();
    const pos = (db.prepare('SELECT MAX(position) m FROM pages WHERE parent_id IS ? AND workspace_id=?').get(parent ? parent.id : null, wsId)?.m || 0) + 1;
    const blocks = a.markdown ? markdownToBlocks(a.markdown) : [];
    const tags = Array.isArray(a.tags) ? a.tags.filter(t => typeof t === 'string' && t.trim()).map(t => ({ name: t.trim() })) : [];
    db.prepare('INSERT INTO pages (id,parent_id,owner_id,workspace_id,title,icon,position,content,tags) VALUES (?,?,?,?,?,?,?,?,?)').run(id, parent ? parent.id : null, u.id, wsId, String(a.title || 'Untitled').slice(0, 300), a.icon ? String(a.icon).slice(0, 64) : '📄', pos, JSON.stringify(blocks), JSON.stringify(tags));
    logPage(id, u.id, '+', 'created this page');
    if (parent) logPage(parent.id, u.id, '+', `added "${String(a.title || 'Untitled').slice(0, 60)}"`);
    bumpTreeSignal(wsId);
    return db.prepare('SELECT id,title,parent_id FROM pages WHERE id=?').get(id);
  },
  updatePage(u, a) {
    const p = ops.pageOr404(u, a.page_id, 'edit');
    if (p.view === 'column') throw new Error('Columns are renamed through the board');
    if (typeof a.markdown === 'string') { if (p.view === 'board') throw new Error('Boards have no body; edit the cards instead'); setPageBlocks(p, markdownToBlocks(a.markdown), u.id, { append: !!a.append }); }
    const title = a.title !== undefined ? String(a.title).slice(0, 300) : p.title;
    const icon = a.icon !== undefined ? String(a.icon).slice(0, 64) : p.icon;
    const tags = Array.isArray(a.tags) ? JSON.stringify(a.tags.filter(t => typeof t === 'string' && t.trim()).map(t => ({ name: t.trim() }))) : p.tags;
    db.prepare("UPDATE pages SET title=?, icon=?, tags=?, updated_at=datetime('now') WHERE id=?").run(title, icon, tags, p.id);
    if (title !== p.title) logPage(p.id, u.id, '~', `renamed to "${title.slice(0, 60) || 'Untitled'}"`);
    if (Array.isArray(a.tags)) logPage(p.id, u.id, '~', 'updated tags');
    bumpTreeSignal(p.workspace_id, p.id);
    return { id: p.id, title };
  },
  movePage(u, a) {
    const p = ops.pageOr404(u, a.page_id, 'edit');
    const parent = a.parent_id ? ops.pageOr404(u, a.parent_id) : null;
    if (parent && parent.workspace_id !== p.workspace_id) throw new Error('Pages cannot move between workspaces');
    if (parent) { let cur = parent; let g = 0; while (cur && g++ < 100) { if (cur.id === p.id) throw new Error('Cannot move a page under itself'); cur = cur.parent_id ? db.prepare('SELECT id,parent_id FROM pages WHERE id=?').get(cur.parent_id) : null; } }
    const src = p.parent_id ? db.prepare('SELECT view,col_perm FROM pages WHERE id=?').get(p.parent_id) : null;
    const cardMove = parent?.view === 'column' || src?.view === 'column';
    if (!can(u, p.workspace_id, cardMove ? 'cards' : 'move')) throw new Error('Moving is turned off for your role');
    if (((parent?.view === 'column' && parent.col_perm === 'manager') || (src?.view === 'column' && src.col_perm === 'manager')) && !canManageWs(u, p.workspace_id)) throw new Error('Only managers can move cards in or out of that column');
    if (parent && parent.view !== 'column' && !(canManageWs(u, p.workspace_id) || access(u, parent.id).edit)) throw new Error('Cannot move into a locked or read-only page');
    if (!parent && !can(u, p.workspace_id, 'create')) throw new Error('Only managers can place pages at the top level');
    const sibs = db.prepare('SELECT id,position FROM pages WHERE parent_id IS ? AND workspace_id=? AND deleted_at IS NULL AND id!=? ORDER BY position,created_at').all(parent ? parent.id : null, p.workspace_id, p.id);
    let position;
    const pos = String(a.position || 'last');
    if (pos === 'first') position = (sibs[0]?.position ?? 1) - 1;
    else if (pos.startsWith('after:')) { const i = sibs.findIndex(s => s.id === pos.slice(6)); if (i < 0) throw new Error('Sibling not found'); position = ((sibs[i].position || 0) + (sibs[i + 1]?.position ?? (sibs[i].position || 0) + 2)) / 2; }
    else position = (sibs.length ? (sibs[sibs.length - 1].position || 0) : 0) + 1;
    db.prepare("UPDATE pages SET parent_id=?, position=?, updated_at=datetime('now') WHERE id=?").run(parent ? parent.id : null, position, p.id);
    logPage(p.id, u.id, '~', cardMove ? 'moved card' : 'moved');
    bumpTreeSignal(p.workspace_id);
    return { id: p.id, title: p.title, parent_id: parent ? parent.id : null };
  },
  deletePage(u, id) {
    const p = ops.pageOr404(u, id);
    if (!mayDelete(u, p.id)) throw new Error('Only the page creator or a manager can delete this page');
    const ids = [], stack = [p.id];
    while (stack.length) { const c = stack.pop(); ids.push(c); for (const k of db.prepare('SELECT id FROM pages WHERE parent_id=? AND deleted_at IS NULL').all(c)) stack.push(k.id); }
    const upd = db.prepare("UPDATE pages SET deleted_at=datetime('now') WHERE id=?");
    db.transaction(() => ids.forEach(i => upd.run(i)))();
    logPage(p.id, u.id, '-', 'moved to trash');
    bumpTreeSignal(p.workspace_id);
    return { trashed: ids.length };
  },
  createBoard(u, a) {
    const w = ops.wsOrFirst(u, a.workspace_id);
    if (!can(u, w.id, 'create')) throw new Error('Only managers can create boards in this workspace');
    const id = crypto.randomUUID();
    const pos = (db.prepare('SELECT MAX(position) m FROM pages WHERE parent_id IS NULL AND workspace_id=?').get(w.id)?.m || 0) + 1;
    db.prepare("INSERT INTO pages (id,parent_id,owner_id,workspace_id,title,icon,position,content,view) VALUES (?,?,?,?,?,?,?,?,'board')").run(id, null, u.id, w.id, String(a.title || 'Untitled').slice(0, 300), 'ph:SquaresFour', pos, '[]');
    const names = Array.isArray(a.columns) && a.columns.length ? a.columns.map(c => String(c).slice(0, 80)) : ['To do', 'In progress', 'Done'];
    const colors = ['gray', 'blue', 'green', 'amber', 'purple', 'pink', 'red'];
    const columns = names.map((name, i) => { const cid = crypto.randomUUID(); db.prepare("INSERT INTO pages (id,parent_id,owner_id,workspace_id,title,icon,view,col_perm,position,content) VALUES (?,?,?,?,?,?,'column','member',?,?)").run(cid, id, u.id, w.id, name, 'dot:' + colors[i % colors.length], i, '[]'); return { id: cid, title: name }; });
    logPage(id, u.id, '+', 'created this board');
    bumpTreeSignal(w.id);
    return { id, title: a.title || 'Untitled', columns };
  },
  addComment(u, id, body) {
    const p = ops.pageOr404(u, id);
    const text = String(body || '').trim(); if (!text) throw new Error('Empty comment');
    if (!can(u, p.workspace_id, 'comment')) throw new Error('Commenting is turned off for your role');
    const cid = crypto.randomUUID();
    db.prepare('INSERT INTO comments (id,page_id,user_id,body,mentions) VALUES (?,?,?,?,?)').run(cid, p.id, u.id, text, '[]');
    if (p.owner_id && p.owner_id !== u.id) db.prepare('INSERT INTO notifications (id,user_id,actor_id,type,page_id,comment_id,body) VALUES (?,?,?,?,?,?,?)').run(crypto.randomUUID(), p.owner_id, u.id, 'comment', p.id, cid, text.slice(0, 160));
    logPage(p.id, u.id, '+', 'commented');
    return { ok: true };
  },
};
const mcp = makeMcp({ ops, version: VERSION });
for (const route of ['/mcp', '/api/mcp']) {
  app.route({ method: ['GET', 'POST', 'DELETE'], url: route, handler: async (req, reply) => {
    const u = userFromReq(req);
    if (!u) return reply.code(401).header('WWW-Authenticate', 'Bearer realm="notebit"').send({ error: 'Send a personal token: Authorization: Bearer nb_... (Settings > Claude Code)' });
    return mcp(req, reply, u);
  } });
}

// ---- serve frontend ----
if (fs.existsSync(WEB_DIR)) {
  await app.register(fstatic, { root: WEB_DIR });
  app.setNotFoundHandler((req, reply) => req.raw.url.startsWith('/api/') ? reply.code(404).send({ error: 'not found' }) : reply.sendFile('index.html'));
}
const HOST = process.env.HOST || '127.0.0.1';
app.listen({ port: PORT, host: HOST }).then(() => console.log(`NoteBit v${VERSION} on ${HOST}:${PORT} (db ${DB_PATH})`));
