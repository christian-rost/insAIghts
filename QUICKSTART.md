# Quickstart insAIghts

Stand: 08.03.2026

## 1. Ziel
Dieser Guide bringt dich schnell von 0 auf einen lauffaehigen Stand mit:
- Login
- MinIO Pull
- OCR/Parsing
- Mapping
- Validation
- Inbox + Graph

## 2. Voraussetzungen
- Supabase Projekt + SQL Schema aus `supabase/schema.sql`
- Neo4j erreichbar (z. B. `bolt://neo4j:7687`)
- MinIO Bucket mit Testrechnungen
- Mistral API Key
- Docker/Coolify oder lokale Python/Node Runtime

## 3. Minimal-Konfiguration (Env)
Pflicht in Coolify oder lokal `.env`:
- `SUPABASE_URL`
- `SUPABASE_KEY`
- `JWT_SECRET`
- `CORS_ORIGINS`
- `ADMIN_USERNAME`
- `ADMIN_PASSWORD`
- `VITE_API_BASE` (Frontend -> Backend URL)
- `GRAPH_DB_URI`
- `GRAPH_DB_USER`
- `GRAPH_DB_PASSWORD`
- Optional: `PROVIDER_KEY_ENCRYPTION_KEY` (Fernet-Key fuer verschluesselte Provider-Keys in DB)

Hinweis:
- Mistral API Key nicht als Env pflegen, sondern in Admin-UI unter Provider.

## 4. Lokal starten
1. Backend:
   - `cd backend`
   - `pip install -r requirements.txt`
   - `uvicorn app.main:app --reload --host 0.0.0.0 --port 8000`
2. Frontend:
   - `cd frontend`
   - `npm install`
   - `npm run dev`

## 5. Erst-Inbetriebnahme (Admin)
1. Login mit `ADMIN_USERNAME` / `ADMIN_PASSWORD`.
2. Tab `Provider`:
   - Mistral aktivieren
   - API Key setzen
3. Tab `MinIO Pipeline`:
   - Endpoint, Access Key, Secret Key, Bucket, Prefix setzen
   - Connector aktivieren und speichern
   - `Testen` ausfuehren

## 6. Pipeline testen
Variante A (empfohlen):
1. Im Tab `MinIO Pipeline` auf `One-Click Pipeline Run`.

Variante B (manuell):
1. `Pull ausfuehren`
2. `OCR/Extract`
3. `Invoice Mapping`
4. `Invoice Validation`
5. `Graph Sync`

Erwartung:
- Dokumente in `insaights_documents`
- Rechnungen in `insaights_invoices`
- Positionen in `insaights_invoice_lines`

## 7. Inbox testen (User)
1. Mit normalem User einloggen (kein ADMIN).
2. Rechnung in der Liste oeffnen.
3. Aktionen testen:
   - `Approve`
   - `Reject`
   - `Hold`
   - `Request Clarification`
4. Rechts PDF-Vorschau und unten Graph pruefen.

## 8. Graph testen
- Admin Tab `Graph`:
  - `Sync alle Rechnungen`
  - `Global Graph laden`
- In Inbox:
  - Rechnung auswaehlen
  - `Graph neu laden`
  - Node anklicken -> direkte Nachbarn werden hervorgehoben
  - Node mit Click+Hold verschieben

## 9. Alias testen (generisch)
Im Admin Tab `Graph`:
1. Bei `Attribute Alias Review` ein Attribut setzen, z. B. `empfaenger`.
2. Alias anlegen, z. B. `Rost, Christian` -> `Christian Rost`.
3. `Sync alle Rechnungen` erneut ausfuehren.
4. Graph auf zusammengefuehrte Knoten pruefen.

## 10. Reset fuer Reprocessing
Wenn neue Extraktionsfelder hinzugefuegt wurden:
1. Admin Tab `Reset`
2. `reset_graph=true`
3. Pipeline erneut starten (`Pull` -> `Extract` -> `Map` -> `Validate` -> `Graph Sync`)

Alternative ohne Global-Reset:
1. Admin Tab `MinIO Pipeline` -> betroffene Dokumente markieren
2. `Auswahl reprocess` klicken

## 11. Smoke-Checks
- `GET /api/health`
- `GET /api/health/graph`
- Login im Frontend
- Mindestens 1 valide Rechnung in Inbox sichtbar
