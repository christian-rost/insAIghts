# insAIghts

Startpunkt fuer die insAIghts-Plattform mit:
- FastAPI Backend (Username-Login, Admin-Bootstrap, User-Management APIs)
- React + Vite Frontend (Login + Admin-Basisoberflaeche)
- Neo4j (Graph-Engine) fuer Ontologie/Beziehungen

## Lokal starten

1. `.env.example` nach `.env` kopieren und Werte setzen.
2. Backend starten:
   - `cd backend`
   - `pip install -r requirements.txt`
   - `uvicorn app.main:app --reload --host 0.0.0.0 --port 8000`
3. Frontend starten:
   - `cd frontend`
   - `npm install`
   - `npm run dev`

## Wichtige Endpunkte

- `GET /api/health`
- `GET /api/health/graph`
- `GET /api/graph/invoices/{invoice_id}`
- `POST /api/graph/sync/invoices/{invoice_id}` (ADMIN)
- `POST /api/graph/sync/invoices` (ADMIN)
- `POST /api/auth/register`
- `POST /api/auth/login`
- `POST /api/auth/logout`
- `GET /api/auth/me`
- `GET /api/admin/users` (ADMIN)
- `POST /api/admin/users` (ADMIN)
- `PATCH /api/admin/users/{user_id}` (ADMIN)
- `GET /api/admin/config/connectors` (ADMIN)
- `GET /api/admin/config/providers` (ADMIN)
- `PUT /api/admin/config/providers/{provider_name}` (ADMIN)
- `GET /api/admin/config/extraction-fields` (ADMIN)
- `POST /api/admin/config/extraction-fields` (ADMIN)
- `GET /api/admin/config/workflow-rules` (ADMIN)
- `PUT /api/admin/config/workflow-rules` (ADMIN)
- `GET /api/admin/kpi/overview` (ADMIN)
- `PUT /api/admin/config/connectors/{connector_name}` (ADMIN)
- `POST /api/admin/config/connectors/{connector_name}/test` (ADMIN)
- `POST /api/ingestion/minio/pull` (ADMIN)
- `POST /api/processing/documents/extract` (ADMIN)
- `POST /api/processing/invoices/map` (ADMIN)
- `POST /api/processing/invoices/validate` (ADMIN)
- `GET /api/documents`
- `GET /api/invoices`
- `GET /api/invoices/{invoice_id}`
- `GET /api/invoices/{invoice_id}/lines`
- `GET /api/invoices/{invoice_id}/actions`
- `GET /api/invoices/{invoice_id}/document`
- `POST /api/invoices/{invoice_id}/approve`
- `POST /api/invoices/{invoice_id}/reject`
- `POST /api/invoices/{invoice_id}/hold`
- `POST /api/invoices/{invoice_id}/request-clarification`
- `GET /api/invoices/{invoice_id}/cases`
- `PATCH /api/cases/{case_id}`

## Supabase Tabellen
- `insaights_users`
- `insaights_admin_audit_log`
- `insaights_config_connectors`
- `insaights_config_provider_keys`
- `insaights_config_extraction_fields`
- `insaights_config_workflow_rules`
- `insaights_documents`
- `insaights_invoices`
- `insaights_invoice_lines`
- `insaights_invoice_actions`
- `insaights_invoice_cases`

Hinweis:
- Die Anwendung nutzt bewusst keine generischen `app_*` Tabellen mehr.
- Falls in einem geteilten Supabase-Projekt bereits `app_users` angepasst wurde:
  - `supabase/reset_app_users_to_legacy.sql` ausfuehren.

## MinIO Ingestion V1
- Quelle aktuell: nur MinIO.
- Mail- und REST-Connectoren sind im Zielbild enthalten, aber noch nicht implementiert.
- MinIO-Connector muss in Admin-Config aktiviert sein (`enabled=true`).
- Erwartete `config_json`-Felder fuer Connector `minio`:
  - `endpoint` (nur Host[:Port], ohne Pfad; `https://...` ist erlaubt, Pfad aber nicht)
  - `access_key`
  - `secret_key`
  - `bucket`
  - optional: `prefix`, `secure` (default `true`)
