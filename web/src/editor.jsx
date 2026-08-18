// The page editor: BlockNote + Yjs collaboration, block drag/drop, marquee selection, context menu.
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useCreateBlockNote, SuggestionMenuController, getDefaultReactSlashMenuItems, SideMenu, SideMenuController, DragHandleMenu, RemoveBlockItem, useBlockNoteEditor, useComponentsContext, AddBlockButton } from '@blocknote/react';
import { BlockNoteView } from '@blocknote/mantine';
import { filterSuggestionItems, insertOrUpdateBlock } from '@blocknote/core';
import { TextSelection } from 'prosemirror-state';
import '@blocknote/mantine/style.css';
import * as Y from 'yjs';
import { WebsocketProvider } from 'y-websocket';
import { Trash as Trash2, CaretRight as ChevronRight, DotsSixVertical as GripVertical, TextT, CopySimple, TextB, TextItalic, TextUnderline, TextStrikethrough, TextIndent, TextOutdent, ArrowUp, ArrowDown, Scissors, ClipboardText, Quotes, Minus, Code as CodeIcon } from '@phosphor-icons/react';
import { PageIcon, userColor, parseContent } from './ui.jsx';
import { schema, TURN_INTO, stripIds, looksLikeMarkdown } from './blocks.jsx';
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
export function Editor({ page, editable, pages, onChange, insertRef, me }) {
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
  if (import.meta.env.DEV) window.__nb = { editor, ydoc, provider }; // dev-only debugging hook

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

