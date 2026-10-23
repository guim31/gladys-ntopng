# ntopng

[ntopng](https://www.ntop.org/products/traffic-analysis/ntop/) beobachtet den
Verkehr einer Netzwerkschnittstelle (ein Mirror-Port, die LAN-Seite eines
Routers, ein Heimserver) und zeigt, wer mit wem spricht, wie viel und was
verdächtig aussieht. Diese Integration bringt es in Gladys: ein Gerät pro von
ntopng überwachter Schnittstelle, mit Empfangs- und Senderate, aktiven Hosts und
Flows sowie ihren Alarmen. Szenen können auf einen neuen ntopng-Alarm, auf einen
noch nie gesehenen lokalen Host oder auf einen Durchsatz über einem Schwellwert
reagieren, und ein Dashboard-Widget zeigt Verkehr und Alarme auf einen Blick.
Alles bleibt in deinem lokalen Netzwerk.

Getestet mit einem echten ntopng 7.0 Community (Docker), mit Verkehr und einem
Portscan zwischen Testcontainern. Noch nicht in einem echten Heimnetz:
Rückmeldungen sind willkommen in
[den Issues](https://github.com/guim31/gladys-ntopng/issues).

## Was du brauchst

- Gladys Assistant 5.1.0 oder neuer.
- ntopng 6 oder 7 (die kostenlose **Community**-Edition genügt), vom
  Gladys-Rechner aus erreichbar (standardmäßig Port 3000).
- Einen ntopng-Benutzer, der die Alarme lesen darf (ein Administrator oder ein
  Benutzer mit dem Recht „Alarme“), und am besten sein API-Token.

Die Integration liest nur und ändert nie etwas in ntopng.

## Erste Schritte

### 1. Ein API-Token holen

Öffne ntopng im Browser (`http://<rechner>:3000`). Bei einer neuen Installation
verlangt ntopng zuerst, das Standardpasswort von `admin` zu ändern: Tu das, die
API bleibt bis dahin zu. Öffne dann das Benutzermenü (oben rechts) → deinen
Benutzernamen → den Token-Tab → **Generate** und kopiere das Token.

### 2. Die Integration konfigurieren

In Gladys **Integrationen → ntopng → Konfiguration**:

- **ntopng-Adresse**: `192.168.1.20`, `ntop.lan` oder die Adresse aus deinem
  Browser, etwa `https://ntop.lan:3001` (Port 3000, wenn keiner angegeben ist).
- **API-Token**: das Token aus Schritt 1. Ohne Token fülle **Benutzer (ohne Token)** und **Passwort (ohne Token)** aus.
- **Aktualisierungsintervall**: standardmäßig 1 Minute (30 Sekunden bis
  5 Minuten).
- **Durchsatz-Schwellwert (Mbit/s)**: nur für den Auslöser „Durchsatz über dem
  Schwellwert“; sonst leer lassen.
- **Selbstsignierte Zertifikate akzeptieren**: nur für eine `https://`-Adresse,
  denn das mit ntopng gelieferte Zertifikat ist selbstsigniert.
- **Sprache der Namen**: die Sprache der Funktionsnamen und der Szenentexte.

Klicke dann auf **Verbindung testen**: Es nennt die Version von ntopng, die
Schnittstellen, die aktiven Hosts und die aktiven Alarme.

### 3. Die Schnittstellen hinzufügen

Füge im Tab **Entdecken** die Schnittstellen hinzu, denen du folgen willst. Nur
die hinzugefügten Schnittstellen erhalten Werte; die Szenen-Auslöser
funktionieren für alle.

## Die Geräte

Ein Gerät pro Schnittstelle, genannt `ntopng <schnittstelle>`:

| Funktion             | Was sie zeigt                                                 |
| -------------------- | ------------------------------------------------------------- |
| Erreichbar           | ntopng antwortet und überwacht die Schnittstelle noch         |
| Empfang              | empfangener Verkehr in Mbit/s                                 |
| Senden               | gesendeter Verkehr in Mbit/s                                  |
| Aktive Hosts         | gerade auf der Schnittstelle gesehene Hosts                   |
| Lokale Hosts         | die davon in deinen lokalen Netzen                            |
| Aktive Flows         | gerade verfolgte Verbindungen                                 |
| Aktive Alarme        | Alarme, die ntopng zu Hosts oder zur Schnittstelle offen hält |
| Flows mit Alarm      | aktive Flows mit einem Alarm (ein Portscan erzeugt Tausende)  |
| Höchster Schweregrad | der schlimmste davon: Keiner, Hinweis, Warnung oder Fehler    |

Raten und Flows werden höchstens einmal pro Minute gesendet, die anderen Werte,
wenn sie sich ändern.

## Dashboard

Das Widget **ntopng-Verkehr** zeigt für eine Schnittstelle (die in seinen
Einstellungen gewählte oder die einzige) Empfang, Senden, Hosts, Flows und
aktive Alarme, dann die Liste der Alarme: zuerst die aktiven, die schwersten
oben, dann die Flow-Alarme der letzten 24 Stunden mit ihrer Anzahl. Bei mehreren
Schnittstellen und keiner gewählten zeigt es die Summen und eine Zeile pro
Schnittstelle. Die Schaltfläche **Aktualisieren** liest ntopng neu.

## Szenen

### Auslöser

- **Neuer ntopng-Alarm**: ntopng meldet einen Alarm zu einem Host, einem Flow
  oder einer Schnittstelle. Filter: Schnittstelle, Schweregrad, Alarmtyp (der
  englische Name, den ntopng zeigt, etwa `Probing Attempt`), IP-Adresse des
  Hosts. Variablen: Schnittstelle, Alarmtyp, Schweregrad, ausgelöst bei,
  IP-Adresse und Name des Hosts, Beschreibung, Vorkommen. Ein Portscan schreibt
  einen Flow-Alarm pro Probe: Diese werden nach Typ und Host gruppiert, und
  derselbe Alarm löst höchstens einmal pro Stunde aus.
- **Neuer lokaler Host**: ntopng sieht einen noch nie gesehenen lokalen Host,
  nach seiner MAC-Adresse (sonst seiner IP-Adresse). Variablen: Schnittstelle,
  IP-Adresse, MAC-Adresse, Hostname. Die beim Start der Integration bekannten
  Hosts werden nicht gemeldet.
- **Durchsatz über dem Schwellwert**: Empfang plus Senden einer Schnittstelle
  steigt zwei Lesungen hintereinander über den Schwellwert der Konfiguration
  oder fällt wieder unter 90 % davon. Filter: die Änderung. Variablen: Empfang,
  Senden, Gesamt und Schwellwert in Mbit/s.

Um die Anwesenheit deiner Geräte zu verfolgen, macht es [NetAlertX](https://github.com/guim31/gladys-netalertx)
besser (Scans, Anwesenheit pro Gerät); ntopng sieht nur die Hosts, die Verkehr
über die überwachte Schnittstelle schicken.

### Aktionen

- **Zustand einer ntopng-Schnittstelle**: liest eine Schnittstelle für die
  nächsten Aktionen: Empfang, Senden, Hosts, Flows, Alarme, höchster
  Schweregrad und eine fertige Zusammenfassung wie `eth0: Empfang 12,3 Mbit/s,
Senden 1,5 Mbit/s, 24 Host(s), 310 Flow(s), kein Alarm`.
- **Letzte ntopng-Alarme**: die aktiven Alarme und die Flow-Alarme der letzten
  24 Stunden, für eine oder alle Schnittstellen, mit ihrer Anzahl und einer
  Zusammenfassung.

### Szenenideen

- **Neuer ntopng-Alarm**, Schweregrad **Fehler** → die Nachricht
  `{{triggerEvent.data.alert_type}} auf {{triggerEvent.data.host}} ({{triggerEvent.data.count}}-mal)` senden.
- **Neuer lokaler Host** → `Neues Gerät: {{triggerEvent.data.host_name}} {{triggerEvent.data.ip}} {{triggerEvent.data.mac}}` senden.
- **Durchsatz über dem Schwellwert** nachts → die Backups pausieren und bei
  „Wieder darunter“ fortsetzen.
- Jeden Abend um 21 Uhr → **Letzte ntopng-Alarme** → wenn die Anzahl über 0
  liegt, die Zusammenfassung senden.

## Fehlerbehebung

- **„antwortet nicht“**: Prüfe Adresse und Port im Browser; eine Firewall kann
  Port 3000 sperren.
- **„melde dich einmal bei ntopng an und ändere das Standard-Admin-Passwort“**:
  ntopng leitet jede Anfrage auf die Passwortseite um, bis das Passwort von
  `admin` geändert ist.
- **„API-Token oder Passwort abgelehnt“**: Erzeuge ein neues Token oder prüfe
  Benutzer und Passwort.
- **„dieser ntopng-Benutzer darf die Alarme nicht lesen“**: Die Werte kommen
  trotzdem, aber kein Alarm-Ereignis: Gib dem Benutzer das Recht „Alarme“ oder
  nimm einen Administrator.
- **„die Adresse leitet um“**: ntopng liefert nur HTTPS: Gib die
  `https://`-Adresse ein (standardmäßig Port 3001).
- **ntopng meldet „Clear-Text Credentials“ für Gladys**: Mit Benutzer und
  Passwort über HTTP sieht ntopng das Passwort im Klartext im überwachten Netz.
  Nimm ein API-Token oder HTTPS.
- **ntopng in Docker zeigt fast nichts**: Es überwacht seinen eigenen
  Container; starte es mit `--network host` (auf dem Rechner, der den Verkehr
  sieht) oder an einem Mirror-Port.
- Mehr Details mit der Umgebungsvariable `LOG_LEVEL=debug` an der Integration.

## Grenzen

- Eine ntopng-Instanz, höchstens 8 Schnittstellen.
- Gelesen werden die aktiven Alarme (Hosts, Schnittstelle) und die Flow-Alarme;
  die anderen Alarmfamilien von ntopng (Netze, System, SNMP der
  Enterprise-Edition) nicht.
- Die Flow-Alarm-Ereignisse brauchen die SQLite-Ablage der Community- und
  Pro-Editionen; mit ClickHouse (Enterprise) sind sie aus.
- Für die Community-Edition gebaut: Funktionen der kostenpflichtigen Editionen
  (Verkehrsrichtlinien, SNMP, nProbe) werden nicht gelesen.
- Die Integration liest bei jeder Aktualisierung die aktuellen Werte und
  importiert nicht den Verlauf von ntopng.
- Nicht mit ntop verbunden.
