# Graph-Einsatz im Auftragsbestätigungsprozess

Stand: 17.03.2026

---

## Überblick

Dieses Dokument beschreibt Konzept und Umsetzungsstrategie für den Einsatz einer Graph-Datenbank (Neo4j) im Auftragsbestätigungsprozess (AB-Prozess). Es richtet sich sowohl an Fachverantwortliche (Einkauf, Controlling) als auch an Entwickler, die die Erweiterung des bestehenden insAIghts-Systems umsetzen.

### Warum Graph?

Der AB-Prozess ist im Kern ein **Beziehungsproblem**: Eine Bestellung (PO) wird von einem Lieferanten bestätigt (AB), führt zu einer Lieferung (Wareneingang) und mündet in einer Rechnung. Abweichungen entstehen an den Übergängen zwischen diesen Stationen.

Relationale Datenbanken speichern diese Stationen als separate Tabellen — Zusammenhänge müssen über mehrere JOINs rekonstruiert werden. Eine Graph-Datenbank speichert die **Verbindungen selbst als erstklassige Objekte** und macht Pfade, Muster und Anomalien direkt traversierbar.

---

## Prozessübersicht

```
[Bestellung / PO]
       |
       | CONFIRMED_BY
       v
[Auftragsbestätigung / AB] --HAS_DEVIATION--> [Abweichung]
       |
       | LEADS_TO
       v
[Wareneingang / WE]
       |
       | TRIGGERS
       v
[Rechnung / RE]

[Lieferant] <--FROM-- [AB]
[Lieferant] --BOUND_BY--> [Rahmenvertrag]
[Rahmenvertrag] --COVERS--> [PO]
```

Der vollständige Pfad `PO → AB → WE → RE` wird als **4-Way-Match** bezeichnet und ist der zentrale Kontrollmechanismus im Purchase-to-Pay-Prozess (P2P).

---

## Datenmodell

### Knoten (Nodes)

| Node | Beschreibung | Wesentliche Eigenschaften |
|------|-------------|--------------------------|
| `PurchaseOrder` | Bestellung | `po_number`, `date`, `amount`, `quantity`, `requested_delivery_date`, `supplier_id` |
| `OrderConfirmation` | Auftragsbestätigung | `ab_number`, `date`, `confirmed_price`, `confirmed_quantity`, `confirmed_delivery_date`, `supplier_id` |
| `Deviation` | Abweichung zwischen PO und AB | `type` (PRICE / QUANTITY / DATE), `delta_absolute`, `delta_percent` |
| `GoodsReceipt` | Wareneingang | `wr_number`, `date`, `received_quantity` |
| `Invoice` | Rechnung | `invoice_number`, `amount`, `date`, `status` |
| `Supplier` | Lieferant | `supplier_number`, `name`, `category` |
| `Contract` | Rahmenvertrag | `contract_number`, `valid_from`, `valid_to`, `max_price_per_unit` |

### Kanten (Relationships)

| Kante | Von → Nach | Bedeutung |
|-------|-----------|-----------|
| `CONFIRMED_BY` | PO → AB | AB bestätigt diese PO |
| `HAS_DEVIATION` | AB → Deviation | AB weicht in diesem Punkt von PO ab |
| `SENT_TO` | PO → Supplier | PO wurde an diesen Lieferanten geschickt |
| `FROM` | AB → Supplier | AB kommt von diesem Lieferanten |
| `LEADS_TO` | AB → GoodsReceipt | Wareneingang resultiert aus AB |
| `TRIGGERS` | GoodsReceipt → Invoice | Rechnung wird durch Wareneingang ausgelöst |
| `REFERENCES` | Invoice → AB | Rechnung referenziert diese AB |
| `BOUND_BY` | Supplier → Contract | Lieferant ist an diesen Vertrag gebunden |
| `COVERS` | Contract → PO | Rahmenvertrag gilt für diese PO |

---

## Anwendungsszenarien

### Szenario 1: Abweichungsanalyse (AB vs. PO)

**Fachliche Bedeutung:**
Wenn ein Lieferant die Auftragsbestätigung mit abweichenden Konditionen zurückschickt (höherer Preis, geringere Menge, späterer Liefertermin), entsteht unmittelbarer Klärungsbedarf. Unentdeckte Abweichungen führen zu Überzahlungen oder Produktionsunterbrechungen.

**Wie der Graph hilft:**
Jede Abweichung wird als eigener Node modelliert und mit der AB verknüpft. Dadurch sind Abweichungen direkt abfragbar — ohne Vergleichslogik in der Anwendung.

