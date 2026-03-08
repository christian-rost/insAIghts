from __future__ import annotations

from typing import Any, Dict, List, Optional, Set, Tuple

from neo4j import GraphDatabase

from .config import GRAPH_DB_PASSWORD, GRAPH_DB_URI, GRAPH_DB_USER

_driver = None


def _json_safe(value: Any) -> Any:
    if value is None or isinstance(value, (str, int, float, bool)):
        return value
    if isinstance(value, list):
        return [_json_safe(v) for v in value]
    if isinstance(value, tuple):
        return [_json_safe(v) for v in value]
    if isinstance(value, dict):
        return {str(k): _json_safe(v) for k, v in value.items()}
    # Neo4j temporal/spatial values and other custom objects.
    try:
        if hasattr(value, "iso_format"):
            return value.iso_format()  # type: ignore[attr-defined]
    except Exception:
        pass
    return str(value)


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


def _sync_invoice_core(tx, invoice: Dict[str, Any], data_layer_fields: Optional[Set[str]] = None) -> None:
    fields = data_layer_fields or {"supplier_name", "currency", "status"}
    header_values = _extract_header_values(invoice)
    tx.run(
        """
        MERGE (i:Invoice {id: $id})
        SET i.invoice_number = $invoice_number,
            i.invoice_date = $invoice_date,
            i.due_date = $due_date,
            i.status = $status,
            i.currency = $currency,
            i.gross_amount = $gross_amount,
            i.net_amount = $net_amount,
            i.tax_amount = $tax_amount,
            i.confidence_score = $confidence_score,
            i.source_system = $source_system,
            i.updated_at = datetime()
        """,
        id=str(invoice.get("id") or ""),
        invoice_number=invoice.get("invoice_number"),
        invoice_date=invoice.get("invoice_date"),
        due_date=invoice.get("due_date"),
        status=invoice.get("status"),
        currency=invoice.get("currency"),
        gross_amount=invoice.get("gross_amount"),
        net_amount=invoice.get("net_amount"),
        tax_amount=invoice.get("tax_amount"),
        confidence_score=invoice.get("confidence_score"),
        source_system=invoice.get("source_system"),
    )

    supplier_name = str(invoice.get("supplier_name") or "").strip()
    if "supplier_name" in fields and supplier_name:
        tx.run(
            """
            MERGE (s:Supplier {name: $supplier_name})
            WITH s
            MATCH (i:Invoice {id: $invoice_id})
            MERGE (i)-[:BELONGS_TO]->(s)
            """,
            supplier_name=supplier_name,
            invoice_id=str(invoice.get("id") or ""),
        )

    status = str(invoice.get("status") or "").strip()
    currency = str(invoice.get("currency") or "").strip()
    if "status" in fields or "currency" in fields:
        tx.run(
            """
            MATCH (i:Invoice {id: $invoice_id})
            FOREACH (_ IN CASE WHEN $enable_status AND NOT ($status IS NULL OR $status = '') THEN [1] ELSE [] END |
                MERGE (s:InvoiceStatus {name: $status})
                MERGE (i)-[:HAS_STATUS]->(s)
            )
            FOREACH (_ IN CASE WHEN $enable_currency AND NOT ($currency IS NULL OR $currency = '') THEN [1] ELSE [] END |
                MERGE (c:Currency {code: $currency})
                MERGE (i)-[:IN_CURRENCY]->(c)
            )
            """,
            invoice_id=str(invoice.get("id") or ""),
            status=status,
            currency=currency,
            enable_status="status" in fields,
            enable_currency="currency" in fields,
        )

    dimension_fields = [f for f in fields if f not in {"supplier_name", "status", "currency"}]
    dimensions = []
    for field_name in dimension_fields:
        raw_value = header_values.get(field_name)
        value = str(raw_value or "").strip()
        if not value:
            continue
        dimensions.append({"field_name": field_name, "value": value})
    if dimensions:
        tx.run(
            """
            UNWIND $dimensions AS dim
            MATCH (i:Invoice {id: $invoice_id})
            MERGE (d:InvoiceDataField {field_name: dim.field_name, value: dim.value})
            MERGE (i)-[:HAS_DATA_FIELD]->(d)
            """,
            invoice_id=str(invoice.get("id") or ""),
            dimensions=dimensions,
        )


def _extract_header_values(invoice: Dict[str, Any]) -> Dict[str, Any]:
    extraction = invoice.get("extraction_json")
    values: Dict[str, Any] = {}
    values.update(
        {
            "supplier_name": invoice.get("supplier_name"),
            "invoice_number": invoice.get("invoice_number"),
            "invoice_date": invoice.get("invoice_date"),
            "due_date": invoice.get("due_date"),
            "currency": invoice.get("currency"),
            "status": invoice.get("status"),
            "gross_amount": invoice.get("gross_amount"),
            "net_amount": invoice.get("net_amount"),
            "tax_amount": invoice.get("tax_amount"),
        }
    )
    if not isinstance(extraction, dict):
        return values
    custom_header = extraction.get("custom_header_fields")
    if isinstance(custom_header, dict):
        for key, value in custom_header.items():
            if key not in values and value not in [None, ""]:
                values[key] = value
    llm_output = extraction.get("llm_output")
    if isinstance(llm_output, dict):
        header = llm_output.get("header")
        if isinstance(header, dict):
            for key, value in header.items():
                if key not in values and value not in [None, ""]:
                    values[key] = value
    return values


