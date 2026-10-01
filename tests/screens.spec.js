// Bildschirmfotos aller Hauptansichten, hell und dunkel, mit dem großen Testbestand – zum
// Durchsehen oder für einen Vorher/Nachher-Vergleich (zweiter Lauf mit --rev <alter Commit>).
// Nur auf Wunsch:  node tests/run.js screens [--out Verzeichnis] [--rev …]
'use strict';
const fs = require('fs');
const path = require('path');
const A = require('./lib/app.js');

module.exports = async (t) => {
  fs.mkdirSync(t.out, { recursive: true });
  for (const dark of [false, true]) {
    const mode = dark ? 'dark' : 'light';
    const { ctx, page, errs } = await A.open(t, { dark, deviceScaleFactor: 2 });
    // Feste Uhrzeit (Donnerstagabend): Begrüßung, Datum und „seit 4 Tagen“ sind bei jedem Lauf gleich.
    await ctx.clock.setFixedTime(new Date(process.env.SCREENS_TIME || '2026-10-01T19:30:00+02:00'));
    await A.start(t, page, { seed: 'full', photoW: 1200 });
    await A.sleep(1500);
    const shots = [];
    const shot = async (name, wait = 900) => {
      await A.sleep(wait);
      await page.screenshot({ path: path.join(t.out, `${name}-${mode}.png`) });
      shots.push(name);
    };
    const scroll = (v, y) => page.evaluate(([v, y]) => { const s = document.querySelector(`#view-${v} .scroll`); s.scrollTop = y === 'end' ? s.scrollHeight : y; }, [v, y]);
    const tap = async (sel, wait = 700) => { await page.locator(sel).first().click(); await A.sleep(wait); };

    await shot('10-start');
    await tap('#home-todo [data-todo-all]'); await shot('11-wichtig-blatt'); await A.closeSheet(page);
    await A.tab(page, 'list'); await shot('20-alles');
    await scroll('list', 'end'); await shot('20-alles-ende'); await scroll('list', 0);
    await A.search(page, 'kabel'); await shot('21-alles-suche'); await A.search(page, '');
    await tap('#list-archive'); await shot('33-papierkorb'); await A.back(page);
    await A.tab(page, 'orte'); await shot('40-orte');
    await scroll('orte', 'end'); await shot('40-orte-ende'); await scroll('orte', 0);
    await tap('#orte-add'); await shot('41-orte-plus'); await A.closeSheet(page);
    await tap('#orte-list [data-place-menu]'); await shot('41-ort-menue'); await A.closeSheet(page);
    await page.locator('#orte-list [data-room]').nth(4).click(); await shot('43-raum'); await A.back(page);
    await tap('#orte-list [data-nav="noplace"]'); await shot('42-ohne-ort'); await A.back(page);
    await A.tab(page, 'list');
    await A.search(page, 'Kaffee');
    await page.locator('#list .row .body').first().click(); await shot('30-eintrag');
    await A.back(page); await A.search(page, '');
    await A.tab(page, 'add'); await shot('50-hinzufuegen');
    await page.click('#cap-done').catch(() => {}); await A.sleep(500);
    await A.tab(page, 'docs'); await shot('60-dokumente', 1400);
    await tap('#docs-new'); await shot('62-dokumente-plus'); await A.closeSheet(page);
    await tap('#docs-list [data-folder]'); await shot('61-ordner');
    await A.tab(page, 'docs');
    await A.tab(page, 'home');
    await tap('#home-settings'); await shot('70-einstellungen');
    await scroll('settings', 700); await shot('70-einstellungen-2');
    await scroll('settings', 0);
    await A.back(page);
    await page.evaluate(() => { document.querySelector('#update-bar').hidden = false; document.body.classList.add('has-update'); });
    await shot('81-update-leiste');
    t.ok(`Bildschirmfotos ${mode}: ${shots.length} nach ${t.out}`, shots.length >= 20 && errs.length === 0, errs.join(' | '));
  }
};
