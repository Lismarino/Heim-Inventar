// Kleine Helfer ohne App-Zustand (1.8.0): Namen vergleichen („Habe ich das schon?“,
// Duplikat-Hinweis), Unterwegs/Verliehen als Text, Datumsangaben für Garantie & Co.

// Für den Vergleich: klein, ohne Akzente, ß → ss, nur Buchstaben/Ziffern und einzelne Leerzeichen.
function normName(s) {
  return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/ß/g, 'ss').replace(/[^a-z0-9]+/g, ' ').trim();
}
const words = (n) => n.split(' ').filter(w => w.length >= 3);

/**
 * Wie ähnlich sind zwei Namen? 3: gleich · 2: einer steckt ganz im anderen
 * („Akkuschrauber“ in „Akkuschrauber Bosch PSR 18“) · 1: Teilwort passt
 * („Schrauber“ in „Akkuschrauber“, mind. 5 Zeichen) · 0: nichts.
 */
function similarity(a, b) {
  const x = normName(a), y = normName(b);
  if (!x || !y) return 0;
  if (x === y) return 3;
  const [s, l] = x.length <= y.length ? [x, y] : [y, x];
  if (s.length >= 4 && (' ' + l + ' ').includes(' ' + s + ' ')) return 2;
  if (s.length >= 6 && l.includes(s)) return 2;
  for (const w of words(x)) {
    for (const v of words(y)) {
      if (w === v && w.length >= 4) return 1;
      const [ws, wl] = w.length <= v.length ? [w, v] : [v, w];
      if (ws.length >= 5 && wl.includes(ws)) return 1;
    }
  }
  return 0;
}

/** Einträge (nicht archiviert, mit Namen) zu einem oder mehreren Suchnamen, beste zuerst. */
export function findSimilar(items, names, min = 1) {
  const out = [];
  for (const it of items) {
    if (it.archived || !String(it.name || '').trim()) continue;
    const score = Math.max(0, ...names.map(n => similarity(n, it.name)));
    if (score >= min) out.push({ item: it, score });
  }
  return out.sort((a, b) => b.score - a.score || String(a.item.name).localeCompare(String(b.item.name), 'de'));
}

/* ---------------- Unterwegs / verliehen ---------------- */

const OUT_TYPES = ['unterwegs', 'verliehen'];
const DAY = 86400000;
const dayStart = (t) => { const d = new Date(t); d.setHours(0, 0, 0, 0); return d.getTime(); };
/** Ganze Kalendertage von `t` bis heute. */
export const daysSince = (t, now = Date.now()) => Math.max(0, Math.round((dayStart(now) - dayStart(t)) / DAY));
const sinceText = (t) => {
  const d = daysSince(t);
  return d === 0 ? 'seit heute' : d === 1 ? 'seit gestern' : `seit ${d} Tagen`;
};

/** Gültiger Status oder null (auch für eingelesene Sicherungen). */
export function cleanOut(o) {
  if (!o || typeof o !== 'object' || !OUT_TYPES.includes(o.type)) return null;
  const since = Number(o.since);
  return {
    type: o.type,
    to: typeof o.to === 'string' ? o.to.trim().slice(0, 80) : '',
    since: Number.isFinite(since) && Math.abs(since) <= 8.64e15 ? since : Date.now(),
  };
}

/** „Bei Tom seit 4 Tagen“ · „Unterwegs (Urlaub) seit gestern“ – leer, wenn daheim. */
export function outText(it) {
  const o = cleanOut(it?.out);
  if (!o) return '';
  if (o.type === 'verliehen') return `${o.to ? `Bei ${o.to}` : 'Verliehen'} ${sinceText(o.since)}`;
  return `Unterwegs${o.to ? ` (${o.to})` : ''} ${sinceText(o.since)}`;
}

/* ---------------- Datum (JJJJ-MM-TT aus <input type="date">) ---------------- */

/** Heutiges (oder t-) Datum als JJJJ-MM-TT in Ortszeit – toISOString() wäre UTC (nachts ein Tag daneben). */
export function localDay(t = Date.now()) {
  const d = new Date(t);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
export const cleanDate = (v) => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v)) ? v : '');
const dateFmt = new Intl.DateTimeFormat('de-DE', { dateStyle: 'medium' });
export const fmtDate = (v) => (cleanDate(v) ? dateFmt.format(new Date(v + 'T12:00:00')) : '');

/** Tage bis zum Datum (negativ: vorbei), null ohne Datum. */
export function daysUntil(v, now = Date.now()) {
  if (!cleanDate(v)) return null;
  return Math.round((new Date(v + 'T00:00:00').getTime() - dayStart(now)) / DAY);
}
/** Garantie läuft in den nächsten 30 Tagen ab (heute eingeschlossen). */
export const warrantySoon = (it) => { const d = daysUntil(it?.warrantyUntil); return d != null && d >= 0 && d <= 30; };

/** Bestand als ganze Zahl – nur dann gibt es + / − in der Zeile. */
export const qtyNumber = (q) => (/^\s*\d{1,6}\s*$/.test(String(q ?? '')) ? Number(q) : null);
