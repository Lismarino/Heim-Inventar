# Google-Drive-Sicherung einrichten

Heim-Inventar kann sich automatisch in dein Google Drive sichern – **verschlüsselt**, bevor
irgendetwas dein iPhone verlässt. Dafür braucht die App einmalig eine eigene „Client-ID“ von
Google. Die legst du selbst an; das dauert etwa 10 Minuten und kostet nichts.

> **Warum so umständlich?** Heim-Inventar hat keinen Server und kein Konto. Damit die App direkt
> mit *deinem* Google Drive sprechen darf, muss Google wissen, welche Web-Adresse das ist. Das
> regelst du in deinem eigenen Google-Cloud-Projekt – niemand sonst hat Zugriff darauf.

Du brauchst: ein Google-Konto und einen Computer oder ein iPad (die Google Cloud Console ist auf
dem iPhone mühsam, geht aber auch).

---

## 1. Projekt anlegen

1. Öffne **https://console.cloud.google.com** und melde dich mit deinem Google-Konto an.
   Beim ersten Mal: Land wählen, Nutzungsbedingungen bestätigen.
2. Oben links neben „Google Cloud“ auf die **Projektauswahl** tippen → **Neues Projekt**.
3. Name z. B. `Heim-Inventar` → **Erstellen**. Warten, bis es fertig ist, und dann oben
   sicherstellen, dass **dieses Projekt ausgewählt** ist.

## 2. Google-Drive-API einschalten

1. Links im Menü (☰) **APIs & Dienste → Bibliothek**.
2. Nach **Google Drive API** suchen, antippen → **Aktivieren**.

## 3. Zustimmungsbildschirm („OAuth consent screen“)

Das ist das Fenster, das Google beim Anmelden zeigt.

1. Links **APIs & Dienste → OAuth-Zustimmungsbildschirm** (in neueren Oberflächen heißt der
   Bereich **Google Auth Platform → Branding / Zielgruppe**). Auf **Los gehts** bzw. **Konfigurieren**.
2. **App-Name**: `Heim-Inventar`. **Nutzersupport-E-Mail**: deine Adresse.
3. **Zielgruppe / Nutzertyp**: **Extern** wählen.
4. **Kontaktdaten des Entwicklers**: deine Adresse. Speichern.
5. Bei **Zielgruppe** (bzw. **Testnutzer**): **+ Nutzer hinzufügen** → **deine eigene
   Gmail-Adresse** eintragen → Speichern. Nur eingetragene Testnutzer können sich anmelden –
   genau so soll es sein.
6. Den **Veröffentlichungsstatus** auf „Test“ lassen. (Hinweis: Im Test-Modus kann Google die
   Freigabe nach einigen Tagen verfallen lassen; die App fragt dann einfach wieder nach der
   Anmeldung – „Google-Sicherung: einmal tippen zum Fortsetzen“.)

Berechtigungen („Scopes“) musst du hier nicht eintragen – die App fragt beim Anmelden selbst nach
genau einer: `drive.appdata` („Eigene Konfigurationsdaten in Google Drive ansehen und verwalten“).

## 4. Client-ID erstellen

1. Links **APIs & Dienste → Anmeldedaten** (bzw. **Google Auth Platform → Clients**).
2. **+ Anmeldedaten erstellen → OAuth-Client-ID** (bzw. **+ Client erstellen**).
3. **Anwendungstyp: Webanwendung**. Name z. B. `Heim-Inventar iPhone`.
4. Unter **Autorisierte JavaScript-Quellen** auf **+ URI hinzufügen** und genau das eintragen:

   ```
   https://lismarino.github.io
   ```

   (ohne Schrägstrich am Ende und ohne `/Heim-Inventar` – es geht nur um den „Ursprung“).
   **Autorisierte Weiterleitungs-URIs** bleiben leer.
5. **Erstellen**. Es erscheint die **Client-ID**, etwa
   `123456789012-abc123def456.apps.googleusercontent.com`. **Kopieren.**
   Ein „Clientschlüssel“ (Secret) wird nicht gebraucht – nirgends eintragen.

Die Client-ID ist kein Geheimnis im engeren Sinn; sie funktioniert nur zusammen mit der Adresse
oben und nur für die eingetragenen Testnutzer.

## 5. In der App eintragen

1. Heim-Inventar öffnen → **Einstellungen → Google Drive (verschlüsselt)**.
2. Die Client-ID ins Feld **OAuth-Client-ID** einfügen.
3. **Verbinden & einrichten** antippen.
4. Ein **Passwort** festlegen (mindestens 8 Zeichen, zweimal eingeben). Mit „Auf diesem Gerät
   merken“ musst du es auf diesem iPhone nicht jedes Mal neu eingeben.
