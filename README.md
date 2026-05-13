# insAIghts

Stand: 09.03.2026

insAIghts ist eine Daten- und Operationsplattform fuer Rechnungsverarbeitung mit:
- FastAPI Backend
- React/Vite Frontend
- Supabase (relationale Daten + Konfiguration + Audit)
- Neo4j (Graph-Schicht)

## Doku-Index
- Produkt-/Architektur-Doku: `dokumentation-rechnungsverarbeitung-mvp.md`
- Admin-Feature-Spezifikation: `admin-feature-spezifikation.md`
- User-Dokumentation: `USER-DOKUMENTATION.md`
- Admin-Dokumentation: `ADMIN-DOKUMENTATION.md`
- Quickstart: `QUICKSTART.md`
- Neo4j in Coolify: `installation-neo4j-coolify.md`
- Roadmap: `roadmap-12-monate-plattform.md`
- Sprintplan: `sprintplan-q1-rechnungsverarbeitung.md`
- Anforderungen: `anforderungen.md`
- Graph AB-Prozess: `konzept-graph-auftragsbestaetigung.md`

## Aktueller Funktionsumfang
- Auth mit `username/password` (+ Self-Registration)
- Admin-Dashboard mit Tabs
- Admin-Audit-Tab mit Filterung und Event-Einsicht
- User-Management
- Provider-Management (Mistral Key ueber UI)
- MinIO als aktuell einzige produktive Quelle
- OCR/Parsing + Extraktion ueber Mistral
- Konfigurierbare Extraktionsfelder (header/line_item) mit technischem Feldnamen, Anzeigename und Prompt-Beschreibung
- Mapping + Validation + Workflow-Aktionen
- Inbox fuer Nicht-Admin-User
- Inbox-Detail mit einklappbaren Header-Extrakten und Positionen direkt darunter
- Inbox-Aktionsbereich mit 2-zeiligem Layout (Kommentarzeile + Buttonzeile)
- Modernisierte Inbox-UX mit Sticky Header/Filter, Segment-Tabs, Summary-Karten, Sticky-Aktionsleiste und fokussierter Dokumentvorschau
- Graph-Funktion in Inbox + Admin
- Graph-Fragefunktion (LLM-gestuetzte Cypher-Interpretation mit sichtbarer Query)
- Graph-Steuerungen fuer bessere Lesbarkeit (Auto-Labels, Detail-Filter, Top-N-Positionen-Clustering, Min-Degree)
- Inbox-Graph blendet unverbundene Fremdknoten aus und zeigt nur die Komponente der gewaehlten Rechnung
- Generische Alias-Verwaltung pro Attribut (`entity_type`)
- Graph-Auswertungen im Admin-Tab (Risiko, Empfaenger, Produkte, Status, Anomalien)
- KPI-Dashboard V1 (Trend 14 Tage, Touchless-Rate, Ausnahmequoten)
- Globaler Reset fuer Reprocessing
- One-Click Pipeline Run (Pull -> Extract -> Map -> Validate -> Graph)
- One-Click Pipeline Run mit Live-Statusanzeige pro Schritt
- Reprocessing markierter Dokumente ohne Global-Reset
- Loeschantrag-Workflow (User anfragen, Admin freigeben/ablehnen)
- Audit-Logging fuer operative und Admin-relevante Events

## Implementierte API-Endpunkte (Auszug)
- Health:
  - `GET /api/health`
  - `GET /api/health/graph`
- Auth:
  - `POST /api/auth/login`
  - `POST /api/auth/register`
  - `POST /api/auth/logout`
  - `GET /api/auth/me`
