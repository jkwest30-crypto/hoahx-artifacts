#!/usr/bin/env node
// The video review, from the command line. Run through the update-documentation skill.
//
//   node scripts/videos.mjs sync  [--dry-run] [--no-drive]   Jacob's approvals -> the owners' page files
//   node scripts/videos.mjs check                            guards on the committed files; no network
//   node scripts/videos.mjs pull  [--dry-run]                owners' and Jacob's notes -> the launch program,
//                                                            full-size screenshots -> Drive, checked, then dropped
//   node scripts/videos.mjs find  V05-N004                   everything about one note
//
// Options: --key <VIDEO_REVIEW_KEY> (or the env var; with neither, the key is read from the Netlify site's
//          environment through the Netlify CLI), --edit-key <DECISION_EDIT_KEY> if set on the site,
//          --site <url> (default the live site), --hoahx <path to the hoahx checkout>,
//          --any-branch (let sync write into a checkout that is not on main).
//
// sync never commits or pushes. It copies approved recordings into the shared Drive folder
// ("HOAhx/Videos for the owners/<file>", replacing the file of the same name so the owners' link does not change)
// and writes go-live/videos/data.json and go-live/videos/review/all.json.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  REVIEW_ROOT, SHARED_DIR, SHARED_ROOT, REF_RE, buildJacobData, findForbidden, buildOwnersData, describeNote, driveView, guardOwnersData,
  planPublish, readManifest, resolveReviewKey, screenshotName, verifyCopy,
} from './videos-lib.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const argv = process.argv.slice(2);
const cmd = argv[0] || 'sync';
const flag = (name) => argv.includes(`--${name}`);
const opt = (name, dflt) => { const i = argv.indexOf(`--${name}`); return i >= 0 ? argv[i + 1] : dflt; };

const SITE = (opt('site', process.env.VIDEOS_SITE || 'https://hoahx-requirements.netlify.app')).replace(/\/$/, '');
const HOAHX = path.resolve(opt('hoahx', process.env.HOAHX_DIR || path.join(root, '..', 'hoahx')));
const MANIFEST = path.join(HOAHX, 'docs/launch/videos/videos.json');
const LOCAL = path.join(HOAHX, 'docs/launch/videos/review-store');
const OWNERS_FILE = path.join(root, 'go-live/videos/data.json');
const JACOB_FILE = path.join(root, 'go-live/videos/review/all.json');
// The Netlify site that serves /api/videos (hoahx-requirements). Override with NETLIFY_SITE_ID.
const NETLIFY_SITE_ID = process.env.NETLIFY_SITE_ID || '04cef402-8aab-4a1d-b3a7-aaa4be99d643';
const EDIT_KEY = opt('edit-key', process.env.DECISION_EDIT_KEY || '');
const DRY = flag('dry-run');
const stamp = () => new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const today = () => new Date().toISOString().slice(0, 10);

function fail(msg) { console.error(`\n✗ ${msg}`); process.exit(1); }
const readJson = (f, dflt) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch (e) { return dflt; } };
const writeJson = (f, v) => { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, JSON.stringify(v, null, 2) + '\n'); };

