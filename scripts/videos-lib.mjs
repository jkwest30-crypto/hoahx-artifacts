// The video review: pure builders and guards shared by scripts/videos.mjs and the tests.
// Nothing here reads the network, Drive, or the clock unless it is passed in.
//
// Two pages read what this builds:
//   go-live/videos/data.json         the owners' list: only videos Jacob approved at their current recording
//   go-live/videos/review/all.json   Jacob's list: every recorded video, and what the owners currently have
//
// A video's identity is its two-digit number (`id`). Slugs and titles may change; the number never does.
// A recording is identified by its `commit`. Jacob's approval is of one recording: when the recorder
// writes a new commit for a video, his approval no longer applies until he approves again.

export const REVIEW_ROOT = 'hoahx-drive:HOAhx/video-review';
// The folder shared with the owners: only takes Jacob approved are ever copied in, over the same
// file name, so a link never changes. Kept in Jacob's Drive for now; it can be handed over later.
export const SHARED_DIR = 'Videos for the owners';
export const SHARED_ROOT = `hoahx-drive:HOAhx/${SHARED_DIR}`;
export const ID_RE = /^\d{2}$/;
export const REF_RE = /^V(\d{2})-N(\d{3})$/;

/** "V05-N004" for video 05, note 4. */
export function noteRef(vid, n) {
  return `V${vid}-N${String(n).padStart(3, '0')}`;
}

/** Drive's view link for a file id. */
export function driveView(id) {
  return id ? `https://drive.google.com/file/d/${id}/view` : '';
}

// Words an owner must never read on these pages, and the marks of the internal numbering.
const FORBIDDEN = [
  /\bStripe\b/i, /\bClaude\b/i, /\bAI\b/, /\bcustomers?\b/i, /\bworkshop\b/i, /\bregister(ed)?\b/i,
  /\bD-\d{3}\b/, /\bQ-[A-Z]+-\d+\b/, /\bemulator\b/i, /\bplaywright\b/i,
];
/** Every forbidden word or mark in a text, as found. */
export function findForbidden(text) {
  const out = [];
  for (const re of FORBIDDEN) {
    const g = new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g');
    for (const m of String(text || '').matchAll(g)) out.push(m[0]);
  }
  return out;
}

/** Checks the recorder's manifest and returns { videos, problems }. */
export function readManifest(manifest) {
  const problems = [];
  if (!manifest || manifest.schema !== 1 || !Array.isArray(manifest.videos)) {
    return { videos: [], problems: ['videos.json: expected { schema: 1, videos: [...] }'] };
  }
  const seen = new Set();
  const videos = [];
  for (const v of manifest.videos) {
    const where = `video ${v && v.id}`;
    if (!v || !ID_RE.test(String(v.id))) { problems.push(`${where}: id must be two digits`); continue; }
    if (seen.has(v.id)) { problems.push(`${where}: listed twice`); continue; }
    seen.add(v.id);
    for (const f of ['title', 'file', 'commit']) if (!v[f]) problems.push(`${where}: no ${f}`);
    if (!v.about) problems.push(`${where}: no about line`);
    videos.push({
      id: v.id, title: v.title || '', file: v.file || '', role: v.role || '', companionOf: v.companionOf || null,
      length: v.length || '', about: v.about || '', recordedAt: v.recordedAt || '', commit: v.commit || '',
      driveId: v.driveId || '', driveUrl: v.driveUrl || driveView(v.driveId),
    });
  }
  videos.sort((a, b) => a.id.localeCompare(b.id));
  return { videos, problems };
}

/**
 * Jacob's view of one video, given his sign-off record.
 *   'open'      not reviewed at this recording (never, or a new recording since)
 *   'approved'  approved at this recording
 *   'fix'       flagged at this recording
 */
export function signoffState(video, signoff) {
  if (!signoff || !signoff.status) return 'open';
  if (signoff.commit !== video.commit) return 'open';
  return signoff.status === 'approved' ? 'approved' : signoff.status === 'fix' ? 'fix' : 'open';
}

/**
 * What the owners' page should carry, and what has to be copied in Drive first.
 *
 * @param videos     manifest videos (readManifest)
 * @param signoffs   { "<id>": { status, commit } } from the store
 * @param previous   the currently published owners' data.json (or null)
 * @returns { entries, copies, changes }
 *   entries: the owners' list, before Drive links are filled in for new copies
 *   copies:  [{ id, file, fromId, commit }] takes to copy over the owners' folder/<file>
 *   changes: plain lines describing what moved
 *
 * Rules:
 *  - approved at the current recording  -> on the page at that recording (a copy if it is new there)
 *  - already on the page, and the current recording is not approved yet -> stays at the recording
 *    the owners have, marked updateComing when a newer one exists
 *  - already on the page, and Jacob flagged the very recording the owners have -> taken off
 *  - a video no longer in the manifest stays where it is (nothing is deleted from under the owners)
 */
