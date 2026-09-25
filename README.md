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
nur die KI-Bilderkennung braucht weiterhin eine Verbindung. Beim Öffnen zeigt iOS kurz ein
Startbild (ein leeres gläsernes Regalbrett auf Leinen), bis die App steht; daraus wird nahtlos
die Start-Animation (siehe **Aussehen und Bewegung** in Abschnitt 3). Eine dunkle Fassung auf
Espresso ist hinterlegt; ob iOS sie im Dunkelmodus auch nimmt, entscheidet iOS selbst – sonst
erscheint die helle. iOS holt die Startbilder nur beim Hinzufügen zum Home-Bildschirm: Wer die
App schon vor Version 1.6.0 installiert hat, sieht noch das alte Startbild (Einmachglas) und
danach einen kleinen Sprung zum Glasregal – das neue Bild kommt erst, nachdem man die App einmal
vom Home-Bildschirm entfernt und neu hinzugefügt hat – **vorher eine Sicherung machen**, denn
das Entfernen löscht die Daten (siehe Abschnitt 4). Seit 1.6.1 steht im Startbild kein Schriftzug
mehr (die runde iPhone-Schrift lässt sich nicht ins Bild übernehmen); die Start-Szene blendet
„Inventar“ in der echten Systemschrift ein. Mit einem Startbild aus 1.6.0 verschwindet der
Schriftzug deshalb beim Übergang kurz und taucht dann wieder auf – harmlos.

**Erster Start:** Eine kurze Einführung – Willkommen, **Wo hast du Sachen?** (Orte wie Zuhause –
schon vorgewählt –, Auto, Betrieb, Garten, Ferienhaus, Lager oder eigene), **Welche Räume …?**
(je Ort passende Vorschläge: im Auto Kofferraum, Handschuhfach, Werkzeugkiste …; bei mehreren
Orten oben umschalten) und optional der **Gemini-API-Key**. Alles lässt sich überspringen –
**Überspringen** (oder Escape am Rechner) übernimmt nichts von dem, was du dort angetippt hast.
**Los geht’s – erstes Foto** öffnet gleich die Kamera-Ansicht. Wer die App schon eingerichtet hat
(Einträge, Orte, Räume oder einen API-Key), sieht die Einführung nicht – auch nicht nach dem
Update auf 1.7.0. Erneut aufrufen: **Einstellungen → Über → Einführung erneut zeigen**.

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

**Einstellungen** (unten ganz rechts) → Abschnitt **Google Gemini API** → Feld **API-Key**
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

Unten liegen fünf gleich breite Plätze: **Zuhause · Alles · Kamera · Räume · Einstellungen** –
der runde Kamera-Knopf zum Hinzufügen sitzt genau in der Mitte.

**Orte (seit 1.7.0).** Über den Räumen gibt es eine Ebene **Ort** – etwa **Zuhause**, **Auto**,
**Haus 2** oder **Betrieb**. Jeder Raum gehört zu genau einem Ort; beim Auto heißen die „Räume“
zum Beispiel Kofferraum, Handschuhfach oder Werkzeugkiste. Ein Ding kann auch direkt an einem Ort
liegen, ohne Raum („im Auto“). Raumnamen gelten nur innerhalb eines Orts: „Keller“ darf es in
Zuhause und in Haus 2 geben. Jeder Ort hat ein Symbol (Haus, Wohnung, Ferienhaus, Auto,
Transporter, Firma, Werkstatt, Garten, Lager) und eine Farbe; beim Anlegen schlägt die App das
Symbol aus dem Namen vor („Auto“ → Auto, „Betrieb“/„Firma“/„Arbeit“ → Firma, „Zuhause“/„Haus“ →
Haus) – ändern lässt es sich jederzeit. Gibt es nur einen Ort, nennt die App ihn nicht überall
dazu; ab zwei Orten steht er vor dem Raum („Auto · Kofferraum“).

