import { createReadStream } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import generatePatternHandler from '../api/generate-pattern.js';

const projectRoot = fileURLToPath(new URL('..', import.meta.url));
const port = Number.parseInt(process.env.PORT || '3000', 10);
const publicFiles = new Map([
  ['/', 'index.html'],
  ['/index.html', 'index.html'],
  ['/script.js', 'script.js'],
  ['/styles.css', 'styles.css'],
]);
const mimeTypes = new Map([
  ['.html', 'text/html; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.css', 'text/css; charset=utf-8'],
]);

function applySecurityHeaders(response) {
  response.setHeader('X-Content-Type-Options', 'nosniff');
  response.setHeader('X-Frame-Options', 'DENY');
  response.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
}

function sendNotFound(response) {
  response.statusCode = 404;
  response.setHeader('Content-Type', 'text/plain; charset=utf-8');
  response.end('Not found');
}

const server = createServer(async (request, response) => {
  applySecurityHeaders(response);
  const requestUrl = new URL(request.url || '/', `http://${request.headers.host || 'localhost'}`);

  if (requestUrl.pathname === '/api/generate-pattern') {
    await generatePatternHandler(request, response);
    return;
  }

  if (request.method !== 'GET' && request.method !== 'HEAD') {
    response.statusCode = 405;
    response.setHeader('Allow', 'GET, HEAD');
    response.end();
    return;
  }

  const publicFile = publicFiles.get(requestUrl.pathname);
  if (!publicFile) {
    sendNotFound(response);
    return;
  }

  const absolutePath = join(projectRoot, publicFile);
  response.statusCode = 200;
  response.setHeader('Content-Type', mimeTypes.get(extname(publicFile)) || 'application/octet-stream');
  response.setHeader('Cache-Control', 'no-cache');

  if (request.method === 'HEAD') {
    response.end();
    return;
  }

  const stream = createReadStream(absolutePath);
  stream.on('error', () => sendNotFound(response));
  stream.pipe(response);
});

server.listen(port, '127.0.0.1', () => {
  console.log(`DM99 AI development server: http://127.0.0.1:${port}`);
});
