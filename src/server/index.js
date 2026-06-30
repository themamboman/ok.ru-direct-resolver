import { createServer } from 'node:http';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { sendJson } from './lib/http-response.js';
import { handleResolve } from './routes/resolve.js';
import { handleStream } from './routes/stream.js';

const root = fileURLToPath(new URL('../..', import.meta.url));
const publicDir = join(root, 'public');
const libDir = join(root, 'src/lib');
const port = Number(process.env.PORT) || 8787;

const mime = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
};

const serve = (base, path, response) => {
  const file = join(base, path);
  if (!file.startsWith(base) || !existsSync(file) || statSync(file).isDirectory()) {
    return false;
  }
  response.writeHead(200, { 'Content-Type': mime[extname(file)] ?? 'application/octet-stream' });
  createReadStream(file).pipe(response);
  return true;
};

const routeStatic = (pathname, response) => {
  if (pathname === '/') return serve(publicDir, 'index.html', response);
  if (pathname.startsWith('/lib/')) return serve(libDir, pathname.slice(5), response);
  if (!pathname.startsWith('/api/')) return serve(publicDir, pathname.slice(1), response);
  return false;
};

createServer(async (request, response) => {
  const url = new URL(request.url ?? '/', `http://${request.headers.host}`);
  const { pathname } = url;

  if (request.method === 'POST' && pathname === '/api/resolve') {
    await handleResolve(request, response);
    return;
  }

  if ((request.method === 'GET' || request.method === 'HEAD') && pathname === '/api/stream') {
    await handleStream(request, response, url);
    return;
  }

  if (request.method === 'GET' && routeStatic(pathname, response)) {
    return;
  }

  sendJson(response, 404, { error: 'Not found' });
}).listen(port, () => {
  process.stdout.write(`http://localhost:${port}\n`);
});
