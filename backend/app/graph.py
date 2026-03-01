from __future__ import annotations

from typing import Any, Dict, Optional

from neo4j import GraphDatabase

from .config import GRAPH_DB_PASSWORD, GRAPH_DB_URI, GRAPH_DB_USER

_driver = None


def get_graph_driver():
    global _driver
    if _driver is not None:
        return _driver
    if not GRAPH_DB_URI or not GRAPH_DB_USER or not GRAPH_DB_PASSWORD:
        return None
    _driver = GraphDatabase.driver(
        GRAPH_DB_URI,
        auth=(GRAPH_DB_USER, GRAPH_DB_PASSWORD),
    )
    return _driver


def graph_healthcheck() -> Dict[str, Any]:
    driver = get_graph_driver()
    if not driver:
        return {
            "status": "unhealthy",
            "reason": "graph credentials or uri not configured",
        }
    try:
        with driver.session() as session:
            record = session.run("RETURN 1 AS ok").single()
            ok = int(record["ok"]) == 1 if record else False
        return {
            "status": "healthy" if ok else "unhealthy",
            "uri": GRAPH_DB_URI,
        }
    except Exception as exc:
        return {
            "status": "unhealthy",
            "uri": GRAPH_DB_URI,
            "reason": str(exc),
        }

