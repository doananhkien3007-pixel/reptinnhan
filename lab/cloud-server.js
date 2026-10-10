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
    const media = ['lab-a-front.svg','lab-a-detail.svg','lab-a-video-poster.svg','lab-a-demo.webm','lab-b-front.svg','lab-c-front.svg'];
    const mediaName = path.startsWith('/lab/media/') ? path.slice('/lab/media/'.length) : '';
    const file = media.includes(mediaName) ? `lab/media/${mediaName}` : { '/': 'lab/index.html', '/lab': 'lab/index.html', '/lab/': 'lab/index.html', '/lab/lab.css': 'lab/lab.css', '/lab/lab.js': 'lab/lab.js', '/app.css': 'app.css', '/app-shell.js': 'app-shell.js' }[path];
    if (!file || req.method !== 'GET') { res.writeHead(404); return res.end('Not found'); }
    const type = file.endsWith('.html') ? 'text/html; charset=utf-8' : file.endsWith('.css') ? 'text/css; charset=utf-8' : file.endsWith('.js') ? 'text/javascript; charset=utf-8' : file.endsWith('.svg') ? 'image/svg+xml' : 'video/webm';
    res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; media-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'" });
    res.end(readFileSync(new URL(`../public/${file}`, import.meta.url)));
  });
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const server = createCloudServer();
  server.listen(Number(process.env.EMI_LAB_PORT || 4318), '127.0.0.1', () => console.log('EMI Cloud Lab · http://127.0.0.1:' + server.address().port));
}
