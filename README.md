# designmd-loop

Turn a `DESIGN.md` into a design system that checks itself.

[Google's design.md](https://github.com/google-labs-code/design.md) hands a coding agent your design system as one portable file: tokens plus prose. But a file is a snapshot. Nobody enforces it, and it cannot tell when your code has drifted past it. `designmd-loop` closes that gap, on top of the format (it does not fork the CLI):

- **Token gate:** scores any generated UI against the spec's own rules.
- **Drift monitor:** flags when your live code has outgrown the spec.
- **Live panel:** open it, click any screen or token to edit, watch the verdict flip.

No install, no build. Plain Node.

![design.md loop report](docs/report.png)

## Try it

```bash
git clone https://github.com/RSLVD/designmd-loop && cd designmd-loop
npm start
```

A bundled demo system ("Meridian") loads, so the panel works with zero setup. It renders your sample screens (scored), your tokens (spec vs. code), and the checks. **Click any tile, or "edit css", to change the code in place and watch the gate re-score.** Edit a color in `example/tokens.css` and the drift card flips live.

Prefer no browser? `npm run demo` runs the same checks headless and writes `eval/runs/<stamp>/report.html`. `npm run check` is the CI gate.

## Give it to Claude

Open a fresh Claude Code session and paste:

> Clone `https://github.com/RSLVD/designmd-loop`, set it up, and start the design panel on localhost.

The repo ships a `CLAUDE.md` and a Claude Code skill, so the session already knows how to run it.

## Make it yours

Run `npm start`, click **Add connectors**, and point the loop at your project in five steps: your `DESIGN.md`, your CSS, your screens, the optional Claude judge, then save. It writes `designmd-loop.config.json` (per-machine, git-ignored). By hand:

```bash
DESIGNMD_LIVE=src/styles/globals.css npm run check
```

Author your real spec with the `design-md/SKILL.md` guide, then wire `npm run check` into CI with the included `.github/workflows/design-check.yml`. No secrets needed.

## Commands

| Command | What it does |
|---|---|
| `npm start` | Open the live panel (click to edit, reloads on save) |
| `npm run demo` | The full loop headless, writes a static HTML report |
| `npm test` | Gate self-test + drift monitor (what CI runs) |
| `npm run check` | `lint` + `sync` (the CI / pre-deploy gate) |
| `npm run lint` | Lint `DESIGN.md` via `@google/design.md` |
| `npm run sync` | Drift monitor: live code vs. spec |

The panel honors `PORT` (default 4173) and `DESIGNMD_LIVE` (default `example/tokens.css`).

## How drift works

The monitor diffs the color tokens in `DESIGN.md` against the CSS custom properties in your live file:

- **EVOLVED:** in the code, not the spec. The code grew; fold it in.
- **STALE:** in the spec, not the code.
- **IN SYNC:** they match.

`npm run sync` runs once (non-zero on drift, for CI). The panel runs it continuously. Colors today; type and spacing are linted but not yet drift-checked.

## The Claude judge (optional)

The gate is deterministic and offline. For the softer qualities (is the accent restrained? is the type right?), `eval/runner.mjs --judge` scores each fixture via the `claude` CLI. No key is ever stored. Entirely optional; the deterministic loop stands on its own.

## Credits

Built on [`@google/design.md`](https://github.com/google-labs-code/design.md). The format and CLI are Google's; this kit is the loop around them. Apache-2.0, matching upstream.
