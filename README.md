# Heim-Inventar

Privates Haushalts-Inventar als installierbare PWA. Alle Einträge und Fotos liegen
ausschließlich lokal auf dem Gerät (IndexedDB) – kein Server, kein Konto, kein Login.
Nach außen geht nur das jeweilige Foto, das du selbst zur Erkennung an Google Gemini schickst.

Kein Build-Schritt, keine Abhängigkeiten: reines HTML/CSS/JS mit ES-Modulen.
Datei ändern → hochladen → fertig.

---

## 1. Auf dem iPhone installieren

Damit „Zum Home-Bildschirm hinzufügen“ eine echte App ergibt (eigenes Icon, Vollbild,
Offline-Betrieb), muss die Seite über **HTTPS** ausgeliefert werden. Ein Doppelklick auf
`index.html` reicht nicht – über `file://` sind ES-Module und Service Worker gesperrt.

### GitHub Pages einrichten (einmalig, ca. 5 Minuten)

1. Auf **github.com** anmelden (kostenloser Account genügt).
2. Oben rechts **+ → New repository**.
   - Name z. B. `heim-inventar`
   - Sichtbarkeit **Public** (Pages ist bei privaten Repos kostenpflichtig)
   - **Create repository**
3. Auf der leeren Repo-Seite: **uploading an existing file** anklicken.
4. Den **Inhalt** des Ordners `heim-inventar` in das Browserfenster ziehen – also
   `index.html`, `manifest.webmanifest`, `sw.js` sowie die Ordner `css`, `js` und `icons`.
   Wichtig: nicht den Ordner selbst, sondern seinen Inhalt, damit `index.html` ganz oben liegt.
5. Unten **Commit changes**.
6. **Settings → Pages** (linke Spalte).
   - *Source*: **Deploy from a branch**
   - *Branch*: **main**, Ordner **/ (root)** → **Save**
7. Ein bis zwei Minuten warten, dann Seite neu laden. Oben steht die Adresse:
   `https://DEIN-NAME.github.io/heim-inventar/`

### Auf dem iPhone zum Home-Bildschirm

1. Adresse **in Safari** öffnen (nicht Chrome – nur Safari darf auf iOS installieren).
2. Teilen-Symbol (Quadrat mit Pfeil nach oben) antippen.
3. **Zum Home-Bildschirm** wählen → **Hinzufügen**.
4. Die App vom Home-Bildschirm starten. Sie läuft im Vollbild ohne Safari-Leiste.

Beim ersten Start braucht sie Internet, danach funktioniert sie offline –
nur die KI-Bilderkennung braucht weiterhin eine Verbindung.

### Updates ausrollen

Geänderte Dateien im Repo ersetzen **und** in `sw.js` die Zeile
`const VERSION = 'v1.0.0';` hochzählen. Ohne diese Änderung liefert der Service Worker
weiter die alte Fassung aus. Beim nächsten Start erscheint in der App ein blauer Balken
„Neue Version verfügbar“.

---

## 2. Gemini-API-Key eintragen

Ohne Key funktioniert die App vollständig – nur die Foto-Erkennung ist dann aus.
Du kannst Namen und Kategorie jederzeit selbst eintippen.

### Kostenlosen Key holen

1. **aistudio.google.com/app/apikey** öffnen.
2. Mit dem Google-Konto anmelden.
3. **Create API key** → Projekt wählen oder neu anlegen lassen.
4. Der Key beginnt mit `AIza…` – kopieren.

Google AI Studio hat ein kostenloses Kontingent, das für gelegentliches Erfassen
locker reicht.

### In der App hinterlegen

**Einstellungen** (unten rechts) → Abschnitt **Google Gemini API** → Feld **API-Key**
→ einfügen → einmal aus dem Feld tippen, damit gespeichert wird → **Verbindung testen**.

### Modellwahl

| Modell | wofür | gemessen |
|---|---|---|
| `gemini-3.6-flash` | Voreinstellung. Beste Mischung aus Erkennung und Tempo. | ~4 s |
| `gemini-3.5-flash-lite` | Sparsamer, benennt Dinge etwas grober. | ~4 s |
| `gemini-3.7-flash` | Stärker, aber deutlich langsamer. | ~35 s |
| `gemini-flash-latest` | Zeigt immer auf die neueste Flash-Version. | ~21 s |

Google schaltet ältere Modelle für neue Konten ab – `gemini-1.5-*`, `gemini-2.0-*` und
`gemini-2.5-*` sind so schon verschwunden. Kommt „Modell nicht verfügbar“, nennt die
Fehlermeldung das Nachfolgemodell; alternativ **Verfügbare Modelle laden** in den
Einstellungen antippen, das holt die aktuelle Liste direkt von Google. Alte Einstellungen
werden beim Start automatisch auf ein gültiges Modell umgestellt.

### Zur Sicherheit

