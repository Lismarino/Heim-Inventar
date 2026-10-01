# Änderungen

Versionschronik von Heim-Inventar – was neu ist und was beim Update passiert. Bedienung,
Installation und Sicherung stehen in der [README](README.md).

## 2.0.2

Nachbesserungen aus einer unabhängigen Prüfung – Daten bleiben, wie sie sind.

- **Wichtig → Alles** behält den auf Start gewählten Ort (Orts-Chip sichtbar, Zahl wie auf der Karte).
- **Auto-Speichern** beim Verlassen eines Dings meldet „Gespeichert“ mit **Rückgängig**.
- **Filter:** die KI-Suche beachtet aktive Filter (Chips bleiben stehen); „Filter zurücksetzen“
  im Filter-Blatt und bei leerem Ergebnis.
- **Große Textgröße:** Kopfzeile ohne Überlappung (Titel kürzt mit „…“, „Zurück“ notfalls nur als
  Pfeil), Unterwegs-Etikett kürzt, Tab-Beschriftungen höchstens 12 pt, Suchfeld „Suchen …“.
- **Sprache:** überall „Dinge“ statt „Einträge“, die Kopfzeile zeigt den Namen des Dings, Zählungen
  mit „(davon n im Papierkorb)“; Hilfe-Texte wie in der App; „Was ist neu“ nennt den Papierkorb.
- **Datum** neuer Dokumente und Sicherungsdateien in Ortszeit (kurz nach Mitternacht nicht mehr der Vortag).

## 2.0.1

Barrierefreiheit und zwei Restpunkte – Daten bleiben, wie sie sind.

- **Zurückwischen** in einer Unterseite der Einstellungen (Kategorien, Über & Hilfe, Erweitert)
  führt wie „Zurück“ zur Hauptseite der Einstellungen.
- **„Habe ich das schon?“:** das Kamera-Symbol sitzt jetzt rechts im Suchfeld (wie das Mikrofon unter iOS).
- **Barrierefreiheit:** Tippflächen mindestens 44 × 44 Punkte, Platzhalter und kleine Hinweise mit
  genug Kontrast (hell und dunkel), eine Überschrift je Ansicht ohne übersprungene Ebene, Blätter
  und das große Foto als Dialog (Fokus hinein und zurück, Escape schließt). Neue dauerhafte
  Prüfung `tests/a11y.spec.js`.

## 2.0.0

Fertig gemacht (Bildschirme, Sprache, Hilfe) – Daten bleiben, wie sie sind (Datenbank Version 4).

- **„Was ist neu“** erscheint einmal nach dem Update (nicht bei einer Neuinstallation).
- **Alles:** ein **Filter-Knopf** neben der Suche statt drei Auswahllisten – Blatt mit Ort, Raum,
  Kategorie und Status; aktive Filter als Chips mit ×, dazu „11 von 61“. Zeilen ohne Datum; Bestand
  rechts als Zahl (− / + nach einem Tipp darauf), damit der Ort lesbar bleibt; Kategorie-Etikett nur
  noch, wenn kein Ort dasteht.
- **Einstellungen neu geordnet** (gut ein Bildschirm): Sicherung mit „Zuletzt gesichert …“ und
  **Jetzt sichern** · KI-Erkennung (An/Aus, Key, Testen) · Kategorien › · Töne · **Über & Hilfe** › ·
  **Erweitert** › (Google Drive, KI-Modell, Bildgröße, Datenbank prüfen, Einführung erneut zeigen).
- **Über & Hilfe:** Version, Datenschutz in einem Absatz, Kurzhilfe mit sechs Fragen, Feedback per E-Mail.
- **Begriffe vereinheitlicht:** Dinge statt Einträge, Formulare enden mit **Fertig** (statt
  Speichern/Sichern), „Belege an Dingen“, Papierkorb.
- **Dynamic Type:** Schriftgrößen in rem; auf dem iPhone folgt die Schrift der eingestellten Textgröße.
  Schriftgrößen und Radien auf eine kleinere Skala zusammengeführt.
- **Startfehler-Seite:** „Deine Daten sind sicher“ und Knopf **Erneut versuchen**; Technik eingeklappt.

## 2.0.0-beta.1

Neue Ordnung (Informationsarchitektur 2.0) – Daten bleiben, wie sie sind (Datenbank weiter
Version 4; gemerkter Ort auf Start, Papierkorb-Einträge und Einstellungen erscheinen unverändert).

