// The page editor: BlockNote + Yjs collaboration, block drag/drop with a live drop
// indicator, marquee selection, one block menu (handle click + right-click), full-fidelity
// clipboard actions, markdown paste, and pickers that render OUTSIDE ProseMirror's DOM.
import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useCreateBlockNote, SuggestionMenuController, getDefaultReactSlashMenuItems, SideMenu, SideMenuController, useComponentsContext, AddBlockButton } from '@blocknote/react';
import { BlockNoteView } from '@blocknote/mantine';
import { filterSuggestionItems, insertOrUpdateBlock, getNodeById } from '@blocknote/core';
import { Extension } from '@tiptap/core';
import { Plugin, TextSelection, NodeSelection } from 'prosemirror-state';
import { DOMParser as PMDOMParser } from 'prosemirror-model';
import '@blocknote/mantine/style.css';
import * as Y from 'yjs';
import { WebsocketProvider } from 'y-websocket';
import EmojiPicker from 'emoji-picker-react';
import { Trash as Trash2, CaretRight as ChevronRight, DotsSixVertical as GripVertical, TextT, CopySimple, TextB, TextItalic, TextUnderline, TextStrikethrough, TextIndent, TextOutdent, ArrowUp, ArrowDown, Scissors, ClipboardText, Quotes, Minus, Code as CodeIcon, LinkSimple, Palette } from '@phosphor-icons/react';
import { PageIcon, userColor, parseContent, isLightTheme } from './ui.jsx';
import { schema, TURN_INTO, stripIds, looksLikeMarkdown, blockUI, useBlockUI, CALLOUT_COLORS } from './blocks.jsx';

// ---------- clipboard / paste ----------
const URL_RE = /^(https?:\/\/[^\s]+)$/i;
// Runs BEFORE BlockNote's own paste handler (higher TipTap priority) so plain text that
// looks like Markdown becomes real blocks, and a pasted URL over selected text links it.
// (BlockNote 0.25 has no `pasteHandler` option; this is the supported way in.)
const makePasteExtension = (getEditor) => Extension.create({
  name: 'notebitPaste',
  priority: 1000,
  addProseMirrorPlugins() {
    return [new Plugin({
      props: {
        handleDOMEvents: {
          paste(view, event) {
            const editor = getEditor(); if (!editor || !editor.isEditable) return false;
            const cd = event.clipboardData; if (!cd) return false;
            const types = Array.from(cd.types || []);
            // rich data (copied blocks, HTML from other apps, files) always takes BlockNote's path
            if (types.includes('blocknote/html') || types.includes('text/html') || types.includes('Files')) return false;
            const text = cd.getData('text/plain'); if (!text) return false;
            const trimmed = text.trim();
            // URL pasted over a text selection: turn the selection into a link (Notion behavior)
            if (URL_RE.test(trimmed) && !view.state.selection.empty && !('node' in view.state.selection)) {
              try { event.preventDefault(); editor.createLink(trimmed); return true; } catch { return false; }
            }
            if (!looksLikeMarkdown(text)) return false;
            event.preventDefault();
            editor.tryParseMarkdownToBlocks(text).then(blocks => {
              blocks = (blocks || []).filter(Boolean).filter(b => !(b.type === 'paragraph' && (!b.content || b.content.length === 0)));
              if (!blocks.length) return;
              const ref = editor.getTextCursorPosition?.().block || editor.document[editor.document.length - 1];
              const empty = ref && (!ref.content || (Array.isArray(ref.content) && ref.content.length === 0));
              const res = empty ? editor.replaceBlocks([ref], blocks) : editor.insertBlocks(blocks, ref, 'after');
              try { const ins = res?.insertedBlocks || blocks; const lb = ins[ins.length - 1]; if (lb?.id) editor.setTextCursorPosition(lb.id, 'end'); } catch {}
            }).catch(() => {});
            return true;
          },
        },
      },
    })];
  },
});

// ---------- side menu handle: drag to move, click for the block menu ----------
function DragHandle({ block, blockDragStart, blockDragEnd, onOpen }) {
  const Components = useComponentsContext();
  return (
    <Components.SideMenu.Button label="Block menu (drag to move)" draggable={true}
      onDragStart={(e) => blockDragStart(e, block)} onDragEnd={blockDragEnd}
      onClick={(e) => { e.preventDefault(); e.stopPropagation(); onOpen(block, e.currentTarget.getBoundingClientRect()); }}
      className="bn-button" icon={<GripVertical size={24} />} />
  );
}

