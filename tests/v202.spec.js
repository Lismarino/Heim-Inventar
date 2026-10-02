// Nachbesserungen 2.0.2 (unabhängige Prüfung): Wichtig-Karte übernimmt den Ort, Kopfzeile bei
// großer Textgröße, „Was ist neu“ nennt den Papierkorb, Rückgängig nach Auto-Speichern, „Dinge“
// statt „Einträge“, Hilfe-Texte, Unterwegs-Etikett, Leiste, KI-Suche mit Filtern, „Filter
// zurücksetzen“, lokales Datum.
'use strict';
const fs = require('fs');
const path = require('path');
const A = require('./lib/app.js');

module.exports = async (t) => {
  const { page, errs, ai } = await A.open(t);
  await A.start(t, page, { seed: 'full', key: 'AIzaTEST' });
  // Wie nach einem Update von 1.x: „Was ist neu“ noch nicht gesehen.
  await A.dbq(page, (db) => db.setSetting('seenNew', ''));
  await page.reload();
  await A.ready(page);
  await A.sleep(700);

  /* ---------- 3. Was ist neu: Papierkorb ---------- */
  const wn = await page.evaluate(() => ({ txt: document.getElementById('sheet-body')?.textContent || '', pts: document.querySelectorAll('#sheet-body .new-pt').length }));
  // 2.1: „Was ist neu“ nennt Look, Farbe und den neuen Namen – mit dem Hinweis, vor dem Neu-Hinzufügen zu sichern.
  t.ok('Was ist neu (2.1): Keepsy, Darstellung, erst sichern – höchstens 3 Punkte',
    /Keepsy/.test(wn.txt) && /Darstellung/.test(wn.txt) && /neu hinzufügst/.test(wn.txt) && /sichern/.test(wn.txt) && wn.pts <= 3, `${wn.pts} ${wn.txt.replace(/\s+/g, ' ').trim().slice(0, 160)}`);
  await A.closeSheet(page);

  /* ---------- 1. Wichtig-Karte → Alles im gewählten Ort ---------- */
  await A.tab(page, 'home');
  const places = await page.evaluate(() => [...document.querySelectorAll('#home-places [data-home-place]')].map(b => b.dataset.homePlace).filter(Boolean));
  let hit = null;
  for (const pid of places) {
    await page.evaluate((pid) => document.querySelector(`#home-places [data-home-place="${pid}"]`).click(), pid);
    await A.sleep(300);
    // Status-Zeilen stehen meist erst im Blatt „Alle anzeigen“ (dieselben Zeilen wie auf der Karte).
    await page.evaluate(() => document.querySelector('#view-home [data-todo-all]')?.click());
    await A.sleep(500);
    hit = await page.evaluate(() => {
      for (const k of ['out', 'unnamed']) {
        const r = document.querySelector(`#view-home [data-todo="${k}"], #sheet-body [data-todo="${k}"]`);
        if (r) return { k, n: parseInt(r.querySelector('b').textContent, 10) };
      }
      return null;
    });
    if (hit) { hit.pid = pid; break; }
    await A.closeSheet(page);
  }
  t.ok('Wichtig: im gewählten Ort gibt es eine Status-Zeile', !!hit, JSON.stringify(places));
  if (hit) {
    const pname = await page.evaluate((pid) => document.querySelector(`#home-places [data-home-place="${pid}"]`).textContent.trim(), hit.pid);
    await page.evaluate((k) => document.querySelector(`#sheet-body [data-todo="${k}"], #view-home [data-todo="${k}"]`).click(), hit.k);
    await A.sleep(500);
    const li = await page.evaluate(() => ({
      view: document.body.dataset.view,
      chips: [...document.querySelectorAll('#filters [data-unfilter]')].map(c => c.dataset.unfilter + ':' + c.textContent.trim()),
      rows: document.querySelectorAll('#list .row').length,
      visible: !document.getElementById('filters').hidden,
    }));
    t.ok('Wichtig-Karte → Alles: Orts-Chip sichtbar, Zahl stimmt mit der Karte',
      li.view === 'list' && li.visible && li.chips.some(c => c.startsWith('place:') && pname.includes(c.slice(6))) && li.chips.some(c => c.startsWith('status:')) && li.rows === hit.n,
      JSON.stringify({ hit, pname, li }));
  }

  /* ---------- 10. Filter zurücksetzen (Blatt und leerer Zustand) ---------- */
  await page.click('#filter-btn');
  await A.sleep(500);
  t.ok('Filter-Blatt: „Filter zurücksetzen“ bei aktiven Filtern', await page.isVisible('#ff-reset'));
  await page.click('#ff-reset');
  await A.sleep(500);
  const total = await page.evaluate(() => ({ chips: !document.getElementById('filters').hidden, rows: document.querySelectorAll('#list .row').length }));
  t.ok('„Filter zurücksetzen“ im Blatt: alle Chips weg', !total.chips && total.rows > 0, JSON.stringify(total));
  // Leerer Zustand: Kategorie-Filter plus Suche ohne Treffer.
  await page.click('#filter-btn');
  await A.sleep(500);
  const cat = await page.evaluate(() => [...document.querySelectorAll('#ff-cat option')].find(o => o.value)?.value);
  await page.selectOption('#ff-cat', cat);
  await A.sheetSubmit(page);
  const catRows = await page.locator('#list .row').count();
  await A.search(page, 'zzzzqqq');
  t.ok('Leerer Zustand mit Filter: Knopf „Filter zurücksetzen“', await page.isVisible('#list-empty [data-reset-filters]'));
  await page.click('#list-empty [data-reset-filters]');
  await A.sleep(300);
  t.ok('„Filter zurücksetzen“ im leeren Zustand nimmt die Filter weg', await page.isHidden('#filters'));
  await A.search(page, '');

  /* ---------- 9. KI-Suche: Filter gelten, Chips bleiben ---------- */
  await page.click('#filter-btn');
  await A.sleep(500);
  await page.selectOption('#ff-cat', cat);
  await A.sheetSubmit(page);
  ai.reply = { answer: 'Hier ist alles.', matches: Array.from({ length: 70 }, (_, i) => ({ n: i + 1, why: 'passt' })) };
  await A.search(page, 'zeig mir alles bitte');
  await page.click('#ai-search');
  await page.waitForSelector('#ai-answer:not([hidden])', { timeout: 8000 }).catch(() => {});
  await A.sleep(300);
  const kiRes = await page.evaluate(() => ({ chips: !document.getElementById('filters').hidden, rows: document.querySelectorAll('#list .row[data-id]').length, docs: document.querySelectorAll('#list .drow').length }));
  t.ok('KI-Suche: Kategorie-Filter gilt für die Treffer, Chip bleibt sichtbar', kiRes.chips && kiRes.rows === catRows && kiRes.docs === 0, JSON.stringify({ catRows, kiRes }));
  await page.click('#filters [data-unfilter]');
  await A.sleep(300);
  const kiAll = await page.evaluate(() => document.querySelectorAll('#list .row[data-id]').length);
  t.ok('KI-Suche: Chip × zeigt wieder alle KI-Treffer', kiAll > catRows, `${kiAll} > ${catRows}`);
  await page.click('#ai-clear');
  await A.sleep(300);

  /* ---------- 4. + 5. Auto-Speichern mit Rückgängig, Titel = Name ---------- */
  const id = await A.openRow(page, 'Laptop ThinkPad');
  t.ok('Ding: Titel der Kopfzeile ist sein Name', (await page.textContent('#item-title')).trim() === 'Laptop ThinkPad');
  const oldNote = (await A.byName(page, 'Laptop ThinkPad')).note || '';
  await page.fill('#it-note', 'Neue Notiz zum Rückgängigmachen');
  await A.back(page);
  await A.sleep(400);
  const ts = await page.evaluate(() => ({ msg: document.querySelector('#toast .toast-msg')?.textContent || '', act: document.querySelector('#toast .toast-act')?.textContent.trim() || '' }));
  t.ok('Auto-Speichern beim Verlassen: „Gespeichert · Rückgängig“', /^Gespeichert/.test(ts.msg) && ts.act === 'Rückgängig', JSON.stringify(ts));
  t.ok('Auto-Speichern: Änderung steht in der Datenbank', (await A.byName(page, 'Laptop ThinkPad')).note === 'Neue Notiz zum Rückgängigmachen');
  await page.click('#toast .toast-act');
  await A.sleep(600);
  const after = await A.dbq(page, (db, id) => db.get('items', id), id);
  t.ok('Rückgängig stellt die alten Werte wieder her', (after.note || '') === oldNote, JSON.stringify(after.note));
  await A.openRow(page, 'Laptop ThinkPad');
  await A.back(page);
  await A.sleep(300);
  t.ok('Ohne Änderung: kein „Gespeichert“', !/Gespeichert/.test(await page.evaluate(() => document.getElementById('toast').hidden ? '' : document.getElementById('toast').textContent)));

  /* ---------- 5. Begriffe ---------- */
  const html = fs.readFileSync(path.join(t.root, 'index.html'), 'utf8');
  const visibleTxt = html.replace(/<!--[\s\S]*?-->/g, '').replace(/<script[\s\S]*?<\/script>/g, '');
  t.ok('Oberfläche: kein „Eintrag“/„Einträge“ mehr in index.html', !/>[^<]*Eintr[aä]g/.test(visibleTxt) && !/placeholder="[^"]*Eintr[aä]g/.test(visibleTxt));
  const jsTxt = fs.readdirSync(path.join(t.root, 'js')).filter(f => f.endsWith('.js') && f !== 'gemini.js')
    .map(f => fs.readFileSync(path.join(t.root, 'js', f), 'utf8').split('\n').filter(l => !/^\s*(\/\/|\*|\/\*)/.test(l)).map(l => l.replace(/\/\/ .*$/, '')).join('\n')).join('\n');
  t.ok('Oberfläche: kein „Eintrag“/„Einträge“ in Texten der Module', !/['`„][^'`\n]*Eintr[aä]g/.test(jsTxt), (jsTxt.match(/.*['`„][^'`\n]*Eintr[aä]g.*/) || [''])[0].trim());
  await A.tab(page, 'settings');
  const set = await page.evaluate(() => ({ st: document.getElementById('storage-info').textContent, exp: document.querySelector('label.check #exp-photos')?.parentElement.textContent.trim() }));
  t.ok('Speicher: „n Dinge (davon m im Papierkorb)“', /^\d+ Dinge \(davon \d+ im Papierkorb\)/.test(set.st), set.st);
  t.ok('Sicherung: „Fotos und Dokumente mitsichern“', set.exp === 'Fotos und Dokumente mitsichern', set.exp);

  /* ---------- 6. Hilfe-Texte ---------- */
  const help = await page.evaluate(() => document.querySelector('.spage[data-spage="about"]').textContent);
  t.ok('Hilfe: „Neue Version verfügbar“ wie im Hinweis', help.includes('„Neue Version verfügbar“') && !help.includes('Neue Version bereit'));
  t.ok('Hilfe: Scannen über „+“ und dann „Scannen“', help.includes('auf „+“ und dann „Scannen“'));

  /* ---------- 11. Datum in Ortszeit ---------- */
  const day = await page.evaluate(async () => {
    const m = await import('./js/match.js');
    const d = new Date(2026, 0, 1, 0, 30);   // kurz nach Mitternacht Ortszeit (UTC: noch 31.12.)
    return { local: m.localDay(d.getTime()), iso: d.toISOString().slice(0, 10) };
  });
  t.ok('localDay: Ortszeit statt UTC (kurz nach Mitternacht)', day.local === '2026-01-01' && day.iso === '2025-12-31', JSON.stringify(day));
  const src = ['js/backup.js', 'js/cabinet.js'].map(f => fs.readFileSync(path.join(t.root, f), 'utf8')).join('\n');
  t.ok('Sicherung und Dokumente: kein toISOString().slice(0, 10) mehr', !/toISOString\(\)\.slice\(0, ?10\)/.test(src));

  /* ---------- 2. / 7. / 8. Dynamic Type 135 % und 170 % ---------- */
  t.ok('Suchfeld: kurzer Platzhalter „Suchen …“', (await page.getAttribute('#q', 'placeholder')) === 'Suchen …');
  for (const pct of [135, 170]) {
    await page.evaluate((px) => { document.documentElement.style.fontSize = px + 'px'; }, 17 * pct / 100);
    await A.sleep(200);
    const head = async () => page.evaluate(() => {
      const bar = document.querySelector(`#view-${document.body.dataset.view} .topbar`);
      const kids = [...bar.children].filter(k => k.getBoundingClientRect().width > 0).map(k => k.getBoundingClientRect());
      let overlap = false;
      for (let i = 0; i < kids.length; i++) for (let j = i + 1; j < kids.length; j++) if (kids[i].right > kids[j].left + 1 && kids[j].right > kids[i].left + 1) overlap = true;
      const h1 = bar.querySelector('h1'), b = bar.querySelector('.back');
      return { overlap, ell: getComputedStyle(h1).textOverflow, label: b.getAttribute('aria-label'), txt: getComputedStyle(b.querySelector('.back-txt')).display !== 'none', right: Math.max(...kids.map(k => k.right)) <= innerWidth };
    });
    await A.tab(page, 'settings');
    const hs = await head();
    t.ok(`${pct} %: Einstellungen – „Zurück“ überlappt den Titel nicht`, !hs.overlap && hs.right && hs.ell === 'ellipsis' && hs.label === 'Zurück', JSON.stringify(hs));
    if (pct === 170) t.ok('170 %: „Zurück“ nur als Pfeil (Name bleibt per aria-label)', !hs.txt, JSON.stringify(hs));
    await A.tab(page, 'list');
    await A.openRow(page, 'Laptop ThinkPad');
    const hi = await head();
    t.ok(`${pct} %: Ding – Kopfzeile ohne Überlappung, Titel mit „…“`, !hi.overlap && hi.right && hi.ell === 'ellipsis', JSON.stringify(hi));
    await A.back(page);
    const lt = await page.evaluate(() => {
      const tags = [...document.querySelectorAll('#list .out-tag span')].filter(s => s.offsetParent);
      const nav = [...document.querySelectorAll('#nav button span:not(.fab)')];
      const r = nav.map(s => s.getBoundingClientRect());
      return {
        tags: tags.length,
        off: tags.filter(s => s.getBoundingClientRect().right > innerWidth + 1 || (s.scrollWidth > s.clientWidth + 1 && getComputedStyle(s).textOverflow !== 'ellipsis')).length,
        navFs: Math.max(...nav.map(s => parseFloat(getComputedStyle(s).fontSize))),
        navCut: nav.filter(s => s.scrollWidth > s.clientWidth + 1).map(s => s.textContent),
        navOverlap: r.some((a, i) => i && r[i - 1].right > a.left + 1),
        navWrap: nav.some(s => s.getBoundingClientRect().height > parseFloat(getComputedStyle(s).fontSize) * 1.6),
      };
    });
    t.ok(`${pct} %: Unterwegs-Etikett bleibt im Bild und kürzt mit „…“`, lt.tags > 0 && lt.off === 0, JSON.stringify(lt));
    t.ok(`${pct} %: Tab-Beschriftungen ≤ 12 px, ganz lesbar, ohne Umbruch und Überlappung`, lt.navFs <= 12 && !lt.navCut.length && !lt.navOverlap && !lt.navWrap, JSON.stringify(lt));
  }
  await page.evaluate(() => { document.documentElement.style.fontSize = ''; });

  t.ok('2.0.2: ohne Konsolenfehler', errs.length === 0, errs.join(' | '));
};