5. **Mit Google verbinden** → Google-Fenster: Konto wählen → Zugriff erlauben.
6. Fertig – die erste Sicherung läuft sofort. Danach sichert die App beim Start und etwa
   30 Sekunden nach jeder Änderung. Auf Zuhause steht z. B. „In Google Drive gesichert vor 2 Min.“.

### Die Warnung „Google hat diese App nicht überprüft“

Weil das Projekt dir gehört und nicht von Google geprüft wurde, zeigt Google beim ersten
Anmelden diese Warnung. Das ist bei selbst angelegten Projekten normal:
**Erweitert** (bzw. „Advanced“) → **Weiter zu Heim-Inventar (unsicher)** → Zugriff erlauben.
Eine Prüfung durch Google ist für den eigenen Gebrauch nicht nötig.

---

## Das Passwort – bitte lesen

- **Alles wird mit deinem Passwort verschlüsselt, bevor es das Gerät verlässt**
  (PBKDF2-SHA-256 mit 310 000 Runden → AES-GCM-256). Google sieht weder Inhalte noch Dateinamen
  – im Drive liegen nur Dateien mit zufälligen Namen und unlesbarem Inhalt.
- **Passwort vergessen = Sicherung unbrauchbar.** Niemand – auch Google nicht – kann sie ohne
  das Passwort öffnen. Schreib es an einen sicheren Ort (z. B. Passwort-Manager).
- „Auf diesem Gerät merken“ speichert **nicht das Passwort**, sondern nur einen daraus
  abgeleiteten Schlüssel, der sich technisch nicht auslesen lässt.
- Auf einem weiteren Gerät musst du **dasselbe Passwort** verwenden.

## Wiederherstellen (neues iPhone, App neu installiert)

1. App öffnen → Einstellungen → **Google Drive (verschlüsselt)** → Client-ID eintragen.
2. **Aus Google Drive wiederherstellen** → bestätigen → Passwort → mit Google anmelden.
3. Die App lädt alles, entschlüsselt es und ersetzt den Bestand auf dem Gerät (in einem Schritt
   – bricht etwas ab, bleibt der alte Stand). Danach sichert sie automatisch weiter.

**Ein Gerät sichert.** Die Google-Sicherung spiegelt den Stand *eines* Geräts. Ein neues Gerät
übernimmt sie per „Wiederherstellen“ und sichert dann weiter – auf dem alten Gerät die
Google-Sicherung danach ausschalten. Ein leeres Gerät überschreibt eine vorhandene Sicherung nie:
Die App hält dann an und rät zum Wiederherstellen.

## Wo liegt die Sicherung, und wie lösche ich sie?

Im **App-Datenordner** deines Drive – er ist in drive.google.com nicht als Ordner sichtbar, und
keine andere App kommt daran (umgekehrt sieht Heim-Inventar nichts von deinen übrigen Dateien).
Das ist der Grund für `drive.appdata` statt `drive.file`: nichts kann versehentlich verschoben,
umbenannt oder von anderen Apps gelesen werden.

Löschen: drive.google.com → Zahnrad → **Einstellungen → Apps verwalten** → Heim-Inventar →
**Optionen → Versteckte App-Daten löschen**. Zugriff entziehen: **myaccount.google.com →
Sicherheit → Drittanbieter-Apps mit Kontozugriff**.

## Probleme?

| Meldung | Was tun |
| --- | --- |
| „Google-Sicherung: einmal tippen zum Fortsetzen“ | Die Anmeldung (gilt etwa 1 Stunde) ließ sich nicht still erneuern. Einmal auf die Zeile tippen. |
| „Passwort eingeben zum Fortsetzen“ | Das Passwort war nicht gemerkt – antippen und eingeben. |
| „…gehört zu einem anderen Passwort“ | In Drive liegt eine Sicherung mit anderem Passwort. Es wurde nichts überschrieben. Ausschalten und mit dem alten Passwort neu einrichten. |
| „redirect_uri_mismatch“ / „origin_mismatch“ | Die JavaScript-Quelle in Schritt 4 stimmt nicht genau: `https://lismarino.github.io`. |
| „access_denied“ | Deine Adresse fehlt bei den Testnutzern (Schritt 3.5). |
| Anmeldefenster geht nicht auf | Auf dem iPhone öffnet es nur direkt nach einem Tipp – den Knopf noch einmal antippen. |

**iCloud und Proton Drive** haben keine Schnittstelle, die eine Web-App nutzen könnte. Für sie
bleibt die Datei-Sicherung: Einstellungen → Sicherung → erstellen → „In Dateien sichern“ →
iCloud Drive bzw. Proton Drive (optional mit Passwort verschlüsselt).
