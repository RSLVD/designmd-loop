---
name: design-md-loop
description: Author, lint, enforce, and maintain a DESIGN.md design system as a closed loop. Use when starting UI work in a project, setting up a design system, wiring a design gate into CI or a deploy, or keeping a spec in sync with the code as it evolves. Built on top of @google/design.md.
---

# design.md loop

A `DESIGN.md` file is portable design memory for coding agents: machine-readable tokens (YAML front matter) plus human-readable rationale (prose). This skill turns that single file into a closed loop: autopopulate it, enforce it, and keep it current.

## Philosophy (prose-first)

The quality of a generated design comes less from the precision of the values than from how clearly the intent is described.

- **Be specific, not adjectival.** "A 1970s graduate lecture handout from an old university" carries a whole world. "Modern, clean, premium" carries nothing. A specific reference is a point; adjectives are a fuzzy region.
- **Negative constraints define character.** A strong reference brings its restrictions for free. Pair it with a short, intentional do's/don'ts list.
- **Tokens are context, not rendering instructions.** Reference them in prose as `{colors.primary}`. Do not reinvent CSS or Tailwind inside the spec.

## Before you start: don't duplicate an existing system

A DESIGN.md is the right entry point for a project that has no formal design system yet. If the project already has one (a tokens source, a component or style corpus, a palette module), do NOT author a parallel DESIGN.md or invent token values. The existing system is the source of truth. At most, generate DESIGN.md as a subordinate export derived from it. When in doubt, ask before creating files.

## Authoring (autopopulate, then ask the gaps)

1. **Mine the feedstock.** Read the project's live styling layer (globals.css, theme files, Tailwind/Panda config) first: those are the real tokens, transcribe their actual values. Then read any design briefs, brand kits, and a project knowledge source if one exists (a wiki, a notes vault, a README). Prefer code truth over docs.
2. **Reconcile contradictions out loud.** If a brief, a note, and the code disagree, the **code is the source of truth** for tokens. Surface the contradiction; never silently encode a stale brief.
3. **Draft prose-first.** Lead with the specific reference object the material implies. Tokens support the prose.
4. **Ask only the gap questions** the feedstock could not answer: (1) the reference object, (2) negative constraints, (3) the accent rule, (4) typographic register, (5) motion temperament, (6) the competitor anti-pattern.
5. **Lint:** `npx @google/design.md lint DESIGN.md`. Fix errors, weigh warnings.
6. **Export** to your styling layer: `npx @google/design.md export --format css-tailwind DESIGN.md` (Tailwind v4) or `--format dtcg` (W3C tokens).

The feedstock is whatever knowledge source the project has. This kit ships a generic adapter: point the drift monitor at your styling file with `DESIGNMD_LIVE`, and read your own notes/wiki/brief during authoring. There is no built-in dependency on any specific tool.

## Enforce (the eval)

Each part of the spec becomes a test. The deterministic token gate (`eval/runner.mjs`) reads the spec's own rules: no value on the `retired:` list, on-palette colors, a declared ground. An optional Claude judge (`--judge`) scores the softer qualities. Add fixtures under `eval/fixtures/<id>/` (a `prompt.md` and a `spec-refs.md`). If you can't name the spec sections a fixture exercises, the spec is too vague: tighten it.

## Keep it current (maintenance)

A DESIGN.md is a living contract, not a snapshot. Distinguish two kinds of drift:

- A **generation** that violates the spec -> fail it in the eval.
- The **living code** evolving past the spec -> not a failure. Update DESIGN.md to match, because the code is the source of truth.

The drift monitor (`eval/sync.mjs`) diffs the live styling file against the spec and classifies each gap as EVOLVED, STALE, or IN SYNC. Run it on a cadence (pre-commit, CI, or a pre-deploy gate). On EVOLVED drift, fold the new values into DESIGN.md with a dated note (when the code changed vs when the spec learned it). No value sits unresolved.

## Wire it to a gate

Make the loop repeatable by running `npm run check` (lint + drift) as a pre-commit hook, in CI, or as a pre-deploy step so nothing ships while the spec is broken or stale.
