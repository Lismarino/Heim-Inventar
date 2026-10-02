// Abnahme 2.0 (AP 3/4): Filter-Blatt mit Chips in „Alles“, Einstellungen ≤ 1,3 Bildschirme ohne
// Technikbegriffe außerhalb „Erweitert“, Über & Hilfe, „Was ist neu“ nur nach einem Update und
// Dynamic Type (135 % Textgröße ohne abgeschnittene Knöpfe).
'use strict';
const A = require('./lib/app.js');

module.exports = async (t) => {
  const { page, errs } = await A.open(t);
  await A.start(t, page, { seed: 'full', photoW: 200 });
  await A.sleep(400);

  /* ---------- Alles: Filter-Knopf, Blatt, Chips, „x von y“ ---------- */
  await A.tab(page, 'list');
  t.ok('Alles: keine Auswahllisten mehr, ein Filter-Knopf neben der Suche',
    await page.evaluate(() => !document.querySelector('#view-list .toolbar select') && !!document.querySelector('.search-row #filter-btn')));
  // 2.0.1: Kamera „Habe ich das schon?“ als Knopf rechts im Suchfeld, benannt, 44 × 44, Text läuft nicht darunter.
  const cam = await page.evaluate(() => {
    const b = document.getElementById('have-btn'), q = document.getElementById('q');
    const rb = b.getBoundingClientRect(), rq = q.getBoundingClientRect();
    return { inside: !!b.closest('.search') && rb.left >= rq.left && rb.right <= rq.right + 0.5 && rb.top >= rq.top - 0.5 && rb.bottom <= rq.bottom + 0.5,
      right: Math.round(rq.right - rb.right), w: rb.width, h: rb.height, label: b.getAttribute('aria-label'),
      pad: parseFloat(getComputedStyle(q).paddingRight) >= rb.width };
  });
  t.ok('Alles: Kamera-Knopf im Suchfeld rechts, mit Namen, 44 × 44, Text endet davor', cam.inside && cam.right <= 2 && cam.w >= 44 && cam.h >= 44 && /Habe ich das schon/.test(cam.label) && cam.pad, JSON.stringify(cam));
  const total = await page.locator('#list .row').count();
  await page.click('#filter-btn');
  await A.sleep(500);
  const fields = await page.evaluate(() => [...document.querySelectorAll('#sheet-body .field > span')].map(s => s.textContent));
  t.ok('Filter-Blatt: Ort, Raum, Kategorie, Status', ['Ort', 'Raum', 'Kategorie', 'Status'].every(f => fields.includes(f)), fields.join());
  const cat = await page.evaluate(() => [...document.querySelectorAll('#ff-cat option')].find(o => o.value)?.value);
  await page.selectOption('#ff-cat', cat);
  await A.sheetSubmit(page);
  const f1 = await page.evaluate(() => ({
    chips: [...document.querySelectorAll('#filters [data-unfilter]')].map(c => c.textContent.trim()),
    hits: document.getElementById('list-hits').hidden ? '' : document.getElementById('list-hits').textContent,
    rows: document.querySelectorAll('#list .row').length,
    tags: document.querySelectorAll('#list .row .tag').length,
    when: document.querySelectorAll('#list .row .when').length,
  }));
  t.ok('Filter: Chip mit ×, „n von N“, weniger Zeilen', f1.chips.length === 1 && f1.hits === `${f1.rows} von 61` && f1.rows < 61, JSON.stringify(f1));
  t.ok('Zeilen: kein Datum, kein doppeltes Kategorie-Etikett bei Kategorie-Filter', f1.when === 0 && f1.tags === 0, JSON.stringify(f1));
  await page.click('#filters [data-unfilter]');
  await A.sleep(300);
  t.ok('Chip × entfernt den Filter', await page.locator('#list .row').count() >= total && await page.isHidden('#filters'));
  // Bestand ± darf den Ort nicht verdrängen
  const cut = await page.evaluate(() => [...document.querySelectorAll('#list .row')].filter(r => r.querySelector('.qty-step')).slice(0, 10)
    .map(r => { const p = r.querySelector('.place > span:last-child'); return p && p.scrollWidth > p.clientWidth + 1 ? p.textContent : ''; }).filter(Boolean));
  t.ok('Zeilen mit Bestand ±: Ort nicht abgeschnitten', cut.length === 0, cut.join(' | '));

  /* ---------- Einstellungen ---------- */
  await A.tab(page, 'settings');
  await A.sleep(300);
  const st = await page.evaluate(() => {
    const sc = document.querySelector('#view-settings .scroll');
    const main = document.querySelector('#view-settings .spage[data-spage=""]');
    return {
      screens: sc.scrollHeight / window.innerHeight,
      secs: [...main.querySelectorAll('h2.sec')].map(h => h.textContent).concat([...main.querySelectorAll('.set-link')].map(l => l.textContent.trim())),
      tech: /OAuth|Modell|Client-ID|Datenbank/.test(main.innerText),
      last: document.getElementById('bk-last').textContent,
    };
  });
  t.ok('Einstellungen ≤ 1,3 Bildschirme', st.screens <= 1.3, st.screens.toFixed(2));
  t.ok('Einstellungen: Sicherung · KI-Erkennung · Kategorien · Töne · Über & Hilfe · Erweitert',
    ['Sicherung', 'KI-Erkennung', 'Kategorien', 'Töne', 'Über & Hilfe', 'Erweitert'].every(x => st.secs.includes(x)), st.secs.join(' | '));
  t.ok('Einstellungen: keine Technikbegriffe außerhalb „Erweitert“', !st.tech);
  t.ok('Einstellungen: Stand der Sicherung sichtbar', /gesichert/.test(st.last), st.last);
  await page.click('[data-spage-go="adv"]');
  await A.sleep(300);
  t.ok('Erweitert: Google Drive, Modell, Bildgröße, Datenbank prüfen, Einführung',
    await page.evaluate(() => ['#gd-client', '#set-model', '#set-imgmax', '#diag-run', '#onb-again'].every(s => document.querySelector(s).offsetParent)));
  await page.click('#view-settings [data-nav="back"]');
  await A.sleep(300);
  t.ok('Zurück aus einer Unterseite führt zur Hauptseite', (await A.view(page)) === 'settings' && await page.isVisible('#bk-last'));
  // 2.0.1: Zurückwischen in einer Unterseite wirkt wie „Zurück“ – erst zur Hauptseite, dann hinaus.
  for (const sp of ['cats', 'about', 'adv']) {
    await page.click(`[data-spage-go="${sp}"]`);
    await A.sleep(300);
    await A.swipeBack(page);
    const sw = await page.evaluate(() => ({ view: document.body.dataset.view, main: !document.querySelector('#view-settings .spage[data-spage=""]').hidden, h1: document.querySelector('#view-settings h1').textContent }));
    t.ok(`Zurückwischen aus Unterseite „${sp}“ führt zur Hauptseite der Einstellungen`, sw.view === 'settings' && sw.main && sw.h1 === 'Einstellungen', JSON.stringify(sw));
  }
  await A.swipeBack(page);
  t.ok('Zurückwischen auf der Hauptseite verlässt die Einstellungen', (await A.view(page)) === 'home');
  await A.tab(page, 'settings');

  /* ---------- Über & Hilfe ---------- */
  await page.click('[data-spage-go="about"]');
  await A.sleep(300);
  const ab = await page.evaluate(() => {
    const p = document.querySelector('.spage[data-spage="about"]');
    return {
      ver: document.getElementById('ver-info').textContent,
      priv: /nur auf diesem Gerät/.test(p.textContent) && /nie der Inhalt/.test(p.textContent) && /verschlüsselt/.test(p.textContent),
      faq: p.querySelectorAll('.faq details').length,
      mail: document.getElementById('feedback').getAttribute('href'),
    };
  });
  const V = require('fs').readFileSync(require('path').join(t.root, 'js/version.js'), 'utf8').match(/APP_VERSION = '([^']+)'/)[1];
  t.ok('Über & Hilfe: Version, Datenschutz, 6 Fragen', ab.ver.includes(V) && ab.priv && ab.faq === 6, JSON.stringify(ab));
  t.ok('Über & Hilfe: Feedback per E-Mail ohne Adresse, Betreff mit Version', /^mailto:\?subject=/.test(ab.mail) && decodeURIComponent(ab.mail).includes(V), ab.mail);
  t.ok('Kein „Was ist neu“ bei Testdaten, die es schon gesehen haben', await page.isHidden('#sheet'));

  /* ---------- Dynamic Type: 135 % ---------- */
  await page.evaluate(() => { document.documentElement.style.fontSize = (17 * 1.35) + 'px'; });
  await A.tab(page, 'home');
  await A.sleep(300);
  const dt = await page.evaluate(() => {
    const clipped = (sel) => [...document.querySelectorAll(sel)].filter(e => e.offsetParent && (e.scrollWidth > e.clientWidth + 1 || e.scrollHeight > e.clientHeight + 2))
      .map(e => (e.id || e.className) + ':' + e.textContent.trim().slice(0, 20));
    return {
      body: parseFloat(getComputedStyle(document.body).fontSize),
      cut: clipped('#nav button, #view-home .topbar button, #view-home .btn'),
    };
  });
  t.ok('Dynamic Type: Grundschrift wächst mit (135 %)', dt.body > 20, String(dt.body));
  t.ok('Dynamic Type: bei 135 % keine abgeschnittenen Knöpfe', dt.cut.length === 0, dt.cut.join(' | '));
  await page.evaluate(() => { document.documentElement.style.fontSize = ''; });

  t.ok('2.0: ohne Konsolenfehler', errs.length === 0, errs.join(' | '));

  /* ---------- Neuinstallation: kein „Was ist neu“ ---------- */
  const fresh = await A.open(t);
  await A.start(t, fresh.page);
  await A.sleep(400);
  const freshNew = await fresh.page.evaluate(() => /Neu: Keepsy/.test(document.getElementById('sheet-body')?.textContent || ''));
  t.ok('Neuinstallation: kein „Was ist neu“', !freshNew);
};
