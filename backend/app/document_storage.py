from __future__ import annotations

from datetime import datetime, timezone
import uuid
from typing import Any, Dict, List, Optional

from .config import DOCUMENTS_TABLE
from .database import get_db

_mem_documents: Dict[str, Dict[str, Any]] = {}


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def list_documents(limit: int = 100) -> List[Dict[str, Any]]:
    db = get_db()
    if db:
        result = (
            db.table(DOCUMENTS_TABLE)
            .select("*")
            .order("created_at", desc=True)
            .limit(limit)
            .execute()
        )
        return result.data or []
    rows = sorted(_mem_documents.values(), key=lambda x: x.get("created_at", ""), reverse=True)
    return rows[:limit]


def get_document_by_source_uri(source_uri: str) -> Optional[Dict[str, Any]]:
    db = get_db()
    if db:
        result = db.table(DOCUMENTS_TABLE).select("*").eq("source_uri", source_uri).limit(1).execute()
        rows = result.data or []
        return rows[0] if rows else None
    for row in _mem_documents.values():
        if row.get("source_uri") == source_uri:
            return row
    return None


def create_document(
    source_system: str,
    source_uri: str,
    filename: str,
    file_type: str,
    file_size_bytes: int,
    status: str = "INGESTED",
    raw_metadata_json: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    existing = get_document_by_source_uri(source_uri)
    if existing:
        return existing

    row = {
        "id": str(uuid.uuid4()),
        "source_system": source_system,
        "source_uri": source_uri,
        "filename": filename,
        "file_type": file_type,
        "file_size_bytes": file_size_bytes,
        "status": status,
        "raw_metadata_json": raw_metadata_json or {},
        "created_at": _now_iso(),
        "updated_at": _now_iso(),
    }
    db = get_db()
    if db:
        result = db.table(DOCUMENTS_TABLE).insert(row).execute()
        rows = result.data or []
        return rows[0] if rows else row
    _mem_documents[row["id"]] = row
    return row

