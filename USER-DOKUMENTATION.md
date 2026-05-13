# User-Dokumentation insAIghts

Stand: 13.05.2026

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
- Beim Start und nach `Reset` ist der Statusfilter auf `alle Status` gesetzt.
- Suche nach Lieferant oder Rechnungsnummer
- Detail-Tabs fuer Uebersicht, Aktionen, Cases und Graph
- Feste Header- und Filterleiste fuer schnellen Zugriff
- Modernisierte Workspace-Optik mit klareren Karten, Status-Badges und fokussierter Dokumentvorschau
- Desktop-Workspace mit drei unabhaengig scrollbaren Bereichen: Rechnungsliste, Rechnungsdetail und PDF/Dokumentvorschau
- Dezente UI-Effekte fuer Hover, Fokus, aktive Rechnungen, Detail-Tabs und Dokumentvorschau
- Aktive Rechnungen werden per Selection-Spotlight hervorgehoben; Detailbereich und PDF blenden beim Rechnungswechsel weich ein.
- Eine Sticky-Kontextleiste im Detailbereich zeigt Rechnungsnummer, Lieferant, Betrag und Status beim Scrollen weiter an.
- Der PDF-Bereich kann in einen Fokusmodus geschaltet werden.
- Status- und Aktionsfeedback wird visuell hervorgehoben; fehlende extrahierte Header-Werte werden markiert.
- Der Graph-Tab zeigt bei vorhandenem Graph einen Knoten-Zaehler als schnellen Hinweis.
- `Cmd/Ctrl + K` oeffnet die Command Palette fuer Navigation, Layoutwechsel, Tabs und Workflow-Aktionen.
- Tastaturkuerzel: `J/K` oder Pfeiltasten wechseln Rechnungen, `/` fokussiert die Suche, `1/2/3` wechseln Layout-Presets, `O/T/C/G` wechseln Detail-Tabs, `P` schaltet PDF-Fokus.
- Layout-Presets: `Pruefen`, `Beleg`, `Analyse`.
- Smart Empty States geben konkrete Hinweise, wenn Filter/Suche keine Rechnungen liefern.
- Die Review Checklist bewertet sichtbar, ob Lieferant, Betrag, Waehrung, Positionen, PDF und Header-Felder vorhanden sind.
- Compare Mode vergleicht die aktuelle Rechnung mit einer zweiten Rechnung aus der aktuellen Liste.
- Der Korrekturmodus ist aktuell ein lokaler Frontend-Entwurf. Werte werden nicht dauerhaft gespeichert, solange keine auditierbare Backend-Persistenz aktiviert ist.

## 4. Rechnungsdetails
Im Detailbereich siehst du:
- Kopfdaten (Rechnungsnummer, Datum, Gesamtpreis, Status)
- Lieferant
- Extrahierte Felder (konfigurierbar, auf-/zuklappbar, mit fachlichem Anzeigename)
- Positionen (`Leistungen`) direkt unter den Header-Feldern
- Aktionshistorie
- Graph-Ausschnitt im Graph-Tab, standardmaessig ausgeblendet

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
Der Aktionsbereich ist als eigener Block unterhalb der Positionsliste angeordnet.
Im Desktop-Layout scrollen Rechnungsliste, Detailbereich und Dokumentvorschau getrennt voneinander.

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
- Der Graph liegt im Tab `Graph` und ist standardmaessig ausgeblendet.
- `Graph anzeigen` blendet die Graph-Uebersicht ein; `Graph neu laden` laedt den Subgraph der aktuellen Rechnung.
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
  - Treffer-Rechnungen werden im Graph als markierte Knoten hervorgehoben
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
