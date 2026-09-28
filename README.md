# hoahx-artifacts

Published HOAhx go-live artifacts, deployed by Netlify from this repository's `main` branch to
https://hoahx-requirements.netlify.app/. The site's root is the owners' page, **Your open
questions**: everything still waiting on the owners in one place (it also answers at `/answers`).
The **HOAhx Decision Register** is an internal tool at
`/decision-register/decision-register.html`, linked from no page on the site: since September 14,
2026 it is the one register for the first release — every requirement, what the platform does
today, whether it is in the release, a ranked candidate, or not planned, and the test that will
prove it works.
`/workflow-map` is the **HOAhx Workflow Map**: every workflow by the person who uses it, with the
exact steps and the handoffs between roles. `/design/` is the **HOAhx Design Reference** for the
design work: the fixed stack, the tokens, the components as they ship, the layout system, and the
screens in build order, with `tokens.json`, `DESIGN_BRIEF.md`, and `prompt-preamble.md` downloadable
beside it. `/demo/` is **Demo Compared with the App**: every feature the owners' ChatGPT-built demo
shows, against what the app has today or is building for launch, with the two plain-text files the
owners' ChatGPT project uses beside it. `/launch-plan/` is the **HOAhx Launch Plan**: what is
being built for launch, when each piece lands, what is needed from the owners, the invoice
stages, the risks, and a weekly record of where things stand.

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
Planned item the Keep button is hidden.

### What the rest of an entry's fields become on the page

The triage plan (`docs/launch/scope-triage-plan.md`, section 3) gives every entry a further set of
fields. Some are rendered, some are deliberately internal and never leave the launch program:

| Field in `decisions.md` | On the page |
|---|---|
| `Launch:` | One of three pills — **In the release** · **Candidate** · **Not planned** — plus **Waiting on you** on the gating set. An entry with no `Launch:` value shows no pill, so a missing field can never read as a promise |
| `Value:` | The word only (**Low / Medium / High**) with its one-sentence reason. The per-criterion scores stay internal |
| `Test:` | **Proven by**. A `workflow:` id is resolved to that workflow's own name from `workflow-map.json`; a `tests/` path becomes a plain sentence; `none → <task>` becomes "a test written as this is built" — the task id never shows |
| `Sources:` | Small labels. An **F-id** links to the matching screen at `/demo/#F-###`; an **R-line** is the owners' Core list by area and item. `S0-` step-0 rows are internal and are dropped in the parser, not the template |
| `Follows:` | Drawn **both ways** from the one directional field: **Builds on** on the entry that carries it, **Continues in** on the entry it points at. Clicking either jumps to the other half, clearing any filter that would hide it |
| `Kind:`, `Security:`, `Cost:` | **Never rendered.** The security class, its mitigations, the hours and the money stay in the launch program |

### What a mark does, and what it no longer does

A later mark **never reopens an entry** (Jacob, 2026-09-14). `pull-register.mjs` reports one of:

- **CHANGE REQUESTED** — a Change or Discuss on an entry in the release whose answer is already
  recorded. The recorded answer stands and the work in flight carries on; `/decide` splits the
  request out as a new entry with a `Follows:` line and `Launch: candidate`, which then gets ranked.
- **RANK** — any mark on a Candidate or a Not-planned entry, whatever its date. It is the owners'
  ordering: Change means sooner, Keep as-is means fine where it sits, Discuss means talk. It is
  never an answer and never creates launch work.
- Nothing, when the mark is on or before the recorded date: it is the input that led to the record.

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
   ids (`D-###`) and codes (`Q-AREA-n`) are unique; every entry sits under an `## NN · Area` header;
   every `Launch:` value is one of the three; every `Follows:` points at a real entry, not itself.
2. **`register-check.cjs --strict` passes.** That script lives beside `decisions.md` in the launch
   program and owns the coverage and reference rules: every Core bullet and F-id in exactly one
   entry, every Core bullet on an in-the-launch entry, real `Test` and `Blocks` references, no
   pending answer on a candidate, the header count, and the excluded words. It is the one
   implementation of those rules and the builder runs it rather than repeating it. When
   `decisions.md` is somewhere without it, the build says so and carries on;
   `--skip-register-check` silences that.
3. The live shared store was fetched and **snapshotted** to `../hoahx/docs/launch/register-store/`
   (`store-YYYYMMDD-HHMMSS.json`), so every mark and note is on disk before the page changes.
4. **No live mark or note points at an id the new page lacks.** D-numbers are permanent (a new
   decision gets the next number; nothing is renumbered), so this only trips if an entry was removed;
   the build lists the stranded ids and stops. `--allow-orphans` overrides; the snapshot keeps them.
