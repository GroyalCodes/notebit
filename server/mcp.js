// Model Context Protocol server (Streamable HTTP, stateless) so Claude Code can work
// inside a NoteBit workspace. Mounted at POST /mcp. Auth is a personal token
// (Settings > Claude Code) sent as "Authorization: Bearer nb_...". Every tool runs as
// that user, through the same permission checks as the app.
//
//   claude mcp add --transport http notebit https://notes.example.com/mcp \
//     --header "Authorization: Bearer nb_..."
const PROTOCOL = '2025-06-18';

const str = (d) => ({ type: 'string', description: d });
const TOOLS = [
  { name: 'list_workspaces', description: 'List the workspaces this user belongs to (id, name, role).', inputSchema: { type: 'object', properties: {} } },
  { name: 'list_pages', description: 'The page tree of a workspace as an indented outline with ids. Boards show their columns and cards. Use the ids with the other tools.', inputSchema: { type: 'object', properties: { workspace_id: str('Workspace id (omit to use the first workspace)') } } },
  { name: 'search_pages', description: 'Search page titles and text. Returns ranked matches with ids and snippets.', inputSchema: { type: 'object', properties: { query: str('Search text'), workspace_id: str('Limit to one workspace (optional)') }, required: ['query'] } },
  { name: 'read_page', description: 'Read a page as Markdown (title, tags, body). For a board you get its columns and cards. Page links appear as [Title](/page/<id>).', inputSchema: { type: 'object', properties: { page_id: str('Page id') }, required: ['page_id'] } },
  { name: 'create_page', description: 'Create a page. Body is Markdown: headings, lists, - [ ] to-dos, ```code```, > quotes, "> 💡 text" callouts, tables, images, [text](url) links and [Title](/page/<id>) page links. Two-space indentation nests blocks.', inputSchema: { type: 'object', properties: { title: str('Page title'), markdown: str('Page body in Markdown (optional)'), workspace_id: str('Workspace id (optional, defaults to the first workspace)'), parent_id: str('Put it under this page (optional; use a column id to add a card to a board)'), icon: str('Emoji icon (optional)'), tags: { type: 'array', items: { type: 'string' }, description: 'Tags (optional)' } }, required: ['title'] } },
  { name: 'update_page', description: 'Change a page. Pass markdown to replace the body, or markdown with append=true to add to the end. Title, icon and tags are optional. People editing the page see the change live.', inputSchema: { type: 'object', properties: { page_id: str('Page id'), markdown: str('New body (Markdown)'), append: { type: 'boolean', description: 'Append instead of replacing the body' }, title: str('New title'), icon: str('New emoji icon'), tags: { type: 'array', items: { type: 'string' }, description: 'Replace the tags' } }, required: ['page_id'] } },
  { name: 'move_page', description: 'Move a page in the sidebar: under another page, to the top level (parent_id null), or into a board column (parent_id = column id). Position is "first" or "last" among its siblings, or "after:<sibling id>".', inputSchema: { type: 'object', properties: { page_id: str('Page id'), parent_id: { type: ['string', 'null'], description: 'New parent page or column id, or null for top level' }, position: str('"first", "last" (default) or "after:<page id>"') }, required: ['page_id'] } },
  { name: 'delete_page', description: 'Move a page (and its sub-pages) to the trash. It can be restored from Settings > Trash.', inputSchema: { type: 'object', properties: { page_id: str('Page id') }, required: ['page_id'] } },
  { name: 'create_board', description: 'Create a kanban board with columns (default: To do, In progress, Done). Returns the board and column ids.', inputSchema: { type: 'object', properties: { title: str('Board title'), workspace_id: str('Workspace id (optional)'), columns: { type: 'array', items: { type: 'string' }, description: 'Column names in order (optional)' } }, required: ['title'] } },
  { name: 'add_comment', description: 'Post a comment on a page.', inputSchema: { type: 'object', properties: { page_id: str('Page id'), body: str('Comment text') }, required: ['page_id', 'body'] } },
];

