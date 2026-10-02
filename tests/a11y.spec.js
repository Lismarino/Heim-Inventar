// Barrierefreiheit (2.0.1) – eigene Regeln, ohne externe Bibliothek. Auf allen Hauptansichten
// und offenen Blättern (hell und dunkel):
//   Namen       jedes bedienbare Element hat einen zugänglichen Namen
//   Tippfläche  ≥ 44 × 44 CSS-px – gemessen per Treffer-Test (Padding/::after zählen mit)
//   Kontrast    Text ≥ 4,5 : 1 (große Schrift ≥ 3 : 1); Glas = seine Tönung über dem App-Hintergrund
//   Überschriften  genau eine h1 je Ansicht, keine übersprungene Ebene
//   Bilder      <img> mit alt, <svg> dekorativ (aria-hidden) oder benannt
// Dazu Blätter/Dialoge (role, aria-modal, Fokus hinein und zurück, Escape, Hintergrund inert)
// und die Tab-Leiste (aria-current, sichtbarer Fokusrahmen bei Tastatur).
'use strict';
const A = require('./lib/app.js');

/* ---------- Prüfung im Browser: liefert { name, target, contrast, heads, imgs } (Listen von Funden) ---------- */
async function audit(page, { scope, view = true, contrastOnly = false }) {
  return page.evaluate(async ({ scope, view, contrastOnly }) => {
    const roots = scope.map((s) => document.querySelector(s)).filter(Boolean);
    const frame = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    const shown = (el) => {
      if (!el.getClientRects().length || el.closest('[hidden], [inert], [aria-hidden="true"]')) return false;
      const cs = getComputedStyle(el);
      return cs.visibility !== 'hidden' && cs.display !== 'none';
    };
    const all = (sel) => roots.flatMap((r) => [...r.querySelectorAll(sel)]).filter(shown);
    const who = (el) => el.tagName.toLowerCase() + (el.id ? '#' + el.id : '') + (el.className && typeof el.className === 'string' ? '.' + el.className.trim().split(/\s+/).join('.') : '');
    const out = { name: [], target: [], contrast: [], heads: [], imgs: [] };

    // Zugänglicher Name (vereinfachte accname-Berechnung).
    const text = (n) => {
      if (n.nodeType === 3) return n.textContent;
      if (n.nodeType !== 1 || n.getAttribute('aria-hidden') === 'true' || n.hidden) return '';
      if (n.getAttribute('aria-label')) return n.getAttribute('aria-label');
      if (n.tagName === 'IMG') return n.alt || '';
      return [...n.childNodes].map(text).join(' ');
    };
    const accName = (el) => {
      const lb = el.getAttribute('aria-labelledby');
      if (lb) return lb.split(/\s+/).map((id) => document.getElementById(id)?.textContent || '').join(' ').trim();
      if (el.getAttribute('aria-label')?.trim()) return el.getAttribute('aria-label').trim();
      if (el.labels?.length) { const s = [...el.labels].map((l) => text(l)).join(' ').trim(); if (s) return s; }
      if (/^(INPUT|SELECT|TEXTAREA)$/.test(el.tagName)) return (el.title || el.placeholder || '').trim();
      return (text(el).replace(/\s+/g, ' ').trim() || el.title || '').trim();
    };
    const SEL = 'a[href], button, input:not([type="hidden"]), select, textarea, summary, [role="button"], [role="link"], [role="tab"], [role="switch"], [role="checkbox"], [tabindex]:not([tabindex="-1"])';
    const controls = all(SEL);

    if (!contrastOnly) {
      for (const el of controls) if (!accName(el)) out.name.push(who(el));

      // Tippflächen: je Bauart (Element + Klassen) höchstens zwei Stück, mittig ins Bild geholt.
      const seen = new Map();
      for (const el of controls) {
        let box = el;
        if (/^(checkbox|radio)$/.test(el.type) && el.closest('label')) box = el.closest('label');
        if (/^inline$/.test(getComputedStyle(box).display) || box.classList.contains('inline')) continue;   // Link im Fließtext
        if (box.closest('.sheet-backdrop')) continue;
        const sig = who(box).replace(/#[^.]*/, '');
        if ((seen.get(sig) || 0) >= 2) continue;
        seen.set(sig, (seen.get(sig) || 0) + 1);
        box.scrollIntoView({ block: 'center', inline: 'nearest' });
        await frame();
        const r = box.getBoundingClientRect();
        if (r.bottom < 0 || r.top > innerHeight || r.right < 0 || r.left > innerWidth) continue;   // nicht ins Bild zu holen
        const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
        // Nur in der Richtung prüfen, in der das Element sichtbar unter 44 px bleibt.
        const pts = [...(r.width < 44 ? [[cx - 21.5, cy], [cx + 21.5, cy]] : []), ...(r.height < 44 ? [[cx, cy - 21.5], [cx, cy + 21.5]] : [])];
        const miss = pts.filter(([x, y]) => {
          const h = document.elementFromPoint(x, y);
          return !h || !(box.contains(h) || h.id === 'edge' || (h.tagName === 'LABEL' && h.control === el));
        });
        if (miss.length) out.target.push(`${who(box)} ${Math.round(r.width)}×${Math.round(r.height)}`);
      }

      // Überschriften
      const hs = all('h1, h2, h3, h4, h5, h6');
      const levels = hs.map((h) => Number(h.tagName[1]));
      if (view && levels.filter((l) => l === 1).length !== 1) out.heads.push(`h1 × ${levels.filter((l) => l === 1).length}`);
      for (let i = 1; i < levels.length; i++) if (levels[i] > levels[i - 1] + 1) out.heads.push(`${hs[i - 1].tagName}→${hs[i].tagName} „${hs[i].textContent.trim().slice(0, 30)}“`);

      // Bilder und Symbole
      for (const img of all('img')) if (!img.hasAttribute('alt')) out.imgs.push(who(img));
      for (const svg of roots.flatMap((r) => [...r.querySelectorAll('svg')])) {
        if (!svg.getClientRects().length || svg.closest('[hidden], [aria-hidden="true"]')) continue;
        if (!(svg.getAttribute('role') === 'img' && (svg.getAttribute('aria-label') || svg.querySelector('title')))) out.imgs.push(who(svg) + ' in ' + who(svg.parentElement));
      }
    }

    // Kontrast: Farben per Canvas lesen (rgb, color(srgb …), oklch …).
    const cv = document.createElement('canvas'); cv.width = cv.height = 1;
    const cx2 = cv.getContext('2d', { willReadFrequently: true });
    const rgba = (s) => {
      cx2.clearRect(0, 0, 1, 1); cx2.fillStyle = '#000'; cx2.fillStyle = s; cx2.fillRect(0, 0, 1, 1);
      const d = cx2.getImageData(0, 0, 1, 1).data;
      return { r: d[0], g: d[1], b: d[2], a: d[3] / 255 };
    };
    const over = (c, u) => ({ r: c.r * c.a + u.r * (1 - c.a), g: c.g * c.a + u.g * (1 - c.a), b: c.b * c.a + u.b * (1 - c.a), a: 1 });
    const lum = (c) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b); };
    const dark = matchMedia('(prefers-color-scheme: dark)').matches;
    const bgOf = (el) => {
      const layers = [];
      for (let n = el; n; n = n.parentElement) {
        const cs = getComputedStyle(n);
        if (/url\(/.test(cs.backgroundImage)) return null;   // Text über einem Foto: nicht messbar
        let c = rgba(cs.backgroundColor);
        // Verlauf: Mittel der Farben der untersten Ebene (oben liegen meist nur Glanzlichter).
        const g = cs.backgroundImage.split(/gradient\(/).pop().match(/(rgba?|color|oklch|oklab|hsla?)\([^)]*\)/g);
        if (c.a === 0 && g && cs.backgroundImage !== 'none') {
          const cs2 = g.map(rgba);
          c = cs2.reduce((m, x) => ({ r: m.r + x.r / cs2.length, g: m.g + x.g / cs2.length, b: m.b + x.b / cs2.length, a: m.a + x.a / cs2.length }), { r: 0, g: 0, b: 0, a: 0 });
        }
        if (c.a > 0) layers.push(c);
        if (c.a >= 0.99) break;
      }
      let base = rgba(getComputedStyle(document.body).backgroundColor);
      if (base.a < 0.99) base = dark ? { r: 0, g: 0, b: 0, a: 1 } : { r: 255, g: 255, b: 255, a: 1 };
      return layers.reverse().reduce((u, c) => over(c, u), base);
    };
    const els = roots.flatMap((r) => [...r.querySelectorAll('*')]).filter((el) =>
      [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim()) && shown(el)
      && !el.closest(':disabled, [aria-disabled="true"], option, select, svg') && !/^(SCRIPT|STYLE|TITLE|OPTION)$/.test(el.tagName));
    for (const el of els) {
      const cs = getComputedStyle(el);
      const r = el.getBoundingClientRect();
      if (r.width < 2 || r.height < 2) continue;
      const bg = bgOf(el);
      if (!bg) continue;
      let op = 1;
      for (let n = el; n; n = n.parentElement) op *= Number(getComputedStyle(n).opacity);
      if (op < 0.1) continue;   // ausgeblendet (etwa der Titel der Leiste vor dem Scrollen)
      const fg = rgba(cs.color); fg.a *= op;
      const F = over(fg, bg);
      const [hi, lo] = [lum(F), lum(bg)].sort((x, y) => y - x);
      const ratio = (hi + 0.05) / (lo + 0.05);
      const px = parseFloat(cs.fontSize), w = Number(cs.fontWeight) || 400;
      const need = px >= 24 || (px >= 18.66 && w >= 700) ? 3 : 4.5;
      if (ratio < need - 0.005) out.contrast.push(`${who(el)} „${el.textContent.trim().slice(0, 24)}“ ${ratio.toFixed(2)}<${need}`);
    }
    return out;
  }, { scope, view, contrastOnly });
}

