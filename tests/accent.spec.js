// Akzentfarbe (2.1): acht Farben, je hell und dunkel.
//   statisch   alle Farbpaare aus css/tokens.css ≥ 4,5 : 1 (Schrift auf Akzent, Akzent-Schrift auf
//              Hintergrund/Karte/Tönung, Tinte auf Tönung)
//   Laufzeit   Auswahl in Einstellungen → Darstellung wirkt sofort, wird gespeichert (Einstellungen +
//              localStorage-Spiegel), steht nach dem Neuladen schon vor app.js; Terrakotta bleibt;
//              Kontrast-Prüfung aus a11y.spec.js auf Start, Alles und Einstellungen in jeder Farbe.
'use strict';
const fs = require('fs');
const path = require('path');
const A = require('./lib/app.js');
const { audit, report } = require('./a11y.spec.js');

const IDS = ['tanne', 'blau', 'indigo', 'lila', 'himbeer', 'orange', 'senf', 'graphit'];

const lum = (h) => {
  const c = [0, 2, 4].map((i) => parseInt(h.slice(1 + i, 3 + i), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
};
const ratio = (a, b) => { const x = lum(a); const y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
const vars = (block) => Object.fromEntries([...block.matchAll(/--([\w-]+):\s*(#[0-9A-Fa-f]{6})\b/g)].map((m) => [m[1], m[2]]));

module.exports = async (t) => {
  /* ---------- Statisch: Farbpaare ---------- */
  const css = fs.readFileSync(path.join(t.site, 'css/tokens.css'), 'utf8');
  const darkAt = css.indexOf('@media (prefers-color-scheme: dark){\n  :root,[data-accent="tanne"]');
  const light = css.slice(0, darkAt);
  const dark = css.slice(darkAt);
  const neutral = { light: vars(light.slice(0, light.indexOf('@media'))), dark: vars(css.slice(css.indexOf('@media (prefers-color-scheme: dark)'), css.indexOf('Akzentfarben'))) };
  const low = [];
  let found = 0;
  for (const [mode, src] of [['hell', light], ['dunkel', dark]]) {
    const n = mode === 'hell' ? neutral.light : neutral.dark;
    for (const id of IDS) {
      const m = src.match(new RegExp(`\\[data-accent="${id}"\\]\\{([^}]*)\\}`));
      if (!m) { low.push(`${id} ${mode}: fehlt`); continue; }
      found++;
      const v = vars(m[1]);
      const pairs = {
        'Schrift auf Akzent': [v['on-accent'], v.accent], 'Schrift auf gedrücktem Akzent': [v['on-accent'], v['accent-press']],
        'Akzent-Schrift auf Hintergrund': [v['accent-text'], n.bg], 'Akzent-Schrift auf Karte': [v['accent-text'], n.surface],
        'Akzent-Schrift auf Fläche 2': [v['accent-text'], n['surface-2']], 'Akzent-Schrift auf Tönung': [v['accent-text'], v['accent-tint']],
        'Tinte auf Tönung': [v['accent-ink'], v['accent-tint']],
      };
      for (const [name, [fg, bg]] of Object.entries(pairs)) {
        const r = fg && bg ? ratio(fg, bg) : 0;
        if (r < 4.5) low.push(`${id} ${mode} ${name}: ${r.toFixed(2)}`);
      }
    }
  }
  t.ok('Akzentfarben: 8 × hell + dunkel definiert', found === 16, String(found));
  t.ok('Akzentfarben: alle Paare ≥ 4,5 : 1', low.length === 0, low.join(' | '));
  t.ok('Terrakotta (--clay) nicht in den Akzent-Blöcken', !/\[data-accent="[a-z]+"\]\{[^}]*--clay/.test(css));

  /* ---------- Laufzeit ---------- */
  for (const darkMode of [false, true]) {
    const mode = darkMode ? 'dunkel' : 'hell';
    const { page, errs } = await A.open(t, { dark: darkMode });
    await A.start(t, page, { seed: 'full', photoW: 200 });
    await A.sleep(300);
    const clay0 = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--clay').trim());
    // Tannengrün ist Standard – zuletzt, damit auch die Rückkehr geprüft wird.
    for (const id of [...IDS.slice(1), 'tanne']) {
      await A.tab(page, 'settings');
      await page.evaluate(() => document.querySelector('[data-spage-go="look"]').click());
      await A.sleep(300);
      await page.evaluate((id) => document.querySelector(`#acc-row [data-accent="${id}"]`).click(), id);
      await A.sleep(250);
      const st = await page.evaluate(async () => {
        const db = await import('./js/db.js');
        const s = await db.loadSettings();
        const cs = getComputedStyle(document.documentElement);
        let ls = null; try { ls = localStorage.getItem('inventar-akzent'); } catch (_) { void _; }
        return {
          attr: document.documentElement.getAttribute('data-accent'), ls, saved: s.accent,
          checked: [...document.querySelectorAll('#acc-row [aria-checked="true"]')].map((b) => b.dataset.accent),
          accent: cs.getPropertyValue('--accent').trim(), clay: cs.getPropertyValue('--clay').trim(),
          nav: getComputedStyle(document.querySelector('#nav .fab')).backgroundColor,
        };
      }, id);
      t.ok(`Akzent ${id} ${mode}: sofort aktiv, gespeichert, gespiegelt, ein Häkchen`,
        (id === 'tanne' ? st.attr === null : st.attr === id) && st.ls === id && st.saved === id && st.checked.length === 1 && st.checked[0] === id, JSON.stringify(st));
      t.ok(`Akzent ${id} ${mode}: Terrakotta bleibt`, st.clay === clay0, st.clay);
      report(t, `Akzent ${id} ${mode} · Darstellung`, await audit(page, { scope: ['#view-settings', '#nav'], contrastOnly: true }), { contrastOnly: true });
      await A.back(page);
      report(t, `Akzent ${id} ${mode} · Einstellungen`, await audit(page, { scope: ['#view-settings', '#nav'], contrastOnly: true }), { contrastOnly: true });
      await A.tab(page, 'home');
      report(t, `Akzent ${id} ${mode} · Start`, await audit(page, { scope: ['#view-home', '#nav'], contrastOnly: true }), { contrastOnly: true });
      await A.tab(page, 'list');
      report(t, `Akzent ${id} ${mode} · Alles`, await audit(page, { scope: ['#view-list', '#nav'], contrastOnly: true }), { contrastOnly: true });
    }
    // Neu laden: die Farbe steht schon, bevor app.js läuft (kein Aufblitzen).
    if (!darkMode) {
      await A.tab(page, 'settings');
      await page.evaluate(() => document.querySelector('[data-spage-go="look"]').click());
      await A.sleep(300);
      await page.evaluate(() => document.querySelector('#acc-row [data-accent="lila"]').click());
      await A.sleep(250);
      await page.addInitScript(() => {
        document.addEventListener('DOMContentLoaded', () => { window.__accentAtDom = document.documentElement.getAttribute('data-accent'); });
      });
      await page.reload();
      await A.ready(page);
      const early = await page.evaluate(() => window.__accentAtDom);
      t.ok('Akzent: nach dem Neuladen schon vor dem App-Start gesetzt', early === 'lila', String(early));
      const theme = await page.evaluate(() => [...document.querySelectorAll('meta[name="theme-color"]')].map((m) => m.content));
      t.ok('theme-color = Hintergrund (hell #F6F5F2, dunkel #0F0F0E)', theme.join() === '#F6F5F2,#0F0F0E', theme.join());
    }
    t.ok(`Akzent ${mode}: ohne Konsolenfehler`, errs.length === 0, errs.join(' | '));
  }
};
