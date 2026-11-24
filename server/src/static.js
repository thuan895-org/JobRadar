// Serves the built frontends: frontend/client/dist at /app/, frontend/admin/dist at /admin/.
// Unknown paths without a file extension get index.html, so each app's own
// routing works on reload. Built assets have hashed names and are cached for a year.
import { readFile, stat } from 'node:fs/promises';
import { join, normalize, extname, sep } from 'node:path';
import { ROOT } from './util.js';
import { send } from './http.js';

const APPS = {
  '/app': join(ROOT, '..', 'frontend', 'client', 'dist'),
  '/admin': join(ROOT, '..', 'frontend', 'admin', 'dist'),
};
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.ico': 'image/x-icon', '.json': 'application/json',
  '.woff2': 'font/woff2', '.txt': 'text/plain; charset=utf-8', '.webp': 'image/webp',
};

async function fileIfExists(path) {
  try {
    return (await stat(path)).isFile() ? path : null;
  } catch {
    return null;
  }
}

/** Returns true when the request was for /app or /admin (served, redirected or 404). */
export async function serveApp(req, res, url) {
  const prefix = Object.keys(APPS).find((p) => url.pathname === p || url.pathname.startsWith(`${p}/`));
  if (!prefix || (req.method !== 'GET' && req.method !== 'HEAD')) return false;
  if (url.pathname === prefix) {
    res.writeHead(301, { Location: `${prefix}/` });
    res.end();
    return true;
  }
  const dist = APPS[prefix];
  const rel = decodeURIComponent(url.pathname.slice(prefix.length + 1));
  const target = normalize(join(dist, rel));
  if (target !== dist && !target.startsWith(dist + sep)) return send(res, 400, { error: 'bad path' }), true;

  let file = rel ? await fileIfExists(target) : null;
  if (!file && !extname(rel)) file = await fileIfExists(join(dist, 'index.html'));
  if (!file) {
    if (!(await fileIfExists(join(dist, 'index.html')))) {
      send(res, 503, `<p style="font-family:sans-serif">Giao diện ${prefix} chưa được build. Chạy <code>npm run build</code> (trên Render: Build Command <code>npm ci &amp;&amp; npm run build</code>).</p>`, 'text/html; charset=utf-8');
    } else {
      send(res, 404, { error: 'not found' });
    }
    return true;
  }
  const isAsset = file.includes(`${sep}assets${sep}`);
  res.writeHead(200, {
    'Content-Type': TYPES[extname(file)] ?? 'application/octet-stream',
    'Cache-Control': isAsset ? 'public, max-age=31536000, immutable' : 'no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  res.end(req.method === 'HEAD' ? undefined : await readFile(file));
  return true;
}
