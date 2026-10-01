// Einzige Quelle der Versionsnummer. Bei jeder Änderung an App-Dateien hochzählen und gleichziehen:
// <meta name="app-version"> in index.html (Start-Wächter) und VERSION in sw.js (nur ein geänderter
// sw.js lässt iOS die neue Fassung holen). tests/consistency.spec.js prüft, dass alle drei passen.
export const APP_VERSION = '2.0.2';
