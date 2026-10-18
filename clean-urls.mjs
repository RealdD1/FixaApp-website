// Dry run:  node clean-urls.mjs
// Apply:    node clean-urls.mjs --write
import fs from 'fs';
import path from 'path';
import { execFileSync } from 'child_process';

const WRITE = process.argv.includes('--write');

// old file name (no .html) -> clean slug. Anything not listed keeps its own name.
const RENAMES = {
  'SignIn': 'signin',
  'Signup': 'signup',
  'artisan booking history': 'artisan-booking-history',
  'artisan test': 'artisan-home',
  'customer booking history': 'customer-booking-history',
  'customer payment method': 'customer-payment-method',
  'customer-chat page': 'customer-chat-page',
  'fixa_customer_app': 'fixa-customer-app',
  'help and support': 'help-and-support',
  'payout settings': 'payout-settings',
  'security&privacy': 'security-privacy',
  // 'fixa landing page': 'landing',   // only if you still use it, otherwise delete the file
};

const EXT = new Set(['.html', '.js', '.json', '.webmanifest']);
const SKIP = new Set(['.git', 'node_modules']);
const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function* walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP.has(e.name)) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) yield* walk(p);
    else if (EXT.has(path.extname(e.name)) && e.name !== 'clean-urls.mjs') yield p;
  }
}

const slugOf = n => (n === 'index' ? '' : RENAMES[n] ?? n);
let pages = fs.readdirSync('.').filter(f => f.endsWith('.html')).map(f => f.slice(0, -5));

const bad = pages.filter(n => n !== 'index' && !/^[a-z0-9-]+$/.test(slugOf(n)));
if (bad.length) {
  console.warn('⚠️  Skipping (add to RENAMES to include):', bad.map(b => b + '.html').join(', '));
  pages = pages.filter(n => !bad.includes(n));
}

// ── 1. rewrite references ─────────────────────────────────────
function variants(n) {
  const v = new Set();
  for (const x of [n, n.replaceAll(' ', '%20')]) { v.add(x); v.add(x.replaceAll('&', '&amp;')); }
  return [...v];
}
const rules = [];
for (const n of [...pages].sort((a, b) => b.length - a.length)) {
  for (const v of variants(n)) {
    rules.push([
      new RegExp('(?<![\\w\\-.%/])(?:\\.?/)?' + esc(v) + '\\.html(?![\\w-])', 'gi'),
      '/' + slugOf(n),
    ]);
  }
}
for (const f of walk('.')) {
  const src = fs.readFileSync(f, 'utf8');
  let out = src;
  for (const [re, to] of rules) out = out.replace(re, to);
  if (out !== src) {
    console.log('update ', f);
    if (WRITE) fs.writeFileSync(f, out);
  }
}

// ── 2. rename files (two-step so case-only renames work on Windows) ──
for (const n of pages) {
  const slug = slugOf(n);
  if (!slug || slug === n) continue;
  console.log(`rename  ${n}.html -> ${slug}.html`);
  if (WRITE) {
    execFileSync('git', ['mv', `${n}.html`, `${slug}.tmp`]);
    execFileSync('git', ['mv', `${slug}.tmp`, `${slug}.html`]);
  }
}

// ── 3. generate Render routes ─────────────────────────────────
const q = JSON.stringify;
const lines = ['    routes:'];
const rewrites = [];
for (const n of pages) {
  const slug = slugOf(n);
  const olds = new Set([n, n.replaceAll(' ', '%20')]);
  if (slug) olds.add(slug);
  for (const o of olds)
    lines.push('      - type: redirect', `        source: ${q(`/${o}.html`)}`, `        destination: ${q('/' + slug)}`);
  if (slug)
    rewrites.push('      - type: rewrite', `        source: ${q('/' + slug)}`, `        destination: ${q(`/${slug}.html`)}`);
}
fs.writeFileSync('render-routes.yaml', [...lines, ...rewrites].join('\n') + '\n');
console.log(WRITE ? '\nDone. Routes written to render-routes.yaml' : '\nDry run only. Re-run with --write to apply.');