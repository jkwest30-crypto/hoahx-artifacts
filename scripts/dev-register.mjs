#!/usr/bin/env node
// Local stand-in for the Netlify site: serves go-live/ with netlify.toml's redirects and runs
// every function under netlify/functions/ (decisions, picks, answers) at /api/<name> against an
// in-memory store (scripts/dev-stubs).
//   node scripts/dev-register.mjs [--port 8788]      DECISION_EDIT_KEY=secret to test the passphrase gate
// Nothing here touches the real shared register.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import Module from 'node:module';
import { fileURLToPath } from 'node:url';
import { parseArgs } from './register-lib.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const args = parseArgs(process.argv.slice(2));
const PORT = +(args.port || process.env.PORT || 8788);

process.env.NODE_PATH = [path.join(here, 'dev-stubs'), process.env.NODE_PATH || ''].filter(Boolean).join(path.delimiter);
Module._initPaths();
const require = createRequire(import.meta.url);
const handlers = {};
for (const f of fs.readdirSync(path.join(root, 'netlify', 'functions')).filter((n) => n.endsWith('.js'))) {
  handlers[f.slice(0, -3)] = require(path.join(root, 'netlify', 'functions', f)).handler;
}

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.pdf': 'application/pdf', '.png': 'image/png' };

function readBody(req) {
  return new Promise((resolve) => { let b = ''; req.on('data', (c) => (b += c)); req.on('end', () => resolve(b)); });
}

http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const fn = (url.pathname.match(/^\/api\/([a-z]+)$/) || url.pathname.match(/^\/\.netlify\/functions\/([a-z]+)$/) || [])[1];
  if (fn && handlers[fn]) {
    const handler = handlers[fn];
    const body = await readBody(req);
    const headers = {}; for (const [k, v] of Object.entries(req.headers)) headers[k.toLowerCase()] = v;
    const out = await handler({ httpMethod: req.method, headers, body, queryStringParameters: Object.fromEntries(url.searchParams) });
    res.writeHead(out.statusCode, out.headers); res.end(out.body);
    console.log(`${req.method} ${req.url} -> ${out.statusCode}`);
    return;
  }
  const aliases = { '/': '/decision-register/decision-register.html', '/workflow-map': '/workflow-map/workflow-map.html', '/scope': '/scope/index.html', '/answers': '/answers/index.html', '/answers/': '/answers/index.html' };
  let file = aliases[url.pathname] || decodeURIComponent(url.pathname);
  const abs = path.join(root, 'go-live', file);
  if (!abs.startsWith(path.join(root, 'go-live')) || !fs.existsSync(abs) || fs.statSync(abs).isDirectory()) { res.writeHead(404); res.end('not found'); return; }
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(abs)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
  fs.createReadStream(abs).pipe(res);
}).listen(PORT, () => console.log(`Dev server: http://localhost:${PORT}/  (functions: ${Object.keys(handlers).join(', ')}; edit key ${process.env.DECISION_EDIT_KEY ? 'REQUIRED' : 'not set'})`));
