# User-Dokumentation insAIghts

Stand: 09.03.2026

## 1. Zielgruppe
Diese Doku richtet sich an fachliche Anwender (AP Clerk, Approver), die Rechnungen in der Inbox bearbeiten.

## 2. Login und Rollen
- Login mit `username` + `password`.
- Benutzer ohne Rolle `ADMIN` landen direkt in der Inbox.
- Wichtige Rollen:
  - `AP_CLERK`: operative Bearbeitung
  - `APPROVER`: Freigabe
  - `AUDITOR`: lesend

## 3. Inbox-Aufbau
Die Inbox ist 3-spaltig:
- Links: Rechnungsliste
- Mitte: Rechnungsdetails + Aktionen + Historie
- Rechts: PDF/Dokumentvorschau

Zusaetzlich:
- Filter nach Status
- Suche nach Lieferant oder Rechnungsnummer

## 4. Rechnungsdetails
Im Detailbereich siehst du:
- Kopfdaten (Rechnungsnummer, Datum, Gesamtpreis, Status)
- Lieferant
- Extrahierte Felder (konfigurierbar, auf-/zuklappbar)
- Positionen (`Leistungen`)
- Aktionshistorie
- Graph-Ausschnitt

## 5. Verfuegbare Aktionen
Fuer eine Rechnung:
- `Approve`
- `Reject`
- `Hold`
- `Request Clarification`
- `Loeschung anfordern` (kein Direkt-Loeschen)

Der Aktionsbereich ist zweizeilig aufgebaut:
- Zeile 1: Kommentarfeld
- Zeile 2: Aktionsbuttons
Jede Aktion kann optional mit Kommentar erfolgen.

## 6. Workflow-Logik
- Erlaubte Statuswechsel werden serverseitig geprueft.
- Rollen und Betragsgrenzen werden durch Admin-Regeln erzwungen.
- Nicht erlaubte Aktionen liefern eine Fehlermeldung.

## 7. Cases (Rueckfragen)
`Request Clarification` erzeugt einen Case.
Case-Status:
- `OPEN`
- `IN_PROGRESS`
- `RESOLVED`
- `CLOSED`

## 8. Graph in der Inbox
- `Graph neu laden` laedt den Subgraph der aktuellen Rechnung.
- In der Inbox werden standardmaessig verbundene Rechnungs-Knoten im gemeinsamen Kontext angezeigt (z. B. ueber `Currency`).
- Isolierte Fremdknoten werden weiterhin ausgeblendet.
- Ueber den Toggle `Weitere Rechnungen` kann der erweiterte Rechnungs-Kontext ein- oder ausgeblendet werden.
- Klick auf Node:
  - direkte Nachbarn werden hervorgehoben
  - indirekte Knoten werden abgedunkelt
- Click+Hold auf Node:
  - Node kann innerhalb der Flaeche verschoben werden

## 9. Graph-Fragen mit LLM
- Im Bereich `GRAPH` gibt es das Eingabefeld `Graph fragen`.
- Beispiel: `Welche Rechnungen sind in EUR gestellt?`
- Ablauf:
  - Mistral interpretiert die Frage
  - erzeugt eine read-only Cypher-Abfrage
  - Query wird serverseitig validiert und gegen Neo4j ausgefuehrt
  - bei 0 Treffern wird automatisch ein flexibler Fallback versucht
    (Synonyme/Wertevarianten, case-insensitive, z. B. `Euro` -> `EUR`)
- In der UI siehst du:
  - kurze Antwort in natuerlicher Sprache
  - Modus (`direkt`, `flexibel`, oder `fallback versucht (kein Treffer)`)
  - die generierte Cypher-Query (voll sichtbar)
  - Ergebnistabelle inkl. Trefferanzahl
- Sicherheit:
  - nur lesende Cypher-Kommandos erlaubt
  - schreibende Befehle werden blockiert
  - Ergebnisse sind per LIMIT begrenzt

## 10. Fehlerbilder und schnelle Hilfe
- `Failed to fetch`:
  - API nicht erreichbar oder CORS falsch
  - Session abgelaufen -> neu einloggen
- Keine Rechnung sichtbar:
  - Filter pruefen
  - Admin soll Pipeline-Lauf pruefen
- PDF fehlt:
  - Dokumentpfad oder MinIO Object nicht vorhanden

Hinweis Berechtigungen:
- Anwender koennen Loeschung nur anfordern; die Freigabe/Ablehnung erfolgt durch Admin.

## 11. Datenschutz und Sicherheit
- Verarbeitung nach Secure-by-Design und DSGVO-Grundsaetzen.
- Aktionen werden revisionssicher protokolliert.
- Nur notwendige Daten sind in der UI sichtbar.
