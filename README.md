# Keepsy

**Keepsy** (bis 2.0 „Heim-Inventar“) – privates Haushalts-Inventar als installierbare PWA. Alle Einträge und Fotos liegen
ausschließlich lokal auf dem Gerät (IndexedDB) – kein Server, kein Konto, kein Login.
Nach außen geht nur, was du selbst an Google Gemini schickst: das Foto beim Erkennen,
und die Liste als Text, wenn du die KI-Suche benutzt.

Was sich von Version zu Version geändert hat: **[CHANGELOG.md](CHANGELOG.md)**.

---

## 1. Auf dem iPhone installieren

1. Adressen ( https://lismarino.github.io/Heim-Inventar/ ) **in Safari** öffnen (nicht Chrome – nur Safari darf auf iOS installieren).
2. Teilen-Symbol (Quadrat mit Pfeil nach oben) antippen.
3. **Zum Home-Bildschirm** wählen → **Hinzufügen**.
4. Die App vom Home-Bildschirm starten. Sie läuft im Vollbild ohne Safari-Leiste.

Beim ersten Start braucht sie Internet, danach funktioniert sie offline –
nur die KI-Bilderkennung braucht weiterhin eine Verbindung. Beim Öffnen zeigt iOS kurz ein
Startbild (seit 2.1: das Keepsy-Symbol auf warmem Grund), bis die App steht; daraus wird nahtlos
die Start-Animation (Symbol federt kurz, „Keepsy“ blendet ein). Hell und dunkel sind hinterlegt.
iOS holt Startbild, Symbol und Namen nur beim Hinzufügen zum Home-Bildschirm: Wer die App vor
2.1 installiert hat, sieht dort weiter „Inventar“ und das alte Symbol, bis die App einmal entfernt
und neu hinzugefügt wird – **vorher eine Sicherung machen**, denn das Entfernen löscht die Daten
(siehe Abschnitt 4).

**Erster Start:** Eine kurze Einführung – Willkommen, **Wo hast du Sachen?** (Orte wie Zuhause –
schon vorgewählt –, Auto, Betrieb, Garten, Ferienhaus, Lager oder eigene), **Welche Räume …?**
(je Ort passende Vorschläge: im Auto Kofferraum, Handschuhfach, Werkzeugkiste …; bei mehreren
Orten oben umschalten) und optional der **Gemini-API-Key**. Alles lässt sich überspringen –
**Überspringen** (oder Escape am Rechner) übernimmt nichts von dem, was du dort angetippt hast.
**Los geht’s – erstes Foto** öffnet gleich die Kamera-Ansicht. Wer die App schon eingerichtet hat
(Einträge, Orte, Räume oder einen API-Key), sieht die Einführung nicht – auch nicht nach dem
Update auf 1.7.0. Erneut aufrufen: **Einstellungen → Erweitert → Einführung erneut zeigen**.

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

**Einstellungen** (⚙ oben rechts auf Start) → Abschnitt **KI-Erkennung** → Feld **API-Key**
→ einfügen → einmal aus dem Feld tippen, damit gespeichert wird → **Verbindung testen**.

### Modellwahl (Einstellungen → Erweitert)

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

Unten liegen fünf gleich breite Plätze: **Start · Alles · Kamera · Orte · Dokumente** (seit 2.0) –
der runde Kamera-Knopf zum Hinzufügen sitzt genau in der Mitte. Die **Einstellungen** öffnet der
**⚙**-Knopf oben rechts auf Start. Die Leiste markiert immer den Bereich, aus dem man gekommen ist:
ein Raum gehört zu **Orte**, ein Ordner oder ein Dokument zu **Dokumente**, ein Eintrag zu dem Tab,
aus dem er geöffnet wurde.

**Orte (seit 1.7.0).** Über den Räumen gibt es eine Ebene **Ort** – etwa **Zuhause**, **Auto**,
**Haus 2** oder **Betrieb**. Jeder Raum gehört zu genau einem Ort; beim Auto heißen die „Räume“
zum Beispiel Kofferraum, Handschuhfach oder Werkzeugkiste. Ein Ding kann auch direkt an einem Ort
liegen, ohne Raum („im Auto“). Raumnamen gelten nur innerhalb eines Orts: „Keller“ darf es in
Zuhause und in Haus 2 geben. Jeder Ort hat ein Symbol (Haus, Wohnung, Ferienhaus, Auto,
Transporter, Firma, Werkstatt, Garten, Lager) und eine Farbe; beim Anlegen schlägt die App das
Symbol aus dem Namen vor („Auto“ → Auto, „Betrieb“/„Firma“/„Arbeit“ → Firma, „Zuhause“/„Haus“ →
Haus) – ändern lässt es sich jederzeit. Gibt es nur einen Ort, nennt die App ihn nicht überall
dazu; ab zwei Orten steht er vor dem Raum („Auto · Kofferraum“).

**Start** ist der Überblick auf einen Blick: Begrüßung und „61 Dinge an 3 Orten“, ab zwei Orten
der **Orts-Umschalter** „Alle · Zuhause · Auto …“ (die App merkt sich die Wahl), ein Suchfeld
(führt in **Alles**), die Karte **Wichtig** und **Zuletzt hinzugefügt**. **Wichtig** zeigt höchstens
drei Zeilen, die dringendsten zuerst: Fristen und Garantien der nächsten 14 Tage (mit Namen,
„Garantie: Laptop ThinkPad · Läuft in 20 Tagen ab“), eine fällige **Sicherung** (antippen sichert,
**Später** blendet sie drei Tage aus), Dinge **ohne Ort** (öffnet das Zuordnen-Raster),
**unbenannte**, **unterwegs/verliehene**, Fotos, die auf den API-Key warten. **Alle anzeigen**
öffnet ein Blatt mit allen Punkten. Ist noch nichts erfasst, steht dort ein großer Kamera-Knopf.

**Orte** (Tab, bis 1.11 „Räume“) zeigt je Ort einen Kopf mit Symbol, Anzahl und **⋯**, darunter
die Räume als kompakte Zeilen (Foto, Name, Anzahl). Liegt etwas direkt am Ort ohne Raum, steht
vorneweg „Direkt in …“. Ganz oben in Terrakotta **Ohne Ort (n)**, solange Dinge keinen Ort haben.
**+** oben rechts legt einen **neuen Ort** oder einen **neuen Raum in …** an. **⋯** am Ort (oder
langes Drücken auf den Kopf): Hier fotografieren, **Checkliste**, Raum hinzufügen, Umbenennen (auf
einen vorhandenen Namen: zusammenführen), Symbol & Farbe, Ort löschen (Räume und Dinge ziehen in
einen anderen Ort oder nach „Ohne Ort“ – verloren geht nichts). Langes Drücken auf einen Raum:
Umbenennen, In anderen Ort verschieben, Raum löschen. Ein Raum zeigt alle Dinge darin nach
Kategorie gruppiert und **Hier fotografieren** (öffnet Hinzufügen mit Ort und Raum eingetragen).

**Gesten** – wie in anderen iPhone-Apps:
- **Zurückwischen:** in Eintrag, Raum, Ohne Ort, Papierkorb, Einstellungen und in Ordnern der
  Dokumente vom linken Bildschirmrand (unterhalb der Kopfzeile) nach rechts ziehen. Die Ansicht
  folgt dem Finger; ab gut einem Drittel oder mit Schwung geht es zurück.
- **Zurück** führt immer eine Ansicht zurück, auf dem Weg, den du gekommen bist; ein Tab in der
  Leiste beginnt dort neu. Eintrag → Kamera → Foto im Streifen → Zurück → **Fertig** endet also
  wieder dort, wo du angefangen hast, statt im Kreis zu laufen.
- **Zeile nach links wischen** (in **Alles** und im Raum): dahinter erscheint **Löschen**. Weit
  durchziehen legt das Ding in den **Papierkorb**; 5 Sekunden lang gibt es **Rückgängig** (bei
  mehreren nacheinander: „3 gelöscht“). „Löschen“ im Eintrag macht dasselbe.
- **Lange drücken** auf eine Zeile oder ein Bild in „Zuletzt hinzugefügt“: **Ort ändern**,
  **Umbenennen**, **Unterwegs / verliehen**, **Mehrere auswählen**, **Löschen**.
- Den Tab, in dem man schon ist, noch einmal antippen: springt nach oben (in **Dokumente** aus
  einem Ordner zurück ganz nach oben).

Ansichten gleiten von rechts herein, Hinzufügen kommt von unten; bei „Bewegung reduzieren“ in
den iOS-Einstellungen springt alles ohne Animation.

**Aussehen (seit 2.1 „Warm minimal“).** Flach und ruhig: warme Grautöne, solide Karten und Listen,
eine Akzentfarbe (Einstellungen → **Darstellung**: Tannengrün, Blau, Indigo, Lila, Himbeere, Orange,
Senfgelb oder Graphit – je hell und dunkel mit Kontrast ≥ 4,5 : 1). Terrakotta ist für Hinweise
reserviert (Fristen, ohne Ort, fällige Sicherung). Glas gibt es nur noch dezent – Tönung, Unschärfe
und eine Haarlinie – für Schwebendes: Tab-Leiste, Kopfzeile beim Scrollen, Blätter, Hinweise. Bei
„Transparenz reduzieren“ oder „Kontrast erhöhen“ werden diese Flächen solide; bei „Bewegung
reduzieren“ springt alles ohne Animation. Alle Farben, Schriftgrößen (8) und Radien (8/12/16/22)
stehen als Tokens in `css/tokens.css`. Beim Speichern eines Fotos, beim Zuweisen,
Wegwischen, langen Drücken und beim Wählen eines Orts gibt es ein leichtes Tippen als Rückmeldung – sofern iOS das für
Web-Apps unterstützt (das ist nicht dokumentiert und klappt womöglich nicht auf jedem iPhone).

Aktionsblatt und Einführung sperren, solange sie offen sind, den Rest der App (auch für
VoiceOver und die Tab-Taste); danach steht der Fokus wieder auf dem Knopf, der sie geöffnet hat.

**Hinzufügen – Schnellerfassung.** Foto, Foto, Foto, fertig: Oben steht groß, wo du gerade
bist – „Du bist gerade in: **Auto › Kofferraum**“. Darunter wählst du erst den **Ort** (Chips mit
Symbol, **Neuer Ort** legt einen an), dann den **Raum** darin (optional; Vorschläge nur aus diesem
Ort, ein neuer Name legt den Raum in diesem Ort an) und optional den **genauen Platz**. Die App
merkt sich alles und trägt es beim nächsten Mal wieder ein, bis du es änderst. Ein Ort ohne Raum
ist in Ordnung („direkt im Auto“). Tippst du den gewählten Ort noch einmal an, ist er wieder
offen – dann ordnest du später zu (siehe **Ohne Ort**). **Hier fotografieren** aus einem Raum oder
Ort belegt beides vor.

Darunter zwei große Knöpfe: **Foto aufnehmen** öffnet direkt die Kamera, **Aus Mediathek**
nimmt beliebig viele Fotos auf einmal. Jedes Foto wird **sofort** als Eintrag gespeichert,
ohne auf die KI zu warten; du bleibst in der Ansicht und kannst gleich weiterknipsen. Ein
kleiner Streifen zeigt die Fotos dieser Runde („5 erfasst · 2 werden erkannt“), ein Tipp
darauf öffnet den Eintrag. Viele Fotos aus der Mediathek werden nacheinander verarbeitet,
damit dem iPhone nicht der Speicher ausgeht. **Fertig** führt dorthin zurück, wo du herkamst
(Zuhause, Alles, Räume oder der Raum).

**Erkennung im Hintergrund.** Die KI benennt die Fotos, während du weitermachst – höchstens
zwei gleichzeitig, an Gemini geht nur eine kleine 768-px-Fassung. Bis dahin steht in der
Liste „wird erkannt …“. Liegen mehrere gut unterscheidbare Dinge auf einem Bild, entsteht
pro Gegenstand ein eigener Eintrag mit demselben Foto, Ort und Raum. Hast du einen Namen schon
selbst eingetragen, überschreibt die KI ihn nicht. Offline oder wenn Google gerade bremst
(429), bleiben die Fotos in der Warteschlange und werden später erkannt – auch nach einem
Neustart der App, sobald du wieder online bist. Klappt die Erkennung nicht, steht der Eintrag
als **„Unbenannt – antippen zum Benennen“** in der Liste; im Eintrag gibt es dann **Erneut
erkennen**. „Erneut erkennen“ legt keine weiteren Zusatz-Einträge an, wenn aus dem Foto schon
welche entstanden sind.

**Ohne API-Key** werden Fotos gar nicht erst geschickt, sondern landen direkt als
„Unbenannt“ in der Liste. Sobald du in den Einstellungen einen Key einträgst (oder ihn
änderst), merkt die App alle solchen Fotos – nicht archiviert, noch ohne Namen – automatisch
zur Erkennung vor und meldet „N Fotos werden jetzt erkannt“. Einzelne Einträge lassen sich
auch im Eintrag über **Mit KI erkennen** anstoßen. Wartet ein Eintrag auf die Erkennung, ist
aber kein Key hinterlegt (etwa nach dem Einlesen einer Sicherung auf einem neuen Gerät),
steht dort „Wartet auf API-Key“ statt „wird erkannt …“.

**Ohne Foto eintragen** – aufklappbar unter den Foto-Knöpfen: Name, Kategorie, Fertig.
Ort, Raum und genauer Platz kommen aus den Feldern ganz oben. Bestand (mit Schnellauswahl) und Notiz
liegen hinter **Mehr Angaben**. Lässt du die Kategorie leer, schlägt die KI im Hintergrund
eine vor.

**Ohne Ort** (bis 1.6 „Ohne Raum“) – nach zehn Fotos aus der Galerie weiß die KI nicht, wo die
Dinge liegen. Gibt es Einträge ganz ohne Ort, zeigt die Liste oben einen Hinweis („7 Einträge
ohne Ort – jetzt zuordnen“), dasselbe steht in der Hinzufügen-Ansicht. Dinge, die einen Ort, aber
keinen Raum haben, gelten als zugeordnet und stehen hier nicht. Dahinter liegt ein Raster aus
Vorschaubildern: antippen markiert (Haken), noch einmal antippen hebt es auf; dazu **Alle
auswählen** und **Keine**. Unten in der Zuweisen-Leiste den Ort wählen (vorgewählt ist der
gemerkte), optional Raum (neue werden im Ort angelegt) und genauen Platz eintragen, **N
zuweisen** – die Einträge verschwinden aus dem Raster, alles in einem Schritt. Das kleine
Stift-Symbol öffnet einen Eintrag, **Zurück** führt wieder ins Raster.

**Eintrag bearbeiten** – Name, Kategorie, Ort (Chips) und Raum stehen oben; genauer Platz,
Bestand und Notiz liegen hinter **Mehr Angaben**, außer sie sind schon befüllt. Wechselt der Ort
und gibt es den eingetragenen Raum dort nicht, wird das Raumfeld geleert.

**Kategorien, Orte und Räume** starten leer und entstehen beim Tippen von selbst (ein Raum ohne
gewählten Ort landet im Ort, in dem es ihn schon gibt, sonst in „Zuhause“). Beim
Antippen des Feldes erscheint eine Liste dessen, was du schon hast; sobald du tippst,
filtert sie sich passend mit — Groß- und Kleinschreibung sowie Umlaute sind dabei egal,
„kuche“ findet also auch „Küchengeräte“. Passt nichts, steht unten „wird neu angelegt“,
damit klar ist, dass gleich ein neuer Eintrag entsteht. Auswählen per Tipp, am Rechner
auch mit Pfeiltasten und Eingabetaste. Die KI
schlägt bevorzugt eine bereits vorhandene Kategorie vor und erfindet nur dann eine neue,
wenn nichts passt. Kategorien lassen sich unter Einstellungen umbenennen und löschen; Orte und
Räume im Tab **Orte** (⋯ oder langes Drücken: Umbenennen, Symbol & Farbe, Verschieben, Löschen).
Benennst du auf einen bereits vorhandenen Namen um, werden sie zusammengeführt – bei Räumen nur
innerhalb desselben Orts.

**Bestand** ist ein freies Feld: „3“, „genug“, „halb voll“ – wie du magst.
Die Schnellauswahl darunter füllt es nur aus.

**Fotos ansehen** – ein Tipp auf das Vorschaubild in der Liste öffnet das Original
formatfüllend, ohne den Eintrag zu öffnen; ein Tipp auf den Text daneben öffnet wie gewohnt
den Eintrag. In der Detail-Ansicht öffnet ein Tipp auf das Bild dasselbe Vollbild. Dort noch einmal antippen zoomt auf die Originalgröße und man kann im
Bild herumschieben; das × oben rechts oder ein Tipp neben das Bild schließt wieder.

**Alles** (früher „Liste“) zeigt je Zeile Vorschaubild, Name, Ort und Raum („Auto · Kofferraum“ mit
dem Symbol des Orts) und rechts den Bestand – ein Tipp auf die Zahl zeigt − / +. Die Suche geht über
Name, Kategorie, Ort, Raum, genauen Platz, Bestand und Notiz – „auto“ findet also alles im Auto. Der
**Filter-Knopf** neben der Suche öffnet ein Blatt mit Ort, Raum, Kategorie und Status (unterwegs/verliehen,
unbenannt, Garantie läuft ab); aktive Filter stehen als Chips mit × darunter, dazu „11 von 61“.

**KI-Suche** – tippe eine ganze Frage ins Suchfeld, etwa „ich brauch irgendwas um das Ding
zu befestigen oder zu kleben“, und nimm den Knopf **Stattdessen die KI fragen** darunter
(am Rechner reicht die Eingabetaste). Die KI denkt vom Zweck her statt vom Wortlaut:
„kleben“ findet auch *Pattex Ultra Gel* und *Gewebeband*, „befestigen“ auch *Dübel* –
Wörter, die in keinem der Einträge stehen. Du bekommst einen Antwortsatz mit Fundort („liegt im
Auto, in der Werkzeugkiste“) plus die Treffer, jeder mit einer kurzen Begründung. **Zurück zur Liste** beendet das.

Dafür geht deine Liste als Text an Gemini: Name, Kategorie, Ort, Raum, genauer Platz, Bestand und Notiz
aller nicht archivierten Einträge – keine Fotos. Ohne API-Key bleibt der Knopf wirkungslos,
die normale Textsuche funktioniert weiter. Zurückgegebene Nummern werden gegen den
tatsächlichen Bestand geprüft, damit nichts Erfundenes in der Trefferliste landet.

**Unterwegs / verliehen** – im Aktionsblatt (lang drücken) oder im Eintrag; die Zeile zeigt dann
„Bei Tom seit 4 Tagen“, **Wieder da** hebt es auf. **Checkliste je Ort** – im Eintrag unter
„Mehr Angaben“ **Gehört immer hierher** einschalten, dann im Ort (⋯ → Checkliste) abhaken.
**Habe ich das schon?** – Kamera-Knopf neben dem Suchfeld: Foto, die KI benennt es, die App sucht
im Bestand (das Foto wird nicht gespeichert). **Mehrfachauswahl** über „Auswählen“ in „Alles“ oder
in einem Raum. **Bestand + / −** direkt in der Zeile, wenn der Bestand eine Zahl ist.

**Belege** – im Eintrag unter „Mehr Angaben“: Seriennummer, Kaufdatum, Garantie bis und Belege
(Fotos oder PDFs bis 10 MB). Läuft eine Garantie oder eine Dokument-Frist in den nächsten 30 Tagen
ab, steht das auf **Start** unter „Wichtig“.

**Dokumente** (Aktenschrank, eigener Tab seit 2.0) – **+** oben rechts: **Scannen** (mehrere Seiten
→ PDF), **Aus Fotos**, **PDF oder Datei** (Dateien-App) oder **Neuer Ordner**; danach Titel, Datum,
Stichworte, Frist und optional ein Eintrag. Ordner lassen sich verschachteln (auf Wunsch schlägt die
App welche vor). Gelöschte Dokumente liegen im **Papierkorb** der Dokumente. Die KI-Suche kennt von
Dokumenten nur Titel, Ordner, Stichworte und Datum.

**Töne** – leise, kurze Klänge bei Tab-Wechsel, Foto, Speichern, Wegwischen, Rückgängig,
Checkliste, Aktionsblatt, Fehlern, fertiger Sicherung und KI-Erkennung. Sie werden im Gerät erzeugt
(keine Audiodateien), folgen auf dem iPhone dem Stummschalter und lassen laufende Musik weiterspielen.
Abschalten oder leiser stellen: Einstellungen → Töne.

**Papierkorb** (bis 1.11 „Archiv“) – gelöschte Dinge landen zuerst dort und bleiben
wiederherstellbar; erst **Endgültig löschen** im Papierkorb entfernt Eintrag und Foto
unwiderruflich. Zu erreichen über **Papierkorb (n)** am Ende von **Alles**.

---

## 4. Sicherung, Übertragung, Datenverlust

### Sichern

**Einstellungen → Sicherung → Jetzt sichern**, danach **Sichern / Teilen**. Oben steht, wann zuletzt gesichert wurde. Auf dem
iPhone öffnet sich das Teilen-Fenster: „In Dateien sichern“, per AirDrop an ein anderes
Gerät oder als Mail an die Familie. Am Rechner lädt die Datei herunter.

Enthalten sind alle Einträge, Kategorien, Orte, Räume, der Papierkorb, die Fotos, Belege und Dokumente.
**Der API-Key wird bewusst nicht mitgesichert** – sonst läge er in einer Datei, die du
per Mail verschickst. Ihn trägst du auf dem neuen Gerät einmal von Hand ein.

Der Haken „Fotos und Belege mitsichern“ lässt sich abschalten. Die Datei wird dann sehr klein, die
Vorschaubilder in der Liste bleiben trotzdem erhalten – nur die Originale fehlen.

**Verschlüsselt (seit 1.9.0):** Mit dem Haken „Sicherungsdatei mit Passwort verschlüsseln“ fragt
die App vor dem Erstellen nach einem Passwort (PBKDF2-SHA-256 mit 310 000 Runden → AES-GCM).
In der Datei steht dann nichts Lesbares mehr; beim Einlesen fragt die App nach dem Passwort.
**Passwort vergessen = Datei unbrauchbar.**

**Wohin?** iCloud Drive und Proton Drive gehen über diese Datei-Sicherung („In Dateien sichern“ →
iCloud Drive bzw. der Proton-Drive-Ordner in der Dateien-App). Proton Drive hat keine Schnittstelle
für Web-Apps, iCloud ebenso wenig – eine *automatische* Sicherung gibt es deshalb nur für Google Drive.

### Automatisch in Google Drive (seit 1.9.0)

Einstellungen → Erweitert → **Google Drive (verschlüsselt)**: OAuth-Client-ID eintragen (einmalig in der
Google Cloud Console anlegen – Anleitung für Laien: **[docs/GOOGLE-DRIVE.md](docs/GOOGLE-DRIVE.md)**),
**Verbinden & einrichten**, Passwort festlegen. Danach sichert die App beim Start und etwa 30 Sekunden
nach jeder Änderung – nur Neues, verschlüsselt, in den versteckten App-Datenordner deines Drive
(Scope `drive.appdata`: für dich und andere Apps unsichtbar, die App sieht nichts von deinem übrigen
Drive). Google sieht weder Inhalte noch Dateinamen. Auf Zuhause steht „In Google Drive gesichert vor
2 Min.“; läuft die Anmeldung ab (nach etwa einer Stunde) und lässt sie sich nicht still erneuern,
steht dort „einmal tippen zum Fortsetzen“. Auf einem neuen Gerät: Client-ID eintragen →
**Aus Google Drive wiederherstellen** → Passwort. Die Google-Sicherung zählt für die
Sicherungs-Erinnerung mit.

### Einlesen

**Aus Datei wiederherstellen**, Datei wählen. Die App zeigt erst, was drinsteht, dann hast du
zwei Möglichkeiten:

- **Hinzufügen, Vorhandenes behalten** – für den Abgleich zwischen zwei Geräten.
  Einträge, die es schon gibt, werden übersprungen; gleichnamige Kategorien und Orte werden
  zusammengeführt statt doppelt angelegt, Räume nach Ort und Name („Keller“ in Zuhause und
  „Keller“ in Haus 2 bleiben zwei Räume).
- **Alles ersetzen** – löscht den aktuellen Stand und stellt die Datei her.
  Für den Umzug auf ein neues Gerät oder nach einem Datenverlust.

Mehrfaches Einlesen derselben Datei erzeugt keine Dubletten. Geschrieben wird in einer einzigen
Transaktion – scheitert etwas, bleibt der alte Stand vollständig erhalten.

**Format.** Die Datei ist JSON (`"app": "heim-inventar"`, derzeit **Version 4**): Einträge,
Fotos (base64), Kategorien, `places` (Orte mit Symbol, Farbe, Reihenfolge), Räume mit `placeId`,
`folders` (Ordner mit `parentId`) und `docs` (Belege und Dokumente mit Ordner, Datum, Stichworten,
Frist, Papierkorb). Ältere Sicherungen (Version 1–3) lassen sich weiter einlesen; Symbole und
Farben werden nur aus den festen Listen der App übernommen. Eine verschlüsselte Sicherung ist eine
JSON-Hülle (`"encrypted": true`, Salz, Iterationen, Chiffretext in base64). Wie sich das Format
entwickelt hat, steht in **[CHANGELOG.md](CHANGELOG.md)**.

### Wenn die Daten weg zu sein scheinen

Ein Datei-Update auf dem Server kann die Datenbank nicht löschen. Prüfe der Reihe nach:

1. **Startet die App überhaupt?** Passen nach einem Update die geladenen Dateien nicht
   zusammen (neues `index.html`, altes `app.js` aus dem Zwischenspeicher), übernimmt die App
   von selbst die neue Version und lädt einmal neu – dafür musst du nichts tun. Fehlt eine
   Datei auf dem Server, zeigt die App nach wenigen Sekunden „Die App konnte nicht starten“
   und nennt die fehlende Datei.
   Die Einträge sind dann unversehrt – sie erscheinen wieder, sobald die Datei da ist.
   **Lösche die App in dieser Lage nicht vom Home-Bildschirm**, das würde sie wirklich löschen.
2. **Einstellungen → Datenbank prüfen.** Zeigt die tatsächlichen Satzzahlen und die
   Adresse, unter der die App gerade läuft.
3. **Stimmt die Adresse?** Die Daten hängen an der Web-Adresse. Unter einer anderen
   Adresse – etwa lokal getestet gegenüber GitHub Pages – liegt eine eigene, leere Datenbank.
4. **Wurde das Symbol vom Home-Bildschirm gelöscht und neu hinzugefügt?** Dann sind die
   Daten weg; iOS löscht den Speicher einer Web-App beim Entfernen mit.

### Was noch fehlt

- **Duplikat-Erkennung per Bildvergleich**: bisher vergleicht die App nur die erkannten Namen.

---

## 5. Aufbau

```
index.html              alle Ansichten, die SVG-Symbole (Sprite ganz oben im <body>), Start-Szene,
                        Startbild-Links, modulepreload der Start-Module und der Start-Wächter (Dateiliste)
manifest.webmanifest    Name, Icons, Vollbildmodus
sw.js                   Service Worker – App offline verfügbar (Dateiliste ASSETS, VERSION)
css/tokens.css          alle Farben (hell/dunkel, 8 Akzentfarben), Schriftgrößen, Radien, Schatten
css/app.css             Gestaltung – nur mit den Tokens, keine Farbwerte (tests/consistency.spec.js)
js/version.js           die Versionsnummer (APP_VERSION) – einzige Quelle; index.html (<meta name="app-version">)
                        und sw.js (VERSION) ziehen gleich, tests/consistency.spec.js prüft das
js/app.js               Start (Boot, Umstellung auf Orte, Fehlerseiten), Tipps auf Start und „Wichtig“, Verdrahtung
js/state.js             gemeinsamer Zustand, Nachschlage-Hilfen (Ort/Raum/Kategorie), reloadAll
js/nav.js               Navigation: Tabs (Start, Alles, Orte, Dokumente), Push-Ansichten, Stapel, Zurückwischen, Neuzeichnen
js/toast.js             Meldungen (mit „Rückgängig“), Service Worker, Update-Leiste
js/lazy.js              bei Bedarf geladene Module (Aktenschrank, Sicherung, Drive, Einführung)
js/view-list.js         „Alles“: Liste, Suche, Filter, KI-Suche, Papierkorb
js/view-item.js         Eintrag: Felder (speichert beim Verlassen), Unterwegs, Duplikat, Belege, Vollbild
js/view-add.js          Hinzufügen: Schnellerfassung, ohne Foto
js/view-noplace.js      „Ohne Ort“: gesammelt zuordnen
js/view-orte.js         Tab „Orte“: Orte mit ihren Räumen als Zeilen, „Ohne Ort“, „+“ (Neuer Ort / Neuer Raum)
js/view-room.js         Raum/Ort-Ansicht und ihre Menüs, Orte und Räume anlegen/verschieben/löschen
js/where.js             Orts-Chips, Ort/Raum auflösen, Blatt „Ort ändern“
js/select.js            Kontextmenü, Löschen (Papierkorb) mit Rückgängig, Unterwegs, Auswahl, Checkliste, Habe ich das schon?
js/view-settings.js     Einstellungen: API-Key, Modell, Töne, Kategorien, Speicher
js/settings-backup.js   Sicherung erstellen/einlesen, Passwort-Blatt, Google Drive
js/home.js              Startseite (Orts-Umschalter, „Wichtig“, Zuletzt hinzugefügt mit scharfen Bildern) und
                        Raum-/Orts-Ansicht
js/places.js            Orte: Symbole, Farben, Symbol-Vorschlag aus dem Namen, Raumvorschläge je Art,
                        Chips und Plaketten (ohne Datenbank)
js/match.js             Namen vergleichen (Habe ich das schon?, Duplikat-Hinweis), Unterwegs-Text, Datumsangaben
js/docs.js              Belege & Dokumente: vorbereiten (Bilder verkleinern, PDFs bis 10 MB), Metadaten
                        bereinigen, schlankes Verzeichnis (Fristen, Titel, Ordnerpfade für Start/Suche/KI),
                        docsForAi (einzige Stelle, die Dokumente für die KI aufbereitet)
js/cabinet.js           Dokumente (Aktenschrank): Ordner, Übersicht, Suche, Papierkorb, Hinzufügen/Bearbeiten
                        – wie scan, crypto, backup, gdrive und onboarding erst bei Bedarf geladen (import())
js/scan.js              Scan aufbereiten (Drehen, Graustufen/Kontrast, verkleinern) und PDF-Writer (JPEG-Seiten)
js/crypto.js            PBKDF2 → AES-GCM (WebCrypto), verschlüsselte Sicherungsdatei
js/gdrive.js            Google-Drive-Sicherung: Anmeldung (Google Identity Services, erst bei Bedarf
                        nachgeladen), Manifest + Blobs verschlüsselt, inkrementell, Wiederherstellen
js/ui.js                gemeinsame Darstellungs-Helfer (Escapen, Symbole, Platzhalter)
js/motion.js            Übergänge zwischen den Ansichten (nur transform/opacity) und die Federn
js/glass.js             Glas & Bewegung: Tab-Linse (und Linse im Orts-Umschalter), schrumpfende Leiste, Glas-Kopfzeilen, Aufquellen,
                        Kamera-Tropfen, Herkunft für wachsende Aktionsblätter
js/intro.js             Start-Szene: Symbol + „Keepsy“ (nur beim echten Start)
js/accent.js            Akzentfarbe anwenden und im localStorage spiegeln
js/gestures.js          Zurückwischen, Zeile wegwischen, langes Drücken, Haptik
js/sheet.js             Aktionsblatt von unten (Kontextmenü, kleine Eingaben)
js/sound.js             Töne: per Web Audio erzeugt (keine Dateien), leise, abschaltbar
js/onboarding.js        Einführung beim ersten Start
js/db.js                IndexedDB (Version 4): Einträge, Dokumente, Import – und die öffentliche Schnittstelle für
                        db-core.js (Öffnen/Aufrüsten, Transaktionen, Einstellungen, „Speicher voll“-Meldung) und
                        db-places.js (Kategorien, Orte, Räume, Umstellung auf Orte, Verschieben, Ort löschen)
js/img.js               Bilder dekodieren, drehen, verkleinern, kodieren
js/gemini.js            Aufrufe an die Gemini-API
js/queue.js             KI-Warteschlange: erkennt erfasste Fotos im Hintergrund
js/combo.js             Vorschlagsliste für Kategorie und Raum (Räume nur aus dem gewählten Ort)
js/backup.js            Export und Import der Sicherungsdatei
icons/                  App-Icons
icons/splash/           iOS-Startbilder, hell und dunkel (bewusst nicht im Service-Worker-Cache)
tools/splash.js         erzeugt die Startbilder aus der Start-Szene in index.html (Playwright;
                        gehört nicht zur App) – nach Änderungen an der Szene neu ausführen
tools/icon.svg          Vorlage des App-Symbols (Box mit Deckel, Tannengrün auf warmem Grund)
tools/icon.js           erzeugt daraus die PNGs in icons/ (Playwright; gehört nicht zur App)
tests/                  automatische Prüfungen (Playwright, ohne Build): node tests/run.js – siehe tests/README.md
```

Fotos werden beim Speichern auf max. 1600 px verkleinert (in den Einstellungen
umstellbar) und als JPEG abgelegt; zusätzlich entsteht ein 160-px-Vorschaubild für die
Liste. An Gemini geht eine 768-px-Fassung, bei der Bilderkennung mit abgeschaltetem bzw.
reduziertem „Denken“ des Modells – das macht sie deutlich schneller. Teilen sich mehrere Einträge ein Foto, wird
es erst gelöscht, wenn der letzte davon endgültig entfernt wurde.