Der Key liegt unverschlüsselt in der lokalen Datenbank der App und wird direkt vom
Browser an Google geschickt. Wer dein entsperrtes Gerät in der Hand hat, kann ihn auslesen.
Das ist der Preis dafür, dass es keinen Server gibt. Bei Verdacht: Key in AI Studio löschen
und einen neuen anlegen. Nutze für diese App am besten einen eigenen Key, keinen, der
noch woanders im Einsatz ist.

---

## 3. Bedienung

**Hinzufügen** – Foto aufnehmen oder aus der Mediathek wählen (optional), dazu einen
Hinweis für die KI („das ist ein Akkuschrauber“), dann **Mit KI erkennen**. Liegen mehrere
gut unterscheidbare Dinge auf dem Bild, entsteht pro Gegenstand eine eigene Karte.
Alles ist vor dem Speichern änderbar, Karten lassen sich löschen oder ergänzen.
Ganz ohne Foto: einfach Name und Kategorie eintippen.

Ort, Bestand und Notiz unten gelten für alle Karten gemeinsam – ein Foto vom Regalbrett
wird so mit einem Speichern zu mehreren Einträgen am selben Ort.

**Kategorien und Räume** starten leer und entstehen beim Tippen von selbst. Beim
Antippen des Feldes erscheint eine Liste dessen, was du schon hast; sobald du tippst,
filtert sie sich passend mit — Groß- und Kleinschreibung sowie Umlaute sind dabei egal,
„kuche“ findet also auch „Küchengeräte“. Passt nichts, steht unten „wird neu angelegt“,
damit klar ist, dass gleich ein neuer Eintrag entsteht. Auswählen per Tipp, am Rechner
auch mit Pfeiltasten und Eingabetaste. Die KI
schlägt bevorzugt eine bereits vorhandene Kategorie vor und erfindet nur dann eine neue,
wenn nichts passt. Unter Einstellungen lassen sich beide umbenennen und löschen;
benennst du eine auf einen bereits vorhandenen Namen um, werden sie zusammengeführt.

**Bestand** ist ein freies Feld: „3“, „genug“, „halb voll“ – wie du magst.
Die Schnellauswahl darunter füllt es nur aus.

**Fotos ansehen** – ein Tipp auf das Vorschaubild in der Liste öffnet das Original
formatfüllend, ohne den Eintrag zu öffnen; ein Tipp auf den Text daneben öffnet wie gewohnt
den Eintrag. In der Detail- und in der Hinzufügen-Ansicht öffnet ein Tipp auf das Bild
dasselbe Vollbild. Dort noch einmal antippen zoomt auf die Originalgröße und man kann im
Bild herumschieben; das × oben rechts oder ein Tipp neben das Bild schließt wieder.

**Liste** zeigt Vorschaubild, Name, Bestand, Ort sowie Datum und Uhrzeit. Die Suche geht
über Name, Kategorie, Raum, Ortdetail, Bestand und Notiz; dazu kommen Filter nach
Kategorie und Raum.

**Archiv** – gelöschte Einträge landen zuerst dort und bleiben wiederherstellbar.
Erst **Endgültig löschen** entfernt Eintrag und Foto unwiderruflich.
Zu erreichen über Einstellungen → Archiv öffnen.

---

## 4. Was noch fehlt

Diese Fassung ist Schritt 1. Als Nächstes geplant:

- **Export/Import** der kompletten Liste inklusive Bilder als Datei, zum Sichern und
  zum Teilen mit der Familie.
- **Duplikat-Erkennung**: ähnelt ein neues Foto einem vorhandenen Eintrag, beide Bilder
  nebeneinander zeigen und „Menge erhöhen“ oder „Neu anlegen“ anbieten.

**Bis dahin gibt es keine Sicherung.** Die Daten liegen nur auf dem einen Gerät.
Löschst du die App vom Home-Bildschirm oder in Safari die Website-Daten, sind sie weg.

---

## 5. Aufbau

```
index.html              alle Ansichten
manifest.webmanifest    Name, Icons, Vollbildmodus
sw.js                   Service Worker – App offline verfügbar (VERSION hochzählen!)
css/app.css             Gestaltung, hell und dunkel
js/app.js               Ansichten, Bedienung, Abläufe
js/db.js                IndexedDB: Einträge, Fotos, Kategorien, Räume, Einstellungen
js/img.js               Bilder dekodieren, drehen, verkleinern, kodieren
js/gemini.js            Aufrufe an die Gemini-API
js/combo.js             Vorschlagsliste für Kategorie und Raum
icons/                  App-Icons
```

Fotos werden beim Speichern auf max. 1600 px verkleinert (in den Einstellungen
umstellbar) und als JPEG abgelegt; zusätzlich entsteht ein 160-px-Vorschaubild für die
Liste. An Gemini geht eine 1024-px-Fassung. Teilen sich mehrere Einträge ein Foto, wird
es erst gelöscht, wenn der letzte davon endgültig entfernt wurde.
