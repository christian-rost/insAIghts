from __future__ import annotations

from datetime import datetime, timezone
import uuid
from typing import Any, Dict, List, Optional

from .config import INVOICE_LINES_TABLE, INVOICES_TABLE
from .database import get_db

_mem_invoices: Dict[str, Dict[str, Any]] = {}
_mem_invoice_lines: Dict[str, List[Dict[str, Any]]] = {}


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def create_invoice(row: Dict[str, Any]) -> Dict[str, Any]:
    db = get_db()
    payload = {**row}
    payload.setdefault("id", str(uuid.uuid4()))
    payload.setdefault("created_at", _now_iso())
    payload.setdefault("updated_at", _now_iso())

    if db:
        result = db.table(INVOICES_TABLE).insert(payload).execute()
        rows = result.data or []
        return rows[0] if rows else payload

    _mem_invoices[payload["id"]] = payload
    return payload


def create_invoice_lines(invoice_id: str, lines: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    db = get_db()
    payload: List[Dict[str, Any]] = []
    for idx, line in enumerate(lines, start=1):
        payload.append(
            {
                "id": str(uuid.uuid4()),
                "invoice_id": invoice_id,
                "line_no": int(line.get("line_no") or idx),
                "description": line.get("description"),
                "quantity": line.get("quantity"),
                "unit_price": line.get("unit_price"),
                "line_amount": line.get("line_amount"),
                "tax_rate": line.get("tax_rate"),
                "created_at": _now_iso(),
            }
        )

    if not payload:
        return []

    if db:
        result = db.table(INVOICE_LINES_TABLE).insert(payload).execute()
        return result.data or payload

    _mem_invoice_lines.setdefault(invoice_id, []).extend(payload)
    return payload


def get_invoice_by_document(document_id: str) -> Optional[Dict[str, Any]]:
    db = get_db()
    if db:
        result = db.table(INVOICES_TABLE).select("*").eq("document_id", document_id).limit(1).execute()
        rows = result.data or []
        return rows[0] if rows else None

    for row in _mem_invoices.values():
        if row.get("document_id") == document_id:
            return row
    return None


def list_invoices(limit: int = 100) -> List[Dict[str, Any]]:
    db = get_db()
    if db:
        result = db.table(INVOICES_TABLE).select("*").order("created_at", desc=True).limit(limit).execute()
        return result.data or []

    rows = sorted(_mem_invoices.values(), key=lambda x: x.get("created_at", ""), reverse=True)
    return rows[:limit]
