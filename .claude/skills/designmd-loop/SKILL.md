---
name: designmd-loop
description: Set up, run, and maintain the designmd-loop design gate, a self-checking DESIGN.md (token gate + drift monitor + live panel) built on @google/design.md. Use when asked to start the design panel, get designmd-loop running on localhost, wire the design gate into a project or CI, point it at a project's CSS, or reconcile design drift between a DESIGN.md spec and live code.
---

# designmd-loop: set it up and run it

This kit turns one `DESIGN.md` into a self-checking loop. Your job is usually one of:
get it running on localhost, point it at the user's project, or reconcile drift.

## Get it going on localhost (from scratch)

1. Check Node >= 18: `node -v`.
2. If the repo is not here yet: `git clone <repo-url> && cd designmd-loop`.
3. Run `npm start`. **No `npm install` is needed** (the panel is dependency-free; lint is fetched on demand via `npx -y @google/design.md`).
4. The panel serves at **http://localhost:4173**. Give the user that URL. It opens a browser automatically unless `NO_OPEN=1` is set.
5. Sanity-check the loop: `npm test` should exit 0 (gate self-test passes the good sample, fails the bad one; drift monitor reports IN SYNC).

If port 4173 is busy: `PORT=4174 npm start`.

## Point it at the user's project (make it theirs)

Prefer the wizard; fall back to env/config.

- **Connector wizard (preferred):** in the panel, click **Add connectors** and walk five steps: spec path (`DESIGN.md`), live CSS, sample screens, the optional Claude judge, then review. "Save & connect" writes `designmd-loop.config.json` and reloads the panel pointed at their project.
- **Headless / by hand:** `DESIGNMD_LIVE=src/styles/globals.css npm run check`.

To scaffold the loop into an existing repo, copy `DESIGN.md`, the `eval/` folder, and `.github/workflows/design-check.yml`, then author the user's real `DESIGN.md` (next section).

## Author a real DESIGN.md

Read `design-md/SKILL.md` for the full prose-first procedure. The short version:

1. **Mine the live styling layer first** (globals.css, theme, Tailwind/Panda config). Transcribe the real token values. Code beats docs.
2. **Reconcile contradictions out loud**; the code is the source of truth for tokens.
3. **Draft prose-first**, leading with a specific reference object. Tokens support the prose.
4. **Do not author a parallel spec** if a design system already exists; derive `DESIGN.md` from it.
5. **Lint:** `npm run lint`. Fix errors, weigh warnings.

## How drift monitoring works

The monitor (`eval/sync.mjs`, and live in the panel) reads two things and diffs them:

1. The **color tokens** declared in `DESIGN.md`'s YAML front matter, excluding the `retired:` list.
2. The **CSS custom properties** (`--name: #hex | rgba(...)`) in the live file (`example/tokens.css` by default, or `DESIGNMD_LIVE`).

It classifies each gap:

- **EVOLVED** - a value in the code, absent from the spec. The code grew. Fold it into `DESIGN.md`.
- **STALE** - a value in the spec, absent from the code. The spec remembers a dropped value.
- **IN SYNC** - they match.

It runs on demand (CI, a pre-commit hook, or `npm run sync`) and **continuously while the panel is open** (mtime polling, ~0.5s; the page reloads on save). It currently tracks colors; extend `eval/sync.mjs` to diff typography or spacing if a project needs it.

## Maintenance rule

On `EVOLVED` drift, update `DESIGN.md` to match the code, with a dated note (when the code changed vs when the spec learned it). Re-run `npm run check` until `IN SYNC`. The code is the source of truth; the spec tracks it. Never force a deploy past unresolved drift.
