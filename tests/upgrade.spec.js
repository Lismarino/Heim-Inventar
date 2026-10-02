// Upgrade: Datenbank einer alten Fassung (1.6.2 ohne Orte, 1.7.1, 1.10.3) anlegen, dann die
// aktuelle Fassung auf demselben Ursprung starten – nichts darf verloren gehen.
// Die alten Fassungen kommen per git archive aus dem Verlauf (fehlt er, wird übersprungen).
'use strict';
const A = require('./lib/app.js');
const { seedMini, counts } = require('./lib/seed.js');

const OLD = [['0f5d833', '1.6.2'], ['4f0b7d6', '1.7.1'], ['896a46b', '1.10.3']];

const snapshot = (page) => A.dbq(page, async (db) => {
  const items = await db.getAll('items');
  return items.map(i => [i.id, i.name, i.roomId, i.photoId, i.quantity, i.archived ? 1 : 0, i.out?.to || ''].join('|')).sort();
});

module.exports = async (t) => {
  for (const [rev, ver] of OLD) {
    const dir = t.archive(rev);
    if (!dir) { t.skip(`Upgrade von ${ver}`, `Commit ${rev} nicht im Verlauf`); continue; }
    t.server.setRoot(dir);
    const { page, errs } = await A.open(t);
    await page.goto(t.url);
    await page.waitForFunction(() => window.__inventarReady === true, null, { timeout: 20000 });
    const oldVer = await page.evaluate(() => window.__inventarVersion);
    await seedMini(page);
    await page.reload();
    await page.waitForFunction(() => window.__inventarReady === true, null, { timeout: 20000 });
    const before = await counts(page);
    const snapBefore = await snapshot(page);
    const roomsBefore = await A.dbq(page, async (db) => (await db.getAll('rooms')).map(r => r.name).sort());

    t.server.setRoot(t.site);
    await page.reload();
    await A.ready(page);
    await A.sleep(600);
    const now = await page.evaluate(() => window.__inventarVersion);
    const after = await counts(page);
    const snapAfter = await snapshot(page);
    const places = await A.dbq(page, (db) => db.getAll('places'));
    const rooms = await A.dbq(page, (db) => db.getAll('rooms'));
    const items = await A.items(page);
    t.ok(`Upgrade ${oldVer} → ${now}: alte Fassung lief`, oldVer === ver, oldVer);
    t.ok(`Upgrade ${ver}: Datenbank-Version 4`, after.dbVersion === 4, JSON.stringify(after));
    const same = ['items', 'photos', 'categories', 'rooms', 'docs'].every(k => (before[k] || 0) === (after[k] || 0));
    t.ok(`Upgrade ${ver}: gleiche Anzahl Einträge, Fotos, Kategorien, Räume, Belege`, same, JSON.stringify([before, after]));
    // Einträge unverändert (bis auf die Ortszuordnung, die erst mit 1.7 dazukam).
    t.ok(`Upgrade ${ver}: jeder Eintrag mit Name, Raum, Foto, Bestand, Status erhalten`, JSON.stringify(snapBefore) === JSON.stringify(snapAfter));
    t.ok(`Upgrade ${ver}: alle Räume gehören zu einem Ort, Einträge mit Raum haben dessen Ort`,
      JSON.stringify(rooms.map(r => r.name).sort()) === JSON.stringify(roomsBefore)
      && rooms.every(r => places.some(p => p.id === r.placeId))
      && items.filter(i => i.roomId).every(i => i.placeId === rooms.find(r => r.id === i.roomId)?.placeId));
    const news = await page.evaluate(() => !document.getElementById('sheet').hidden && /Neu: Keepsy 2\.1/.test(document.getElementById('sheet-body').textContent));
    t.ok(`Upgrade ${ver}: „Was ist neu“ erscheint einmal nach dem Update`, news);
    await A.closeSheet(page);
    await A.tab(page, 'list');
    const rows = await page.locator('#list .row').count();
    t.ok(`Upgrade ${ver}: Liste zeigt alle nicht archivierten Einträge, keine Fehler`, rows === items.filter(i => !i.archived).length && errs.length === 0, `${rows} ${errs.join(' | ')}`);
  }
};
