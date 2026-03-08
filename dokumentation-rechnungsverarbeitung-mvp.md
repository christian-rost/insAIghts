# Dokumentation: Foundry-ähnliche Plattform (MVP Rechnungsverarbeitung)

## 1. Zielbild
Diese Plattform ist eine operationale Datenanwendung fuer Rechnungsverarbeitung, die Daten integriert, semantisch modelliert, prueft und Aktionen direkt im System ausfuehrbar macht.

MVP-Ziel ist ein produktiv nutzbarer End-to-End-Prozess von Rechnungseingang bis Freigabe/Status-Write-back.

## 2. Geltungsbereich (MVP)

### In Scope
- Datenaufnahme aus drei Quellen:
  - Mail (Rechnungsanhang, Metadaten)
  - REST-API (strukturierte Rechnungsdaten)
  - MinIO (Dateiablage fuer Rechnungsdokumente)
- Extraktion/Normalisierung auf ein kanonisches Rechnungsmodell.
- Semantische Schicht (Objekte und Beziehungen) fuer 360-Grad-Sicht.
- Regelbasierte Validierung (Pflichtfelder, Dubletten, Betragspruefungen).
- Workflow fuer Pruefung/Freigabe mit Statusmodell.
- Write-back von Entscheidungen und Status in Supabase-Tabellen.
- Auditierbarkeit und Data Lineage von Tag 1.
- User-Verwaltung und Admin-Oberflaeche fuer Betriebs- und Plattformkonfiguration.

Hinweis zum Implementierungsstatus:
- Fachliches Zielbild umfasst Mail, REST und MinIO.
- Aktuell implementiert ist bewusst zuerst der MinIO-Quellpfad; Mail/REST folgen in den naechsten Ausbaustufen.

### Out of Scope (MVP)
- Kompletter No-Code-App-Builder.
- Fortgeschrittene ML-Modelle fuer Forecasting.
- Vollstaendige Multi-Tenant-Isolation (optional nach MVP).

## 3. Business-Ziele und Nutzen
- Reduktion manueller Pruefungsschritte durch Automatisierung.
- Schnellere Durchlaufzeit von Eingang bis Freigabe/Buchung.
- Fruehere Erkennung von Anomalien und Dubletten.
- Hoehere Prozessqualitaet durch standardisierte Regeln.
- Vollstaendige Transparenz fuer Revision und Compliance.

## 4. Kern-Features

### 4.1 Datenintegration und Pipeline-Orchestrierung
- Konnektoren fuer Mail, REST und MinIO.
- Batch- und ereignisgetriebene Ingestion.
- Versionierung von Rechnungsdaten (Aenderungshistorie).
- Data Lineage pro Feld/Objekt (Quelle -> Transformation -> Ziel).

### 4.2 Ontologie / Semantische Schicht
- Objektmodell statt reiner Tabellenansicht.
- Kernobjekte:
  - Invoice
  - Supplier
  - PurchaseOrder (falls vorhanden)
  - GoodsReceipt (falls vorhanden)
  - ApprovalCase
  - Payment
  - User
- Objektbeziehungen:
  - Invoice BELONGS_TO Supplier
  - Invoice MATCHES PurchaseOrder
  - Invoice MATCHES GoodsReceipt
  - Invoice ASSIGNED_TO ApprovalCase
  - Invoice APPROVED_BY User
  - Invoice PAID_BY Payment
- Graph-Ansicht fuer Beziehungen, Historie und Impact-Analyse.

### 4.3 Operations und Write-back
- Aktionen direkt aus der Anwendung:
  - Approve Invoice
  - Reject Invoice (mit Reason Code)
  - Set/Remove Payment Block
  - Request Clarification (Case-Erstellung)
- Persistenz aller Aktionsresultate in Supabase-Tabellen.
- Statusuebergaenge ueber definierte Workflow-Regeln.

### 4.4 Security und Governance
- Secure-by-Design ist verbindlicher Architekturgrundsatz (nicht optionales Feature).
- Rollenbasiertes Zugriffsmodell (RBAC):
  - AP_CLERK
  - APPROVER
  - AUDITOR
  - ADMIN
- Optional feldgenaue Berechtigungen (z. B. Bankdaten).
- Purpose-based Access fuer sensible Aktionen (Begruendungspflicht).
- Lueckenloses Audit-Log (Lesen, Schreiben, Entscheiden, Export).
- Datenschutz-by-Design und Datenschutz-by-Default fuer DSGVO-konforme Verarbeitung.

