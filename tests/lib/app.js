// Helfer für die Tests: Seite öffnen (iPhone-Maße, Touch), Gemini vortäuschen, auf den Start
// warten, Tabs, Blätter, Touch-Gesten per CDP, Datenbank-Abfragen.
'use strict';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const MOBILE = {
  viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true,
  locale: 'de-DE', timezoneId: 'Europe/Berlin', acceptDownloads: true,
};

/**
 * Gemini vortäuschen. Foto (inline_data) → nächster Name aus ai.names, sonst „Objekt n“;
 * Text → ai.reply (Suche) bzw. Kategorie. Alle Anfragen landen in ai.requests.
 */
async function mockGemini(ctx) {
  const ai = { names: [], requests: [], reply: { answer: 'Liegt im Keller.', matches: [{ n: 1, why: 'passt' }] } };
  await ctx.route('https://generativelanguage.googleapis.com/**', async (route) => {
    const req = route.request();
    const body = req.postData() || '';
    ai.requests.push({ url: req.url(), body });
    if (req.method() === 'GET') {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ models: [{ name: 'models/gemini-3.6-flash', supportedGenerationMethods: ['generateContent'] }] }) });
      return;
    }
    const isPhoto = body.includes('inline_data') || body.includes('inlineData');
    const text = isPhoto
      ? JSON.stringify({ items: [{ name: ai.names.shift() || `Objekt ${ai.requests.length}`, category: 'Werkzeug', confidence: 0.9 }] })
      : JSON.stringify(ai.reply);
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ candidates: [{ content: { parts: [{ text }] } }] }) });
  });
  return ai;
}

/**
 * Neuer Kontext + Seite. opts: dark, reduced (Bewegung reduzieren, Standard an), sw (Service
 * Worker erlauben), extra Kontext-Optionen. Liefert { ctx, page, errs, ai }.
 * Fehler (pageerror, console.error) sammelt errs – „Failed to load resource“ nur, wenn gewollt.
 */
async function open(t, { dark = false, reduced = true, sw = false, ...extra } = {}) {
  const ctx = await t.browser.newContext({
    ...MOBILE, colorScheme: dark ? 'dark' : 'light', reducedMotion: reduced ? 'reduce' : 'no-preference',
    serviceWorkers: sw ? 'allow' : 'block', ...extra,
  });
  t.track(ctx);
  const errs = [];
  ctx.on('page', (p) => {
    p.on('pageerror', (e) => errs.push('pageerror: ' + e.message));
    p.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errs.push('console: ' + m.text()); });
    p.on('dialog', (d) => { (ctx.__dialogs ||= []).push(d.message()); d.accept(); });
  });
  // Nichts außer dem eigenen Server erreichen (Google-Skripte, Schriften …).
  await ctx.route(/^https?:\/\/(?!127\.0\.0\.1|localhost)/, (route) => route.abort());
  const ai = await mockGemini(ctx);
  const page = await ctx.newPage();
  return { ctx, page, errs, ai };
}

/** Bis die App steht und die Start-Szene weg ist. */
async function ready(page, timeout = 20000) {
  await page.waitForFunction(() => window.__inventarReady === true, null, { timeout });
  await page.waitForFunction(() => { const s = document.getElementById('splash'); return !s || s.hidden; }, null, { timeout }).catch(() => {});
}

/** Öffnet die App (leer, mit Einführung); seed: 'none' (leer, eingerichtet) | 'mini' | 'full' – dann neu laden. */
async function start(t, page, { seed = null, key = '', photoW = 320 } = {}) {
  await page.goto(t.url);
  await ready(page);
  if (seed) {
    const S = require('./seed.js');
    if (seed === 'full') await S.seedFull(page, { photoW });
    else if (seed === 'mini') await S.seedMini(page, { key });
    else await dbq(page, (db) => db.setSetting('onboarded', true));
    if (key && seed === 'full') await dbq(page, (db, k) => db.setSetting('apiKey', k), key);
    await page.reload();
    await ready(page);
  }
  await sleep(300);
}

/** Funktion (db, arg) im Browser mit js/db.js ausführen. */
const dbq = (page, fn, arg) => page.evaluate(async ({ src, arg }) => {
  const db = await import('./js/db.js');
  return new Function('db', 'arg', `return (${src})(db, arg);`)(db, arg);
}, { src: fn.toString(), arg });
const items = (page) => dbq(page, (db) => db.getAll('items'));
const byName = async (page, name) => (await items(page)).find((i) => i.name === name);

