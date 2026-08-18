# Changelog

## 1.3.0 (2026-08-18)

A quality pass on the editor plus the everyday things a Notion-style workspace needs. Data format is unchanged; update as usual.

### Editor fixes
- **Caret and keystrokes no longer get stomped.** Any page that contained a callout made the block redraw on every keystroke (a React root was mounted inside ProseMirror's DOM), which broke arrow keys, lost selections and could freeze the tab. Callouts are plain DOM now; their emoji/color picker renders in a portal outside the editor. Toggles collapse via CSS instead of writing styles into editor DOM.
- **Copy/paste of blocks round-trips.** Pasting blocks copied inside NoteBit produced empty blocks with the text nested under them (a `prosemirror-model` 1.25.1 parser change that BlockNote 0.25's rules were not written for). `prosemirror-model` is pinned to 1.25.0 and the checklist/paragraph parse rules are guarded. Checked state, nesting and custom blocks survive.
- **Markdown paste works.** BlockNote 0.25 has no `pasteHandler` option, so the old handler never ran. It is now a TipTap extension: pasted Markdown becomes real blocks, `> quote` / `---` become quote/divider blocks, and pasting a URL over selected text links it.
- **The drop indicator is honest.** While dragging a block the line is drawn from the same "seam" function the drop uses, so blocks land exactly where the line shows.
- **One block menu.** Clicking a block's `⋮⋮` handle or right-clicking selected text opens the same menu: formatting, cut/copy/paste below, turn into, text/background color, indent/outdent, move up/down, duplicate, copy link to block, delete. Cut/Copy use BlockNote's own clipboard format.
- **Spellcheck works again.** Right-clicking a word with nothing selected shows the browser menu (spelling suggestions, dictionary); right-click a selection, the block margin, or hold Ctrl/⌘ for the block menu.
- Slash menu no longer shows "Basic blocks" twice; checked to-dos are dimmed and struck through; a literal `0` no longer appears next to Share on unlocked pages.
- A title change followed quickly by typing in the body no longer drops the title (pending saves are merged and flushed on page switch/unload).

### New
- **Page URLs**: `/page/<id>` for every page, back/forward, refresh-safe, plus `#block` deep links (Copy link / Copy link to block).
- **Search (⌘K)** searches titles and page text (not raw JSON), ranks titles first, shows snippets with highlights and recent pages; arrow keys + Enter.
- **Version history**: automatic snapshots before edits (at most one per 10 minutes, 40 kept per page), "Save version now", preview and restore. Restoring keeps a snapshot of the current text first.
- **Images**: `/image` uploads to the server (stored next to the database in `data/uploads`, served at `/uploads/…`); paste or drop images too. PNG, JPEG, GIF, WebP up to 12 MB.
- **Favorites** in the sidebar; right-click menu on sidebar pages (open in new tab, favorite, copy link, new subpage, rename, duplicate, delete).
- **Page menu**: favorite, copy link, duplicate, export as Markdown, version history, changelog, lock, delete; word count.
- **Shortcuts**: ⌘K search, ⌘\ sidebar, ⌘⇧N new page, Esc closes the top-most panel. New pages open with an empty, focused title; Enter/↓ from the title moves into the editor.
- **Paper**, a light theme.
- Usable on phones: the sidebar becomes a drawer, settings/share/history go full-screen.
- Accounts that are not in any workspace get a clear message instead of an empty "Wiki".

### Server
- The first (admin) account now becomes a manager of every workspace, so member lists and the face pile show it; existing installs are repaired on boot.
- New endpoints: `GET /api/search` (ranked, snippets), `GET/POST /api/pages/:id/versions`, `GET /api/versions/:id`, `POST /api/upload`, static `/uploads/`.

### Dev
- `App.jsx` split into `ui.jsx` (primitives), `blocks.jsx` (schema/custom blocks), `editor.jsx` (editor) and `App.jsx` (shell).
- Vite dev server proxies the `/collab` websocket and `/uploads`, so `npm run dev` collaborates and shows images.
- `window.__nb` exposes the editor in dev builds for debugging.

## 1.2.2 and earlier
See the GitHub releases.