**Zuhause** ist die Startseite: Begrüßung und „127 Dinge an 3 Orten“ (mit nur einem Ort:
„… in 8 Räumen“), darunter – ab zwei Orten – der **Orts-Umschalter** „Alle · Zuhause · Auto · +“.
Gibt es erst einen Ort, steht dort stattdessen ein leiser Knopf **Ort hinzufügen (z. B. Auto)**. Der Umschalter zeigt
zunächst alle Orte; ein Tipp auf einen Ort beschränkt die Seite darauf („12 Dinge in 3 Räumen“)
– die Glas-Linse gleitet wie in der Tab-Leiste hinüber, und die App merkt sich die Wahl bis zum
nächsten Mal. **+** legt einen neuen Ort an. Dann ein Suchfeld (führt in **Alles**, die KI-Suche
funktioniert dort wie gewohnt). Die Karte **Zu erledigen** erscheint nur, wenn etwas ansteht –
„N ohne Ort“ (öffnet **Ohne Ort**; zählt immer alle, solche Dinge gehören ja zu keinem Ort),
„N unbenannt“ (zeigt in **Alles** nur diese; der kleine Chip oben hebt den Filter wieder auf),
„N werden erkannt“ und „N warten auf API-Key“ (führt zum Key in den Einstellungen) – außer „ohne
Ort“ jeweils für den gewählten Ort. Dann **Zuletzt hinzugefügt** als Streifen zum Wischen und
die **Räume** als große Kacheln mit dem neuesten Foto des Raums: beim gewählten Ort die ersten
sechs, bei „Alle“ nach Ort gruppiert (Überschrift mit Symbol und **›** – antippen wählt den Ort) mit je bis
zu vier; gibt es mehr, führt **Alle** in den Tab **Räume**. Liegt etwas direkt an einem Ort ohne
Raum, steht vorneweg eine Kachel in der Farbe des Orts. Ist noch nichts erfasst, steht dort ein
großer Kamera-Knopf. Zuhause aktualisiert sich von selbst, sobald die KI etwas erkannt hat.

**Räume** (Tab) zeigt alle Räume nach Ort gruppiert: je Ort eine Überschrift mit Symbol und
**⋯**, darunter die Kachel für den Ort selbst (nur, wenn dort etwas ohne Raum liegt), die Räume
und die gestrichelte Kachel **Raum hinzufügen** (legt den Raum in diesem Ort an). Vorneweg in
Terrakotta **Ohne Ort**, solange es Einträge ganz ohne Ort gibt (öffnet das Zuordnen-Raster), am
Ende und oben rechts **Ort hinzufügen**. **⋯** an einer Orts-Überschrift (oder langes Drücken
darauf bzw. auf die Kachel des Orts) öffnet das Orts-Menü: **Hier fotografieren**, **Raum
hinzufügen**, **Umbenennen** (auf einen vorhandenen Namen: zusammenführen), **Symbol & Farbe**,
**Ort löschen**. Beim Löschen fragt die App, wohin Räume und Dinge sollen: in einen anderen Ort
(gleichnamige Räume werden dort zusammengeführt) oder **Ohne Ort** (die Räume werden aufgelöst,
die Dinge bleiben erhalten und stehen danach unter „Ohne Ort“). Verloren geht dabei nie etwas.
Langes Drücken auf eine Raumkachel öffnet wie auf Zuhause das Raum-Menü. Räume, deren Ort fehlt
(selten – etwa angelegt in einem noch offenen Tab der alten Version), stehen am Ende in einer
eigenen Gruppe **Ohne Ort** mit **Einem Ort zuordnen**.
Eine Kachel antippen öffnet den Raum: großer Titel (bei mehreren Orten mit dem Ort darüber), alle
Dinge darin nach Kategorie gruppiert und **Hier fotografieren** – das öffnet Hinzufügen mit Ort
und Raum schon eingetragen. Die Kachel eines Orts zeigt genauso, was dort direkt liegt. Über
**⋯** oben rechts: Hier fotografieren, Umbenennen, **In anderen Ort verschieben**, Raum löschen
(die Dinge bleiben – sie liegen danach direkt im Ort des Raums). Beim Verschieben wählt man den
Ziel-Ort (oder legt ihn gleich an); alles im Raum zieht mit. Gibt es dort schon einen Raum mit
demselben Namen, fragt die App, ob beide zusammengeführt werden sollen.

