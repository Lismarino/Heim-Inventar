// Sicherung: erstellen (offen und verschlüsselt), ersetzen/hinzufügen, falsches Passwort, und
// Sicherungsdateien aller Formate einlesen (Format 1 aus 1.6.2 … Format 4 aus 1.10.3, auch verschlüsselt).
'use strict';
const fs = require('fs');
const path = require('path');
const A = require('./lib/app.js');
const { counts } = require('./lib/seed.js');

const FIX = path.join(__dirname, 'fixtures');
const PW = 'testpasswort';
const strip = (c) => { const { dbVersion, sync, ...rest } = c; void dbVersion; void sync; return rest; };

async function setCheck(page, sel, on) {
  await page.evaluate(([sel, on]) => { const el = document.querySelector(sel); el.checked = on; el.dispatchEvent(new Event('change', { bubbles: true })); }, [sel, on]);
}

/** In den Einstellungen eine Sicherung erstellen und herunterladen. Liefert den Text. */
async function exportBackup(page, password = '') {
  await A.tab(page, 'settings');
  await setCheck(page, '#exp-encrypt', !!password);
  await page.click('#exp-build');
  if (password) {
    await A.sleep(450);
    await page.fill('#sheet-pw1', password);
    await page.fill('#sheet-pw2', password);
    await A.sheetSubmit(page);
  }
  await page.waitForSelector('#exp-save:not([hidden])', { timeout: 20000 });
  const dl = page.waitForEvent('download', { timeout: 10000 });
  await page.click('#exp-save');
  const d = await dl;
  return { name: d.suggestedFilename(), text: fs.readFileSync(await d.path(), 'utf8') };
}

/** Datei einlesen; mode 'merge' | 'replace'; password für verschlüsselte. Liefert den Hinweistext. */
async function importBackup(page, file, mode, password = '') {
  await A.tab(page, 'settings');
  const buf = typeof file === 'string' ? fs.readFileSync(file) : Buffer.from(file.text);
  await page.setInputFiles('#imp-input', { name: 'sicherung.json', mimeType: 'application/json', buffer: buf });
  if (password) {
    await page.waitForSelector('#sheet-pw1', { timeout: 8000 });
    await page.fill('#sheet-pw1', password);
    await A.sheetSubmit(page);
  }
  await page.waitForSelector('#imp-choice:not([hidden]), #imp-out.err', { timeout: 15000 });
  if (await page.isVisible('#imp-choice')) {
    await page.click(mode === 'replace' ? '#imp-replace' : '#imp-merge');
    await page.waitForSelector('#imp-out.ok, #imp-out.err', { timeout: 20000 });
  }
  return page.textContent('#imp-out');
}

module.exports = async (t) => {
  /* ---------- Erstellen → in leerem Gerät ersetzen ---------- */
  const a = await A.open(t);
  await A.start(t, a.page, { seed: 'mini' });
  const before = strip(await counts(a.page));
  const plain = await exportBackup(a.page);
  const j = JSON.parse(plain.text);
  t.ok('Sicherung: Datei mit Format 4 und allen Teilen', j.app === 'heim-inventar' && j.version === 4 && j.items.length === before.items && j.photos.length === before.photos && j.docs.length === before.docs && j.folders.length === before.folders, `${plain.name} ${JSON.stringify(j.counts)}`);
  t.ok('Sicherung: kein API-Key in der Datei', !/apiKey/.test(plain.text));
  const enc = await exportBackup(a.page, PW);
  const ej = JSON.parse(enc.text);
  t.ok('Verschlüsselt: Hülle ohne Klartext', ej.encrypted === true && !enc.text.includes('Akkuschrauber') && /verschluesselt/.test(enc.name), enc.name);

  const b = await A.open(t);
  await A.start(t, b.page, { seed: 'none' });
  let msg = await importBackup(b.page, plain, 'replace');
  t.ok('Einlesen (ersetzen): gleiche Zahlen wie vorher', JSON.stringify(strip(await counts(b.page))) === JSON.stringify(before), msg);
  msg = await importBackup(b.page, plain, 'merge');
  t.ok('Einlesen (hinzufügen): nichts doppelt', JSON.stringify(strip(await counts(b.page))) === JSON.stringify(before) && /schon vorhanden/.test(msg), msg);

  /* ---------- Verschlüsselt: falsches, dann richtiges Passwort ---------- */
  const c = await A.open(t);
  await A.start(t, c.page, { seed: 'none' });
  msg = await importBackup(c.page, enc, 'replace', 'falsch-falsch');
  t.ok('Verschlüsselt: falsches Passwort → nichts verändert', /Passwort stimmt nicht/.test(msg) && (await counts(c.page)).items === 0, msg);
  msg = await importBackup(c.page, enc, 'replace', PW);
  t.ok('Verschlüsselt: richtiges Passwort → alles da', JSON.stringify(strip(await counts(c.page))) === JSON.stringify(before), msg);
  t.ok('Sicherung: ohne Konsolenfehler', [...a.errs, ...b.errs, ...c.errs].length === 0, [...a.errs, ...b.errs, ...c.errs].join(' | '));

  /* ---------- Alte Sicherungen aller Formate ---------- */
  const want = {
    'backup-1.6.2.json': { format: 1, items: 5, places: 1, rooms: 3, docs: 0, folders: 0 },
    'backup-1.7.1.json': { format: 2, items: 5, places: 2, rooms: 3, docs: 0, folders: 0 },
    'backup-1.8.1.json': { format: 3, items: 5, places: 2, rooms: 3, docs: 1, folders: 0 },
    'backup-1.10.3.json': { format: 4, items: 5, places: 2, rooms: 3, docs: 2, folders: 1 },
    'backup-1.10.3-verschluesselt.json': { format: 4, items: 5, places: 2, rooms: 3, docs: 2, folders: 1, pw: PW },
  };
  for (const [file, w] of Object.entries(want)) {
    const x = await A.open(t);
    await A.start(t, x.page, { seed: 'none' });
    msg = await importBackup(x.page, path.join(FIX, file), 'replace', w.pw || '');
    const got = await counts(x.page);
    const its = await A.items(x.page);
    const places = await A.dbq(x.page, (db) => db.getAll('places'));
    const rooms = await A.dbq(x.page, (db) => db.getAll('rooms'));
    const roomsOk = rooms.every(r => places.some(p => p.id === r.placeId));
    const ak = its.find(i => i.name === 'Akkuschrauber');
    t.ok(`${file} (Format ${w.format}) einlesen: Einträge, Fotos, Orte, Räume, Dokumente`,
      got.items === w.items && got.photos === w.items && got.places === w.places && got.rooms === w.rooms && got.docs === w.docs && got.folders === w.folders && roomsOk && ak && ak.photoId,
      `${msg} ${JSON.stringify(got)}`);
    await A.tab(x.page, 'list');
    const rows = await x.page.locator('#list .row').count();
    t.ok(`${file}: Liste zeigt die Einträge, ohne Fehler`, rows === w.items - 1 && x.errs.length === 0, `${rows} ${x.errs.join(' | ')}`);
    await x.ctx.close();
  }
};
