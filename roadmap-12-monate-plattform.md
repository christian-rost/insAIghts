# Roadmap 12 Monate: Foundry-aehnliche Datenplattform

## 1. Ziel der Roadmap
Aufbau einer wiederverwendbaren Daten- und Operationsplattform mit Start im Use-Case Rechnungsverarbeitung und schrittweiser Erweiterung auf Procurement, Vertragsmanagement und MDM Governance.

## 2. Strategische Leitlinien
- Plattform vor Einzelprojekt: Kernkomponenten einmal bauen, mehrfach nutzen.
- Ontologie als Produktkern: Objekte/Beziehungen fachlich standardisieren.
- Actionability: Erkenntnisse muessen direkt zu Aktionen (Write-back) fuehren.
- Security-by-Design: Audit, Rechte, Governance von Beginn an.
- DSGVO-Konformitaet by Design: Datenschutzanforderungen werden in Architektur, Prozesse und Betrieb verankert.
- Konfiguration-by-UI: Betriebs- und Fachparameter zentral ueber Admin-Oberflaeche statt Env-Variablen.

## 3. Prioritaetenfolge (Use-Cases)
1. Rechnungsverarbeitung (MVP -> Produktivstabilisierung)
2. Procurement / P2P-Erweiterung
3. Vertragsmanagement (CLM)
4. Stammdatenqualitaet / MDM Governance

## 4. Quartalsplan

## Q1 (Monat 1-3): Rechnungsverarbeitung produktiv machen
### Ziel
MVP live schalten und stabilen Betrieb erreichen.

### Schwerpunkte
- Ingestion aus Mail, REST, MinIO.
- Kanonisches Rechnungsmodell und Lineage.
- Workflow/Freigabe mit Rollenrechten.
- Write-back in Supabase.
- Audit-Log und KPI-Basisdashboard.
- User-Verwaltung und Admin-Oberflaeche fuer Konfiguration.

### Deliverables
- Produktive AP-Anwendung fuer Rechnungseingang bis Freigabe.
- Dokumentierte API-Schnittstellen und Betriebsrunbooks.
- KPI-Set live: Durchlaufzeit, Touchless-Rate, Dublettenrate.
- Admin-Portal live: Benutzer/Rollen, Provider-Keys, Connector- und Regelkonfiguration.
- DSGVO-Basisdokumentation live (Loeschkonzept, Auskunftsprozess, TOMs).
- Neo4j als produktive Graph-Engine in Coolify bereitgestellt und angebunden.

### Erfolgsmetriken
- >95 Prozent valide Datensaetze im Zielmodell.
- 100 Prozent Audit-Abdeckung fuer kritische Aktionen.
- Reduzierte Durchlaufzeit gegenueber Ausgangswert.
- Deutliche Reduktion der in Coolify gepflegten fachlichen Env-Variablen.

## Q2 (Monat 4-6): Procurement / P2P-Erweiterung
### Ziel
Ausweitung von Rechnung auf vorgelagerte Einkaufsprozesse.

### Schwerpunkte
- Neue Objekte: Requisition, PurchaseOrder, GoodsReceipt.
- 2-/3-Wege-Matching als Standardprozess.
- Freigaberegeln nach Betrag, Kostenstelle, Lieferant.
- Zuschnitt der Inbox auf Einkauf + AP.

### Deliverables
- P2P-Cockpit mit End-to-End-Sicht Bestellung -> Wareneingang -> Rechnung.
- Operative Aktionen fuer Freigaben, Sperren, Klaerungsfaelle.
- Supplier-bezogene Abweichungsanalysen.

### Erfolgsmetriken
- Erhoehte Match-Rate.
- Niedrigere Ausnahmequote.
- Schnellere Freigabezyklen im Einkauf.

## Q3 (Monat 7-9): Vertragsmanagement (CLM)
### Ziel
Vertraege als steuernde Ebene integrieren.

### Schwerpunkte
- Neue Objekte: Contract, Clause, Obligation, RenewalWindow.
- Dokumentextraktion fuer Vertragsmetadaten/Klauseln.
- Fristen- und Verpflichtungsmonitoring.
- Verbindung Contract <-> Supplier <-> PO <-> Invoice.

