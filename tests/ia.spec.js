// Informationsarchitektur 2.0 (Abnahme AP 2): Leiste Start · Alles · Kamera · Orte · Dokumente,
// Einstellungen über ⚙, Start ≤ 1,1 und Orte ≤ 2 Bildschirmhöhen mit dem großen Testbestand,
// „Wichtig“ mit höchstens drei Zeilen und Blatt „Alle anzeigen“, Dokumente in einem Tipp von überall
// mit richtig markiertem Tab, keine doppelten Einstiege mehr, Papierkorb, Zurückwischen,
// gemerkte Einstellungen (homePlace) und Papierkorb-Einträge aus älteren Fassungen.
'use strict';
const A = require('./lib/app.js');

module.exports = async (t) => {
  const { page, errs } = await A.open(t);
  await A.start(t, page, { seed: 'full', photoW: 240 });
  await A.sleep(600);
  const H = await page.evaluate(() => window.innerHeight);
  const screens = (v) => page.evaluate((v) => { const s = document.querySelector(`#view-${v} .scroll`); return s.scrollHeight / window.innerHeight; }, v);

  /* ---------- Leiste ---------- */
  const bar = await page.evaluate(() => [...document.querySelectorAll('#nav button')].map(b => b.dataset.nav));
  t.ok('Leiste: Start · Alles · Kamera · Orte · Dokumente', bar.join() === 'home,list,add,orte,docs', bar.join());
  const labels = await page.evaluate(() => [...document.querySelectorAll('#nav button span:not(.fab)')].map(s => ({ t: s.textContent, cut: s.scrollWidth > s.clientWidth + 1 })));
  t.ok('Leiste: Beschriftungen passen ganz hinein', labels.every(l => !l.cut), JSON.stringify(labels));

  /* ---------- Start ---------- */
  const home = await screens('home');
  t.ok('Start mit Testdaten ≤ 1,1 Bildschirmhöhen', home <= 1.1, `${home.toFixed(2)} × ${H}px`);
  const st = await page.evaluate(() => ({
    rows: document.querySelectorAll('#home-todo .todo-row').length,
    more: !!document.querySelector('#home-todo [data-todo-all]'),
    old: ['#home-docs', '#home-rooms', '#home-rooms-sec', '#home-backup', '#home-place-hint', '#home-places [data-place-add]'].filter(s => document.querySelector(s)),
    gear: !!document.querySelector('#home-settings'),
  }));
  t.ok('Start: „Wichtig“ mit höchstens 3 Zeilen und „Alle anzeigen“', st.rows <= 3 && st.rows > 0 && st.more, JSON.stringify(st));
  t.ok('Start: keine Raum-Kacheln, keine Dokumente-Karte, kein „Ort hinzufügen“, keine eigene Sicherungs-Karte', st.old.length === 0, st.old.join(', '));
  await page.click('#home-todo [data-todo-all]');
  await A.sleep(600);
  const all = await page.evaluate(() => [...document.querySelectorAll('#sheet .todo-list .todo-row')].map(r => r.textContent.replace(/\s+/g, ' ').trim()));
  t.ok('„Alle anzeigen“: Blatt mit allen Punkten (ohne Ort, unbenannt, unterwegs, Fristen, Garantie, Sicherung)',
    all.length >= 6 && ['ohne Ort', 'unbenannt', 'unterwegs', 'Garantie: Laptop', 'Sicherung'].every(w => all.some(r => r.includes(w))), all.join(' | '));
  await page.locator('#sheet .todo-row', { hasText: 'ohne Ort' }).click();
  await A.sleep(700);
  t.ok('Blatt-Zeile „ohne Ort“ führt zu „Ohne Ort“ (Tab Start bleibt markiert)', (await A.view(page)) === 'noplace' && (await A.activeTab(page)) === 'home');
  await A.swipeBack(page);
  t.ok('Zurückwischen aus „Ohne Ort“ → Start', (await A.view(page)) === 'home');

  /* ---------- Einstellungen über ⚙ ---------- */
  await page.click('#home-settings');
  await A.sleep(600);
  t.ok('⚙ öffnet die Einstellungen als Push-Ansicht, Start bleibt markiert', (await A.view(page)) === 'settings' && (await A.activeTab(page)) === 'home');
  await A.swipeBack(page);
  t.ok('Zurückwischen aus den Einstellungen → Start', (await A.view(page)) === 'home');

  /* ---------- Orte ---------- */
  await A.tab(page, 'orte');
  const orte = await screens('orte');
  const o = await page.evaluate(() => ({
    rooms: document.querySelectorAll('#orte-list .orow[data-room]').length,
    places: document.querySelectorAll('#orte-list .ogroup-head').length,
    noplace: document.querySelector('#orte-list [data-nav="noplace"]')?.textContent.replace(/\s+/g, ' ').trim() || '',
    dashed: document.querySelectorAll('#orte-list .rt-add, #orte-list .place-add').length,
  }));
  t.ok('Orte: 3 Orte, 11 Räume ≤ 2 Bildschirmhöhen', o.places === 3 && o.rooms === 11 && orte <= 2, `${orte.toFixed(2)} Bildschirme, ${JSON.stringify(o)}`);
  t.ok('Orte: oben „Ohne Ort (4)“, keine gestrichelten Hinzufügen-Kacheln', /Ohne Ort 4/.test(o.noplace) && o.dashed === 0, o.noplace);
  await page.click('#orte-add');
  await A.sleep(500);
  const plus = await page.evaluate(() => [...document.querySelectorAll('#sheet .sheet-act')].map(b => b.textContent.trim()));
  t.ok('Orte „+“: Neuer Ort / Neuer Raum in …', plus[0] === 'Neuer Ort' && plus.includes('Neuer Raum in Auto'), plus.join(' | '));
  await A.closeSheet(page);
  await page.locator('#orte-list .ogroup-head [data-place-menu]').first().click();
  await A.sleep(500);
  const pm = await page.evaluate(() => [...document.querySelectorAll('#sheet .sheet-act')].map(b => b.textContent.trim()));
  t.ok('Ort-⋯ enthält die Checkliste', pm.some(x => x.startsWith('Checkliste')), pm.join(' | '));
  await A.closeSheet(page);

  /* ---------- Dokumente in einem Tipp, aktiver Tab ---------- */
  const where = [];
  const fromHere = async (label) => {
    const before = await A.activeTab(page);
    await page.evaluate(() => document.querySelector('#nav [data-nav="docs"]').click());
    await A.sleep(600);
    where.push(`${label}: ${before} → ${await A.view(page)}/${await A.activeTab(page)}`);
    return (await A.view(page)) === 'docs' && (await A.activeTab(page)) === 'docs';
  };
  const results = [];
  const raum = async () => { await A.tab(page, 'orte'); await page.locator('#orte-list [data-room]').first().click(); await A.sleep(600); };
  await raum();
  results.push(await A.activeTab(page) === 'orte');
  results.push(await fromHere('Raum'));
  await A.tab(page, 'list');
  await A.openRow(page, 'Hammer');
  results.push(await A.activeTab(page) === 'list');
  results.push(await fromHere('Eintrag (aus Alles)'));
  await raum();
  await page.locator('#room-list .row .body').first().click();
  await A.sleep(650);
  results.push((await A.view(page)) === 'item' && await A.activeTab(page) === 'orte');
  results.push(await fromHere('Eintrag (aus Raum)'));
  await A.tab(page, 'settings');
  results.push(await fromHere('Einstellungen'));
  await A.tab(page, 'add');
  results.push(await fromHere('Hinzufügen'));
  await A.tab(page, 'list');
  await page.click('#list-archive').catch(() => {});
  await A.sleep(600);
  results.push(await fromHere('Papierkorb'));
  t.ok('Dokumente in 1 Tipp von überall, Leiste markiert jeweils richtig', results.every(Boolean), where.join(' · ') + ' ' + JSON.stringify(results));

  // In einem Ordner bleibt „Dokumente“ markiert; Zurückwischen geht eine Ebene hoch; erneuter Tipp auf den Tab nach oben.
  await page.locator('#docs-list [data-folder]', { hasText: 'Steuer' }).click();
  await A.sleep(400);
  const inFolder = { title: await page.textContent('#docs-title'), tab: await A.activeTab(page), back: await page.isVisible('#docs-back') };
  await page.locator('#docs-list [data-folder]').first().click();
  await A.sleep(400);
  const sub = await page.textContent('#docs-title');
  await A.swipeBack(page);
  const up = await page.textContent('#docs-title');
  await page.evaluate(() => document.querySelector('#nav [data-nav="docs"]').click());
  await A.sleep(500);
  const top = await page.textContent('#docs-title');
  t.ok('Ordner: Tab bleibt markiert, Zurückwischen eine Ebene hoch, Tab-Tipp ganz nach oben',
    inFolder.title === 'Steuer' && inFolder.tab === 'docs' && inFolder.back && sub !== 'Steuer' && up === 'Steuer' && top === 'Dokumente', JSON.stringify({ inFolder, sub, up, top }));
  const docsUi = await page.evaluate(() => ({ old: ['#docs-add', '#docs-folder-add'].filter(s => document.querySelector(s)), large: document.getElementById('docs-bar').classList.contains('large'), back: !document.getElementById('docs-back').hidden }));
  t.ok('Dokumente oben: großer Titel, kein „Zurück“, keine Knöpfe unten', docsUi.old.length === 0 && docsUi.large && !docsUi.back, JSON.stringify(docsUi));

  /* ---------- Alles: keine Doppel-Einstiege, Treffer „x von y“, Papierkorb ---------- */
  await A.tab(page, 'list');
  const li = await page.evaluate(() => ({
    old: ['#list-count', '#noroom-hint', '#cap-have', '#cap-noroom', '#places-count', '#rs-count', '#arch-count'].filter(s => document.querySelector(s)),
    hits: !document.getElementById('list-hits').hidden,
    have: !!document.querySelector('#have-btn'),
  }));
  t.ok('Alles: keine Zähler-Plaketten, kein Ohne-Ort-Banner; „Habe ich das schon?“ nur hier', li.old.length === 0 && !li.hits && li.have, JSON.stringify(li));
  await A.search(page, 'kabel');
  const hits = await page.evaluate(() => ({ shown: !document.getElementById('list-hits').hidden, txt: document.getElementById('list-hits').textContent }));
  t.ok('Alles: beim Suchen „2 von 61“ unter dem Suchfeld', hits.shown && hits.txt === '2 von 61', JSON.stringify(hits));
  await A.search(page, '');
  await page.evaluate(() => { const s = document.querySelector('#view-list .scroll'); s.scrollTop = s.scrollHeight; });
  await A.sleep(300);
  t.ok('Alles: am Ende „Papierkorb (2)“', (await page.textContent('#list-archive')).includes('Papierkorb (2)'));
  const hammer = await A.byName(page, 'Hammer');
  await A.openRow(page, 'Hammer');
  const live = await page.evaluate(() => ({ del: document.getElementById('it-archive').textContent.trim(), purge: !document.getElementById('it-actions-arch').hidden }));
  await page.click('#it-archive');
  await A.sleep(800);
  t.ok('Eintrag: „Löschen“ legt in den Papierkorb (kein endgültiges Löschen außerhalb)', live.del === 'Löschen' && !live.purge && (await A.byName(page, 'Hammer')).archived === 1, JSON.stringify(live));
  await page.click('#toast .toast-act').catch(() => {});
  await A.sleep(700);
  t.ok('… und „Rückgängig“ holt ihn zurück', (await A.dbq(page, (db, id) => db.get('items', id), hammer.id)).archived === 0);

  /* ---------- Bestehende Daten: homePlace und Papierkorb wie vorher ---------- */
  const auto = (await A.dbq(page, (db) => db.getAll('places'))).find(p => p.name === 'Auto');
  await A.dbq(page, (db, id) => db.setSetting('homePlace', id), auto.id);
  await page.reload();
  await A.ready(page);
  await A.sleep(500);
  const hp = await page.evaluate(() => ({ on: document.querySelector('#home-places .pseg.on')?.textContent.trim(), sum: document.getElementById('home-sum').textContent }));
  t.ok('Gemerkter Ort (homePlace) gilt weiter auf Start', hp.on === 'Auto' && /11 Dinge/.test(hp.sum), JSON.stringify(hp));
  await A.tab(page, 'list');
  await page.click('#list-archive');
  await A.sleep(600);
  const arch = await page.evaluate(() => [...document.querySelectorAll('#arch-list .row .name')].map(n => n.textContent));
  t.ok('Archivierte Einträge erscheinen im Papierkorb', arch.length === 2 && arch.includes('Altes Radio'), arch.join(', '));

  t.ok('Informationsarchitektur: ohne Konsolenfehler', errs.length === 0, errs.join(' | '));
};