/** Ergebnisse als Prüfpunkte melden. */
function report(t, label, r, { contrastOnly = false } = {}) {
  const uniq = (a) => [...new Set(a)];
  if (!contrastOnly) {
    t.ok(`${label}: zugängliche Namen`, !r.name.length, uniq(r.name).join(' | '));
    t.ok(`${label}: Tippflächen ≥ 44 × 44`, !r.target.length, uniq(r.target).join(' | '));
    t.ok(`${label}: Überschriften`, !r.heads.length, uniq(r.heads).join(' | '));
    t.ok(`${label}: Bilder/Symbole`, !r.imgs.length, uniq(r.imgs).join(' | '));
  }
  t.ok(`${label}: Kontrast`, !r.contrast.length, uniq(r.contrast).join(' | '));
}

/** Blatt per Tastatur öffnen (Auslöser fokussieren, Enter) und Dialog-Regeln prüfen; danach offen lassen. */
async function sheetDialog(t, page, label, trigger) {
  await page.keyboard.press('Shift');
  await page.evaluate((s) => document.querySelector(s).focus(), trigger);
  await page.keyboard.press('Enter');
  await A.sleep(550);
  const d = await page.evaluate(() => {
    const s = document.querySelector('#sheet .sheet');
    const name = s.getAttribute('aria-label') || document.getElementById(s.getAttribute('aria-labelledby') || '')?.textContent || '';
    return { open: !document.getElementById('sheet').hidden, role: s.getAttribute('role'), modal: s.getAttribute('aria-modal'), name, inside: s.contains(document.activeElement), inert: document.getElementById('app').inert };
  });
  t.ok(`${label}: Dialog (role, aria-modal, Name, Fokus drin, Hintergrund inert)`, d.open && d.role === 'dialog' && d.modal === 'true' && d.name && d.inside && d.inert, JSON.stringify(d));
}
async function sheetEscape(t, page, label, trigger) {
  await page.keyboard.press('Escape');
  await A.sleep(550);
  const d = await page.evaluate((s) => ({ closed: document.getElementById('sheet').hidden, back: document.activeElement === document.querySelector(s), inert: document.getElementById('app').inert }), trigger);
  t.ok(`${label}: Escape schließt, Fokus zurück am Auslöser`, d.closed && d.back && !d.inert, JSON.stringify(d));
}