### 4.5 User-Verwaltung und Admin-Oberflaeche
- Benutzerverwaltung:
  - Benutzer anlegen, deaktivieren, reaktivieren
  - Rollen zuweisen/entziehen (`AP_CLERK`, `APPROVER`, `AUDITOR`, `ADMIN`)
  - Passwort-Reset und Admin-erzwungene Zuruecksetzung
- Admin-Oberflaeche:
  - Verwaltung externer Provider-Keys (z. B. Mistral)
  - Verwaltung fachlicher Regeln (Freigabelimits, Pflichtfelder, SLA)
  - Verwaltung von Connector-Konfigurationen (Mail, REST, MinIO)
  - Einsicht in Audit/Fehler/Verarbeitungsstatus
- Zielvorgabe:
  - So wenig Konfiguration wie moeglich per Coolify-Environment
  - Betriebsrelevante Parameter bevorzugt in der Admin-UI pflegen

## 5. Funktionskatalog (MVP)

### 5.1 Ingestion-Funktionen
- Mail-Polling fuer definierte Postfaecher.
- REST-Pull/Push-Endpunkte fuer Rechnungsdaten.
- MinIO-Import inkl. Dateimetadaten.
- Dokumentklassifikation und OCR/Parsing (PDF, Bild) ueber Mistral OCR API.

### 5.2 Datenqualitaet und Validierung
- Pflichtfeldpruefung (Lieferant, Rechnungsnummer, Betrag, Datum, Faelligkeit).
- Dublettenerkennung:
  - Schluessel: Lieferant + Rechnungsnummer + Betrag + Datum
  - Fuzzy-Ergaenzung fuer OCR-Abweichungen
- Steuer-/Summenpruefung.
- Abgleich gegen Stammdaten (Supplier).

### 5.3 Workflow und Bearbeitung
- Arbeitsliste (Inbox) nach Rolle und Prioritaet.
- Statusmanagement und Zuweisung von Faellen.
- Kommentierung und Nachforderung fehlender Informationen.
- SLA/Eskalationsmarker fuer ueberfaellige Faelle.

### 5.4 Analyse und Transparenz
- Rechnungsdetailansicht mit Dokument, Feldern, Matches, Historie.
- Graph-Ansicht der Objektbeziehungen.
- KPI-Dashboard fuer operative Steuerung.

## 6. Referenzarchitektur

### 6.1 Komponenten
- Frontend (Web-App):
  - Inbox
  - Rechnungsdetail
  - Graph-Ansicht
  - KPI-Dashboard
- API Gateway:
  - Authentifizierung
  - Routing
  - Request-Validierung
- Identity & Access Service:
  - Benutzer, Rollen, Sessions
  - Passwort- und Account-Policies
  - Bootstrap-Admin-Verwaltung
- Ingestion Service:
  - Mail Connector
  - REST Connector
  - MinIO Connector
- Document Service:
  - OCR (Mistral)
  - Feldextraktion
  - Dokumentmetadaten
- Normalization Service:
  - Mapping auf kanonisches Schema
  - Datenversionierung
- Workflow Service:
  - Statusmaschine
  - Regeln
  - Zuweisung/Eskalation
- Action Service:
  - Operative Aktionen
  - Write-back in Supabase
- Audit & Lineage Service:
  - Ereignisprotokoll
  - Herkunftsnachweis
- Datenhaltung:
  - Supabase (relationale Hauptdaten, Audit, Aktionen)
  - Graph-Schicht (semantische Beziehungen) mit Neo4j
  - Admin-Konfigurationsdaten (Provider-Keys, Regelsets, Connector-Einstellungen)

### 6.2 Deploymentschnitt
- Betrieb unter Coolify.
- Trennung Frontend/Backend.
- Containerisierte Services mit klaren Runtime-Grenzen.

### 6.3 Technologieentscheidung Graph
- Gewaehlte Graph-Engine: Neo4j.
- Zweck: Ontologie-Objekte und Beziehungen fuer 360-Grad-Sicht, Impact-Analyse und Graph-Abfragen.
- Betriebsmodell: eigener Service unter Coolify mit persistenten Volumes.

## 7. Datenmodell (Initial)

