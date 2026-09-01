# Heim-Inventar

Privates Haushalts-Inventar als installierbare PWA. Alle Einträge und Fotos liegen
ausschließlich lokal auf dem Gerät (IndexedDB) – kein Server, kein Konto, kein Login.
Nach außen geht nur, was du selbst an Google Gemini schickst: das Foto beim Erkennen,
und die Liste als Text, wenn du die KI-Suche benutzt.

---

## 1. Auf dem iPhone installieren

1. Adressen ( https://lismarino.github.io/Heim-Inventar/ ) **in Safari** öffnen (nicht Chrome – nur Safari darf auf iOS installieren).
2. Teilen-Symbol (Quadrat mit Pfeil nach oben) antippen.
3. **Zum Home-Bildschirm** wählen → **Hinzufügen**.
4. Die App vom Home-Bildschirm starten. Sie läuft im Vollbild ohne Safari-Leiste.

Beim ersten Start braucht sie Internet, danach funktioniert sie offline –
nur die KI-Bilderkennung braucht weiterhin eine Verbindung.

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

**KI-Suche** – tippe eine ganze Frage ins Suchfeld, etwa „ich brauch irgendwas um das Ding
zu befestigen oder zu kleben“, und nimm den Knopf **Stattdessen die KI fragen** darunter
(am Rechner reicht die Eingabetaste). Die KI denkt vom Zweck her statt vom Wortlaut:
„kleben“ findet auch *Pattex Ultra Gel* und *Gewebeband*, „befestigen“ auch *Dübel* –
Wörter, die in keinem der Einträge stehen. Du bekommst einen Antwortsatz mit Fundort
plus die Treffer, jeder mit einer kurzen Begründung. **Zurück zur Liste** beendet das.

Dafür geht deine Liste als Text an Gemini: Name, Kategorie, Raum, Ort, Bestand und Notiz
aller nicht archivierten Einträge – keine Fotos. Ohne API-Key bleibt der Knopf wirkungslos,
die normale Textsuche funktioniert weiter. Zurückgegebene Nummern werden gegen den
tatsächlichen Bestand geprüft, damit nichts Erfundenes in der Trefferliste landet.

**Archiv** – gelöschte Einträge landen zuerst dort und bleiben wiederherstellbar.
Erst **Endgültig löschen** entfernt Eintrag und Foto unwiderruflich.
Zu erreichen über Einstellungen → Archiv öffnen.

---

## 4. Sicherung, Übertragung, Datenverlust

### Sichern

**Einstellungen → Sicherung → Sicherung erstellen**, danach **Sichern / Teilen**. Auf dem
iPhone öffnet sich das Teilen-Fenster: „In Dateien sichern“, per AirDrop an ein anderes
Gerät oder als Mail an die Familie. Am Rechner lädt die Datei herunter.

Enthalten sind alle Einträge, Kategorien, Räume, das Archiv und die Fotos.
**Der API-Key wird bewusst nicht mitgesichert** – sonst läge er in einer Datei, die du
per Mail verschickst. Ihn trägst du auf dem neuen Gerät einmal von Hand ein.

Der Haken „Fotos mitsichern“ lässt sich abschalten. Die Datei wird dann sehr klein, die
Vorschaubilder in der Liste bleiben trotzdem erhalten – nur die Originale fehlen.

### Einlesen

**Sicherung einlesen**, Datei wählen. Die App zeigt erst, was drinsteht, dann hast du
zwei Möglichkeiten:

- **Hinzufügen, Vorhandenes behalten** – für den Abgleich zwischen zwei Geräten.
  Einträge, die es schon gibt, werden übersprungen; gleichnamige Kategorien und Räume
  werden zusammengeführt statt doppelt angelegt.
- **Alles ersetzen** – löscht den aktuellen Stand und stellt die Datei her.
  Für den Umzug auf ein neues Gerät oder nach einem Datenverlust.

Mehrfaches Einlesen derselben Datei erzeugt keine Dubletten.

### Wenn die Daten weg zu sein scheinen

Ein Datei-Update auf dem Server kann die Datenbank nicht löschen. Prüfe der Reihe nach:

1. **Startet die App überhaupt?** Fehlt eine Datei auf dem Server, zeigt die App nach
   wenigen Sekunden „Die App konnte nicht starten“ und nennt die fehlende Datei.
   Die Einträge sind dann unversehrt – sie erscheinen wieder, sobald die Datei da ist.
   **Lösche die App in dieser Lage nicht vom Home-Bildschirm**, das würde sie wirklich löschen.
2. **Einstellungen → Datenbank prüfen.** Zeigt die tatsächlichen Satzzahlen und die
   Adresse, unter der die App gerade läuft.
3. **Stimmt die Adresse?** Die Daten hängen an der Web-Adresse. Unter einer anderen
   Adresse – etwa lokal getestet gegenüber GitHub Pages – liegt eine eigene, leere Datenbank.
4. **Wurde das Symbol vom Home-Bildschirm gelöscht und neu hinzugefügt?** Dann sind die
   Daten weg; iOS löscht den Speicher einer Web-App beim Entfernen mit.

### Was noch fehlt

- **Duplikat-Erkennung**: ähnelt ein neues Foto einem vorhandenen Eintrag, beide Bilder
  nebeneinander zeigen und „Menge erhöhen“ oder „Neu anlegen“ anbieten.

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
js/backup.js            Export und Import der Sicherungsdatei
icons/                  App-Icons
```

Fotos werden beim Speichern auf max. 1600 px verkleinert (in den Einstellungen
umstellbar) und als JPEG abgelegt; zusätzlich entsteht ein 160-px-Vorschaubild für die
Liste. An Gemini geht eine 1024-px-Fassung. Teilen sich mehrere Einträge ein Foto, wird
es erst gelöscht, wenn der letzte davon endgültig entfernt wurde.