def _sync_line_items(tx, invoice_id: str, lines: List[Dict[str, Any]]) -> int:
    if not lines:
        return 0
    tx.run(
        """
        MATCH (i:Invoice {id: $invoice_id})-[r:HAS_LINE]->(:InvoiceLine)
        DELETE r
        """,
        invoice_id=invoice_id,
    )

    tx.run(
        """
        UNWIND $lines AS line
        MATCH (i:Invoice {id: $invoice_id})
        MERGE (l:InvoiceLine {id: line.id})
        SET l.line_no = line.line_no,
            l.description = line.description,
            l.quantity = line.quantity,
            l.unit_price = line.unit_price,
            l.line_amount = line.line_amount,
            l.tax_rate = line.tax_rate,
            l.updated_at = datetime()
        MERGE (i)-[:HAS_LINE]->(l)
        """,
        invoice_id=invoice_id,
        lines=[
            {
                "id": str(line.get("id") or f"{invoice_id}:{line.get('line_no') or 0}"),
                "line_no": line.get("line_no"),
                "description": line.get("description"),
                "quantity": line.get("quantity"),
                "unit_price": line.get("unit_price"),
                "line_amount": line.get("line_amount"),
                "tax_rate": line.get("tax_rate"),
            }
            for line in lines
        ],
    )
    return len(lines)


def _sync_actions(tx, invoice_id: str, actions: List[Dict[str, Any]]) -> int:
    if not actions:
        return 0

    tx.run(
        """
        UNWIND $actions AS action
        MATCH (i:Invoice {id: $invoice_id})
        MERGE (a:InvoiceAction {id: action.id})
        SET a.action_type = action.action_type,
            a.comment = action.comment,
            a.from_status = action.from_status,
            a.to_status = action.to_status,
            a.created_at = action.created_at
        MERGE (a)-[:TARGETS]->(i)
        FOREACH (_ IN CASE WHEN action.actor_user_id IS NULL AND action.actor_username IS NULL THEN [] ELSE [1] END |
            MERGE (u:User {id: coalesce(action.actor_user_id, 'username:' + coalesce(action.actor_username, 'unknown'))})
            SET u.username = coalesce(action.actor_username, u.username)
            MERGE (u)-[:PERFORMED]->(a)
        )
        FOREACH (_ IN CASE WHEN action.from_status IS NULL OR action.from_status = '' THEN [] ELSE [1] END |
            MERGE (sFrom:InvoiceStatus {name: action.from_status})
            MERGE (a)-[:FROM_STATUS]->(sFrom)
        )
        FOREACH (_ IN CASE WHEN action.to_status IS NULL OR action.to_status = '' THEN [] ELSE [1] END |
            MERGE (sTo:InvoiceStatus {name: action.to_status})
            MERGE (a)-[:TO_STATUS]->(sTo)
        )
        """,
        invoice_id=invoice_id,
        actions=[
            {
                "id": str(action.get("id") or ""),
                "action_type": action.get("action_type"),
                "comment": action.get("comment"),
                "from_status": action.get("from_status"),
                "to_status": action.get("to_status"),
                "actor_user_id": action.get("actor_user_id"),
                "actor_username": action.get("actor_username"),
                "created_at": action.get("created_at"),
            }
            for action in actions
            if action.get("id")
        ],
    )
    return len(actions)


def graph_sync_invoice(
    invoice: Dict[str, Any],
    line_items: List[Dict[str, Any]],
    actions: List[Dict[str, Any]],
    data_layer_fields: Optional[List[str]] = None,
) -> Dict[str, Any]:
    driver = get_graph_driver()
    if not driver:
        return {
            "status": "skipped",
            "reason": "graph credentials or uri not configured",
        }
    invoice_id = str(invoice.get("id") or "")
    if not invoice_id:
        return {
            "status": "error",
            "reason": "invoice.id is required",
        }

    selected_fields = {str(f).strip() for f in (data_layer_fields or []) if str(f).strip()}
    if not selected_fields:
        selected_fields = {"supplier_name", "currency", "status"}

    try:
        with driver.session() as session:
            session.execute_write(_sync_invoice_core, invoice, selected_fields)
            line_count = session.execute_write(_sync_line_items, invoice_id, line_items)
            action_count = session.execute_write(_sync_actions, invoice_id, actions)
        return {
            "status": "ok",
            "invoice_id": invoice_id,
            "line_items": line_count,
            "actions": action_count,
            "data_layer_fields": sorted(selected_fields),
        }
    except Exception as exc:
        return {
            "status": "error",
            "invoice_id": invoice_id,
            "reason": str(exc),
        }


