// Abläufe: Erfassen (mit vorgetäuschter Erkennung), ohne Foto, Eintrag bearbeiten (auch Speichern
// beim Verlassen), Ort/Raum (Tab „Orte“ mit „+“), Unterwegs, Wischen = Löschen (Papierkorb) +
// Rückgängig, Mehrfachauswahl, Dokument anlegen (Tab „Dokumente“, „+“) und ansehen, KI-Suche
// (ohne Dokumentinhalte), Hinweise ohne API-Key.
'use strict';
const A = require('./lib/app.js');

module.exports = async (t) => {
  const { ctx, page, errs, ai } = await A.open(t);
  await A.start(t, page, { seed: 'mini', key: 'TESTKEY' });
  const it = (name) => A.byName(page, name);

  /* ---------- Erfassen: Foto → Eintrag → Erkennung im Hintergrund ---------- */
  await A.tab(page, 'add');
  ai.names.push('Bohrhammer');
  await page.setInputFiles('#cap-camera-input', { name: 'foto.jpg', mimeType: 'image/jpeg', buffer: await A.jpeg(page) });
  let bh = null;
  for (let i = 0; i < 50 && !(bh && bh.aiState === 'done'); i++) { await A.sleep(300); bh = await it('Bohrhammer'); }
  await A.sleep(300);
  t.ok('Erfassen: Foto wird Eintrag, Erkennung benennt ihn', bh && bh.photoId && bh.aiState === 'done', JSON.stringify(bh && { name: bh.name, ai: bh.aiState }));
  t.ok('Erfassen: Erkennung hat ein Foto an Gemini geschickt', ai.requests.some(r => r.body.includes('inline_data')));
  const strip = await page.locator('#cap-strip .cap-thumb').count();
  t.ok('Erfassen: Streifen zeigt den neuen Eintrag', strip === 1, String(strip));

  /* ---------- Ohne Foto eintragen ---------- */
  await page.evaluate(() => { document.querySelector('#manual').open = true; document.querySelector('#man-more').open = true; });
  await page.fill('#man-name', 'Zollstock');
  await page.fill('#man-qty', '2');
  await page.click('#man-save');
  await A.sleep(700);
  const zs = await it('Zollstock');
  t.ok('Ohne Foto: Eintrag mit Bestand gespeichert', zs && zs.quantity === '2' && !zs.photoId);
  await page.click('#cap-done').catch(() => {});
  await A.sleep(500);

  /* ---------- Eintrag bearbeiten ---------- */
  await A.tab(page, 'list');
  const openMore = () => page.evaluate(() => { document.querySelector('#it-more').open = true; });
  await A.openRow(page, 'Teekanne');
  await openMore();
  await page.fill('#it-note', 'Notiz per Speichern');
  await page.click('#item-save');
  await A.sleep(700);
  t.ok('Bearbeiten: „Speichern“ speichert die Notiz', (await it('Teekanne')).note === 'Notiz per Speichern' && (await A.view(page)) === 'list');

  await A.openRow(page, 'Teekanne');
  await openMore();
  await page.fill('#it-note', 'Notiz per Zurück');
  await A.back(page);
  await A.sleep(400);
  t.ok('Bearbeiten: Notiz ändern → Zurück → Notiz gespeichert', (await it('Teekanne')).note === 'Notiz per Zurück');

  await A.openRow(page, 'Teekanne');
  await openMore();
  await page.fill('#it-note', 'Notiz per Zurückwischen');
  await page.evaluate(() => document.activeElement?.blur());
  await A.swipeBack(page);
  await A.sleep(400);
  t.ok('Bearbeiten: Notiz ändern → Zurückwischen → Notiz gespeichert',
    (await A.view(page)) === 'list' && (await it('Teekanne')).note === 'Notiz per Zurückwischen', `${await A.view(page)} ${(await it('Teekanne')).note}`);

  await A.openRow(page, 'Teekanne');
  await page.fill('#it-name', '');
  await openMore();
  await page.fill('#it-qty', '3');
  await A.back(page);
  await A.sleep(400);
  const tk = await A.items(page).then(l => l.find(i => i.note === 'Notiz per Zurückwischen'));
  t.ok('Bearbeiten: leerer Name beim Verlassen → Name bleibt, Bestand gespeichert', tk && tk.name === 'Teekanne' && tk.quantity === '3', JSON.stringify(tk && { n: tk.name, q: tk.quantity }));

  await A.openRow(page, 'Teekanne');
  const upd = (await it('Teekanne')).updatedAt;
  await A.back(page);
  await A.sleep(300);
  t.ok('Bearbeiten: ohne Änderung wird nichts geschrieben', (await it('Teekanne')).updatedAt === upd);

  /* ---------- Ort / Raum ---------- */
  await A.ctxmenu(page, `#list .row[data-id="${(await it('Zollstock')).id}"]`);
  await A.sheetAction(page, 'Ort');
  const places = await A.dbq(page, (db) => db.getAll('places'));
  const autoId = places.find(p => p.name === 'Auto').id;
  await page.click(`#sheet-places [data-place="${autoId}"]`);
  await A.sleep(300);
  await page.click('#sheet-rooms [data-room-pick="Kofferraum"]');
  await A.sleep(800);
  const rooms = await A.dbq(page, (db) => db.getAll('rooms'));
  const zs2 = await it('Zollstock');
  t.ok('Ort ändern: Zollstock → Auto › Kofferraum', zs2.placeId === autoId && rooms.find(r => r.id === zs2.roomId)?.name === 'Kofferraum');

  await A.tab(page, 'orte');
  await page.click('#orte-add');
  await A.sleep(450);
  await A.sheetAction(page, 'Neuer Ort');
  await page.fill('#sheet-input', 'Gartenhaus');
  await A.sheetSubmit(page);
  const gh = (await A.dbq(page, (db) => db.getAll('places'))).find(p => p.name === 'Gartenhaus');
  t.ok('Neuer Ort angelegt (mit Symbol)', gh && gh.icon === 'garten', JSON.stringify(gh));
  await page.click('#orte-add');
  await A.sleep(450);
  await A.sheetAction(page, 'Neuer Raum in Gartenhaus');
  await page.fill('#sheet-input', 'Werkbank');
  await A.sheetSubmit(page);
  const wb = (await A.dbq(page, (db) => db.getAll('rooms'))).find(r => r.name === 'Werkbank');
  t.ok('Neuer Raum im Ort angelegt', wb && wb.placeId === gh.id);
  await page.click(`#orte-list [data-place-menu="${gh.id}"]`);
  await A.sleep(450);
  await A.sheetAction(page, 'Raum hinzufügen');
  await page.fill('#sheet-input', 'Schuppen');
  await A.sheetSubmit(page);
  t.ok('Ort-⋯ „Raum hinzufügen“ legt ebenfalls einen Raum an', (await A.dbq(page, (db) => db.getAll('rooms'))).some(r => r.name === 'Schuppen' && r.placeId === gh.id));
  await page.locator(`#orte-list [data-room="${wb.id}"]`).click();
  await A.sleep(600);
  t.ok('Raum öffnet sich (leer), Tab „Orte“ bleibt markiert', (await A.view(page)) === 'room' && (await A.activeTab(page)) === 'orte');
  await A.back(page);

  /* ---------- Unterwegs / verliehen ---------- */
  await A.tab(page, 'list');
  await A.openRow(page, 'Warndreieck');
  await page.click('#it-out-set');
  await A.sleep(450);
  // Farben deckend verrechnen: Chip über Blatt über Seite (das Blatt ist durchscheinendes Glas).
  const chip = async () => page.evaluate(() => {
    const b = document.querySelector('#sheet [data-out-type].on');
    const cs = getComputedStyle(b);
    const parse = (s) => (s.match(/[\d.]+/g) || []).map(Number);
    const over = (top, u) => { const [r, g, bl, a = 1] = parse(top); return [r * a + u[0] * (1 - a), g * a + u[1] * (1 - a), bl * a + u[2] * (1 - a)].map(Math.round); };
    const chain = [];
    for (let el = b.parentElement; el; el = el.parentElement) chain.push(getComputedStyle(el).backgroundColor);
    let base = [255, 255, 255];
    for (const c of chain.reverse()) base = over(c, base);
    return { text: b.textContent.trim(), fg: cs.color, bg: `rgb(${over(cs.backgroundColor, base)})`, around: `rgb(${base})` };
  });
  for (const dark of [false, true]) {
    await page.emulateMedia({ colorScheme: dark ? 'dark' : 'light' });
    await A.sleep(250);
    const c = await chip();
    const k = A.contrast(c.fg, c.bg);
    const k2 = A.contrast(c.bg, c.around);
    t.ok(`Unterwegs-Blatt (${dark ? 'dunkel' : 'hell'}): gewählter Chip „${c.text}“ deutlich (Schrift ≥ 4,5:1, Fläche zum Blatt ≥ 3:1)`, k >= 4.5 && k2 >= 3, `Schrift ${k.toFixed(2)}, Fläche ${k2.toFixed(2)} (${c.fg} auf ${c.bg}, Blatt ${c.around})`);
  }
  await page.emulateMedia({ colorScheme: 'light' });
  await page.fill('#sheet-input', 'Tom');
  await A.sheetSubmit(page);
  let wd = await it('Warndreieck');
  t.ok('Unterwegs: verliehen an Tom', wd.out?.type === 'verliehen' && wd.out.to === 'Tom');
  t.ok('Unterwegs: Eintrag zeigt den Status', /Bei Tom/.test(await page.textContent('#it-out-text')));
  await page.click('#it-back');
  await A.sleep(600);
  wd = await it('Warndreieck');
  t.ok('Wieder da: Status gelöscht', !wd.out);
  await A.back(page);

  /* ---------- Wischen = Löschen (in den Papierkorb) + Rückgängig ---------- */
  await A.search(page, '');
  const wid = wd.id;
  await A.swipeRowAway(page, `#list .row[data-id="${wid}"]`);
  await A.sleep(300);
  t.ok('Wischen: Eintrag liegt im Papierkorb (archived)', (await it('Warndreieck')).archived === 1);
  const msg = await page.evaluate(() => { const m = document.querySelector('#toast .toast-msg'); return m ? { txt: m.textContent, cut: m.scrollWidth > m.clientWidth + 1 || m.scrollHeight > m.clientHeight + 1 } : null; });
  t.ok('Wischen: Toast „gelöscht“ vollständig lesbar, mit Rückgängig', msg && /gelöscht/.test(msg.txt) && !msg.cut && /Rückgängig/.test(await page.textContent('#toast .toast-act')), JSON.stringify(msg));
  await page.click('#toast .toast-act');
  await A.sleep(700);
  t.ok('Rückgängig holt ihn zurück', (await it('Warndreieck')).archived === 0);

  /* ---------- Mehrfachauswahl ---------- */
  await page.click('#list-select');
  await A.sleep(300);
  for (const n of ['Akkuschrauber', 'Zollstock']) {
    const id = (await it(n)).id;
    await page.click(`#list .row[data-id="${id}"]`);
  }
  t.ok('Auswahl: „2 Einträge ausgewählt“', /2 Einträge/.test(await page.textContent('#sel-n')));
  await page.click('#sel-bar [data-sel="cat"]');
  await A.sleep(450);
  await page.fill('#sheet-input', 'Messwerkzeug');
  await A.sheetSubmit(page);
  const cats = await A.dbq(page, (db) => db.getAll('categories'));
  const mw = cats.find(c => c.name === 'Messwerkzeug');
  t.ok('Auswahl: Kategorie für beide geändert', mw && (await it('Akkuschrauber')).categoryId === mw.id && (await it('Zollstock')).categoryId === mw.id);
  t.ok('Auswahl endet danach', !(await page.isVisible('#sel-bar')));

  /* ---------- Dokument anlegen („+“ → PDF oder Datei) und ansehen ---------- */
  await A.tab(page, 'docs');
  await A.sleep(500);
  t.ok('Dokumente: eigener Tab, markiert', (await A.view(page)) === 'docs' && (await A.activeTab(page)) === 'docs');
  await page.click('#docs-new');
  await A.sleep(500);
  const pdf = Buffer.from('%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n');
  const chooser = page.waitForEvent('filechooser', { timeout: 5000 }).catch(() => null);
  await A.sheetAction(page, 'PDF oder Datei');
  const fc = await chooser;
  t.ok('„+“ → „PDF oder Datei“ öffnet die Dateiauswahl direkt', !!fc);
  if (fc) await fc.setFiles({ name: 'garantie.pdf', mimeType: 'application/pdf', buffer: pdf });
  else await page.setInputFiles('#da-file-input', { name: 'garantie.pdf', mimeType: 'application/pdf', buffer: pdf });
  await A.sleep(700);
  t.ok('Nach der Wahl: Formular mit der Datei, Tab „Dokumente“ markiert', (await A.view(page)) === 'docadd' && (await A.activeTab(page)) === 'docs' && await page.isVisible('#da-filecard'));
  await page.fill('#da-title', 'Garantieschein Bohrhammer');
  await page.click('#da-save');
  await A.sleep(1200);
  const docs = await A.dbq(page, (db) => db.getAll('docs'));
  const gs = docs.find(d => d.name === 'Garantieschein Bohrhammer');
  t.ok('Dokument angelegt', gs && gs.type === 'application/pdf' && (await A.view(page)) === 'docs', (await A.view(page)));
  const popup = ctx.waitForEvent('page', { timeout: 5000 }).catch(() => null);
  await page.locator(`#docs-list [data-doc="${gs.id}"]`).click();
  await A.sleep(450);
  await A.sheetAction(page, 'Ansehen');
  const pop = await popup;
  t.ok('Dokument ansehen öffnet das PDF', !!pop, pop ? pop.url() : '');
  if (pop) await pop.close();

  /* ---------- KI-Suche: Bestand und Dokument-Titel, nie Inhalte ---------- */
  await A.tab(page, 'list');
  ai.requests.length = 0;
  ai.reply = { answer: 'Der Garantieschein liegt in den Dokumenten.', matches: [{ n: 1, why: 'passt' }] };
  await A.search(page, 'wo ist der garantieschein');
  await page.click('#ai-search');
  await page.waitForSelector('#ai-answer:not([hidden])', { timeout: 8000 }).catch(() => {});
  const req = ai.requests.map(r => r.body).find(b => b.includes('Garantieschein')) || '';
  t.ok('KI-Suche: Antwort erscheint', /Garantieschein liegt/.test(await page.textContent('#ai-answer-text')));
  t.ok('KI-Suche: Anfrage nennt Einträge und Dokument-Titel', req.includes('Akkuschrauber') && req.includes('Garantieschein Bohrhammer'));
  t.ok('KI-Suche: keine Dokumentinhalte, keine Fotos in der Anfrage', req && !/%PDF|JVBER|inline_data|Catalog/.test(req));
  await page.click('#ai-clear');
  await A.sleep(300);

  /* ---------- Ohne API-Key: freundlicher Hinweis statt Fehler ---------- */
  await page.evaluate(() => { const k = document.querySelector('#set-key'); k.value = ''; k.dispatchEvent(new Event('change')); });
  await A.sleep(300);
  await A.search(page, 'wo ist der hammer');
  await page.click('#ai-search');
  await A.sleep(400);
  const tst = await page.evaluate(() => { const x = document.getElementById('toast'); return { err: x.classList.contains('err'), txt: x.textContent, act: x.querySelector('.toast-act')?.textContent.trim() || '' }; });
  t.ok('Ohne Key: Hinweis ist kein roter Fehler und bietet „Einrichten“', !tst.err && /API-Key/.test(tst.txt) && /Einrichten/.test(tst.act), JSON.stringify(tst));
  await A.search(page, '');
  await page.click('#list-select');
  await A.sleep(300);
  const geo = await page.evaluate(() => ({ toast: document.getElementById('toast').getBoundingClientRect().bottom, bar: document.getElementById('sel-bar').getBoundingClientRect().top, hidden: document.getElementById('toast').hidden }));
  t.ok('Ohne Key: Hinweis liegt nicht über der Auswahl-Leiste', geo.hidden || geo.toast <= geo.bar + 1, JSON.stringify(geo));
  await page.click('#list-select');
  await A.sleep(200);
  await page.click('#toast .toast-act').catch(() => {});
  await A.sleep(600);
  t.ok('„Einrichten“ führt zum API-Key in den Einstellungen', (await A.view(page)) === 'settings');

  t.ok('Abläufe ohne Konsolenfehler', errs.length === 0, errs.join(' | '));
};
