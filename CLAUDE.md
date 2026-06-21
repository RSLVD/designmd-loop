# designmd-loop

A self-checking design system kit built on top of [`@google/design.md`](https://github.com/google-labs-code/design.md): a token gate, a drift monitor, a live panel, and a headless report around one `DESIGN.md`.

If you are an AI assistant working in this repo, this file tells you how to run it and how to reason about it.

## Get it running

There is nothing to `npm install`. The panel is dependency-free Node; lint runs through `npx -y @google/design.md` on demand.

| Command | What it does |
|---|---|
| `npm start` | Open the **live panel** on http://localhost:4173 (renders the samples, token swatches, checks; has an "Add connectors" wizard). Auto-opens a browser unless `NO_OPEN=1`. |
| `npm test` | Gate self-test + drift monitor (what CI runs). Exits 0 when green. |
| `npm run demo` | The full loop headless; writes `eval/runs/<stamp>/report.html`. |
| `npm run check` | `lint` + `sync` (the CI / pre-deploy gate). |

When a user asks you to "set this up" or "get it going", run `npm start` and give them the localhost URL. To point the loop at their own project, use the panel's **Add connectors** wizard, or set `DESIGNMD_LIVE=path/to/their.css`.

## The loop (how to reason about it)

- **`DESIGN.md`** is the contract: tokens (YAML front matter) plus prose. `example/tokens.css` stands in for the user's live CSS.
- **The token gate** scores generated HTML against the spec's own rules: no value on the `retired:` list, on-palette colors, a declared ground.
- **The drift monitor** diffs the color tokens declared in the live CSS against `DESIGN.md`: `EVOLVED` (in code, not spec), `STALE` (in spec, not code), `IN SYNC`.
- **The code is the source of truth for tokens.** On `EVOLVED` drift, update `DESIGN.md` to match the code (with a dated note). Do not edit the code to satisfy a stale spec, and do not force past drift.

## Conventions

- `example/tokens.css` is intentionally in sync with `DESIGN.md` so the demo passes. Edit it to demonstrate drift.
- `designmd-loop.config.json` (written by the panel's connector wizard) is per-machine and git-ignored.
- Deeper authoring procedure: `design-md/SKILL.md` and the Claude Code skill in `.claude/skills/designmd-loop/`.
