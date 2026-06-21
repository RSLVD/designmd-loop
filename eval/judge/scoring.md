# Scoring

Two layers, both derived from `DESIGN.md`:

1. **Token gate (deterministic, always runs).** Pass/Conditional/Fail from `runner.mjs`:
   - `FAIL` - a color on the spec's `retired:` list is present.
   - `CONDITIONAL` - off-palette colors or no declared ground detected (drift, not violation).
   - `PASS` - every color is on-palette and no retired value appears.

2. **Claude judge (qualitative, `--judge`).** Five dimensions 0-5 (palette, accent restraint,
   ground, typography, decoration). Verdict: PASS (all >=4), CONDITIONAL (any 3), FAIL (any <3).

A fixture is **green** only if both layers pass. A failing fixture means one of two things:
- the generation is wrong (tighten the prompt or change the model), or
- the spec is too loose (the generation obeyed it and still looks off - tighten DESIGN.md).

Track `runs/*/summary.json` over time. The line should go up and to the right.
