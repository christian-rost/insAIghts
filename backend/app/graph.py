from __future__ import annotations

from datetime import date, datetime, timedelta, timezone
from typing import Any, Dict, List, Optional, Set, Tuple

from neo4j import GraphDatabase

from .config import GRAPH_DB_PASSWORD, GRAPH_DB_URI, GRAPH_DB_USER
from .recipient_resolution_storage import resolve_attribute_value

_driver = None

ALLOWED_TREND_GRANULARITIES = {"day", "week", "month"}
ALLOWED_DRILLDOWN_METRICS = {"invoice_count", "total_amount", "reject_rate", "hold_rate", "clarification_rate"}


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


def _sync_invoice_core(
    tx,
    invoice: Dict[str, Any],
    data_layer_fields: Optional[Set[str]] = None,
    resolved_dimensions: Optional[List[Dict[str, Any]]] = None,
) -> None:
    fields = data_layer_fields or {"supplier_name", "currency", "status"}
    invoice_id = str(invoice.get("id") or "")
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
        id=invoice_id,
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

    # Rebuild invoice-level semantic edges on every sync to avoid stale links
    # when normalization rules/configuration changes.
    tx.run(
        """
        MATCH (i:Invoice {id: $invoice_id})-[r:BELONGS_TO|HAS_STATUS|IN_CURRENCY|HAS_DATA_FIELD|FOR_RECIPIENT]->()
        DELETE r
        """,
        invoice_id=invoice_id,
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
            invoice_id=invoice_id,
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
            invoice_id=invoice_id,
            status=status,
            currency=currency,
            enable_status="status" in fields,
            enable_currency="currency" in fields,
        )

    dimensions = resolved_dimensions or []
    if dimensions:
        tx.run(
            """
            UNWIND $dimensions AS dim
            MATCH (i:Invoice {id: $invoice_id})
            MERGE (d:InvoiceDataField {field_name: dim.field_name, value: dim.value})
            SET d.updated_at = datetime(),
                d.last_raw_value = coalesce(dim.raw_value, d.last_raw_value)
            MERGE (i)-[:HAS_DATA_FIELD]->(d)
            """,
            invoice_id=invoice_id,
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


def _normalize_field_name(value: str) -> str:
    raw = str(value or "").strip().lower()
    if not raw:
        return ""
    raw = raw.replace("ä", "ae").replace("ö", "oe").replace("ü", "ue").replace("ß", "ss")
    # Keep only letters/numbers/underscore for stable matching.
    cleaned = []
    for ch in raw:
        if ch.isalnum() or ch == "_":
            cleaned.append(ch)
    return "".join(cleaned)


def _get_header_value_by_field(header_values: Dict[str, Any], selected_field: str) -> Any:
    # 1) Exact lookup.
    if selected_field in header_values:
        return header_values.get(selected_field)
    # 2) Canonicalized key lookup (handles Empfaenger/Empfänger/case variants).
    target = _normalize_field_name(selected_field)
    if not target:
        return None
    for key, value in header_values.items():
        if _normalize_field_name(str(key)) == target:
            return value
    return None


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


def _prune_orphan_semantic_nodes(tx) -> None:
    tx.run(
        """
        MATCH (d:InvoiceDataField)
        WHERE NOT (d)<-[:HAS_DATA_FIELD]-(:Invoice)
        DETACH DELETE d
        """
    )
    tx.run(
        """
        MATCH (r:Recipient)
        WHERE NOT (r)<-[:FOR_RECIPIENT]-(:Invoice)
        DETACH DELETE r
        """
    )


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

    header_values = _extract_header_values(invoice)
    dimension_fields = [f for f in selected_fields if f not in {"supplier_name", "status", "currency"}]
    resolved_dimensions = []
    for field_name in dimension_fields:
        raw_value = _get_header_value_by_field(header_values, field_name)
        raw_text = str(raw_value or "").strip()
        if not raw_text:
            continue
        resolved_value, _ = resolve_attribute_value(field_name, raw_text)
        dimension_key = _normalize_field_name(field_name) or field_name
        resolved_dimensions.append(
            {
                "field_name": dimension_key,
                "value": resolved_value,
                "raw_value": raw_text,
            }
        )

    try:
        with driver.session() as session:
            session.execute_write(_sync_invoice_core, invoice, selected_fields, resolved_dimensions)
            line_count = session.execute_write(_sync_line_items, invoice_id, line_items)
            action_count = session.execute_write(_sync_actions, invoice_id, actions)
            session.execute_write(_prune_orphan_semantic_nodes)
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


def graph_get_insights(limit: int = 10) -> Dict[str, Any]:
    driver = get_graph_driver()
    if not driver:
        return {
            "status": "unavailable",
            "reason": "graph credentials or uri not configured",
            "supplier_risk": [],
            "top_recipients": [],
            "top_products": [],
            "status_distribution": [],
            "anomaly_candidates": [],
        }

    top_n = max(1, min(int(limit or 10), 100))

    supplier_risk_query = """
    MATCH (i:Invoice)-[:BELONGS_TO]->(s:Supplier)
    OPTIONAL MATCH (a:InvoiceAction)-[:TARGETS]->(i)
    WITH s, i, collect(distinct a) AS actions
    WITH s,
         count(distinct i) AS invoice_count,
         sum(coalesce(toFloat(i.gross_amount), 0.0)) AS gross_amount_sum,
         sum(CASE WHEN any(x IN actions WHERE x.action_type = 'reject') THEN 1 ELSE 0 END) AS rejected_count,
         sum(CASE WHEN any(x IN actions WHERE x.action_type = 'hold') THEN 1 ELSE 0 END) AS hold_count,
         sum(CASE WHEN any(x IN actions WHERE x.action_type = 'request_clarification') THEN 1 ELSE 0 END) AS clarification_count
    RETURN
      s.name AS supplier_name,
      invoice_count,
      round(gross_amount_sum, 2) AS gross_amount_sum,
      rejected_count,
      hold_count,
      clarification_count,
      round(toFloat(rejected_count) / CASE WHEN invoice_count = 0 THEN 1 ELSE invoice_count END, 4) AS reject_rate
    ORDER BY reject_rate DESC, invoice_count DESC
    LIMIT $limit
    """

    top_recipients_query = """
    MATCH (i:Invoice)-[:HAS_DATA_FIELD]->(d:InvoiceDataField)
    WHERE d.field_name IN ['recipient', 'empfaenger', 'leistungsempfaenger']
    RETURN
      d.value AS recipient_value,
      count(distinct i) AS invoice_count,
      round(sum(coalesce(toFloat(i.gross_amount), 0.0)), 2) AS gross_amount_sum
    ORDER BY invoice_count DESC, gross_amount_sum DESC
    LIMIT $limit
    """

    top_products_query = """
    MATCH (i:Invoice)-[:HAS_LINE]->(l:InvoiceLine)
    WITH coalesce(l.description, '(ohne bezeichnung)') AS product_name,
         count(l) AS line_count,
         sum(coalesce(toFloat(l.quantity), 0.0)) AS quantity_sum,
         sum(coalesce(toFloat(l.line_amount), 0.0)) AS amount_sum
    RETURN
      product_name,
      line_count,
      round(quantity_sum, 2) AS quantity_sum,
      round(amount_sum, 2) AS amount_sum
    ORDER BY amount_sum DESC, line_count DESC
    LIMIT $limit
    """

    status_distribution_query = """
    MATCH (i:Invoice)-[:HAS_STATUS]->(s:InvoiceStatus)
    OPTIONAL MATCH (a:InvoiceAction)-[:TARGETS]->(i)
    WITH s.name AS status_name,
         count(distinct i) AS invoice_count,
         count(distinct a) AS action_count
    RETURN
      status_name,
      invoice_count,
      action_count,
      round(toFloat(action_count) / CASE WHEN invoice_count = 0 THEN 1 ELSE invoice_count END, 2) AS actions_per_invoice
    ORDER BY invoice_count DESC
    """

    anomaly_candidates_query = """
    MATCH (i:Invoice)-[:BELONGS_TO]->(s:Supplier)
    OPTIONAL MATCH (a:InvoiceAction)-[:TARGETS]->(i)
    WITH s, i, collect(distinct a) AS actions
    WITH s,
         count(distinct i) AS invoice_count,
         sum(coalesce(toFloat(i.gross_amount), 0.0)) AS gross_amount_sum,
         sum(CASE WHEN any(x IN actions WHERE x.action_type = 'reject') THEN 1 ELSE 0 END) AS rejected_count
    WHERE invoice_count >= 2
    WITH s, invoice_count, gross_amount_sum, rejected_count,
         toFloat(rejected_count) / invoice_count AS reject_rate
    WHERE reject_rate >= 0.3 OR gross_amount_sum >= 5000
    RETURN
      s.name AS supplier_name,
      invoice_count,
      round(gross_amount_sum, 2) AS gross_amount_sum,
      rejected_count,
      round(reject_rate, 4) AS reject_rate,
      CASE
        WHEN reject_rate >= 0.5 THEN 'high_reject_rate'
        WHEN gross_amount_sum >= 10000 THEN 'high_amount_volume'
        ELSE 'watchlist'
      END AS signal
    ORDER BY reject_rate DESC, gross_amount_sum DESC
    LIMIT $limit
    """

    def _run(session, query: str, params: Dict[str, Any]) -> List[Dict[str, Any]]:
        records = session.run(query, **params)
        out: List[Dict[str, Any]] = []
        for rec in records:
            row = {}
            for key in rec.keys():
                row[key] = _json_safe(rec.get(key))
            out.append(row)
        return out

    try:
        with driver.session() as session:
            supplier_risk = _run(session, supplier_risk_query, {"limit": top_n})
            top_recipients = _run(session, top_recipients_query, {"limit": top_n})
            top_products = _run(session, top_products_query, {"limit": top_n})
            status_distribution = _run(session, status_distribution_query, {"limit": top_n})
            anomaly_candidates = _run(session, anomaly_candidates_query, {"limit": top_n})
        return {
            "status": "ok",
            "limit": top_n,
            "supplier_risk": supplier_risk,
            "top_recipients": top_recipients,
            "top_products": top_products,
            "status_distribution": status_distribution,
            "anomaly_candidates": anomaly_candidates,
        }
    except Exception as exc:
        return {
            "status": "error",
            "reason": str(exc),
            "supplier_risk": [],
            "top_recipients": [],
            "top_products": [],
            "status_distribution": [],
            "anomaly_candidates": [],
        }


def _parse_date(value: str) -> Optional[date]:
    if not value:
        return None
    try:
        return datetime.fromisoformat(str(value)).date()
    except Exception:
        return None


def _period_aggregate(session, start_iso: str, end_iso: str) -> Dict[str, float]:
    query = """
    MATCH (i:Invoice)
    WITH i, date(i.invoice_date) AS d
    WHERE d IS NOT NULL AND d >= date($start_date) AND d < date($end_date)
    OPTIONAL MATCH (a:InvoiceAction)-[:TARGETS]->(i)
    WITH i, collect(distinct a.action_type) AS action_types
    WITH
      count(distinct i) AS invoice_count,
      sum(coalesce(toFloat(i.gross_amount), 0.0)) AS total_amount,
      sum(CASE WHEN 'reject' IN action_types THEN 1 ELSE 0 END) AS reject_count,
      sum(CASE WHEN 'hold' IN action_types THEN 1 ELSE 0 END) AS hold_count,
      sum(CASE WHEN 'request_clarification' IN action_types THEN 1 ELSE 0 END) AS clarification_count
    RETURN
      invoice_count,
      round(total_amount, 2) AS total_amount,
      round(toFloat(reject_count) / CASE WHEN invoice_count = 0 THEN 1 ELSE invoice_count END, 4) AS reject_rate,
      round(toFloat(hold_count) / CASE WHEN invoice_count = 0 THEN 1 ELSE invoice_count END, 4) AS hold_rate,
      round(toFloat(clarification_count) / CASE WHEN invoice_count = 0 THEN 1 ELSE invoice_count END, 4) AS clarification_rate
    """
    rec = session.run(query, start_date=start_iso, end_date=end_iso).single()
    if not rec:
        return {
            "invoice_count": 0.0,
            "total_amount": 0.0,
            "reject_rate": 0.0,
            "hold_rate": 0.0,
            "clarification_rate": 0.0,
        }
    return {
        "invoice_count": float(rec.get("invoice_count") or 0),
        "total_amount": float(rec.get("total_amount") or 0),
        "reject_rate": float(rec.get("reject_rate") or 0),
        "hold_rate": float(rec.get("hold_rate") or 0),
        "clarification_rate": float(rec.get("clarification_rate") or 0),
    }


def graph_get_trend_insights(
    window_days: int = 30,
    compare_days: Optional[int] = None,
    granularity: str = "week",
) -> Dict[str, Any]:
    driver = get_graph_driver()
    if not driver:
        return {
            "status": "unavailable",
            "reason": "graph credentials or uri not configured",
            "trends": [],
        }

    wd = max(1, min(int(window_days or 30), 365))
    cd = max(1, min(int(compare_days or wd), 365))
    g = str(granularity or "week").strip().lower()
    if g not in ALLOWED_TREND_GRANULARITIES:
        g = "week"

    today = datetime.now(timezone.utc).date()
    current_end = today + timedelta(days=1)
    current_start = current_end - timedelta(days=wd)
    previous_end = current_start
    previous_start = previous_end - timedelta(days=cd)

    trends_query = """
    MATCH (i:Invoice)
    WITH i, date(i.invoice_date) AS d
    WHERE d IS NOT NULL AND d >= date($start_date) AND d < date($end_date)
    OPTIONAL MATCH (a:InvoiceAction)-[:TARGETS]->(i)
    WITH i, d, collect(distinct a.action_type) AS action_types
    WITH
      i,
      action_types,
      CASE
        WHEN $granularity = 'day' THEN d
        WHEN $granularity = 'month' THEN date({year: d.year, month: d.month, day: 1})
        ELSE date.truncate('week', d)
      END AS bucket_start
    WITH
      bucket_start,
      CASE
        WHEN $granularity = 'day' THEN bucket_start + duration('P1D')
        WHEN $granularity = 'month' THEN bucket_start + duration('P1M')
        ELSE bucket_start + duration('P7D')
      END AS bucket_end,
      collect(distinct i) AS invoices,
      collect(action_types) AS action_sets
    WITH
      bucket_start,
      bucket_end,
      size(invoices) AS invoice_count,
      round(reduce(sumAmount = 0.0, inv IN invoices | sumAmount + coalesce(toFloat(inv.gross_amount), 0.0)), 2) AS total_amount,
      reduce(rejectCount = 0, actions IN action_sets | rejectCount + CASE WHEN 'reject' IN actions THEN 1 ELSE 0 END) AS reject_count,
      reduce(holdCount = 0, actions IN action_sets | holdCount + CASE WHEN 'hold' IN actions THEN 1 ELSE 0 END) AS hold_count,
      reduce(clarCount = 0, actions IN action_sets | clarCount + CASE WHEN 'request_clarification' IN actions THEN 1 ELSE 0 END) AS clarification_count
    RETURN
      toString(bucket_start) AS bucket_start,
      toString(bucket_end) AS bucket_end,
      invoice_count,
      total_amount,
      round(toFloat(reject_count) / CASE WHEN invoice_count = 0 THEN 1 ELSE invoice_count END, 4) AS reject_rate,
      round(toFloat(hold_count) / CASE WHEN invoice_count = 0 THEN 1 ELSE invoice_count END, 4) AS hold_rate,
      round(toFloat(clarification_count) / CASE WHEN invoice_count = 0 THEN 1 ELSE invoice_count END, 4) AS clarification_rate
    ORDER BY bucket_start ASC
    """

    try:
        with driver.session() as session:
            trend_rows = []
            for rec in session.run(
                trends_query,
                start_date=current_start.isoformat(),
                end_date=current_end.isoformat(),
                granularity=g,
            ):
                trend_rows.append(
                    {
                        "bucket_start": _json_safe(rec.get("bucket_start")),
                        "bucket_end": _json_safe(rec.get("bucket_end")),
                        "invoice_count": _json_safe(rec.get("invoice_count")),
                        "total_amount": _json_safe(rec.get("total_amount")),
                        "reject_rate": _json_safe(rec.get("reject_rate")),
                        "hold_rate": _json_safe(rec.get("hold_rate")),
                        "clarification_rate": _json_safe(rec.get("clarification_rate")),
                    }
                )

            current_summary = _period_aggregate(session, current_start.isoformat(), current_end.isoformat())
            previous_summary = _period_aggregate(session, previous_start.isoformat(), previous_end.isoformat())

        delta = {}
        for key, current_val in current_summary.items():
            prev_val = float(previous_summary.get(key) or 0.0)
            abs_change = float(current_val) - prev_val
            pct_change = None
            if prev_val != 0:
                pct_change = round(abs_change / prev_val, 4)
            delta[key] = {
                "absolute": round(abs_change, 4),
                "percent": pct_change,
            }

        return {
            "status": "ok",
            "config": {
                "window_days": wd,
                "compare_days": cd,
                "granularity": g,
            },
            "periods": {
                "current_start": current_start.isoformat(),
                "current_end": current_end.isoformat(),
                "previous_start": previous_start.isoformat(),
                "previous_end": previous_end.isoformat(),
            },
            "summary": {
                "current": current_summary,
                "previous": previous_summary,
                "delta": delta,
            },
            "trends": trend_rows,
        }
    except Exception as exc:
        return {
            "status": "error",
            "reason": str(exc),
            "trends": [],
        }


def graph_get_insight_drilldown(
    metric: str,
    period_start: str,
    period_end: str,
    limit: int = 100,
    offset: int = 0,
) -> Dict[str, Any]:
    driver = get_graph_driver()
    if not driver:
        return {
            "status": "unavailable",
            "reason": "graph credentials or uri not configured",
            "items": [],
            "total": 0,
        }

    m = str(metric or "").strip().lower()
    if m not in ALLOWED_DRILLDOWN_METRICS:
        return {
            "status": "error",
            "reason": f"unsupported metric: {metric}",
            "items": [],
            "total": 0,
        }
    start = _parse_date(period_start)
    end = _parse_date(period_end)
    if not start or not end or start >= end:
        return {
            "status": "error",
            "reason": "invalid period_start/period_end",
            "items": [],
            "total": 0,
        }

    l = max(1, min(int(limit or 100), 500))
    o = max(0, int(offset or 0))

    where_by_metric = {
        "invoice_count": "true",
        "total_amount": "true",
        "reject_rate": "'reject' IN action_types",
        "hold_rate": "'hold' IN action_types",
        "clarification_rate": "'request_clarification' IN action_types",
    }

    base_with = """
    MATCH (i:Invoice)
    WITH i, date(i.invoice_date) AS d
    WHERE d IS NOT NULL AND d >= date($start_date) AND d < date($end_date)
    OPTIONAL MATCH (s:Supplier)<-[:BELONGS_TO]-(i)
    OPTIONAL MATCH (a:InvoiceAction)-[:TARGETS]->(i)
    WITH i, s, collect(distinct a.action_type) AS action_types
    """

    total_query = (
        base_with
        + f"""
    WHERE {where_by_metric[m]}
    RETURN count(distinct i) AS total
    """
    )

    items_query = (
        base_with
        + f"""
    WHERE {where_by_metric[m]}
    RETURN
      i.id AS invoice_id,
      i.invoice_number AS invoice_number,
      i.invoice_date AS invoice_date,
      i.status AS status,
      i.currency AS currency,
      i.gross_amount AS gross_amount,
      i.supplier_name AS supplier_name_fallback,
      s.name AS supplier_name_graph,
      action_types
    ORDER BY i.invoice_date DESC
    SKIP $offset
    LIMIT $limit
    """
    )

    try:
        with driver.session() as session:
            total_rec = session.run(
                total_query,
                start_date=start.isoformat(),
                end_date=end.isoformat(),
            ).single()
            total = int(total_rec.get("total") or 0) if total_rec else 0
            rows = session.run(
                items_query,
                start_date=start.isoformat(),
                end_date=end.isoformat(),
                offset=o,
                limit=l,
            )
            items = []
            for rec in rows:
                items.append(
                    {
                        "invoice_id": _json_safe(rec.get("invoice_id")),
                        "invoice_number": _json_safe(rec.get("invoice_number")),
                        "invoice_date": _json_safe(rec.get("invoice_date")),
                        "status": _json_safe(rec.get("status")),
                        "currency": _json_safe(rec.get("currency")),
                        "gross_amount": _json_safe(rec.get("gross_amount")),
                        "supplier_name": _json_safe(rec.get("supplier_name_graph") or rec.get("supplier_name_fallback")),
                        "action_types": _json_safe(rec.get("action_types") or []),
                    }
                )
        return {
            "status": "ok",
            "metric": m,
            "period_start": start.isoformat(),
            "period_end": end.isoformat(),
            "limit": l,
            "offset": o,
            "total": total,
            "items": items,
        }
    except Exception as exc:
        return {
            "status": "error",
            "reason": str(exc),
            "items": [],
            "total": 0,
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