5. The page contains none of the words the owner-facing documents exclude.

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

## The demo comparison

`go-live/demo/` is a copy of three files from the HOAhx repo's `docs/prototype/`: `index.html` (built
there by `scripts/build-prototype-comparison.cjs` from the Demo Feature Register `features.md`, the
demo's manifest, `workflow-map.json`, and the route registry), `app-today.md` (what the app does now,
generated by the same build), and `prompt-preamble.md` (what the owners paste into their ChatGPT
project so each new version of the demo arrives in a shape that can be recorded). It is served at
https://hoahx-requirements.netlify.app/demo/. The demo's source, the register, and the per-version
intake reports stay in the HOAhx repo, which is private; only these three files are published. To
publish a new version after the register changes (rebuild the page there first):

```bash
npm run publish:prototype -- --source ../hoahx/docs/prototype
```

The script refuses to write if the page has no embedded data, a file is missing, the page links to
something not on this site, or a file contains a word the owner-facing documents exclude (the demo's
own label "HOAhx AI" is allowed). Then commit and push `main` (or open a PR and merge it); Netlify
deploys on push. The folder is static: no shared store, no passphrase. `npm run check:prototype` runs
the same checks and writes nothing.

## The launch plan

`go-live/launch-plan/index.html` is the owners' **HOAhx Launch Plan**: the scope of the launch
engagement, the five-week timeline, what "done" means for each milestone, the invoice stages, the
risks, and a weekly update log with the newest entry at the top. It is served at
https://hoahx-requirements.netlify.app/launch-plan/. The page is static: no shared store, no
passphrase. Like every other published page here it carries `<meta name="robots" content="noindex">`,
so it is reachable by anyone with the link but is not offered to search engines.

Unlike the register, the workflow map, the design reference and the demo comparison, this page has
**no publish script yet**. It is a standalone copy placed here by hand. The launch program's Friday
weekly update is what changes it, so a new version is placed the same way and pushed to `main`. A
`publish:launch-plan` script that copies and checks it out of the HOAhx repo, the way
`publish:workflow-map` does, is the next step if the page is to be updated every week.

