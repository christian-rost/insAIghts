# Sprintplan Q1 (2-Wochen-Sprints): Rechnungsverarbeitung MVP

## 1. Rahmen
- Zeitraum: Q1 (12 Wochen)
- Sprintlaenge: 2 Wochen
- Anzahl Sprints: 6
- Ziel: Produktiver End-to-End-Prozess fuer Rechnungsverarbeitung (Mail, REST, MinIO -> Pruefung/Freigabe -> Write-back Supabase)
- Aktueller Umgebungsstand: nur Dev-Umgebung vorhanden.

## 2. Q1-Ziele (messbar)
- Drei Datenquellen stabil integriert.
- Kanonisches Rechnungsmodell produktiv genutzt.
- Workflow inkl. Rollenrechten aktiv.
- Write-back fuer Kernaktionen aktiv.
- Audit/Lineage fuer zentrale Prozesse vollstaendig.

## 3. Sprint 1 (Wochen 1-2): Fundament und Setup
### Sprintziel
Technisches Fundament, Datenmodell und Basis-Infrastruktur bereitstellen.

### Scope
- Projektgrundstruktur (Frontend, Backend, Services) aufsetzen.
- Supabase-Schema V1 fuer Kernobjekte anlegen.
- Auth-Grundlage und Rollenmodell (RBAC) initialisieren.
- Basis-Audit-Logging als Service-Querschnitt einbauen.
- API-Basisrouting und Health-Endpunkte bereitstellen.
- Bootstrap-Admin ueber Env (`ADMIN_USERNAME`/`ADMIN_PASSWORD`) implementieren.
- Admin-UI Grundmodul fuer User-/Rollenverwaltung bereitstellen.
- Security-by-Design Baseline festlegen (Threat Model, sichere Defaults, Haertungscheckliste).

### Deliverables
- Laufende Basisservices in Dev-Umgebung.
- DB-Migrationen fuer Kern-Tabellen (`invoices`, `documents`, `suppliers`, `actions`, `audit_log`).
- Erste technische Dokumentation (Runbook Setup + Konfiguration).
- Admin Login + Benutzerliste + Rollenpflege (Basisfunktion).
- DSGVO-Basisartefakte V1 (Verzeichnis der Verarbeitung, Datenklassifikation, TOM-Liste).

### Abnahmekriterien
- Services starten reproduzierbar.
- Migrationen laufen fehlerfrei durch.
- Jeder API-Aufruf erzeugt Audit-Basiseintrag.
- Erster Admin wird bei leerem System ueber Env-Bootstrap angelegt.

## 4. Sprint 2 (Wochen 3-4): Ingestion Mail/REST/MinIO
### Sprintziel
Datenaufnahme aus allen drei Quellen produktionsnah umsetzen.

### Scope
- Mail-Connector fuer Rechnungseingang (Anhaenge + Metadaten).
- REST-Connector fuer strukturierte Datensaetze.
- MinIO-Connector fuer Dokumentimport.
- Upload-Pipeline fuer Dateitypen PDF/TXT/PNG/JPG/JPEG/WEBP.
- Idempotenzschluessel pro Quelle implementieren.
- Fehlerkanal (Dead-Letter/Retry) fuer fehlgeschlagene Ingestion.
- Connector-Parameter in Admin-UI konfigurierbar machen (statt harter Env-Abhaengigkeit).

### Deliverables
- Endpunkte/Jobs fuer alle drei Ingestion-Pfade.
- Persistierte Rohdaten + Quelldokument-Referenzen.
- Monitoring-Metriken fuer Importvolumen und Fehlerquote.

### Abnahmekriterien
- Testdaten koennen aus allen Quellen verarbeitet werden.
- Doppelte Lieferungen werden nicht mehrfach angelegt.
- Fehlerfaelle sind nachvollziehbar und erneut verarbeitbar.
- Dateitypvalidierung und Groessenlimits greifen konsistent.
- Mail/REST/MinIO Connector-Einstellungen koennen ohne Redeploy ueber Admin-UI geaendert werden.

## 5. Sprint 3 (Wochen 5-6): Extraktion und Normalisierung
### Sprintziel
Rechnungsdaten in ein einheitliches Modell ueberfuehren und validieren.

### Scope
- OCR/Parsing fuer PDF- und Bildrechnungen ueber Mistral anbinden (analog xqt5-ai-plattform).
- Feldextraktion fuer Kernattribute (Nummer, Datum, Betrag, Faelligkeit, Lieferant).
- Mapping auf kanonisches Invoice-Schema.
- Validierungsregeln V1 (Pflichtfelder, Summen-/Steuerplausibilitaet).
- Dublettenpruefung V1 implementieren.
- Fallback- und Retry-Logik fuer Mistral OCR (Payload-Varianten + transiente Fehler) umsetzen.
- OCR-Ausgabe mit Seitenmarkern fuer spaeteren Seitenbezug persistieren.
- Mistral-Provider-Key ueber Admin-UI verwalten (verschluesselt gespeichert).
- PII-Filterung fuer Logs und Fehlermeldungen durchsetzen.

### Deliverables
- Normalized Invoice Pipeline Ende-zu-Ende.
- Validierungsreport je Rechnung.
- Initiale Data-Lineage-Events pro Transformationsschritt.

### Abnahmekriterien
- Zielattribute sind fuer den Grossteil der Testrechnungen gefuellt.
- Dubletten werden mit nachvollziehbarer Begruendung markiert.
- Transformationen sind per Lineage rueckverfolgbar.
- Mistral-OCR-Fehler werden mit klarer Fehlermeldung protokolliert (kein stilles Fehlschlagen).
- Aenderung des Mistral-Keys ist ohne Deployment ueber Admin-Oberflaeche moeglich.

