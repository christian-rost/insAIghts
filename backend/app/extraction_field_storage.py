from __future__ import annotations

from datetime import datetime, timezone
import uuid
from typing import Any, Dict, List, Optional

from .config import EXTRACTION_FIELDS_TABLE
from .database import get_db

DEFAULT_FIELDS = [
    {"entity_name": "invoice", "scope": "header", "field_name": "supplier_name", "display_name": "Lieferantenname", "description": "Name des Lieferanten", "data_type": "string", "is_required": True, "is_enabled": True, "sort_order": 10},
    {"entity_name": "invoice", "scope": "header", "field_name": "invoice_number", "display_name": "Rechnungsnummer", "description": "Eindeutige Rechnungsnummer", "data_type": "string", "is_required": True, "is_enabled": True, "sort_order": 20},
    {"entity_name": "invoice", "scope": "header", "field_name": "invoice_date", "display_name": "Rechnungsdatum", "description": "Rechnungsdatum", "data_type": "date", "is_required": True, "is_enabled": True, "sort_order": 30},
    {"entity_name": "invoice", "scope": "header", "field_name": "due_date", "display_name": "Faelligkeitsdatum", "description": "Faelligkeitsdatum", "data_type": "date", "is_required": False, "is_enabled": True, "sort_order": 40},
    {"entity_name": "invoice", "scope": "header", "field_name": "currency", "display_name": "Waehrung", "description": "Waehrung als ISO Code", "data_type": "string", "is_required": False, "is_enabled": True, "sort_order": 50},
    {"entity_name": "invoice", "scope": "header", "field_name": "gross_amount", "display_name": "Bruttobetrag", "description": "Bruttobetrag der Rechnung", "data_type": "number", "is_required": True, "is_enabled": True, "sort_order": 60},
    {"entity_name": "invoice", "scope": "header", "field_name": "net_amount", "display_name": "Nettobetrag", "description": "Nettobetrag der Rechnung", "data_type": "number", "is_required": False, "is_enabled": True, "sort_order": 70},
    {"entity_name": "invoice", "scope": "header", "field_name": "tax_amount", "display_name": "Steuerbetrag", "description": "Steuerbetrag", "data_type": "number", "is_required": False, "is_enabled": True, "sort_order": 80},
    {"entity_name": "invoice", "scope": "line_item", "field_name": "line_no", "display_name": "Positionsnummer", "description": "Positionsnummer", "data_type": "integer", "is_required": False, "is_enabled": True, "sort_order": 10},
    {"entity_name": "invoice", "scope": "line_item", "field_name": "description", "display_name": "Positionsbeschreibung", "description": "Positionsbeschreibung", "data_type": "string", "is_required": False, "is_enabled": True, "sort_order": 20},
    {"entity_name": "invoice", "scope": "line_item", "field_name": "quantity", "display_name": "Menge", "description": "Menge", "data_type": "number", "is_required": False, "is_enabled": True, "sort_order": 30},
    {"entity_name": "invoice", "scope": "line_item", "field_name": "unit_price", "display_name": "Einzelpreis", "description": "Einzelpreis", "data_type": "number", "is_required": False, "is_enabled": True, "sort_order": 40},
    {"entity_name": "invoice", "scope": "line_item", "field_name": "line_amount", "display_name": "Positionsbetrag", "description": "Gesamtbetrag der Position", "data_type": "number", "is_required": False, "is_enabled": True, "sort_order": 50},
    {"entity_name": "invoice", "scope": "line_item", "field_name": "tax_rate", "display_name": "Steuersatz", "description": "Steuersatz der Position in Prozent", "data_type": "number", "is_required": False, "is_enabled": True, "sort_order": 60},
]

