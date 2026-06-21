#!/usr/bin/env node
// designmd-loop runner: the design eval.
// The contract is DESIGN.md at the repo root. This runner derives every check
// from that file, so the eval can never drift from the spec.
//
// Two stages:
//   1. Token gate (deterministic, offline). Enforces the spec's own rules on a
//      generated UI sample: no retired color, on-palette, a declared ground.
//   2. Claude judge (optional, --judge). Scores the softer qualities 0-5 via the
//      `claude` CLI. Needs `claude` on PATH or an ANTHROPIC_API_KEY-backed setup.
//      Nothing here ever hardcodes a key.
//
// Usage:
//   node eval/runner.mjs --selftest   prove the gate (good sample PASS, bad FAIL)
//   node eval/runner.mjs --report     emit a static HTML report (no server)
//   node eval/runner.mjs --gen        generate fixture outputs via `claude -p`
//   node eval/runner.mjs --gen --judge   also run the qualitative judge

import { readFileSync, readdirSync, writeFileSync, mkdirSync, existsSync, statSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(HERE, '..');
const DESIGN_MD = join(REPO_ROOT, 'DESIGN.md');

// ---- Parse the contract -----------------------------------------------------

function frontMatter() {
  const raw = readFileSync(DESIGN_MD, 'utf8');
  const m = raw.match(/^---\n([\s\S]*?)\n---/);
  if (!m) throw new Error('DESIGN.md has no YAML front matter');
  return m[1];
}
const colorRe = /#[0-9a-fA-F]{6}\b|rgba?\([^)]*\)/g;
function allowedColors(fm) {
  return new Set((fm.match(colorRe) || []).map((v) => v.toLowerCase().replace(/\s+/g, '')));
}
// Retired values are declared by the spec itself, under a `retired:` list.
function retiredColors(fm) {
  const block = fm.match(/retired:\n([\s\S]*?)(?:\n\w|\n#|$)/);
  const body = block ? block[1] : '';
  return new Set((body.match(/#[0-9a-fA-F]{6,8}\b|rgba?\([^)]*\)/g) || []).map((v) => v.toLowerCase().replace(/\s+/g, '')));
}

// ---- Stage 1: deterministic token gate --------------------------------------

function tokenGate(html) {
  const fm = frontMatter();
  const allowed = allowedColors(fm);
  const retired = retiredColors(fm);
  const findings = [];
  const norm = html.toLowerCase();
  const used = (norm.match(/#[0-9a-f]{6}\b|rgba?\([^)]*\)/g) || []).map((v) => v.replace(/\s+/g, ''));

  for (const r of retired) {
    if (used.includes(r)) findings.push({ level: 'fail', rule: 'retired-color', msg: `${r} is on the spec's retired list` });
  }
  const off = [...new Set(used)].filter((v) => !allowed.has(v) && !retired.has(v));
  for (const v of off) findings.push({ level: 'warn', rule: 'off-palette', msg: `${v} is not a DESIGN.md token` });

  const bg = (fm.match(/\n\s*bg:\s*"([^"]+)"/) || [])[1];
  const ink = (fm.match(/\n\s*ink:\s*"([^"]+)"/) || [])[1];
  if (bg && ink && !norm.includes(bg.toLowerCase()) && !norm.includes(ink.toLowerCase())) {
    findings.push({ level: 'warn', rule: 'ground', msg: `no declared ground (${bg} / ${ink}) found` });
  }

  const fails = findings.filter((f) => f.level === 'fail').length;
  const warns = findings.filter((f) => f.level === 'warn').length;
  return { verdict: fails ? 'FAIL' : warns ? 'CONDITIONAL' : 'PASS', fails, warns, findings };
}

// ---- Stage 2: Claude judge (optional) ---------------------------------------

function claudeJudge(html, specRefsFile) {
  const judgePath = join(HERE, 'judge', 'judge-prompt.md');
  const prompt = readFileSync(judgePath, 'utf8')
    .replace('{{SPECS}}', specContext(specRefsFile))
    .replace('{{GENERATED}}', html);
  try {
    const out = execSync('claude -p ' + JSON.stringify(prompt), { encoding: 'utf8', maxBuffer: 1 << 22 });
    const j = out.match(/\{[\s\S]*\}/);
    return j ? JSON.parse(j[0]) : { error: 'no JSON in judge output' };
  } catch (e) {
    return { error: 'claude CLI unavailable', detail: String(e.message).slice(0, 160) };
  }
}
function specContext(specRefsFile) {
  const refs = readFileSync(specRefsFile, 'utf8').match(/DESIGN\.md#([\w-]+)/g) || [];
  const raw = readFileSync(DESIGN_MD, 'utf8');
  const sections = raw.split(/\n## /).map((s, i) => (i === 0 ? s : '## ' + s));
  const wanted = refs.map((r) => r.split('#')[1].replace(/-/g, ' ').toLowerCase());
  const picked = sections.filter((s) => wanted.some((w) => s.toLowerCase().startsWith('## ' + w)));
  return picked.join('\n') || raw;
}

// ---- Fixtures & run ---------------------------------------------------------

function fixtures() {
  const dir = join(HERE, 'fixtures');
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((f) => statSync(join(dir, f)).isDirectory());
}
function print(id, g) {
  const icon = g.verdict === 'PASS' ? '✓' : g.verdict === 'CONDITIONAL' ? '~' : '✗';
  console.log(`\n${icon} ${id} - ${g.verdict}`);
  for (const f of g.findings) console.log(`    [${f.level}] ${f.rule}: ${f.msg}`);
}

function run({ judge, gen }) {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 16);
  const runDir = join(HERE, 'runs', stamp);
  const summary = [];
  for (const id of fixtures()) {
    const fxDir = join(HERE, 'fixtures', id);
    const outDir = join(runDir, id);
    mkdirSync(outDir, { recursive: true });
    const genPath = join(outDir, 'generated.html');
    if (gen) {
      const prompt = readFileSync(join(fxDir, 'prompt.md'), 'utf8') + '\n\nCanonical spec:\n' + readFileSync(DESIGN_MD, 'utf8');
      try { writeFileSync(genPath, execSync('claude -p ' + JSON.stringify(prompt), { encoding: 'utf8', maxBuffer: 1 << 22 })); }
      catch { console.warn(`  (gen skipped for ${id}: claude CLI unavailable)`); }
    }
    if (!existsSync(genPath)) { summary.push({ id, verdict: 'NO-OUTPUT' }); continue; }
    const html = readFileSync(genPath, 'utf8');
    const g = tokenGate(html);
    const result = { id, gate: g };
    if (judge) result.judge = claudeJudge(html, join(fxDir, 'spec-refs.md'));
    writeFileSync(join(outDir, 'score.json'), JSON.stringify(result, null, 2));
    summary.push({ id, verdict: g.verdict, fails: g.fails, warns: g.warns });
    print(id, g);
  }
  mkdirSync(runDir, { recursive: true });
  writeFileSync(join(runDir, 'summary.json'), JSON.stringify({ stamp, summary }, null, 2));
  console.log(`\nRun saved: eval/runs/${stamp}/`);
}

// ---- Self-test: prove the gate distinguishes good from bad ------------------

function selftest() {
  const GOOD = readFileSync(join(REPO_ROOT, 'example', 'good-sample.html'), 'utf8');
  const BAD = readFileSync(join(REPO_ROOT, 'example', 'bad-sample.html'), 'utf8');
  console.log('SELF-TEST - good sample (expect PASS):');
  const g = tokenGate(GOOD); print('good-sample', g);
  console.log('\nSELF-TEST - bad sample (expect FAIL):');
  const b = tokenGate(BAD); print('bad-sample', b);
  const ok = g.verdict === 'PASS' && b.verdict === 'FAIL';
  console.log(`\n${ok ? '✓ gate works: good PASSed, bad FAILed' : '✗ gate self-test FAILED'}`);
  process.exit(ok ? 0 : 1);
}

// ---- Report: emit a static HTML report (headless, no server) ----------------

function sh(cmd) {
  try { return { out: execSync(cmd, { cwd: REPO_ROOT, encoding: 'utf8', maxBuffer: 1 << 22 }), code: 0 }; }
  catch (e) { return { out: (e.stdout || '') + (e.stderr || ''), code: e.status ?? 1 }; }
}
function buildReport() {
  let lint = { errors: '?', warnings: '?' };
  try { lint = JSON.parse(sh('npx -y @google/design.md lint ' + JSON.stringify(DESIGN_MD)).out).summary; } catch {}
  const syncRes = sh('node ' + JSON.stringify(join(HERE, 'sync.mjs')));
  const inSync = syncRes.code === 0;
  const fx = fixtures();
  const pass = lint.errors === 0 && inSync;
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 16);
  const outDir = join(HERE, 'runs', stamp);
  mkdirSync(outDir, { recursive: true });
  const chk = (ok, label, detail) =>
    `<div class="row"><span>${ok ? '&#10003;' : '&#10007;'} ${label}</span><span class="dim">${detail}</span></div>`;
  const fxRow = (id) => `<div class="row"><span><b class="dot"></b>${id}</span><span class="dim">run --gen --judge to score</span></div>`;
  const name = (frontMatter().match(/\nname:\s*(.+)/) || [])[1] || 'project';
  const html = `<!doctype html><meta charset="utf8"><title>design.md loop report</title>
<style>
:root{--bg:#f6f4ef;--ink:#1b1b1a;--muted:#6b6a66;--accent:#3a6ea5;--line:rgba(27,27,26,.14);--panel:#fff}
*{box-sizing:border-box;margin:0}body{background:var(--bg);color:var(--ink);font-family:Inter,system-ui,sans-serif;padding:48px;max-width:760px;margin:0 auto;line-height:1.5}
.eyebrow{font-family:'IBM Plex Mono',ui-monospace,monospace;font-size:11px;letter-spacing:.14em;text-transform:uppercase;color:var(--accent)}
h1{font-size:30px;letter-spacing:-.02em;margin:6px 0 2px}.sub{color:var(--muted);font-size:14px;margin-bottom:28px}
.badge{display:inline-block;padding:5px 14px;border-radius:4px;font-family:'IBM Plex Mono',monospace;font-size:12px;letter-spacing:.08em;text-transform:uppercase}
.pass{background:var(--ink);color:var(--bg)}.fail{background:var(--accent);color:#fff}
.cards{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin:24px 0}
.card{background:var(--panel);border:1px solid var(--line);border-radius:6px;padding:16px}
.card .k{font-family:'IBM Plex Mono',monospace;font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:var(--muted)}
.card .v{font-size:24px;margin-top:6px}
.panel{background:var(--panel);border:1px solid var(--line);border-radius:6px;padding:18px 20px;margin-bottom:14px}
.panel h2{font-size:12px;font-family:'IBM Plex Mono',monospace;letter-spacing:.1em;text-transform:uppercase;color:var(--muted);margin-bottom:14px;font-weight:500}
.row{display:flex;justify-content:space-between;align-items:center;padding:7px 0;font-size:14px}
.dim{color:var(--muted);font-size:13px;font-family:'IBM Plex Mono',monospace}
.dot{display:inline-block;width:10px;height:10px;border-radius:50%;background:var(--accent);margin-right:9px;vertical-align:middle}
.foot{color:var(--muted);font-size:12px;font-family:'IBM Plex Mono',monospace;margin-top:24px}
</style>
<div class="eyebrow">design.md loop</div>
<h1>${name.trim()} &middot; design report</h1>
<div class="sub">generated headless by runner.mjs &middot; ${stamp}</div>
<span class="badge ${pass ? 'pass' : 'fail'}">${pass ? 'pass' : 'attention'}</span>
<div class="cards">
  <div class="card"><div class="k">Lint</div><div class="v">${lint.errors} <span style="font-size:13px;color:var(--muted)">err</span></div></div>
  <div class="card"><div class="k">Warnings</div><div class="v">${lint.warnings}</div></div>
  <div class="card"><div class="k">Spec vs code</div><div class="v" style="font-size:20px;color:${inSync ? 'var(--ink)' : 'var(--accent)'}">${inSync ? 'in sync' : 'drift'}</div></div>
  <div class="card"><div class="k">Fixtures</div><div class="v">${fx.length}</div></div>
</div>
<div class="panel"><h2>Checks</h2>
  ${chk(lint.errors === 0, 'design.md lint', lint.errors + ' errors &middot; ' + lint.warnings + ' warnings')}
  ${chk(inSync, 'drift monitor (sync.mjs)', inSync ? 'in sync' : 'drift found')}
</div>
<div class="panel"><h2>Fixtures</h2>
  ${fx.map(fxRow).join('\n  ')}
</div>
<div class="foot">eval/runs/${stamp}/report.html &middot; static file, no server. open it or screenshot it.</div>`;
  const path = join(outDir, 'report.html');
  writeFileSync(path, html);
  console.log(`${pass ? '✓ PASS' : '✗ ATTENTION'} - report written: eval/runs/${stamp}/report.html`);
  console.log(`  lint: ${lint.errors} errors, ${lint.warnings} warnings | drift: ${inSync ? 'in sync' : 'DRIFT'} | fixtures: ${fx.length}`);
  return path;
}

// ---- Entry ------------------------------------------------------------------

const args = process.argv.slice(2);
if (args.includes('--selftest')) selftest();
else if (args.includes('--report')) buildReport();
else run({ judge: args.includes('--judge'), gen: args.includes('--gen') });
