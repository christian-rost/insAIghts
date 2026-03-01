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
- `POST /api/auth/login`
- `GET /api/auth/me`
- `GET /api/admin/users` (ADMIN)
- `POST /api/admin/users` (ADMIN)
- `PATCH /api/admin/users/{user_id}` (ADMIN)
- `GET /api/admin/config/connectors` (ADMIN)
- `PUT /api/admin/config/connectors/{connector_name}` (ADMIN)
- `POST /api/admin/config/connectors/{connector_name}/test` (ADMIN)

## Coolify

Fuer Coolify kann `docker-compose.coolify.yml` verwendet werden.
Die Neo4j-Installation ist in `installation-neo4j-coolify.md` dokumentiert.