const text = (t) => ({ content: [{ type: 'text', text: String(t) }] });
const fail = (t) => ({ content: [{ type: 'text', text: String(t) }], isError: true });

export function makeMcp({ ops, version }) {
  async function callTool(user, name, a = {}) {
    try {
      switch (name) {
        case 'list_workspaces': { const ws = ops.listWorkspaces(user); return text(ws.length ? ws.map(w => `${w.name}  (id: ${w.id}, role: ${w.role})`).join('\n') : 'No workspaces.'); }
        case 'list_pages': return text(ops.outline(user, a.workspace_id));
        case 'search_pages': { const hits = ops.search(user, a.query, a.workspace_id); return text(hits.length ? hits.map(h => `${h.title || 'Untitled'}  (id: ${h.id})${h.parent ? '  in ' + h.parent : ''}${h.snippet ? '\n    ' + h.snippet : ''}`).join('\n') : 'No matches.'); }
        case 'read_page': return text(ops.readMarkdown(user, a.page_id));
        case 'create_page': { const p = ops.createPage(user, a); return text(`Created "${p.title}" (id: ${p.id})${p.parent_id ? ' under ' + p.parent_id : ''}.`); }
        case 'update_page': { const p = ops.updatePage(user, a); return text(`Updated "${p.title}" (id: ${p.id}).`); }
        case 'move_page': { const p = ops.movePage(user, a); return text(`Moved "${p.title}" (id: ${p.id}) to ${p.parent_id ? 'parent ' + p.parent_id : 'the top level'}.`); }
        case 'delete_page': { const r = ops.deletePage(user, a.page_id); return text(`Moved ${r.trashed} page(s) to the trash.`); }
        case 'create_board': { const b = ops.createBoard(user, a); return text(`Created board "${b.title}" (id: ${b.id}) with columns:\n` + b.columns.map(c => `  ${c.title}  (column id: ${c.id})`).join('\n')); }
        case 'add_comment': { ops.addComment(user, a.page_id, a.body); return text('Comment posted.'); }
        default: return fail('Unknown tool: ' + name);
      }
    } catch (e) { return fail(e?.message || String(e)); }
  }
  async function handleMessage(user, msg) {
    const id = msg?.id; const method = msg?.method;
    const res = (result) => ({ jsonrpc: '2.0', id, result });
    const err = (code, message) => ({ jsonrpc: '2.0', id, error: { code, message } });
    if (!msg || msg.jsonrpc !== '2.0' || typeof method !== 'string') return err(-32600, 'Invalid request');
    if (method.startsWith('notifications/')) return null; // no reply for notifications
    switch (method) {
      case 'initialize': return res({ protocolVersion: typeof msg.params?.protocolVersion === 'string' ? msg.params.protocolVersion : PROTOCOL, capabilities: { tools: { listChanged: false } }, serverInfo: { name: 'notebit', version }, instructions: `You are connected to a NoteBit workspace as ${user.name || user.email}. Pages are Markdown; boards have columns whose cards are pages. Start with list_workspaces or list_pages, then read_page. Changes you make show up live for people who have the page open.` });
      case 'ping': return res({});
      case 'tools/list': return res({ tools: TOOLS });
      case 'tools/call': return res(await callTool(user, msg.params?.name, msg.params?.arguments || {}));
      default: return err(-32601, 'Method not found: ' + method);
    }
  }
  // Fastify route handler
  return async function mcpRoute(req, reply, user) {
    if (req.method === 'GET') return reply.code(405).header('Allow', 'POST, DELETE').send({ error: 'This MCP server does not use server-sent events. POST JSON-RPC messages here.' });
    if (req.method === 'DELETE') return reply.code(204).send();
    const body = req.body;
    const msgs = Array.isArray(body) ? body : [body];
    const out = [];
    for (const m of msgs) { const r = await handleMessage(user, m); if (r) out.push(r); }
    if (!out.length) return reply.code(202).send();
    reply.header('Content-Type', 'application/json');
    return reply.send(Array.isArray(body) ? out : out[0]);
  };
}
export { TOOLS };