module.exports = async (t) => {
  for (const dark of [false, true]) {
    const mode = dark ? 'dunkel' : 'hell';
    const co = dark;   // Namen, Flächen, Überschriften und Bilder hängen nicht vom Farbschema ab
    const { page, errs } = await A.open(t, { dark });

    /* ---------- Einführung (erster Start) ---------- */
    await A.start(t, page);
    await A.sleep(400);
    const onb = await page.evaluate(() => {
      const o = document.getElementById('onboarding');
      return { open: !o.hidden, role: o.getAttribute('role'), modal: o.getAttribute('aria-modal'), name: o.getAttribute('aria-label'), inside: o.contains(document.activeElement), inert: document.getElementById('app').inert };
    });
    if (!dark) t.ok('Einführung: Dialog (role, aria-modal, Name, Fokus drin, Hintergrund inert)', onb.open && onb.role === 'dialog' && onb.modal === 'true' && onb.name && onb.inside && onb.inert, JSON.stringify(onb));
    report(t, `Einführung ${mode}`, await audit(page, { scope: ['#onboarding'], contrastOnly: co }), { contrastOnly: co });
    await page.keyboard.press('Escape');
    await A.sleep(500);
    if (!dark) t.ok('Einführung: Escape schließt', await page.evaluate(() => document.getElementById('onboarding').hidden));

    await A.start(t, page, { seed: 'full', photoW: 200 });
    await A.sleep(400);
    const V = (v) => [`#view-${v}`, '#nav'];

    /* ---------- Start + Wichtig-Blatt ---------- */
    report(t, `Start ${mode}`, await audit(page, { scope: V('home'), contrastOnly: co }), { contrastOnly: co });
    if (!dark) {
      const nav = await page.evaluate(() => {
        const cur = [...document.querySelectorAll('#nav [aria-current="page"]')].map((b) => b.dataset.nav);
        return { cur };
      });
      t.ok('Tab-Leiste: genau ein aria-current="page" (Start)', nav.cur.length === 1 && nav.cur[0] === 'home', JSON.stringify(nav));
      await page.keyboard.press('Shift');
      await page.evaluate(() => document.querySelector('#nav [data-nav="list"]').focus());
      const ring = await page.evaluate(() => { const cs = getComputedStyle(document.activeElement); return { s: cs.outlineStyle, w: parseFloat(cs.outlineWidth), fv: document.activeElement.matches(':focus-visible') }; });
      t.ok('Tab-Leiste: sichtbarer Fokusrahmen bei Tastatur', ring.fv && ring.s !== 'none' && ring.w >= 2, JSON.stringify(ring));
      await page.evaluate(() => document.activeElement.blur());
    }
    await sheetDialog(t, page, `Wichtig-Blatt ${mode}`, '#home-todo [data-todo-all]');
    report(t, `Wichtig-Blatt ${mode}`, await audit(page, { scope: ['#sheet'], view: false, contrastOnly: co }), { contrastOnly: co });
    await sheetEscape(t, page, `Wichtig-Blatt ${mode}`, '#home-todo [data-todo-all]');

    /* ---------- Alles + Filter-Blatt ---------- */
    await A.tab(page, 'list');
    report(t, `Alles ${mode}`, await audit(page, { scope: V('list'), contrastOnly: co }), { contrastOnly: co });
    if (!dark) t.ok('Tab-Leiste: aria-current wandert mit (Alles)', await page.evaluate(() => document.querySelector('#nav [aria-current="page"]')?.dataset.nav === 'list'));
    await sheetDialog(t, page, `Filter-Blatt ${mode}`, '#filter-btn');
    report(t, `Filter-Blatt ${mode}`, await audit(page, { scope: ['#sheet'], view: false, contrastOnly: co }), { contrastOnly: co });
    await sheetEscape(t, page, `Filter-Blatt ${mode}`, '#filter-btn');

    /* ---------- Eintrag (+ Foto groß) ---------- */
    await page.evaluate(() => document.querySelector('#list .row .body').click());
    await A.sleep(700);
    report(t, `Eintrag ${mode}`, await audit(page, { scope: V('item'), contrastOnly: co }), { contrastOnly: co });
    if (!dark && await page.evaluate(() => !!document.querySelector('#item-photo img[src], #item-photo[tabindex]'))) {
      await page.keyboard.press('Shift');
      await page.evaluate(() => document.getElementById('item-photo').focus());
      await page.keyboard.press('Enter');
      await A.sleep(300);
      const lb = await page.evaluate(() => { const l = document.getElementById('lightbox'); return { open: !l.hidden, role: l.getAttribute('role'), modal: l.getAttribute('aria-modal'), inside: l.contains(document.activeElement), inert: document.getElementById('app').inert }; });
      t.ok('Foto groß: Dialog, Fokus drin, Hintergrund inert', lb.open && lb.role === 'dialog' && lb.modal === 'true' && lb.inside && lb.inert, JSON.stringify(lb));
      await page.keyboard.press('Escape');
      await A.sleep(300);
      t.ok('Foto groß: Escape schließt, Fokus zurück', await page.evaluate(() => document.getElementById('lightbox').hidden && document.activeElement === document.getElementById('item-photo') && !document.getElementById('app').inert));
    }
    await A.back(page);

    /* ---------- Hinzufügen ---------- */
    await A.tab(page, 'add');
    report(t, `Hinzufügen ${mode}`, await audit(page, { scope: V('add'), contrastOnly: co }), { contrastOnly: co });
    await page.click('#cap-done').catch(() => {});
    await A.sleep(500);

    /* ---------- Orte + Raum ---------- */
    await A.tab(page, 'orte');
    report(t, `Orte ${mode}`, await audit(page, { scope: V('orte'), contrastOnly: co }), { contrastOnly: co });
    await page.evaluate(() => document.querySelector('#orte-list [data-room]').click());
    await A.sleep(650);
    report(t, `Raum ${mode}`, await audit(page, { scope: V('room'), contrastOnly: co }), { contrastOnly: co });

    /* ---------- Dokumente + Dokument-Blatt ---------- */
    await A.tab(page, 'docs');
    await A.sleep(600);
    report(t, `Dokumente ${mode}`, await audit(page, { scope: V('docs'), contrastOnly: co }), { contrastOnly: co });
    await sheetDialog(t, page, `Dokument-Blatt ${mode}`, '#docs-new');
    report(t, `Dokument-Blatt ${mode}`, await audit(page, { scope: ['#sheet'], view: false, contrastOnly: co }), { contrastOnly: co });
    await sheetEscape(t, page, `Dokument-Blatt ${mode}`, '#docs-new');

    /* ---------- Einstellungen + Unterseiten ---------- */
    await A.tab(page, 'settings');
    report(t, `Einstellungen ${mode}`, await audit(page, { scope: V('settings'), contrastOnly: co }), { contrastOnly: co });
    for (const [sp, name] of [['look', 'Darstellung'], ['cats', 'Kategorien'], ['about', 'Über & Hilfe'], ['adv', 'Erweitert']]) {
      await page.evaluate((sp) => document.querySelector(`[data-spage-go="${sp}"]`).click(), sp);
      await A.sleep(300);
      // Hilfe-Abschnitte aufklappen, damit ihr Text mitgeprüft wird.
      await page.evaluate(() => document.querySelectorAll('#view-settings details').forEach((d) => { d.open = true; }));
      report(t, `Einstellungen › ${name} ${mode}`, await audit(page, { scope: V('settings'), contrastOnly: co }), { contrastOnly: co });
      await A.back(page);
    }
    t.ok(`Barrierefreiheit ${mode}: keine Fehler auf der Seite`, errs.length === 0, errs.join(' | '));
  }
};

// Für tests/accent.spec.js (Kontrast in allen Akzentfarben).
module.exports.audit = audit;
module.exports.report = report;
