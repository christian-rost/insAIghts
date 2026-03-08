from __future__ import annotations

from datetime import datetime, timedelta, timezone
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


def _day_key(dt: datetime) -> str:
    return dt.astimezone(timezone.utc).date().isoformat()


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
    invoices_by_id = {str(inv.get("id") or ""): inv for inv in invoices if str(inv.get("id") or "")}
    action_types_by_invoice: Dict[str, set[str]] = {}

    approved_24h = 0
    avg_minutes_to_approve = None
    approval_durations = []
    actions_by_type: Dict[str, int] = {}

    trend_days = 14
    day_template: Dict[str, Dict[str, Any]] = {}
    for day_offset in range(trend_days - 1, -1, -1):
        day = _day_key(now.replace(hour=0, minute=0, second=0, microsecond=0) - timedelta(days=day_offset))
        day_template[day] = {
            "day": day,
            "documents_ingested": 0,
            "invoices_created": 0,
            "approvals": 0,
        }

    for doc in documents:
        created_at = _parse_iso(str(doc.get("created_at") or ""))
        if not created_at:
            continue
        key = _day_key(created_at)
        if key in day_template:
            day_template[key]["documents_ingested"] += 1

    supplier_volume: Dict[str, int] = {}
    supplier_exception: Dict[str, int] = {}
    for inv in invoices:
        created_at = _parse_iso(str(inv.get("created_at") or ""))
        if created_at:
            key = _day_key(created_at)
            if key in day_template:
                day_template[key]["invoices_created"] += 1
        supplier = str(inv.get("supplier_name") or "").strip() or "Unknown"
        supplier_volume[supplier] = supplier_volume.get(supplier, 0) + 1
        status = str(inv.get("status") or "")
        if status in {"NEEDS_REVIEW", "REJECTED", "ON_HOLD", "CLARIFICATION_REQUESTED"}:
            supplier_exception[supplier] = supplier_exception.get(supplier, 0) + 1

    for action in actions:
        action_type = str(action.get("action_type") or "")
        if not action_type:
            continue
        actions_by_type[action_type] = actions_by_type.get(action_type, 0) + 1

        invoice_id = str(action.get("invoice_id") or "")
        if invoice_id:
            action_types_by_invoice.setdefault(invoice_id, set()).add(action_type)

        created_at = _parse_iso(str(action.get("created_at") or ""))
        if action_type == "approve" and created_at and (now - created_at).total_seconds() <= 86400:
            approved_24h += 1

        if action_type == "approve" and created_at:
            key = _day_key(created_at)
            if key in day_template:
                day_template[key]["approvals"] += 1

            invoice = invoices_by_id.get(invoice_id)
            invoice_created_at = _parse_iso(str((invoice or {}).get("created_at") or ""))
            if invoice_created_at and created_at >= invoice_created_at:
                approval_durations.append((created_at - invoice_created_at).total_seconds() / 60.0)

    if approval_durations:
        avg_minutes_to_approve = round(sum(approval_durations) / len(approval_durations), 2)

    approved_invoices = [inv for inv in invoices if str(inv.get("status") or "") == "APPROVED"]
    touchless_count = 0
    for inv in approved_invoices:
        inv_id = str(inv.get("id") or "")
        action_set = action_types_by_invoice.get(inv_id, set())
        if "approve" in action_set and action_set.issubset({"approve"}):
            touchless_count += 1
    touchless_rate = round((touchless_count / len(approved_invoices)), 4) if approved_invoices else None

    top_by_volume = sorted(
        [{"supplier_name": k, "invoice_count": v} for k, v in supplier_volume.items()],
        key=lambda x: x["invoice_count"],
        reverse=True,
    )[:10]

    top_exception_rate = []
    for supplier_name, total in supplier_volume.items():
        if total < 2:
            continue
        exceptions = supplier_exception.get(supplier_name, 0)
        top_exception_rate.append(
            {
                "supplier_name": supplier_name,
                "invoice_count": total,
                "exception_count": exceptions,
                "exception_rate": round(exceptions / total, 4),
            }
        )
    top_exception_rate = sorted(top_exception_rate, key=lambda x: x["exception_rate"], reverse=True)[:10]

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
            "touchless_rate": touchless_rate,
        },
        "actions_by_type": actions_by_type,
        "trend_last_14d": list(day_template.values()),
        "supplier_quality": {
            "top_by_volume": top_by_volume,
            "top_exception_rate": top_exception_rate,
        },
    }