- **Neue Leiste: Start · Alles · Kamera · Orte · Dokumente.** Dokumente sind ein eigener Tab
  (ein Tipp von überall); die Leiste markiert jetzt auch in Unterseiten den richtigen Bereich –
  Raum → Orte, Ordner und Dokument → Dokumente, Eintrag → wo er geöffnet wurde.
- **Einstellungen** öffnet der **⚙**-Knopf oben rechts auf Start (mit „Zurück“ und Zurückwischen).
- **Start** passt auf einen Bildschirm: Begrüßung, Orts-Umschalter (ab zwei Orten, ohne „+“), Suche,
  **eine** Karte **Wichtig** mit höchstens drei Zeilen – Fristen, Garantien (mit Namen), Sicherung,
  ohne Ort, unbenannt, unterwegs – nach Dringlichkeit; **Alle anzeigen** zeigt alles in einem Blatt.
  Die Raum-Kacheln, die Dokumente-Karte, der Hinweis „Ort hinzufügen“ und die eigene
  Sicherungs-Karte sind weg.
- **Orte** (bisher „Räume“): je Ort ein Kopf mit Symbol, Anzahl und ⋯, die Räume als kompakte
  Zeilen; oben **Ohne Ort (n)**; **+** oben rechts für **Neuer Ort / Neuer Raum in …**. Die
  gestrichelten Hinzufügen-Kacheln sind weg – 3 Orte mit 11 Räumen brauchen 1,3 statt 5 Bildschirme.
- **Dokumente:** **+** oben rechts (Scannen, Aus Fotos, PDF oder Datei, Neuer Ordner) statt der
  Knöpfe unten; in Ordnern „Zurück“ und Zurückwischen eine Ebene hoch, Tab erneut antippen führt
  ganz nach oben. Im Dokument-Blatt ändert „Bearbeiten“ Titel und Ordner (ohne eigene
  „Umbenennen“/„Verschieben“).
- **Archiv heißt jetzt Papierkorb.** Wischen und „Löschen“ legen ein Ding in den Papierkorb, mit
  **Rückgängig**; endgültig löschen nur dort. Erreichbar am Ende von **Alles**: „Papierkorb (n)“.
- Weniger doppelte Wege: kein Ohne-Ort-Banner mehr in Alles und Hinzufügen, „Habe ich das schon?“
  nur noch neben der Suche in Alles, keine Zähler-Plaketten in den Kopfzeilen – beim Suchen oder
  Filtern steht „11 von 61“ unter dem Suchfeld. Neue Orte entstehen im Tab Orte, beim Hinzufügen
  und in der Einführung; „Hier fotografieren“ steht im Raum und im Ort-⋯.
- Einführung nennt die neuen Tabs (Dokumente, Orte, ⚙ für die Einstellungen).
- Technik: Tab „Orte“ in `js/view-orte.js`; interne Namen `rooms` → `noplace`, `places` → `orte`;
  neue Prüfungen in `tests/ia.spec.js` (Bildschirmhöhen, Einstiege, aktiver Tab, Zurückwischen,
  alte Daten). Versionsnummer `2.0.0-beta.1` (wird nur auf Gleichheit geprüft).

## 1.11.0

Fundament für 2.0 – sichtbar ändern sich nur die Fehlerbehebungen.

- **Eintrag speichert beim Verlassen:** Wer im Eintrag etwas ändert (etwa eine Notiz) und dann
  „Zurück“ tippt, zurückwischt, einen Tab wählt oder die App verlässt, verliert nichts mehr – die
  Änderungen werden automatisch gespeichert („Gespeichert.“). Ein geleerter Name bleibt dabei,
  wie er war; alles andere wird übernommen. „Speichern“ funktioniert weiter wie bisher.
- **Unterwegs / verliehen:** Der gewählte Chip „Verliehen“ ist wieder deutlich zu sehen (hell und
  dunkel).
- **Töne:** Der Lautstärke-Regler (ohne sichtbare Schiene) ist weg; „Töne bei Aktionen“ bleibt.
  Eine früher gewählte Lautstärke gilt weiter.
- **Ohne API-Key** (KI-Suche, „Habe ich das schon?“, Erkennen): ein ruhiger Hinweis mit
  **Einrichten** statt einer roten Fehlermeldung; während der Auswahl liegt er über der
  Auswahl-Leiste statt auf ihr.