// Reads VIDEO_REVIEW_KEY from the site's environment with the Netlify CLI, in this checkout's folder.
// Links the folder to the site first when it is not linked (that writes only the gitignored
// .netlify/state.json; no site setting changes). The CLI's own --site flag hangs, so the link is used.
// stdout is captured and parsed, never echoed; errors carry the CLI's stderr only.
function netlifyReviewKey() {
  const cli = (args) => {
    try {
      return execFileSync('netlify', args, { cwd: root, encoding: 'utf8', timeout: 90_000, stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (e) {
      if (e.code === 'ENOENT') throw new Error('the Netlify CLI is not installed (npm install -g netlify-cli, then netlify login)');
      const why = (e.stderr || '').toString().replace(/\u001b\[[0-9;]*m/g, '').trim().split('\n').slice(-3).join(' ');
      throw new Error(`netlify ${args[0]} failed${e.signal ? ` (${e.signal}, timed out?)` : ''}${why ? `: ${why}` : ''}. Is the CLI logged in (netlify login)?`);
    }
  };
  const statePath = path.join(root, '.netlify/state.json');
  const linked = readJson(statePath, {}).siteId;
  if (linked && linked !== NETLIFY_SITE_ID) throw new Error(`this folder is linked to another Netlify site (${linked}), not ${NETLIFY_SITE_ID}`);
  if (!linked) {
    console.log(`Linking ${root} to the Netlify site ${NETLIFY_SITE_ID} (local .netlify/state.json only).`);
    cli(['link', '--id', NETLIFY_SITE_ID]);
    if (readJson(statePath, {}).siteId !== NETLIFY_SITE_ID) throw new Error('netlify link did not link this folder');
  }
  const out = cli(['env:get', 'VIDEO_REVIEW_KEY', '--json', '--context', 'production', '--scope', 'functions']);
  let parsed; try { parsed = JSON.parse(out); } catch (e) { throw new Error('netlify env:get did not answer JSON'); }
  return (parsed && typeof parsed.VIDEO_REVIEW_KEY === 'string') ? parsed.VIDEO_REVIEW_KEY : '';
}

let KEY = '';
async function reviewKey() {
  if (KEY) return KEY;
  try {
    const got = await resolveReviewKey({ flag: opt('key', ''), env: process.env.VIDEO_REVIEW_KEY || '', netlify: netlifyReviewKey });
    console.log(`Jacob's passphrase: from ${got.source}.`);
    KEY = got.key;
  } catch (e) { fail(e.message); }
  return KEY;
}

async function api(query, body) {
  const key = await reviewKey();
  const url = `${SITE}/api/videos${query || ''}`;
  const headers = { 'Content-Type': 'application/json', 'x-review-key': key };
  if (EDIT_KEY) headers['x-edit-key'] = EDIT_KEY;
  const res = await fetch(url, body ? { method: 'POST', headers, body: JSON.stringify(body) } : { headers });
  const text = await res.text();
  let data; try { data = JSON.parse(text); } catch (e) { data = { error: text.slice(0, 200) }; }
  if (!res.ok) fail(`${body ? 'POST' : 'GET'} ${url} -> ${res.status} ${data.error || ''}`);
  return data;
}

function rclone(args, { quiet } = {}) {
  try {
    return execFileSync('rclone', args, { encoding: 'utf8', env: { ...process.env, RCLONE_LOG_LEVEL: 'ERROR' }, stdio: ['ignore', 'pipe', quiet ? 'ignore' : 'pipe'] });
  } catch (e) {
    fail(`rclone ${args.join(' ')} failed:\n${(e.stderr || e.message || '').toString().trim()}`);
  }
}
const lsjson = (target, extra = []) => JSON.parse(rclone(['lsjson', '--hash', ...extra, target]) || '[]');

// ---- sync --------------------------------------------------------------------------------------
// sync writes go-live/ files that are then committed from this checkout. Refuse to write them into a
// checkout that is neither on main nor exactly at origin/main: another session's unpublished work may
// sit on that branch (as on publish/films). Read-only commands and --dry-run work on any branch.
function assertPublishableCheckout() {
  if (DRY || flag('any-branch')) return;
  const git = (...a) => execFileSync('git', ['-C', root, ...a], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  let branch, head, main;
  try { branch = git('rev-parse', '--abbrev-ref', 'HEAD'); head = git('rev-parse', 'HEAD'); } catch (e) { return; }
  try { main = git('rev-parse', 'origin/main'); } catch (e) { main = ''; }
  if (branch === 'main' || head === main) return;
  fail(`This checkout (${root}) is on "${branch}", which is not main and not at origin/main: sync would write the owners' files into it.\n` +
    `  Run it from a checkout at origin/main (git -C ${root} fetch origin, then\n` +
    `  git -C ${root} worktree add --detach ../hoahx-artifacts-videos origin/main and run it there),\n` +
    '  or pass --any-branch if writing into this branch is intended. pull, find, check and --dry-run work on any branch.');
}

async function sync() {
  assertPublishableCheckout();
  const manifest = readJson(MANIFEST, null);
  if (!manifest) fail(`No recorder manifest at ${MANIFEST}.`);
  const { videos, problems } = readManifest(manifest);
  if (problems.length) fail(`The recorder's videos.json has problems:\n  ${problems.join('\n  ')}`);

  const store = await api('?side=jacob');
  if (!DRY) writeJson(path.join(LOCAL, `store-${stamp()}.json`), store);
  const previous = readJson(OWNERS_FILE, null);
  const { entries, copies, changes } = planPublish(videos, store.jacob || {}, previous);

  if (copies.length && flag('no-drive')) fail(`--no-drive, but ${copies.length} approved recording(s) need copying: ${copies.map((c) => c.id).join(', ')}.`);
  if (copies.length) {
    // One listing of the whole HOAhx tree finds each approved take by its Drive id, wherever the recorder put it.
    // The recorder uploads to pending-recordings; older takes may still sit in demo-videos' dated folders.
    const all = [
      ...lsjson(`${REVIEW_ROOT}/pending-recordings`, ['--files-only']).map((f) => ({ ...f, Path: `video-review/pending-recordings/${f.Path}` })),
      ...lsjson('hoahx-drive:HOAhx/demo-videos', ['-R', '--files-only']).map((f) => ({ ...f, Path: `demo-videos/${f.Path}` })),
      ...lsjson(SHARED_ROOT, ['--files-only']).map((f) => ({ ...f, Path: `${SHARED_DIR}/${f.Path}` })),
    ];
    const byDriveId = new Map(all.map((f) => [f.ID, f]));
    const sharedNow = () => new Map(lsjson(SHARED_ROOT, ['--files-only', '--max-depth', '1']).map((f) => [f.Name, f]));
    let shared = sharedNow();
    for (const c of copies) {
      const src = byDriveId.get(c.fromId);
      if (!src) fail(`Video ${c.id}: the recording in videos.json (Drive id ${c.fromId}) is not in HOAhx/. Re-upload it, or wait for the recorder.`);
      const target = `${SHARED_ROOT}/${c.file}`;
      const have = shared.get(c.file);
      const same = have && have.Size === src.Size && have.Hashes && src.Hashes && have.Hashes.md5 === src.Hashes.md5;
      if (!same) {
        console.log(`${DRY ? '[dry run] would copy' : 'Copying'} ${src.Path} -> ${SHARED_DIR}/${c.file}`);
        if (!DRY) { rclone(['copyto', `hoahx-drive:HOAhx/${src.Path}`, target]); shared = sharedNow(); }
      }
      const now = DRY ? (have || { ID: 'DRY-RUN' }) : shared.get(c.file);
      if (!DRY && !(now && now.Hashes && src.Hashes && now.Hashes.md5 === src.Hashes.md5)) fail(`Video ${c.id}: the copy in the owners' folder does not match the approved recording.`);
      const e = entries.find((x) => x.id === c.id);
      e.driveUrl = driveView(now.ID);
    }
  }

  const waiting = videos.filter((v) => !entries.some((e) => e.id === v.id && e.commit === v.commit)).length;
  const owners = buildOwnersData(entries, previous, today(), waiting);
  const guard = DRY ? guardOwnersData({ videos: owners.videos.filter((e) => e.driveUrl !== driveView('DRY-RUN')) }) : guardOwnersData(owners);
  if (guard.length) fail(`The owners' page would carry:\n  ${guard.join('\n  ')}\nFix the wording in the recorder's storyboard, never the guard.`);
  const jacob = buildJacobData(videos, owners, today());

  console.log(`\nOwners' page: ${owners.videos.length} video(s); ${waiting} recorded video(s) not with them at their current recording.`);
  if (changes.length) console.log(changes.map((c) => `  · ${c}`).join('\n')); else console.log('  · no change for the owners');
  console.log(`  · "Last updated" ${owners.updated === (previous && previous.updated) ? 'stays' : 'moves to'} ${owners.updated}`);
  if (DRY) { console.log('\nDry run: nothing written.'); return; }
  writeJson(OWNERS_FILE, owners);
  writeJson(JACOB_FILE, jacob);
  console.log(`\nWrote go-live/videos/data.json and go-live/videos/review/all.json. Nothing committed or pushed.`);
}

// ---- check -------------------------------------------------------------------------------------
function check() {
  const owners = readJson(OWNERS_FILE, null);
  const jacob = readJson(JACOB_FILE, null);
  const problems = [];
  if (!owners) problems.push('go-live/videos/data.json is missing or not JSON');
  if (!jacob) problems.push('go-live/videos/review/all.json is missing or not JSON');
  if (owners) problems.push(...guardOwnersData(owners));
  // Everything an owner's browser loads from go-live/videos/ (the section on /answers included), with
  // code comments removed: the excluded words, "register", and the internal numbering.
  const ownerFiles = ['go-live/videos/index.html', 'go-live/videos/videos.js', 'go-live/videos/videos.css', 'go-live/videos/answers-section.js', 'go-live/videos/watched.js', 'go-live/videos/watched.css', 'go-live/videos/data.json'];
  for (const f of ownerFiles) {
    const text = fs.readFileSync(path.join(root, f), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1').replace(/<!--[\s\S]*?-->/g, '');
    const hit = findForbidden(text);
    if (hit.length) problems.push(`${f}: ${[...new Set(hit)].join(', ')}`);
  }
  if (problems.length) fail(`check:videos found:\n  ${problems.join('\n  ')}`);
  console.log(`check:videos: ok (${owners.videos.length} video(s) on the owners' page).`);
}

// ---- pull --------------------------------------------------------------------------------------
function localFacts(file) {
  const buf = fs.readFileSync(file);
  let width = 0, height = 0;
  try {
    const out = execFileSync('sips', ['-g', 'pixelWidth', '-g', 'pixelHeight', file], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    width = +(/pixelWidth: (\d+)/.exec(out) || [])[1] || 0;
    height = +(/pixelHeight: (\d+)/.exec(out) || [])[1] || 0;
  } catch (e) { /* not an image: width stays 0 and the check refuses it */ }
  return { size: buf.length, md5: crypto.createHash('md5').update(buf).digest('hex'), width, height };
}

async function pull() {
  const store = await api('?side=jacob');
  const manifest = readManifest(readJson(MANIFEST, { schema: 1, videos: [] })).videos;
  const owners = readJson(OWNERS_FILE, { videos: [] });
  const videoFor = (vid) => owners.videos.find((v) => v.id === vid) || manifest.find((v) => v.id === vid);
  const shotsDir = path.join(LOCAL, 'screenshots');
  let moved = 0; const kept = [];

  for (const note of store.notes) {
    for (const im of note.images) {
      if (!im.full || im.drive) continue;
      const name = screenshotName(note, im);
      const local = path.join(shotsDir, name);
      if (DRY) { console.log(`[dry run] would move ${name}`); continue; }
      const got = await api(`?side=jacob&image=${note.ref}-${im.i}`);
      fs.mkdirSync(shotsDir, { recursive: true });
      fs.writeFileSync(local, Buffer.from(got.data, 'base64'));
      const facts = localFacts(local);
      const target = `${REVIEW_ROOT}/screenshots/${note.vid}/${name}`;
      rclone(['copyto', local, target]);
      const [remote] = lsjson(target).filter((f) => !f.IsDir);
      // The note carries the full-size copy's width and height, as the browser made it.
      const problems = verifyCopy({ ...facts, expectW: im.w, expectH: im.h },
        remote && { size: remote.Size, md5: remote.Hashes && remote.Hashes.md5 });
      if (problems.length) { kept.push(`${name}: ${problems.join('; ')} (left in the store)`); continue; }
      await api('', { action: 'moved', ref: note.ref, i: im.i, drive: { id: remote.ID, name } });
      im.drive = { id: remote.ID, name }; im.full = false;
      moved += 1;
    }
  }

  const fresh = await api('?side=jacob');
  const lines = [`# Video review notes, pulled ${new Date().toISOString().slice(0, 16).replace('T', ' ')}`, ''];
  const ids = [...new Set([...Object.keys(fresh.owners), ...Object.keys(fresh.jacob || {}), ...fresh.notes.map((n) => n.vid)])].sort();
  for (const vid of ids) {
    const v = videoFor(vid);
    const o = fresh.owners[vid]; const j = (fresh.jacob || {})[vid];
    lines.push(`## ${vid} · ${v ? v.title : '(not in the manifest)'}`);
    lines.push(`- Jacob: ${j ? `${j.status || 'cleared'} at ${j.commit}` : 'not reviewed'}`);
    lines.push(`- Owners: ${o ? `${o.status || 'cleared'} at ${o.commit}${o.by ? ' by ' + o.by : ''}` : 'not answered'}`);
    for (const n of fresh.notes.filter((x) => x.vid === vid)) lines.push('', '```', describeNote(n, v), '```');
    lines.push('');
  }
  const out = path.join(LOCAL, `notes-${today()}.md`);
  if (!DRY) { writeJson(path.join(LOCAL, `store-${stamp()}.json`), fresh); fs.writeFileSync(out, lines.join('\n')); }
  console.log(`\n${moved} screenshot(s) moved to Drive and checked; the full-size copies left the store, the previews stay.`);
  if (kept.length) console.log(`Not moved:\n  ${kept.join('\n  ')}`);
  console.log(`${fresh.notes.filter((n) => n.side === 'owners').length} owner note(s), ${fresh.notes.filter((n) => n.side === 'jacob').length} of yours.${DRY ? '' : ` Written to ${path.relative(HOAHX, out)}.`}`);
}

// ---- find --------------------------------------------------------------------------------------
async function find() {
  const ref = String(argv[1] || '').toUpperCase();
  if (!REF_RE.test(ref)) fail('Usage: videos.mjs find V05-N004');
  const store = await api('?side=jacob');
  const note = store.notes.find((n) => n.ref === ref);
  if (!note) fail(`No note ${ref} in the store.`);
  const owners = readJson(OWNERS_FILE, { videos: [] });
  const v = owners.videos.find((x) => x.id === note.vid) || readManifest(readJson(MANIFEST, { schema: 1, videos: [] })).videos.find((x) => x.id === note.vid);
  console.log(describeNote(note, v));
  if (v && v.commit && v.commit !== note.commit) console.log(`  (left on recording ${note.commit}; the video is now at ${v.commit})`);
}

const run = { sync, check, pull, find }[cmd];
if (!run) fail(`Unknown command "${cmd}". Use sync, check, pull or find.`);
await run();
