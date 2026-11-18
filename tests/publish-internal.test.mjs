// scripts/publish-internal.mjs: the pages moved from claude.ai get a document, noindex, and the store shim when they have a store.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { wrap, PAGES } from '../scripts/publish-internal.mjs';

test('a fragment with a store becomes a document that loads the shim before the page', () => {
  const out = wrap('gate', '<title>Gate Answers</title>\n<script>claude.use("db")</script>');
  assert.match(out, /^<!-- published by scripts\/publish-internal\.mjs -->\n<!doctype html>/);
  assert.match(out, /<html lang="en" data-store-page="gate">/);
  assert.ok(out.indexOf('/_shared/hx-store.js') < out.indexOf('claude.use'));
  assert.match(out, /name="robots" content="noindex, nofollow"/);
});

test('an owners page gets noindex and no store', () => {
  const out = wrap('build-log', '<!doctype html><html><head><meta charset=utf8></head><body>x</body></html>');
  assert.ok(!out.includes('hx-store.js'));
  assert.ok(!out.includes('data-store-page'));
  assert.match(out, /<head><meta name="robots"|<head>\n<meta name="robots"/);
  assert.equal(wrap('build-log', out), out, 'wrapping twice changes nothing');
});

test('owner pages never say claude', () => {
  for (const id of Object.keys(PAGES).filter((k) => PAGES[k].audience === 'owners')) {
    assert.ok(!/claude/i.test(wrap(id, '<p>x</p>')), id);
  }
});

test('an unknown page is refused', () => {
  assert.throws(() => wrap('process-maps', 'x'), /unknown page/);
  assert.throws(() => wrap('approvals', 'x'), /unknown page/);
});