export function planPublish(videos, signoffs, previous) {
  const prevById = new Map(((previous && previous.videos) || []).map((e) => [e.id, e]));
  const byId = new Map(videos.map((v) => [v.id, v]));
  const entries = [];
  const copies = [];
  const changes = [];
  const ids = [...new Set([...byId.keys(), ...prevById.keys()])].sort();
  for (const id of ids) {
    const v = byId.get(id);
    const prev = prevById.get(id);
    const s = (signoffs || {})[id];
    if (!v) { if (prev) entries.push(prev); continue; }
    const state = signoffState(v, s);
    const base = {
      id, title: v.title, role: v.role, companionOf: v.companionOf, length: v.length, about: v.about, file: v.file,
    };
    if (state === 'approved') {
      if (prev && prev.commit === v.commit) {
        entries.push({ ...prev, ...base, commit: v.commit, recordedAt: v.recordedAt, updateComing: false });
      } else {
        copies.push({ id, file: v.file, fromId: v.driveId, commit: v.commit });
        entries.push({ ...base, commit: v.commit, recordedAt: v.recordedAt, driveUrl: '', updateComing: false });
        changes.push(prev ? `${id} ${v.title}: new recording ${v.commit} replaces ${prev.commit}` : `${id} ${v.title}: added (recording ${v.commit})`);
      }
      continue;
    }
    if (!prev) continue;
    if (s && s.status === 'fix' && s.commit === prev.commit) {
      changes.push(`${id} ${prev.title}: taken off (you flagged the recording the owners have)`);
      continue;
    }
    const updateComing = v.commit !== prev.commit;
    if (updateComing && !prev.updateComing) changes.push(`${id} ${prev.title}: owners keep ${prev.commit}; a newer recording waits for your approval`);
    entries.push({ ...prev, updateComing });
  }
  return { entries, copies, changes };
}

/** The owners' published file. `updated` moves only when something an owner reads changed. */
export function buildOwnersData(entries, previous, today, waiting) {
  const clean = entries.map((e) => ({
    id: e.id, title: e.title, role: e.role, companionOf: e.companionOf || null, length: e.length, about: e.about,
    commit: e.commit, recordedAt: e.recordedAt, driveUrl: e.driveUrl, updateComing: !!e.updateComing,
  }));
  const body = { videos: clean, waiting };
  const same = previous && JSON.stringify({ videos: previous.videos, waiting: previous.waiting }) === JSON.stringify(body);
  return { schema: 1, updated: same ? previous.updated : today, ...body };
}

/** Jacob's published file: the whole manifest plus what the owners currently have. */
export function buildJacobData(videos, ownersData, today) {
  const onPage = new Map((ownersData.videos || []).map((e) => [e.id, e]));
  return {
    schema: 1, updated: today,
    videos: videos.map((v) => ({ ...v, owners: onPage.has(v.id) ? { commit: onPage.get(v.id).commit, updateComing: onPage.get(v.id).updateComing } : null })),
  };
}

/** Guards on everything an owner reads. Returns a list of problems. */
export function guardOwnersData(data) {
  const problems = [];
  for (const e of data.videos || []) {
    for (const f of ['title', 'about', 'role']) {
      const hit = findForbidden(e[f]);
      if (hit.length) problems.push(`video ${e.id} ${f}: ${hit.join(', ')}`);
    }
    if (!/^https:\/\/drive\.google\.com\/file\/d\/[\w-]+\/view$/.test(e.driveUrl || '')) problems.push(`video ${e.id}: no Drive link`);
  }
  return problems;
}

/** A screenshot's file name in Drive: the reference first, so a Drive search for it finds it. */
export function screenshotName(note, image) {
  const day = String(note.at || '').slice(0, 10);
  const who = note.side === 'jacob' ? 'jacob' : 'owner-' + (String(note.by || 'unknown').trim().split(/\s+/)[0].toLowerCase().replace(/[^a-z0-9]/g, '') || 'unknown');
  return `${note.ref}-${image.i}_${day}_${who}_${note.commit || 'unknown'}.jpg`;
}

/** The checks a Drive copy must pass before the full-size image leaves the store. */
export function verifyCopy(local, remote) {
  const problems = [];
  if (!remote) return ['the file is not in Drive'];
  if (remote.size !== local.size) problems.push(`size ${remote.size} in Drive, ${local.size} here`);
  if (remote.md5 && local.md5 && remote.md5 !== local.md5) problems.push('contents differ (md5)');
  if (!local.width || !local.height) problems.push('does not open as an image');
  else if (local.width !== local.expectW || local.height !== local.expectH) problems.push(`${local.width}×${local.height}, expected ${local.expectW}×${local.expectH}`);
  return problems;
}

/** Plain-text lines for one note, for the pull file and for `find`. */
export function describeNote(note, video) {
  const lines = [
    `${note.ref} · video ${note.vid}${video ? ' ' + video.title : ''} · ${note.side === 'jacob' ? 'Jacob' : note.by || 'an owner'} · ${String(note.at || '').slice(0, 16).replace('T', ' ')} · recording ${note.commit}`,
    `  ${String(note.text || '').replace(/\n/g, '\n  ')}`,
  ];
  if (video && video.driveUrl) lines.push(`  Video: ${video.driveUrl}`);
  for (const im of note.images || []) {
    lines.push(`  Screenshot ${im.i}: ${im.drive ? driveView(im.drive.id) + '  (' + im.drive.name + ')' : im.full ? 'full size still in the store; copied to Drive at the next pull' : 'full size never arrived (only the preview)'}`);
  }
  return lines.join('\n');
}
