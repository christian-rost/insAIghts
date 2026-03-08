# User-Dokumentation insAIghts

Stand: 08.03.2026

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
- Extrahierte Felder (konfigurierbar)
- Positionen (`Leistungen`)
- Aktionshistorie
- Graph-Ausschnitt

## 5. Verfuegbare Aktionen
Fuer eine Rechnung:
- `Approve`
- `Reject`
- `Hold`
- `Request Clarification`

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
- Klick auf Node:
  - direkte Nachbarn werden hervorgehoben
  - indirekte Knoten werden abgedunkelt
- Click+Hold auf Node:
  - Node kann innerhalb der Flaeche verschoben werden

## 9. Fehlerbilder und schnelle Hilfe
- `Failed to fetch`:
  - API nicht erreichbar oder CORS falsch
  - Session abgelaufen -> neu einloggen
- Keine Rechnung sichtbar:
  - Filter pruefen
  - Admin soll Pipeline-Lauf pruefen
- PDF fehlt:
  - Dokumentpfad oder MinIO Object nicht vorhanden

Hinweis Berechtigungen:
- Dokument-Loeschung ist aktuell eine Admin-Funktion und nicht fuer normale Anwender freigegeben.

## 10. Datenschutz und Sicherheit
- Verarbeitung nach Secure-by-Design und DSGVO-Grundsaetzen.
- Aktionen werden revisionssicher protokolliert.
- Nur notwendige Daten sind in der UI sichtbar.
