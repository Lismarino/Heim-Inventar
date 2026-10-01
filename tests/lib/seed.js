// Testdaten. seedFull: realistischer Bestand (3 Orte, 61 Einträge mit Fotos, unterwegs/verliehen,
// ohne Ort, Archiv, 18 Dokumente in 9 Ordnern, Belege, Fristen) – für Bildschirmfotos und Messungen.
// seedMini: wenige Einträge, läuft auch mit alten Fassungen (1.6–1.10) – für Upgrade und Sicherungen.
// Beide schreiben direkt über js/db.js der gerade geladenen Fassung.
'use strict';

/** Großer Bestand (aus dem Plan zu 2.0). photoW: Breite der Fotos (klein = schneller). */
async function seedFull(page, { withNoPlace = true, photoW = 1200 } = {}) {
  await page.evaluate(async ({ withNoPlace, photoW }) => {
    const db = await import('./js/db.js');
    const now = Date.now(); const DAY = 864e5;
    const iso = (d) => new Date(now + d * DAY).toISOString().slice(0, 10);
    const zu = await db.ensurePlace('Zuhause', { icon: 'haus', color: 'tanne' });
    const auto = await db.ensurePlace('Auto', { icon: 'auto', color: 'tinte' });
    const gh = await db.ensurePlace('Gartenhaus', { icon: 'garten', color: 'salbei' });
    const R = {};
    for (const [pid, rs] of [[zu, ['Küche', 'Wohnzimmer', 'Schlafzimmer', 'Bad', 'Keller', 'Flur', 'Arbeitszimmer']], [auto, ['Kofferraum', 'Handschuhfach']], [gh, ['Regal', 'Werkbank']]]) for (const r of rs) R[r] = [pid, await db.ensureRoom(pid, r)];
    const C = {};
    for (const c of ['Werkzeug', 'Küche', 'Elektronik', 'Kleidung', 'Haushalt', 'Auto', 'Garten', 'Sport', 'Medizin', 'Freizeit']) C[c] = await db.ensureNamed('categories', c);
    const L = [
      ['Akkuschrauber Bosch', '🪛', 'Werkzeug', 'Keller', 'Regal 2', '1'], ['Wasserkocher', '🫖', 'Küche', 'Küche', '', ''], ['Kaffeemaschine', '☕', 'Küche', 'Küche', 'Arbeitsplatte', ''],
      ['Laptop ThinkPad', '💻', 'Elektronik', 'Arbeitszimmer', 'Schreibtisch', ''], ['Winterjacke', '🧥', 'Kleidung', 'Flur', 'Garderobe', ''], ['Hammer', '🔨', 'Werkzeug', 'Keller', 'Werkzeugkiste', ''],
      ['Verbandskasten', '🩹', 'Medizin', 'Kofferraum', '', '1'], ['Warndreieck', '⚠️', 'Auto', 'Kofferraum', '', ''], ['Starthilfekabel', '🔌', 'Auto', 'Kofferraum', 'unter dem Boden', ''],
      ['Eiskratzer', '🧊', 'Auto', 'Handschuhfach', '', '2'], ['Sonnenbrille', '🕶️', 'Kleidung', 'Handschuhfach', '', ''], ['Fahrzeugschein-Kopie', '📄', 'Auto', 'Handschuhfach', '', ''],
      ['Rasenmäher', '🌱', 'Garten', 'Regal', '', ''], ['Gartenschere', '✂️', 'Garten', 'Werkbank', '', ''], ['Gießkanne', '🪣', 'Garten', 'Regal', '', ''],
      ['Fahrradpumpe', '🚲', 'Sport', 'Keller', '', ''], ['Zelt 3 Personen', '⛺', 'Freizeit', 'Keller', 'oben links', ''], ['Schlafsack', '🛌', 'Freizeit', 'Keller', '', '2'],
      ['Bohrmaschine', '🔧', 'Werkzeug', 'Werkbank', '', ''], ['Stichsäge', '🪚', 'Werkzeug', 'Werkbank', '', ''], ['Pattex Kleber', '🧴', 'Werkzeug', 'Keller', 'Schublade', '3'],
      ['Gewebeband', '🎞️', 'Werkzeug', 'Keller', 'Schublade', '2'], ['Dübel-Set', '🔩', 'Werkzeug', 'Keller', '', 'genug'], ['Glühbirnen E27', '💡', 'Haushalt', 'Flur', 'Schrank', '4'],
      ['Batterien AA', '🔋', 'Haushalt', 'Flur', 'Schublade', '12'], ['Toilettenpapier', '🧻', 'Haushalt', 'Bad', '', 'wenig'], ['Fön', '💨', 'Elektronik', 'Bad', '', ''],
      ['Mixer', '🥤', 'Küche', 'Küche', 'Oberschrank', ''], ['Pfannen-Set', '🍳', 'Küche', 'Küche', '', ''], ['Raclette', '🧀', 'Küche', 'Keller', '', ''],
      ['Fernseher', '📺', 'Elektronik', 'Wohnzimmer', '', ''], ['Spielekonsole', '🎮', 'Elektronik', 'Wohnzimmer', 'TV-Möbel', ''], ['Lautsprecher', '🔊', 'Elektronik', 'Wohnzimmer', '', ''],
      ['Bügeleisen', '👔', 'Haushalt', 'Schlafzimmer', 'Schrank', ''], ['Koffer groß', '🧳', 'Freizeit', 'Schlafzimmer', 'auf dem Schrank', ''], ['Wanderschuhe', '🥾', 'Kleidung', 'Flur', '', ''],
      ['Skihelm', '⛑️', 'Sport', 'Keller', '', ''], ['Tennisschläger', '🎾', 'Sport', 'Keller', '', ''], ['Yogamatte', '🧘', 'Sport', 'Schlafzimmer', '', ''],
      ['Nähmaschine', '🧵', 'Haushalt', 'Arbeitszimmer', '', ''], ['Drucker', '🖨️', 'Elektronik', 'Arbeitszimmer', '', ''], ['Ladekabel USB-C', '🔌', 'Elektronik', 'Handschuhfach', '', '1'],
      ['Regenschirm', '☂️', 'Kleidung', 'Kofferraum', '', ''], ['Abschleppseil', '🪢', 'Auto', 'Kofferraum', '', ''], ['Reservekanister', '⛽', 'Auto', 'Kofferraum', '', ''],
      ['Grill', '🍖', 'Garten', 'Regal', '', ''], ['Liegestuhl', '🪑', 'Garten', 'Regal', '', '2'], ['Blumenerde', '🪴', 'Garten', 'Werkbank', '', 'halb voll'],
      ['Fieberthermometer', '🌡️', 'Medizin', 'Bad', 'Spiegelschrank', ''], ['Pflaster', '🩹', 'Medizin', 'Bad', 'Spiegelschrank', 'genug'], ['Kamera Sony', '📷', 'Elektronik', 'Arbeitszimmer', '', ''],
      ['Kopfhörer', '🎧', 'Elektronik', 'Arbeitszimmer', '', ''], ['Leiter', '🪜', 'Werkzeug', 'Keller', '', ''], ['Staubsauger', '🧹', 'Haushalt', 'Flur', 'Abstellkammer', ''],
      ['Wasserwaage', '📏', 'Werkzeug', 'Werkbank', '', ''], ['Schneeketten', '❄️', 'Auto', 'Keller', '', ''], ['Picknickdecke', '🧺', 'Freizeit', 'Kofferraum', '', ''],
    ];
    const hue = { Werkzeug: 28, Küche: 12, Elektronik: 210, Kleidung: 260, Haushalt: 45, Auto: 200, Garten: 110, Sport: 340, Medizin: 0, Freizeit: 160 };
    const mk = async (emoji, h, w) => {
      const cv = document.createElement('canvas'); cv.width = w; cv.height = Math.round(w * 0.75); const c = cv.getContext('2d');
      const g = c.createLinearGradient(0, 0, cv.width, cv.height); g.addColorStop(0, `hsl(${h} 30% 82%)`); g.addColorStop(1, `hsl(${h + 20} 25% 62%)`);
      c.fillStyle = g; c.fillRect(0, 0, cv.width, cv.height);
      c.fillStyle = 'rgba(0,0,0,.12)'; c.beginPath(); c.ellipse(cv.width / 2, cv.height * 0.8, cv.width * 0.28, cv.height * 0.06, 0, 0, 7); c.fill();
      c.font = `${Math.round(cv.height * 0.55)}px "Noto Color Emoji"`; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText(emoji, cv.width / 2, cv.height * 0.47);
      return cv;
    };
    const items = []; const photos = [];
    for (let i = 0; i < L.length; i++) {
      const [name, emo, cat, room, loc, qty] = L[i];
      const big = await mk(emo, hue[cat], photoW);
      const blob = await new Promise(r => big.toBlob(r, 'image/jpeg', 0.8));
      const ph = { id: db.uid(), buf: await blob.arrayBuffer(), type: 'image/jpeg', createdAt: now - i * 7 * 3600e3 };
      photos.push(ph);
      const sm = await mk(emo, hue[cat], 160);
      const [pid, rid] = R[room];
      const it = db.newItem({ name, categoryId: C[cat], placeId: pid, roomId: rid, locationDetail: loc, quantity: qty, photoId: ph.id, thumb: sm.toDataURL('image/jpeg', 0.75), aiState: 'done', createdAt: now - i * 7 * 3600e3, updatedAt: now - i * 7 * 3600e3 });
      if (name === 'Akkuschrauber Bosch') it.out = { type: 'verliehen', to: 'Tom', since: now - 4 * DAY };
      if (name === 'Zelt 3 Personen') it.out = { type: 'verliehen', to: 'Nachbarin Eva', since: now - 12 * DAY };
      if (name === 'Laptop ThinkPad') { it.out = { type: 'unterwegs', to: 'Kunde Stuttgart', since: now - DAY }; it.serial = 'PF3XK92'; it.purchaseDate = iso(-700); it.warrantyUntil = iso(20); }
      if (name === 'Kaffeemaschine') { it.purchaseDate = iso(-300); it.warrantyUntil = iso(430); it.note = 'Entkalken alle 4 Wochen'; }
      if (['Verbandskasten', 'Warndreieck', 'Eiskratzer', 'Starthilfekabel', 'Regenschirm'].includes(name)) it.essential = true;
      if (name === 'Regenschirm') it.out = { type: 'unterwegs', to: '', since: now - 2 * DAY };
      items.push(it);
    }
    if (withNoPlace) {
      let k = 0;
      for (const [emo, name] of [['📦', ''], ['🧸', 'Teddybär'], ['🎁', ''], ['🕯️', 'Kerzen']]) {
        const sm = await mk(emo, 30, 160);
        const at = now - 3600e3 - 60e3 * k++;   // verschieden, damit die Reihenfolge feststeht
        items.push(db.newItem({ name, thumb: sm.toDataURL('image/jpeg', 0.75), aiState: name ? 'done' : 'failed', createdAt: at, updatedAt: at }));
      }
    }
    for (const [emo, name] of [['📻', 'Altes Radio'], ['👟', 'Laufschuhe alt']]) {
      const sm = await mk(emo, 50, 160);
      items.push(db.newItem({ name, thumb: sm.toDataURL('image/jpeg', 0.75), placeId: zu, roomId: R['Keller'][1], archived: 1, archivedAt: now - 5 * DAY, aiState: 'done', createdAt: now - 90 * DAY }));
    }
    const F = {}; let o = 0;
    for (const n of ['Versicherungen', 'Verträge', 'Steuer', 'Auto', 'Arbeit', 'Gesundheit', 'Wohnen']) F[n] = db.uid();
    const folders = Object.entries(F).map(([name, id]) => ({ id, name, parentId: null, createdAt: now, order: o++ }));
    F['Steuer 2025'] = db.uid(); folders.push({ id: F['Steuer 2025'], name: '2025', parentId: F['Steuer'], createdAt: now, order: 0 });
    F['Steuer 2024'] = db.uid(); folders.push({ id: F['Steuer 2024'], name: '2024', parentId: F['Steuer'], createdAt: now, order: 1 });
    const pdf = (t) => new TextEncoder().encode(`%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj 2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj 3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 595 842]/Contents 4 0 R/Resources<</Font<</F1<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>>>>>>>endobj 4 0 obj<</Length 60>>stream\nBT /F1 24 Tf 72 760 Td (${t}) Tj ET\nendstream endobj\ntrailer<</Root 1 0 R>>\n%%EOF`).buffer;
    const D = [
      ['Kfz-Versicherung HUK 2026', 'Versicherungen', ['Kfz', 'Haftpflicht'], iso(-200), iso(25), 'kuendigen'],
      ['Hausrat-Versicherung', 'Versicherungen', ['Hausrat'], iso(-400), '', ''],
      ['Privathaftpflicht', 'Versicherungen', [], iso(-800), '', ''],
      ['Mietvertrag Wohnung', 'Wohnen', ['Miete'], iso(-1500), '', ''],
      ['Nebenkostenabrechnung 2025', 'Wohnen', ['NK'], iso(-60), '', ''],
      ['Handyvertrag Telekom', 'Verträge', ['Handy'], iso(-500), iso(12), 'kuendigen'],
      ['Fitnessstudio', 'Verträge', [], iso(-300), iso(80), 'kuendigen'],
      ['Lohnsteuerbescheinigung 2025', 'Steuer 2025', ['Lohn'], iso(-250), '', ''],
      ['Steuerbescheid 2024', 'Steuer 2024', [], iso(-150), '', ''],
      ['TÜV-Bericht', 'Auto', ['HU'], iso(-330), iso(35), 'ablauf'],
      ['Fahrzeugschein', 'Auto', [], iso(-1000), '', ''],
      ['Arbeitsvertrag', 'Arbeit', [], iso(-900), '', ''],
      ['Reisekosten September', 'Arbeit', ['Spesen'], iso(-10), '', ''],
      ['Impfpass', 'Gesundheit', [], iso(-2000), '', ''],
      ['Personalausweis Kopie', null, [], iso(-600), iso(140), 'ablauf'],
    ];
    const docs = D.map(([name, f, tags, date, due, dueKind], i) => ({ id: db.uid(), itemId: null, folderId: f ? F[f] : null, name, type: 'application/pdf', buf: pdf(name), createdAt: now - i * DAY, updatedAt: now - i * DAY, date, tags, due, dueKind, trashedAt: null }));
    const lap = items.find(i => i.name === 'Laptop ThinkPad'); const kaf = items.find(i => i.name === 'Kaffeemaschine');
    const kb = await mk('🧾', 40, 900); const kbb = await new Promise(r => kb.toBlob(r, 'image/jpeg', 0.8));
    docs.push({ id: db.uid(), itemId: lap.id, folderId: null, name: 'Rechnung Laptop', type: 'application/pdf', buf: pdf('Rechnung'), createdAt: now - 700 * DAY, updatedAt: now, date: iso(-700), tags: [], due: '', dueKind: '', trashedAt: null });
    docs.push({ id: db.uid(), itemId: kaf.id, folderId: null, name: 'Kassenbon Kaffeemaschine', type: 'image/jpeg', buf: await kbb.arrayBuffer(), createdAt: now - 300 * DAY, updatedAt: now, date: iso(-300), tags: [], due: '', dueKind: '', trashedAt: null });
    docs.push({ id: db.uid(), itemId: null, folderId: F['Verträge'], name: 'Alter Stromvertrag', type: 'application/pdf', buf: pdf('Strom'), createdAt: now - 900 * DAY, updatedAt: now, date: iso(-900), tags: [], due: '', dueKind: '', trashedAt: now - 3 * DAY });
    await db.writeImport({ items, photos, docs, folders });
    await db.setSetting('onboarded', true);
    await db.setSetting('homePlace', '');
  }, { withNoPlace, photoW });
}

