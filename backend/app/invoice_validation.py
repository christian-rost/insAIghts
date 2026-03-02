from __future__ import annotations

from typing import Any, Dict, List

from .invoice_storage import list_invoices


def _norm_text(value: Any) -> str:
    return str(value or "").strip().lower()


def _norm_amount(value: Any) -> str:
    try:
        return f"{float(value):.2f}"
    except Exception:
        return ""


def _invoice_key(row: Dict[str, Any]) -> str:
    return "|".join(
        [
            _norm_text(row.get("supplier_name")),
            _norm_text(row.get("invoice_number")),
            _norm_text(row.get("invoice_date")),
            _norm_amount(row.get("gross_amount")),
        ]
    )


def validate_invoice(invoice: Dict[str, Any], existing_invoices: List[Dict[str, Any]]) -> Dict[str, Any]:
    errors: List[str] = []
    warnings: List[str] = []

    required_fields = ["supplier_name", "invoice_number", "invoice_date", "gross_amount"]
    for field in required_fields:
        if invoice.get(field) in [None, ""]:
            errors.append(f"missing_{field}")

    gross = invoice.get("gross_amount")
    try:
        if gross is not None and float(gross) <= 0:
            errors.append("gross_amount_non_positive")
    except Exception:
        errors.append("gross_amount_invalid")

    own_id = str(invoice.get("id") or "")
    key = _invoice_key(invoice)
    duplicate_ids = []
    if key.strip("|"):
        for row in existing_invoices:
            if str(row.get("id") or "") == own_id:
                continue
            if _invoice_key(row) == key:
                duplicate_ids.append(str(row.get("id")))

    if duplicate_ids:
        errors.append("possible_duplicate")

    status = "VALIDATED" if not errors else "NEEDS_REVIEW"
    score = 1.0 if not errors else 0.4

    return {
        "status": status,
        "validation": {
            "errors": errors,
            "warnings": warnings,
            "duplicate_invoice_ids": duplicate_ids,
            "rule_version": "v1",
            "score": score,
        },
    }


def load_validation_context(limit: int = 1000) -> List[Dict[str, Any]]:
    return list_invoices(limit=limit)
