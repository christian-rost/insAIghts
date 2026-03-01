Entwickle eine Datenanalyse-Software ähnlich wie Foundry oder Gotham von Palantir.

### 1. Was muss die Software können? (Die 4 Säulen)

Die Architektur muss in Schichten aufgebaut sein. Eine bloße Visualisierung reicht nicht aus; das Fundament ist entscheidend.

#### A. Datenintegration & Pipeline-Orchestrierung (The Plumbing)
Das System muss Daten aus beliebigen Quellen (ERP, SQL, NoSQL, IoT, unstrukturierte Dokumente) aufnehmen können, ohne dass sie manuell bereinigt werden müssen.
*   **Funktionen:** Konnektoren für hunderte Systeme, Batch- & Streaming-Ingestion, Data Lineage (Woher kommt dieser Wert?), Versionierung von Daten (Time-Travel: „Wie sah der Datenstand vor 2 Wochen aus?“).

#### B. Die Ontologie / Semantische Schicht (The Heart)
Dies ist das wichtigste Unterscheidungsmerkmal. Palantir arbeitet nicht mit „Tabellen und Zeilen“, sondern mit „Objekten und Beziehungen“.
*   **Funktionen:** Ein „Object Type Manager“, der technische Daten in reale Konzepte übersetzt (z. B. *Kunde*, *Flugzeug*, *Fabrik*).
*   **Der Graph:** Verknüpfung dieser Objekte (z. B. *Kunde X* besitzt *Flugzeug Y*). Dies ermöglicht Netzwerkanalysen.

#### C. Operations & Write-back (The Action)
Klassische BI-Tools zeigen Daten nur an („Read-only“). Palantir-Software ermöglicht das Handeln.
*   **Funktionen:** Wenn eine Analyse ein Problem zeigt (z. B. „Maschine überhitzt“), muss der Nutzer direkt in der Software eine Aktion auslösen können (z. B. „Wartungsticket erstellen“ oder „Maschine stoppen“), die an das Quellsystem (z. B. SAP) zurückgeschrieben wird.
*   **Workflows:** Formulare, Genehmigungsprozesse und Case Management.

#### D. Security & Governance (The Foundation)
Palantir wird im Geheimdienst- und Bankenumfeld genutzt. Sicherheit ist kein Feature, sondern die Basis.
*   **Funktionen:** Granulare Zugriffskontrollen (nicht nur auf Datei-, sondern auf Zeilen- und Spaltenebene), „Purpose-based Access“ (Zugriff nur mit Begründung), lückenloses Audit-Log (jeder Klick wird protokolliert).

---

### 2. Technische Anforderungen & Stack (Vorschlag)

Da Sie das Rad nicht komplett neu erfinden können, sollten Sie auf bewährte Open-Source-Technologien setzen.

*   **Backend / Data Processing:**
    *   läuft unter Coolify: Frontend und Backend getrennt
    *   wie unsere Projekte xqt5-ai-plattform, stammdatenmanagement oder ressourcenmanagement
*   **Ontologie & Graph:**
    *   *Datenbank:* Eine Graph-Datenbank wie lightRAG für die Ontologie und den Graph
    *.  Supabase als relationale und Vektor-Datenbank
*   **Frontend:**
    *   *Visualisierung:* WebGL-basierte Libraries für Graphen und Karten (z. B. Mapbox, D3.js).


---

### 3. Implementierungsplan (Phasen-Modell)


#### Phase 1: Das Fundament (
*   **Ziel:** Daten sicher aufnehmen und transformieren.
*   **Fokus:** Aufbau der Data-Engineering-Pipeline und des Sicherheitsmodells (IAM).
*   **Deliverable:** Eine Plattform, die Daten aus 3 Quellen integriert, versioniert speichert und per SQL abfragbar macht. Audit-Logs laufen von Tag 1 an mit.

#### Phase 2: Die Ontologie & erste App 
*   **Ziel:** Weg von Tabellen, hin zu Objekten.
*   **Fokus:** Entwicklung des „Object Managers“. Mapping von Daten auf Objekte.
*   **Deliverable:** Eine Benutzeroberfläche, in der Nutzer nach „Objekten“ suchen und deren Beziehungen in einem Graphen sehen können (360°-Sicht).

#### Phase 3: Operations & Actions 
*   **Ziel:** Den Kreis schließen (Write-back).
*   **Fokus:** Actions-Framework. Nutzer können Zustände von Objekten ändern, was API-Calls in den Quellsystemen auslöst.
*   **Deliverable:** Eine voll funktionsfähige operative Applikation (z. B. ein Case-Management-Tool für Betrugsermittlung oder Wartung).

#### Phase 4: Skalierung & AI 
*   **Ziel:** Automatisierung.
*   **Fokus:** Integration von ML-Modellen, die direkt auf der Ontologie arbeiten. Bereitstellung von „No-Code“-Tools, damit Fachanwender eigene Apps bauen können.


