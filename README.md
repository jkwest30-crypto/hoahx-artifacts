# hoahx-artifacts

Published HOAhx go-live artifacts, deployed by Netlify from this repository's `main` branch to
https://hoahx-requirements.netlify.app/. The site's root is the **HOAhx Decision Register**, the
owners' checklist of the rules the platform applies by default.
`/workflow-map` is the **HOAhx Workflow Map**: every workflow by the person who uses it, with the
exact steps and the handoffs between roles. `/design/` is the **HOAhx Design Reference** for the
design work: the fixed stack, the tokens, the components as they ship, the layout system, and the
screens in build order, with `tokens.json`, `DESIGN_BRIEF.md`, and `prompt-preamble.md` downloadable
beside it.

## How the register is kept current

The page is **generated**; it is never edited by hand. The text of every decision (question, why,
today, planned, options, which are money-and-enforcement, which are **Planned**) comes from the
launch program's `docs/launch/decisions.md` in the HOAhx repo, which is the source of truth. The
owners' **marks and notes** live in a shared store on the Netlify site (Netlify Blobs) and are
never part of this repo.

On the page the `Planned:` field of an entry is labeled **Proposed**: what the launch build will do unless the owners say otherwise (Keep as-is means proceed with it). **Planned** is the state that means a decision is made and in the build. It is set only by the
build, from an entry's recorded Answer and Answered date in `decisions.md`; nobody can click it.
The owners' Keep as-is / Change / Discuss marks and their notes are the input: they are pulled,
recorded with `/decide` (which rewrites the entry's Planned line to say what was decided), and the
next build marks the item Planned. The headline count on the page counts Planned items only. On a
Planned item the Keep button is hidden; a Change or Discuss saved after the planned date reopens it
(shown as "Reopened", counted under that mark until it is re-recorded), while a mark saved on or
before that date is shown as the input that led to the record.

```
decisions.md  ──build──▶  go-live/decision-register/decision-register.html  ──push main──▶  Netlify
     ▲                                                                                        │
     └──────────── /decide ◀── register-store/export-*.md ◀──pull────────── /api/decisions ◀──┘
```

### Publish a change to the decisions (text, new items, answered flags)

```bash
npm run build:register -- --source ../hoahx/docs/launch/decisions.md
```

The build refuses to write unless all of this holds:

1. `decisions.md` parses: every entry has Area, Why, Today the platform, Question, Answer, Answered;
   ids (`D-###`) and codes (`Q-AREA-n`) are unique; every entry sits under an `## NN · Area` header.
2. The live shared store was fetched and **snapshotted** to `../hoahx/docs/launch/register-store/`
   (`store-YYYYMMDD-HHMMSS.json`), so every mark and note is on disk before the page changes.
3. **No live mark or note points at an id the new page lacks.** D-numbers are permanent (a new
   decision gets the next number; nothing is renumbered), so this only trips if an entry was removed;
   the build lists the stranded ids and stops. `--allow-orphans` overrides; the snapshot keeps them.
4. The page contains none of the words the owner-facing documents exclude.

Then review the diff, commit, and push `main` (or open a PR and merge it); Netlify deploys on push.
`npm run check:register` runs the same checks and writes nothing. `--offline` skips the store check
and says so; use it only when the site is unreachable and you accept the risk.

### Pull the owners' marks and notes

```bash
npm run pull:register -- --source ../hoahx/docs/launch/decisions.md
```

Writes a snapshot of the whole store and `register-store/export-YYYY-MM-DD.md` with each marked or
noted decision as `### D-### · Q-ID` / `Mark:` / `Note:` blocks, the shape the launch program's
`/decide` skill applies to `decisions.md`. Items that changed since the previous snapshot are
flagged; `--all` exports everything. It never writes to the store.

### Try it locally

```bash
node scripts/dev-register.mjs            # http://localhost:8788, in-memory store, nothing shared
DECISION_EDIT_KEY=secret node scripts/dev-register.mjs   # exercise the passphrase gate
```

## The shared store (`netlify/functions/decisions.js`)

- `GET /api/decisions` returns every live mark and note as `{ "D-049": { v, n, code, updatedAt } }`;
  `?full=1` also returns cleared records and each record's `history`.
- `POST /api/decisions` with `{ id, v, n, code }` saves one decision. **One blob per decision**
  (`items/D-049`), so two owners saving different items at the same moment can never overwrite each
  other. **Nothing is deleted:** clearing a mark or emptying a note writes an empty record and pushes
  the previous state onto that record's `history` (last 40 states), so a mistaken clear loses nothing.
- If `DECISION_EDIT_KEY` is set in the site's environment variables, every read and write must carry
  it (`x-edit-key` header, or `key` in a POST body). The page asks for it once and remembers it in the
  browser. Leave it unset and anyone with the URL can read and save. The repo is public; set the key.
- If Netlify's automatic Blobs credentials fail, set `NETLIFY_BLOBS_TOKEN` (a personal access token);
  `SITE_ID` is provided by Netlify.

The page itself keeps a copy of the last synced store and of any save the server has not confirmed
(`localStorage`), replays unconfirmed saves on the next load or when the browser comes back online,
and sends a keep-alive request for a note still being typed when the tab is closed.

## The workflow map

`go-live/workflow-map/workflow-map.html` is a copy of the HOAhx repo's `workflow-map.html`, whose
data (`workflow-map.json`) is embedded there by that repo's `scripts/build-workflow-map.cjs`. It is
served at https://hoahx-requirements.netlify.app/workflow-map. To publish a new version after the
map changes in the HOAhx repo:

```bash
npm run publish:workflow-map -- --source ../hoahx/workflow-map.html
```

The script refuses to write if the page has no embedded data, links to a file that is not on this
site, or contains a word the owner-facing documents exclude. Then commit and push `main` (or open a
PR and merge it); Netlify deploys on push. The page is static: no shared store, no passphrase.
`npm run check:workflow-map` runs the same checks and writes nothing.

## The design reference

`go-live/design/` is a copy of the HOAhx repo's `docs/design/`: `index.html` (built there by
`docs/design/build-reference.py` from `tokens.json`, `prompt-preamble.md`, and the route registry),
`tokens.json`, `DESIGN_BRIEF.md`, and `prompt-preamble.md`. It is served at
https://hoahx-requirements.netlify.app/design/ and the three files download from the page. To
publish a new version after anything in `docs/design/` changes (rebuild the page there first):