Die Titelfotos der Kacheln lädt die App in einer schärferen Fassung nach – aber nur für
Kacheln, die gerade zu sehen sind, und gibt sie wieder frei, sobald keine Kachel sie mehr zeigt.

**Gesten** – wie in anderen iPhone-Apps:
- **Zurückwischen:** in Eintrag, Raum, Ohne Ort und Archiv vom linken Bildschirmrand (unterhalb
  der Kopfzeile) nach rechts ziehen. Die Ansicht folgt dem Finger; ab gut einem Drittel oder mit
  Schwung geht es zurück. Beginnt der Finger auf einem Eingabefeld, passiert nichts.
- **Zurück** führt immer eine Ansicht zurück, auf dem Weg, den du gekommen bist; ein Tab in der
  Leiste beginnt dort neu. Eintrag → Kamera → Foto im Streifen → Zurück → **Fertig** endet also
  wieder dort, wo du angefangen hast, statt im Kreis zu laufen.
- **Zeile nach links wischen** (in **Alles** und im Raum): dahinter erscheint **Archiv**. Weit
  durchziehen archiviert sofort, halb aufziehen lässt den Knopf stehen. Unten erscheint 5 Sekunden
  lang **Rückgängig**; wischst du mehrere nacheinander weg, zählt der Hinweis mit („3 archiviert“),
  und Rückgängig holt alle zurück. Auch „Ins Archiv verschieben“ im Eintrag fragt nicht mehr nach,
  sondern bietet Rückgängig an.
- **Lange drücken** auf eine Zeile oder ein Bild in „Zuletzt hinzugefügt“: Menü mit **Ort ändern**
  (erst der Ort als Chips, dann der Raum darin – Vorschläge nur aus diesem Ort, ein Tipp übernimmt;
  leer lassen heißt „direkt am Ort“), **Umbenennen**, **Archivieren**. Auf einer Raumkachel: **Hier
  fotografieren**, **Umbenennen**, **Raum löschen**; auf einer Orts-Überschrift das Orts-Menü. Am
  Rechner geht das per Rechtsklick.
- Den Tab, in dem man schon ist, noch einmal antippen: springt nach oben.

Ansichten gleiten von rechts herein, Hinzufügen kommt von unten; bei „Bewegung reduzieren“ in
den iOS-Einstellungen springt alles ohne Animation.

**Aussehen und Bewegung (Liquid Glass, seit 1.6.0).** Die Bedienelemente schweben wie in iOS 26
als Glas über dem Inhalt: die Tab-Leiste als Kapsel mit etwas Abstand zum Rand, der Kamera-Knopf
als grüner Glastropfen, Aktionsblatt, Hinweise („Rückgängig“), der Update-Hinweis, die
Zuweisen-Leiste in **Ohne Ort** und die Knöpfe oben. Kopfzeilen sind zunächst klar und werden zu
Glas, sobald Inhalt darunter durchscrollt. Karten, Listen und Fotos bleiben bewusst solide, damit
alles gut lesbar ist.
- **Start:** Beim Öffnen fallen Bücher und ein Einmachglas federnd ins Glasregal, der Schriftzug
  „Inventar“ taucht auf, ein Lichtreflex wischt darüber, dann öffnet sich die Szene in die
  Startseite – meist ist die App nach gut einer Sekunde bedienbar, ein Tipp nach dem Laden
  überspringt den Rest. Kommt die App nur aus dem Hintergrund zurück, gibt es keine Szene. Hat iOS
  sie im Hintergrund beendet, blendet sie beim nächsten Öffnen in der Regel nur kurz über; je nach
  iOS-Version und wie lange sie beendet war, kann dann aber auch die volle Szene laufen. Sie hält
  den Start nicht auf: Die App lädt währenddessen im Hintergrund, und dauert schon das Laden lange,
  wird nur noch übergeblendet. Solange die Szene steht, springt die Tab-Taste (Tastatur,
  Schaltersteuerung) nicht unsichtbar in die App dahinter.
