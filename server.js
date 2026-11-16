'use strict';

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const api = require('./api/handler');

const root = __dirname;
const adminPassword = process.env.SAFEPATH_ADMIN_PASSWORD || '';
const sessionSecret = process.env.SAFEPATH_SESSION_SECRET || '';
if (adminPassword.length < 16 || sessionSecret.length < 32) {
  console.error('Configure SAFEPATH_ADMIN_PASSWORD (16+ characters) and SAFEPATH_SESSION_SECRET (32+ characters) before starting.');
  process.exit(1);
}

const mime = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.avif': 'image/avif',
  '.json': 'application/json; charset=utf-8',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
};
const staticFiles = new Set(['index.html', 'admin.html', 'app.js', 'admin.js', 'styles.css', 'STARITA.avif', 'road-network.json']);

function json(res, status, value) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(value));
}

function staticFile(req, res, pathname) {
  const route = pathname === '/' ? '/index.html' : pathname;
  let name;
  try { name = decodeURIComponent(route).slice(1); } catch { return json(res, 400, { error: 'Invalid path.' }); }
  if (!staticFiles.has(name)) return json(res, 404, { error: 'File not found.' });
  const file = path.join(root, name);
  fs.readFile(file, (error, contents) => {
    if (error) return json(res, 404, { error: 'File not found.' });
    res.writeHead(200, {
      'Content-Type': mime[path.extname(file)] || 'application/octet-stream',
      'Cache-Control': 'no-cache',
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'DENY',
      'Referrer-Policy': 'no-referrer',
      'Permissions-Policy': 'geolocation=(self)',
    });
    res.end(req.method === 'HEAD' ? undefined : contents);
  });
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    if (url.pathname.startsWith('/api/')) await api(req, res);
    else if (['GET', 'HEAD'].includes(req.method)) staticFile(req, res, url.pathname);
    else json(res, 405, { error: 'Method not allowed.' });
  } catch (error) {
    if (!res.headersSent) json(res, error.status || 500, { error: error.status ? error.message : 'The server could not complete this request.' });
    if (!error.status) console.error(error);
  }
});

const port = Number(process.env.PORT) || 3000;
server.listen(port, process.env.HOST || '127.0.0.1', () => {
  console.log(`SAFEPATH is running at http://localhost:${port}`);
  console.log(`Admin page: http://localhost:${port}/admin.html`);
});

function shutdown() {
  server.close(() => process.exit(0));
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