### 7.1 Tabellen (Supabase)
- `invoices`
- `invoice_lines`
- `suppliers`
- `documents`
- `approval_cases`
- `approval_steps`
- `actions`
- `audit_log`
- `lineage_events`
- `object_edges`

### 7.3 Tabellen (aktuell implementiert, `insaights_*`)
- `insaights_users`
- `insaights_admin_audit_log`
- `insaights_config_connectors`
- `insaights_config_provider_keys`
- `insaights_config_extraction_fields`
- `insaights_documents`
- `insaights_invoices`
- `insaights_invoice_lines`
- `insaights_invoice_actions`

### 7.2 Wichtige Felder (Auszug)
- `invoices`:
  - id
  - source_system
  - supplier_id
  - invoice_number
  - invoice_date
  - due_date
  - currency
  - net_amount
  - tax_amount
  - gross_amount
  - status
  - payment_block (bool)
  - version
- `actions`:
  - id
  - invoice_id
  - action_type
  - action_payload
  - executed_by
  - executed_at
- `audit_log`:
  - id
  - actor
  - event_type
  - object_type
  - object_id
  - purpose_text
  - event_ts

## 8. Workflow-Statusmodell
- INGESTED
- EXTRACTED
- VALIDATED
- NEEDS_REVIEW
- PENDING_APPROVAL
- APPROVED
- REJECTED
- POSTED
- PAID
- ON_HOLD
- CLARIFICATION_REQUESTED

Regeln:
- Statusuebergaenge sind nur ueber erlaubte Transitionen moeglich.
- Jeder Transition wird als Audit-Event persistiert.
- Kritische Transitionen erfordern Rollencheck und optional Purpose-Text.

## 9. API-Schnittstellen (MVP)
- `POST /ingestion/mail/pull`
- `POST /ingestion/rest/pull`
- `POST /ingestion/minio/pull`
- `GET /invoices`
- `GET /invoices/{id}`
- `POST /invoices/{id}/validate`
- `POST /invoices/{id}/approve`
- `POST /invoices/{id}/reject`
- `POST /invoices/{id}/hold`
- `POST /invoices/{id}/request-clarification`
- `GET /invoices/{id}/cases`
- `PATCH /cases/{id}`
- `GET /graph/{objectType}/{id}`
- `GET /audit/{objectType}/{id}`

### 9.1 Admin- und User-Management APIs (MVP)
- `POST /auth/login`
- `POST /auth/refresh`
- `POST /auth/logout`
- `GET /admin/users`
- `POST /admin/users`
- `PATCH /admin/users/{id}`
- `POST /admin/users/{id}/reset-password`
- `POST /admin/users/{id}/deactivate`
- `POST /admin/users/{id}/reactivate`
- `GET /admin/config/providers`
- `PUT /admin/config/providers/{provider}`
- `GET /admin/config/connectors`
- `PUT /admin/config/connectors/{connector}`
- `GET /admin/config/workflow-rules`
- `PUT /admin/config/workflow-rules`
- `GET /admin/kpi/overview`
- `POST /admin/reset/invoice-pipeline`
- `GET /admin/audit/events`

Festlegung:
- Login-Identitaet ist `username` (nicht E-Mail).
- Admin-Funktionen sind Bestandteil des MVP.

## 9.2 Dokumentklassifikation und OCR-Standard (Mistral, analog xqt5-ai-plattform)

### Verbindlicher Standard
- OCR fuer PDF und Bilddateien wird ueber Mistral abgewickelt (`mistral-ocr-latest`).
- TXT-Dateien werden ohne OCR per UTF-8 dekodiert.
- Ziel ist dieselbe Verarbeitungslogik wie in `xqt5-ai-plattform` (Upload -> OCR/Extraktion -> Persistenz -> Weiterverarbeitung).

### Unterstuetzte Dateitypen
- PDF
- TXT
- PNG
- JPG
- JPEG
- WEBP

### Verarbeitungsfluss (analog Referenzprojekt)
1. Datei wird angenommen und validiert (Typ, Groesse).
2. Dokumentklassifikation:
   - `pdf` -> OCR via Mistral
   - `image` -> OCR via Mistral
   - `txt` -> UTF-8 Text
3. Extraktion liefert:
   - `extracted_text`
   - optionale OCR-Assets (z. B. eingebettete Bilder inkl. Seitenbezug)
