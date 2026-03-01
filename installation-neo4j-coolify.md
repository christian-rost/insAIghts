# Neo4j unter Coolify installieren

## 1. Kurzantwort
Ja, das geht in der Regel problemlos, weil Neo4j als Docker-Container laeuft und Coolify containerbasierte Services/Stacks direkt unterstuetzt.

## 2. Voraussetzungen
- Laufende Coolify-Instanz
- Zielserver mit persistentem Storage
- Domain/Subdomain nur falls Neo4j Browser extern erreichbar sein soll
- Starkes Passwort fuer Neo4j

## 3. Empfohlene Betriebsart in Coolify
- Als eigener Service/Stack mit `neo4j:5` Image
- Persistente Volumes fuer `data`, `logs`, `import`, `plugins`
- Zugriff fuer die App primaer intern ueber Coolify-Netzwerk
- Externe Exposition nur wenn wirklich noetig (insbesondere Bolt 7687 absichern)

## 4. Beispiel: Docker-Compose fuer Coolify
```yaml
services:
  neo4j:
    image: neo4j:5
    restart: unless-stopped
    environment:
      - NEO4J_AUTH=neo4j/${NEO4J_PASSWORD}
      - NEO4J_server_memory_heap_initial__size=1G
      - NEO4J_server_memory_heap_max__size=1G
      - NEO4J_server_memory_pagecache_size=1G
    volumes:
      - neo4j_data:/data
      - neo4j_logs:/logs
      - neo4j_import:/import
      - neo4j_plugins:/plugins
    ports:
      - "7474:7474"
      - "7687:7687"

volumes:
  neo4j_data:
  neo4j_logs:
  neo4j_import:
  neo4j_plugins:
```

Hinweis:
- Fuer produktive Umgebungen Ports nur dann veroeffentlichen, wenn benoetigt.
- Besser: nur internen Service-Zugriff aus dem Backend erlauben.
- APOC bei Bedarf als separate Entscheidung aktivieren; fuer produktive Setups nicht blind per Default einschalten.

Optionale APOC-Ergaenzung (eher Dev/Test):
```yaml
environment:
  - NEO4J_PLUGINS=["apoc"]
```

## 5. Schritte in Coolify
1. Neues Projekt oder bestehendes Projekt oeffnen.
2. `Add Resource` -> `Docker Compose` (oder Service mit Custom Image) auswaehlen.
3. Compose-Datei einfuegen (oben).
4. Environment Variable `NEO4J_PASSWORD` in Coolify setzen.
5. Persistent Volumes aktiv lassen (nicht ephemer).
6. Deploy ausfuehren.
7. Health pruefen:
   - Browser: `http://<host>:7474`
   - Bolt intern: `bolt://neo4j:7687` (Service-Name je nach Coolify-Konfiguration)

Wichtig fuer Coolify:
- Bei Docker-Compose Deployments ist die Compose-Datei die zentrale Wahrheit fuer Settings.
- Env-Variablen, die als `${VAR}` in Compose stehen, koennen in Coolify direkt gepflegt werden.

## 6. Anwendungseinbindung (FastAPI Backend)
- Driver: offizieller `neo4j` Python-Driver.
- Connection-String:
  - intern: `neo4j://<service-name>:7687` oder `bolt://<service-name>:7687`
- Credentials ueber Admin-Oberflaeche/Secret-Store verwalten (nicht dauerhaft als Env streuen).

## 7. Security Baseline (Secure by Design)
- Starke Passwoerter und regelmaessige Rotation.
- Ports 7474/7687 nicht oeffentlich exponieren, falls nicht notwendig.
- TLS aktivieren, wenn externe Verbindungen erlaubt sind.
- Backups regelmaessig testen (Restore-Test, nicht nur Backup-Job).
- Datenzugriffe auditiert und mit Rollenmodell abgesichert.

## 8. DSGVO-Hinweise
- Personenbezogene Daten im Graphen minimieren (Pseudonymisierung wo moeglich).
- Aufbewahrungs- und Loeschregeln auch fuer Neo4j-Daten festlegen.
- Auskunft/Loeschung (DSR) in Supabase und Neo4j konsistent umsetzen.
- Exportfaehigkeit fuer betroffene Datensaetze sicherstellen.

## 9. Troubleshooting (haeufig)
- Container startet nicht: `NEO4J_AUTH`/Passwortformat pruefen.
- Daten weg nach Redeploy: Volume-Mounts fehlen oder falsch.
- Speicherprobleme: Heap/Pagecache auf Server-RAM abstimmen.
- Keine Verbindung vom Backend: interne Service-DNS/Port/Firewall pruefen.

## 10. Lizenzhinweis
- Bei Neo4j Enterprise muss `NEO4J_ACCEPT_LICENSE_AGREEMENT=yes` gesetzt werden.