- Meldungen wie „„Kaffeemaschine“ archiviert.“ brechen um, statt abgeschnitten zu werden.
- Die Leiste „Neue Version verfügbar“ verdeckt Datum und Begrüßung nicht mehr.
- **Bald fällig** nennt die Garantie beim Namen: „Garantie: Laptop ThinkPad · Läuft in 20 Tagen ab“.
- Technik: `js/app.js` ist in Module aufgeteilt (Zustand, Navigation, je Ansicht eins, Sicherung,
  Meldungen …), die Datenbank-Schicht in drei Dateien; die Versionsnummer steht in `js/version.js`.
  Der Wassertropfen-Code ist entfernt, doppelte CSS-Angaben, die später ohnehin überschrieben
  wurden, ebenso. Die Start-Module werden parallel vorgeladen. Neu: dauerhafte Tests in `tests/`
  (`node tests/run.js`) – Start, Offline, Abläufe, Sicherungen aller Formate, Upgrade alter
  Datenbanken, Prüfung von Version und Dateilisten.

## 1.10.3

- **Tabwechsel wieder schlicht:** Statt des Wassertropfens blendet die alte Ansicht in 0,18 s
  weich aus, die neue ist sofort bedienbar. Der Tropfen war auf dem iPhone zu viel Bewegung und
  kostete Leistung.

## 1.10.2

- **Tabwechsel als Wassertropfen, neu gemacht:** Ein kleines Glas-Tröpfchen steigt vom Tab auf,
  taucht in die Mitte der Ansicht ein und öffnet dort einen Kreis mit der neuen Ansicht – mit
  feiner Lichtkante und zwei nachlaufenden Wellen. Ruhiger und etwas länger als zuvor, trotzdem
  sofort bedienbar: ein Tipp während des Übergangs beendet ihn und landet in der neuen Ansicht.
- **Flüssiger:** Hinzufügen gleitet ohne Sprung am Ende herein; lange Listen in **Alles** zeichnen
  rechtzeitig nach (kein kurzes Listenende mehr beim schnellen Scrollen); Tabwechsel ohne
  erzwungene Neuberechnung des Layouts.
- **Raum:** „Auswählen“ und ⋯ stehen wieder nebeneinander oben rechts.
- **PDF-Belege** öffnen auf dem iPhone zuverlässig (der Aktenschrank wird nach dem Start vorgeladen).
- Vor der ersten Berührung legt die App keinen Audio-Kontext mehr an (keine Browser-Warnung).

## 1.10.0

- **Aufgeräumt.** Der erste Tab heißt **Start** (der Ort „Zuhause“ bleibt). Auf Start stehen
  höchstens sechs Räume – beim gewählten Ort nur dessen, bei „Alle“ die ersten insgesamt – ohne
  „Raum hinzufügen“; **Alle** führt in den Tab **Räume**. Überall **Beleg** statt „Anhang“.
- **Einstellungen kürzer:** Orte und Räume verwaltet nur noch der Tab **Räume** (⋯ / langes
  Drücken: Umbenennen, Symbol & Farbe, Verschieben, Löschen); lange Erklärungen sind eingeklappt.
  Das **Archiv** öffnet sich jetzt über **Archiv ansehen** am Ende von **Alles**.
- **Alles:** nur noch Datum ohne Uhrzeit, flachere Zeilen (mehr passen aufs Display), die
  Filter-Reihe blendet rechts aus. Im Eintrag rückt der gewählte Ort-Chip in die Mitte.
- **Dokumente** schlägt Ordner nicht mehr ungefragt vor – dafür gibt es **Ordner vorschlagen**.
- **Hinzufügen:** „Ort wählen (optional)“; „Ins Archiv verschieben“ ist nicht mehr rot.
- **Töne** (neu): leise, kurze Klänge bei Tab-Wechsel, Foto, Speichern, Wegwischen, Rückgängig,
  Checkliste, Aktionsblatt, Fehlern, fertiger Sicherung und KI-Erkennung – per Web Audio erzeugt,
  ohne Audiodateien. Auf dem iPhone respektieren sie den Stummschalter und mischen sich unter
  Musik. Abschaltbar (mit Lautstärke) unter Einstellungen → Töne.
- **Schneller:** „Alles“ baut sich nur neu auf, wenn sich etwas geändert hat, und zeichnet lange
  Listen in Schüben; Aktenschrank, Scan, Verschlüsselung, Sicherung, Google Drive und Einführung
  lädt die App erst bei Bedarf (offline bleiben sie trotzdem da).
- **Speicher voll** meldet die App jetzt klar: „Speicher voll – mach eine Sicherung, verkleinere
  Fotos (Einstellungen) oder lösche Altes.“
- Update: nichts zu tun, die Datenbank bleibt unverändert (Version 4).

## 1.9.0


