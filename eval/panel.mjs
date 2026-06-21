#!/usr/bin/env node
// designmd-loop panel: the live, in-browser view of the loop, in the RSLVD design
// language (warm ivory paper, graphite ink, one clay accent, Space Grotesk +
// JetBrains Mono, with a bold dark moment masthead).
//
// What you get:
//   - the demo loop, rendered: the sample UIs, the token swatches, the checks
//   - live reload: edit a watched file and the panel updates itself
//   - a connector wizard: point the loop at YOUR spec, YOUR code, YOUR screens,
//     and the optional Claude judge, with the choices saved to a config file
//
// No framework, no build, no dependencies. Just Node's http server and polling.
//
// Usage:
//   node eval/panel.mjs            start the panel, open the browser
//   PORT=5000 node eval/panel.mjs  pick a port
//   NO_OPEN=1 node eval/panel.mjs  do not auto-open a browser
//
// Connectors are saved to designmd-loop.config.json at the repo root. Env vars
// (DESIGNMD_LIVE) and that file both override the bundled demo defaults.

import { createServer } from 'node:http';
import { readFileSync, writeFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { execSync, spawn } from 'node:child_process';
import { dirname, join, isAbsolute, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(HERE, '..');
const CONFIG_PATH = join(REPO_ROOT, 'designmd-loop.config.json');
const PORT = Number(process.env.PORT) || 4173;

// ---- Config: the connectors. Defaults -> config file -> env. -----------------

// Auto-discover any example/*-sample.html so dropping a new file adds a tile.
// PASS examples lead, the deliberate failure(s) sort last; 'good' stays first.
function discoverSamples() {
  let files = [];
  try { files = readdirSync(join(REPO_ROOT, 'example')).filter((f) => /-sample\.html?$/i.test(f)); } catch {}
  const list = files.map((f) => ({
    id: f.replace(/-sample\.html?$/i, ''),
    path: 'example/' + f,
    expect: /bad|fail/i.test(f) ? 'FAIL' : 'PASS',
  }));
  list.sort((a, b) =>
    a.expect !== b.expect ? (a.expect === 'PASS' ? -1 : 1)
      : a.id === 'good' ? -1 : b.id === 'good' ? 1 : a.id.localeCompare(b.id));
  return list.length ? list : [
    { id: 'good', path: 'example/good-sample.html', expect: 'PASS' },
    { id: 'bad', path: 'example/bad-sample.html', expect: 'FAIL' },
  ];
}
function defaults() {
  return {
    spec: 'DESIGN.md',
    live: process.env.DESIGNMD_LIVE || 'example/tokens.css',
    samples: discoverSamples(),
    judge: false,
  };
}
function loadConfig() {
  const c = defaults();
  if (existsSync(CONFIG_PATH)) {
    try { Object.assign(c, JSON.parse(readFileSync(CONFIG_PATH, 'utf8'))); } catch {}
  }
  if (process.env.DESIGNMD_LIVE) c.live = process.env.DESIGNMD_LIVE; // env always wins for live
  if (!Array.isArray(c.samples) || !c.samples.length) c.samples = defaults().samples;
  return c;
}
const resolve = (p) => (isAbsolute(p) ? p : join(REPO_ROOT, p));
const rel = (p) => relative(REPO_ROOT, resolve(p)) || p;
const mtime = (p) => { try { return statSync(p).mtimeMs; } catch { return 0; } };

// ---- Shared parsing (kept in step with runner.mjs / sync.mjs) ----------------

const norm = (s) => s.toLowerCase().replace(/\s+/g, '');
const colorRe = /#[0-9a-fA-F]{6}\b|rgba?\([^)]*\)/g;

function frontMatter(specPath) {
  const m = readFileSync(resolve(specPath), 'utf8').match(/^---\n([\s\S]*?)\n---/);
  if (!m) throw new Error('spec has no YAML front matter');
  return m[1];
}
function retiredSet(fm) {
  const block = fm.match(/retired:\n([\s\S]*?)(?:\n\w|\n#|$)/);
  const body = block ? block[1] : '';
  return new Set((body.match(/#[0-9a-fA-F]{6,8}\b|rgba?\([^)]*\)/g) || []).map(norm));
}
function allowedColors(fm) { return new Set((fm.match(colorRe) || []).map(norm)); }
function specColors(fm) {
  const retired = retiredSet(fm);
  const out = new Map();
  for (const v of fm.match(colorRe) || []) { const k = norm(v); if (!retired.has(k)) out.set(k, v.replace(/\s+/g, ' ')); }
  return out;
}
function liveColors(livePath) {
  if (!existsSync(resolve(livePath))) return new Map();
  const css = readFileSync(resolve(livePath), 'utf8');
  const decls = css.match(/--[\w-]+:\s*(#[0-9a-fA-F]{6}\b|rgba?\([^)]*\))/g) || [];
  const out = new Map();
  for (const d of decls) { const v = (d.match(colorRe) || [])[0]; if (v) out.set(norm(v), v.replace(/\s+/g, ' ')); }
  return out;
}
function tokenGate(html, specPath) {
  const fm = frontMatter(specPath);
  const allowed = allowedColors(fm);
  const retired = retiredSet(fm);
  const findings = [];
  const lc = html.toLowerCase();
  const used = (lc.match(/#[0-9a-f]{6}\b|rgba?\([^)]*\)/g) || []).map((v) => v.replace(/\s+/g, ''));
  for (const r of retired) if (used.includes(r)) findings.push({ level: 'fail', rule: 'retired-color', msg: `${r} is on the spec's retired list` });
  for (const v of [...new Set(used)].filter((v) => !allowed.has(v) && !retired.has(v)))
    findings.push({ level: 'warn', rule: 'off-palette', msg: `${v} is not a token in the spec` });
  const bg = (fm.match(/\n\s*bg:\s*"([^"]+)"/) || [])[1];
  const ink = (fm.match(/\n\s*ink:\s*"([^"]+)"/) || [])[1];
  if (bg && ink && !lc.includes(bg.toLowerCase()) && !lc.includes(ink.toLowerCase()))
    findings.push({ level: 'warn', rule: 'ground', msg: `no declared ground (${bg} / ${ink}) found` });
  const fails = findings.filter((f) => f.level === 'fail').length;
  const warns = findings.filter((f) => f.level === 'warn').length;
  return { verdict: fails ? 'FAIL' : warns ? 'CONDITIONAL' : 'PASS', fails, warns, findings };
}

// ---- Lint: slow (npx). Only recompute when the spec path or mtime changes. ----

let lintCache = null, lintKey = '';
function lint(specPath) {
  const key = specPath + ':' + mtime(resolve(specPath));
  if (lintCache && key === lintKey) return lintCache;
  lintKey = key;
  try {
    const out = execSync('npx -y @google/design.md lint ' + JSON.stringify(resolve(specPath)), { cwd: REPO_ROOT, encoding: 'utf8', maxBuffer: 1 << 22 });
    lintCache = JSON.parse(out).summary;
  } catch (e) {
    try { lintCache = JSON.parse(((e.stdout || '') + '').match(/\{[\s\S]*\}/)[0]).summary; }
    catch { lintCache = { errors: '?', warnings: '?', infos: '?', unavailable: true }; }
  }
  return lintCache;
}

function fixtures() {
  const dir = join(HERE, 'fixtures');
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((f) => statSync(join(dir, f)).isDirectory());
}
function claudeAvailable() {
  try { execSync('command -v claude', { encoding: 'utf8' }); return true; } catch { return false; }
}

// ---- Snapshot of the whole loop, driven by config ----------------------------

function snapshot() {
  const cfg = loadConfig();
  let fm, name = 'your system', spec = new Map(), retired = [], specErr = null;
  try { fm = frontMatter(cfg.spec); name = (fm.match(/\nname:\s*(.+)/) || [])[1]?.trim() || 'your system'; spec = specColors(fm); retired = [...retiredSet(fm)]; }
  catch (e) { specErr = e.message; }
  const live = liveColors(cfg.live);
  const evolved = [...live].filter(([k]) => !spec.has(k)).map(([, v]) => v);
  const stale = [...spec].filter(([k]) => !live.has(k)).map(([, v]) => v);
  const ln = specErr ? { errors: '?', warnings: '?', unavailable: true } : lint(cfg.spec);
  const samples = cfg.samples.map((s) => {
    const file = resolve(s.path);
    let gate = null;
    try { if (existsSync(file)) gate = tokenGate(readFileSync(file, 'utf8'), cfg.spec); } catch {}
    const expect = s.expect || 'PASS';
    return { id: s.id, path: s.path, expect, gate, asExpected: gate ? gate.verdict === expect : false, missing: !existsSync(file) };
  });
  return { cfg, name, spec, live, retired, evolved, stale, lint: ln, samples, fixtures: fixtures(), specErr, judge: cfg.judge };
}

// ---- Render ------------------------------------------------------------------

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const swatch = (hex, label, tag, tagClass) => `
  <div class="sw">
    <span class="chip" style="background:${esc(hex)}"></span>
    <div class="swmeta"><span class="swhex">${esc(hex)}</span>${tag ? `<span class="tag ${tagClass}">${tag}</span>` : ''}</div>
    <span class="swname">${esc(label)}</span>
  </div>`;

// ============================================================
//  EDIT YOUR THEME HERE  (the panel + the readme both use this)
//  Swap any color below. To switch without thinking, move the
//  comment: wrap the active line in slash-star and unwrap an
//  alternate. CSS comments are slash-star ... star-slash, not //.
//  Every variable is used everywhere, so one change re-skins all.
// ============================================================
const THEME = `:root{
  /* --- the ground: paper + ink --- */
  --bg:#faf9f5;        /* warm ivory page */
  /* --bg:#f6f4ef; */  /* alt: cooler paper */
  /* --bg:#100f0e; */  /* alt: near-black (also set --ink light) */
  --bg-2:#f2efe7;      /* alternating band */
  --panel:#ffffff;     /* raised card */
  --panel-2:#f6f3ec;   /* card, tinted */
  --ink:#1a1916;       /* near-black text + primary actions */
  /* --ink:#1b1b1a; */ /* alt: neutral graphite */
  --muted:#5c5950;     /* secondary copy */
  --dim:#928e84;       /* metadata */

  /* --- the one accent (keep it scarce) --- */
  --clay:#cc785c;        /* RSLVD clay  <-- your signature color */
  /* --clay:#3a6ea5; */  /* alt: blue */
  /* --clay:#2f8f6b; */  /* alt: green */
  /* --clay:#7c5cff; */  /* alt: violet */
  --clay-strong:#b86346; /* hover / pressed */
  --clay-dim:#e2bcab;    /* faint tint */
  --clay-glow:rgba(204,120,92,.22); /* focus ring */

  /* --- hairlines (depth is lines, not shadows) --- */
  --line:rgba(28,25,20,.10);--line-2:rgba(28,25,20,.18);--line-3:rgba(28,25,20,.28);

  /* --- dark moment (the masthead) --- */
  --d-bg:#1a1916;--d-bg-2:#232019;--d-txt:#faf9f5;--d-muted:#b8b4a8;--d-line:rgba(250,249,245,.16);

  /* --- type --- */
  --sans:'Space Grotesk',system-ui,-apple-system,sans-serif;
  --mono:'JetBrains Mono',ui-monospace,monospace;
}`;

// ---- Minimal markdown -> HTML so the README renders in-brand ----------------

function mdInline(s) {
  return esc(s)
    .replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (m, a, u) => `<img alt="${a}" src="/${u.replace(/^\.?\//, '')}">`)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');
}
function renderMarkdown(md) {
  const L = md.replace(/\r/g, '').split('\n');
  let html = '', i = 0;
  const isBreak = (ln, nx) => /^(#{1,4}\s|```|>\s?|\s*[-*]\s|\s*\d+\.\s)/.test(ln) || (ln.includes('|') && /^[\s|:-]+$/.test(nx || ''));
  while (i < L.length) {
    const ln = L[i];
    if (/^```/.test(ln)) { const b = []; i++; while (i < L.length && !/^```/.test(L[i])) b.push(L[i++]); i++; html += `<pre><code>${esc(b.join('\n'))}</code></pre>`; continue; }
    const h = ln.match(/^(#{1,4})\s+(.*)$/); if (h) { const n = h[1].length; html += `<h${n}>${mdInline(h[2])}</h${n}>`; i++; continue; }
    if (ln.includes('|') && /^[\s|:-]+$/.test(L[i + 1] || '')) {
      const cells = (r) => r.split('|').map((c) => c.trim()).filter((c, idx, a) => !(idx === 0 && c === '') && !(idx === a.length - 1 && c === ''));
      const head = cells(ln); i += 2; const rows = [];
      while (i < L.length && L[i].includes('|')) rows.push(cells(L[i++]));
      html += `<table><thead><tr>${head.map((c) => `<th>${mdInline(c)}</th>`).join('')}</tr></thead><tbody>${rows.map((r) => `<tr>${r.map((c) => `<td>${mdInline(c)}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
      continue;
    }
    if (/^>\s?/.test(ln)) { const b = []; while (i < L.length && /^>\s?/.test(L[i])) b.push(L[i++].replace(/^>\s?/, '')); html += `<blockquote>${mdInline(b.join(' '))}</blockquote>`; continue; }
    if (/^\s*[-*]\s+/.test(ln)) { const b = []; while (i < L.length && /^\s*[-*]\s+/.test(L[i])) b.push(L[i++].replace(/^\s*[-*]\s+/, '')); html += `<ul>${b.map((x) => `<li>${mdInline(x)}</li>`).join('')}</ul>`; continue; }
    if (/^\s*\d+\.\s+/.test(ln)) { const b = []; while (i < L.length && /^\s*\d+\.\s+/.test(L[i])) b.push(L[i++].replace(/^\s*\d+\.\s+/, '')); html += `<ol>${b.map((x) => `<li>${mdInline(x)}</li>`).join('')}</ol>`; continue; }
    if (/^\s*$/.test(ln)) { i++; continue; }
    const b = [ln]; i++;
    while (i < L.length && !/^\s*$/.test(L[i]) && !isBreak(L[i], L[i + 1])) b.push(L[i++]);
    html += `<p>${mdInline(b.join(' '))}</p>`;
  }
  return html;
}
function readmePage() {
  let md = ''; try { md = readFileSync(join(REPO_ROOT, 'README.md'), 'utf8'); } catch { md = '# README not found'; }
  return `<!doctype html><html lang="en"><head><meta charset="utf8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>RSLVD &middot; readme</title>
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">
<style>${THEME}
*{box-sizing:border-box;margin:0}
body{background:var(--bg);color:var(--ink);font-family:var(--sans);line-height:1.6}
.mast{background:var(--d-bg);color:var(--d-txt);border-bottom:1px solid var(--d-line)}
.mast .wrap{display:flex;justify-content:space-between;align-items:center;max-width:820px;margin:0 auto;padding:22px 28px}
.eyebrow{font-family:var(--mono);font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:var(--clay)}
.lnk{font-family:var(--mono);font-size:12px;letter-spacing:.06em;text-transform:uppercase;padding:11px 16px;border-radius:4px;border:1px solid var(--d-line);color:var(--d-txt);text-decoration:none}
.lnk:hover{border-color:var(--clay);color:var(--clay)}
.doc{max-width:820px;margin:0 auto;padding:44px 28px 96px}
.doc h1{font-size:40px;font-weight:700;letter-spacing:-.02em;line-height:1.05;margin:8px 0 14px}
.doc h2{font-size:13px;font-family:var(--mono);text-transform:uppercase;letter-spacing:.1em;color:var(--clay);font-weight:500;margin:40px 0 12px}
.doc h3{font-size:20px;font-weight:600;margin:28px 0 10px}
.doc p{margin:0 0 14px;max-width:680px}
.doc a{color:var(--clay-strong);text-decoration:none;border-bottom:1px solid var(--clay-dim)}
.doc a:hover{color:var(--clay)}
.doc ul,.doc ol{margin:0 0 16px 22px}.doc li{margin:6px 0;max-width:660px}
.doc code{font-family:var(--mono);font-size:13px;background:var(--panel-2);border:1px solid var(--line);border-radius:3px;padding:2px 6px}
.doc pre{background:var(--d-bg);border-radius:6px;padding:18px 20px;overflow:auto;margin:0 0 18px}
.doc pre code{background:none;border:0;color:var(--d-txt);font-size:12.5px;line-height:1.55;padding:0;white-space:pre}
.doc blockquote{border-left:3px solid var(--clay);background:var(--panel-2);padding:12px 18px;margin:0 0 16px;color:var(--muted)}
.doc table{border-collapse:collapse;width:100%;margin:0 0 18px;font-size:14px}
.doc th,.doc td{border:1px solid var(--line-2);padding:9px 12px;text-align:left;vertical-align:top}
.doc th{background:var(--panel-2);font-family:var(--mono);font-size:11px;text-transform:uppercase;letter-spacing:.06em;color:var(--dim)}
.doc img{max-width:100%;border:1px solid var(--line-2);border-radius:6px;margin:6px 0 18px}
</style></head><body>
<div class="mast"><div class="wrap"><div class="eyebrow">design.md loop &middot; from RSLVD</div><a class="lnk" href="/">&larr; back to panel</a></div></div>
<div class="doc">${renderMarkdown(md)}</div>
</body></html>`;
}

function page() {
  const s = snapshot();
  const drift = s.evolved.length + s.stale.length;
  const inSync = drift === 0 && !s.specErr;
  const lintErr = s.lint.errors;
  const gateProven = s.samples.length > 0 && s.samples.every((x) => x.asExpected);
  const pass = !s.specErr && lintErr === 0 && inSync && gateProven;

  const specSwatches = [...s.spec].map(([k, v]) =>
    swatch(v, k, s.live.has(k) ? 'in code' : 'stale', s.live.has(k) ? 'ok' : 'warn')).join('');
  const evolvedSwatches = s.evolved.map((v) => swatch(v, 'new in code', 'evolved', 'alert')).join('');
  const retiredSwatches = s.retired.map((v) => swatch(v, 'forbidden', 'retired', 'dead')).join('');

  const sampleCard = (x) => {
    if (x.missing) return `<div class="sample"><div class="sample-head"><b>${esc(x.id)}</b><span class="tag warn">missing</span></div><div class="frame miss">${esc(x.path)} not found</div></div>`;
    const v = x.gate?.verdict || 'NO-OUTPUT';
    const cls = v === 'PASS' ? 'ok' : v === 'FAIL' ? 'alert' : 'warn';
    const note = x.asExpected ? `&#10003; ${x.expect === 'FAIL' ? 'caught, as designed' : 'on spec'}` : `&#10007; expected ${esc(x.expect)}`;
    const findings = (x.gate?.findings || []).map((f) => `<li class="f-${f.level}">${esc(f.rule)}: ${esc(f.msg)}</li>`).join('');
    return `
    <div class="sample">
      <div class="sample-head"><b>${esc(x.id)}</b><span class="he"><a class="mini" href="/sample/${encodeURIComponent(x.id)}" target="_blank" rel="noopener">view</a><button class="mini" onclick="openEditor('${esc(x.path)}')">edit</button><span class="tag ${cls}">${v}</span></span></div>
      <div class="frame-wrap" onclick="openEditor('${esc(x.path)}')" title="click to edit ${esc(x.path)}">
        <iframe class="frame" src="/sample/${encodeURIComponent(x.id)}" title="${esc(x.id)} sample"></iframe>
        <span class="ec">click to edit</span>
      </div>
      <ul class="findings"><li class="${x.asExpected ? 'f-ok' : 'f-fail'}">${note}</li>${findings || '<li class="f-ok">no findings</li>'}</ul>
    </div>`;
  };

  const driftLine = s.specErr
    ? `<span class="tag alert">spec error</span> ${esc(s.specErr)}`
    : inSync
    ? `<span class="tag ok">in sync</span> ${s.live.size} live tokens match the spec`
    : `<span class="tag alert">drift</span> ${s.evolved.length} evolved &middot; ${s.stale.length} stale &middot; reconcile the spec`;

  const samplesLabel = s.samples.map((x) => esc(x.id) + ':' + (x.gate?.verdict || (x.missing ? 'missing' : '?'))).join(' &middot; ');

  return `<!doctype html><html lang="en"><head><meta charset="utf8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>RSLVD &middot; design.md loop panel</title>
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">
<style>${THEME}
*{box-sizing:border-box;margin:0}
body{background:var(--bg);color:var(--ink);font-family:var(--sans);line-height:1.5;-webkit-font-smoothing:antialiased}
.wrap{max-width:1140px;margin:0 auto;padding:0 28px}
.eyebrow{font-family:var(--mono);font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:var(--clay)}
.micro{font-family:var(--mono);font-size:11px;letter-spacing:.16em;text-transform:uppercase;color:var(--dim)}

/* bold dark moment masthead */
.mast{background:var(--d-bg);color:var(--d-txt);border-bottom:1px solid var(--d-line)}
.mast .wrap{display:flex;justify-content:space-between;align-items:flex-end;padding-top:30px;padding-bottom:26px;gap:24px;flex-wrap:wrap}
.mast .eyebrow{color:var(--clay)}
.mast h1{font-size:46px;font-weight:700;letter-spacing:-.02em;line-height:1;margin-top:8px}
.mast .loaded{color:var(--d-muted);font-size:13px;margin-top:8px;font-family:var(--mono)}
.mast .loaded b{color:var(--d-txt)}
.mast-right{display:flex;align-items:center;gap:14px}
.btn{font-family:var(--mono);font-size:12px;letter-spacing:.06em;text-transform:uppercase;padding:13px 18px;border-radius:4px;border:1px solid transparent;cursor:pointer;transition:.15s}
.btn-cta{background:var(--d-txt);color:var(--d-bg);border-color:var(--d-txt)}
.btn-cta:hover{background:var(--clay);border-color:var(--clay);color:#fff}
.btn-ghost{background:transparent;color:var(--ink);border-color:var(--line-3)}
.btn-ghost:hover{border-color:var(--clay);color:var(--clay-strong)}
.mast .btn-ghost{color:var(--d-txt);border-color:var(--d-line)}.mast .btn-ghost:hover{border-color:var(--clay);color:var(--clay)}

section.body{padding:40px 0 88px}
.statusrow{display:flex;align-items:center;gap:14px;margin-bottom:22px;flex-wrap:wrap}
.badge{display:inline-block;padding:8px 16px;border-radius:4px;font-family:var(--mono);font-size:12px;letter-spacing:.06em;text-transform:uppercase}
.badge.pass{background:var(--ink);color:var(--bg)}.badge.attn{background:var(--clay);color:#fff}
.statusrow .live{display:inline-flex;align-items:center;gap:7px;color:var(--muted);font-size:11px;font-family:var(--mono)}
.statusrow .pulse{width:7px;height:7px;border-radius:50%;background:var(--clay);box-shadow:0 0 0 4px var(--clay-glow);animation:p 1.6s ease-in-out infinite}
@keyframes p{0%,100%{opacity:.35}50%{opacity:1}}

.cards{display:grid;grid-template-columns:repeat(4,1fr);gap:14px;margin-bottom:18px}
.card{background:var(--panel);border:1px solid var(--line-2);border-radius:4px;padding:18px}
.card .k{font-family:var(--mono);font-size:11px;letter-spacing:.1em;text-transform:uppercase;color:var(--dim)}
.card .v{font-size:30px;margin-top:8px;letter-spacing:-.02em;font-weight:600}
.card .v small{font-size:13px;color:var(--dim);font-weight:400}

.panel{background:var(--panel);border:1px solid var(--line-2);border-radius:4px;padding:26px 28px;margin-bottom:18px}
.panel h2{font-size:13px;font-family:var(--mono);letter-spacing:.1em;text-transform:uppercase;color:var(--clay);margin-bottom:6px;font-weight:500}
.panel .hint{color:var(--muted);font-size:14px;margin:2px 0 18px;max-width:680px}
.samples{display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:16px}
.sample{border:1px solid var(--line-2);border-radius:4px;overflow:hidden;background:var(--bg)}
.sample-head{display:flex;justify-content:space-between;align-items:center;padding:11px 15px;background:var(--panel-2);border-bottom:1px solid var(--line);font-size:13px;font-family:var(--mono)}
.frame{width:100%;height:150px;border:0;background:#fff;display:block;pointer-events:none}
.frame-wrap{position:relative;cursor:pointer}
.frame-wrap:hover{box-shadow:inset 0 0 0 2px var(--clay)}
.ec{position:absolute;top:8px;right:8px;font-family:var(--mono);font-size:10px;text-transform:uppercase;letter-spacing:.06em;background:var(--clay);color:#fff;padding:3px 7px;border-radius:3px;opacity:0;transition:.12s;pointer-events:none}
.frame-wrap:hover .ec{opacity:1}
.he{display:flex;align-items:center;gap:8px}
.mini{font-family:var(--mono);font-size:10px;text-transform:uppercase;letter-spacing:.06em;background:none;border:1px solid var(--line-2);border-radius:3px;padding:3px 8px;cursor:pointer;color:var(--muted);text-decoration:none;display:inline-block}
.mini:hover{border-color:var(--clay);color:var(--clay-strong)}
.ed-scrim{position:fixed;inset:0;background:rgba(26,25,22,.55);opacity:0;pointer-events:none;transition:.18s;z-index:60}
.ed-scrim.open{opacity:1;pointer-events:auto}
.editor{position:fixed;top:50%;left:50%;transform:translate(-50%,-46%) scale(.98);opacity:0;pointer-events:none;width:min(860px,94vw);height:min(80vh,720px);background:var(--bg);border:1px solid var(--line-3);border-radius:6px;z-index:70;display:flex;flex-direction:column;transition:.18s;box-shadow:0 30px 80px rgba(26,25,22,.3)}
.editor.open{opacity:1;pointer-events:auto;transform:translate(-50%,-50%) scale(1)}
.ed-head{display:flex;justify-content:space-between;align-items:center;gap:12px;padding:14px 18px;background:var(--d-bg);color:var(--d-txt);border-radius:6px 6px 0 0}
.ed-head b{font-family:var(--mono);font-size:13px}
.ed-head .grp{display:flex;gap:8px}
#ed-text{flex:1;width:100%;border:0;padding:18px;font-family:var(--mono);font-size:13px;line-height:1.6;background:var(--panel);color:var(--ink);resize:none;outline:none}
.ed-foot{display:flex;justify-content:space-between;align-items:center;padding:10px 18px;border-top:1px solid var(--line-2);font-family:var(--mono);font-size:11px;color:var(--dim)}
#ed-status{color:var(--clay-strong)}
.frame.miss{display:flex;align-items:center;justify-content:center;color:var(--dim);font-family:var(--mono);font-size:12px;height:120px}
.findings{list-style:none;padding:11px 15px;font-family:var(--mono);font-size:11px;line-height:1.8}
.f-fail{color:var(--clay-strong)}.f-warn{color:var(--muted)}.f-ok{color:var(--muted)}
.swatches{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:12px}
.sw{border:1px solid var(--line-2);border-radius:4px;padding:11px;background:var(--bg)}
.chip{display:block;height:38px;border-radius:3px;border:1px solid var(--line-2)}
.swmeta{display:flex;justify-content:space-between;align-items:center;margin-top:9px}
.swhex{font-family:var(--mono);font-size:11px}
.swname{display:block;color:var(--dim);font-family:var(--mono);font-size:10px;letter-spacing:.04em;margin-top:3px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.tag{font-family:var(--mono);font-size:9px;letter-spacing:.08em;text-transform:uppercase;padding:3px 7px;border-radius:3px;border:1px solid var(--line-2);white-space:nowrap}
.tag.ok{color:var(--dim)}.tag.warn{color:var(--clay);border-color:var(--clay-dim)}
.tag.alert{background:var(--clay);color:#fff;border-color:var(--clay)}
.tag.dead{color:var(--dim);text-decoration:line-through}
.row{display:flex;justify-content:space-between;align-items:center;padding:10px 0;font-size:14px;border-top:1px solid var(--line)}
.row:first-child{border-top:0}.row .dot{color:var(--clay)}
.dim{color:var(--muted);font-size:12px;font-family:var(--mono)}
ol.steps{margin:0;padding-left:0;list-style:none;counter-reset:s}
ol.steps li{counter-increment:s;position:relative;padding:14px 0 14px 44px;border-top:1px solid var(--line);font-size:14px;color:var(--muted)}
ol.steps li:first-child{border-top:0}ol.steps li b{color:var(--ink)}
ol.steps li::before{content:counter(s);position:absolute;left:0;top:13px;width:26px;height:26px;border-radius:50%;background:var(--ink);color:var(--bg);font-family:var(--mono);font-size:12px;display:flex;align-items:center;justify-content:center}
code{font-family:var(--mono);font-size:12px;background:var(--panel-2);border:1px solid var(--line);border-radius:3px;padding:2px 6px;color:var(--ink)}
.foot{color:var(--dim);font-size:12px;font-family:var(--mono);margin-top:6px}
.connectors{display:grid;grid-template-columns:repeat(2,1fr);gap:10px;margin-top:4px}
.conn{display:flex;justify-content:space-between;align-items:center;gap:10px;border:1px solid var(--line);border-radius:4px;padding:12px 14px;background:var(--bg)}
.conn .clabel{font-family:var(--mono);font-size:11px;text-transform:uppercase;letter-spacing:.08em;color:var(--dim)}
.conn .cval{font-family:var(--mono);font-size:12px;color:var(--ink);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:60%;text-align:right}

/* wizard slide-over */
.scrim{position:fixed;inset:0;background:rgba(26,25,22,.5);opacity:0;pointer-events:none;transition:.2s;z-index:40}
.scrim.open{opacity:1;pointer-events:auto}
.wiz{position:fixed;top:0;right:0;height:100%;width:min(560px,92vw);background:var(--bg);border-left:1px solid var(--line-3);transform:translateX(100%);transition:.24s cubic-bezier(.4,0,.2,1);z-index:50;display:flex;flex-direction:column;box-shadow:-24px 0 60px rgba(26,25,22,.18)}
.wiz.open{transform:translateX(0)}
.wiz-head{background:var(--d-bg);color:var(--d-txt);padding:24px 28px;border-bottom:1px solid var(--d-line)}
.wiz-head .eyebrow{color:var(--clay)}.wiz-head h3{font-size:24px;font-weight:600;letter-spacing:-.02em;margin-top:6px}
.wiz-steps{display:flex;gap:6px;padding:16px 28px 0}
.wiz-steps i{flex:1;height:3px;border-radius:2px;background:var(--line-2)}.wiz-steps i.on{background:var(--clay)}.wiz-steps i.done{background:var(--ink)}
.wiz-body{flex:1;overflow:auto;padding:22px 28px}
.wstep{display:none}.wstep.on{display:block}
.wstep h4{font-size:20px;font-weight:600;letter-spacing:-.01em}
.wstep p{color:var(--muted);font-size:14px;margin:8px 0 16px;max-width:460px}
label.fld{display:block;font-family:var(--mono);font-size:11px;text-transform:uppercase;letter-spacing:.08em;color:var(--dim);margin:14px 0 6px}
input[type=text],textarea{width:100%;font-family:var(--mono);font-size:13px;padding:11px 13px;border:1px solid var(--line-3);border-radius:4px;background:var(--panel);color:var(--ink)}
input[type=text]:focus,textarea:focus{outline:none;border-color:var(--clay);box-shadow:0 0 0 4px var(--clay-glow)}
textarea{min-height:84px;resize:vertical;line-height:1.6}
.test{margin-top:10px;display:flex;align-items:center;gap:10px}
.result{font-family:var(--mono);font-size:12px}.result.ok{color:var(--clay-strong)}.result.bad{color:#a23}
.toggle{display:flex;align-items:center;gap:10px;margin-top:8px;font-size:14px;color:var(--ink)}
.toggle input{width:18px;height:18px;accent-color:var(--clay)}
.wiz-foot{display:flex;justify-content:space-between;gap:10px;padding:18px 28px;border-top:1px solid var(--line-2);background:var(--panel-2)}
.summary{font-family:var(--mono);font-size:12px;color:var(--muted);line-height:1.9}
.summary b{color:var(--ink)}
@media(max-width:760px){.cards{grid-template-columns:repeat(2,1fr)}.samples{grid-template-columns:1fr}.connectors{grid-template-columns:1fr}.mast h1{font-size:36px}}
</style></head><body>

<div class="mast"><div class="wrap">
  <div>
    <div class="eyebrow">design.md loop &middot; from RSLVD</div>
    <h1>design panel</h1>
    <div class="loaded">loaded system: <b>${esc(s.name)}</b> &middot; spec <b>${esc(rel(s.cfg.spec))}</b> &middot; code <b>${esc(rel(s.cfg.live))}</b></div>
  </div>
  <div class="mast-right">
    <span class="badge ${pass ? 'pass' : 'attn'}">${pass ? 'all checks pass' : 'needs attention'}</span>
    <a class="btn btn-ghost" href="/readme" style="text-decoration:none;display:inline-block">Read me</a>
    <button class="btn btn-cta" onclick="openWiz()">Add connectors</button>
  </div>
</div></div>

<section class="body"><div class="wrap">

<div class="statusrow">
  <span class="live"><span class="pulse"></span>watching ${esc(rel(s.cfg.live))} + ${esc(rel(s.cfg.spec))}, reloads on save</span>
</div>

<div class="cards">
  <div class="card"><div class="k">Lint errors</div><div class="v">${esc(lintErr)}${s.lint.unavailable ? ' <small>offline</small>' : ''}</div></div>
  <div class="card"><div class="k">Lint warnings</div><div class="v">${esc(s.lint.warnings)}</div></div>
  <div class="card"><div class="k">Spec vs code</div><div class="v" style="font-size:22px;color:${inSync ? 'var(--ink)' : 'var(--clay-strong)'}">${s.specErr ? 'error' : inSync ? 'in sync' : 'drift'}</div></div>
  <div class="card"><div class="k">Claude judge</div><div class="v" style="font-size:22px">${s.judge ? 'on' : 'off'}</div></div>
</div>

<div class="panel">
  <h2>The visual test &middot; token gate</h2>
  <p class="hint">Each screen scored against the spec, live. <b>edit</b> opens its code in place (save and the verdict flips); <b>view</b> opens the rendered screen in a new tab.</p>
  <div class="samples">${s.samples.map(sampleCard).join('')}</div>
</div>

<div class="panel">
  <h2>Tokens &middot; spec vs live code <span class="he" style="margin-left:8px"><button class="mini" onclick="openEditor('${esc(rel(s.cfg.live))}')">edit css</button><a class="mini" href="/raw?path=${encodeURIComponent(rel(s.cfg.live))}" target="_blank" rel="noopener">view css</a></span></h2>
  <p class="hint">${driftLine}. Change a token and a new <span class="tag alert">evolved</span> swatch appears, the drift card turns. The code is the source of truth; the spec tracks it.</p>
  <div class="swatches">${specSwatches}${evolvedSwatches}</div>
  ${s.retired.length ? `<h2 style="margin-top:24px">Retired &middot; the gate fails any of these</h2><div class="swatches">${retiredSwatches}</div>` : ''}
</div>

<div class="panel">
  <h2>Connectors</h2>
  <p class="hint">Where the loop is pointed right now. Saved in <code>designmd-loop.config.json</code>. Click <b>Add connectors</b> to repoint it at your own project.</p>
  <div class="connectors">
    <div class="conn"><span class="clabel">Spec</span><span class="he"><span class="cval">${esc(rel(s.cfg.spec))}</span><button class="mini" onclick="openEditor('${esc(rel(s.cfg.spec))}')">edit</button><a class="mini" href="/raw?path=${encodeURIComponent(rel(s.cfg.spec))}" target="_blank" rel="noopener">view</a></span></div>
    <div class="conn"><span class="clabel">Live code</span><span class="he"><span class="cval">${esc(rel(s.cfg.live))}</span><button class="mini" onclick="openEditor('${esc(rel(s.cfg.live))}')">edit</button><a class="mini" href="/raw?path=${encodeURIComponent(rel(s.cfg.live))}" target="_blank" rel="noopener">view</a></span></div>
    <div class="conn"><span class="clabel">Samples</span><span class="cval">${s.samples.length} screen(s)</span></div>
    <div class="conn"><span class="clabel">Claude judge</span><span class="cval">${s.judge ? 'enabled' : 'off'}</span></div>
  </div>
</div>

<div class="panel">
  <h2>Checks</h2>
  <div class="row"><span><span class="dot">&#9679;</span> design.md lint</span><span class="dim">${esc(lintErr)} errors &middot; ${esc(s.lint.warnings)} warnings</span></div>
  <div class="row"><span><span class="dot">&#9679;</span> drift monitor</span><span class="dim">${s.specErr ? 'spec error' : inSync ? 'in sync' : s.evolved.length + ' evolved, ' + s.stale.length + ' stale'}</span></div>
  <div class="row"><span><span class="dot">&#9679;</span> token gate</span><span class="dim">${samplesLabel || 'no samples'}</span></div>
</div>

<div class="panel">
  <h2>Make it yours</h2>
  <ol class="steps">
    <li><b>Run the wizard.</b> Hit <b>Add connectors</b> (top right) and point the loop at your spec, your CSS, and your screens. It saves <code>designmd-loop.config.json</code>; no editing by hand.</li>
    <li><b>Author your spec.</b> Replace the demo <code>DESIGN.md</code> with your own colors, type, and a <code>retired:</code> list. <code>design-md/SKILL.md</code> walks an agent through building it from your code.</li>
    <li><b>Watch it react.</b> Change a hex in your CSS and save; this panel reloads and the drift card moves. The code is the source of truth; the spec tracks it.</li>
    <li><b>Wire it into CI.</b> <code>.github/workflows/design-check.yml</code> runs lint + drift + gate on every push and PR. No secrets needed.</li>
  </ol>
</div>

<div class="foot">localhost:${PORT} &middot; live panel, regenerates on save &middot; headless version: <code>npm run demo</code></div>

</div></section>

<!-- Connector wizard -->
<div class="scrim" id="scrim" onclick="closeWiz()"></div>
<aside class="wiz" id="wiz" aria-hidden="true">
  <div class="wiz-head"><div class="eyebrow">connect your project</div><h3>Connector wizard</h3></div>
  <div class="wiz-steps"><i id="b0"></i><i id="b1"></i><i id="b2"></i><i id="b3"></i><i id="b4"></i></div>
  <div class="wiz-body">
    <div class="wstep" data-step="0">
      <h4>1 &middot; Your design spec</h4>
      <p>The contract: one <code>DESIGN.md</code> with your tokens, components, and a <code>retired:</code> list. Path is relative to the repo root, or absolute.</p>
      <label class="fld">spec path</label>
      <input type="text" id="f-spec" value="${esc(rel(s.cfg.spec))}" placeholder="DESIGN.md">
      <div class="test"><button class="btn btn-ghost" onclick="test('spec','f-spec','r-spec')">Test connection</button><span class="result" id="r-spec"></span></div>
    </div>
    <div class="wstep" data-step="1">
      <h4>2 &middot; Your live code</h4>
      <p>The styling file where your tokens actually live. The drift monitor reads the CSS custom properties declared here.</p>
      <label class="fld">live code path</label>
      <input type="text" id="f-live" value="${esc(rel(s.cfg.live))}" placeholder="src/styles/globals.css">
      <div class="test"><button class="btn btn-ghost" onclick="test('live','f-live','r-live')">Test connection</button><span class="result" id="r-live"></span></div>
    </div>
    <div class="wstep" data-step="2">
      <h4>3 &middot; Your screens</h4>
      <p>The HTML the gate scores. One per line: <code>path</code>, or <code>path :: FAIL</code> to mark a screen that is supposed to fail.</p>
      <label class="fld">sample paths</label>
      <textarea id="f-samples" placeholder="src/pages/home.html">${s.samples.map((x) => esc(rel(x.path)) + (x.expect === 'FAIL' ? ' :: FAIL' : '')).join('\n')}</textarea>
      <div class="test"><button class="btn btn-ghost" onclick="testSamples()">Test all</button><span class="result" id="r-samples"></span></div>
    </div>
    <div class="wstep" data-step="3">
      <h4>4 &middot; Claude judge (optional)</h4>
      <p>The deterministic gate is offline and stands alone. The optional judge scores softer qualities by shelling out to the <code>claude</code> CLI. No key is ever stored.</p>
      <label class="toggle"><input type="checkbox" id="f-judge" ${s.judge ? 'checked' : ''}> Enable the Claude judge</label>
      <div class="test"><button class="btn btn-ghost" onclick="test('judge','','r-judge')">Check for claude CLI</button><span class="result" id="r-judge"></span></div>
    </div>
    <div class="wstep" data-step="4">
      <h4>5 &middot; Review &amp; connect</h4>
      <p>This writes <code>designmd-loop.config.json</code>. The panel reloads pointed at your project.</p>
      <div class="summary" id="wiz-summary"></div>
    </div>
  </div>
  <div class="wiz-foot">
    <button class="btn btn-ghost" id="wiz-back" onclick="step(-1)">Back</button>
    <button class="btn btn-cta" id="wiz-next" onclick="step(1)">Next</button>
  </div>
</aside>

<!-- Inline file editor -->
<div class="ed-scrim" id="ed-scrim" onclick="closeEditor()"></div>
<div class="editor" id="editor" aria-hidden="true">
  <div class="ed-head"><b id="ed-title"></b><span class="grp">
    <button class="btn btn-ghost" onclick="openInEditor()">Open in editor</button>
    <button class="btn btn-ghost" onclick="closeEditor()">Cancel</button>
    <button class="btn btn-cta" onclick="saveEditor()">Save</button>
  </span></div>
  <textarea id="ed-text" spellcheck="false"></textarea>
  <div class="ed-foot"><span id="ed-status"></span><span>saving writes the file and re-runs the loop</span></div>
</div>

<script>
let v=null;
setInterval(async()=>{try{const r=await fetch('/api/version',{cache:'no-store'});const{version}=await r.json();if(v===null)v=version;else if(version!==v)location.reload();}catch{}},700);

let edPath=null;
async function openEditor(path){
  edPath=path;
  document.getElementById('ed-title').textContent=path;
  document.getElementById('ed-status').textContent='loading...';
  try{const r=await fetch('/api/file?path='+encodeURIComponent(path));const j=await r.json();
    document.getElementById('ed-text').value=j.ok?j.content:('// '+(j.error||'could not read'));
    document.getElementById('ed-status').textContent='';}
  catch{document.getElementById('ed-status').textContent='could not read file';}
  document.getElementById('ed-scrim').classList.add('open');
  document.getElementById('editor').classList.add('open');
}
function closeEditor(){document.getElementById('ed-scrim').classList.remove('open');document.getElementById('editor').classList.remove('open');}
async function saveEditor(){
  const content=document.getElementById('ed-text').value;const st=document.getElementById('ed-status');st.textContent='saving...';
  try{const r=await fetch('/api/file',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({path:edPath,content})});
    const j=await r.json();
    if(j.ok){st.textContent='saved';setTimeout(()=>{closeEditor();location.reload();},250);}
    else st.textContent='error: '+(j.error||'write failed');}
  catch{st.textContent='could not reach server';}
}
async function openInEditor(){try{await fetch('/api/open',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({path:edPath})});}catch{}}
document.addEventListener('keydown',(e)=>{if(e.key==='Escape')closeEditor();if((e.metaKey||e.ctrlKey)&&e.key==='s'&&document.getElementById('editor').classList.contains('open')){e.preventDefault();saveEditor();}});

let cur=0;const STEPS=5;
function openWiz(){document.getElementById('scrim').classList.add('open');document.getElementById('wiz').classList.add('open');cur=0;render();}
function closeWiz(){document.getElementById('scrim').classList.remove('open');document.getElementById('wiz').classList.remove('open');}
function render(){
  document.querySelectorAll('.wstep').forEach(e=>e.classList.toggle('on',+e.dataset.step===cur));
  for(let i=0;i<STEPS;i++){const b=document.getElementById('b'+i);b.className=i<cur?'done':i===cur?'on':'';}
  document.getElementById('wiz-back').style.visibility=cur===0?'hidden':'visible';
  document.getElementById('wiz-next').textContent=cur===STEPS-1?'Save & connect':'Next';
  if(cur===STEPS-1)summarize();
}
function step(d){if(cur===STEPS-1&&d>0){return save();}cur=Math.max(0,Math.min(STEPS-1,cur+d));render();}
async function test(type,inId,outId){
  const out=document.getElementById(outId);out.textContent='testing...';out.className='result';
  const path=inId?document.getElementById(inId).value.trim():'';
  try{const r=await fetch('/api/validate',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({type,path})});
    const j=await r.json();out.textContent=(j.ok?'✓ ':'✗ ')+j.detail;out.className='result '+(j.ok?'ok':'bad');}
  catch{out.textContent='✗ could not reach server';out.className='result bad';}
}
async function testSamples(){
  const out=document.getElementById('r-samples');out.textContent='testing...';out.className='result';
  const lines=document.getElementById('f-samples').value.split('\\n').map(s=>s.trim()).filter(Boolean);
  const res=[];
  for(const ln of lines){const[p,exp]=ln.split('::').map(x=>x.trim());
    try{const r=await fetch('/api/validate',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({type:'sample',path:p})});
      const j=await r.json();const expv=(exp||'PASS').toUpperCase();const ok=j.verdict===expv;
      res.push((ok?'✓':'✗')+' '+p.split('/').pop()+': '+(j.verdict||'?'));}catch{res.push('✗ '+p);}}
  out.innerHTML=res.join('<br>');out.className='result '+(res.every(x=>x[0]==='✓')?'ok':'bad');
}
function parseSamples(){
  return document.getElementById('f-samples').value.split('\\n').map(s=>s.trim()).filter(Boolean).map((ln,i)=>{
    const[p,exp]=ln.split('::').map(x=>x.trim());
    return{id:(p.split('/').pop()||('sample'+i)).replace(/\\.html?$/,''),path:p,expect:(exp||'PASS').toUpperCase()};});
}
function summarize(){
  const sp=document.getElementById('f-spec').value.trim();
  const lv=document.getElementById('f-live').value.trim();
  const sm=parseSamples();
  const jd=document.getElementById('f-judge').checked;
  document.getElementById('wiz-summary').innerHTML=
    'spec &nbsp; <b>'+sp+'</b><br>live &nbsp; <b>'+lv+'</b><br>screens &nbsp; <b>'+sm.length+'</b> ('+sm.map(x=>x.id+':'+x.expect).join(', ')+')<br>judge &nbsp; <b>'+(jd?'on':'off')+'</b>';
}
async function save(){
  const cfg={spec:document.getElementById('f-spec').value.trim(),live:document.getElementById('f-live').value.trim(),samples:parseSamples(),judge:document.getElementById('f-judge').checked};
  const btn=document.getElementById('wiz-next');btn.textContent='saving...';
  try{const r=await fetch('/api/connect',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(cfg)});
    const j=await r.json();if(j.ok){closeWiz();setTimeout(()=>location.reload(),300);}else{btn.textContent='Save & connect';alert('Could not save: '+(j.error||'unknown'));}}
  catch{btn.textContent='Save & connect';alert('Could not reach server');}
}
</script>
</body></html>`;
}

// ---- Server ------------------------------------------------------------------

let version = 1, sig = '';
function currentSig() {
  const c = loadConfig();
  const files = [CONFIG_PATH, resolve(c.spec), resolve(c.live), ...c.samples.map((s) => resolve(s.path))];
  return files.map((f) => f + ':' + mtime(f)).join('|');
}
function readBody(req) {
  return new Promise((res) => { let b = ''; req.on('data', (c) => (b += c)); req.on('end', () => { try { res(JSON.parse(b || '{}')); } catch { res({}); } }); });
}

const server = createServer(async (req, res) => {
  const url = (req.url || '/').split('?')[0];
  const json = (obj, code = 200) => { res.writeHead(code, { 'content-type': 'application/json', 'cache-control': 'no-store' }); res.end(JSON.stringify(obj)); };

  if (url === '/api/version') return json({ version });

  if (url === '/api/validate' && req.method === 'POST') {
    const { type, path } = await readBody(req);
    try {
      if (type === 'spec') {
        const fm = frontMatter(path);
        const n = (fm.match(/\nname:\s*(.+)/) || [])[1]?.trim() || 'unnamed';
        return json({ ok: true, detail: `${n} · ${specColors(fm).size} colors` });
      }
      if (type === 'live') {
        if (!existsSync(resolve(path))) return json({ ok: false, detail: 'file not found' });
        return json({ ok: true, detail: `${liveColors(path).size} CSS token(s) found` });
      }
      if (type === 'sample') {
        if (!existsSync(resolve(path))) return json({ ok: false, detail: 'file not found', verdict: 'MISSING' });
        const cfg = loadConfig();
        const g = tokenGate(readFileSync(resolve(path), 'utf8'), cfg.spec);
        return json({ ok: true, detail: g.verdict, verdict: g.verdict });
      }
      if (type === 'judge') {
        const ok = claudeAvailable();
        return json({ ok, detail: ok ? 'claude CLI found on PATH' : 'claude CLI not found (judge stays optional)' });
      }
      return json({ ok: false, detail: 'unknown connector type' });
    } catch (e) { return json({ ok: false, detail: e.message }); }
  }

  if (url === '/api/connect' && req.method === 'POST') {
    const body = await readBody(req);
    const cfg = { ...defaults(), ...body };
    if (!Array.isArray(cfg.samples) || !cfg.samples.length) cfg.samples = defaults().samples;
    try {
      writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2) + '\n');
      lintCache = null; lintKey = '';
      return json({ ok: true });
    } catch (e) { return json({ ok: false, error: e.message }, 500); }
  }

  // Read a repo file for the inline editor.
  if (url === '/api/file' && req.method === 'GET') {
    const p = new URL(req.url, 'http://x').searchParams.get('path') || '';
    const file = resolve(p);
    if (!file.startsWith(REPO_ROOT)) return json({ ok: false, error: 'path outside repo' }, 400);
    if (!existsSync(file)) return json({ ok: false, error: 'file not found' });
    try { return json({ ok: true, content: readFileSync(file, 'utf8') }); }
    catch (e) { return json({ ok: false, error: e.message }); }
  }
  // Write a repo file from the inline editor.
  if (url === '/api/file' && req.method === 'POST') {
    const { path: p, content } = await readBody(req);
    const file = resolve(p || '');
    if (!file.startsWith(REPO_ROOT)) return json({ ok: false, error: 'path outside repo' }, 400);
    try { writeFileSync(file, String(content ?? '')); lintCache = null; lintKey = ''; return json({ ok: true }); }
    catch (e) { return json({ ok: false, error: e.message }, 500); }
  }
  // Serve a repo file as raw text (for "view css" / "view source" links).
  if (url === '/raw') {
    const p = new URL(req.url, 'http://x').searchParams.get('path') || '';
    const file = resolve(p);
    if (!file.startsWith(REPO_ROOT) || !existsSync(file)) { res.writeHead(404, { 'content-type': 'text/plain' }); return res.end('not found'); }
    res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' });
    return res.end(readFileSync(file));
  }
  // Open a repo file in the OS default editor.
  if (url === '/api/open' && req.method === 'POST') {
    const { path: p } = await readBody(req);
    const file = resolve(p || '');
    if (!file.startsWith(REPO_ROOT) || !existsSync(file)) return json({ ok: false, error: 'bad path' }, 400);
    const cmd = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start' : 'xdg-open';
    try { spawn(cmd, [file], { stdio: 'ignore', detached: true, shell: process.platform === 'win32' }).unref(); return json({ ok: true }); }
    catch (e) { return json({ ok: false, error: e.message }); }
  }

  if (url.startsWith('/sample/')) {
    const id = decodeURIComponent(url.slice('/sample/'.length));
    const cfg = loadConfig();
    const found = cfg.samples.find((s) => s.id === id);
    const file = found ? resolve(found.path) : null;
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
    return res.end(file && existsSync(file) ? readFileSync(file) : `<!doctype html><body style="font-family:monospace;color:#928e84;padding:20px">sample "${esc(id)}" not found`);
  }

  if (url === '/readme') {
    try { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' }); return res.end(readmePage()); }
    catch (e) { res.writeHead(500, { 'content-type': 'text/plain' }); return res.end('readme error: ' + e.message); }
  }

  if (/\.(png|jpe?g|svg|gif|webp)$/i.test(url)) {
    const file = join(REPO_ROOT, decodeURIComponent(url.replace(/^\/+/, '')));
    if (existsSync(file) && file.startsWith(REPO_ROOT)) {
      const ext = (url.match(/\.(\w+)$/) || [])[1].toLowerCase();
      const ct = ext === 'svg' ? 'image/svg+xml' : ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : 'image/' + ext;
      res.writeHead(200, { 'content-type': ct, 'cache-control': 'no-store' });
      return res.end(readFileSync(file));
    }
  }

  if (url === '/' || url === '/index.html') {
    try { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' }); return res.end(page()); }
    catch (e) { res.writeHead(500, { 'content-type': 'text/plain' }); return res.end('panel error: ' + e.message); }
  }
  res.writeHead(404, { 'content-type': 'text/plain' });
  res.end('not found');
});

// ---- Watch via mtime polling (robust to connector changes) -------------------

sig = currentSig();
setInterval(() => { const s = currentSig(); if (s !== sig) { sig = s; version++; } }, 500);

function openBrowser(u) {
  const cmd = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start' : 'xdg-open';
  try { spawn(cmd, [u], { stdio: 'ignore', detached: true, shell: process.platform === 'win32' }).unref(); } catch {}
}

server.listen(PORT, () => {
  const u = `http://localhost:${PORT}`;
  try { lint(loadConfig().spec); } catch {}
  console.log(`\n  design.md loop panel · from RSLVD\n  ${u}\n`);
  console.log(`  Add connectors in the panel to point it at your own project.`);
  console.log(`  Ctrl+C to stop.\n`);
  if (!process.env.NO_OPEN) openBrowser(u);
});
server.on('error', (e) => {
  if (e.code === 'EADDRINUSE') { console.error(`\n  Port ${PORT} is in use. Try: PORT=4174 npm start\n`); process.exit(1); }
  throw e;
});