## 6. Sprint 4 (Wochen 7-8): Workflow und Aktionen
### Sprintziel
Bearbeitungs- und Freigabeprozess operativ lauffaehig machen.

### Scope
- Statusmaschine implementieren (`INGESTED` bis `APPROVED/REJECTED/ON_HOLD`).
- Rollenbasierte Aktionsrechte durchsetzen.
- Aktionen: Approve, Reject, Hold, Request Clarification.
- Write-back in Supabase fuer Status und Aktionshistorie.
- Case-Zuweisung und Bearbeiterwechsel.

### Deliverables
- Funktionsfaehiger Workflow-Service.
- Action-Endpunkte mit Berechtigungspruefung.
- Vollstaendige Audit-Eintraege fuer Statusuebergaenge.

### Abnahmekriterien
- Nur berechtigte Rollen duerfen kritische Aktionen ausfuehren.
- Jede Aktion schreibt konsistent Status + Action + Audit.
- Eskalierbare Faelle koennen angelegt und zugewiesen werden.

## 7. Sprint 5 (Wochen 9-10): Frontend und operative Sicht
### Sprintziel
Nutzbare Arbeitsoberflaeche fuer AP-Team bereitstellen.

### Scope
- Inbox mit Filterung (Status, Prioritaet, Lieferant, Faelligkeit).
- Rechnungsdetailseite mit Dokumentvorschau und Validierungsergebnissen.
- Aktionsbuttons gemaess Rollenrechten.
- Graph-/Beziehungsansicht V1 fuer Invoice <-> Supplier <-> Case.
- KPI-Dashboard V1.
- Admin-Views fuer Provider, Connectoren und Workflow-Regeln.

### Deliverables
- Nutzbare Endanwenderoberflaeche fuer Kernprozess.
- API-Integration fuer Listen-/Detail-/Aktion-Use-Cases.
- UI-Auditereignisse fuer kritische Nutzerinteraktionen.

### Abnahmekriterien
- AP-User kann Rechnungen suchen, pruefen und entscheiden.
- Rollen sehen nur erlaubte Aktionen/Felder.
- Dashboard zeigt definierte MVP-KPIs.
- Admin kann Konfigurationen im UI aendern und Aenderungen werden auditiert.

## 8. Sprint 6 (Wochen 11-12): Hardening, UAT, Go-Live
### Sprintziel
Qualitaet absichern und produktionsreifen Pilotbetrieb starten.

### Scope
- End-to-End-Tests fuer Kernprozesse.
- Fehlerbehandlung/Retry-Haertung.
- Security-Checks (Rollen, Endpoint-Schutz, Audit-Vollstaendigkeit).
- UAT mit Fachbereich und Feedbackschleife.
- Go-Live-Checkliste, Runbooks und Incident-Prozess finalisieren.
- DSGVO-Readiness-Check (Loeschprozess, Auskunftsprozess, Aufbewahrungsfristen, Berechtigungstests).

### Deliverables
- Abgenommener Pilot-Release.
- Betriebsdokumentation und Supportuebergabe.
- Priorisierte Backlog-Liste fuer Q2.

### Abnahmekriterien
- Kritische Testfaelle bestehen.
- Keine blocker-kritischen Findings offen.
- Fachbereich bestaetigt Nutzbarkeit im Tagesprozess.
- DSGVO-Basisanforderungen sind nachweisbar umgesetzt.

## 9. Durchgaengige Arbeit in jedem Sprint
- Backlog-Pflege und fachliche Abstimmung.
- Monitoring/Alerting verbessern.
- Performance-Baselines messen.
- Dokumentation fortschreiben.

## 10. Definition of Done (Q1-weit)
- Code reviewed und testbar integriert.
- Fachlich relevante Logs/Audit vorhanden.
- API/Schema-Aenderungen dokumentiert.
- Security-Anforderungen fuer den Scope eingehalten.
- DSGVO-Anforderungen fuer den Scope eingehalten.
- Akzeptanzkriterien des Sprintziels erfuellt.

## 11. Risiken und Gegenmassnahmen
- Risiko: Uneinheitliche Eingangsformate.
  - Gegenmassnahme: Kanonisches Schema + robuste Validierung + manuelle Review-Queue.
- Risiko: Unklare Freigaberegeln.
  - Gegenmassnahme: Entscheidungstermine mit Fachbereich pro Sprint.
- Risiko: Hoher OCR-Fehler bei schlechten PDFs.
  - Gegenmassnahme: Confidence-Schwelle und manuelle Nachbearbeitung.
- Risiko: Rechtekonflikte im Betrieb.
  - Gegenmassnahme: Fruehe Rollentests mit Auditnachweis.

## 12. Ergebnis am Ende von Q1
Eine produktionsnahe Rechnungsverarbeitungs-Anwendung mit stabiler Ingestion, nachvollziehbarer Datenverarbeitung, operativem Freigabeworkflow, Supabase-Write-back und belastbarer Governance-Basis fuer die Folge-Use-Cases in Q2.

## 13. Fortschrittsabgleich (Stand: 04.03.2026)
- Bereits umgesetzt:
  - MinIO-Ingestion inkl. OCR/LLM-Mapping/Validation.
  - Admin Control Plane fuer User, Provider, Connector, Extraktionsfelder.
  - Anwender-Inbox inkl. Detail, Positionen, PDF/Bild-Vorschau, Workflow-Aktionen.
  - Freigaberegeln fuer `approve` aus Admin-Konfiguration serverseitig durchgesetzt.
  - Audit- und Aktionshistorie fuer operative Statuswechsel.
- Noch offen fuer vollstaendige Q1-Zielerreichung:
  - Mail- und REST-Connectoren in Produktivqualitaet.
  - KPI-Dashboard V1.
