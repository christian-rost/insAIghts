# Admin-Feature-Spezifikation (MVP)

## 1. Ziel
Diese Spezifikation definiert die Admin Control Plane fuer Benutzerverwaltung, Rechte und Runtime-Konfiguration. Ziel ist, fachliche und operative Parameter ueber die Admin-Oberflaeche zu steuern statt ueber Coolify-Environment-Variablen.

## 2. Leitprinzipien
- So wenig Env wie moeglich, so viel Admin-UI wie sinnvoll.
- Jede Admin-Aktion ist revisionssicher auditiert.
- Secrets werden verschluesselt gespeichert und maskiert angezeigt.
- Aenderungen gelten ohne Redeploy (Runtime Reload/Config Cache).
- Secure-by-Design und DSGVO-by-Design sind verbindlich fuer alle Admin-Funktionen.

## 3. Rollenmodell
- `ADMIN`: Vollzugriff auf Benutzer, Rollen, Konfiguration, Audit.
- `AUDITOR`: Lesender Zugriff auf Audit, keine aendernden Admin-Aktionen.
- `APPROVER`: Fachrolle ohne Zugriff auf globale Admin-Konfiguration.
- `AP_CLERK`: Operative Bearbeitung ohne Admin-Rechte.

## 4. Admin-Bereiche (UI)

## 4.1 Bereich "Benutzer"
### Funktionen
- Benutzerliste mit Suche/Filter (`active`, Rolle, letzte Anmeldung).
- Benutzer anlegen.
- Benutzer bearbeiten (Name, E-Mail, aktiv/inaktiv).
- Rollen zuweisen/entziehen.
- Passwort zuruecksetzen (Admin-Reset-Flow).
- Benutzer deaktivieren/reaktivieren.

### Wichtige Felder
- `user_id`
- `email`
- `display_name`
- `is_active`
- `roles[]`
- `last_login_at`
- `created_at`
- `updated_at`

### Validierungen
- E-Mail eindeutig.
- Mindestens ein aktiver `ADMIN` muss existieren.
- Rollenwechsel wird protokolliert (alt/neu).

## 4.2 Bereich "Provider"
### Funktionen
- Provider-Liste (z. B. Mistral) mit Statusanzeige.
- API-Key setzen/rotieren/deaktivieren.
- Optionaler Verbindungs-Test (health probe).

### Wichtige Felder
- `provider_name` (z. B. `mistral`)
- `is_enabled`
- `key_present` (bool, maskiert)
- `updated_by`
- `updated_at`

### Sicherheitsregeln
- API-Keys nur verschluesselt speichern.
- API-Key nie im Klartext in Responses/Logs.
- Aenderung und Test werden auditiert.

## 4.3 Bereich "Connectoren"
### Funktionen
- Konfiguration von `mail`, `rest`, `minio`.
- Aktivieren/Deaktivieren pro Connector.
- Zeitplaene/Intervalle und Retry-Parameter setzen.
- Testlauf pro Connector ausloesen.

### Beispiel-Felder
- `connector_name`
- `enabled`
- `schedule_cron` oder `poll_interval_seconds`
- `retry_max_attempts`
- `retry_backoff_seconds`
- `timeout_seconds`
- `config_json` (quellspezifisch)

## 4.4 Bereich "Workflow-Regeln"
### Funktionen
- Freigabelimits verwalten.
- Regeln nach Betrag/Kostenstelle/Lieferant steuern.
- SLA-Werte und Eskalationsstufen pflegen.
- Formularbasierte Pflege im Admin-UI (kein JSON-Freitext):
  - `four_eyes`
  - `require_validated_status`
  - `amount_limits[]` mit `max_amount` und `allowed_roles[]`
  - `supplier_role_overrides[]` mit `supplier_name` und `allowed_roles[]`

## 4.5 Bereich "KPI"
### Funktionen
- Operative Uebersicht mit Laufzeitdaten:
  - Gesamtanzahl Dokumente/Rechnungen
  - Rechnungsstatus-Verteilung
  - Case-Status-Verteilung
  - Freigaben letzte 24h
  - Offene Cases

### Beispiel-Felder
- `rule_id`
- `rule_type`
- `priority`
- `condition_json`
- `action_json`
- `is_active`

## 4.6 Bereich "Audit"
### Funktionen
- Ereignisliste mit Filter (Akteur, Event-Typ, Objekt, Zeitraum).
- Detailansicht pro Event (vorher/nachher Delta).
- Export fuer Revision.

### Wichtige Felder
- `event_id`
- `event_type`
- `actor_user_id`
- `target_type`
- `target_id`
- `metadata_json`
- `created_at`

## 5. API-Spezifikation (MVP)

## 5.1 Auth
- Login-Identitaet: `username`
- `POST /auth/login`
- `POST /auth/refresh`
- `POST /auth/logout`