/**
 * Wenige Einträge – mit dem, was die geladene Fassung kann (Orte ab 1.7, Belege ab 1.8,
 * Ordner ab 1.9). Fotos klein (64 px), damit Sicherungsdateien als Fixture klein bleiben.
 */
async function seedMini(page, { key = '' } = {}) {
  return page.evaluate(async ({ key }) => {
    const db = await import('./js/db.js');
    const has = (f) => typeof db[f] === 'function';
    const now = Date.now(); const DAY = 864e5;
    const pic = async (hue, w) => {
      const c = document.createElement('canvas'); c.width = w; c.height = Math.round(w * 0.75);
      const x = c.getContext('2d'); x.fillStyle = `hsl(${hue} 40% 70%)`; x.fillRect(0, 0, c.width, c.height);
      x.fillStyle = `hsl(${hue} 40% 35%)`; x.fillRect(c.width * 0.3, c.height * 0.3, c.width * 0.4, c.height * 0.4);
      return c;
    };
    const places = has('ensurePlace');
    const zu = places ? await db.ensurePlace('Zuhause', { icon: 'haus', color: 'tanne' }) : null;
    const auto = places ? await db.ensurePlace('Auto', { icon: 'auto', color: 'tinte' }) : null;
    const room = (pid, name) => (has('ensureRoom') ? db.ensureRoom(pid, name) : db.ensureNamed('rooms', name));
    const R = { Keller: [zu, await room(zu, 'Keller')], Küche: [zu, await room(zu, 'Küche')], Kofferraum: [auto, await room(auto, 'Kofferraum')] };
    const C = {};
    for (const c of ['Werkzeug', 'Küche', 'Auto']) C[c] = await db.ensureNamed('categories', c);
    const rows = [
      ['Akkuschrauber', 'Keller', 'Werkzeug', '1', 20],
      ['Teekanne', 'Küche', 'Küche', '', 40],
      ['Warndreieck', 'Kofferraum', 'Auto', '', 200],
      ['', null, '', '', 300],
      ['Altes Radio', 'Keller', '', '', 120],
    ];
    const ids = {};
    let t = now - rows.length * 3600e3;
    for (const [name, rm, cat, qty, hue] of rows) {
      const big = await pic(hue, 64);
      const blob = await new Promise(r => big.toBlob(r, 'image/jpeg', 0.7));
      const photo = { id: db.uid(), buf: await blob.arrayBuffer(), type: 'image/jpeg', createdAt: t };
      const it = db.newItem({
        name, roomId: rm ? R[rm][1] : null, categoryId: cat ? C[cat] : null, quantity: qty,
        photoId: photo.id, thumb: (await pic(hue, 32)).toDataURL('image/jpeg', 0.6), aiState: name ? 'done' : null, createdAt: t, updatedAt: t,
      });
      if (places && rm) it.placeId = R[rm][0];
      if (name === 'Akkuschrauber' && has('addDoc')) it.out = { type: 'verliehen', to: 'Tom', since: now - 4 * DAY };
      if (name === 'Altes Radio') { it.archived = 1; it.archivedAt = now - DAY; }
      await db.saveItems([it], photo);
      ids[name || 'unbenannt'] = it.id;
      t += 3600e3;
    }
    const pdf = (s) => new TextEncoder().encode(`%PDF-1.4\n% ${s}\n%%EOF`).buffer;
    if (has('addDoc')) {
      await db.addDoc({ id: db.uid(), itemId: ids.Akkuschrauber, name: 'Rechnung Akkuschrauber', type: 'application/pdf', buf: pdf('Rechnung'), createdAt: now - 10 * DAY });
    }
    let folders = 0;
    try {
      const d = await db.openDB();
      if (d.objectStoreNames.contains('folders')) {
        const fid = db.uid();
        await db.put('folders', { id: fid, name: 'Verträge', parentId: null, createdAt: now, order: 0 });
        await db.put('docs', { id: db.uid(), itemId: null, folderId: fid, name: 'Handyvertrag', type: 'application/pdf', buf: pdf('Handy'), createdAt: now, updatedAt: now, date: new Date(now).toISOString().slice(0, 10), tags: ['Handy'], due: new Date(now + 12 * DAY).toISOString().slice(0, 10), dueKind: 'kuendigen', trashedAt: null });
        folders = 1;
      }
    } catch (_) { /* alte Fassung ohne Ordner */ }
    if (key) await db.setSetting('apiKey', key);
    await db.setSetting('onboarded', true);
    return { places, folders, ids };
  }, { key });
}

/** Zählt die Datensätze aller Stores (auch über alte Fassungen hinweg). */
function counts(page) {
  return page.evaluate(() => new Promise((resolve, reject) => {
    const q = indexedDB.open('heim-inventar');
    q.onerror = () => reject(q.error);
    q.onsuccess = () => {
      const d = q.result;
      const names = [...d.objectStoreNames].filter(n => n !== 'settings');
      const out = { dbVersion: d.version };
      if (!names.length) { d.close(); resolve(out); return; }
      const tx = d.transaction(names, 'readonly');
      for (const n of names) { const r = tx.objectStore(n).count(); r.onsuccess = () => { out[n] = r.result; }; }
      tx.oncomplete = () => { d.close(); resolve(out); };
      tx.onerror = () => { d.close(); reject(tx.error); };
    };
  }));
}

module.exports = { seedFull, seedMini, counts };
