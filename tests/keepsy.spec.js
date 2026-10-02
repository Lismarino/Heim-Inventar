// Umbenennung in „Keepsy“ (2.1): sichtbar überall neu – aber alles, woran Daten und Updates
// hängen, bleibt unverändert: IndexedDB-Name, Kennung im Sicherungsformat (alte und neue
// Sicherungen gegenseitig lesbar), localStorage-Schlüssel, Cache-Präfix des Service Workers,
// Pfad der App (start_url/scope).
'use strict';
const fs = require('fs');
const path = require('path');
const A = require('./lib/app.js');

module.exports = async (t) => {
  const R = (f) => fs.readFileSync(path.join(t.site, f), 'utf8');
  const html = R('index.html');
  const man = JSON.parse(R('manifest.webmanifest'));

  /* ---------- Sichtbar: Keepsy ---------- */
  t.ok('Keepsy: <title>', /<title>Keepsy<\/title>/.test(html));
  t.ok('Keepsy: apple-mobile-web-app-title', /<meta name="apple-mobile-web-app-title" content="Keepsy">/.test(html));
  t.ok('Keepsy: manifest name/short_name', man.name === 'Keepsy' && man.short_name === 'Keepsy', JSON.stringify([man.name, man.short_name]));
  t.ok('Keepsy: Startszene, Einführung, Startfehler, Feedback', /class="i-name">Keepsy</.test(html) && /onb-eyebrow">Keepsy</.test(html)
    && /<h2>Keepsy lädt gerade nicht<\/h2>/.test(html) && /subject=Keepsy/.test(html));
  t.ok('Keepsy: README und CHANGELOG', /^# Keepsy/m.test(R('README.md')) && /Keepsy/.test(R('CHANGELOG.md').split('\n## ')[0] + R('CHANGELOG.md').split('\n## ')[1]));
  const vis = [...html.replace(/<script[\s\S]*?<\/script>/g, '').replace(/<!--[\s\S]*?-->/g, '').matchAll(/>([^<]*Inventar[^<]*)</g)].map((m) => m[1].trim());
  t.ok('Keepsy: kein „Heim-Inventar“ mehr als sichtbarer Text in index.html', vis.length === 0, vis.join(' | '));

  /* ---------- Unverändert: Daten, Sicherung, Updates ---------- */
  t.ok('Unverändert: IndexedDB-Name „heim-inventar“', /const DB_NAME = 'heim-inventar';/.test(R('js/db-core.js')));
  t.ok('Unverändert: Sicherungs-Kennung FORMAT = „heim-inventar“', /const FORMAT = 'heim-inventar';/.test(R('js/backup.js'))
    && /app: 'heim-inventar', encrypted: true/.test(R('js/crypto.js')));
  t.ok('Unverändert: Cache-Präfix „heim-inventar-“ (alte Caches werden aufgeräumt)', /const CACHE = 'heim-inventar-' \+ VERSION;/.test(R('sw.js'))
    && /n\.startsWith\('heim-inventar-'\)/.test(R('sw.js')));
  t.ok('Unverändert: localStorage-Schlüssel', /'inventar-toene'/.test(R('js/sound.js')) && /'inventar-hintergrund'/.test(R('js/intro.js'))
    && /'inventar-rettung'/.test(html) && /'inventar-akzent'/.test(R('js/accent.js')) && /'inventar-akzent'/.test(html));
  t.ok('Unverändert: start_url/scope/id „./“', man.start_url === './' && man.scope === './' && man.id === './');

  /* ---------- Laufzeit: Dateiname, Kennung, beide Kennungen lesbar ---------- */
  const { page, errs } = await A.open(t);
  await A.start(t, page, { seed: 'mini' });
  const r = await page.evaluate(async () => {
    const b = await import('./js/backup.js');
    const ex = await b.buildExport({ withPhotos: false });
    const text = await ex.blob.text();
    const data = JSON.parse(text);
    const asKeepsy = JSON.stringify({ ...data, app: 'keepsy' });
    let old = null; let neu = null; let foreign = null;
    try { old = b.parseBackup(text).items.length; } catch (e) { old = e.message; }
    try { neu = b.parseBackup(asKeepsy).items.length; } catch (e) { neu = e.message; }
    try { b.parseBackup(JSON.stringify({ ...data, app: 'etwas-anderes' })); } catch (e) { foreign = e.message; }
    const dbs = indexedDB.databases ? (await indexedDB.databases()).map((d) => d.name) : ['heim-inventar'];
    return { name: ex.filename, app: data.app, n: data.items.length, old, neu, foreign, dbs };
  });
  t.ok('Sicherung: Dateiname keepsy-JJJJ-MM-TT.json', /^keepsy-\d{4}-\d{2}-\d{2}\.json$/.test(r.name), r.name);
  t.ok('Sicherung: Feld app bleibt „heim-inventar“ (ältere Fassungen lesen sie weiter)', r.app === 'heim-inventar', r.app);
  t.ok('Sicherung: „heim-inventar“ und „keepsy“ werden gelesen, Fremdes nicht', r.old === r.n && r.neu === r.n && /keine Sicherung/.test(r.foreign || ''), JSON.stringify(r));
  t.ok('Datenbank heißt weiter „heim-inventar“', r.dbs.includes('heim-inventar'), r.dbs.join(', '));
  t.ok('Keepsy: ohne Konsolenfehler', errs.length === 0, errs.join(' | '));
};