4. Persistenz als Dokument-Datensatz mit initialem Status `processing`.
5. Nachgelagerte Verarbeitung (Chunking/Regeln/Mapping) setzt Status auf `ready` oder `error`.
6. Jede Stufe wird in Audit/Lineage protokolliert.

### Mistral-Ansteuerung (Implementierungsvorgabe)
- API-Endpunkt: `https://api.mistral.ai/v1/ocr`
- Auth: Bearer Token aus Provider-Key `mistral`
- Dokumentuebergabe:
  - PDF als `data:application/pdf;base64,...`
  - Bild als `data:image/<mime>;base64,...`
- OCR-Aufruf nutzt Fallback-Payload-Varianten (wie Referenzprojekt), falls einzelne Request-Varianten abgewiesen werden.
- Retry-Strategie bei transienten Fehlern (`429`, `500`, `502`, `503`, `504`).

### OCR-Ausgabe und Normalisierung
- Extrahierter Seiteninhalt wird als strukturierter Text/Markdown gespeichert.
- Seitenmarker `<!-- page:N -->` werden mitgefuehrt, um spaeter Seitenbezug in UI/Audit zu ermoeglichen.
- Bildreferenzen/Assets aus OCR koennen separat gespeichert werden (inkl. `page_number`, `caption`, `ocr_text`).
- Wenn strukturierte OCR aktiv ist, werden Annotationen (Dokument/Bild) zusaetzlich verarbeitet.

### Konfiguration (MVP)
- Mistral API-Key als Runtime-Provider-Key in der Admin-Oberflaeche (Pflicht fuer PDF/Bild-OCR)
- `MISTRAL_OCR_STRUCTURED` (Default: `true`)
- `MISTRAL_OCR_INCLUDE_IMAGE_BASE64` (Default: `false` in `.env.example` der Referenzplattform)
- Ohne Mistral-Key:
  - TXT-Verarbeitung bleibt moeglich
  - PDF/Bild-OCR wird mit fachlicher Fehlermeldung abgebrochen

## 9.3 Konfigurationsprinzip unter Coolify (verbindlich)

### Grundsatz
- Environment Variables in Coolify werden auf ein technisches Minimum reduziert.
- Fachliche und providerbezogene Konfiguration erfolgt ueber die Admin-Oberflaeche.

### Minimaler Env-Satz (MVP)
- Infrastruktur-Basis:
  - `SUPABASE_URL`
  - `SUPABASE_KEY`
  - `JWT_SECRET`
  - `CORS_ORIGINS`
- Initialer Admin-Bootstrap:
  - `ADMIN_USERNAME`
  - `ADMIN_PASSWORD`

### Konfiguration in der Admin-Oberflaeche (statt Env)
- Provider-Keys (u. a. Mistral API Key)
- OCR- und Dokumenteinstellungen
- Connector-Parameter (Mail, REST, MinIO)
- Workflow-/Freigaberegeln und SLA
- Feature-Flags und Runtime-Schalter

### Betriebsregeln fuer Admin-Bootstrap
- Bootstrap-Admin wird beim ersten Start angelegt, falls noch kein Admin existiert.
- `ADMIN_PASSWORD` ist nur fuer Initialisierung gedacht und danach in der Admin-Oberflaeche zu rotieren.
- Jeder Admin-Login und jede Aenderung an Konfiguration/Benutzern wird auditiert.

### Betriebs- und Qualitaetsregeln
- Idempotente Verarbeitung pro Dokumentquelle.
- Fehler werden pro Dokument mit Grundstatus abgelegt (`error_message`).
- OCR darf nicht stillschweigend fehlschlagen; Fehler muessen in Monitoring und Audit sichtbar sein.
- Grosse Dokumente sind ueber Upload-Limits und Queue/Retry kontrolliert zu verarbeiten.

## 10. KPI-Set (MVP)
- Durchlaufzeit je Rechnung.
- Touchless-Rate.
- First-pass-Quote.
- Dublettenrate.
- Ausnahmequote je Lieferant.
- Anteil fristgerecht freigegebener Rechnungen.
- Anteil Rechnungen mit manuellem Rework.

## 11. Nicht-funktionale Anforderungen
- Nachvollziehbarkeit:
  - 100 Prozent Auditierbarkeit kritischer Aktionen.
- Zuverlaessigkeit:
  - Idempotente Ingestion pro Quelle.
