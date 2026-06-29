export default async function api(path, opts = {}) {
  const headers = {};
  if (opts.body !== undefined) headers['Content-Type'] = 'application/json';
  const r = await fetch('/api' + path, {
    credentials: 'include',
    headers,
    method: opts.method || 'GET',
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
  if (!r.ok) {
    const e = new Error('http ' + r.status);
    e.status = r.status;
    try { e.data = await r.json(); } catch {}
    throw e;
  }
  return r.status === 204 ? null : r.json();
}