**Beispielabfragen:**
```cypher
-- Alle Preisabweichungen über 5%
MATCH (ab:OrderConfirmation)-[:HAS_DEVIATION]->(d:Deviation)
WHERE d.type = "PRICE" AND d.delta_percent > 5
RETURN ab.ab_number, d.delta_percent, d.delta_absolute
ORDER BY d.delta_percent DESC

-- Lieferanten mit den meisten Abweichungen
MATCH (s:Supplier)<-[:FROM]-(ab:OrderConfirmation)-[:HAS_DEVIATION]->(d:Deviation)
RETURN s.name, count(d) AS abweichungen, avg(d.delta_percent) AS ø_abweichung
ORDER BY abweichungen DESC
LIMIT 10
```

**Eskalationsregel:**
- Preisabweichung > 3% → automatische Markierung zur manuellen Freigabe
- Terminabweichung > 5 Werktage → Benachrichtigung Einkauf
- Mengenabweichung > 10% → Sperrung der Rechnungsfreigabe bis Klärung

---

### Szenario 2: Fehlende Auftragsbestätigungen

**Fachliche Bedeutung:**
POs ohne AB sind ein stilles Risiko: Der Lieferant hat nicht zugesagt, der Liefertermin ist ungesichert, eine Rechnung kann trotzdem eingehen.

**Wie der Graph hilft:**
PO-Nodes ohne ausgehende `CONFIRMED_BY`-Kante sind in einer einzigen Query auffindbar.

**Beispielabfrage:**
```cypher
-- POs ohne AB, Liefertermin in weniger als 7 Tagen
MATCH (po:PurchaseOrder)
WHERE NOT (po)-[:CONFIRMED_BY]->(:OrderConfirmation)
  AND po.requested_delivery_date < date() + duration('P7D')
RETURN po.po_number, po.supplier_id, po.requested_delivery_date, po.amount
ORDER BY po.requested_delivery_date ASC
```

**Nutzen:** Täglicher automatischer Report → Einkauf erhält Handlungsliste, bevor Eskalation nötig wird.

---

### Szenario 3: Lieferantenzuverlässigkeit als lebendiger Score

**Fachliche Bedeutung:**
Statische Lieferantenbewertungen veralten schnell. Ein Graph-basierter Score aktualisiert sich mit jeder neuen AB und spiegelt das aktuelle Verhalten.

**Wie der Graph hilft:**
Alle ABs eines Lieferanten sind über den `FROM`-Edge direkt erreichbar. Abweichungen, Termintreue und Bestätigungsquote lassen sich in einer Traversal aggregieren.

**Beispielabfrage:**
```cypher
MATCH (s:Supplier)<-[:FROM]-(ab:OrderConfirmation)
OPTIONAL MATCH (ab)-[:HAS_DEVIATION]->(d:Deviation)
WITH s,
     count(ab) AS gesamt,
     count(d) AS mit_abweichung,
     avg(CASE WHEN d.type = "DATE" THEN d.delta_absolute ELSE null END) AS ø_terminverzug_tage
RETURN s.name,
       gesamt,
       mit_abweichung,
       round(100.0 * mit_abweichung / gesamt, 1) AS abweichungsquote_pct,
       ø_terminverzug_tage
ORDER BY abweichungsquote_pct DESC
```

**Ergebnis:** Dynamisches Lieferanten-Ranking, das direkt als Input für Einkaufsentscheidungen und Vertragsverhandlungen dient.

---

### Szenario 4: Rahmenvertrag-Compliance

**Fachliche Bedeutung:**
Lieferanten überschreiten in ABs gelegentlich die vertraglich vereinbarten Preise — bewusst oder unbewusst. Ohne direkten Abgleich bleibt das unentdeckt.

**Wie der Graph hilft:**
Der Rahmenvertrag ist als Node modelliert und direkt mit Lieferant und PO verbunden. Der Vergleich AB-Preis vs. Vertragskonditionen ist eine einfache Traversal.

**Beispielabfrage:**
```cypher
MATCH (c:Contract)-[:COVERS]->(po:PurchaseOrder)-[:CONFIRMED_BY]->(ab:OrderConfirmation)
WHERE ab.confirmed_price > c.max_price_per_unit
RETURN po.po_number,
       c.contract_number,
       c.max_price_per_unit AS vertragspreis,
       ab.confirmed_price AS bestaetigter_preis,
       round(100.0 * (ab.confirmed_price - c.max_price_per_unit) / c.max_price_per_unit, 1) AS überschreitung_pct
ORDER BY überschreitung_pct DESC
```