- Sicherheit:
  - AuthN/AuthZ fuer alle Endpunkte.
  - Verschluesselung in Transit.
  - Geheimnisse in der Datenbank nur verschluesselt speichern (z. B. Provider-Keys).
- DSGVO-Konformitaet:
  - Datenminimierung und Zweckbindung pro verarbeitetem Feld.
  - Rollen- und Berechtigungskonzepte fuer Zugriff auf personenbezogene Daten.
  - Loesch- und Aufbewahrungskonzepte (inkl. technischer Loeschprozesse).
  - Auskunfts- und Exportfaehigkeit fuer betroffene personenbezogene Daten.
  - Protokollierte Verarbeitungsvorgaenge fuer Revisions- und Nachweispflichten.
- Wartbarkeit:
  - Klare Servicegrenzen und API-Vertraege.
- Beobachtbarkeit:
  - Metriken, Logs, Traces je Service.

## 12. Umsetzungsphasen

### Phase 1: Fundament
- Ingestion aus Mail, REST, MinIO.
- Kanonisches Rechnungsmodell.
- Audit und Lineage.

### Phase 2: Ontologie und UI
- Objektmodell und Beziehungen.
- Rechnungs- und Graph-Ansicht.

### Phase 3: Operations
- Vollstaendiger Freigabe-Workflow.
- Aktionen und Write-back in Supabase.

### Phase 4: Skalierung und AI
- Erweiterte Anomalieerkennung.
- Assistive Funktionen fuer Fachbereiche.

## 13. Akzeptanzkriterien fuer MVP-Go-Live
- Drei Quellen stabil integriert (Mail, REST, MinIO).
- Kernworkflow laeuft Ende-zu-Ende mit Rollenrechten.
- Write-back in Supabase fuer alle Kernaktionen aktiv.
- Audit-Log und Lineage fuer zentrale Objekte vorhanden.
- KPI-Dashboard zeigt operative Basiskennzahlen.
- User-Verwaltung und Admin-UI sind nutzbar.
- Provider-/Connector-Konfiguration ist ohne Redeploy ueber Admin-UI aenderbar.
- DSGVO-Basisanforderungen sind umgesetzt und dokumentiert (TOMs, Loeschkonzept, Auskunftsprozess).

## 14. Offene Entscheidungen (naechster Schritt)
- Exakte Startwerte fuer Freigaberegeln (Betragsgrenzen, 4-Augen-Prinzip); technisch aber voll konfigurierbar ueber Admin-UI.
- SLA-Zeiten je Status/Falltyp; technisch konfigurierbar ueber Admin-UI.
- REST-Connector-Details (Auth-Verfahren, Ratelimits, Retry-Politik).
- Zielbild fuer Umgebungen nach Dev (Staging/Prod) und finale Go-Live-Kriterien.

## 16. Entscheidungsstand (aktuell)
- Stack: wie `ressourcenmanagement` und `stammdatenmanagement` (FastAPI Backend, React+Vite Frontend).
- Graph-Engine: Neo4j Community unter Coolify.
- Login: `username`.
- Admin-Oberflaeche/User-Verwaltung: verbindlich im MVP.
- Freigabe-Regeln: ueber Admin-UI konfigurierbar.
- DSGVO-relevante Betriebsparameter (Retention/Loeschung/DSR): ueber Admin-UI konfigurierbar.
- Connector-Parameter (Mail/REST/MinIO): ueber Admin-UI konfigurierbar.
- Umgebung: aktuell nur Dev; Staging/Prod spaeter zu definieren.
- Umsetzungsreihenfolge Quellen: initial nur MinIO aktiv.

## 17. Implementierungsstand (aktueller Code)
- Projektgrundgeruest erstellt:
  - `backend/` (FastAPI)
  - `frontend/` (React + Vite)
  - `supabase/schema.sql`
  - `docker-compose.coolify.yml`
