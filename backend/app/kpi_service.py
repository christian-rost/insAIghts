from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Dict

from .case_storage import list_cases
from .document_storage import list_documents
from .invoice_action_storage import list_all_invoice_actions
from .invoice_storage import list_invoices


def _parse_iso(value: str) -> datetime | None:
    if not value:
        return None
    try:
        if value.endswith("Z"):
            value = value[:-1] + "+00:00"
        return datetime.fromisoformat(value)
    except Exception:
        return None


def get_kpi_overview(limit: int = 5000) -> Dict[str, Any]:
    invoices = list_invoices(limit=limit)
    documents = list_documents(limit=limit)
    actions = list_all_invoice_actions(limit=limit)
    cases = list_cases(limit=limit)

    invoice_by_status: Dict[str, int] = {}
    for inv in invoices:
        status = str(inv.get("status") or "UNKNOWN")
        invoice_by_status[status] = invoice_by_status.get(status, 0) + 1

    doc_by_status: Dict[str, int] = {}
    for doc in documents:
        status = str(doc.get("status") or "UNKNOWN")
        doc_by_status[status] = doc_by_status.get(status, 0) + 1

    case_by_status: Dict[str, int] = {}
    for c in cases:
        status = str(c.get("status") or "UNKNOWN")
        case_by_status[status] = case_by_status.get(status, 0) + 1

    now = datetime.now(timezone.utc)
    approved_24h = 0
    avg_minutes_to_approve = None
    approval_durations = []
    for action in actions:
        if str(action.get("action_type") or "") != "approve":
            continue
        created_at = _parse_iso(str(action.get("created_at") or ""))
        if created_at and (now - created_at).total_seconds() <= 86400:
            approved_24h += 1

        invoice_created_at = _parse_iso(str(action.get("invoice_created_at") or ""))
        if created_at and invoice_created_at and created_at >= invoice_created_at:
            approval_durations.append((created_at - invoice_created_at).total_seconds() / 60.0)

    if approval_durations:
        avg_minutes_to_approve = round(sum(approval_durations) / len(approval_durations), 2)

    return {
        "totals": {
            "documents": len(documents),
            "invoices": len(invoices),
            "actions": len(actions),
            "cases": len(cases),
            "open_cases": sum(1 for c in cases if str(c.get("status") or "") in {"OPEN", "IN_PROGRESS"}),
        },
        "documents_by_status": doc_by_status,
        "invoices_by_status": invoice_by_status,
        "cases_by_status": case_by_status,
        "throughput": {
            "approved_last_24h": approved_24h,
            "avg_minutes_to_approve": avg_minutes_to_approve,
        },
    }