_mem_fields: Dict[str, Dict[str, Any]] = {}
for row in DEFAULT_FIELDS:
    row_id = str(uuid.uuid4())
    _mem_fields[row_id] = {
        "id": row_id,
        **row,
        "updated_by": None,
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _normalize(row: Dict[str, Any]) -> Dict[str, Any]:
    field_name = row.get("field_name")
    return {
        "id": row.get("id"),
        "entity_name": row.get("entity_name"),
        "scope": row.get("scope"),
        "field_name": field_name,
        "display_name": row.get("display_name") or field_name or "",
        "description": row.get("description") or "",
        "data_type": (row.get("data_type") or "string").lower(),
        "is_required": bool(row.get("is_required", False)),
        "is_enabled": bool(row.get("is_enabled", True)),
        "sort_order": int(row.get("sort_order") or 0),
        "updated_by": row.get("updated_by"),
        "updated_at": row.get("updated_at"),
    }


def _ensure_defaults_db() -> None:
    db = get_db()
    if not db:
        return
    for row in DEFAULT_FIELDS:
        result = (
            db.table(EXTRACTION_FIELDS_TABLE)
            .select("id")
            .eq("entity_name", row["entity_name"])
            .eq("scope", row["scope"])
            .eq("field_name", row["field_name"])
            .limit(1)
            .execute()
        )
        if result.data:
            continue
        try:
            db.table(EXTRACTION_FIELDS_TABLE).insert(row).execute()
        except Exception as exc:
            if "display_name" not in str(exc):
                raise
            db.table(EXTRACTION_FIELDS_TABLE).insert({k: v for k, v in row.items() if k != "display_name"}).execute()


def list_extraction_fields(entity_name: str = "invoice", enabled_only: bool = False) -> List[Dict[str, Any]]:
    db = get_db()
    if db:
        _ensure_defaults_db()
        query = db.table(EXTRACTION_FIELDS_TABLE).select("*").eq("entity_name", entity_name)
        if enabled_only:
            query = query.eq("is_enabled", True)
        result = query.order("scope").order("sort_order").order("field_name").execute()
        return [_normalize(r) for r in (result.data or [])]

    rows = [v for v in _mem_fields.values() if v.get("entity_name") == entity_name]
    if enabled_only:
        rows = [v for v in rows if v.get("is_enabled", True)]
    rows = sorted(rows, key=lambda r: (str(r.get("scope")), int(r.get("sort_order") or 0), str(r.get("field_name"))))
    return [_normalize(r) for r in rows]


def upsert_extraction_field(
    *,
    entity_name: str,
    scope: str,
    field_name: str,
    display_name: str,
    description: str,
    data_type: str,
    is_required: bool,
    is_enabled: bool,
    sort_order: int,
    actor_user_id: Optional[str] = None,
) -> Dict[str, Any]:
    scope = scope.lower()
    data_type = data_type.lower()
    if scope not in {"header", "line_item"}:
        raise ValueError("scope must be header or line_item")
    if data_type not in {"string", "number", "integer", "date", "boolean"}:
        raise ValueError("data_type must be one of: string, number, integer, date, boolean")

    db = get_db()
    payload = {
        "entity_name": entity_name,
        "scope": scope,
        "field_name": field_name,
        "display_name": display_name or field_name,
        "description": description,
        "data_type": data_type,
        "is_required": is_required,
        "is_enabled": is_enabled,
        "sort_order": sort_order,
        "updated_by": actor_user_id,
        "updated_at": _now_iso(),
    }

    if db:
        _ensure_defaults_db()
        existing = (
            db.table(EXTRACTION_FIELDS_TABLE)
            .select("id")
            .eq("entity_name", entity_name)
            .eq("scope", scope)
            .eq("field_name", field_name)
            .limit(1)
            .execute()
        )
        if existing.data:
            try:
                result = (
                    db.table(EXTRACTION_FIELDS_TABLE)
                    .update(payload)
                    .eq("id", existing.data[0]["id"])
                    .execute()
                )
            except Exception as exc:
                if "display_name" not in str(exc):
                    raise
                fallback_payload = {k: v for k, v in payload.items() if k != "display_name"}
                result = (
                    db.table(EXTRACTION_FIELDS_TABLE)
                    .update(fallback_payload)
                    .eq("id", existing.data[0]["id"])
                    .execute()
                )
        else:
            try:
                result = db.table(EXTRACTION_FIELDS_TABLE).insert(payload).execute()
            except Exception as exc:
                if "display_name" not in str(exc):
                    raise
                fallback_payload = {k: v for k, v in payload.items() if k != "display_name"}
                result = db.table(EXTRACTION_FIELDS_TABLE).insert(fallback_payload).execute()
        rows = result.data or []
        return _normalize(rows[0] if rows else payload)

    existing_id = None
    for rid, row in _mem_fields.items():
        if row.get("entity_name") == entity_name and row.get("scope") == scope and row.get("field_name") == field_name:
            existing_id = rid
            break

    if existing_id:
        _mem_fields[existing_id].update(payload)
        return _normalize(_mem_fields[existing_id])

    row_id = str(uuid.uuid4())
    row = {"id": row_id, **payload}
    _mem_fields[row_id] = row
    return _normalize(row)