const view = (page) => page.evaluate(() => document.body.dataset.view);
/** Welcher Platz der Leiste ist markiert? (data-nav des aktiven Knopfs) */
const activeTab = (page) => page.evaluate(() => document.querySelector('#nav button.active')?.dataset.nav || '');
/** Tab antippen. 'settings' (seit 2.0 kein Tab): über Start und den ⚙-Knopf oben rechts. */
async function tab(page, v) {
  if (v === 'settings') {
    await tab(page, 'home');
    await page.evaluate(() => document.getElementById('home-settings').click());
    await sleep(550);
    return;
  }
  await page.evaluate((v) => document.querySelector(`#nav [data-nav="${v}"]`).click(), v);
  await sleep(450);
}
/** „Zurück“ in der sichtbaren Ansicht antippen. */
async function back(page) {
  await page.evaluate(() => {
    const v = document.getElementById('view-' + document.body.dataset.view);
    v.querySelector('[data-nav="back"]').click();
  });
  await sleep(550);
}
async function openRow(page, name, root = '#list') {
  const id = (await byName(page, name)).id;
  await page.evaluate(([root, id]) => document.querySelector(`${root} .row[data-id="${id}"] .body`).click(), [root, id]);
  await sleep(650);
  return id;
}
async function search(page, q) { await page.fill('#q', q); await sleep(250); }

/* ---------------- Blätter ---------------- */
async function sheetAction(page, text) {
  await page.locator('#sheet .sheet-act', { hasText: text }).first().click();
  await sleep(450);
}
async function sheetSubmit(page) {
  await page.click('#sheet-body [type="submit"]');
  await sleep(700);
}
async function closeSheet(page) {
  await page.evaluate(() => document.querySelector('#sheet [data-sheet-close]')?.click());
  await sleep(450);
}
/** Kontextmenü einer Zeile (wie langes Drücken). */
async function ctxmenu(page, sel) {
  await page.locator(sel).first().dispatchEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 200, clientY: 300 });
  await sleep(500);
}

/* ---------------- Touch per CDP ---------------- */
async function cdp(page) {
  if (!page.__cdp) page.__cdp = await page.context().newCDPSession(page);
  return page.__cdp;
}
async function touch(page, type, x, y) {
  const s = await cdp(page);
  await s.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y, radiusX: 4, radiusY: 4, force: 1, id: 1 }] });
}
async function swipe(page, x0, y0, x1, y1, { steps = 12, ms = 240 } = {}) {
  await touch(page, 'touchStart', x0, y0);
  for (let i = 1; i <= steps; i++) {
    await touch(page, 'touchMove', x0 + (x1 - x0) * i / steps, y0 + (y1 - y0) * i / steps);
    await sleep(ms / steps);
  }
  await touch(page, 'touchEnd', x1, y1);
}
/** Zurückwischen vom linken Rand. */
async function swipeBack(page) {
  await swipe(page, 4, 420, 330, 425, { steps: 14, ms: 280 });
  await sleep(700);
}
/** Zeile nach links wischen, bis sie archiviert ist. */
async function swipeRowAway(page, sel) {
  const row = page.locator(sel).first();
  await row.scrollIntoViewIfNeeded();
  const b = await row.boundingBox();
  const y = b.y + b.height / 2;
  await swipe(page, b.x + b.width - 20, y, b.x + 10, y + 2, { steps: 14, ms: 220 });
  await sleep(600);
}

/** Kleines JPEG als Puffer (für setInputFiles). */
async function jpeg(page, hue = 30, w = 400) {
  const b64 = await page.evaluate(async ([hue, w]) => {
    const c = document.createElement('canvas'); c.width = w; c.height = Math.round(w * 0.75);
    const x = c.getContext('2d'); x.fillStyle = `hsl(${hue} 50% 60%)`; x.fillRect(0, 0, c.width, c.height);
    x.fillStyle = '#333'; x.fillRect(w * 0.3, w * 0.2, w * 0.4, w * 0.35);
    return c.toDataURL('image/jpeg', 0.8).split(',')[1];
  }, [hue, w]);
  return Buffer.from(b64, 'base64');
}

/** Kontrast nach WCAG zwischen zwei CSS-Farben (rgb/rgba; Alpha über `under` verrechnet). */
function contrast(fg, bg, under = 'rgb(255,255,255)') {
  const parse = (s) => { const m = String(s).match(/[\d.]+/g).map(Number); return { r: m[0], g: m[1], b: m[2], a: m[3] ?? 1 }; };
  const mix = (c, u) => ({ r: c.r * c.a + u.r * (1 - c.a), g: c.g * c.a + u.g * (1 - c.a), b: c.b * c.a + u.b * (1 - c.a), a: 1 });
  const base = parse(under);
  const B = mix(parse(bg), base);
  const F = mix(parse(fg), B);
  const L = (c) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b); };
  const [a, b] = [L(F), L(B)].sort((x, y) => y - x);
  return (a + 0.05) / (b + 0.05);
}

module.exports = {
  sleep, MOBILE, open, ready, start, dbq, items, byName, view, activeTab, tab, back, openRow, search,
  sheetAction, sheetSubmit, closeSheet, ctxmenu, touch, swipe, swipeBack, swipeRowAway, jpeg, contrast,
};