- **Tab-Leiste:** Die Markierung des aktiven Tabs ist eine Glas-Linse, die beim Wechsel federnd
  hinübergleitet. Beim Runterscrollen wird die Leiste etwas kleiner, beim Hochscrollen oder
  Anhalten wieder groß.
- **Knöpfe aus Glas** (Tabs, Kamera-Knopf, Knöpfe oben, „Rückgängig“, „Abbrechen“ im Blatt)
  quellen beim Drücken leicht auf, ein Glanzlicht folgt dem Finger, solange er auf dem Knopf
  bleibt.
- **Aktionsblatt** (langes Drücken, ⋯) wächst aus der Zeile oder dem Knopf heraus und schrumpft beim
  Schließen dorthin zurück; **Hinzufügen** quillt als Tropfen aus dem Kamera-Knopf. Hinweise fließen
  als Glas-Kapsel herein, **Archiv** hinter einer weggewischten Zeile ist ein Glastropfen.
- **„Bewegung reduzieren“** (Einstellungen → Bedienungshilfen → Bewegung): keine Start-Szene
  (nur kurzes Überblenden), keine Federn, nichts quillt oder gleitet.
- **„Transparenz reduzieren“** bzw. **„Kontrast erhöhen“** (Bedienungshilfen → Anzeige & Textgröße):
  alle Glasflächen werden solide, getönte Flächen ohne Unschärfe. Ob Safari „Transparenz
  reduzieren“ an Web-Apps weitergibt, hängt von der iOS-Version ab – „Kontrast erhöhen“ wirkt
  in jedem Fall. Browser ohne Unschärfe-Effekt bekommen ebenfalls solide Flächen.

Glas mit Unschärfe ist für das iPhone rechenintensiv; deshalb liegt es nur auf den wenigen
schwebenden Elementen (höchstens etwa fünf gleichzeitig), nie auf Listenzeilen; Orts-Umschalter und
Orts-Chips sind nur getöntes Glas ohne Unschärfe. Echte
Lichtbrechung an den Glaskanten gibt es nur in Chrome-basierten Browsern – Safari kann das für
Web-Apps nicht, dort bleibt es bei Unschärfe, Tönung und Lichtkante. Beim Speichern eines Fotos, beim Zuweisen,
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

**Ohne Foto eintragen** – aufklappbar unter den Foto-Knöpfen: Name, Kategorie, Speichern.
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
wenn nichts passt. Unter Einstellungen lassen sich alle drei umbenennen und löschen (Räume nach
Ort gruppiert, neue Räume mit Wahl des Orts; bei Orten führt ein Tipp auf das Symbol zu Symbol &
Farbe); benennst du auf einen bereits vorhandenen Namen um, werden sie zusammengeführt – bei
Räumen nur innerhalb desselben Orts.

**Bestand** ist ein freies Feld: „3“, „genug“, „halb voll“ – wie du magst.
Die Schnellauswahl darunter füllt es nur aus.

**Fotos ansehen** – ein Tipp auf das Vorschaubild in der Liste öffnet das Original
formatfüllend, ohne den Eintrag zu öffnen; ein Tipp auf den Text daneben öffnet wie gewohnt
den Eintrag. In der Detail-Ansicht öffnet ein Tipp auf das Bild dasselbe Vollbild. Dort noch einmal antippen zoomt auf die Originalgröße und man kann im
Bild herumschieben; das × oben rechts oder ein Tipp neben das Bild schließt wieder.

