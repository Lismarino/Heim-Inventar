// Rauchtest: Start (leer und mit Daten), alle Ansichten ohne Konsolenfehler, Offline-Start mit
// Service Worker, Startfehler-Seite bei fehlender Datei.
'use strict';
const A = require('./lib/app.js');
const { seedMini } = require('./lib/seed.js');

module.exports = async (t) => {
  /* ---------- Kaltstart leer: Start-Szene, Einführung, alle Tabs ---------- */
  {
    const { page, errs } = await A.open(t, { reduced: false });
    await page.goto(t.url);
    await A.ready(page);
    const v = await page.evaluate(() => ({ js: window.__inventarVersion, meta: document.querySelector('meta[name="app-version"]').content, about: document.getElementById('ver-info').textContent }));
    t.ok('Version: Skript = index.html = „Über“', v.js && v.js === v.meta && v.about.endsWith(v.js), JSON.stringify(v));
    await A.sleep(1200);
    t.ok('Erster Start zeigt die Einführung', await page.isVisible('#onboarding'));
    await page.click('#onb-skip');
    await A.sleep(900);
    t.ok('Einführung überspringen → Start', !(await page.isVisible('#onboarding')) && (await A.view(page)) === 'home');
    for (const v of ['list', 'orte', 'add', 'docs', 'settings', 'home']) await A.tab(page, v);
    t.ok('Leer: alle Tabs ohne Konsolenfehler', errs.length === 0, errs.join(' | '));
  }

  /* ---------- Mit Daten: jede Ansicht einmal ---------- */
  {
    const { page, errs } = await A.open(t);
    await A.start(t, page, { seed: 'mini' });
    const seen = [];
    for (const v of ['list', 'orte', 'add', 'docs', 'settings', 'home']) { await A.tab(page, v); seen.push(await A.view(page)); }
    await A.tab(page, 'list');
    await A.openRow(page, 'Teekanne'); seen.push(await A.view(page));
    await A.back(page);
    await A.tab(page, 'orte');
    await page.locator('#orte-list [data-room]').first().click(); await A.sleep(600); seen.push(await A.view(page));
    await A.back(page);
    await page.locator('#orte-list [data-nav="noplace"]').first().click(); await A.sleep(600); seen.push(await A.view(page));
    await A.tab(page, 'list');
    await page.evaluate(() => { const s = document.querySelector('#view-list .scroll'); s.scrollTop = s.scrollHeight; });
    await A.sleep(300);
    await page.click('#list-archive'); await A.sleep(600); seen.push(await A.view(page));
    await A.tab(page, 'docs'); await A.sleep(500);
    await page.click('#docs-new'); await A.sleep(500);
    await A.sheetAction(page, 'Neuer Ordner');
    await page.fill('#sheet-input', 'Steuer'); await A.sheetSubmit(page);
    await page.locator('#docs-list [data-folder]').first().click(); await A.sleep(400); seen.push(await A.view(page) + ':' + await page.textContent('#docs-title'));
    t.ok('Mit Daten: alle Ansichten erreichbar', seen.join() === 'list,orte,add,docs,settings,home,item,room,noplace,archive,docs:Steuer', seen.join());
    t.ok('Mit Daten: ohne Konsolenfehler', errs.length === 0, errs.join(' | '));
  }

  /* ---------- Offline-Start mit Service Worker ---------- */
  {
    const { ctx, page, errs } = await A.open(t, { sw: true });
    await page.goto(t.url);
    await A.ready(page);
    await seedMini(page);
    await page.evaluate(() => navigator.serviceWorker.ready);
    await page.reload();
    await A.ready(page);
    const st = await page.evaluate(async () => {
      const names = await caches.keys();
      const c = await caches.open(names.find(n => n.startsWith('heim-inventar-')));
      const keys = (await c.keys()).map(r => new URL(r.url).pathname);
      return { names, n: keys.length, keys, controlled: !!navigator.serviceWorker.controller };
    });
    const want = `heim-inventar-v${await page.evaluate(() => window.__inventarVersion)}`;
    t.ok('Service Worker steuert die Seite, Cache trägt die Version', st.controlled && st.names.includes(want), JSON.stringify(st.names));
    await ctx.setOffline(true);
    await page.reload();
    let up = true;
    try { await A.ready(page, 15000); } catch (_) { up = false; }
    t.ok('Offline: App startet aus dem Cache', up);
    for (const v of ['list', 'orte', 'settings', 'home']) await A.tab(page, v);
    // Bei Bedarf geladene Module (Aktenschrank) kommen offline ebenfalls aus dem Cache.
    await A.tab(page, 'docs'); await A.sleep(900);
    t.ok('Offline: Dokumente (bei Bedarf geladen) öffnen', (await A.view(page)) === 'docs' && await page.isVisible('#docs-list .row, #docs-empty'));
    t.ok('Offline: ohne Konsolenfehler', errs.length === 0, errs.join(' | '));
    await ctx.setOffline(false);
  }

  /* ---------- Startfehler: eine Datei fehlt ---------- */
  {
    const { ctx, page } = await A.open(t);
    await ctx.route('**/js/home.js', (r) => r.fulfill({ status: 404, body: 'weg' }));
    await page.goto(t.url);
    await page.waitForSelector('#boot-error:not([hidden])', { timeout: 15000 }).catch(() => {});
    await page.waitForFunction(() => /home\.js/.test(document.getElementById('boot-error-detail').textContent), null, { timeout: 8000 }).catch(() => {});
    const detail = await page.textContent('#boot-error-detail').catch(() => '');
    t.ok('Startfehler-Seite nennt die fehlende Datei', (await page.isVisible('#boot-error')) && /home\.js/.test(detail), detail);
  }
};
