#!/usr/bin/env node
/**
 * A headless browser pass over the owners' open questions page, on the local dev server.
 *
 *   npm run dev -- --port 8789                      # in another terminal (in-memory store)
 *   PLAYWRIGHT=<path to @playwright/test/index.mjs> node scripts/check-answers-page.mjs --site http://localhost:8789
 *   … --shots <folder>                              # also saves screenshots there
 *
 * This repository has no browser of its own: PLAYWRIGHT points at an install elsewhere (the
 * HOAhx checkout has one under node_modules/@playwright/test/index.mjs).
 *
 * It ANSWERS QUESTIONS, so it refuses any site that is not a local address. It never runs
 * against the page the owners use.
 */
import { mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const args = process.argv.slice(2);
const opt = (name, dflt) => (args.includes(name) ? args[args.indexOf(name) + 1] : dflt);
const site = opt('--site', 'http://localhost:8789').replace(/\/$/, '');
const shots = opt('--shots', '');
if (!/^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(site)) { console.error(`check-answers-page: ${site} is not a local address; this pass saves answers and only runs locally`); process.exit(2); }
if (!process.env.PLAYWRIGHT) { console.error('check-answers-page: set PLAYWRIGHT to the path of @playwright/test/index.mjs'); process.exit(2); }
const { chromium } = await import(pathToFileURL(resolve(process.env.PLAYWRIGHT)).href);
if (shots) mkdirSync(shots, { recursive: true });

let failed = 0, passed = 0;
function check(name, ok, detail) {
  if (ok) passed += 1; else failed += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  ·  ' + detail : ''}`);
}
const api = async (method, body, query) => {
  const res = await fetch(`${site}/api/answers${query || ''}`, { method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  return { status: res.status, json: await res.json() };
};
const live = async () => (await api('GET')).json;
const full = async () => (await api('GET', null, '?full=1')).json;
const FORBIDDEN = /register|\bD-\d{3}\b|\bQ-[A-Z]+-\d+\b|\bStripe\b|\bClaude\b|\bAI\b|\bcustomer\b|\bas today\b|\balready handles\b|\bworkshop\b/i;
const DRIVE = /^https:\/\/drive\.google\.com\/file\/d\/[\w-]+\/view$/;

// a clean store: this pass owns the local one
for (const [id, rec] of Object.entries(await full())) if (rec.v || rec.n) await api('POST', { id, v: '', n: '' });

const browser = await chromium.launch();
const errors = [];
async function openPage(context, path) {
  const page = await context.newPage();
  page.on('pageerror', (e) => errors.push(`${path}: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`${path}: console: ${m.text()}`); });
  await page.goto(site + path, { waitUntil: 'networkidle' });
  await page.waitForSelector('[data-row]');
  await page.evaluate(() => document.fonts.ready);
  return page;
}
const saved = (page) => page.waitForFunction(() => document.querySelector('[data-status]').textContent === 'Saved', null, { timeout: 5000 });
const row = (page, id) => page.locator(`[data-row="${id}"]`);
const card = (page, id) => page.locator(`[data-card="${id}"]`);
const text = (loc) => loc.innerText().then((t) => t.replace(/\s+/g, ' ').trim());

// what an owner can read, measured in the page
const measure = (page) => page.evaluate(() => {
  const visible = (el) => { const r = el.getBoundingClientRect(); const s = getComputedStyle(el); return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none'; };
  const rgb = (c) => { const m = /rgba?\(([^)]+)\)/.exec(c); if (!m) return null; const p = m[1].split(',').map((x) => parseFloat(x)); return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 }; };
  const lum = ({ r, g, b }) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
  const backdrop = (el) => { for (let e = el; e; e = e.parentElement) { const c = rgb(getComputedStyle(e).backgroundColor); if (c && c.a === 1) return c; } return { r: 255, g: 255, b: 255, a: 1 }; };
  const out = { small: [], faint: [], short: [], texts: 0, buttons: 0, wide: [] };
  const label = (el) => (el.className && typeof el.className === 'string' ? el.tagName.toLowerCase() + '.' + el.className.split(' ')[0] : el.tagName.toLowerCase()) + ' "' + (el.textContent || '').trim().slice(0, 40) + '"';
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  const seen = new Set();
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    if (!n.nodeValue.trim()) continue;
    const el = n.parentElement;
    if (!el || seen.has(el) || ['SCRIPT', 'STYLE'].includes(el.tagName) || !visible(el)) continue;
    seen.add(el);
    out.texts += 1;
    const s = getComputedStyle(el);
    const size = parseFloat(s.fontSize);
    if (size < 12) out.small.push(label(el) + ' ' + size + 'px');
    const fg = rgb(s.color), bg = backdrop(el);
    const a = lum(fg), b = lum(bg);
    const ratio = (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
    if (ratio < 4.5) out.faint.push(label(el) + ' ' + ratio.toFixed(2) + ':1');
  }
  for (const b of document.querySelectorAll('button, summary, a.btn')) {
    if (!visible(b)) continue;
    out.buttons += 1;
    const h = b.getBoundingClientRect().height;
    if (h < 36) out.short.push(label(b) + ' ' + h.toFixed(1) + 'px');
  }
  const vw = document.documentElement.clientWidth;
  out.scroll = document.documentElement.scrollWidth - vw;
  for (const el of document.body.querySelectorAll('*')) { if (!visible(el)) continue; const r = el.getBoundingClientRect(); if (r.right > vw + 0.5 || r.left < -0.5) out.wide.push(label(el) + ' ' + Math.round(r.left) + '…' + Math.round(r.right)); }
  return out;
});
function readable(name, m) {
  check(`${name}: no text under 12px`, m.small.length === 0, m.small.length ? m.small.slice(0, 4).join(' | ') : `${m.texts} pieces of text measured`);
  check(`${name}: all text at least 4.5:1 on its background`, m.faint.length === 0, m.faint.length ? m.faint.slice(0, 4).join(' | ') : `${m.texts} pieces of text measured`);
  check(`${name}: every button at least 36px tall`, m.short.length === 0, m.short.length ? m.short.slice(0, 4).join(' | ') : `${m.buttons} buttons measured`);
  check(`${name}: no sideways scroll, nothing past the edge`, m.scroll <= 0 && m.wide.length === 0, m.scroll > 0 || m.wide.length ? `scroll ${m.scroll}px; ${m.wide.slice(0, 3).join(' | ')}` : '');
}

try {
  const desktop = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  let page = await openPage(desktop, '/');

  // ── the page itself ──
  check('the site root serves the page', (await page.title()) === 'HOAhx · Your open questions' && (await text(page.locator('h1'))) === 'Your open questions');
  const counts = await page.evaluate(() => ({ rows: document.querySelectorAll('[data-row]').length, cards: document.querySelectorAll('[data-card]').length, screens: document.querySelectorAll('[data-screen]').length }));
  const data = await (await fetch(site + '/answers/data.json')).json();
  const scr = await (await fetch(site + '/answers/screens.json')).json();
  const nRows = data.cards.reduce((n, c) => n + c.rows.length, 0);
  check('every question and every screen is drawn', counts.rows === nRows && counts.cards === data.cards.length && counts.screens === 27, `${counts.rows} questions on ${counts.cards} cards, ${counts.screens} screens`);
  const where = await text(page.locator('#where'));
  check('"Where you are" is two columns with their counts', /Questions 0 of \d+ answered 0 Agreed 0 To change 0 To discuss \d+ Not answered Screens 0 of 27 reviewed 0 Signed off 0 Changes suggested 0 To discuss 27 Not reviewed/.test(where), where);
  const mast = await text(page.locator('.mast'));
  check('the header says "Last updated", and nothing of the facts that were removed', /Last updated [A-Z][a-z]+ \d{1,2}, \d{4}/.test(mast) && !/Prepared|Recommendations|Open questions on/.test(mast), mast.slice(0, 200));
  const words = await page.evaluate(() => document.body.innerText + ' ' + [...document.querySelectorAll('[href],[title],[aria-label]')].map((e) => [e.getAttribute('href'), e.getAttribute('title'), e.getAttribute('aria-label')].join(' ')).join(' '));
  check('nothing an owner can read names the internal numbering or an excluded word', !FORBIDDEN.test(words), (FORBIDDEN.exec(words) || [''])[0]);
  // Only the links a person can see: the Videos tab stays hidden until the video list has something in it.
  const nav = await page.locator('.nav a:visible').evaluateAll((as) => as.map((a) => a.textContent.trim() + ' -> ' + a.getAttribute('href')));
  const videosShown = (await page.locator('#videos-to-review .v-tile').count()) > 0;
  const expectedNav = 'HOAhx · Waiting on you -> #top, Screens -> #screens, Questions -> #questions, ' + (videosShown ? 'Videos -> #videos-to-review, ' : '') + 'Hub -> /hub';
  check('the navigation links to this page\'s sections and the hub only', nav.join(', ') === expectedNav, nav.join(', '));
  const other = await openPage(desktop, '/answers');
  check('/answers is the same page', (await other.locator('[data-row]').count()) === nRows && (await text(other.locator('h1'))) === 'Your open questions');
  await other.close();

  // ── the recommendation: one line, expanded on click ──
  const rec = row(page, 'A01-1').locator('[data-toggle]');
  const closed = await rec.locator('.t').evaluate((el) => ({ h: el.getBoundingClientRect().height, line: parseFloat(getComputedStyle(el).lineHeight), cut: el.scrollHeight > el.clientHeight }));
  await rec.click();
  const opened = await row(page, 'A01-1').locator('[data-toggle] .t').evaluate((el) => el.getBoundingClientRect().height);
  check('a recommendation is one line until it is selected', closed.h <= closed.line * 1.2 && closed.cut && opened > closed.h && (await row(page, 'A01-1').locator('[data-toggle]').getAttribute('aria-expanded')) === 'true', `${Math.round(closed.h)}px closed, ${Math.round(opened)}px open`);

  // ── agree a whole card ──
  const a02 = data.cards.find((c) => c.id === 'A02');
  for (const r of a02.rows) { await row(page, r.id).locator('[data-mark="agree"]').click(); await saved(page); }
  let store = await live();
  check('agreeing every question on a card makes the card Agreed', (await text(card(page, 'A02').locator('.card-h .pill'))) === 'Agreed' && (await text(card(page, 'A02').locator('.card-h small'))) === `${a02.rows.length} of ${a02.rows.length} answered`, await text(card(page, 'A02').locator('.card-h .side')));
  check('each of its answers is in the store, under the question\'s own id', a02.rows.every((r) => store[r.id] && store[r.id].v === 'agree'), JSON.stringify(a02.rows.map((r) => [r.id, store[r.id] && store[r.id].v])));
  check('the counts follow', new RegExp(`Questions ${a02.rows.length} of ${nRows} answered ${a02.rows.length} Agreed`).test(await text(page.locator('#where'))) && /1 of \d+ cards agreed/.test(await text(page.locator('.group', { has: page.locator('[data-card="A02"]') }).locator('.group-h'))));
  await row(page, 'A01-1').locator('[data-mark="agree"]').click(); await saved(page);
  check('a card with one question agreed and others open is In progress', (await text(card(page, 'A01').locator('.card-h .pill'))) === 'In progress');

  // ── change, with a note, inline under the question ──
  await row(page, 'A01-3').locator('[data-mark="change"]').click();
  const box = row(page, 'A01-3').locator('.box');
  const place = await row(page, 'A01-3').evaluate((el) => { const kids = [...el.querySelector('.q-main').children]; const b = kids.findIndex((k) => k.classList.contains('box')); const r = kids.findIndex((k) => k.classList.contains('rec-btn')); const box = el.querySelector('.box'); return { after: b > r && r >= 0, position: getComputedStyle(box).position, focused: document.activeElement === el.querySelector('textarea'), boxes: document.querySelectorAll('.box').length }; });
  check('Change opens its note box inline, under that question\'s recommendation', place.after && place.position === 'static' && place.boxes === 1 && place.focused, JSON.stringify(place));
  check('the box asks "What should it be instead?"', (await text(box.locator('label'))) === 'What should it be instead?' && (await text(box.locator('.box-k'))) === 'CHANGING OUR RECOMMENDATION');
  const changeNote = 'Off by default.\nThe owner switches it on for a tenant they trust.';
  await box.locator('textarea').fill(changeNote); await saved(page);
  store = await live();
  check('the note is saved as typed', store['A01-3'].v === 'change' && store['A01-3'].n === changeNote, JSON.stringify(store['A01-3'].n));
  await box.locator('[data-done]').click();
  check('Done shows the note under the question, with Edit', (await text(row(page, 'A01-3').locator('.q-note'))) === 'What you want changed Off by default. The owner switches it on for a tenant they trust. Edit' && (await page.locator('.box').count()) === 0, await text(row(page, 'A01-3').locator('.q-note')));
  check('the card reads Change asked', (await text(card(page, 'A01').locator('.card-h .pill'))) === 'Change asked');
  await row(page, 'A01-2').locator('[data-mark="change"]').click(); await saved(page);
  await page.keyboard.press('Escape');
  check('a Change with nothing written says we will ask', (await text(row(page, 'A01-2').locator('.q-note'))) === 'No note yet: we will ask you on the next call Add a note' && (await live())['A01-2'].n === undefined);

  // ── discuss, with a note and without ──
  await row(page, 'A03-1').locator('[data-mark="discuss"]').click();
  const dbox = row(page, 'A03-1').locator('.box');
  check('Discuss opens its own box: "What would you like to talk through? (optional)"', (await text(dbox.locator('label'))) === 'What would you like to talk through? (optional)' && (await text(dbox.locator('.box-k'))) === 'TO DISCUSS');
  await dbox.locator('textarea').fill('Should the whole board be told, or only the treasurer?'); await saved(page);
  await dbox.locator('[data-done]').click();
  store = await live();
  check('a Discuss and its note are saved', store['A03-1'].v === 'discuss' && store['A03-1'].n === 'Should the whole board be told, or only the treasurer?' && (await text(row(page, 'A03-1').locator('.q-note'))).startsWith('Your note for the call Should the whole board'));
  await row(page, 'A03-2').locator('[data-mark="discuss"]').click(); await saved(page);
  await row(page, 'A03-2').locator('[data-done]').click();
  check('a Discuss with no note goes on the agenda all the same', (await text(row(page, 'A03-2').locator('.q-note'))) === 'On the agenda for the next call Add a note' && (await live())['A03-2'].v === 'discuss');
  check('the card reads To discuss', (await text(card(page, 'A03').locator('.card-h .pill'))) === 'To discuss');
  await row(page, 'A03-1').locator('[data-edit]').click();
  await row(page, 'A03-1').locator('[data-mark="change"]').click(); await saved(page);
  check('moving from Discuss to Change keeps what was written', (await row(page, 'A03-1').locator('textarea').inputValue()) === 'Should the whole board be told, or only the treasurer?' && (await text(row(page, 'A03-1').locator('.box label'))) === 'What should it be instead?');
  await row(page, 'A03-1').locator('[data-mark="discuss"]').click(); await saved(page);
  await page.keyboard.press('Escape');

  // ── clear a mark ──
  const first = a02.rows[0].id;
  await row(page, first).locator('[data-mark="agree"]').click(); await saved(page);
  store = await live();
  const hist = (await full())[first];
  check('pressing the lit button clears the answer', (await row(page, first).getAttribute('data-state')) === 'open' && !store[first] && (await text(card(page, 'A02').locator('.card-h .pill'))) === (a02.rows.length > 1 ? 'In progress' : 'Waiting on you'));
  check('the cleared answer is kept in the history', hist.v === '' && hist.history.length >= 1 && hist.history[hist.history.length - 1].v === 'agree', JSON.stringify(hist.history.slice(-1)));
  await row(page, 'A01-2').locator('[data-mark="change"]').click(); await saved(page);
  check('clearing a Change removes its box and its note line', (await row(page, 'A01-2').locator('.q-note, .box').count()) === 0);

  // ── filters ──
  const chips = await text(page.locator('#q-chips'));
  const nAgree = a02.rows.length - 1 + 1, nOpen = nRows - nAgree - 1 - 2;
  check('the chips count each state', chips === `All ${nRows} Not answered ${nOpen} Agreed ${nAgree} To change 1 To discuss 2`, chips);
  await page.locator('[data-qf="change"]').click();
  check('"To change" shows only what is to change', (await page.locator('[data-row]').evaluateAll((els) => els.map((e) => e.dataset.row).join(','))) === 'A01-3' && (await page.locator('[data-card]').count()) === 1);
  await page.locator('[data-qf="discuss"]').click();
  check('"To discuss" shows only what is to discuss', (await page.locator('[data-row]').evaluateAll((els) => els.map((e) => e.dataset.row).join(','))) === 'A03-1,A03-2');
  await page.locator('[data-qf="open"]').click();
  check('"Not answered" shows the rest', (await page.locator('[data-row]').count()) === nOpen);
  await page.locator('[data-qf="all"]').click();
  check('"All" brings everything back', (await page.locator('[data-row]').count()) === nRows);

  // ── videos: only where the thing is built ──
  const linked = await page.locator('.vids').evaluateAll((els) => els.map((el) => ({ at: (el.closest('[data-row]') || el.closest('[data-screen]')).getAttribute(el.closest('[data-row]') ? 'data-row' : 'data-screen'), tag: el.querySelector('.built').textContent, links: [...el.querySelectorAll('a')].map((a) => ({ href: a.href, text: a.textContent, target: a.target })) })));
  const want = ['A05-1', 'A05-2', 'A10-3', 'A25-1', 'A26-1', 'B1', 'B2', 'B3'];
  check('a video is linked on the five questions and three screens confirmed, and nowhere else', linked.map((l) => l.at).sort().join(',') === want.slice().sort().join(','), linked.map((l) => l.at + ':' + l.links.length).join(' '));
  check('each is tagged Built and opens its Drive file in a new tab', linked.every((l) => l.tag === 'Built' && l.links.length > 0 && l.links.every((a) => DRIVE.test(a.href) && a.target === '_blank' && /\d:\d\d$/.test(a.text))), JSON.stringify(linked[0]));
  check('nothing is tagged partly built', !/partly built/i.test(await page.evaluate(() => document.body.innerText)));

  // ── screens: read-only here, set on the screen itself ──
  check('a screen card has no answer buttons', (await page.locator('#screen-groups button').count()) === 0 && (await page.locator('#screens textarea').count()) === 0);
  const hrefs = await page.locator('[data-screen] a.go').evaluateAll((as) => as.map((a) => a.getAttribute('href')));
  check('every screen links to itself on the test site', hrefs.length === 27 && hrefs.slice().sort().join() === scr.features.flatMap((f) => f.screens).map((x) => scr.previewUrl + '/' + x.code).sort().join(), hrefs[0]);
  // critical first: marked in words, with one plain reason, before everything that is not
  const critScreens = scr.features.flatMap((f) => f.screens).filter((x) => x.critical);
  const shownCrit = await page.locator('[data-screen]').evaluateAll((els) => els.map((e) => e.dataset.critical === 'true'));
  const firstPlain = shownCrit.indexOf(false);
  check(`the ${critScreens.length} critical screens come first, each with a Critical badge and its reason`, shownCrit.filter(Boolean).length === critScreens.length && (firstPlain === -1 || shownCrit.slice(firstPlain).every((x) => !x)) && (await page.locator('[data-screen][data-critical="true"] .crit-badge').count()) === critScreens.length && (await page.locator('[data-screen][data-critical="true"] .crit-why').allInnerTexts()).every((t) => /^Needed by [A-Z][a-z]{2} \d{1,2}: /.test(t)));
  const critRows = data.cards.flatMap((c) => c.rows).filter((r) => r.critical);
  const rowOrder = await page.locator('[data-row]').evaluateAll((els) => els.map((e) => e.dataset.critical === 'true'));
  check(`the ${critRows.length} critical questions come first with a Critical badge; the rest follow`, rowOrder.filter(Boolean).length === critRows.length && (await page.locator('[data-row][data-critical="true"] .crit-badge').count()) === critRows.length && rowOrder.indexOf(true) === 0);
  // the film of the screen, beside the link that opens it: watching is the other way to review it
  const filmed = scr.features.flatMap((f) => f.screens).filter((x) => x.walk);
  const filmedByScreen = Object.fromEntries(scr.features.flatMap((f) => f.screens).filter((x) => x.walk).map((x) => [x.code, x.walk.url]));
  const films = await page.locator('[data-screen] a.see').evaluateAll((as) => as.map((a) => ({ screen: a.closest('[data-screen]').dataset.screen, href: a.getAttribute('href'), target: a.target, text: a.innerText.replace(/\s+/g, ' ').trim() })));
  check(`each screen with a film offers it, in a new tab, with its length (${filmed.length} of 27)`,
    films.length === filmed.length && films.every((f) => filmedByScreen[f.screen] === f.href && DRIVE.test(f.href) && f.target === '_blank' && /^Watch it \d+:\d\d$/.test(f.text)),
    films.length ? JSON.stringify(films[0]) : 'no screen carries a film');
  // A film of a screen says nothing about whether the thing is built, so it must never sit under
  // the Built badge: that badge belongs to the feature videos beside it, which are the claim.
  const underBuilt = await page.locator('[data-screen] a.see').evaluateAll((as) => as.filter((a) => a.closest('.vids')).length);
  check('the film of a screen sits outside the Built group', underBuilt === 0);
  // what the sign-off panel on the test site would save
  await api('POST', { id: 'S-A1', v: 'yes', by: 'Rustin' });
  await api('POST', { id: 'S-A5', v: 'change', n: 'The banner should say who to call, not only the date.', by: 'Rustin' });
  await api('POST', { id: 'S-B2', v: 'discuss', n: 'Should the time left count working days or calendar days?', by: 'Rustin' });
  await api('POST', { id: 'S-C8', v: 'discuss', n: '', by: 'Dan' });
  await api('POST', { id: 'A04', v: 'change', n: 'given per card on the earlier page' });
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForSelector('[data-screen="B2"][data-state="discuss"]');
  const sw = await text(page.locator('#where .panel').nth(1));
  check('the four counts: Signed off, Changes suggested, To discuss, Not reviewed', sw === 'Screens 4 of 27 reviewed 1 Signed off 1 Changes suggested 2 To discuss 23 Not reviewed', sw);
  const b2 = await text(page.locator('[data-screen="B2"]'));
  check('a Discuss given on the screen shows here, with who and what', /^B2 To discuss · [A-Z][a-z]{2} \d{1,2} Approvals waiting for me .* Rustin wants to talk this through Should the time left count working days or calendar days\? Open B2/.test(b2), b2);
  check('a change shows its words; a Discuss with no note says so', /Rustin asked for a change The banner should say who to call/.test(await text(page.locator('[data-screen="A5"]'))) && /Dan wants to talk this through No note left\./.test(await text(page.locator('[data-screen="C8"]'))) && /^A1 Signed off · /.test(await text(page.locator('[data-screen="A1"]'))));
  await page.locator('[data-sf="discuss"]').click();
  check('the screen chips filter the screens', (await page.locator('[data-screen]').evaluateAll((els) => els.map((e) => e.dataset.screen).join(','))) === 'B2,C8' && (await text(page.locator('#screen-chips'))) === 'All 27 Signed off 1 Changes suggested 1 To discuss 2 Not reviewed 23');
  await page.locator('[data-sf="all"]').click();

  // ── the store is the truth, on every device ──
  check('after a reload with this browser\'s copy wiped, the answers come back from the store', (await row(page, 'A01-3').getAttribute('data-state')) === 'change' && (await text(row(page, 'A01-3').locator('.q-note'))).includes('Off by default.') && (await row(page, 'A03-2').getAttribute('data-state')) === 'discuss' && (await row(page, a02.rows[a02.rows.length - 1].id).getAttribute('data-state')) === (a02.rows.length > 1 ? 'agree' : 'open'));
  check('an answer given per card on the earlier page is ignored', (await page.locator('[data-card="A04"] [data-row][data-state="open"]').count()) === data.cards.find((c) => c.id === 'A04').rows.length && (await text(card(page, 'A04').locator('.card-h .pill'))) === 'Waiting on you');

  // ── send ──
  await page.locator('#send-btn').click();
  await page.waitForFunction(() => /^Last sent /.test(document.getElementById('sent').textContent));
  const sub = (await full())._submission;
  check('Send records a summary of every answer', sub && sub.v === 'agree' && /A01-3|Should tenants be able to pay dues by default\? CHANGE — Off by default\./.test(sub.n) && /B2 Approvals waiting for me: To discuss \(Rustin\) — Should the time left/.test(sub.n) && /1 signed off · 1 changes suggested · 2 to discuss · 23 not reviewed/.test(sub.n), sub ? sub.n.split('\n').slice(-1)[0] : 'nothing sent');
  check('the summary names nothing internal', sub && !FORBIDDEN.test(sub.n), sub ? (FORBIDDEN.exec(sub.n) || [''])[0] : '');
  check('the page says when it was last sent', /^Last sent .* Sending again replaces it\.$/.test(await text(page.locator('#sent'))), await text(page.locator('#sent')));

  // ── no connection ──
  await page.route('**/api/answers', (r) => r.abort());
  await row(page, 'A06-1').locator('[data-mark="agree"]').click();
  await page.waitForFunction(() => document.querySelector('[data-status]').classList.contains('err'));
  check('with no connection the page says the answer is kept in this browser', (await text(page.locator('[data-status]'))) === 'Not saved yet: no connection. Your answers are kept in this browser and will be saved when it returns.' && !(await live())['A06-1'] && (await row(page, 'A06-1').getAttribute('data-state')) === 'agree');
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForSelector('[data-row="A06-1"][data-state="agree"]');
  await page.unroute('**/api/answers');
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await saved(page);
  check('it is saved when the connection returns, even after a reload', (await live())['A06-1'].v === 'agree');

  // ── the passphrase ──
  const asked = [];
  page.on('dialog', async (d) => { asked.push(d.type() + ': ' + d.message()); await d.accept('owners-only'); });
  await page.route('**/api/answers', async (r) => {
    const req = r.request();
    const key = req.method() === 'POST' ? (JSON.parse(req.postData() || '{}').key || '') : (req.headers()['x-edit-key'] || '');
    if (key !== 'owners-only') return r.fulfill({ status: 401, contentType: 'application/json', body: '{"error":"unauthorized"}' });
    return r.continue();
  });
  await row(page, 'A06-2').locator('[data-mark="agree"]').click();
  await saved(page);
  check('a protected store asks for the passphrase once, then saves', asked.length === 1 && asked[0] === 'prompt: This page is protected. Enter the passphrase you were given to save your answers.' && (await live())['A06-2'].v === 'agree', asked.join(' | '));
  await row(page, 'A07-1').locator('[data-mark="agree"]').click();
  await saved(page);
  check('and does not ask again', asked.length === 1 && (await live())['A07-1'].v === 'agree');
  await page.unroute('**/api/answers');
  await page.evaluate(() => localStorage.removeItem('hoahx-edit-key'));

  // ── readable, at a desk ──
  await row(page, 'A03-1').locator('[data-edit]').click();
  readable('1280px wide, with answers and a note box open', await measure(page));
  if (shots) await page.screenshot({ path: join(shots, 'page-1280.png'), fullPage: true });
  await page.keyboard.press('Escape');
  await desktop.close();

  // ── readable, on a phone ──
  const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  page = await openPage(phone, '/');
  await page.waitForSelector('[data-row="A01-3"][data-state="change"]');
  await row(page, 'A01-3').locator('[data-edit]').tap();
  await row(page, 'A05-1').locator('[data-toggle]').tap();
  readable('390px wide, with answers and a note box open', await measure(page));
  await page.locator('[data-qf="change"]').tap();
  readable('390px wide, filtered', await measure(page));
  if (shots) { await page.locator('[data-qf="all"]').tap(); await page.screenshot({ path: join(shots, 'page-390.png'), fullPage: true }); }
  await phone.close();

  // ── light only ──
  const dark = await browser.newContext({ viewport: { width: 1280, height: 900 }, colorScheme: 'dark' });
  page = await openPage(dark, '/');
  const look = await page.evaluate(() => ({ ground: getComputedStyle(document.body).backgroundColor, card: getComputedStyle(document.querySelector('.card')).backgroundColor, ink: getComputedStyle(document.body).color, scheme: getComputedStyle(document.documentElement).colorScheme }));
  check('a device set to dark still gets the light page', look.ground === 'rgb(233, 237, 243)' && look.card === 'rgb(255, 255, 255)' && look.ink === 'rgb(21, 26, 35)' && look.scheme === 'light', JSON.stringify(look));
  await dark.close();

  check('no error in the page or its console, in the whole pass', errors.filter((e) => !/Failed to load resource|net::ERR_FAILED|401/.test(e)).length === 0, errors.filter((e) => !/Failed to load resource|net::ERR_FAILED|401/.test(e)).slice(0, 3).join(' | '));
} catch (e) {
  failed += 1;
  console.log(`FAIL  the pass stopped: ${e.message.split('\n')[0]}`);
} finally {
  await browser.close();
}
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
