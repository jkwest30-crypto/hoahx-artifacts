#!/usr/bin/env node
// Local stand-in for /api/store/* (netlify/functions/pagestore.js) on the in-memory Blobs stub, and a
// static server for go-live/, for tests and for trying a moved page before pushing:
//   node scripts/dev-pagestore.mjs [port]      (default 8899; prints "READY <port>")
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import Module, { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
process.env.NODE_PATH = [path.join(here, 'dev-stubs'), process.env.NODE_PATH || ''].filter(Boolean).join(path.delimiter);
Module._initPaths();
const require = createRequire(import.meta.url);
const { handler } = require(path.join(here, '..', 'netlify', 'functions', 'pagestore.js'));
const ROOT = path.join(here, '..', 'go-live');
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.json': 'application/json', '.css': 'text/css', '.png': 'image/png' };
const port = Number(process.argv[2] || 8899);

http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://x');
  if (u.pathname.startsWith('/api/store/')) {
    let body = '';
    for await (const c of req) body += c;
    const r = await handler({ httpMethod: req.method, path: u.pathname, headers: req.headers, body: body || undefined, queryStringParameters: Object.fromEntries(u.searchParams) });
    res.writeHead(r.statusCode, r.headers);
    return res.end(r.isBase64Encoded ? Buffer.from(r.body, 'base64') : r.body);
  }
  let p = path.join(ROOT, decodeURIComponent(u.pathname));
  if (!p.startsWith(ROOT)) { res.writeHead(403); return res.end(); }
  if (fs.existsSync(p) && fs.statSync(p).isDirectory()) p = path.join(p, 'index.html');
  if (!fs.existsSync(p)) { res.writeHead(404); return res.end('not found'); }
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(p)] || 'application/octet-stream' });
  fs.createReadStream(p).pipe(res);
}).listen(port, () => console.log(`READY ${port}`));
