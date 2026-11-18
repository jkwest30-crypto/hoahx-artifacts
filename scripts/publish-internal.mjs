#!/usr/bin/env node
// Publish one of the pages that moved to this site (2026-11-17) into go-live/<id>/.
//
//   node scripts/publish-internal.mjs <id> --from <page.html> [--file <name>=<path>]... [--check]
//
// <page.html> is the page as it was built for claude.ai: a fragment (title, styles, body) or a
// whole document. The script wraps a fragment in a document, adds a robots noindex tag, and for
// a page with a store (launch-list, gate, signoff) marks <html data-store-page> and loads
// /_shared/hx-store.js before the page's own script, so the page's `window.claude.use(...)`
// calls reach /api/store/<id>. --file copies a file the page loads next to it (the gate's gate.json).
// --check exits 1 when go-live/<id>/ differs from what the inputs would produce, and writes nothing.
//
// Nothing here pushes: the caller commits go-live/<id>/ and pushes main, which Netlify deploys.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

// id -> whether it has a store, and who may open it. Owners' pages are linked from the hub only on
// Jacob's word; internal ones are linked from nowhere the owners see.
export const PAGES = {
  'build-log':   { store: false, audience: 'owners' },
  'weekly':      { store: false, audience: 'owners' },
  'launch-plan': { store: false, audience: 'owners' },
  'proposal':    { store: false, audience: 'owners' },
  'mvp-tracker': { store: false, audience: 'internal' },
  'launch-list': { store: true,  audience: 'internal' },
  'gate':        { store: true,  audience: 'internal' },
  'signoff':     { store: true,  audience: 'internal' },
};

const NOINDEX = '<meta name="robots" content="noindex, nofollow">';
const SHIM = '<script src="/_shared/hx-store.js"></script>';
const MARK = '<!-- published by scripts/publish-internal.mjs -->';

/** The document to serve for a page's HTML. Pure. */
export function wrap(id, html) {
  const spec = PAGES[id];
  if (!spec) throw new Error(`unknown page ${id}; known: ${Object.keys(PAGES).join(', ')}`);
  let src = String(html).replace(/^﻿/, '');
  const storeAttr = spec.store ? ` data-store-page="${id}"` : '';
  const headAdd = [NOINDEX, spec.store ? SHIM : ''].filter(Boolean).join('\n');
  if (/<html[\s>]/i.test(src)) {
    // A whole document: add the attribute and the head tags, leave the rest alone.
    if (spec.store && !/data-store-page=/.test(src)) src = src.replace(/<html(\s|>)/i, `<html${storeAttr}$1`);
    if (!src.includes('name="robots"') || (spec.store && !src.includes(SHIM))) {
      if (/<head[^>]*>/i.test(src)) src = src.replace(/<head[^>]*>/i, (m) => `${m}\n${headAdd}`);
      else src = src.replace(/<html[^>]*>/i, (m) => `${m}\n<head>\n${headAdd}\n</head>`);
    }
    return src.includes(MARK) ? src : `${MARK}\n${src}`;
  }
  return [
    MARK,
    '<!doctype html>',
    `<html lang="en"${storeAttr}>`,
    '<head>',
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    headAdd,
    '</head>',
    '<body>',
    src.trim(),
    '</body>',
    '</html>',
    '',
  ].join('\n');
}

function parseArgs(argv) {
  const a = { id: argv[0], from: null, files: [], check: false };
  for (let i = 1; i < argv.length; i++) {
    if (argv[i] === '--from') a.from = argv[++i];
    else if (argv[i] === '--file') {
      const [name, p] = String(argv[++i] || '').split('=');
      if (!name || !p || name.includes('/') || name === 'index.html') throw new Error(`--file wants <name>=<path>, got ${argv[i]}`);
      a.files.push({ name, p });
    } else if (argv[i] === '--check') a.check = true;
    else throw new Error(`unknown argument ${argv[i]}`);
  }
  if (!a.id || !a.from) throw new Error('usage: publish-internal.mjs <id> --from <page.html> [--file name=path]... [--check]');
  return a;
}

function main() {
  const a = parseArgs(process.argv.slice(2));
  const out = path.join(ROOT, 'go-live', a.id);
  const want = [{ name: 'index.html', body: wrap(a.id, fs.readFileSync(a.from, 'utf8')) }]
    .concat(a.files.map((f) => ({ name: f.name, body: fs.readFileSync(f.p, 'utf8') })));
  const stale = want.filter((w) => { const p = path.join(out, w.name); return !fs.existsSync(p) || fs.readFileSync(p, 'utf8') !== w.body; });
  if (a.check) {
    if (stale.length) { console.log(`STALE ${a.id}: ${stale.map((s) => s.name).join(', ')}`); process.exit(1); }
    console.log(`CURRENT ${a.id}`);
    return;
  }
  fs.mkdirSync(out, { recursive: true });
  for (const w of want) fs.writeFileSync(path.join(out, w.name), w.body);
  console.log(`WROTE ${a.id}: ${want.map((w) => w.name).join(', ')}${stale.length ? '' : ' (unchanged)'} -> go-live/${a.id}/`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  try { main(); } catch (e) { console.error(String(e.message || e)); process.exit(2); }
}
