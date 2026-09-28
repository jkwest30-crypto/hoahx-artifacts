// The hub's live list: what is in the shared Google Drive folder, read on request.
//
// People add to the hub in Drive, never on the page:
//   a document     put it (or a shortcut to it) in a folder      Owners' hub / Product / Pricing / <file>
//   a web address  add a row to the sheet named "Hub links"      Section | Group | Title | Link | Description
//   a new group    make a folder inside a section's folder
//   the title      rename the file      the description: the file's Description in Drive's details pane
//
//   GET /api/hub  -> { configured: true, fetched, sections: [{ name, folder, groups: [{ name, folder, rows }] }], skipped }
//                    a row is { k, t, d, href, by?, date? }, the shape go-live/hub/data.json uses
//                    503 { configured: false } until the three settings below exist
//                    502 { error } when Drive does not answer; the page then shows its published list alone
//
// Settings (Netlify, scope Functions):
//   HUB_DRIVE_FOLDER   the id of the top folder
//   HUB_GOOGLE_EMAIL   the service account's address; the folder is shared with it as Viewer
//   HUB_GOOGLE_KEY     that account's private key (the "private_key" of its JSON key file)
//
// Read-only: the account is asked for drive.readonly and this file never writes to Drive.
// Anyone who can open the hub sees the title of every file in those folders, whether or not
// they can open the file. Drive's own sharing still decides who can read it.

const crypto = require('crypto');

const TTL_MS = 5 * 60 * 1000;
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const DRIVE_URL = 'https://www.googleapis.com/drive/v3/files';
const SCOPE = 'https://www.googleapis.com/auth/drive.readonly';
const FOLDER = 'application/vnd.google-apps.folder';
const SHORTCUT = 'application/vnd.google-apps.shortcut';
const SHEET = 'application/vnd.google-apps.spreadsheet';
const LINKS_SHEET = /^hub links$/i;
const LOOSE_GROUP = 'Other';
const TITLE_MAX = 90;
const TEXT_MAX = 160;
const FIELDS = 'nextPageToken,files(id,name,mimeType,description,modifiedTime,owners(displayName),shortcutDetails(targetId,targetMimeType))';
// Drive shows an account's own display name. These are the ones that are not a person's name.
const PEOPLE = { jkwest30: 'Jacob' };

let cache = null; // { key, at, body }

function json(body, status, maxAge) {
  return {
    statusCode: status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': maxAge ? `public, max-age=${maxAge}` : 'no-store' },
    body: JSON.stringify(body),
  };
}

function settings(env) {
  return {
    folder: (env.HUB_DRIVE_FOLDER || '').trim(),
    email: (env.HUB_GOOGLE_EMAIL || '').trim(),
    // A key pasted into a settings field keeps its line breaks as the two characters \n.
    key: (env.HUB_GOOGLE_KEY || '').replace(/\\n/g, '\n').trim(),
  };
}

/** Which badge a file gets on the page. Pure. */
function kindOf(mime) {
  const m = String(mime || '');
  if (m === FOLDER) return 'folder';
  if (m === 'application/pdf') return 'pdf';
  if (m.startsWith('video/')) return 'video';
  if (m === SHEET || /spreadsheet|ms-excel|text\/csv/.test(m)) return 'sheet';
  if (m === 'application/vnd.google-apps.presentation' || /presentation|ms-powerpoint/.test(m)) return 'slides';
  if (m === 'application/vnd.google-apps.document' || /wordprocessing|msword|text\/plain|text\/markdown|rtf/.test(m)) return 'doc';
  return 'file';
}

/** The address that opens a Drive file. Pure. */
function linkFor(id, mime) {
  const safe = encodeURIComponent(id);
  if (mime === FOLDER) return `https://drive.google.com/drive/folders/${safe}`;
  if (mime === 'application/vnd.google-apps.document') return `https://docs.google.com/document/d/${safe}/edit`;
  if (mime === SHEET) return `https://docs.google.com/spreadsheets/d/${safe}/edit`;
  if (mime === 'application/vnd.google-apps.presentation') return `https://docs.google.com/presentation/d/${safe}/edit`;
  return `https://drive.google.com/file/d/${safe}/view`;
}

function clip(text, max) {
  const s = String(text || '').replace(/\s+/g, ' ').trim();
  return s.length > max ? `${s.slice(0, max - 1).trimEnd()}…` : s;
}

/** "Pricing model.xlsx" reads "Pricing model"; a Google file has no extension to drop. Pure. */
function titleOf(name) {
  return clip(String(name || '').replace(/\.[A-Za-z0-9]{2,5}$/, ''), TITLE_MAX) || 'Untitled';
}