```bash
npm run publish:design -- --source ../hoahx/docs/design
```

The script refuses to write if a file is missing, the page links to a file that is not published
beside it, or a page contains a word the owner-facing documents exclude. Then commit and push `main`
(or open a PR and merge it); Netlify deploys on push. The folder is static: no shared store, no
passphrase. `npm run check:design` runs the same checks and writes nothing.

## Layout

| Path | What |
|---|---|
| `go-live/decision-register/decision-register.html` | The published page (generated; do not edit) |
| `go-live/HOAhx Go Live Brief.pdf` | The go-live brief |
| `go-live/workflow-map/workflow-map.html` | The published workflow map (copied from the HOAhx repo by `publish:workflow-map`; do not edit) |
| `go-live/design/` | The published design reference and its three downloadable files (copied from the HOAhx repo's `docs/design/` by `publish:design`; do not edit) |
| `scripts/register-template.html` | Page template: design, markup, and the sync script |
| `scripts/build-register.mjs`, `scripts/register-lib.mjs` | Generator and shared helpers (parser, store client, snapshots) |
| `scripts/pull-register.mjs` | Pulls marks and notes into the launch program's `register-store/` |
| `scripts/publish-workflow-map.mjs` | Copies and checks the workflow map from the HOAhx repo |
| `scripts/publish-design-reference.mjs` | Copies and checks the design reference and its files from the HOAhx repo |
| `scripts/dev-register.mjs`, `scripts/dev-stubs/` | Local server with an in-memory store |
| `netlify/functions/decisions.js` | The shared store API |
| `netlify.toml` | Publish dir, the `/api/decisions` rewrite, the root redirect, the `/workflow-map` redirect |
