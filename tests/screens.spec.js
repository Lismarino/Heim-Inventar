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

    await shot('10-start');
    await scroll('home', 700); await shot('10-start-mitte'); await scroll('home', 0);
    await A.tab(page, 'list'); await shot('20-alles');
    await A.tab(page, 'places'); await shot('40-raeume');
    await page.locator('#places-grid [data-room]').nth(4).click(); await shot('43-raum'); await A.back(page);
    await page.locator('#places-grid .rt', { hasText: 'Ohne Ort' }).first().click(); await shot('42-ohne-ort'); await A.back(page);
    await A.tab(page, 'list');
    await A.search(page, 'Kaffee');
    await page.locator('#list .row .body').first().click(); await shot('30-eintrag');
    await page.evaluate(() => { document.querySelector('#it-more').open = true; }); await scroll('item', 'end'); await shot('30-eintrag-ende');
    await scroll('item', 0);
    await page.click('#it-out-set'); await shot('31-unterwegs-blatt');
    await A.closeSheet(page);
    await A.back(page); await A.search(page, '');
    await A.tab(page, 'add'); await shot('50-hinzufuegen');
    await page.click('#cap-done').catch(() => {}); await A.sleep(500);
    await A.tab(page, 'home');
    await page.click('#home-docs'); await shot('60-dokumente');
    await page.click('#docs-new'); await shot('65-dokument-neu'); await A.back(page);
    await A.tab(page, 'settings'); await shot('70-einstellungen');
    await scroll('settings', 700); await shot('70-einstellungen-2');
    await scroll('settings', 1400); await shot('70-einstellungen-3');
    await scroll('settings', 0);
    await A.tab(page, 'home');
    await page.evaluate(() => { document.querySelector('#update-bar').hidden = false; document.body.classList.add('has-update'); });
    await shot('81-update-leiste');
    t.ok(`Bildschirmfotos ${mode}: ${shots.length} nach ${t.out}`, shots.length >= 16 && errs.length === 0, errs.join(' | '));
  }
};