def graph_get_invoice_subgraph(invoice_id: str, max_nodes: int = 200) -> Dict[str, Any]:
    driver = get_graph_driver()
    if not driver:
        return {
            "status": "unavailable",
            "reason": "graph credentials or uri not configured",
            "nodes": [],
            "edges": [],
        }

    query = """
    MATCH (i:Invoice {id: $invoice_id})
    OPTIONAL MATCH (i)-[r1]-(n1)
    OPTIONAL MATCH (n1)-[r2]-(n2)
    WITH collect(distinct i) + collect(distinct n1) + collect(distinct n2) AS rawNodes,
         collect(distinct r1) + collect(distinct r2) AS rawEdges
    UNWIND rawNodes AS n
    WITH collect(distinct n)[0..$max_nodes] AS nodes, rawEdges
    UNWIND rawEdges AS e
    WITH nodes, collect(distinct e) AS edges
    RETURN nodes, edges
    """

    try:
        with driver.session() as session:
            record = session.run(query, invoice_id=invoice_id, max_nodes=max_nodes).single()
            if not record:
                return {"status": "not_found", "nodes": [], "edges": []}
            graph_data = _serialize_record_to_graph(record)
            return {
                "status": "ok",
                "invoice_id": invoice_id,
                **graph_data,
            }
    except Exception as exc:
        return {
            "status": "error",
            "invoice_id": invoice_id,
            "reason": str(exc),
            "nodes": [],
            "edges": [],
        }


def _serialize_record_to_graph(record: Any) -> Dict[str, List[Dict[str, Any]]]:
    nodes_out: List[Dict[str, Any]] = []
    seen_nodes = set()
    for n in record.get("nodes") or []:
        if n is None:
            continue
        node_id = str(n.element_id)
        if node_id in seen_nodes:
            continue
        seen_nodes.add(node_id)
        labels = list(n.labels)
        nodes_out.append(
            {
                "id": node_id,
                "labels": labels,
                "properties": _json_safe(dict(n.items())),
            }
        )

    edges_out: List[Dict[str, Any]] = []
    seen_edges = set()
    for e in record.get("edges") or []:
        if e is None:
            continue
        edge_id = str(e.element_id)
        if edge_id in seen_edges:
            continue
        seen_edges.add(edge_id)
        source_id = (
            getattr(e, "start_node_element_id", None)
            or getattr(getattr(e, "start_node", None), "element_id", None)
            or getattr(e, "start_node_id", None)
        )
        target_id = (
            getattr(e, "end_node_element_id", None)
            or getattr(getattr(e, "end_node", None), "element_id", None)
            or getattr(e, "end_node_id", None)
        )
        edges_out.append(
            {
                "id": edge_id,
                "type": e.type,
                "source": str(source_id or ""),
                "target": str(target_id or ""),
                "properties": _json_safe(dict(e.items())),
            }
        )

    return {"nodes": nodes_out, "edges": edges_out}


def graph_get_global_subgraph(max_nodes: int = 500, max_edges: int = 1200) -> Dict[str, Any]:
    driver = get_graph_driver()
    if not driver:
        return {
            "status": "unavailable",
            "reason": "graph credentials or uri not configured",
            "nodes": [],
            "edges": [],
        }

    query = """
    MATCH (n)
    WITH n LIMIT $max_nodes
    OPTIONAL MATCH (n)-[r]-(m)
    WITH collect(distinct n) + collect(distinct m) AS rawNodes, collect(distinct r) AS rawEdges
    UNWIND rawNodes AS rn
    WITH collect(distinct rn)[0..$max_nodes] AS nodes, rawEdges
    UNWIND rawEdges AS re
    WITH nodes, collect(distinct re)[0..$max_edges] AS edges
    RETURN nodes, edges
    """

    try:
        with driver.session() as session:
            record = session.run(query, max_nodes=max_nodes, max_edges=max_edges).single()
            if not record:
                return {"status": "ok", "nodes": [], "edges": []}
            graph_data = _serialize_record_to_graph(record)
            return {"status": "ok", **graph_data}
    except Exception as exc:
        return {
            "status": "error",
            "reason": str(exc),
            "nodes": [],
            "edges": [],
        }


def graph_reset_invoice_domain() -> Dict[str, Any]:
    driver = get_graph_driver()
    if not driver:
        return {
            "status": "skipped",
            "reason": "graph credentials or uri not configured",
        }

    query = """
    MATCH (i:Invoice)
    OPTIONAL MATCH (i)-[*0..2]-(n)
    WITH collect(distinct i) + collect(distinct n) AS rawNodes
    UNWIND rawNodes AS x
    WITH collect(distinct x) AS nodes
    UNWIND nodes AS node
    DETACH DELETE node
    RETURN count(node) AS deleted_nodes
    """
    try:
        with driver.session() as session:
            record = session.run(query).single()
            deleted_nodes = int(record["deleted_nodes"]) if record and record.get("deleted_nodes") is not None else 0
        return {"status": "ok", "deleted_nodes": deleted_nodes}
    except Exception as exc:
        return {"status": "error", "reason": str(exc)}