**Alles** (früher „Liste“) zeigt Vorschaubild, Name, Bestand, Ort und Raum („Auto · Kofferraum“ mit
dem Symbol des Orts) sowie Datum und Uhrzeit. Die Suche geht über Name, Kategorie, Ort, Raum,
genauen Platz, Bestand und Notiz – „auto“ findet also alles im Auto. Dazu kommen Filter nach Ort
(ab zwei Orten), Kategorie und Raum; ist ein Ort gewählt, bietet der Raum-Filter nur dessen Räume
an.

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

**Archiv** – gelöschte Einträge landen zuerst dort und bleiben wiederherstellbar.
Erst **Endgültig löschen** entfernt Eintrag und Foto unwiderruflich.
Zu erreichen über Einstellungen → Archiv öffnen.

---

## 4. Sicherung, Übertragung, Datenverlust

### Sichern

**Einstellungen → Sicherung → Sicherung erstellen**, danach **Sichern / Teilen**. Auf dem
iPhone öffnet sich das Teilen-Fenster: „In Dateien sichern“, per AirDrop an ein anderes
Gerät oder als Mail an die Familie. Am Rechner lädt die Datei herunter.

Enthalten sind alle Einträge, Kategorien, Orte, Räume, das Archiv und die Fotos.
**Der API-Key wird bewusst nicht mitgesichert** – sonst läge er in einer Datei, die du
per Mail verschickst. Ihn trägst du auf dem neuen Gerät einmal von Hand ein.

Der Haken „Fotos mitsichern“ lässt sich abschalten. Die Datei wird dann sehr klein, die
Vorschaubilder in der Liste bleiben trotzdem erhalten – nur die Originale fehlen.

### Einlesen

**Sicherung einlesen**, Datei wählen. Die App zeigt erst, was drinsteht, dann hast du
zwei Möglichkeiten:

- **Hinzufügen, Vorhandenes behalten** – für den Abgleich zwischen zwei Geräten.
  Einträge, die es schon gibt, werden übersprungen; gleichnamige Kategorien und Orte werden
  zusammengeführt statt doppelt angelegt, Räume nach Ort und Name („Keller“ in Zuhause und
  „Keller“ in Haus 2 bleiben zwei Räume).
- **Alles ersetzen** – löscht den aktuellen Stand und stellt die Datei her.
  Für den Umzug auf ein neues Gerät oder nach einem Datenverlust.

Mehrfaches Einlesen derselben Datei erzeugt keine Dubletten. Geschrieben wird in einer einzigen
Transaktion – scheitert etwas, bleibt der alte Stand vollständig erhalten.

**Format.** Die Datei ist JSON (`"app": "heim-inventar"`). Seit 1.7.0 ist es **Version 2**: dazu
kommt die Liste `places` (Orte mit Name, Symbol, Farbe, Reihenfolge), Räume tragen `placeId`,
Einträge ebenfalls (bei einem Raum gleich dem Ort des Raums, sonst der Ort, an dem sie direkt
liegen, oder leer für „ohne Ort“). **Ältere Sicherungen (Version 1, ohne Orte) lassen sich weiter
einlesen:** Alle Räume kommen dann nach „Zuhause“ (vorhanden – sonst in den ersten Ort, falls es
„Zuhause“ unter anderem Namen gibt –, erst sonst neu angelegt), Einträge in einem
Raum mit; Einträge ohne Raum stehen danach unter „Ohne Ort“, wie vorher unter „Ohne Raum“. Eine
Sicherung aus 1.7.0 lässt sich in älteren Fassungen **nicht** einlesen („stammt aus einer neueren
Version“). Symbole und Farben aus der Datei werden nur aus den festen Listen der App übernommen.

### Update auf 1.7.0 (Orte)

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

