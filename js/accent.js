// Akzentfarbe (2.1): acht kuratierte Farben, Tannengrün ist Standard. Die Farbwerte (je hell
// und dunkel) stehen nur in css/tokens.css unter [data-accent="…"] – hier nur Namen.
// Gespeichert in den Einstellungen (IndexedDB) und gespiegelt im
// localStorage: Das Inline-Skript in index.html setzt die Farbe damit schon vor dem ersten
// Zeichnen, also ohne Aufblitzen. Terrakotta bleibt Warnfarbe, unabhängig vom Akzent.
export const ACCENTS = [
  { id: 'tanne', name: 'Tannengrün' },
  { id: 'blau', name: 'Blau' },
  { id: 'indigo', name: 'Indigo' },
  { id: 'lila', name: 'Lila' },
  { id: 'himbeer', name: 'Himbeere' },
  { id: 'orange', name: 'Orange' },
  { id: 'senf', name: 'Senfgelb' },
  { id: 'graphit', name: 'Graphit' },
];
const DEFAULT_ACCENT = 'tanne';
const KEY = 'inventar-akzent';   // derselbe Schlüssel wie im Inline-Skript in index.html

/** Gültige Kennung oder der Standard. */
export const accentId = (id) => (ACCENTS.some((a) => a.id === id) ? id : DEFAULT_ACCENT);

/** Farbe sofort anwenden und im localStorage spiegeln. */
export function applyAccent(id) {
  const a = accentId(id);
  const root = document.documentElement;
  if (a === DEFAULT_ACCENT) root.removeAttribute('data-accent');
  else root.setAttribute('data-accent', a);
  try { localStorage.setItem(KEY, a); } catch (_) { void _; }
  return a;
}
