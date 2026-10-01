# Tests

Automatische Prüfungen mit Playwright – ohne Build und ohne `npm install`.

```sh
node tests/run.js                  # alles (≈ 2 min): smoke, flows, backup, consistency, upgrade
node tests/run.js flows backup     # nur Dateien, deren Name das Wort enthält
node tests/run.js screens          # Bildschirmfotos hell/dunkel nach tests/out/ (nicht eingecheckt)
node tests/run.js screens --rev 896a46b --out /tmp/vorher   # dasselbe für einen alten Commit
eslint -c tests/eslint.config.mjs js sw.js tests            # Lint (global installiertes eslint)
```

`run.js` startet selbst einen kleinen statischen Server (`lib/server.js`) auf dem Arbeitsstand –
oder mit `--rev <commit>` auf einer `git archive`-Kopie – und Chromium; am Ende wird beides
beendet. Exit-Code 1, wenn eine Prüfung fehlschlägt.

**Voraussetzungen:** Node ≥ 18, Playwright global installiert (gefunden über `NODE_PATH`,
`/opt/node22/lib/node_modules` oder `PLAYWRIGHT_PATH`). Chromium aus `PW_CHROMIUM`
(Standard `/opt/pw-browsers/chromium-1194/chrome-linux/chrome`); fehlt die Datei, nimmt
Playwright seinen eigenen Browser. Nichts davon gehört zur App.

| Datei | prüft |
|---|---|
| `smoke.spec.js` | Kaltstart mit Einführung, alle Ansichten ohne Konsolenfehler, Offline-Start über den Service Worker, Startfehler-Seite bei fehlender Datei |
| `flows.spec.js` | Erfassen (Gemini vorgetäuscht), ohne Foto, Eintrag bearbeiten – auch **Speichern beim Zurück/Zurückwischen** –, Ort/Raum, Unterwegs (mit Kontrast des gewählten Chips), Wisch-Archiv + Rückgängig, Mehrfachauswahl, Dokument anlegen/ansehen, KI-Suche ohne Dokumentinhalte, Hinweis ohne API-Key |
| `backup.spec.js` | Sicherung erstellen (offen/verschlüsselt), ersetzen/hinzufügen, falsches Passwort; Sicherungen aus 1.6.2, 1.7.1, 1.8.1, 1.10.3 (Format 1–4, auch verschlüsselt) aus `fixtures/` |
| `upgrade.spec.js` | Datenbank aus 1.6.2, 1.7.1 und 1.10.3 (per `git archive` aus dem Verlauf) → aktuelle Fassung ohne Datenverlust |
| `consistency.spec.js` | eine Versionsnummer (`js/version.js` = `index.html` = `sw.js` = CHANGELOG), `ASSETS` und Start-Wächter vollständig, `modulepreload` = Start-Module, keine toten Exporte, Dateigrößen, Syntax |
| `screens.spec.js` | nur auf Wunsch: Bildschirmfotos aller Hauptansichten mit dem großen Testbestand |

Gemini wird nie wirklich aufgerufen (`lib/app.js` → `mockGemini`), andere Adressen als der
eigene Server werden blockiert. Testdaten: `lib/seed.js` (`seedFull` – 61 Dinge, 18 Dokumente;
`seedMini` – fünf Einträge, läuft auch mit alten Fassungen).

**Neue Version:** `js/version.js`, `<meta name="app-version">` in `index.html`, `VERSION` in
`sw.js` und eine Überschrift in `CHANGELOG.md` gleichziehen – `consistency` schlägt sonst fehl.
Neue Datei in `js/`: in `sw.js` (`ASSETS`), in die Liste des Start-Wächters und – falls beim
Start geladen – als `modulepreload` in `index.html` eintragen.
