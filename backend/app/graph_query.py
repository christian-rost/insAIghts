from __future__ import annotations

import json
import re
from typing import Any, Dict, List, Tuple

import httpx

from .graph import _json_safe, get_graph_driver
from .provider_storage import get_provider_key

MISTRAL_MODEL = "mistral-small-latest"
MAX_PROMPT_ROWS = 25

ALLOWED_SCHEMA: Dict[str, List[str]] = {
    "labels": [
        "Invoice",
        "Supplier",
        "Currency",
        "InvoiceStatus",
        "InvoiceDataField",
        "InvoiceLine",
        "InvoiceAction",
        "Recipient",
    ],
    "relationships": [
        "BELONGS_TO",
        "IN_CURRENCY",
        "HAS_STATUS",
        "HAS_DATA_FIELD",
        "HAS_LINE",
        "TARGETS",
        "FOR_RECIPIENT",
        "FROM_STATUS",
        "TO_STATUS",
    ],
}

DISALLOWED_QUERY_PATTERNS = [
    r"\bCREATE\b",
    r"\bMERGE\b",
    r"\bDELETE\b",
    r"\bDETACH\b",
    r"\bSET\b",
    r"\bREMOVE\b",
    r"\bDROP\b",
    r"\bCALL\b",
    r"\bLOAD\s+CSV\b",
    r"\bFOREACH\b",
    r"\bAPOC\b",
    r"\bDBMS\b",
    r"\bALTER\b",
]


def _strip_code_fences(raw: str) -> str:
    text = str(raw or "").strip()
    if text.startswith("```"):
        text = re.sub(r"^```[a-zA-Z0-9_-]*\n", "", text)
        text = re.sub(r"\n```$", "", text)
    return text.strip()


def _call_mistral_json(system_prompt: str, user_prompt: str, api_key: str) -> Tuple[bool, Dict[str, Any], str]:
    payload = {
        "model": MISTRAL_MODEL,
        "temperature": 0.1,
        "response_format": {"type": "json_object"},
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt},
        ],
    }
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
    }
    try:
        with httpx.Client(timeout=120.0) as client:
            response = client.post("https://api.mistral.ai/v1/chat/completions", headers=headers, json=payload)
        if response.status_code != 200:
            return False, {}, f"Mistral call failed: HTTP {response.status_code}"
        body = response.json()
        choices = body.get("choices") or []
        if not choices:
            return False, {}, "Mistral returned no choices"
        message = choices[0].get("message") or {}
        content = message.get("content")
        if isinstance(content, list):
            content = "".join(str(part.get("text") or "") for part in content if isinstance(part, dict))
        parsed = json.loads(str(content or "{}"))
        if not isinstance(parsed, dict):
            return False, {}, "Mistral returned non-object JSON"
        return True, parsed, ""
    except Exception as exc:
        return False, {}, str(exc)


def _validate_readonly_cypher(cypher: str, max_rows: int) -> Tuple[bool, str, str]:
    query = _strip_code_fences(cypher)
    if not query:
        return False, "", "Empty Cypher query"
    if ";" in query:
        return False, "", "Multiple statements are not allowed"
    if not re.search(r"\bRETURN\b", query, flags=re.IGNORECASE):
        return False, "", "Cypher query must contain RETURN"
    if not re.search(r"\bMATCH\b", query, flags=re.IGNORECASE):
        return False, "", "Cypher query must contain MATCH"

    for pattern in DISALLOWED_QUERY_PATTERNS:
        if re.search(pattern, query, flags=re.IGNORECASE):
            return False, "", f"Disallowed Cypher pattern: {pattern}"

    limit_matches = list(re.finditer(r"\bLIMIT\s+(\d+)\b", query, flags=re.IGNORECASE))
    if not limit_matches:
        query = f"{query}\nLIMIT {max_rows}"
    else:
        for match in limit_matches:
            n = int(match.group(1))
            if n > max_rows:
                query = re.sub(r"\bLIMIT\s+\d+\b", f"LIMIT {max_rows}", query, count=1, flags=re.IGNORECASE)
                break

    return True, query, ""


def _run_cypher_read_query(cypher: str, max_rows: int) -> Dict[str, Any]:
    driver = get_graph_driver()
    if not driver:
        return {
            "status": "unavailable",
            "reason": "graph credentials or uri not configured",
            "columns": [],
            "rows": [],
            "row_count": 0,
            "truncated": False,
        }

    try:
        with driver.session() as session:
            result = session.run(cypher)
            columns = list(result.keys())
            rows: List[Dict[str, Any]] = []
            truncated = False
            for idx, rec in enumerate(result):
                if idx >= max_rows:
                    truncated = True
                    break
                row: Dict[str, Any] = {}
                for key in rec.keys():
                    row[key] = _json_safe(rec.get(key))
                rows.append(row)
        return {
            "status": "ok",
            "columns": columns,
            "rows": rows,
            "row_count": len(rows),
            "truncated": truncated,
        }
    except Exception as exc:
        return {
            "status": "error",
            "reason": str(exc),
            "columns": [],
            "rows": [],
            "row_count": 0,
            "truncated": False,
        }


