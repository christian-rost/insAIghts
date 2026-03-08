# Admin-Dokumentation insAIghts

Stand: 08.03.2026

## 1. Ziel
Diese Doku beschreibt Betrieb, Konfiguration und Governance der Plattform ueber die Admin-Oberflaeche.

## 2. Leitprinzipien
- Secure by design
- DSGVO-konforme Verarbeitung
- So wenig Env-Variablen wie moeglich
- Betriebsparameter in Admin-UI
- Vollstaendige Auditierbarkeit

## 3. Was wird ueber Env gesetzt
Nur Basiswerte:
- `SUPABASE_URL`
- `SUPABASE_KEY`
- `JWT_SECRET`
- `CORS_ORIGINS`
- `ADMIN_USERNAME`
- `ADMIN_PASSWORD`
- `VITE_API_BASE`
- `GRAPH_DB_URI`
- `GRAPH_DB_USER`
- `GRAPH_DB_PASSWORD`

Nicht in Env pflegen:
- Mistral API Key
- MinIO Betriebsparameter
- Extraktionsfelder
- Workflow-Regeln
- Graph-Feldkonfiguration
- Alias-Regeln

## 4. Admin-Tabs und Aufgaben

### 4.1 KPI
- Gesamtstatus von Dokumenten, Rechnungen, Cases
- Monitoring der operativen Last

### 4.2 Model / Felder
- Extraktionsfelder fuer Header und Line-Items
- Datentyp, Pflichtfeld, Aktivierung, Sortierung
- Workflow-Regeln (Betragslimits, Rollen, Four-Eyes)

### 4.3 Providers
- Mistral aktivieren/deaktivieren
- API Key setzen/rotieren

### 4.4 User Management
- Benutzer anlegen
- Rollen vergeben
- Aktiv-Status steuern

### 4.5 MinIO Pipeline
- Connector konfigurieren
- Verbindung testen
- Pull, OCR/Extract, Mapping, Validation ausfuehren

### 4.6 Graph
- Datenebenen-Felder auswaehlen
- Bulk-Sync aller Rechnungen
- Globalen Graph laden
- Alias-Review fuer beliebige Attribute (`entity_type`)

### 4.7 Reset
- Globaler Pipeline-Reset
- Optional inkl. Neo4j-Reset

## 5. Graph-Alias-Verwaltung (generisch)
Alias-Endpunkte:
- `GET /api/admin/graph/aliases?entity_type=...`
- `POST /api/admin/graph/aliases`
- `PUT /api/admin/graph/aliases/{alias_id}`

Beispiel:
- `entity_type=empfaenger`
- `raw_value=Rost, Christian`
- `canonical_value=Christian Rost`

Hinweise:
- Alias-Logik gilt pro `entity_type`.
- Originalwerte bleiben in Extraktionsdaten erhalten.
- Nach Alias-Aenderungen `Sync alle Rechnungen` erneut ausfuehren.

## 6. Betriebsablauf (empfohlen)
1. Provider-Key setzen
2. MinIO Connector pruefen
3. Pipeline-Lauf starten
4. Ergebnisse in Inbox pruefen
5. Graph-Sync ausfuehren
6. KPI und Audit kontrollieren

## 7. Audit und Compliance
Alle relevanten Admin-Events werden in `insaights_admin_audit_log` geschrieben, u. a.:
- Auth-Events
- User-Aenderungen
- Provider/Connector Updates
- Feld- und Regel-Updates
- Graph-Konfig und Alias-Aenderungen
- Pipeline-Reset

## 8. DSGVO-Betriebspunkte
- Datenminimierung bei Feldern und Views
- Rollenbasierter Zugriff
- Nachvollziehbare Verarbeitung durch Audit-Events
- Reprocessing kontrolliert ueber Reset-Mechanismus

## 9. Stoerungsdiagnose
- `Failed to fetch`: API/CORS/Token pruefen
- Graph 500: Neo4j Credentials/Erreichbarkeit pruefen
- Kein OCR Ergebnis: Provider aktiv + API Key + Dokumentformat pruefen
- Leere Inbox: Pipeline-Lauf und Statusfilter pruefen

## 10. Wichtige Tabellen
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

