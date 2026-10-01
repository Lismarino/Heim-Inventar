#!/usr/bin/env node
// Testlauf ohne Build und ohne npm install:  node tests/run.js [Namen …] [Optionen]
//
//   node tests/run.js                 alle Prüfungen (*.spec.js) gegen den Arbeitsstand
//   node tests/run.js flows backup    nur Dateien, deren Name das Wort enthält
//   node tests/run.js --rev HEAD      gegen eine git-archive-Kopie eines Commits statt der Dateien
//   node tests/run.js screens --out D Bildschirmfotos (hell/dunkel) nach D (Standard tests/out/)
//
// Startet selbst einen statischen Server (lib/server.js) und Chromium (lib/pw.js), führt die
// Prüfungen nacheinander aus und beendet am Ende alles. Exit-Code 1, wenn etwas fehlschlägt.
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { serve } = require('./lib/server.js');
const { launch } = require('./lib/pw.js');

const ROOT = path.resolve(__dirname, '..');
const args = process.argv.slice(2);
const opt = (name) => { const i = args.indexOf(name); if (i < 0) return null; const v = args[i + 1]; args.splice(i, 2); return v; };
const rev = opt('--rev');
const out = path.resolve(opt('--out') || path.join(__dirname, 'out'));
const only = args.filter((a) => !a.startsWith('--'));

/** git archive <rev> in ein temporäres Verzeichnis; null, wenn es den Commit nicht gibt. */
function archive(r) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'heim-inventar-' + r.replace(/\W/g, '') + '-'));
  try {
    const tar = execFileSync('git', ['-C', ROOT, 'archive', '--format=tar', r], { maxBuffer: 1 << 28, stdio: ['ignore', 'pipe', 'ignore'] });
    execFileSync('tar', ['-x', '-C', dir], { input: tar });
    return dir;
  } catch (_) {
    fs.rmSync(dir, { recursive: true, force: true });
    return null;
  }
}

(async () => {
  const specs = fs.readdirSync(__dirname).filter((f) => f.endsWith('.spec.js')).sort()
    // Bildschirmfotos nur auf Wunsch.
    .filter((f) => (only.length ? only.some((o) => f.includes(o)) : !f.startsWith('screens')));
  if (!specs.length) { console.error('Keine passenden Prüfungen.'); process.exit(2); }

  const temps = [];
  let site = ROOT;
  if (rev) {
    site = archive(rev);
    if (!site) { console.error(`git archive ${rev} fehlgeschlagen.`); process.exit(2); }
    temps.push(site);
  }
  const server = await serve(site);
  const browser = await launch();
  const contexts = new Set();
  const results = [];
  let current = '';
  const t = {
    browser, url: server.url, root: ROOT, site, out, server,
    sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
    ok(name, cond, info = '') {
      results.push({ spec: current, name, pass: !!cond, info });
      console.log(`  ${cond ? 'ok  ' : 'FEHLER'} ${name}${info && !cond ? ' — ' + String(info).slice(0, 400) : info ? ' — ' + String(info).slice(0, 160) : ''}`);
      return !!cond;
    },
    skip(name, why) { results.push({ spec: current, name, pass: true, skipped: true }); console.log(`  --   ${name} (übersprungen: ${why})`); },
    track(ctx) { contexts.add(ctx); ctx.on('close', () => contexts.delete(ctx)); },
    /** Alte Fassung (Commit) als Verzeichnis – oder null (z. B. flacher Klon ohne Verlauf). */
    archive(r) { const d = archive(r); if (d) temps.push(d); return d; },
  };

  const t0 = Date.now();
  for (const f of specs) {
    current = f.replace(/\.spec\.js$/, '');
    console.log(`\n▶ ${current}`);
    const spec = require(path.join(__dirname, f));
    const s0 = Date.now();
    try {
      await spec(t);
    } catch (e) {
      t.ok(`${current}: lief ohne Ausnahme durch`, false, (e && e.stack) || e);
    }
    for (const c of [...contexts]) await c.close().catch(() => {});
    server.setRoot(site);
    console.log(`  (${((Date.now() - s0) / 1000).toFixed(1)} s)`);
  }

  await browser.close().catch(() => {});
  await server.close();
  for (const d of temps) fs.rmSync(d, { recursive: true, force: true });

  const failed = results.filter((r) => !r.pass);
  const skipped = results.filter((r) => r.skipped).length;
  console.log(`\n${results.length} Prüfungen, ${failed.length} fehlgeschlagen${skipped ? `, ${skipped} übersprungen` : ''} – ${((Date.now() - t0) / 1000).toFixed(0)} s`);
  for (const r of failed) console.log(`  FEHLER [${r.spec}] ${r.name}`);
  process.exit(failed.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