- Die Admin-Oberflaeche enthaelt dafuer eine MinIO-Sektion (Speichern/Testen/Pull + Dokumentliste + OCR/Extract + Invoice Mapping + Invoice Validation).
- Mistral API Key wird ausschliesslich ueber die Admin-Oberflaeche gepflegt (`Provider (Mistral)`), nicht ueber Coolify-Env.
- Feldextraktion fuer Rechnungen erfolgt im Mapping-Schritt modellbasiert ueber Mistral (strukturierter JSON-Output), nicht ueber starre Regex.
- Welche Felder extrahiert werden, ist in der Admin-Oberflaeche konfigurierbar (`field_name`, `description`, `data_type`, `required`, `enabled`, `scope=header|line_item`).
- Bestehende Extraktionsfelder koennen in der Tabelle direkt inline bearbeitet und zeilenweise gespeichert werden.
- Die Tabelle zeigt pro Feld einen Status (`gespeichert` / `ungespeichert`), damit Aenderungen vor dem Speichern sichtbar sind.
- Erkannte Rechnungspositionen werden in `insaights_invoice_lines` gespeichert.
- Freigaben (`approve`) werden serverseitig gegen konfigurierbare Workflow-Regeln geprueft (Betragsgrenzen, Rollen, optional 4-Augen).
- Workflow-Regeln werden in der Admin-UI formularbasiert gepflegt (kein JSON-Editor mehr): 4-Augen, VALIDATED-Pflicht, Betragsgrenzen, Lieferanten-Overrides.

## Anwenderoberflaeche (Inbox)
- Nicht-Admin-User sehen automatisch die AP-Inbox statt der Admin-Konsole.
- Inbox umfasst:
  - Filter nach Status
  - Suche nach Lieferant/Rechnungsnummer
  - Rechnungsdetailansicht
  - Dokumentvorschau (PDF/Bild) in rechter Spalte
  - Positionen (Line-Items) aus `insaights_invoice_lines`
  - Operative Workflow-Aktionen `approve/reject/hold` mit Kommentar
  - Rueckfrage-Aktion `request_clarification` mit automatischer Case-Anlage
  - Aktions-Timeline je Rechnung
  - Case-Tabelle pro Rechnung mit Statussteuerung (`OPEN`, `IN_PROGRESS`, `RESOLVED`, `CLOSED`)
- Layout wurde an die Referenzansicht "View Invoices" angepasst (3-Spalten-Ansicht: links Liste, Mitte Rechnungsdaten, rechts Dokumentvorschau).
- Graph-Schicht ist nutzbar: Invoice-Subgraph kann pro Rechnung geladen werden; Admin kann Bulk-Sync nach Neo4j ausfuehren.
- In der Inbox wird der Invoice-Subgraph interaktiv dargestellt (Nodes/Edges, Zoom/Pan, Knotendetails); Knoten-Auswahl hebt passende Positionen/Aktionen hervor.

## Coolify

Fuer Coolify kann `docker-compose.coolify.yml` verwendet werden.
Die Neo4j-Installation ist in `installation-neo4j-coolify.md` dokumentiert.

### Coolify Quickstart
1. In Coolify `New Resource` -> `Docker Compose` waehlen.
2. Repository `https://github.com/christian-rost/insAIghts` verbinden.
3. `docker-compose.coolify.yml` als Compose-Datei verwenden.
4. Folgende Variablen setzen:
   - `JWT_SECRET`
   - `CORS_ORIGINS` (Frontend-URL)
   - `SUPABASE_URL`
   - `SUPABASE_KEY`
   - `ADMIN_USERNAME`
   - `ADMIN_PASSWORD`
   - `VITE_API_BASE` (Backend-URL, z. B. `https://api.deinedomain.tld`)
   - `GRAPH_DB_URI` (default `bolt://neo4j:7687`)
   - `GRAPH_DB_USER` (default `neo4j`)
   - `GRAPH_DB_PASSWORD`
5. Deploy starten.
6. Nach Deploy pruefen:
   - `GET /api/health` am Backend
   - Frontend-Login mit Bootstrap-Admin

Hinweis:
- In Coolify bei Compose-Services keine festen Host-Ports fuer Web-Services erzwingen.
- Domains/Ingress in Coolify steuern den Zugriff; Compose nutzt intern `expose`.
