// KI-Warteschlange: erkennt frisch erfasste Fotos im Hintergrund.
// Arbeitet alle Einträge mit aiState 'pending' ab – auch solche, die vor einem
// Neustart der App liegen geblieben sind. Die Erfassung wartet nie auf die KI.
import * as db from './db.js';
import * as img from './img.js';
import * as ai from './gemini.js';

const MAX_PARALLEL = 2;
const AI_EDGE = 768;          // an Gemini geht eine kleine Fassung – das spart Zeit
const AI_QUALITY = 0.7;
const MAX_TRIES = 3;          // vorübergehende Fehler je Eintrag, danach 'failed'
const SLOW_GAP = 4000;        // nach einem 429: Abstand zwischen zwei Anfragen
const SLOW_RECOVER = 5;       // so viele Erfolge in Folge ohne 429 – dann wieder normal schnell

let getSettings = () => ({});
let notify = () => {};
const running = new Set();
const tries = new Map();      // id -> Zahl vorübergehender Fehlschläge in dieser Sitzung
let blocked = '';             // Key abgelehnt, Modell weg … – erst nach Änderung in den Einstellungen weiter
let pausedUntil = 0;
let slow = false;             // nach einem 429 nur noch eine Anfrage gleichzeitig
let quotaHits = 0;
let okStreak = 0;             // Erfolge in Folge seit dem letzten 429
let lastStart = 0;
let timer = null, timerAt = 0;
let pumping = false, again = false;

/** settings: () => aktuelle Einstellungen; onChange: nach jeder Änderung an Einträgen. */
export function initQueue({ settings, onChange }) {
  getSettings = settings;
  notify = onChange;
  window.addEventListener('online', () => kick());
}

/** Anstoßen. reset: nach Änderung von Key/Modell – Sperren und Zähler vergessen. */
export function kick({ reset = false } = {}) {
  if (reset) {
    blocked = '';
    pausedUntil = 0;
    quotaHits = 0;
    slow = false;
    okStreak = 0;
    tries.clear();
  }
  pump();
}

/** Zustand für die Anzeige: warum gerade (nicht) erkannt wird. */
export function status() {
  const s = getSettings();
  let note = '';
  if (!(s.apiKey || '').trim()) note = 'Ohne API-Key keine Erkennung.';
  else if (blocked) note = 'Erkennung angehalten: ' + blocked;
  else if (!navigator.onLine) note = 'Offline – Erkennung geht weiter, sobald du wieder online bist.';
  else if (pausedUntil > Date.now()) note = 'Kurze Pause, Gemini ist gerade ausgelastet …';
  return { active: running.size, note, slow };
}

// Frühestens nach `ms` wieder anstoßen (ein einziger Timer, der früheste gewinnt).
function later(ms) {
  const at = Date.now() + ms;
  if (timer && timerAt <= at) return;
  clearTimeout(timer);
  timerAt = at;
  timer = setTimeout(() => { timer = null; pump(); }, ms + 20);
}

async function pump() {
  if (pumping) { again = true; return; }
  pumping = true;
  try {
    do {
      again = false;
      if (!(getSettings().apiKey || '').trim() || blocked || !navigator.onLine) return;
      const wait = pausedUntil - Date.now();
      if (wait > 0) { later(wait); return; }
      const limit = slow ? 1 : MAX_PARALLEL;
      if (running.size >= limit) return;

      const todo = (await db.getAll('items'))
        .filter(i => i.aiState === 'pending' && !i.archived && !running.has(i.id))
        .sort((a, b) => a.createdAt - b.createdAt);
      while (running.size < limit && todo.length) {
        if (slow) {
          const gap = lastStart + SLOW_GAP - Date.now();
          if (gap > 0) { later(gap); break; }
        }
        const it = todo.shift();
        running.add(it.id);
        lastStart = Date.now();
        work(it.id);
      }
    } while (again);
  } catch (e) {
    console.warn('KI-Warteschlange:', e);
  } finally {
    pumping = false;
  }
}

// Foto aus der Datenbank holen und klein für Gemini kodieren.
async function photoForAI(photoId) {
  const photo = photoId ? await db.get('photos', photoId) : null;
  if (!photo) {
    const e = new Error('Zu diesem Eintrag ist kein Foto gespeichert.');
    e.code = 'nophoto';
    throw e;
  }
  const src = await img.decode(new Blob([photo.buf], { type: photo.type || 'image/jpeg' }));
  try {
    return await img.blobToBase64(await img.toBlob(src, AI_EDGE, AI_QUALITY));
  } finally {
    img.release(src);
  }
}

async function work(id) {
  let changed = false;
  try {
    const it = await db.get('items', id);
    if (!it || it.aiState !== 'pending' || it.archived) return;
    const b64 = await photoForAI(it.photoId);
    const cats = (await db.getAll('categories')).map(c => c.name);
    const found = await ai.analyzePhoto(getSettings(), b64, '', cats);

    // Kategorien legt applyRecognition selbst an – in derselben Transaktion und nur,
    // wenn der Eintrag dann noch existiert und auf die Erkennung wartet.
    await db.applyRecognition(id, found.map(f => ({ name: f.name, category: f.category, confidence: f.confidence })));
    tries.delete(id);
    quotaHits = 0;
    if (slow && ++okStreak >= SLOW_RECOVER) { slow = false; okStreak = 0; }
    changed = true;
  } catch (e) {
    changed = await onError(id, e);
  } finally {
    running.delete(id);
    if (changed) notify();
    pump();
  }
}

// Liefert true, wenn sich etwas Sichtbares geändert hat.
async function onError(id, e) {
  const code = e?.code || '';
  // Kein Key oder offline: pending lassen, es geht beim nächsten Anstoßen weiter
  // (online-Event, App-Start, Key-Eingabe).
  if (code === 'nokey' || code === 'offline') return true;
  if (code === 'auth' || code === 'model') {
    blocked = e.message;
    return true;
  }
  if (code === 'quota') {
    quotaHits++;
    slow = true;
    okStreak = 0;
    const ms = Math.min(300000, 15000 * 2 ** (quotaHits - 1));
    pausedUntil = Date.now() + ms;
    later(ms);
    return true;
  }
  if (code === 'network' || code === 'timeout' || code === 'server') {
    const n = (tries.get(id) || 0) + 1;
    tries.set(id, n);
    if (n < MAX_TRIES) {
      const ms = 15000 * n;
      pausedUntil = Math.max(pausedUntil, Date.now() + ms);
      later(ms);
      return true;
    }
  }
  try {
    await db.patchItem(id, { aiState: 'failed', aiError: e?.message || String(e) }, it => it.aiState === 'pending');
  } catch (err) {
    console.warn('KI-Warteschlange: Fehler nicht speicherbar', err);
  }
  tries.delete(id);
  return true;
}