### Deliverables
- Vertragsregister mit Risiko-/Fristenansicht.
- Alerts und Workflows fuer Verlaengerung, Kuendigung, Eskalation.
- Transparenz ueber Preis-/Klauselabweichungen.

### Erfolgsmetriken
- Weniger verpasste Fristen.
- Bessere Konditionsnutzung.
- Reduzierte manuelle Vertragssuche.

## Q4 (Monat 10-12): MDM Governance und Plattform-Haertung
### Ziel
Datenqualitaet plattformweit heben und Skalierung absichern.

### Schwerpunkte
- MDM-Objekte: MasterRecord, SourceSystem, DataIssue.
- Regeln fuer Dubletten, Vollstaendigkeit, Konfliktauflosung.
- Data Steward Workflows mit Freigabe/Publikation.
- Performance, Observability, Betriebsautomatisierung.

### Deliverables
- MDM Governance App mit Steward-Inbox.
- Datenqualitaets-Dashboard und SLA-Tracking.
- Technische Hardening-Massnahmen (Monitoring, Alerting, SLOs).

### Erfolgsmetriken
- Sinkende Datenfehlerquote.
- Schnellere Korrekturzeiten bei Stammdatenproblemen.
- Stabiler Plattformbetrieb bei hoeherer Last.

## 5. Plattform-Epics (laufend ueber alle Quartale)
- Connector Framework (standardisierte Adapter fuer neue Quellen).
- Ontologie-Governance (Naming, Versionierung, Ownership).
- Sicherheitsmodell (RBAC/ABAC, Purpose-based Access, RLS).
- Audit und Revisionsfaehigkeit (vollstaendige Nachvollziehbarkeit).
- DevOps/Betrieb unter Coolify (CI/CD, Rollback, Health Checks).
- Admin Control Plane (User-/Rollenverwaltung, Runtime-Konfiguration, Secret Management).

## 6. Team- und Rollenbild (orientierend)
- Product Owner (fachliche Priorisierung)
- Solution Architect (Plattform-/Datenarchitektur)
- Backend Engineers (Services, API, Workflow, Write-back)
- Data Engineer (Ingestion, Mapping, Qualitaetsregeln)
- Frontend Engineer (Inbox, Objektansichten, Dashboards)
- Security/Compliance (Berechtigungen, Audit, Governance)

## 7. Abhaengigkeiten und Risiken
- Datenzugriff und Qualitaet der Quellsysteme.
- Verfuegbarkeit fachlicher Entscheider fuer Freigaberegeln.
- Klare Ownership der Ontologie-Objekte.
- Change Management in Fachbereichen (neue Arbeitsweise).

## 8. Exit-Kriterien je Quartal
- Q1 Exit: AP-MVP produktiv und revisionssicher.
- Q2 Exit: P2P-End-to-End sichtbar und operativ nutzbar.
- Q3 Exit: Vertragsfristen/-risiken aktiv gemanagt.
- Q4 Exit: MDM-Governance etabliert, Plattform skaliert stabil.

## 9. Entscheidungsfenster (naechste 2-4 Wochen)
- Freigaberegeln finalisieren (Betragsgrenzen, 4-Augen-Prinzip).
- SLA je Workflow-Status definieren.
- Ontologie-Governance Board benennen.
- Ziel-SLOs fuer Performance und Verfuegbarkeit festlegen.
- Umgebungsstrategie von rein Dev auf Staging/Prod erweitern.

## 10. Statusabgleich (Stand: 04.03.2026)
- Rechnungsverarbeitung MVP ist fuer den MinIO-Pfad technisch Ende-zu-Ende umgesetzt.
- Anwender-Inbox mit 3-Spaltenansicht (Liste, Rechnungsdaten, Dokumentvorschau) ist verfuegbar.
- Workflow-Aktionen (`approve`, `reject`, `hold`) inkl. Aktionshistorie sind aktiv.
- LLM-basierte Feldextraktion ist ueber Admin-UI konfigurierbar.
- Noch offen fuer Roadmap-Q1-Vollabdeckung:
  - Mail- und REST-Connector produktiv anbinden.
  - Freigaberegeln aus Admin-UI serverseitig erzwingen.
  - KPI-Dashboard V1 abschliessen.
