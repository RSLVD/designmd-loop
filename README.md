# designmd-loop

Turn a `DESIGN.md` into a design system that checks itself.

[Google's design.md](https://github.com/google-labs-code/design.md) is a great primitive: one portable file that hands a coding agent your design system as tokens plus prose. But a file is a snapshot. It does not know your code, nobody enforces it, and it cannot tell when the design has drifted past it.

`designmd-loop` is a small kit that closes that gap. It sits on top of the design.md format (it does not fork the CLI) and adds three things:

- **A token gate** that scores any generated UI against the spec's own rules.
- **A drift monitor** that tells you when your live code has outgrown the spec.
- **A headless HTML report**, generated from a run, that you can open or screenshot.

Three commands, no server, no UI.

![design.md loop report](docs/report.png)

## Try the demo (30 seconds)

The repo ships a complete, fictional example design system ("Meridian") so you can run the whole loop with no setup.

```bash
git clone <this-repo> && cd designmd-loop
npm run demo
```

That runs, in order:

1. **`gate` self-test** - proves the token gate by passing a compliant sample (`example/good-sample.html`) and failing a deliberately broken one (`example/bad-sample.html`).
2. **`lint`** - validates `DESIGN.md` via `@google/design.md` (run through `npx`, nothing to install).
3. **`sync`** - the drift monitor, diffing the live tokens (`example/tokens.css`) against the spec.
4. **`report`** - writes a static `eval/runs/<stamp>/report.html`.

Open the printed report path in a browser. That is the artifact above, rendered in the example system's own design language.

### Watch it catch drift

Edit a color in `example/tokens.css` (or add a new one), then:

```bash
npm run sync
```

The monitor flags the change as EVOLVED (the code grew past the spec) or STALE, and tells you to reconcile `DESIGN.md`. That is the maintenance loop: the spec tracks the code, not the other way around.

## Use it in your own project

1. Copy `DESIGN.md`, the `eval/` folder, and the `design-md/` skill into your repo.
2. Replace `DESIGN.md` with your real spec. The `design-md/SKILL.md` walks an agent through authoring it from your existing code and notes.
3. Point the drift monitor at your real styling file:
   ```bash
   DESIGNMD_LIVE=src/styles/globals.css node eval/sync.mjs
   ```
4. Wire `npm run check` (lint + drift) into a pre-commit hook, CI, or a pre-deploy step. A ready-made GitHub Action is in `.github/workflows/design-check.yml`.

## Commands

| Command | What it does |
|---|---|
| `npm run demo` | The full loop on the bundled example |
| `npm run lint` | Lint `DESIGN.md` (broken refs, WCAG contrast) via `@google/design.md` |
| `npm run sync` | Drift monitor: live code vs spec |
| `npm run gate` | Token gate self-test (good sample passes, bad fails) |
| `npm run report` | Emit the static HTML report |
| `npm run check` | `lint` + `sync` (the CI / pre-deploy gate) |

## The optional Claude judge

The token gate is deterministic and offline. For the softer qualities (does the accent actually read as restrained? is the typographic register right?), `eval/runner.mjs --judge` runs an LLM judge per fixture. It shells out to the `claude` CLI if you have it; no API key is ever stored in this repo. It is entirely optional. The deterministic loop stands on its own.

## How it fits together

```
your code + notes + briefs      the contract            the test suite           ship
   (what you already have)  →    DESIGN.md         →    lint + gate + monitor  →  deploy
        autopopulate            (tokens + prose)        enforce + watch drift
                                       ↑                         │
                                       └──── update on drift ◀────┘
                                          (code is the source of truth)
```

## Credits and license

Built on top of [`@google/design.md`](https://github.com/google-labs-code/design.md). The format and CLI are Google's; this kit is the loop around them. Apache-2.0 (see `LICENSE`), matching the upstream project.
