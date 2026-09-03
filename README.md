# Familiengarage

Ein gemeinsamer, mobilfreundlicher Kalender für die Fahrzeuge **BMW 320d**, **Nissan Townstar** und **Dethleffs Just 90**. Die Anwendung ist eine reine HTML/JavaScript-SPA und kann ohne Build-Schritt auf GitHub Pages laufen. Mit Supabase sehen alle drei Familienmitglieder Änderungen unmittelbar auf ihren Geräten.

## Bereit zur Veröffentlichung

Diese Auslieferung ist bereits mit der Familiengarage-Supabase-Instanz verbunden. Die Tabelle, Realtime-Aktualisierung und die Prüfung auf Doppelbuchungen sind eingerichtet. Für die Veröffentlichung ist kein weiterer Code- oder Datenbankschritt erforderlich.

## Funktionsumfang

- Monats- und Wochenkalender mit Fahrzeugfarben
- Buchungen für Wilke, Wolfgang und Anja, inklusive ganztägiger Reservierungen
- Filter nach Fahrzeug oder Person
- Prüfung von Überschneidungen im Browser **und** als PostgreSQL-Datenbankregel
- Erstellen, Laden und Löschen mit automatischer Echtzeit-Aktualisierung
- Deutsches Datums- und 24-Stunden-Zeitformat
- Lokaler Testmodus, solange Supabase noch nicht konfiguriert ist

## Supabase einmalig einrichten

1. Erstelle auf [supabase.com](https://supabase.com) ein kostenloses Projekt.
2. Öffne im Projekt den **SQL Editor**, füge den gesamten Inhalt von [`schema.sql`](./schema.sql) ein und führe ihn aus. Das Skript erstellt die Tabelle, aktiviert Realtime und verhindert zeitliche Überschneidungen je Fahrzeug.
3. Öffne **Project Settings → API**. Kopiere die **Project URL** und den öffentlichen Schlüssel **anon / publishable**.
4. Trage beides in [`config.js`](./config.js) ein:

   ```js
   window.FAMILY_GARAGE_CONFIG = Object.freeze({
     SUPABASE_URL: "https://dein-projekt.supabase.co",
     SUPABASE_ANON_KEY: "dein-oeffentlicher-anon-key",
   });
   ```

   Verwende ausdrücklich niemals den `service_role`-Schlüssel in einer Website oder in Git.
5. Öffne `index.html` im Browser oder veröffentliche die Dateien. Der Kopfbereich zeigt anschließend **Live synchronisiert**.

### Zugriffsschutz

Die mitgelieferten Row-Level-Security-Regeln erlauben Lesen, Anlegen und Löschen für Nutzer mit dem öffentlichen Supabase-Schlüssel. Das ist bewusst einfach für einen kleinen privaten Familienkalender, schützt aber nicht vor Personen, die sowohl die veröffentlichte Website als auch deren Browser-Konfiguration erhalten. Für einen größeren oder sensibleren Personenkreis sollten Supabase Auth und darauf basierende RLS-Regeln ergänzt werden.

## GitHub Pages bereitstellen

1. Lege ein neues GitHub-Repository an und lade alle Projektdateien hoch. `config.js` muss die Supabase-Werte enthalten, damit die veröffentlichte SPA synchronisiert arbeitet. Der Anon-Key ist für Browser-Anwendungen vorgesehen; der Service-Role-Key darf niemals verwendet werden.
2. Gehe im Repository zu **Settings → Pages** und wähle bei **Build and deployment** die Quelle **GitHub Actions**.
3. Jeder Push auf den Branch `main` oder `master` startet den Workflow in [`.github/workflows/deploy.yml`](./.github/workflows/deploy.yml). Nach dessen Abschluss steht die Adresse in der Workflow-Zusammenfassung und in den Pages-Einstellungen.

Die Anwendung verwendet CDN-Versionen von Tailwind CSS, FullCalendar und dem Supabase-JavaScript-Client. Deshalb ist kein `npm install` und kein lokaler Build-Schritt erforderlich.

## Lokaler Test

Für einen lokalen Test öffne die Seite über einen kleinen Webserver, nicht per Doppelklick auf `index.html`: Moderne Browser behandeln direkt geöffnete Dateien als `file://`-Ursprung und können JavaScript-Abhängigkeiten blockieren. Mit installiertem Node.js funktioniert beispielsweise:

```powershell
npx serve .
```

Öffne anschließend die angezeigte `http://localhost`-Adresse. Ohne eingetragene Supabase-Werte arbeitet die Anwendung im klar markierten lokalen Testmodus; diese Testdaten bleiben ausschließlich in diesem Browser gespeichert.