- **Duplikat-Erkennung**: ähnelt ein neues Foto einem vorhandenen Eintrag, beide Bilder
  nebeneinander zeigen und „Menge erhöhen“ oder „Neu anlegen“ anbieten.

---

## 5. Aufbau

```
index.html              alle Ansichten, die SVG-Symbole (Sprite ganz oben im <body>), Start-Szene,
                        Startbild-Links und der Start-Wächter (Dateiliste bei neuen js-Dateien ergänzen!)
manifest.webmanifest    Name, Icons, Vollbildmodus
sw.js                   Service Worker – App offline verfügbar (VERSION hochzählen – passend
                        zu APP_VERSION in js/app.js und <meta name="app-version"> in index.html!)
css/app.css             Gestaltung, hell und dunkel – Farben, Radien, Schatten als Variablen oben,
                        das Glas-System (--glass-*, --lite-*) und die Start-Szene im letzten Abschnitt
js/app.js               Ansichten, Navigation, Bedienung, Abläufe
js/home.js              Startseite „Zuhause“ (mit Orts-Umschalter), Tab „Räume“ (nach Ort gruppiert) und
                        Raum-/Orts-Ansicht (inkl. scharfer Titelbilder)
js/places.js            Orte: Symbole, Farben, Symbol-Vorschlag aus dem Namen, Raumvorschläge je Art,
                        Chips und Plaketten (ohne Datenbank)
js/ui.js                gemeinsame Darstellungs-Helfer (Escapen, Symbole, Platzhalter)
js/motion.js            Übergänge zwischen den Ansichten (nur transform/opacity) und die Federn
js/glass.js             Liquid Glass: Tab-Linse (und Linse im Orts-Umschalter), schrumpfende Leiste, Glas-Kopfzeilen, Aufquellen,
                        Kamera-Tropfen, Herkunft für wachsende Aktionsblätter
js/intro.js             Start-Szene „Glasregal“ (nur beim echten Start)
js/gestures.js          Zurückwischen, Zeile wegwischen, langes Drücken, Haptik
js/sheet.js             Aktionsblatt von unten (Kontextmenü, kleine Eingaben)
js/onboarding.js        Einführung beim ersten Start
js/db.js                IndexedDB (Version 2): Einträge, Fotos, Kategorien, Orte, Räume, Einstellungen;
                        Umstellung auf Orte (migratePlaces), Verschieben an Ort + Raum, Ort löschen
js/img.js               Bilder dekodieren, drehen, verkleinern, kodieren
js/gemini.js            Aufrufe an die Gemini-API
js/queue.js             KI-Warteschlange: erkennt erfasste Fotos im Hintergrund
js/combo.js             Vorschlagsliste für Kategorie und Raum (Räume nur aus dem gewählten Ort)
js/backup.js            Export und Import der Sicherungsdatei
icons/                  App-Icons
icons/splash/           iOS-Startbilder, hell und dunkel (bewusst nicht im Service-Worker-Cache)
tools/splash.js         erzeugt die Startbilder aus der Start-Szene in index.html (Playwright;
                        gehört nicht zur App) – nach Änderungen an der Szene neu ausführen
tools/icon.svg          Vorlage des App-Symbols (Glasregal mit Büchern und Einmachglas)
tools/icon.js           erzeugt daraus die PNGs in icons/ (Playwright; gehört nicht zur App)
```

Fotos werden beim Speichern auf max. 1600 px verkleinert (in den Einstellungen
umstellbar) und als JPEG abgelegt; zusätzlich entsteht ein 160-px-Vorschaubild für die
Liste. An Gemini geht eine 768-px-Fassung, bei der Bilderkennung mit abgeschaltetem bzw.
reduziertem „Denken“ des Modells – das macht sie deutlich schneller. Teilen sich mehrere Einträge ein Foto, wird
es erst gelöscht, wenn der letzte davon endgültig entfernt wurde.