function personOf(displayName) {
  const raw = String(displayName || '').trim();
  if (!raw) return '';
  if (PEOPLE[raw.toLowerCase()]) return PEOPLE[raw.toLowerCase()];
  const first = raw.split(/\s+/)[0];
  return clip(first.charAt(0).toUpperCase() + first.slice(1), 40);
}

/** One Drive file as a row of the page. A shortcut points at its target. Pure. */
function rowFrom(file) {
  const isShortcut = file.mimeType === SHORTCUT && file.shortcutDetails && file.shortcutDetails.targetId;
  const id = isShortcut ? file.shortcutDetails.targetId : file.id;
  const mime = isShortcut ? file.shortcutDetails.targetMimeType : file.mimeType;
  const row = { k: kindOf(mime), t: titleOf(file.name), d: clip(file.description, TEXT_MAX), href: linkFor(id, mime) };
  // A shortcut's own owner and date say who filed it and when, not who keeps the document.
  if (!isShortcut) {
    const by = personOf(file.owners && file.owners[0] && file.owners[0].displayName);
    if (by) row.by = by;
    if (/^\d{4}-\d{2}-\d{2}/.test(file.modifiedTime || '')) row.date = file.modifiedTime.slice(0, 10);
  }
  return row;
}

function newestFirst(a, b) {
  if ((a.date || '') !== (b.date || '')) return (a.date || '') < (b.date || '') ? 1 : -1;
  return a.t.localeCompare(b.t);
}

