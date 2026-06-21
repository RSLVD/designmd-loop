#!/usr/bin/env node
// designmd-loop drift monitor.
//
// The living truth is your code (the styling layer). The contract is DESIGN.md.
// A site evolves; the spec must not silently fall behind. This diffs the colors
// actually declared in the live styling file against DESIGN.md and classifies
// each gap:
//
//   EVOLVED   value in code, absent from spec  -> the code grew; UPDATE DESIGN.md
//   STALE     value in spec, absent from code  -> spec remembers a dropped value
//   IN SYNC   spec matches the living code
//
// A failure here is NOT a generation bug. It means the canonical spec needs a
// deliberate update so the most current design language stays canonical.
//
// The live file defaults to example/tokens.css. Point it at your real styling
// layer with the DESIGNMD_LIVE env var, e.g.
//   DESIGNMD_LIVE=src/styles/globals.css node eval/sync.mjs
//
// Usage: node eval/sync.mjs   (exit 1 on drift)

import { readFileSync } from 'node:fs';
import { dirname, join, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(HERE, '..');
const DESIGN_MD = join(REPO_ROOT, 'DESIGN.md');
const liveArg = process.env.DESIGNMD_LIVE || 'example/tokens.css';
const LIVE = isAbsolute(liveArg) ? liveArg : join(REPO_ROOT, liveArg);

const norm = (s) => s.toLowerCase().replace(/\s+/g, '');
const colorRe = /#[0-9a-fA-F]{6}\b|rgba?\([^)]*\)/g;

function retiredSet(fm) {
  const block = fm.match(/retired:\n([\s\S]*?)(?:\n\w|\n#|$)/);
  const body = block ? block[1] : '';
  return new Set((body.match(/#[0-9a-fA-F]{6,8}\b|rgba?\([^)]*\)/g) || []).map(norm));
}
function specColors() {
  const fm = readFileSync(DESIGN_MD, 'utf8').match(/^---\n([\s\S]*?)\n---/)[1];
  // Exclude the `retired:` list: those are forbidden values, not tokens the code must ship.
  const retired = retiredSet(fm);
  const out = new Map();
  for (const v of fm.match(colorRe) || []) { const k = norm(v); if (!retired.has(k)) out.set(k, v); }
  return out;
}
// Live values: only CSS custom-property declarations, so we read the design
// language the code actually ships, not one-off inline colors.
function liveColors() {
  const css = readFileSync(LIVE, 'utf8');
  const decls = css.match(/--[\w-]+:\s*(#[0-9a-fA-F]{6}\b|rgba?\([^)]*\))/g) || [];
  const out = new Map();
  for (const d of decls) {
    const v = (d.match(colorRe) || [])[0];
    if (v) out.set(norm(v), v);
  }
  return out;
}

const spec = specColors();
const live = liveColors();
const evolved = [...live].filter(([k]) => !spec.has(k)).map(([, v]) => v);
const stale = [...spec].filter(([k]) => !live.has(k)).map(([, v]) => v);
const drift = evolved.length + stale.length;

if (!drift) {
  console.log(`✓ IN SYNC - DESIGN.md color language matches ${liveArg} (${live.size} tokens).`);
  process.exit(0);
}
console.log(`DRIFT - ${drift} value(s) differ between ${liveArg} and DESIGN.md.\n`);
if (evolved.length) {
  console.log('EVOLVED (in code, not in spec) - the code grew. Adopt into DESIGN.md or revert in code:');
  for (const v of evolved) console.log(`    + ${v}`);
  console.log();
}
if (stale.length) {
  console.log('STALE (in spec, not in code) - DESIGN.md records a value the code no longer ships:');
  for (const v of stale) console.log(`    - ${v}`);
  console.log();
}
console.log('Action: for each EVOLVED value, fold it into DESIGN.md (with a dated note) or revert');
console.log('the code. The code is the source of truth for tokens; the spec tracks it.');
process.exit(1);