const TEXT_COLORS = ['default', 'gray', 'brown', 'red', 'orange', 'yellow', 'green', 'blue', 'purple', 'pink'];
const COLOR_HEX = { default: 'var(--text)', gray: '#9b9a97', brown: '#bb8264', red: '#ff5d52', orange: '#e3902f', yellow: '#dfab01', green: '#4dab6d', blue: '#3f9cdb', purple: '#9a6dd7', pink: '#e255a1' };

export function Editor({ page, editable, pages, onChange, apiRef, me, uploadFile, onOpenPage }) {
  const { ydoc, provider } = useMemo(() => {
    const ydoc = new Y.Doc();
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const provider = new WebsocketProvider(`${proto}://${location.host}/collab`, page.id, ydoc);
    return { ydoc, provider };
  }, [page.id]);
  useEffect(() => () => { provider.destroy(); ydoc.destroy(); }, [provider, ydoc]);
  const editorRef = useRef(null);
  const pasteExt = useMemo(() => makePasteExtension(() => editorRef.current), []);
  const editor = useCreateBlockNote({
    schema,
    collaboration: { provider, fragment: ydoc.getXmlFragment('document'), user: { name: me?.name || me?.email || 'Someone', color: userColor(me?.id) } },
    uploadFile,
    _tiptapOptions: { extensions: [pasteExt] },
  }, [page.id]);
  editorRef.current = editor;
  if (import.meta.env.DEV) window.__nb = { editor, ydoc, provider, PMDOMParser }; // dev-only debugging hook
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
  const wrapRef = useRef(null);
  // ---- imperative API for the page shell (title Enter -> editor, sidebar drop -> mention, deep links)
  useEffect(() => {
    if (!apiRef) return;
    apiRef.current = {
      insertPageLink: (p, x, y) => {
        if (!editor.isEditable) return;
        const blockEl = document.elementFromPoint(x, y)?.closest?.('[data-id]');
        const blockId = blockEl?.getAttribute('data-id');
        try { if (blockId) editor.setTextCursorPosition(blockId, 'end'); editor.focus(); } catch {}
        editor.insertInlineContent([{ type: 'pageLink', props: { pageId: p.id, title: p.title || 'Untitled', icon: p.icon || '📄' } }, ' ']);
      },
      focusStart: () => { try { const first = editor.document[0]; if (first) editor.setTextCursorPosition(first.id, 'start'); editor.focus(); } catch {} },
      focusEnd: () => { try { const last = editor.document[editor.document.length - 1]; if (last) editor.setTextCursorPosition(last.id, 'end'); editor.focus(); } catch {} },
      scrollToBlock: (id) => {
        const el = wrapRef.current?.querySelector(`[data-id="${CSS.escape(id)}"]`); if (!el) return false;
        el.scrollIntoView({ block: 'center', behavior: 'smooth' });
        const c = el.querySelector(':scope > .bn-block > .bn-block-content') || el;
        c.classList.add('blk-flash'); setTimeout(() => c.classList.remove('blk-flash'), 1600);
        return true;
      },
      getWordCount: () => { try { return (editor.prosemirrorView?.dom?.innerText || '').trim().split(/\s+/).filter(Boolean).length; } catch { return 0; } },
      getContent: () => { try { return JSON.stringify(editor.document); } catch { return null; } },
      toMarkdown: () => editor.blocksToMarkdownLossy(editor.document),
      replaceAll: (blocks) => { try { editor.replaceBlocks(editor.document, blocks); } catch (e) { if (import.meta.env.DEV) console.warn(e); } },
    };
    return () => { apiRef.current = null; };
  }, [editor, apiRef]);
  const pageItems = async (query) =>
    (pages || []).filter(p => p.id !== page.id && p.view !== 'column' && (p.title || 'Untitled').toLowerCase().includes((query || '').toLowerCase())).slice(0, 12).map(p => ({
      title: p.title || 'Untitled',
      icon: <PageIcon icon={p.icon} size={15} />,
      onItemClick: () => editor.insertInlineContent([{ type: 'pageLink', props: { pageId: p.id, title: p.title || 'Untitled', icon: p.icon || '📄' } }, ' ']),
    }));

  // ---------- block drag & drop ----------
  // Handle-drags are moved by US, not ProseMirror. PM's native drop picks the deepest
  // slot and will split a paragraph mid-text or nest into neighbors. While dragging we
  // draw our own indicator from the SAME seam function the drop uses, so the line you
  // see is exactly where the block lands. PM's own drop cursor is hidden meanwhile.
  const dragRef = useRef(null);
  const dropIndRef = useRef(null);
  const contentRect = (el) => (el.querySelector(':scope > .bn-block > .bn-block-content') || el.querySelector('.bn-block-content') || el).getBoundingClientRect();
  const computeSeam = (clientX, clientY, dragIds) => {
    const wrap = wrapRef.current; if (!wrap) return null;
    const dragSet = new Set(dragIds);
    const inDragSubtree = (el) => { let a = el; while (a) { if (dragSet.has(a.getAttribute?.('data-id'))) return true; a = a.parentElement?.closest?.('[data-id]'); } return false; };
    const cands = [];
    wrap.querySelectorAll('.bn-editor [data-id]').forEach(el => { if (!inDragSubtree(el)) cands.push({ el, r: contentRect(el) }); });
    if (!cands.length) return null;
    // seam: after the last block whose row center is above the pointer, else before the first
    let ref = null, place = 'after';
    for (const cd of cands) if ((cd.r.top + cd.r.bottom) / 2 < clientY) ref = cd;
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
        if (Math.abs(contentRect(par).left - clientX) < Math.abs(contentRect(el).left - clientX)) el = par; else break;
      }
      ref = { el, r: contentRect(el) };
    }
    return { refId: ref.el.getAttribute('data-id'), place, r: ref.r };
  };
  const showDropInd = (seam) => {
    const ind = dropIndRef.current, wrap = wrapRef.current; if (!ind || !wrap) return;
    if (!seam) { ind.style.display = 'none'; return; }
    const wr = wrap.getBoundingClientRect();
    ind.style.display = 'block';
    ind.style.left = (seam.r.left - wr.left - 4) + 'px';
    ind.style.width = (seam.r.width + 8) + 'px';
    ind.style.top = ((seam.place === 'after' ? seam.r.bottom + 1 : seam.r.top - 3) - wr.top) + 'px';
  };
  useEffect(() => {
    const onDragStart = (e) => {
      try {
        const ed = wrapRef.current; if (!ed || !ed.contains(e.target)) return;
        if (dragRef.current?.handle) return;                  // handle recorder already ran
        const blocks = editor.getSelection()?.blocks;
        if (!blocks || blocks.length < 2) return;             // inline text drags stay native
        dragRef.current = { ids: blocks.map(b => b.id), handle: false };
        wrapRef.current?.classList.add('handle-drag');
      } catch {}
    };
    let raf = 0;
    const onDragOver = (e) => {
      const d = dragRef.current; if (!d) return;
      if (e.target.closest?.('.sidebar, .clog, .inbox-pop, .search-box, .card')) { showDropInd(null); return; }
      const x = e.clientX, y = e.clientY;
      cancelAnimationFrame(raf); raf = requestAnimationFrame(() => showDropInd(computeSeam(x, y, d.ids)));
    };
    const finish = () => { dragRef.current = null; showDropInd(null); wrapRef.current?.classList.remove('handle-drag'); };
    const onDrop = (e) => {
      const d = dragRef.current;
      if (!d || e.synthetic) return;
      if (!e.dataTransfer?.types?.includes('blocknote/html')) { finish(); return; }
      const wrap = wrapRef.current; if (!wrap) { finish(); return; }
      e.preventDefault(); e.stopPropagation();
      // PM never sees this drop, so its drop-cursor line would linger: clear it now
      try { editor.prosemirrorView?.dom?.dispatchEvent(new DragEvent('dragend', { bubbles: false })); } catch {}
      // handle-drags keep the pointer LEFT of the text column, so accept drops anywhere
      // over the page; only real app chrome cancels the move
      if (e.target.closest?.('.sidebar, .clog, .inbox-pop, .search-box, .card')) { finish(); return; }
      try {
        const seam = computeSeam(e.clientX, e.clientY, d.ids); if (!seam) return;
        const blocks = d.ids.map(id => editor.getBlock(id)).filter(Boolean);
        if (!blocks.length) return;
        editor.removeBlocks(d.ids);
        editor.insertBlocks(blocks, seam.refId, seam.place);
        if (d.ids.length > 1) editor.setSelection(d.ids[0], d.ids[d.ids.length - 1]);
        else editor.setTextCursorPosition(d.ids[0], 'end');
        editor.focus();
      } catch (err) { if (import.meta.env.DEV) console.warn('block drop failed', err); } finally { finish(); }
    };
    const onDragEnd = () => setTimeout(finish, 50);
    window.addEventListener('dragstart', onDragStart, true);
    window.addEventListener('dragover', onDragOver, true);
    window.addEventListener('drop', onDrop, true);
    window.addEventListener('dragend', onDragEnd, true);
    return () => { cancelAnimationFrame(raf); window.removeEventListener('dragstart', onDragStart, true); window.removeEventListener('dragover', onDragOver, true); window.removeEventListener('drop', onDrop, true); window.removeEventListener('dragend', onDragEnd, true); };
  }, [editor]);

  // ---------- hover tint (overlay outside the editor DOM) ----------
  // Never mutate classes on ProseMirror-managed nodes: PM's mutation observer re-syncs
  // on any change inside the editor and stomps the selection.
  const hlRef = useRef(null);
  const hlLockRef = useRef(false);
  const placeHl = (el, strong) => {
    const root = wrapRef.current, ov = hlRef.current; if (!root || !ov) return;
    if (!el) { ov.style.display = 'none'; ov.classList.remove('strong'); return; }
    const c = el.querySelector(':scope > .bn-block > .bn-block-content') || el.querySelector('.bn-block-content') || el;
    const r = c.getBoundingClientRect(), wr = root.getBoundingClientRect();
    ov.classList.toggle('strong', !!strong);
    ov.style.display = 'block';
    ov.style.left = (r.left - wr.left - 5) + 'px';
    ov.style.top = (r.top - wr.top + 1.5) + 'px';
    ov.style.width = (r.width + 10) + 'px';
    ov.style.height = (r.height - 3) + 'px';
  };
  const hlRoRef = useRef(null);
  useEffect(() => {
    const root = wrapRef.current; if (!root) return;
    let cur = null;
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
  // highlight the block you're about to grab while hovering its handle
  const hl = (id, on) => {
    const el = on && id ? wrapRef.current?.querySelector(`[data-id="${CSS.escape(id)}"]`) : null;
    hlLockRef.current = el || false;
    if (el) { hlRoRef.current?.disconnect(); hlRoRef.current?.observe(el); }
    placeHl(el, true);
  };

  // ---------- code block: copy button next to the language picker ----------
  useEffect(() => {
    const root = wrapRef.current; if (!root) return;
    const ensure = () => {
      root.querySelectorAll('.bn-block-content[data-content-type="codeBlock"]').forEach(cb => {
        const bar = cb.querySelector(':scope > div');
        if (!bar || bar.querySelector('.code-copy')) return;
        const btn = document.createElement('button');
        btn.className = 'code-copy'; btn.type = 'button'; btn.title = 'Copy code'; btn.contentEditable = 'false';
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

  // ---------- Notion-style box (marquee) selection ----------
  // Drag from the background (gutters or blank space below the doc) to select whole
  // blocks; release sets a real block selection, so native shortcuts apply
  // (Mod+Shift+Up/Down moves the selection, Backspace deletes, Cmd+C copies)
  const [box, setBox] = useState(null);
  const marqueeRef = useRef(false);
  const marqueeSelRef = useRef(null);
  const selLayerRef = useRef(null);
  const startBox = (e) => {
    if (!editor.isEditable || e.button !== 0) return;
    const wrap = wrapRef.current; if (!wrap) return;
    const docEl = wrap.closest('.doc');
    const isWrap = e.target === wrap || e.target === docEl; // gutters + page margins
    const isBlank = e.target.classList?.contains('bn-editor') && (() => {
      const doc = editor.document; const last = doc[doc.length - 1];
      const el = last && wrap.querySelector(`[data-id="${CSS.escape(last.id)}"]`);
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
      const el = wrapRef.current?.querySelector(`[data-id="${CSS.escape(last.id)}"]`);
      if (el && e.clientY < el.getBoundingClientRect().bottom) return;
      const empty = last.type === 'paragraph' && (!last.content || last.content.length === 0);
      if (empty) editor.setTextCursorPosition(last.id, 'end');
      else { const r = editor.insertBlocks([{ type: 'paragraph' }], last.id, 'after'); editor.setTextCursorPosition(r?.insertedBlocks?.[0]?.id || last.id, 'end'); }
      editor.focus();
    } catch {}
  };
  // marquee can start from the page margins (outside editor-wrap), so listen at document level
  const startBoxRef = useRef(startBox); startBoxRef.current = startBox;
  useEffect(() => {
    const h = (e) => startBoxRef.current(e);
    document.addEventListener('pointerdown', h);
    return () => document.removeEventListener('pointerdown', h);
  }, []);
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
      if (!ids) return;
      const wr = wrap.getBoundingClientRect();
      for (const id of ids) {
        const el = wrap.querySelector(`[data-id="${CSS.escape(id)}"]`); if (!el) continue;
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

  // ---------- the block menu (handle click + right-click) ----------
  const [menu, setMenu] = useState(null); // { x, y, id, hasTextSel }
  const unfreezeRef = useRef(null);
  const openMenuAt = (block, rect, sideMenuProps) => {
    if (!block?.id) return;
    try { sideMenuProps?.freezeMenu?.(); unfreezeRef.current = sideMenuProps?.unfreezeMenu; } catch {}
    hl(block.id, true);
    setMenu({ x: rect.left, y: rect.bottom + 4, id: block.id, hasTextSel: false });
  };
  // Right-click policy (keeps the browser's spellcheck + native menu reachable):
  //   - a caret on plain text, nothing selected  -> native browser menu (spelling suggestions)
  //   - a text or multi-block selection          -> NoteBit block menu
  //   - the block's margin/handle/checkbox area, or Ctrl/Cmd+right-click -> NoteBit block menu
  const onCtxMenu = (e) => {
    if (!editor.isEditable) return;
    const blk = e.target.closest?.('[data-id]');
    if (!blk || e.target.closest('.code-copy, select, a, input, button')) return;
    const id = blk.getAttribute('data-id');
    const domSel = window.getSelection();
    const hasTextSel = !!domSel && !domSel.isCollapsed && wrapRef.current?.contains(domSel.anchorNode);
    let multi = false; try { const bs = editor.getSelection()?.blocks; multi = !!bs && bs.length > 1; } catch {}
    const m = marqueeSelRef.current; if (m?.length > 1 && m.includes(id)) multi = true;
    const onText = !!e.target.closest('.bn-inline-content, .bn-block-content[data-content-type="codeBlock"] pre');
    if (onText && !hasTextSel && !multi && !e.ctrlKey && !e.metaKey) return; // let the browser show its menu
    e.preventDefault();
    setMenu({ x: e.clientX, y: e.clientY, id, hasTextSel: hasTextSel && !multi });
  };
  const closeMenu = () => { setMenu(null); hl(null, false); try { unfreezeRef.current?.(); } catch {} unfreezeRef.current = null; };
  const act = async (fn) => { closeMenu(); try { await fn(); } catch (err) { if (import.meta.env.DEV) console.warn(err); } };
  // the blocks an action applies to: live multi-selection, else the remembered marquee
  // set (right-click collapses the live one), else just the clicked block
  const menuBlocks = (id) => {
    try { const bs = editor.getSelection()?.blocks; if (bs?.length > 1 && bs.some(b => b.id === id)) return bs; } catch {}
    const m = marqueeSelRef.current;
    if (m?.length > 1 && m.includes(id)) { const bs = m.map(x => editor.getBlock(x)).filter(Boolean); if (bs.length > 1) return bs; }
    const b = editor.getBlock(id); return b ? [b] : [];
  };
  // put a real ProseMirror selection on the given blocks (whole blocks), so native
  // commands (copy/cut/move/indent) apply to exactly them
  const selectBlocks = (ids) => {
    const view = editor.prosemirrorView; if (!view || !ids.length) return false;
    const doc = view.state.doc;
    const a = getNodeById(ids[0], doc), b = getNodeById(ids[ids.length - 1], doc);
    if (!a || !b) return false;
    let sel;
    if (ids.length === 1) sel = NodeSelection.create(doc, a.posBeforeNode);
    else sel = TextSelection.between(doc.resolve(a.posBeforeNode + 1), doc.resolve(b.posBeforeNode + b.node.nodeSize - 1));
    view.dispatch(view.state.tr.setSelection(sel)); view.focus();
    return true;
  };
  const cursorOn = (id) => { const bs = menuBlocks(id); try { bs.length > 1 ? editor.setSelection(bs[0].id, bs[bs.length - 1].id) : editor.setTextCursorPosition(id); } catch {} };
  // full-fidelity clipboard: select, then let BlockNote's own copy handler serialise
  // (blocknote/html + text/html + markdown), so pasting anywhere round-trips
  const copyBlocks = (id, cut) => act(() => {
    const bs = menuBlocks(id);
    if (!(menu?.hasTextSel && bs.length === 1)) selectBlocks(bs.map(b => b.id));
    document.execCommand(cut ? 'cut' : 'copy');
    if (cut) { const view = editor.prosemirrorView; if (view && 'node' in view.state.selection) editor.removeBlocks(bs.map(b => b.id)); }
  });
  const pasteBelow = (id) => act(async () => {
    const bs = menuBlocks(id); const after = bs[bs.length - 1].id;
    let blocks = [];
    try {
      const items = await navigator.clipboard.read();
      for (const it of items) {
        if (it.types.includes('text/html')) { const html = await (await it.getType('text/html')).text(); blocks = await editor.tryParseHTMLToBlocks(html); break; }
        if (it.types.includes('text/plain')) { const t = await (await it.getType('text/plain')).text(); blocks = await editor.tryParseMarkdownToBlocks(t); break; }
      }
    } catch { const t = await navigator.clipboard?.readText?.().catch(() => ''); if (t) blocks = await editor.tryParseMarkdownToBlocks(t); }
    blocks = (blocks || []).filter(Boolean);
    if (blocks.length) { const r = editor.insertBlocks(blocks, after, 'after'); try { const ins = r?.insertedBlocks; if (ins?.length) editor.setTextCursorPosition(ins[ins.length - 1].id, 'end'); editor.focus(); } catch {} }
  });
  const styleAct = (id, s) => act(() => {
    if (!menu?.hasTextSel) { const bs = menuBlocks(id); if (bs.length > 1) selectBlocks(bs.map(b => b.id)); else selectBlockText(id); }
    editor.toggleStyles(s); editor.focus();
  });
  const selectBlockText = (id) => {
    const view = editor.prosemirrorView; if (!view) return;
    const info = getNodeById(id, view.state.doc); if (!info) return;
    const content = info.node.firstChild; if (!content || content.isAtom || !content.isTextblock) return;
    const from = info.posBeforeNode + 2, to = info.posBeforeNode + 1 + content.nodeSize - 1;
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, from, to)));
  };
  const colorAct = (id, kind, c) => act(() => {
    if (!menu?.hasTextSel) { const bs = menuBlocks(id); if (bs.length > 1) selectBlocks(bs.map(b => b.id)); else selectBlockText(id); }
    if (c === 'default') editor.removeStyles({ [kind]: c }); else editor.addStyles({ [kind]: c });
    editor.focus();
  });
  const copyBlockLink = (id) => act(async () => { const u = new URL(location.href); u.pathname = '/page/' + page.id; u.hash = id; await navigator.clipboard?.writeText(u.toString()); });
  const MenuItem = ({ icon: I, label, kbd, danger, onClick }) => (
    <div className={'popmenu-item' + (danger ? ' danger' : '')} onMouseDown={e => e.preventDefault()} onClick={onClick}><I size={15} /> {label}{kbd && <span className="ctx-kbd">{kbd}</span>}</div>
  );
  // clamp the menu into the viewport once it has a size
  const menuRef = useRef(null);
  useLayoutEffect(() => {
    const el = menuRef.current; if (!el || !menu) return;
    const r = el.getBoundingClientRect();
    const x = Math.min(menu.x, window.innerWidth - r.width - 8), y = Math.min(menu.y, window.innerHeight - r.height - 8);
    el.style.left = Math.max(8, x) + 'px'; el.style.top = Math.max(8, y) + 'px';
  }, [menu]);
  useEffect(() => { if (!menu) return; const onScroll = () => closeMenu(); document.addEventListener('scroll', onScroll, true); const onKey = (e) => { if (e.key === 'Escape') closeMenu(); }; document.addEventListener('keydown', onKey); return () => { document.removeEventListener('scroll', onScroll, true); document.removeEventListener('keydown', onKey); }; }, [menu]);

  // ---------- pickers requested by vanilla node views (rendered outside PM's DOM) ----------
  const uiReq = useBlockUI();
  const calloutReq = uiReq && uiReq.kind === 'callout' && uiReq.editor === editor ? uiReq : null;
  const light = isLightTheme();
  useEffect(() => { if (!calloutReq) return; const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); blockUI.close(); } }; document.addEventListener('keydown', onKey, true); return () => document.removeEventListener('keydown', onKey, true); }, [calloutReq]);

  // slash menu: default items (minus media we don't host) + ours, merged INTO the same
  // "Basic blocks" group so it never renders twice
  const slashItems = async (query) => {
    const defaults = getDefaultReactSlashMenuItems(editor).filter(i => !['Video', 'Audio', 'File'].includes(i.title) && (uploadFile || i.title !== 'Image'));
    const ours = [
      { title: 'Callout', subtext: 'Tip box with an emoji', aliases: ['callout', 'tip', 'note', 'info', 'box', 'warning'], group: 'Basic blocks', icon: <span style={{ fontSize: 16 }}>💡</span>, onItemClick: () => insertOrUpdateBlock(editor, { type: 'callout' }) },
      { title: 'Toggle', subtext: 'Collapsible section: title line, Tab content under it', aliases: ['toggle', 'collapse', 'collapsible', 'details', 'dropdown', 'fold'], group: 'Basic blocks', icon: <ChevronRight size={16} />, onItemClick: () => insertOrUpdateBlock(editor, { type: 'toggle' }) },
      { title: 'Toggle heading', subtext: 'Heading-sized collapsible section', aliases: ['toggleheading', 'theading', 'collapsibleheading'], group: 'Basic blocks', icon: <ChevronRight size={16} weight="bold" />, onItemClick: () => insertOrUpdateBlock(editor, { type: 'toggle', props: { level: 2 } }) },
      { title: 'Quote', subtext: 'Citation with an accent bar', aliases: ['quote', 'blockquote', 'citation'], group: 'Basic blocks', icon: <Quotes size={16} />, onItemClick: () => insertOrUpdateBlock(editor, { type: 'quote' }) },
      { title: 'Divider', subtext: 'Horizontal rule', aliases: ['divider', 'hr', 'line', 'separator', 'rule'], group: 'Basic blocks', icon: <Minus size={16} />, onItemClick: () => insertOrUpdateBlock(editor, { type: 'divider' }) },
    ];
    let lastBasic = -1; defaults.forEach((it, i) => { if (it.group === 'Basic blocks') lastBasic = i; });
    const all = lastBasic >= 0 ? [...defaults.slice(0, lastBasic + 1), ...ours, ...defaults.slice(lastBasic + 1)] : [...ours, ...defaults];
    return filterSuggestionItems(all, query);
  };

  return (
    <div className="editor-wrap" ref={wrapRef} onClick={clickBlank} onPointerDown={(e) => { if (e.button === 0) marqueeSelRef.current = null; rightDrag(e); }} onContextMenu={onCtxMenu}>
    <div className="blk-hl" ref={hlRef} />
    <div className="box-sel-layer" ref={selLayerRef} />
    <div className="drop-ind" ref={dropIndRef} />
    {box && <div className="box-rect" style={{ left: box.l, top: box.t, width: box.w, height: box.h }} />}
    {menu && createPortal(<>
      <div className="picker-overlay" onMouseDown={e => e.preventDefault()} onClick={closeMenu} onContextMenu={(e) => { e.preventDefault(); closeMenu(); }} />
      <div className="ctx-menu" ref={menuRef} style={{ left: menu.x, top: menu.y }}>
        <div className="ctx-fmt">
          <button title="Bold" onMouseDown={e => e.preventDefault()} onClick={() => styleAct(menu.id, { bold: true })}><TextB size={15} weight="bold" /></button>
          <button title="Italic" onMouseDown={e => e.preventDefault()} onClick={() => styleAct(menu.id, { italic: true })}><TextItalic size={15} /></button>
          <button title="Underline" onMouseDown={e => e.preventDefault()} onClick={() => styleAct(menu.id, { underline: true })}><TextUnderline size={15} /></button>
          <button title="Strikethrough" onMouseDown={e => e.preventDefault()} onClick={() => styleAct(menu.id, { strike: true })}><TextStrikethrough size={15} /></button>
          <button title="Inline code" onMouseDown={e => e.preventDefault()} onClick={() => styleAct(menu.id, { code: true })}><CodeIcon size={15} /></button>
        </div>
        <div className="popmenu-sep" />
        <MenuItem icon={Scissors} label="Cut" kbd="⌘X" onClick={() => copyBlocks(menu.id, true)} />
        <MenuItem icon={CopySimple} label="Copy" kbd="⌘C" onClick={() => copyBlocks(menu.id, false)} />
        <MenuItem icon={ClipboardText} label="Paste below" onClick={() => pasteBelow(menu.id)} />
        <div className="popmenu-sep" />
        <div className="tim-parent popmenu-item" onMouseDown={e => e.preventDefault()}>
          <span className="tim-row"><TextT size={15} /> Turn into</span>
          <ChevronRight size={12} className="tim-caret" />
          <div className="tim-sub">
            {TURN_INTO.flatMap(it => it.sub ? it.sub : [it]).map(it => (
              <div className="popmenu-item" key={it.label} onClick={() => act(() => menuBlocks(menu.id).forEach(b => { try { editor.updateBlock(b.id, { type: it.type, props: it.props }); } catch {} }))}><it.icon size={15} /> {it.label}</div>
            ))}
          </div>
        </div>
        <div className="tim-parent popmenu-item" onMouseDown={e => e.preventDefault()}>
          <span className="tim-row"><Palette size={15} /> Color</span>
          <ChevronRight size={12} className="tim-caret" />
          <div className="tim-sub color-sub">
            <div className="popmenu-head">Text</div>
            <div className="color-row">{TEXT_COLORS.map(c => <button key={'t' + c} className="color-dot" title={c} style={{ color: COLOR_HEX[c] }} onClick={() => colorAct(menu.id, 'textColor', c)}>A</button>)}</div>
            <div className="popmenu-head">Background</div>
            <div className="color-row">{TEXT_COLORS.map(c => <button key={'b' + c} className="color-dot bg" title={c} style={{ background: c === 'default' ? 'transparent' : `color-mix(in srgb, ${COLOR_HEX[c]} 32%, transparent)` }} onClick={() => colorAct(menu.id, 'backgroundColor', c)}>{c === 'default' ? '×' : ''}</button>)}</div>
          </div>
        </div>
        <div className="popmenu-sep" />
        <MenuItem icon={TextIndent} label="Indent" kbd="Tab" onClick={() => act(() => { cursorOn(menu.id); editor.nestBlock(); })} />
        <MenuItem icon={TextOutdent} label="Un-indent" kbd="⇧Tab" onClick={() => act(() => { cursorOn(menu.id); editor.unnestBlock(); })} />
        <MenuItem icon={ArrowUp} label="Move up" kbd="⌘⇧↑" onClick={() => act(() => { cursorOn(menu.id); editor.moveBlocksUp(); })} />
        <MenuItem icon={ArrowDown} label="Move down" kbd="⌘⇧↓" onClick={() => act(() => { cursorOn(menu.id); editor.moveBlocksDown(); })} />
        <div className="popmenu-sep" />
        <MenuItem icon={CopySimple} label="Duplicate" onClick={() => act(() => { const bs = menuBlocks(menu.id); editor.insertBlocks(bs.map(stripIds), bs[bs.length - 1].id, 'after'); })} />
        <MenuItem icon={LinkSimple} label="Copy link to block" onClick={() => copyBlockLink(menu.id)} />
        <MenuItem icon={Trash2} label="Delete" kbd="⌫" danger onClick={() => act(() => editor.removeBlocks(menuBlocks(menu.id).map(b => b.id)))} />
      </div>
    </>, document.body)}
    {calloutReq && createPortal(<>
      <div className="picker-overlay" onClick={() => blockUI.close()} />
      <div className="ce-pop portal" style={{ left: Math.min(calloutReq.rect.left, window.innerWidth - 350), top: Math.min(calloutReq.rect.bottom + 6, window.innerHeight - 380) }}>
        <div className="ce-colors">{Object.entries(CALLOUT_COLORS).map(([k, v]) => <span key={k} className={'cc-dot' + (k === calloutReq.bg ? ' on' : '')} style={{ background: v.dot }} title={k} onClick={() => { try { editor.updateBlock(calloutReq.blockId, { props: { bg: k } }); } catch {} blockUI.close(); }} />)}</div>
        <EmojiPicker onEmojiClick={e => { try { editor.updateBlock(calloutReq.blockId, { props: { emoji: e.emoji || '💡' } }); } catch {} blockUI.close(); }} theme={light ? 'light' : 'dark'} emojiStyle="native" width={328} height={300} previewConfig={{ showPreview: false }} skinTonesDisabled lazyLoadEmojis />
      </div>
    </>, document.body)}
    <BlockNoteView editor={editor} editable={editable} theme={light ? 'light' : 'dark'} slashMenu={false} sideMenu={false} onChange={() => onChange(JSON.stringify(editor.document))}>
      <SideMenuController sideMenu={(p) => (
        <div ref={(el) => {
            if (!el) return;
            let dx = 0;
            try {
              const b = wrapRef.current?.querySelector(`[data-id="${CSS.escape(p.block?.id || '')}"] > .bn-block > .bn-block-content`);
              const ed = wrapRef.current?.querySelector('.bn-editor');
              if (b && ed) dx = Math.max(0, b.getBoundingClientRect().left - ed.getBoundingClientRect().left);
            } catch {}
            el.style.transform = dx > 2 ? `translateX(${dx}px)` : '';
          }}
          onMouseEnter={() => hl(p.block?.id, true)} onMouseLeave={() => { if (!menu) hl(null, false); }}
          onDragStartCapture={() => {
            if (p.block?.id) {
              let ids = [p.block.id];
              try { const bs = editor.getSelection()?.blocks; if (bs?.length > 1 && bs.some(b => b.id === p.block.id)) ids = bs.map(b => b.id); } catch {}
              dragRef.current = { ids, handle: true };
              wrapRef.current?.classList.add('handle-drag');
            }
            hl(null, false);
          }}>
          <SideMenu {...p}><AddBlockButton {...p} /><DragHandle block={p.block} blockDragStart={p.blockDragStart} blockDragEnd={p.blockDragEnd} onOpen={(b, r) => openMenuAt(b, r, p)} /></SideMenu>
        </div>
      )} />
      <SuggestionMenuController triggerCharacter="/" getItems={slashItems} />
      <SuggestionMenuController triggerCharacter="#" getItems={pageItems} />
      <SuggestionMenuController triggerCharacter="@" getItems={pageItems} />
    </BlockNoteView>
    </div>
  );
}
