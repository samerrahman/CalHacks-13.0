import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { dirname, resolve, extname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
let three;
try { three = resolve(dirname(require.resolve('three')), '..'); } catch { console.error('Run npm ci inside lock-in-kit before previewing.'); process.exit(1); }
const mime = { '.html':'text/html', '.mjs':'text/javascript', '.js':'text/javascript', '.css':'text/css', '.json':'application/json', '.glb':'model/gltf-binary', '.png':'image/png', '.svg':'image/svg+xml', '.wav':'audio/wav' };
const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    let path = decodeURIComponent(url.pathname);
    if (path === '/') path = '/preview.html';
    let base = root, relative = path.slice(1);
    if (path.startsWith('/vendor/three/')) { base = three; relative = path.slice('/vendor/three/'.length); }
    else if (!['/preview.html','/preview.mjs','/preview.css'].includes(path) && !path.startsWith('/assets/')) { res.writeHead(404); res.end(); return; }
    const file = resolve(base, relative);
    if (!file.startsWith(base + sep)) { res.writeHead(403); res.end(); return; }
    const data = await readFile(file);
    res.writeHead(200, { 'Content-Type': mime[extname(file)] ?? 'application/octet-stream', 'Cache-Control':'no-store' }); res.end(data);
  } catch { res.writeHead(404); res.end('Not found'); }
});
const port = Number(process.env.LOCK_IN_PREVIEW_PORT || 5186);
server.listen(port, '127.0.0.1', () => console.log(`LOCK IN asset preview: http://127.0.0.1:${port}`));
for (const signal of ['SIGINT','SIGTERM']) process.on(signal, () => server.close(() => process.exit(0)));