**Nutzen:** Automatische Compliance-Warnung, bevor die Rechnung zur Zahlung freigegeben wird.

---

### Szenario 5: Split-Order-Erkennung

**Fachliche Bedeutung:**
Lieferanten teilen manchmal eine PO in mehrere ABs auf — um unter Freigabegrenzen zu bleiben oder Kontrollen zu umgehen. Das ist ein bekanntes Compliance-Risiko.

**Wie der Graph hilft:**
Eine PO mit mehr als einer ausgehenden `CONFIRMED_BY`-Kante ist sofort identifizierbar.

**Beispielabfrage:**
```cypher
MATCH (po:PurchaseOrder)-[:CONFIRMED_BY]->(ab:OrderConfirmation)
WITH po, count(ab) AS anzahl_abs, collect(ab.ab_number) AS ab_nummern
WHERE anzahl_abs > 1
RETURN po.po_number, po.amount, anzahl_abs, ab_nummern
ORDER BY anzahl_abs DESC
```

**Ergebnis:** Liste aller aufgeteilten Bestellungen zur manuellen Prüfung durch Einkauf oder Compliance.

---

### Szenario 6: 4-Way-Match (PO → AB → WE → RE)

**Fachliche Bedeutung:**
Der 4-Way-Match ist der stärkste Kontrollmechanismus im P2P-Prozess. Er stellt sicher, dass:
- Die Rechnung zu einer bestätigten Bestellung gehört (PO → AB)
- Die berechnete Menge tatsächlich geliefert wurde (AB → WE)
- Preis und Menge der Rechnung mit PO und WE übereinstimmen (WE → RE)

**Wie der Graph hilft:**
Der vollständige Pfad ist eine einzige Traversal. Lücken (z.B. Rechnung ohne Wareneingang) sind sofort sichtbar.

**Beispielabfrage:**
```cypher
-- Rechnungen ohne zugehörigen Wareneingang
MATCH (re:Invoice)-[:REFERENCES]->(ab:OrderConfirmation)
WHERE NOT (ab)<-[:LEADS_TO]-(:GoodsReceipt)
RETURN re.invoice_number, re.amount, ab.ab_number

-- Vollständiger 4-Way-Match mit Abweichungsprüfung
MATCH (po:PurchaseOrder)-[:CONFIRMED_BY]->(ab:OrderConfirmation)
      <-[:LEADS_TO]-(we:GoodsReceipt)
      <-[:TRIGGERS]-(re:Invoice)
WHERE re.amount > po.amount * 1.03
RETURN po.po_number, po.amount AS po_betrag,
       ab.confirmed_price AS ab_preis,
       we.received_quantity AS gelieferte_menge,
       re.amount AS rechnungsbetrag,
       round(re.amount - po.amount, 2) AS differenz
```

**Nutzen:** Rechnungsfreigabe wird automatisch gesperrt, wenn der 4-Way-Match eine Abweichung über Toleranzschwelle ergibt.

---

### Szenario 7: Natürlichsprachliche Abfragen via LLM

**Fachliche Bedeutung:**
Nicht jeder Nutzer kann oder will Cypher schreiben. Mit einem vorgeschalteten LLM (z.B. Mistral, bereits in insAIghts integriert) können Einkäufer und Controller Fragen in natürlicher Sprache stellen.

**Beispiel-Interaktionen:**
- *"Welche Lieferanten haben in den letzten 30 Tagen den vereinbarten Preis überschritten?"*
- *"Gibt es offene Bestellungen bei Lieferant Müller GmbH ohne Auftragsbestätigung?"*
- *"Zeige alle Rechnungen, bei denen weniger geliefert wurde als bestätigt"*

**Technische Umsetzung:**
Das LLM erhält das Graph-Schema als Kontext und generiert eine sichere, read-only Cypher-Query. Das Ergebnis wird als strukturierte Antwort oder Management-Summary zurückgegeben. Dieses Pattern ist in insAIghts bereits für den Rechnungsgraphen implementiert und kann direkt auf den AB-Graphen erweitert werden.

---

## Umsetzung in insAIghts

### Voraussetzungen

- Neo4j läuft bereits (produktiv für Rechnungsgraph)
- Mistral-Integration für LLM-Q&A bereits vorhanden
- MinIO als Datenquelle bereits aktiv

### Neue Datenquellen

AB-Daten müssen aus einer der folgenden Quellen ingested werden:

| Quelle | Status in insAIghts | Aufwand |
|--------|--------------------|---------|
| MinIO (PDF/XML) | Aktiv | Gering — neues Extraction-Schema |
| REST-API (ERP) | Geplant Q2 | Mittel — Connector aktivieren |
| Mail (PDF-Anhang) | Geplant Q2 | Mittel — Connector aktivieren |

### Implementierungsschritte

**Schritt 1 — Datenmodell erweitern**
- Neue Node-Labels in Neo4j: `PurchaseOrder`, `OrderConfirmation`, `Deviation`, `GoodsReceipt`, `Contract`
- Neue Relationship-Types anlegen
- Bestehende `Invoice`-Nodes verknüpfen:
  ```cypher
  MATCH (i:Invoice {id: $id})
  MATCH (ab:OrderConfirmation {ref: i.po_reference})
  MERGE (i)-[:REFERENCES]->(ab)
  ```

**Schritt 2 — Extraction-Schema für AB definieren**
- Neue Extraction Fields in insAIghts Admin: `po_number`, `ab_number`, `confirmed_price`, `confirmed_quantity`, `confirmed_delivery_date`
- Mistral-Prompt für AB-spezifische Dokumente anpassen

**Schritt 3 — Abweichungs-Engine implementieren**
- Nach jeder AB-Extraktion: automatischer Vergleich mit zugehöriger PO
- Abweichungs-Nodes erzeugen bei Delta > Schwellwert
- Schwellwerte über Admin-UI konfigurierbar (analog zu Workflow Rules)

**Schritt 4 — Workflow-Regeln erweitern**
- Neue Regel-Typen: `price_deviation_limit`, `date_deviation_days`, `quantity_deviation_limit`
- Automatische Freigabesperre bei Überschreitung
- Eskalations-Flag für Einkauf

**Schritt 5 — LLM-Q&A auf AB-Schema erweitern**
- Graph-Schema-Kontext im Mistral-Prompt um neue Node-Typen ergänzen
- Alias-System für Synonyme (z.B. "Bestellung" → `PurchaseOrder`)
- Sicherer Cypher-Modus bleibt unverändert

**Schritt 6 — KPI-Dashboard erweitern**
- AB-Bestätigungsquote (ABs / POs gesamt)
- Durchschnittliche Abweichungsquote je Typ
- Lieferanten-Zuverlässigkeits-Ranking
- Offene POs ohne AB (Risikoliste)

### Geschätzter Aufwand

| Schritt | Aufwand |
|---------|---------|
| Datenmodell + Neo4j Schema | 1–2 Tage |
| Extraction Schema + Mistral-Prompt | 1 Tag |
| Abweichungs-Engine (Backend) | 2–3 Tage |
| Workflow-Regeln erweitern | 1–2 Tage |
| LLM-Q&A Erweiterung | 0,5 Tage |
| KPI-Dashboard Erweiterung | 1–2 Tage |
| **Gesamt** | **~7–12 Tage** |

---

## Fachlicher Mehrwert auf einen Blick

| Szenario | Bisher | Mit Graph |
|----------|--------|-----------|
| Abweichungen erkennen | Manuell, nach Rechnungseingang | Automatisch, bei AB-Eingang |
| Fehlende ABs | Nicht systematisch erfasst | Tägliche Risikoliste |
| Lieferantenbewertung | Statisch, quartalsweise | Dynamisch, kontinuierlich |
| Compliance-Verstöße | Stichproben | Vollständige Abdeckung |
| Split-Order-Erkennung | Nicht vorhanden | Automatisch |
| 4-Way-Match | Manuelle Tabellen | Vollautomatisch |
| Ad-hoc-Auswertungen | IT-Anfrage nötig | Natürlichsprachlich durch Nutzer |

---

## Abhängigkeiten und offene Punkte

- **ERP-Anbindung**: AB-Daten liegen typischerweise im ERP (SAP, Dynamics, etc.). Klärung nötig, ob Export via MinIO/REST oder Direktanbindung.
- **PO-Stammdaten**: POs müssen als Referenz vorliegen — entweder als Import oder aus laufendem ERP.
- **Toleranzschwellen**: Fachseitige Festlegung notwendig (z.B. Preisabweichung ±3%, Terminabweichung ±2 Tage).
- **Freigabe-Workflow**: Definition, welche Abweichungstypen welche Eskalationsstufe auslösen.
- **Datenschutz**: Prüfung, ob AB-Daten (Preise, Lieferantenkonditionen) besondere Zugriffsrechte erfordern.