- Backend bereits umgesetzt:
  - Registrierung (`/api/auth/register`)
  - Username-Login (`/api/auth/login`)
  - Logout-Endpoint (`/api/auth/logout`)
  - `me` Endpoint (`/api/auth/me`)
  - Graph-Healthcheck (`/api/health/graph`) mit Neo4j Query-Test (`RETURN 1`)
  - Admin-Bootstrap via `ADMIN_USERNAME`/`ADMIN_PASSWORD`
  - Admin-User APIs (`GET/POST/PATCH /api/admin/users`)
  - Connector-Config APIs (`GET/PUT/POST-test /api/admin/config/connectors/...`)
  - Basis-Audit-Logging fuer Login, User-Admin-Aktionen und Connector-Aenderungen
  - MinIO Ingestion Endpoint (`POST /api/ingestion/minio/pull`) mit idempotenter Dokumentanlage
  - Dokumentliste Endpoint (`GET /api/documents`)
  - Extraktions-Endpoint (`POST /api/processing/documents/extract`) fuer INGESTED->EXTRACTED (Mistral OCR bei PDF/Bild)
  - Invoice-Mapping Endpoint (`POST /api/processing/invoices/map`) fuer EXTRACTED->MAPPED via Mistral-LLM-Extraktion (strukturierter JSON-Output) in eigene Rechnungstabellen
  - Invoice-Validation Endpoint (`POST /api/processing/invoices/validate`) fuer MAPPED->VALIDATED/NEEDS_REVIEW
  - Rechnungsliste Endpoint (`GET /api/invoices`)
  - Rechnungsdetail Endpunkte (`GET /api/invoices/{id}`, `GET /api/invoices/{id}/lines`) fuer Anwenderansicht
  - Dokument-Preview Endpoint (`GET /api/invoices/{id}/document`) fuer PDF/Bild-Vorschau in der Inbox
  - Workflow-Endpunkte fuer Anwenderaktionen (`POST /api/invoices/{id}/approve|reject|hold|request-clarification`) inkl. Aktionshistorie (`GET /api/invoices/{id}/actions`)
  - Case-Endpunkte fuer Rueckfragen (`GET /api/invoices/{id}/cases`, `PATCH /api/cases/{id}`), inkl. automatischer Case-Anlage bei `request-clarification`
  - Graph-Endpunkte fuer Rechnungssubgraph (`GET /api/graph/invoices/{id}`) und Sync (`POST /api/graph/sync/invoices/{id}`, `POST /api/graph/sync/invoices`)
  - Globaler Graph-Endpunkt fuer Admin (`GET /api/graph/global?max_nodes=&max_edges=`)
  - Provider-Config Endpunkte (`GET/PUT /api/admin/config/providers/...`) fuer Key-Verwaltung via Admin-UI
  - Extraktionsfeld-Config Endpunkte (`GET/POST /api/admin/config/extraction-fields`) fuer LLM-Feldkatalog
  - Workflow-Regel Endpunkte (`GET/PUT /api/admin/config/workflow-rules`) fuer serverseitige Freigabelogik
  - Graph-Config Endpunkte (`GET/PUT /api/admin/config/graph`) fuer konfigurierbare Datenebenen-Felder
  - KPI-Endpoint (`GET /api/admin/kpi/overview`) fuer operative Admin-Uebersicht
  - Global-Reset Endpoint (`POST /api/admin/reset/invoice-pipeline`) fuer komplettes Reprocessing inkl. optionalem Neo4j-Reset