One thing to preserve if the page is ever regenerated: the "Today" marker on the timeline is an SVG
group that the page's own script reveals with `removeAttribute('hidden')`. SVG elements have no
`hidden` IDL property, so setting `.hidden = false` silently does nothing; the
`[hidden]{display:none!important}` rule at the top of the stylesheet is what holds the marker until
the script positions it.

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
| `go-live/demo/` | The published demo comparison and its two text files (copied from the HOAhx repo's `docs/prototype/` by `publish:prototype`; do not edit) |
| `scripts/publish-prototype.mjs` | Copies and checks the demo comparison and its two files from the HOAhx repo |
| `go-live/launch-plan/index.html` | The published launch plan (standalone copy, updated by hand; no publish script yet) |
| `scripts/dev-register.mjs`, `scripts/dev-stubs/` | Local server for the whole site, every function on an in-memory store (`npm run dev`) |
| `netlify/functions/decisions.js` | The shared store API |
| `netlify.toml` | Publish dir, the `/api/decisions` and `/api/answers` rewrites, the root redirect, the `/workflow-map`, `/answers`, and `/hub` redirects, and `/scope` leading to `/hub` |

## Beyond the proposal (taken down 2026-09-28)

The four pages under `/scope/` (the recommendation, Packages, Features, Review and send), their
store function (`/api/picks`), the lock file and the `publish:scope`, `check:scope` and
`pull:scope` scripts were removed on September 28, 2026: the owners' selection of September 17
became change order 2, and nothing was left to choose there. `/scope` and everything under it
now lead to `/hub`.

What was on them is kept in the launch program, in
`docs/launch/register-store/scope-final-2026-09-28/`: the store with its full history, the
selection as a summary, the lock (the 23 packages and 70 features agreed), and the page data.
The Netlify Blobs store `hoahx-scope` was not deleted. The pages themselves are in this
repository's history, up to the commit before this section changed.

The owners' demo page (`/demo/v3/`) used to load the scope stylesheet. It now loads its own
`go-live/demo/v3/base.css`, which its generator in the HOAhx repo
(`docs/prototype/v3/build-v3-page.py`) writes beside the page.

## Your open questions (`/` and `/answers`)

The owners' page: everything still waiting on them, in one place. Every open question with a
plain recommendation under it, answered **Agree**, **Change** or **Discuss** per question (Change
and Discuss open a note box inline, under that question), and where each of the 27 new screens
stands: **Signed off · Changes suggested · To discuss · Not reviewed**. A screen is answered on
the screen itself, on the staging test site; here its status is read-only. A question or screen
that a recorded video shows fully built carries a "Built" tag and a link to that video.

Nothing on the page, and nothing in the two files it reads, names the Decision Register or
carries its numbering. The publisher refuses to write otherwise.

- `go-live/answers/index.html`, `answers.js`, `answers.css` — the page, authored here. Light
  only. Asset paths are absolute (`/answers/…`) because the same page is served at `/`, at
  `/answers` and at `/answers/`.
- `go-live/answers/data.json` — the questions: `updated`, `groups`, `cards[] { id, group, title,
  note?, why, rows[] { id, qs[], rec, videos[] } }`, and `videos { "07": { title, seconds, url } }`.
  A row's `id` (`A01-1`) is permanent: answers are saved under it.
- `go-live/answers/screens.json` — the screens: `updated`, `previewUrl`, `features[] { id, title,
  screens[] { id "S-A1", code, title, what, url, videos[] } }`.
- `netlify/functions/answers.js` — the shared store (Netlify Blobs store `hoahx-answers`, one
  record per id with history, nothing deleted). A question (`A01-1`) takes `agree`, `change`,
  `discuss` or empty; a screen (`S-A1`) takes `yes`, `change`, `discuss` or empty; `_submission`
  holds the summary the page sends. CORS is open to the staging test site and to local servers,
  because the sign-off panel there saves the screens' answers. `DECISION_EDIT_KEY`, when set,
  gates it as it gates the other stores.
- `scripts/publish-answers.mjs` — **the one command**, `npm run sync:answers`: snapshots the live
  store into the launch program, drops the questions whose entry is no longer pending, rebuilds
  the screens from the spec and the preview modules, resolves every video number to a title, a
  length and a Drive link (refusing a video that was never recorded, is not current, or has no
  file in Drive), runs the guards on the page and both files, and writes the two files. It never
  commits or pushes. `npm run check:answers` verifies what is committed and reads nothing else.
- `scripts/pull-answers.mjs` — reads the store and writes the `Mark:` / `Note:` blocks that
  `/decide` applies, one per register entry, mapped through the wording source (the published
  files carry no numbering).
- `scripts/answers-lib.mjs` — what both are made of, as pure functions; `tests/` covers it and
  the store (`npm test`, Node's own test runner, no dependency).
- `scripts/check-answers-page.mjs` — a headless browser pass over the page on the local dev
  server. It answers questions, so it refuses any site that is not a local address.

```
the launch program ──npm run sync:answers──▶ go-live/answers/data.json + screens.json ──push main──▶ Netlify
owners agree, change, discuss, send ──▶ /api/answers (Blobs) ──npm run pull:answers -- --out …/register-store/answers-<date>.md──▶ /decide
the sign-off panel on the test site  ──▶ /api/answers (the same store, ids S-A1 … S-D6)
```

`npm run dev` (`scripts/dev-register.mjs`) serves the whole site locally with every function under
`netlify/functions/` on an in-memory store: http://localhost:8788/.

## The hub (`/hub`)

https://hoahx-requirements.netlify.app/hub is the owners' front door: what is waiting on them,
what is new this week, then every document and review page under **Product** (grouped by product
feature), **Developer review** and **UX**. The documents themselves stay in the shared Google
Drive; the page holds a link and one line about each, so Drive's own sharing decides who can open
what. The page is read-only: no shared store, no passphrase.

The page draws **two lists as one**:

| List | Holds | Kept by | Reaches the page |
|---|---|---|---|
| Published: `go-live/hub/data.json` | The review pages on this site, the app, the demo, and **Waiting on you** | The launch program's `docs/launch/hub.json`, through `publish:hub` and its guards | On a push to `main` |
| Live: `/api/hub` | Every file in the shared Drive folder, and the web addresses in its **Hub links** sheet | Anyone who can edit the Drive folder | Within five minutes, no publish |

The page shows the published list at once and adds the live one when it answers. If `/api/hub`
does not answer (not set up, Drive unreachable), the page is the published list alone and shows
no error. A document on both lists keeps its published line and shows once.

### How people add to the hub (in Drive, never on the page)

| To | In the `Owners' hub` Drive folder |
|---|---|
| Add a document | Put it in the section's folder, in the group's folder: `Product / Pricing / <file>` |
| Add a document kept in someone else's Drive | Add a shortcut to it in that folder |
| Change its title here | Rename the file. An extension (`.pdf`) is not shown |
| Give it the line under the title | The file's Description, in Drive's details pane |
| Move it to another group | Move the file |
| Add a group | Make a folder inside the section's folder |
| Add a section | Make a folder beside Product, Developer review and UX |
| Add a web address | A row in the sheet named **Hub links**: Section, Group, Title, Link, Description |
| Remove something | Take the file out of the folder, or delete the row |

A file directly inside a section's folder lands in a group named Other. Files beside the section
folders (the Hub links sheet, the how-to) are the hub's own and are never listed. A row of the
sheet is left out, and named in the answer's `skipped`, when its link does not start with
`https://`, it has no title, or its section is not a folder.

### Files

- `go-live/hub/index.html`, `hub.js`, `hub.css` — the page, authored here; asset paths are
  absolute (`/hub/…`) because the page is served at `/hub` without a slash.
- `go-live/hub/data.json` — the published list, from the HOAhx repo's `docs/launch/hub.json`.
- `scripts/publish-hub.mjs` — copies and guards the published list: shape, https links, the kind
  fits the link, no link listed twice, real dates none later than the list's own, and the excluded
  words in the data and the page. `--links` also requests every link that is not a Drive link and
  refuses on one that does not answer 200 (Drive answers a sign-in page to anyone, so it is not asked).
- `netlify/functions/hub.js` — the live list. Signs in to Google as a service account asked for
  `drive.readonly`, lists the folders, reads the sheet as CSV, keeps the result five minutes.
  Tests: `tests/hub-drive.test.mjs`, with Google's answers faked.

```
docs/launch/hub.json ──npm run publish:hub -- --source ../hoahx/docs/launch/hub.json──▶ go-live/hub/data.json ──push main──▶ Netlify
Owners' hub (Drive)  ──/api/hub, read on request, kept five minutes──▶ the page
```

### Settings the live list needs (Netlify, scope Functions)

| Setting | Value |
|---|---|
| `HUB_DRIVE_FOLDER` | The id of the `Owners' hub` folder (the last part of its address) |
| `HUB_GOOGLE_EMAIL` | The service account's address. The folder is shared with it as **Viewer** |
| `HUB_GOOGLE_KEY` | The `private_key` from that account's JSON key file, from `-----BEGIN` to `END PRIVATE KEY-----` |

Until all three exist `/api/hub` answers `503 {"configured": false}` and asks Google nothing.
The key is a secret: it goes into Netlify's settings by hand and nowhere else, never into this
repository, a message, or a terminal.

### Two things to know

- Anyone who can open the hub sees the **title** of every file in those folders, whether or not
  Drive lets them open it. A document whose name is private does not belong there.
- Before the published list names a Drive document, check it is shared with everyone who has the
  hub link: a document private to its author opens Drive's "You need access" page.

## Videos to review (`/videos`, a section on `/answers`, and `/videos/review`)

Short feature videos recorded from the product, reviewed in two passes:

1. **Jacob, at `/videos/review`** (linked from nowhere, gated by `VIDEO_REVIEW_KEY`). Every recording
   the recorder lists in the HOAhx repo's `docs/launch/videos/videos.json` appears here. The takes sit
   in `HOAhx/video-review/pending-recordings/` in Drive, which the owners cannot open. He approves a
   recording, or flags it with a note and screenshots. An approval is of one recording (its `commit`):
   a new recording of the same video waits for a new approval.
2. **The owners, at `/videos`**, and one card per video in the "Videos to review" section of
   `/answers` (`go-live/videos/answers-section.js`, mounted into `#videos-to-review`). They choose
   Looks right, or Something looks wrong with a note and screenshots.

`npm run sync:videos` (run by the `update-documentation` skill) reads Jacob's approvals, copies each
newly approved take into `HOAhx/Videos for the owners/` over the file of the same name (so the owners'
link never changes), and writes `go-live/videos/data.json` and `go-live/videos/review/all.json`. It
never commits or pushes. `npm run pull:videos` writes every note to
`docs/launch/videos/review-store/` in the HOAhx repo, copies each full-size screenshot to
`HOAhx/video-review/screenshots/<video>/`, checks the copy (size, md5, opens as an image at the
expected size), and only then drops the full size from the store; the small preview stays on the
page. `npm run find:videos -- V05-N004` prints everything about one note, with Drive links.

Store: `netlify/functions/videos.js` (Netlify Blobs, "hoahx-video-review"). The owners' side follows
`DECISION_EDIT_KEY` like every other store here; Jacob's side needs `VIDEO_REVIEW_KEY` and is closed
while it is unset. Every note gets a permanent reference (`V05-N004`), and screenshot files in Drive
start with it. Drive is reached through the `hoahx-drive` rclone remote, which can only see folders
rclone created.
