from __future__ import annotations

from typing import Any, Dict

from .case_storage import _mem_cases
from .config import DOCUMENTS_TABLE, INVOICE_ACTIONS_TABLE, INVOICE_CASES_TABLE, INVOICE_LINES_TABLE, INVOICES_TABLE
from .database import get_db
from .document_storage import _mem_documents
from .invoice_action_storage import _mem_actions
from .invoice_storage import _mem_invoice_lines, _mem_invoices

_ALL_UUID = "00000000-0000-0000-0000-000000000000"


def reset_invoice_pipeline_data() -> Dict[str, Any]:
    db = get_db()
    if db:
        try:
            rpc_result = db.rpc("insaights_reset_invoice_pipeline").execute()
            data = rpc_result.data
            if isinstance(data, list) and data:
                payload = data[0]
            elif isinstance(data, dict):
                payload = data
            else:
                payload = {"status": "ok"}
            return {"status": "ok", "storage": "supabase", "details": payload}
        except Exception:
            # Fallback path if RPC is not yet installed in schema.
            pass

        deleted_actions = db.table(INVOICE_ACTIONS_TABLE).delete().neq("id", _ALL_UUID).execute().data or []
        deleted_cases = db.table(INVOICE_CASES_TABLE).delete().neq("id", _ALL_UUID).execute().data or []
        deleted_lines = db.table(INVOICE_LINES_TABLE).delete().neq("id", _ALL_UUID).execute().data or []
        deleted_invoices = db.table(INVOICES_TABLE).delete().neq("id", _ALL_UUID).execute().data or []
        deleted_documents = db.table(DOCUMENTS_TABLE).delete().neq("id", _ALL_UUID).execute().data or []

        return {
            "status": "ok",
            "storage": "supabase",
            "details": {
                "invoice_actions_deleted": len(deleted_actions),
                "invoice_cases_deleted": len(deleted_cases),
                "invoice_lines_deleted": len(deleted_lines),
                "invoices_deleted": len(deleted_invoices),
                "documents_deleted": len(deleted_documents),
                "mode": "fallback_delete",
            },
        }

    actions_count = sum(len(v) for v in _mem_actions.values())
    lines_count = sum(len(v) for v in _mem_invoice_lines.values())
    cases_count = len(_mem_cases)
    invoices_count = len(_mem_invoices)
    documents_count = len(_mem_documents)

    _mem_actions.clear()
    _mem_cases.clear()
    _mem_invoice_lines.clear()
    _mem_invoices.clear()
    _mem_documents.clear()

    return {
        "status": "ok",
        "storage": "memory",
        "details": {
            "invoice_actions_deleted": actions_count,
            "invoice_cases_deleted": cases_count,
            "invoice_lines_deleted": lines_count,
            "invoices_deleted": invoices_count,
            "documents_deleted": documents_count,
        },
    }
