// Statische Prüfungen ohne Browser: eine Versionsnummer überall, Dateilisten von Service Worker
// und Start-Wächter vollständig, keine toten Exporte, Dateigrößen, Syntax.
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

module.exports = async (t) => {
  const R = (f) => fs.readFileSync(path.join(t.site, f), 'utf8');
  const js = fs.readdirSync(path.join(t.site, 'js')).filter(f => f.endsWith('.js')).sort();
  const css = fs.readdirSync(path.join(t.site, 'css')).filter(f => f.endsWith('.css')).sort();
  const html = R('index.html');
  const sw = R('sw.js');

  /* ---------- Version ---------- */
  const ver = (R('js/version.js').match(/APP_VERSION\s*=\s*'([^']+)'/) || [])[1];
  const meta = (html.match(/<meta name="app-version" content="([^"]+)"/) || [])[1];
  const swv = (sw.match(/const VERSION = 'v([^']+)'/) || [])[1];
  const log = (R('CHANGELOG.md').match(/^## (\S+)/m) || [])[1];
  t.ok('Version: js/version.js = index.html = sw.js = CHANGELOG', ver && ver === meta && ver === swv && ver === log, JSON.stringify({ ver, meta, swv, log }));
  t.ok('Version steht nur in js/version.js (kein zweites APP_VERSION = …)', js.filter(f => f !== 'version.js' && /APP_VERSION\s*=\s*'/.test(R('js/' + f))).length === 0);

  /* ---------- Dateilisten ---------- */
  const assets = [...sw.matchAll(/'\.\/([^']*)'/g)].map(m => m[1]);
  const need = [...js.map(f => 'js/' + f), ...css.map(f => 'css/' + f), 'index.html', 'manifest.webmanifest'];
  const miss = need.filter(f => !assets.includes(f));
  const dead = assets.filter(f => f && !fs.existsSync(path.join(t.site, f)));
  t.ok('sw.js: ASSETS enthält alle js/*.js und css/*.css', miss.length === 0, miss.join(', '));
  t.ok('sw.js: jede Datei in ASSETS existiert', dead.length === 0, dead.join(', '));
  const wd = (html.match(/var files = \[([\s\S]*?)\];/) || [])[1] || '';
  const watch = [...wd.matchAll(/'\.\/([^']+)'/g)].map(m => m[1]);
  const wmiss = need.filter(f => f !== 'index.html' && !watch.includes(f));
  const wdead = watch.filter(f => !fs.existsSync(path.join(t.site, f)));
  t.ok('Start-Wächter (index.html): Liste vollständig', watch.length > 0 && wmiss.length === 0 && wdead.length === 0, [...wmiss, ...wdead].join(', '));

  // modulepreload in index.html = genau die Module, die app.js beim Start (statisch) lädt.
  const graph = new Set();
  const walk = (f) => {
    if (graph.has(f)) return;
    graph.add(f);
    for (const m of R('js/' + f).matchAll(/^(?:import|export)\s[^;]*?from\s+'\.\/([\w-]+\.js)';/gm)) walk(m[1]);
  };
  walk('app.js');
  const pre = [...html.matchAll(/<link rel="modulepreload" href="\.\/js\/([\w-]+\.js)">/g)].map(m => m[1]);
  const preMiss = [...graph].filter(f => !pre.includes(f));
  const preExtra = pre.filter(f => !graph.has(f));
  t.ok('index.html: modulepreload = Start-Module von app.js', preMiss.length === 0 && preExtra.length === 0, `fehlt: ${preMiss.join(', ')} zu viel: ${preExtra.join(', ')}`);

  /* ---------- Tote Exporte ---------- */
  const src = Object.fromEntries(js.map(f => [f, R('js/' + f)]));
  const deadExp = [];
  for (const [f, s] of Object.entries(src)) {
    const names = [...s.matchAll(/^export\s+(?:async\s+)?(?:function\*?|const|let|class)\s+([A-Za-z_$][\w$]*)/gm)].map(m => m[1]);
    for (const n of names) {
      const re = new RegExp(`(?<![\\w$])${n.replace(/\$/g, '\\$')}(?![\\w$])`);
      const used = Object.entries(src).some(([g, s2]) => g !== f && re.test(s2)) || re.test(html);
      if (!used) deadExp.push(`${f}:${n}`);
    }
  }
  t.ok('Keine toten Exporte', deadExp.length === 0, deadExp.join(', '));

  /* ---------- Aufgeräumt ---------- */
  const lines = (f) => R(f).split('\n').length - (R(f).endsWith('\n') ? 1 : 0);
  const big = js.filter(f => lines('js/' + f) > 650).map(f => `${f} (${lines('js/' + f)})`);
  t.ok('js/app.js höchstens 400 Zeilen', lines('js/app.js') <= 400, String(lines('js/app.js')));
  t.ok('Keine JS-Datei über 650 Zeilen', big.length === 0, big.join(', '));
  // „backdrop-filter“ enthält „drop-“ und ist gewollt (Glas) – gezählt wird alles andere.
  const drops = [R('js/motion.js'), ...css.map(f => R('css/' + f))].join('\n').match(/ripple|(?<!back)drop-|drop-run/g) || [];
  t.ok('Kein Wassertropfen-Code mehr (motion.js, CSS)', drops.length === 0, drops.join(', '));

  /* ---------- Syntax ---------- */
  // Module als .mjs prüfen (unabhängig davon, wie Node .js gerade auslegt), sw.js als klassisches Skript.
  const bad = [];
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'heim-check-'));
  const check = (file, label) => {
    try { execFileSync(process.execPath, ['--check', file], { stdio: 'pipe' }); } catch (e) { bad.push(`${label}: ${String(e.stderr || e.message).split('\n').slice(0, 4).join(' ')}`); }
  };
  for (const f of js) {
    const m = path.join(tmp, f.replace(/\.js$/, '.mjs'));
    fs.copyFileSync(path.join(t.site, 'js', f), m);
    check(m, 'js/' + f);
  }
  check(path.join(t.site, 'sw.js'), 'sw.js');
  // Inline-Skript in index.html (Rettung, Start-Wächter) – muss auch ohne Module laufen.
  const inline = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]).join('\n;\n');
  fs.writeFileSync(path.join(tmp, 'inline.js'), inline);
  check(path.join(tmp, 'inline.js'), 'index.html <script>');
  fs.rmSync(tmp, { recursive: true, force: true });
  t.ok('node --check: alle Skripte fehlerfrei (auch das Inline-Skript)', bad.length === 0, bad.join(' | '));
};
