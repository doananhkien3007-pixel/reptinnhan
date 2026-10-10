import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createCloudHandler } from './cloud/handler.js';

export function createCloudServer(options = {}) {
  const handler = createCloudHandler(options);
  return createServer((req, res) => {
    const path = new URL(req.url, 'http://localhost').pathname;
    if (path === '/api/lab') return handler(req, res);
    const file = { '/': 'lab/index.html', '/lab': 'lab/index.html', '/lab/': 'lab/index.html', '/lab/lab.css': 'lab/lab.css', '/lab/lab.js': 'lab/lab.js', '/app.css': 'app.css', '/app-shell.js': 'app-shell.js' }[path];
    if (!file || req.method !== 'GET') { res.writeHead(404); return res.end('Not found'); }
    res.writeHead(200, { 'Content-Type': file.endsWith('.html') ? 'text/html; charset=utf-8' : file.endsWith('.css') ? 'text/css; charset=utf-8' : 'text/javascript; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'none'; form-action 'self'" });
    res.end(readFileSync(new URL(`../public/${file}`, import.meta.url)));
  });
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const server = createCloudServer();
  server.listen(Number(process.env.EMI_LAB_PORT || 4318), '127.0.0.1', () => console.log('EMI Cloud Lab · http://127.0.0.1:' + server.address().port));
}
