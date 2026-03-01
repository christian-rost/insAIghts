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
- `POST /api/auth/register`
- `POST /api/auth/login`
- `POST /api/auth/logout`
- `GET /api/auth/me`
- `GET /api/admin/users` (ADMIN)
- `POST /api/admin/users` (ADMIN)
- `PATCH /api/admin/users/{user_id}` (ADMIN)
- `GET /api/admin/config/connectors` (ADMIN)
- `PUT /api/admin/config/connectors/{connector_name}` (ADMIN)
- `POST /api/admin/config/connectors/{connector_name}/test` (ADMIN)
- `POST /api/ingestion/minio/pull` (ADMIN)
- `POST /api/processing/documents/extract` (ADMIN)
- `GET /api/documents`

## Supabase Tabellen
- `insaights_users`
- `insaights_admin_audit_log`
- `insaights_config_connectors`
- `insaights_documents`

Hinweis:
- Die Anwendung nutzt bewusst keine generischen `app_*` Tabellen mehr.
- Falls in einem geteilten Supabase-Projekt bereits `app_users` angepasst wurde:
  - `supabase/reset_app_users_to_legacy.sql` ausfuehren.

## MinIO Ingestion V1
- Quelle aktuell: nur MinIO.
- MinIO-Connector muss in Admin-Config aktiviert sein (`enabled=true`).
- Erwartete `config_json`-Felder fuer Connector `minio`:
  - `endpoint` (nur Host[:Port], ohne Pfad; `https://...` ist erlaubt, Pfad aber nicht)
  - `access_key`
  - `secret_key`
  - `bucket`
  - optional: `prefix`, `secure` (default `true`)
- Die Admin-Oberflaeche enthaelt dafuer eine MinIO-Sektion (Speichern/Testen/Pull + Dokumentliste + OCR/Extract).

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
   - `MISTRAL_API_KEY` (fuer OCR/Extract von PDF/Bild)
5. Deploy starten.
6. Nach Deploy pruefen:
   - `GET /api/health` am Backend
   - Frontend-Login mit Bootstrap-Admin

Hinweis:
- In Coolify bei Compose-Services keine festen Host-Ports fuer Web-Services erzwingen.
- Domains/Ingress in Coolify steuern den Zugriff; Compose nutzt intern `expose`.