## 5.2 Benutzer
- `GET /admin/users`
- `POST /admin/users`
- `PATCH /admin/users/{id}`
- `POST /admin/users/{id}/reset-password`
- `POST /admin/users/{id}/deactivate`
- `POST /admin/users/{id}/reactivate`

## 5.3 Rollen
- `GET /admin/roles`
- `PUT /admin/users/{id}/roles`

## 5.4 Provider/Secrets
- `GET /admin/config/providers`
- `PUT /admin/config/providers/{provider}`
- `POST /admin/config/providers/{provider}/test`

## 5.5 Connectoren
- `GET /admin/config/connectors`
- `PUT /admin/config/connectors/{connector}`
- `POST /admin/config/connectors/{connector}/test`

## 5.6 Workflow-Regeln
- `GET /admin/config/workflow-rules`
- `PUT /admin/config/workflow-rules`
- Umgesetzt im aktuellen API-Namespace:
  - `GET /api/admin/config/workflow-rules`
  - `PUT /api/admin/config/workflow-rules`

## 5.7 KPI
- `GET /api/admin/kpi/overview`

## 5.8 Audit
- `GET /admin/audit/events`
- `GET /admin/audit/events/{id}`

## 5.9 Aktuell implementierter API-Stand (04.03.2026)
- `GET /api/admin/users`
- `POST /api/admin/users`
- `PATCH /api/admin/users/{id}`
- `GET /api/admin/config/providers`
- `PUT /api/admin/config/providers/{provider}`
- `GET /api/admin/config/connectors`
- `PUT /api/admin/config/connectors/{connector}`
- `POST /api/admin/config/connectors/{connector}/test`
- `GET /api/admin/config/extraction-fields`
- `POST /api/admin/config/extraction-fields`
- `GET /api/admin/config/workflow-rules`
- `PUT /api/admin/config/workflow-rules`
- `GET /api/admin/kpi/overview`

## 6. Datenmodell (Admin)
### Tabellenvorschlag
- `insaights_users`
- `insaights_config_provider_keys` (aktuell gespeichert, Verschluesselung als naechster Hardening-Schritt)
- `insaights_config_connectors`
- `insaights_config_extraction_fields`
- `insaights_admin_audit_log`

### Besonderheiten
- `app_config_provider_keys.key_ciphertext` (encrypted at rest).
- `app_admin_audit_log.diff_before` / `diff_after` fuer Nachvollziehbarkeit.
- Soft-delete bevorzugt fuer Benutzer (`is_active=false`).

## 7. Coolify Env-Minimum
### Pflicht
- `SUPABASE_URL`
- `SUPABASE_KEY`
- `JWT_SECRET`
- `CORS_ORIGINS`
- `ADMIN_USERNAME`
- `ADMIN_PASSWORD`

### Nicht dauerhaft in Env pflegen
- Provider-Keys (z. B. Mistral)
- Connector-Settings
- Fachregeln und SLA

## 8. Bootstrap- und Betriebsablauf
1. Erststart: Wenn kein Admin existiert, Admin aus `ADMIN_USERNAME`/`ADMIN_PASSWORD` anlegen.
2. Erstlogin: Admin setzt produktives Passwort und prueft Rollen.
3. Provider/Connectoren: Konfiguration im Admin-UI hinterlegen.
4. Rotation: Provider-Keys regelmaessig ueber Admin-UI rotieren.
5. Audit: Alle Admin-Aenderungen periodisch pruefen.

## 8.1 DSGVO-Kontrollen (Admin-seitig)
- Aufbewahrungs- und Loeschregeln pro Datenkategorie zentral pflegen.
- DSR-Workflows unterstuetzen:
  - Auskunft
  - Berichtigung
  - Loeschung
  - Export
- Nachweisfaehigkeit:
  - Protokoll, wann welche personenbezogenen Daten verarbeitet oder geloescht wurden.
- Standardmaessige Datensparsamkeit:
  - nur notwendige personenbezogene Felder erfassen und anzeigen.

## 9. Akzeptanzkriterien (MVP)
- Admin kann Benutzer und Rollen komplett ueber UI verwalten.
- Provider- und Connector-Konfiguration funktioniert ohne Redeploy.
- Mindestens ein aktiver Admin ist technisch erzwungen.
- Secrets sind verschluesselt gespeichert und maskiert ausgeliefert.
- Jede Admin-Aenderung erscheint im Audit mit Zeit, Akteur, Delta.
- DSGVO-Basisprozesse (Loeschung, Auskunft, Retention) sind adminseitig steuerbar und nachweisbar.

## 10. Offene Entscheidungen
- MFA fuer Admin-Logins im MVP oder ab Q2.
- Granularitaet von Feature-Flags.
- Secret-Encryption-Mechanismus (z. B. libsodium/KMS).
- Umgebungsstrategie nach Dev (Staging/Prod) und finale Go-Live-Gates.
