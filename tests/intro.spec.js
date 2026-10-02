// Start-Szene „Regal“ (2.1.1): Bücher und Glas fallen ins flache Regal, daraus wird das
// Keepsy-Symbol. Geprüft: Szene läuft und öffnet die App, Landetöne in richtiger Zahl (bei
// erlaubtem Audio), still ohne Fehler bei gesperrtem Audio / vor der ersten Geste / „Töne“ aus,
// „Bewegung reduzieren“ nur Überblenden, Akzentfarbe färbt Bücher und Box, Regal bleibt neutral.
'use strict';
const A = require('./lib/app.js');

// Zählt Rauschquellen (jede Landung hat genau eine: 5 Bücher, Glas, Deckel = 7) und angelegte
// AudioContexte. gesture: synthetische Berührungen auf document ab dem Laden (weckt den Ton,
// trifft aber nicht #splash, öffnet also nicht vorzeitig). noAudio: Web Audio gibt es nicht.
function probe() {
  return ({ gesture, noAudio }) => {
    window.__src = 0; window.__ac = 0;
    if (noAudio) { delete window.AudioContext; delete window.webkitAudioContext; window.AudioContext = undefined; window.webkitAudioContext = undefined; }
    else if (window.AudioContext) {
      const AC = window.AudioContext;
      const src = AC.prototype.createBufferSource;
      AC.prototype.createBufferSource = function (...a) { window.__src++; return src.apply(this, a); };
      window.AudioContext = class extends AC { constructor(...a) { super(...a); window.__ac++; } };
    }
    if (gesture) {
      const t0 = Date.now();
      const tick = () => {
        document.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
        if (Date.now() - t0 < 600) setTimeout(tick, 10);
      };
      document.addEventListener('DOMContentLoaded', tick);
    }
  };
}

async function run(t, opts = {}, { reduced = false, dark = false, accent = null, mute = false } = {}) {
  const o = await A.open(t, { reduced, dark });
  const { page } = o;
  const first = accent || mute;   // erst einrichten (Einstellungen in der Datenbank), dann neu laden
  if (first) {
    await page.goto(t.url);
    await A.ready(page);
    await A.sleep(400);
    if (accent) await page.evaluate((id) => document.querySelector(`#acc-row [data-accent="${id}"]`).click(), accent);
    if (mute) await page.evaluate(() => { const c = document.getElementById('set-sound'); if (c.checked) c.click(); });
    await A.sleep(300);
  }
  await page.addInitScript(probe(), { gesture: false, noAudio: false, ...opts });
  if (first) await page.reload(); else await page.goto(t.url);
  await page.waitForFunction(() => document.getElementById('splash')?.dataset.intro);
  return o;
}

module.exports = async (t) => {
  /* ---------- Szene läuft, Töne bei erlaubtem Audio ---------- */
  {
    const { page, errs } = await run(t, { gesture: true });
    const st = await page.evaluate(() => {
      const s = document.getElementById('splash');
      return { mode: s.dataset.intro, items: s.querySelectorAll('.i-item').length, anims: s.getAnimations({ subtree: true }).length };
    });
    t.ok('Szene: Kaltstart spielt die volle Szene (5 Bücher + Glas, animiert)', st.mode === 'full' && st.items === 6 && st.anims >= 10, JSON.stringify(st));
    const t0 = Date.now();
    await A.ready(page);
    const ms = Date.now() - t0;
    t.ok('Szene: öffnet die App (ohne Hängen)', await page.evaluate(() => document.getElementById('splash').hidden) && ms < 4000, ms + ' ms');
    await A.sleep(300);
    const snd = await page.evaluate(() => ({ src: window.__src, ac: window.__ac }));
    t.ok('Töne: 7 Landetöne (5× Tock, Tink, Deckel)', snd.ac === 1 && snd.src === 7, JSON.stringify(snd));
    t.ok('Szene mit Ton: keine Konsolenfehler', errs.length === 0, errs.join(' | '));
  }

  /* ---------- Vor der ersten Geste: kein AudioContext, still ---------- */
  {
    const { page, errs } = await run(t, {});
    await A.ready(page);
    await A.sleep(300);
    const snd = await page.evaluate(() => ({ src: window.__src, ac: window.__ac, mode: document.getElementById('splash').dataset.intro }));
    t.ok('Ohne Geste: Szene läuft, kein AudioContext, kein Ton', snd.mode === 'full' && snd.ac === 0 && snd.src === 0, JSON.stringify(snd));
    t.ok('Ohne Geste: keine Konsolenfehler', errs.length === 0, errs.join(' | '));
  }

  /* ---------- Audio gesperrt / Töne aus ---------- */
  {
    const { page, errs } = await run(t, { gesture: true, noAudio: true });
    await A.ready(page);
    t.ok('Ohne Web Audio: Szene läuft durch, keine Fehler', errs.length === 0 && await page.evaluate(() => document.getElementById('splash').hidden), errs.join(' | '));
  }
  {
    const { page, errs } = await run(t, { gesture: true }, { mute: true });
    await A.ready(page);
    await A.sleep(300);
    const snd = await page.evaluate(() => ({ src: window.__src, ac: window.__ac }));
    t.ok('„Töne“ aus: kein Landeton', snd.src === 0 && errs.length === 0, JSON.stringify(snd) + errs.join(' | '));
  }

  /* ---------- Bewegung reduzieren ---------- */
  {
    const { page, errs } = await run(t, { gesture: true }, { reduced: true });
    const st = await page.evaluate(() => ({ mode: document.getElementById('splash').dataset.intro, drops: document.querySelector('.i-b1').getAnimations().length }));
    await A.ready(page);
    await A.sleep(300);
    const src = await page.evaluate(() => window.__src);
    t.ok('Bewegung reduzieren: nur Überblenden, keine fallenden Bücher, kein Ton', st.mode === 'fade' && st.drops === 0 && src === 0 && errs.length === 0, JSON.stringify({ ...st, src }) + errs.join(' | '));
  }

  /* ---------- Akzentfarbe wirkt in der Szene, Regal bleibt neutral ---------- */
  {
    const col = async (accent, dark) => {
      const { page } = await run(t, {}, { accent, dark });
      return page.evaluate(() => {
        const c = (s) => getComputedStyle(document.querySelector(s)).backgroundColor;
        const acc = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim();
        return { acc, attr: document.documentElement.getAttribute('data-accent'), b1: c('.i-b1'), b2: c('.i-b2'), box: c('.i-box'), lid: c('.i-lid'), shelf: c('.i-shelf') };
      });
    };
    const hex = (h) => { const n = parseInt(h.slice(1), 16); return `rgb(${n >> 16}, ${(n >> 8) & 255}, ${n & 255})`; };
    for (const dark of [false, true]) {
      const g = await col(null, dark);
      const h = await col('himbeer', dark);
      const tag = dark ? 'dunkel' : 'hell';
      t.ok(`Akzent (${tag}): Buch und Box in der Akzentfarbe`, h.attr === 'himbeer' && h.b1 === hex(h.acc) && h.box === hex(h.acc) && h.lid === hex(h.acc) && g.b1 === hex(g.acc), JSON.stringify({ g, h }));
      t.ok(`Akzent (${tag}): abgestimmte Töne folgen dem Akzent`, g.b2 !== h.b2 && g.b1 !== h.b1, JSON.stringify([g.b2, h.b2]));
      t.ok(`Akzent (${tag}): Regalbrett neutral (wie im Startbild)`, g.shelf === h.shelf, JSON.stringify([g.shelf, h.shelf]));
    }
  }
};