/** Text with commas, quotes and line breaks inside quoted cells. Pure. */
function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;
  const s = String(text || '').replace(/^\uFEFF/, '');
  for (let i = 0; i < s.length; i += 1) {
    const c = s[i];
    if (quoted) {
      if (c === '"' && s[i + 1] === '"') { cell += '"'; i += 1; } else if (c === '"') quoted = false; else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { row.push(cell); cell = ''; } else if (c === '\n' || c === '\r') {
      if (c === '\r' && s[i + 1] === '\n') i += 1;
      row.push(cell); rows.push(row); row = []; cell = '';
    } else cell += c;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

/**
 * The rows of the "Hub links" sheet, checked. Pure.
 * Returns { links: [{ section, group, row }], skipped: [{ line, why }] }.
 */
function readLinks(csv) {
  const table = parseCsv(csv);
  const out = { links: [], skipped: [] };
  if (!table.length) return out;
  const head = table[0].map((h) => h.trim().toLowerCase());
  const at = (name) => head.indexOf(name);
  const need = ['section', 'group', 'title', 'link'];
  const missing = need.filter((n) => at(n) === -1);
  if (missing.length) {
    out.skipped.push({ line: 1, why: `the sheet's first row must name the columns Section, Group, Title, Link, Description; missing: ${missing.join(', ')}` });
    return out;
  }
  table.slice(1).forEach((cells, i) => {
    const line = i + 2;
    const get = (name) => (at(name) === -1 ? '' : String(cells[at(name)] || '').trim());
    const section = get('section'); const group = get('group'); const title = get('title'); const href = get('link');
    if (!section && !group && !title && !href) return; // an empty line
    if (!title) { out.skipped.push({ line, why: 'no title' }); return; }
    if (!section) { out.skipped.push({ line, why: `"${clip(title, 40)}" names no section` }); return; }
    if (!/^https:\/\/[^\s"'<>]+$/.test(href)) { out.skipped.push({ line, why: `"${clip(title, 40)}" needs a link that starts with https://` }); return; }
    const isDrive = /^https:\/\/(docs|drive)\.google\.com\//.test(href);
    const kind = !isDrive ? 'page'
      : /\/document\//.test(href) ? 'doc'
        : /\/spreadsheets\//.test(href) ? 'sheet'
          : /\/presentation\//.test(href) ? 'slides'
            : /\/folders\//.test(href) ? 'folder' : 'file';
    out.links.push({ section, group: group || LOOSE_GROUP, row: { k: kind, t: clip(title, TITLE_MAX), d: clip(get('description'), TEXT_MAX), href } });
  });
  return out;
}

const same = (a, b) => String(a).trim().toLowerCase() === String(b).trim().toLowerCase();

/** Puts the sheet's links into the sections the folders made. A link to a section that does not exist is skipped. Pure. */
function placeLinks(sections, read) {
  const skipped = read.skipped.slice();
  read.links.forEach((l, i) => {
    const section = sections.find((s) => same(s.name, l.section));
    if (!section) { skipped.push({ line: null, why: `"${l.row.t}" names the section "${clip(l.section, 40)}", which is not a folder` }); return; }
    let group = section.groups.find((g) => same(g.name, l.group));
    if (!group) { group = { name: clip(l.group, 60), folder: null, rows: [] }; section.groups.push(group); }
    if (group.rows.some((r) => r.href === l.row.href)) return; // the same address twice
    group.rows.push(Object.assign({ order: i }, l.row));
  });
  return skipped;
}

function signedRequest(email, key, now) {
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const head = b64({ alg: 'RS256', typ: 'JWT' });
  const claim = b64({ iss: email, scope: SCOPE, aud: TOKEN_URL, iat: now, exp: now + 600 });
  const signature = crypto.createSign('RSA-SHA256').update(`${head}.${claim}`).sign(key).toString('base64url');
  return `${head}.${claim}.${signature}`;
}

async function google(url, init, what) {
  const res = await fetch(url, init);
  // Only the status goes into the message: a body from Google can echo what was sent.
  if (!res.ok) throw new Error(`${what}: Google answered ${res.status}`);
  return res;
}

async function tokenFor(cfg) {
  let assertion;
  try { assertion = signedRequest(cfg.email, cfg.key, Math.floor(Date.now() / 1000)); } catch (e) { throw new Error('the key in HUB_GOOGLE_KEY is not a private key'); }
  const res = await google(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `grant_type=${encodeURIComponent('urn:ietf:params:oauth:grant-type:jwt-bearer')}&assertion=${assertion}`,
  }, 'signing in');
  return (await res.json()).access_token;
}

async function children(id, token) {
  const files = [];
  let page = '';
  do {
    const q = encodeURIComponent(`'${id.replace(/['\\]/g, '')}' in parents and trashed = false`);
    const url = `${DRIVE_URL}?q=${q}&fields=${encodeURIComponent(FIELDS)}&pageSize=200&orderBy=name&supportsAllDrives=true&includeItemsFromAllDrives=true${page ? `&pageToken=${encodeURIComponent(page)}` : ''}`;
    const body = await (await google(url, { headers: { Authorization: `Bearer ${token}` } }, 'listing a folder')).json();
    files.push(...(body.files || []));
    page = body.nextPageToken || '';
  } while (page && files.length < 1000);
  return files;
}

async function readDrive(cfg) {
  const token = await tokenFor(cfg);
  const top = await children(cfg.folder, token);
  const sections = await Promise.all(top.filter((f) => f.mimeType === FOLDER).map(async (sf) => {
    const kids = await children(sf.id, token);
    const groups = await Promise.all(kids.filter((f) => f.mimeType === FOLDER).map(async (gf) => ({
      name: clip(gf.name, 60),
      folder: linkFor(gf.id, FOLDER),
      rows: (await children(gf.id, token)).map(rowFrom).sort(newestFirst),
    })));
    const loose = kids.filter((f) => f.mimeType !== FOLDER).map(rowFrom).sort(newestFirst);
    if (loose.length) groups.push({ name: LOOSE_GROUP, folder: null, rows: loose });
    return { name: clip(sf.name, 60), folder: linkFor(sf.id, FOLDER), groups };
  }));
  // Files beside the section folders are the hub's own (the links sheet, the how-to); they are not listed.
  const sheet = top.find((f) => f.mimeType === SHEET && LINKS_SHEET.test(f.name.trim()));
  let skipped = [];
  if (sheet) {
    const csv = await (await google(`${DRIVE_URL}/${encodeURIComponent(sheet.id)}/export?mimeType=${encodeURIComponent('text/csv')}`, { headers: { Authorization: `Bearer ${token}` } }, 'reading the links sheet')).text();
    skipped = placeLinks(sections, readLinks(csv));
  }
  sections.forEach((s) => s.groups.forEach((g) => g.rows.forEach((r) => { delete r.order; })));
  return { configured: true, fetched: new Date().toISOString(), sections, skipped };
}

exports.kindOf = kindOf;
exports.linkFor = linkFor;
exports.titleOf = titleOf;
exports.rowFrom = rowFrom;
exports.parseCsv = parseCsv;
exports.readLinks = readLinks;
exports.placeLinks = placeLinks;

exports.handler = async (event) => {
  if (event.httpMethod !== 'GET') return json({ error: 'The hub is read-only' }, 405);
  const cfg = settings(process.env);
  if (!cfg.folder || !cfg.email || !cfg.key) return json({ configured: false }, 503);
  const key = `${cfg.folder}|${cfg.email}`;
  if (cache && cache.key === key && Date.now() - cache.at < TTL_MS) return json(cache.body, 200, 60);
  try {
    const body = await readDrive(cfg);
    cache = { key, at: Date.now(), body };
    return json(body, 200, 60);
  } catch (e) {
    // A list a few minutes old is better than none.
    if (cache && cache.key === key) return json(cache.body, 200, 60);
    return json({ configured: true, error: 'The Drive folder could not be read', detail: String(e.message || '').slice(0, 200) }, 502);
  }
};
