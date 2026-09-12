# HOAhx demo: instructions for the ChatGPT project

Paste this at the top of the ChatGPT project's instructions, and upload `app-today.md` from the same page to the project. It keeps the demo in a shape the developer can record version by version and compare with the app at https://hoahx-requirements.netlify.app/demo/.

## Keep the package in the same shape

- The whole demo stays in `app/page.tsx`, with `app/globals.css` for the styling. Do not split it into many files unless asked.
- Keep the data at the top of `app/page.tsx` as plain top-level constants: `nav` (the list of sections), `moduleData` and `workflows` (the copy for each section), `roleProfiles` (the extra kinds of user), `operatorFlows` and `operatorWorkflowDetails` (the guided flows for the board and manager), and `demoScenarios`. Add new sections, flows and personas to those lists rather than inventing a second place for them.
- Keep the short ids of existing sections, flows and personas the same from version to version (for example `visitors`, `architecture`, `technician`). A renamed id looks like a removed feature plus a new one.
- When a feature is removed, remove it. Do not hide it behind a flag.
- Use made-up sample data only: no real names, phone numbers, email addresses, street addresses or gate codes.

## Keep FEATURES.md

Keep a file called `FEATURES.md` next to `app/` with one block per feature the demo shows, in exactly this shape:

```
### Guest gate code you can copy or share
- Where: Access & parking, and the gate tile on the dashboard
- Who: owner, renter
- What it does: Shows the resident's own code masked until revealed, lets the resident copy or share the guest code with entry instructions, and offers a request for a new code.
- In the app now: partly. The app shows the gate and guest codes; sharing with instructions and requesting a change are new.
- Added: 2026-09-11
- Changed: 2026-09-18. Added the request for a new code.
```

- `In the app now` is `yes`, `partly` or `no`, followed by one sentence. Decide it by reading `app-today.md`, which lists what the app does now and what it is building for launch. When unsure, write `unsure`.
- Add a block when a feature is added. Update `Changed` when it changes. When a feature is removed, keep the block and add `- Removed: <date>`.
- Plain language, in the words a homeowner or board member would use. Name a feature by what it does, not by a component name.

## Keep CHANGELOG.md

Keep a file called `CHANGELOG.md` next to `app/` with the newest entry first:

```
## 2026-09-18
- Added: a request for a new gate code (Access & parking).
- Changed: the visitor pass can now be extended to 11:30 PM.
- Removed: the credit reporting tile on Payments.
```

One bullet per feature added, changed or removed, each starting with Added, Changed or Removed and naming the section.

## When the owners send a version to the developer

- Send the whole package (the folder with `app/`, `FEATURES.md`, `CHANGELOG.md` and the handoff notes, or the zip ChatGPT offers), never only a rendered HTML page. The comparison is read from `app/page.tsx`.
- Say which date's `CHANGELOG.md` entry the package corresponds to.
- The developer records the package as the next version, lists every difference from the previous version, and updates the comparison page. `FEATURES.md` is a helpful guide for that; the published register is the record.