- Admin:
  - `GET /api/admin/users`
  - `POST /api/admin/users`
  - `PATCH /api/admin/users/{user_id}`
  - `GET /api/admin/config/providers`
  - `PUT /api/admin/config/providers/{provider_name}`
  - `GET /api/admin/config/connectors`
  - `PUT /api/admin/config/connectors/{connector_name}`
  - `POST /api/admin/config/connectors/{connector_name}/test`
  - `GET /api/admin/config/extraction-fields`
  - `POST /api/admin/config/extraction-fields`
  - `GET /api/admin/config/workflow-rules`
  - `PUT /api/admin/config/workflow-rules`
  - `GET /api/admin/config/graph`
  - `PUT /api/admin/config/graph`
  - `GET /api/admin/graph/aliases?entity_type=...`
  - `POST /api/admin/graph/aliases`
  - `PUT /api/admin/graph/aliases/{alias_id}`
  - `GET /api/admin/graph/insights?limit=...`
  - `GET /api/admin/graph/insights/trends?window_days=...&compare_days=...&granularity=day|week|month`
  - `GET /api/admin/graph/insights/drilldown?metric=...&period_start=YYYY-MM-DD&period_end=YYYY-MM-DD`
  - `GET /api/admin/graph/insights/explain?window_days=...&compare_days=...&granularity=...&limit=...`
  - `GET /api/admin/kpi/overview`
  - `GET /api/admin/audit/events?limit=...`
  - `POST /api/admin/pipeline/run`
  - `POST /api/admin/reprocess/documents`
  - `GET /api/admin/delete-requests?status=...&limit=...`
  - `POST /api/admin/delete-requests/{request_id}/approve`
  - `POST /api/admin/delete-requests/{request_id}/reject`
  - `POST /api/admin/reset/invoice-pipeline`
- Pipeline:
  - `POST /api/ingestion/minio/preview`
  - `POST /api/ingestion/minio/pull`
  - `POST /api/processing/documents/extract`
  - `POST /api/processing/invoices/map`
  - `POST /api/processing/invoices/validate`
- Operative Nutzung:
  - `GET /api/documents`
  - `DELETE /api/admin/documents/{document_id}` (ADMIN)
  - `GET /api/invoices`
  - `GET /api/invoices/{invoice_id}`
  - `GET /api/invoices/{invoice_id}/lines`
  - `GET /api/invoices/{invoice_id}/actions`
  - `GET /api/invoices/{invoice_id}/document`
  - `POST /api/invoices/{invoice_id}/approve`
  - `POST /api/invoices/{invoice_id}/reject`
  - `POST /api/invoices/{invoice_id}/hold`
  - `POST /api/invoices/{invoice_id}/request-clarification`
  - `POST /api/invoices/{invoice_id}/delete-request`
  - `GET /api/invoices/{invoice_id}/cases`
  - `PATCH /api/cases/{case_id}`
- Graph:
  - `GET /api/graph/invoices/{invoice_id}`
  - `GET /api/graph/global`
  - `POST /api/graph/query`
  - `POST /api/graph/sync/invoices/{invoice_id}`
  - `POST /api/graph/sync/invoices`

## Tabellen (Supabase)
- `insaights_users`
- `insaights_admin_audit_log`
- `insaights_config_connectors`
- `insaights_config_provider_keys`
- `insaights_config_extraction_fields`
- `insaights_config_workflow_rules`
- `insaights_config_graph`
- `insaights_recipient_aliases`
- `insaights_documents`
- `insaights_invoices`
- `insaights_invoice_lines`
- `insaights_invoice_actions`
- `insaights_invoice_cases`
- `insaights_document_delete_requests`

## Lokal starten
1. `.env.example` nach `.env` kopieren.
2. Backend starten:
   - `cd backend`
   - `pip install -r requirements.txt`
   - `uvicorn app.main:app --reload --host 0.0.0.0 --port 8000`
3. Frontend starten:
   - `cd frontend`
   - `npm install`
   - `npm run dev`

## Coolify (Kurz)
- Deployment via `docker-compose.coolify.yml`
- Details in `QUICKSTART.md` und `installation-neo4j-coolify.md`

## Wichtige Hinweise
- Mistral API Key wird in der Admin-UI gepflegt, nicht ueber Coolify Env.
- Optional: `PROVIDER_KEY_ENCRYPTION_KEY` fuer verschluesselte Provider-Keys at-rest.
- MinIO ist aktuell die einzige aktiv genutzte Ingestion-Quelle.
- Architektur ist auf weitere Connectoren (Mail/REST) vorbereitet.
- Mail- und REST-Connector sind aktuell explizit zurueckgestellt (Backlog nach Q1-Stabilisierung).
