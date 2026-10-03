#!/usr/bin/env node
/**
 * A headless browser pass over the Answered Questions tab and "Our reply" on the owners' open
 * questions page, on the local dev server. It reads the page's own data.json and checks the page
 * draws what that file says; run it after a sync has written answered items and replies.
 *
 *   npm run dev -- --port 8795                      # in another terminal (in-memory store)
 *   PLAYWRIGHT=<path to @playwright/test/index.mjs> node scripts/check-answered-tab.mjs --site http://localhost:8795
 *
 * It writes one note to the store, so it refuses any site that is not a local address.
 */
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const args = process.argv.slice(2);
const opt = (name, dflt) => (args.includes(name) ? args[args.indexOf(name) + 1] : dflt);
const site = opt('--site', 'http://localhost:8795').replace(/\/$/, '');
if (!/^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(site)) { console.error(`check-answered-tab: ${site} is not a local address`); process.exit(2); }
if (!process.env.PLAYWRIGHT) { console.error('check-answered-tab: set PLAYWRIGHT to the path of @playwright/test/index.mjs'); process.exit(2); }
const { chromium } = await import(pathToFileURL(resolve(process.env.PLAYWRIGHT)).href);

let failed = 0, passed = 0;
function check(name, ok, detail) {
  if (ok) passed += 1; else failed += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  ·  ' + detail : ''}`);
}
const FORBIDDEN = /register|\bD-\d{3}\b|\bQ-[A-Z]+-\d+\b|\bStripe\b|\bClaude\b|\bAI\b|\bcustomer\b|\bas today\b|\balready handles\b|\bworkshop\b/i;
const data = await (await fetch(site + '/answers/data.json')).json();
const scr = await (await fetch(site + '/answers/screens.json')).json();
const answered = data.answered || [];
if (!answered.length) { console.error('check-answered-tab: data.json has no answered items; run the sync with an accepted.json first'); process.exit(2); }
const replyRows = data.cards.flatMap((c) => c.rows).filter((r) => r.reply);
const replyScreens = scr.features.flatMap((f) => f.screens).filter((s) => s.reply);
const changed = answered.find((a) => a.answer === 'change');
if (changed) {
  await fetch(site + '/api/answers', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: changed.id, v: 'change', n: 'Make it the first of the month.', code: changed.id }) });
}

const browser = await chromium.launch();
const errors = [];
const open = async (ctx) => {
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto(site + '/');
  await page.waitForSelector('[data-answered]');
  return page;
};
try {
  const desk = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await open(desk);
  const nav = await page.locator('.nav a:visible').evaluateAll((as) => as.map((a) => a.textContent.trim()));
  check('the Answered tab is in the navigation', nav.includes('Answered'), nav.join(', '));
  check('the section is titled Answered Questions', (await page.locator('#answered-h').textContent()) === 'Answered Questions');
  const drawn = await page.locator('[data-answered]').evaluateAll((els) => els.map((e) => e.dataset.answered + ':' + e.dataset.status));
  check(`every answered item is drawn with its status (${answered.length})`, drawn.join() === answered.map((a) => a.id + ':' + a.status).join(), drawn.slice(0, 5).join());
  const openRows = await page.locator('[data-row]').evaluateAll((els) => els.map((e) => e.dataset.row));
  check('an answered question is no longer among the open ones', !answered.some((a) => openRows.includes(a.id)));
  const openScreens = await page.locator('#screen-groups [data-screen]').evaluateAll((els) => els.map((e) => 'S-' + e.dataset.screen));
  check('an accepted screen is no longer among the open screens', !answered.filter((a) => a.kind === 'screen').some((a) => openScreens.includes(a.id)));
  const first = page.locator('[data-answered]').first();
  const firstText = await first.innerText();
  check('each item says what will be built and when it was answered and taken in', /What will be built/.test(firstText) && /Answered [A-Z][a-z]{2} \d{1,2} · taken in [A-Z][a-z]{2} \d{1,2}/.test(firstText), firstText.slice(0, 160));
  check('the status reads Planned, Built or Live', /^(Planned|Built|Live)$/.test((await first.locator('.pill.st').textContent()).trim()));
  if (changed) {
    await page.reload(); await page.waitForSelector('[data-answered]');
    const t = await page.locator(`[data-answered="${changed.id}"]`).innerText();
    check('a change shows the owners\' own words from the store', /Make it the first of the month\./.test(t) && /Our recommendation was/.test(t), t.slice(0, 200));
  } else check('a change shows the owners\' own words (no change answered in this data)', true);
  const statuses = [...new Set(answered.map((a) => a.status))];
  for (const st of statuses) {
    await page.locator(`[data-af="${st}"]`).click();
    const shown = await page.locator('[data-answered]').evaluateAll((els) => els.map((e) => e.dataset.status));
    check(`the "${st}" chip shows only ${st} items`, shown.length === answered.filter((a) => a.status === st).length && shown.every((s) => s === st));
  }
  await page.locator('[data-af="all"]').click();
  for (const r of replyRows.slice(0, 3)) {
    const t = await page.locator(`[data-row="${r.id}"] .reply`).innerText().catch(() => '');
    check(`our reply shows under ${r.id}`, t.startsWith('Our reply') && t.includes(r.reply.slice(0, 40)), t.slice(0, 80));
  }
  for (const s of replyScreens.slice(0, 3)) {
    const t = await page.locator(`[data-screen="${s.code}"] .reply`).innerText().catch(() => '');
    check(`our reply shows on screen ${s.code}`, t.startsWith('Our reply') && t.includes(s.reply.slice(0, 40)), t.slice(0, 80));
  }
  check(`replies drawn: ${replyRows.length} questions, ${replyScreens.length} screens`, (await page.locator('.reply').count()) === replyRows.length + replyScreens.filter((s) => !answered.some((a) => a.id === s.id)).length);
  const words = await page.evaluate(() => document.body.innerText);
  check('nothing on the page names the internal numbering or an excluded word', !FORBIDDEN.test(words), (FORBIDDEN.exec(words) || [''])[0]);
  await desk.close();

  const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const p2 = await open(phone);
  await p2.locator('#answered').scrollIntoViewIfNeeded();
  const m = await p2.evaluate(() => ({ scroll: document.documentElement.scrollWidth - document.documentElement.clientWidth, wide: [...document.querySelectorAll('#answered *')].filter((e) => e.getBoundingClientRect().right > window.innerWidth + 1).length }));
  check('390px wide: no sideways scroll, nothing in Answered past the edge', m.scroll <= 0 && m.wide === 0, JSON.stringify(m));
  await phone.close();
  check('no error in the page or its console', errors.filter((e) => !/Failed to load resource|net::ERR_FAILED|401/.test(e)).length === 0, errors.slice(0, 3).join(' | '));
} catch (e) {
  failed += 1;
  console.log(`FAIL  the pass stopped: ${e.message.split('\n')[0]}`);
} finally {
  await browser.close();
}
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
