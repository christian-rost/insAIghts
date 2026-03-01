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
- `POST /api/auth/register`
- `POST /api/auth/login`
- `GET /api/auth/me`
- `GET /api/admin/users` (ADMIN)
- `POST /api/admin/users` (ADMIN)
- `PATCH /api/admin/users/{user_id}` (ADMIN)
- `GET /api/admin/config/connectors` (ADMIN)
- `PUT /api/admin/config/connectors/{connector_name}` (ADMIN)
- `POST /api/admin/config/connectors/{connector_name}/test` (ADMIN)

## Supabase Tabellen
- `insaights_users`
- `insaights_admin_audit_log`
- `insaights_config_connectors`

Hinweis:
- Die Anwendung nutzt bewusst keine generischen `app_*` Tabellen mehr.
- Falls in einem geteilten Supabase-Projekt bereits `app_users` angepasst wurde:
  - `supabase/reset_app_users_to_legacy.sql` ausfuehren.

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
   - `GRAPH_DB_PASSWORD`
5. Deploy starten.
6. Nach Deploy pruefen:
   - `GET /api/health` am Backend
   - Frontend-Login mit Bootstrap-Admin

Hinweis:
- In Coolify bei Compose-Services keine festen Host-Ports fuer Web-Services erzwingen.
- Domains/Ingress in Coolify steuern den Zugriff; Compose nutzt intern `expose`.