- Frontend bereits umgesetzt:
  - Login-/Registrierungs-View
  - Logout im Admin-Header
  - Basis-Admin-View fuer User-Liste und User-Anlage
  - MinIO-Admin-UI (Connector speichern/testen, Pull ausloesen, Dokumentliste, OCR/Extract, Invoice Mapping, Invoice Validation)
  - Provider-Admin-UI fuer Mistral Key (aktivieren/rotieren)
  - Admin-UI fuer konfigurierbare Extraktionsfelder (Header/Line-Items mit Feldname + Beschreibung + Datentyp), inkl. Inline-Bearbeitung bestehender Felder
  - Admin-UI fuer Workflow-Regeln (formularbasiert) inkl. Runtime-Update ohne Redeploy
  - Admin-KPI-Panel (Dokumente/Rechnungen, Statusverteilungen, offene Cases, Freigaben 24h)
  - Admin-Danger-Zone fuer globalen Pipeline-Reset (Dokumente/Rechnungen/Positionen/Aktionen/Cases)
  - Admin-Dashboard tab-basiert (statt langer vertikaler Seite); Meldungen/Fehler werden oben unter dem Header angezeigt
  - Anwenderoberflaeche (AP-Inbox) fuer Nicht-Admin-User mit 3-Spalten-Layout: Liste links, Rechnungsdaten Mitte, PDF/Bild-Vorschau rechts
  - Anwenderaktionen im Detail (`Approve`, `Reject`, `Hold`, `Clarify`) mit Kommentar und Timeline
  - Cases/Rueckfragen je Rechnung mit Statussteuerung (`OPEN`, `IN_PROGRESS`, `RESOLVED`, `CLOSED`)
  - Sichtbarkeit konfigurierter Extraktionsfelder in der Inbox je Rechnung ("Extrahierte Felder (Header)" mit Wert + LLM-Indikator)
  - Graph-Nutzbarkeit in der Inbox: interaktive Subgraph-Ansicht mit Knoten/Kanten, Zoom/Pan und Knotendetails pro Rechnung; Knotenauswahl markiert passende Positionen/Aktionen
  - Graph-Darstellung ist in Layer getrennt umschaltbar: Datenebene / Anwendungsebene / Alles
  - Felder der Graph-Datenebene sind ueber Admin konfigurierbar und steuern, welche gemeinsamen Feldwerte Rechnungen verknuepfen
  - Empfaenger-Felder in der Datenebene laufen ueber Entity-Resolution (Normalisierung + Alias-Mapping + Fuzzy-Match), damit Namensvarianten auf einen kanonischen Node gemappt werden
  - Admin-Aktion fuer Bulk-Graph-Synchronisation nach Neo4j
  - Admin-Ansicht kann zusaetzlich einen globalen Graph-Ausschnitt laden und visualisieren
  - Inbox-Design an Referenz "View Invoices" angeglichen (3-spaltig: Liste links, Rechnungsdaten Mitte, PDF/Bild rechts)
- Graph-Engine:
  - Neo4j als Service in Coolify-Compose vorgesehen
  - Rechnungssubgraph wird aus relationalen Daten (Invoice, Supplier, Line-Items, Actions, User, Status) aufgebaut.
- Datenbank-Namespace:
  - Eigene Tabellen fuer insAIghts (`insaights_*`) zur Vermeidung von Kollisionen mit anderen Anwendungen.
  - Rechnungsverarbeitung persistiert in `insaights_invoices` und `insaights_invoice_lines` (keine Fremdtabellen anderer Apps).
  - `insaights_invoice_lines` wird im Mapping-Schritt mit durch das Sprachmodell extrahierten Positionen befuellt.
  - Feldkatalog fuer Extraktion wird in `insaights_config_extraction_fields` gepflegt und zur Prompt-Erstellung genutzt.
  - Workflow-Aktionshistorie wird in `insaights_invoice_actions` gespeichert.
  - Case-Management wird in `insaights_invoice_cases` gespeichert.
  - Freigaberegeln werden in `insaights_config_workflow_rules` gepflegt und in `approve` serverseitig erzwungen.

## 15. Dokumentations-Governance (verbindlich)
- Dokumentation wird bei jeder fachlichen oder technischen Aenderung im selben Arbeitsschritt aktualisiert.
- Aenderungen an APIs, Datenmodell, Rollen, Workflows oder Konfigurationen gelten erst als abgeschlossen, wenn die zugehoerigen Doku-Dateien angepasst sind.
- Mindestens folgende Dateien sind synchron zu halten:
  - `dokumentation-rechnungsverarbeitung-mvp.md`
  - `roadmap-12-monate-plattform.md`
  - `sprintplan-q1-rechnungsverarbeitung.md`
  - `admin-feature-spezifikation.md`
- Jede Sprint-Abnahme prueft explizit den Doku-Stand als DoD-Kriterium.

## 18. Verifizierter Status (Stand: 04.03.2026)
- E2E-MinIO-Flow laeuft: Pull -> OCR/Extract -> Mapping -> Validation -> User-Workflow.
- User-Inbox inkl. PDF/Bild-Vorschau und Actions-Timeline ist produktiv im Dev-Stand vorhanden.
- LLM-Feldextraktion ist ueber Admin-UI konfigurierbar (Feldname + Beschreibung + Typ + Pflicht + Aktiv + Reihenfolge).
- Offene Schwerpunkte fuer naechste Iteration:
  - Mail- und REST-Ingestion umsetzen.
  - Graph-/Ontologie-Schicht auf weitere Objektklassen erweitern (PO, GoodsReceipt, Case) und Graph-Visualisierung vertiefen.
  - DSGVO-Betriebsprozesse (Retention/DSR) technisch operationalisieren.
