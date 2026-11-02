# Familiengarage

Ein gemeinsamer, passwortgeschützter Kalender für **BMW 320d**, **Nissan Townstar** und **Dethleffs Just 90**. Die HTML/JavaScript-SPA läuft ohne Build-Schritt auf GitHub Pages. Nach der Anmeldung werden Änderungen über Supabase alle fünf Sekunden abgeglichen, solange der Tab sichtbar ist.

Die eigene Adresse ist [autos.wilkezimmermann.de](https://autos.wilkezimmermann.de/). Die Subdomain verweist per CNAME auf `wilke08.github.io`; die Zuordnung zur Familiengarage ist in GitHub Pages hinterlegt. HTTPS wird von GitHub bereitgestellt. Die Hauptdomain und andere Subdomains werden dafür nicht geändert.

## Bereit zur Veröffentlichung

`config.js` enthält die öffentliche Supabase-Projektkonfiguration. Vor der Veröffentlichung müssen das aktuelle `schema.sql` und die separate Passwort-Einrichtung in Supabase ausgeführt werden. Die Website bleibt bis zur erfolgreichen serverseitigen Anmeldung gesperrt.

## Funktionsumfang

- Monats- und Wochenkalender mit Fahrzeugfarben
- Buchungen für Wilke, Wolfgang und Anja, inklusive ganztägiger Reservierungen
- Filter nach Fahrzeug oder Person
- Prüfung von Überschneidungen im Browser **und** als PostgreSQL-Datenbankregel
- Erstellen, Laden und Löschen mit automatischer Aktualisierung alle fünf Sekunden
- Deutscher Kalender- und Uhrzeitwähler für jede Reservierung (24 Stunden)
- Kompakte, lesbare Buchungskarten auf kleinen Smartphone-Bildschirmen
- Gemeinsames Familienpasswort mit serverseitiger Prüfung und Abmeldung
- Kein ungeschützter lokaler Ersatzmodus bei Verbindungsproblemen

## Supabase einmalig einrichten

1. Erstelle auf [supabase.com](https://supabase.com) ein kostenloses Projekt.
2. Öffne den **SQL Editor** und führe [`schema.sql`](./schema.sql) als `postgres` aus. Es erstellt die Tabelle und geschützte Datenbankfunktionen, entfernt frühere öffentliche Tabellenfreigaben und verhindert Doppelbuchungen. Vorhandene Reservierungen bleiben erhalten.
3. Öffne **Project Settings → API**. Kopiere die **Project URL** und den öffentlichen Schlüssel **anon / publishable**.
4. Trage beides in [`config.js`](./config.js) ein:

   ```js
   window.FAMILY_GARAGE_CONFIG = Object.freeze({
     SUPABASE_URL: "https://dein-projekt.supabase.co",
     SUPABASE_ANON_KEY: "dein-oeffentlicher-anon-key",
   });
   ```

   Verwende ausdrücklich niemals den `service_role`-Schlüssel in einer Website oder in Git.
5. Setze das gemeinsame Passwort separat im SQL Editor als `postgres` mit `select private.set_family_password('DEIN_GEHEIMES_PASSWORT');`. Ersetze den Beispielwert ausschließlich dort. Speichere diesen Aufruf niemals im Repository oder in öffentlich veröffentlichten Dateien.
6. Veröffentliche die Website und prüfe Anmeldung, Abmeldung und den abgewiesenen Zugriff ohne Sitzung.

### Zugriffsschutz

Die Datenbank speichert ausschließlich einen gesalzenen bcrypt-Passworthash in einem privaten Schema. Weder Passwort noch Passwort-Hash werden an die Website ausgeliefert. Der öffentliche Supabase-Schlüssel allein erlaubt keinen Tabellenzugriff. Jede Funktion zum Lesen, Anlegen oder Löschen prüft eine zufällige 256-Bit-Sitzung, deren Hash serverseitig gespeichert wird. Sitzungen laufen nach zwölf Stunden ab und werden beim Abmelden serverseitig widerrufen. Im Browser wird nur der Sitzungsschlüssel im Tab-Speicher gehalten; Reservierungen werden nicht im lokalen Browser-Speicher abgelegt.

Nach fünf fehlgeschlagenen Versuchen wird die gemeinsame Anmeldung für 15 Minuten gesperrt. Das Limit gilt serverseitig und lässt sich durch einen neuen Tab oder parallele Aufrufe nicht zurücksetzen. Weil alle dasselbe Passwort nutzen, betrifft eine Sperre alle neuen Anmeldungen; bestehende Sitzungen bleiben nutzbar. Ein kurzer vierstelliger Code bietet trotz dieser Begrenzung weniger Schutz als ein längeres Passwort. Passwortänderungen über `private.set_family_password(...)` widerrufen alle Sitzungen.

Die Reservierungstabelle wird nicht über öffentliche Realtime-Ereignisse ausgeliefert. Stattdessen verwenden Clients die geschützten Funktionen zum regelmäßigen Abgleich. Die statischen Website-Dateien sind öffentlich; geschützt sind die Buchungen. Verwende HTTPS und veröffentliche niemals einen Service-Role-Schlüssel.

## GitHub Pages bereitstellen

1. Lege ein neues GitHub-Repository an und lade alle Projektdateien hoch. `config.js` muss die Supabase-Werte enthalten, damit die veröffentlichte SPA synchronisiert arbeitet. Der Anon-Key ist für Browser-Anwendungen vorgesehen; der Service-Role-Key darf niemals verwendet werden.
2. Gehe im Repository zu **Settings → Pages** und wähle bei **Build and deployment** die Quelle **GitHub Actions**.
3. Jeder Push auf den Branch `main` oder `master` startet den Workflow in [`.github/workflows/deploy.yml`](./.github/workflows/deploy.yml). Nach dessen Abschluss steht die Adresse in der Workflow-Zusammenfassung und in den Pages-Einstellungen.

Die Anwendung verwendet CDN-Versionen von Tailwind CSS, FullCalendar und dem Supabase-JavaScript-Client. Deshalb ist kein `npm install` und kein lokaler Build-Schritt erforderlich.

Vor jeder Pages-Veröffentlichung führt der Workflow Syntax-, Anmelde- und Kernlogikprüfungen aus. Lokal kann derselbe Durchlauf mit `node --test tests/*.test.js` gestartet werden. Diese automatischen Tests ersetzen nicht den abschließenden Test der Berechtigungen in der echten Supabase-Instanz.

## Lokaler Test

Für einen lokalen Test öffne die Seite über einen kleinen Webserver, nicht per Doppelklick auf `index.html`: Moderne Browser behandeln direkt geöffnete Dateien als `file://`-Ursprung und können JavaScript-Abhängigkeiten blockieren. Mit installiertem Node.js funktioniert beispielsweise:

```powershell
npx serve .
```

Öffne anschließend die angezeigte `http://localhost`-Adresse. Auch lokal ist die serverseitige Anmeldung erforderlich. Ohne gültige Konfiguration werden keine Buchungen geladen.
