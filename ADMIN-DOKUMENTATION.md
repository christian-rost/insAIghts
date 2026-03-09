# Admin-Dokumentation insAIghts

Stand: 09.03.2026

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
- Optional: `PROVIDER_KEY_ENCRYPTION_KEY` (Fernet-Key fuer at-rest Verschluesselung der Provider-Keys)

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
- Trend letzte 14 Tage (Dokumente, Rechnungen, Approvals)
- Touchless-Rate und durchschnittliche Freigabezeit
- Lieferanten-Ausnahmequote und Top-Lieferanten nach Volumen

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
- One-Click Pipeline Run (komplette Kette in einem Lauf)
- Waehrend One-Click Run: Live-Status pro Schritt (Pull, Extract, Map, Validate, Graph Sync) sichtbar
- Vor dem Pull: Dateivorschau mit Multi-Select (einzeln/mehrere/alle)
- Duplikate werden in der Vorschau markiert und beim Import uebersprungen
- Einzelne Dokumente koennen als Admin entfernt werden (DB + Graph wird aktualisiert)
- Markierte Dokumente koennen gezielt reprocessed werden (ohne globalen Reset)
- Loeschantraege koennen im Pipeline-Tab gefiltert, freigegeben oder abgelehnt werden

### 4.9 Inbox UX (Anwenderoberflaeche)
- Header-Extraktionsfelder sind auf-/zuklappbar.
- Aktionsbereich ist 2-zeilig aufgebaut:
  - Zeile 1: Kommentarfeld
  - Zeile 2: Workflow-Buttons

### 4.6 Graph
- Datenebenen-Felder auswaehlen
- Bulk-Sync aller Rechnungen
- Globalen Graph laden
- Natuerliche Graph-Fragen (LLM) direkt im Admin-Tab stellen
  - inkl. sichtbarer Cypher-Query
  - inkl. Ergebnisliste
  - inkl. Modus-Anzeige (`direkt` / `flexibel`)
- Alias-Review fuer beliebige Attribute (`entity_type`)
- Graph-Insights laden (Top N Auswertungen)
- Graph-UX-Steuerungen fuer Inbox und Global-Graph:
  - Label-Modus: `Auto` / `Alle` / `Aus`
  - Detail-Filter: Positionen, Datenfelder, Aktionen ein-/ausblenden
  - Positionen-Clustering (Top-N + Sammelknoten "Weitere Positionen")
  - Noise-Filter ueber `Min Degree`
  - Verbesserte Layout-Logik (invoice-zentrierte Gruppierung statt reinem Ring)

### 4.7 Reset
- Globaler Pipeline-Reset
- Optional inkl. Neo4j-Reset

### 4.8 Audit
- Audit-Events im Admin abrufbar
- Endpoint: `GET /api/admin/audit/events?limit=...`
- Eigener Admin-Tab mit Filtern fuer `event_type`, `actor_user_id`, `target_type`
- Typische Events: Pipeline-Runs, Reprocessing, Loeschantrag-Freigaben/Ablehnungen, Konfigurationsaenderungen

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

## 5.1 Graph-Insights
Endpunkt:
- `GET /api/admin/graph/insights?limit=10`
- `GET /api/admin/graph/insights/trends?window_days=30&compare_days=30&granularity=week`
- `GET /api/admin/graph/insights/drilldown?metric=reject_rate&period_start=YYYY-MM-DD&period_end=YYYY-MM-DD`
- `GET /api/admin/graph/insights/explain?window_days=30&compare_days=30&granularity=week&limit=10`
- `POST /api/graph/query`

Gelieferte Auswertungen:
- `supplier_risk`
- `top_recipients`
- `top_products`
- `status_distribution`
- `anomaly_candidates`

LLM-Analyse:
- Nutzt den konfigurierten/aktiven Mistral-Provider-Key.
- Liefert Management-Zusammenfassung, Highlights und Vorschlaege fuer weitere Trend-KPIs.
- Falls Provider nicht verfuegbar ist, wird ein deterministischer Fallback-Text mit KPI-Vorschlaegen geliefert.

## 6. Betriebsablauf (empfohlen)
1. Provider-Key setzen
2. MinIO Connector pruefen
3. One-Click Pipeline Run starten (oder Einzelschritte)
4. Ergebnisse in Inbox pruefen
5. Optional gezieltes Reprocessing fuer markierte Dokumente
6. Loeschantraege pruefen (Approve/Reject)
7. KPI und Audit kontrollieren

## 7. Audit und Compliance
Alle relevanten Admin-Events werden in `insaights_admin_audit_log` geschrieben, u. a.:
- Auth-Events
- User-Aenderungen
- Provider/Connector Updates
- Feld- und Regel-Updates
- Graph-Konfig und Alias-Aenderungen
- One-Click Pipeline-Run
- Reprocessing markierter Dokumente
- Loeschantraege (Erstellung, Freigabe, Ablehnung)
- Pipeline-Reset

## 8. DSGVO-Betriebspunkte
- Datenminimierung bei Feldern und Views
- Rollenbasierter Zugriff
- Nachvollziehbare Verarbeitung durch Audit-Events
- Reprocessing kontrolliert ueber Reset-Mechanismus
- Rollengetrennter Loeschprozess: User-Antrag, Admin-Freigabe
- Optionale Verschluesselung von Provider-Keys in Supabase

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
- `insaights_document_delete_requests`