def _fallback_answer_text(question: str, row_count: int) -> str:
    if row_count <= 0:
        return f"Keine Treffer zur Frage '{question}' gefunden."
    if row_count == 1:
        return "Es wurde 1 passender Treffer gefunden."
    return f"Es wurden {row_count} Treffer gefunden."


def _summarize_result(question: str, cypher: str, rows: List[Dict[str, Any]], api_key: str) -> str:
    sample = rows[:MAX_PROMPT_ROWS]
    system_prompt = (
        "You are a finance graph analyst. "
        "Answer in concise German based only on provided query results."
    )
    user_prompt = (
        "Erzeuge eine kurze Antwort (max. 3 Saetze) auf die Benutzerfrage. "
        "Wenn keine Treffer vorhanden sind, sage das klar. "
        "Keine Halluzination, nur aus den Daten antworten. "
        "Gib JSON mit Schluessel 'answer_text' zurueck.\n\n"
        f"Frage: {question}\n"
        f"Cypher: {cypher}\n"
        f"Treffer (Sample): {json.dumps(sample, ensure_ascii=True)}"
    )
    ok, payload, reason = _call_mistral_json(system_prompt, user_prompt, api_key)
    if not ok:
        return _fallback_answer_text(question, len(rows))
    text = str(payload.get("answer_text") or "").strip()
    if not text:
        return _fallback_answer_text(question, len(rows))
    return text


def ask_graph_question(question: str, max_rows: int = 100) -> Dict[str, Any]:
    q = str(question or "").strip()
    if not q:
        return {
            "status": "error",
            "reason": "question is required",
            "question": q,
        }

    bounded_max_rows = max(1, min(int(max_rows or 100), 500))

    api_key = get_provider_key("mistral")
    if not api_key:
        return {
            "status": "provider_unavailable",
            "reason": "Mistral provider key is not configured/enabled",
            "question": q,
        }

    system_prompt = (
        "You translate natural-language finance questions into strict read-only Cypher for Neo4j. "
        "Return JSON only."
    )
    user_prompt = (
        "Erzeuge eine read-only Cypher-Abfrage fuer diese Frage.\n"
        "Wichtige Regeln:\n"
        "1) Nur lesend (MATCH/OPTIONAL MATCH/WITH/WHERE/RETURN/ORDER BY/SKIP/LIMIT).\n"
        "2) Kein CREATE/MERGE/DELETE/SET/CALL/APOC.\n"
        f"3) LIMIT <= {bounded_max_rows}.\n"
        "4) Nutze nur diese Labels/Relationen: "
        f"Labels={ALLOWED_SCHEMA['labels']}, Relationen={ALLOWED_SCHEMA['relationships']}.\n"
        "5) Gib JSON zurueck: {\"cypher\": string, \"explanation\": string}.\n\n"
        f"Frage: {q}"
    )

    ok, payload, reason = _call_mistral_json(system_prompt, user_prompt, api_key)
    if not ok:
        return {
            "status": "provider_error",
            "reason": reason,
            "question": q,
        }

    cypher_raw = str(payload.get("cypher") or "").strip()
    explanation = str(payload.get("explanation") or "").strip()

    valid, cypher, validation_reason = _validate_readonly_cypher(cypher_raw, max_rows=bounded_max_rows)
    if not valid:
        return {
            "status": "invalid_query",
            "reason": validation_reason,
            "question": q,
            "cypher": cypher_raw,
            "explanation": explanation,
        }

    query_result = _run_cypher_read_query(cypher, max_rows=bounded_max_rows)
    if query_result.get("status") != "ok":
        return {
            "status": query_result.get("status") or "error",
            "reason": query_result.get("reason") or "Query execution failed",
            "question": q,
            "cypher": cypher,
            "explanation": explanation,
            "columns": query_result.get("columns") or [],
            "rows": [],
            "row_count": 0,
            "truncated": False,
        }

    rows = query_result.get("rows") or []
    answer_text = _summarize_result(q, cypher, rows, api_key)

    return {
        "status": "ok",
        "provider": "mistral",
        "model": MISTRAL_MODEL,
        "question": q,
        "explanation": explanation,
        "cypher": cypher,
        "columns": query_result.get("columns") or [],
        "rows": rows,
        "row_count": int(query_result.get("row_count") or 0),
        "truncated": bool(query_result.get("truncated")),
        "answer_text": answer_text,
    }