- **Dokumente** (digitaler Aktenschrank) – Karte **Dokumente** auf Zuhause, direkt unter der
  Suche. Bewusst kein eigener Tab: Die fünf Plätze der Leiste sind belegt, und Zuhause ist der
  Startbildschirm – so bleibt der Aktenschrank immer einen Tipp entfernt, ohne Räume oder
  Einstellungen zu verdrängen. Beim ersten Öffnen schlägt die App Ordner vor (Versicherungen,
  Verträge, Steuer, Auto, Arbeit, Gesundheit, Wohnen, Rechnungen – abwählbar). Ordner lassen sich
  schachteln, umbenennen, verschieben und löschen (⋯ rechts; Inhalt kommt in den Papierkorb).
- **Dokument hinzufügen** – **Scannen** (Kamera; mehrere Seiten, Drehen, „Schwarz-weiß, mehr
  Kontrast“ → ein PDF, das die App selbst erzeugt), **Fotos** oder **PDF / Datei** aus der
  Dateien-App. Dazu Titel (Vorschläge aus bisherigen Titeln), Ordner (der zuletzt benutzte ist
  vorausgewählt), Datum, Stichworte, Frist („Läuft ab“ / „Kündigen bis“) und optional ein Eintrag.
  Die Belege aus 1.8.0 gehören zum selben System: Ein Dokument kann in einem Ordner liegen, an
  einem Eintrag hängen oder beides; reine Belege stehen unter „Belege zu Einträgen“.
- Antippen: **Ansehen**, **Teilen / Sichern**, **Bearbeiten**, **Umbenennen**, **Verschieben**,
  **In den Papierkorb** (mit Wiederherstellen). Die Suche oben findet Titel, Ordner und Stichworte.
- **Bald fällig** auf Zuhause: Fristen der nächsten 30 Tage, zusammen mit ablaufenden Garantien.
- **KI und Dokumente:** Die KI-Suche kennt von Dokumenten **nur Titel, Ordnerpfad, Stichworte und
  Datum** – nie Dateien, Bilder oder Text daraus (erzwungen in `docsForAi` in `js/docs.js`).
- **Automatische Sicherung in Google Drive**, Ende-zu-Ende verschlüsselt – siehe unten und
  **[docs/GOOGLE-DRIVE.md](docs/GOOGLE-DRIVE.md)** (Einrichtung Schritt für Schritt).
- **Sicherungsdatei mit Passwort verschlüsseln** (Haken unter Einstellungen → Sicherung).

## 1.8.0


- **Unterwegs / verliehen** – im Aktionsblatt (lang drücken) oder im Eintrag: „Verliehen an Tom“
  oder „Unterwegs“. Die Zeile zeigt dann „Bei Tom seit 4 Tagen“, **Wieder da** hebt das auf.
  Zuhause zeigt unter „Zu erledigen“, wie viele Dinge gerade weg sind; die KI-Suche weiß es auch.
- **Checkliste je Ort** – im Eintrag unter „Mehr Angaben“ **Gehört immer hierher** einschalten.
  Im Ort (⋯ → Checkliste, im Tab „Räume“ oder in der Ortsansicht) lässt sich dann abhaken, ob
  alles da ist; Fehlendes zeigt, wo es zuletzt war. Die Häkchen gelten nur bis zum Schließen der App.
- **Habe ich das schon?** – Kamera-Knopf neben dem Suchfeld (oder in „Hinzufügen“): Foto
  aufnehmen, die KI benennt es, die App sucht ähnliche Namen im Bestand („Ja: 2× Keller“).
  Das Foto wird nicht gespeichert.
- **Duplikat-Hinweis** – benennt die KI ein neues Foto wie einen vorhandenen Eintrag, steht im
  neuen Eintrag „Ähnlich: …“ mit **Zusammenführen** (Bestand dort +1, neuen löschen) oder **Behalten**.
- **Bestand + / −** direkt in der Zeile, wenn der Bestand eine Zahl ist.
- **Mehrfachauswahl** – „Auswählen“ oben in „Alles“ oder in einem Raum/Ort (oder lang drücken →
  „Mehrere auswählen“): Ort, Kategorie, Unterwegs oder Archiv für alle auf einmal.
- **Sicherungs-Erinnerung** auf Zuhause, wenn die letzte Sicherung 7 Tage her ist (oder bei
  10 Einträgen noch keine da ist). **Später** blendet sie 3 Tage aus.
- **Belege & Unterlagen** im Eintrag unter „Mehr Angaben“: Seriennummer, Kaufdatum, Garantie bis
  und Belege (Fotos oder PDFs bis 10 MB; Bilder werden verkleinert). Läuft eine Garantie in den
  nächsten 30 Tagen ab, erinnert Zuhause daran.

## Sicherungsformat

Die Datei ist JSON (`"app": "heim-inventar"`). Seit 1.7.0 ist es **Version 2**: dazu
kommt die Liste `places` (Orte mit Name, Symbol, Farbe, Reihenfolge), Räume tragen `placeId`,
Einträge ebenfalls (bei einem Raum gleich dem Ort des Raums, sonst der Ort, an dem sie direkt
liegen, oder leer für „ohne Ort“). **Ältere Sicherungen (Version 1, ohne Orte) lassen sich weiter
einlesen:** Alle Räume kommen dann nach „Zuhause“ (vorhanden – sonst in den ersten Ort, falls es
„Zuhause“ unter anderem Namen gibt –, erst sonst neu angelegt), Einträge in einem
Raum mit; Einträge ohne Raum stehen danach unter „Ohne Ort“, wie vorher unter „Ohne Raum“. Eine
Sicherung aus 1.7.0 lässt sich in älteren Fassungen **nicht** einlesen („stammt aus einer neueren
Version“). Symbole und Farben aus der Datei werden nur aus den festen Listen der App übernommen.
Seit 1.9.0 ist es **Version 4**: dazu kommen `folders` (Ordner mit `parentId`) und an `docs` die
Felder `folderId`, `date`, `tags`, `due`, `dueKind`, `trashedAt`. Version 1–3 bleiben lesbar; die
Datenbank bekommt beim ersten Start von 1.9.0 die Speicher `folders` und `sync` sowie den Index
`by_folder` (IndexedDB-Version 4) – bestehende Anhänge bleiben unverändert und erscheinen unter
„Belege zu Einträgen“. Eine verschlüsselte Sicherung ist eine JSON-Hülle
(`"encrypted": true`, Salz, Iterationen, Chiffretext in base64).
Seit 1.8.0 ist es **Version 3**: dazu kommt `docs` (Anhänge als base64, nur mit „Fotos und
Anhänge mitsichern“) und die neuen Felder am Eintrag (`out`, `essential`, `serial`,
`purchaseDate`, `warrantyUntil`). Version 1 und 2 bleiben lesbar. Die Datenbank bekommt beim
ersten Start von 1.8.0 den zusätzlichen Speicher `docs` (IndexedDB-Version 3) – bestehende Daten
bleiben unverändert.

## 1.7.0 – Update auf Orte

Beim ersten Start von 1.7.0 stellt die App die Datenbank einmalig um (IndexedDB-Version 2): Es
entsteht der Ort **Zuhause** (Symbol Haus), alle bisherigen Räume und die Dinge darin gehören
dazu. Dinge, die bisher **ohne Raum** waren, bleiben ohne Ort – sie stehen weiter in „Zu erledigen“
(jetzt „N ohne Ort“) und lassen sich wie gewohnt gesammelt zuordnen. Der gemerkte Raum der
Schnellerfassung liegt danach in Zuhause. Die Umstellung läuft in einer einzigen Transaktion
(scheitert sie, bleibt alles wie es war, und der nächste Start versucht es erneut) und ist beliebig
oft wiederholbar, ohne etwas doppelt anzulegen. Gibt es gleichnamige Räume (etwa „Küche“ und
„küche“), werden sie zusammengeführt; es bleibt immer der älteste (bei Gleichstand der mit mehr
Einträgen) – auf jedem Gerät derselbe. Bei sehr vielen Einträgen dauert die Umstellung ein paar
Sekunden; die App zeigt dann „Einen Moment – deine Daten werden auf Orte umgestellt. Bitte App
offen lassen.“ mit Fortschritt (seit 1.7.1). Wird sie trotzdem geschlossen oder neu geladen, geht
nichts verloren – der nächste Start beginnt die Umstellung von vorn. Einträge ohne Raum werden
dabei gar nicht angefasst. Sicherheitshalber **vorher eine Sicherung machen**. **Zurück auf 1.6.x
geht nicht** (die umgestellte Datenbank kann die alte Fassung nicht mehr öffnen) – nur über eine
Sicherung, die mit 1.6.x gemacht wurde. Ist die App noch in einem anderen Safari-Tab mit der alten Version offen, wartet die
neue mit dem Hinweis „Einen Moment … noch in einem anderen Tab geöffnet“ – den anderen Tab
schließen, dann geht es von selbst weiter. Ein noch offener alter Tab gibt die Datenbank frei und
kann danach nichts mehr speichern; einfach neu laden.
