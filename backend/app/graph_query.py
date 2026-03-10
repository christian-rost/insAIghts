from __future__ import annotations

import json
import re
from datetime import date
from typing import Any, Dict, List, Tuple

import httpx

from .graph import _json_safe, get_graph_driver
from .provider_storage import get_provider_key

MISTRAL_MODEL = "mistral-small-latest"
MAX_PROMPT_ROWS = 25
CURRENCY_SYNONYMS: Dict[str, List[str]] = {
    "EUR": ["eur", "euro", "euros", "€"],
    "USD": ["usd", "us-dollar", "us dollar", "dollar", "$"],
    "GBP": ["gbp", "pfund", "pound", "sterling", "£"],
    "CHF": ["chf", "franken", "franc", "sfr"],
}
QUESTION_STOPWORDS = {
    "welche",
    "welcher",
    "welches",
    "sind",
    "ist",
    "fuer",
    "für",
    "mit",
    "von",
    "der",
    "die",
    "das",
    "den",
    "dem",
    "des",
    "und",
    "oder",
    "rechnungen",
    "rechnung",
    "zeige",
    "gib",
    "alle",
}
MONTH_NAMES = {
    "januar": 1,
    "jan": 1,
    "january": 1,
    "februar": 2,
    "feb": 2,
    "february": 2,
    "maerz": 3,
    "märz": 3,
    "mrz": 3,
    "march": 3,
    "april": 4,
    "apr": 4,
    "mai": 5,
    "may": 5,
    "juni": 6,
    "jun": 6,
    "june": 6,
    "juli": 7,
    "jul": 7,
    "july": 7,
    "august": 8,
    "aug": 8,
    "september": 9,
    "sep": 9,
    "sept": 9,
    "oktober": 10,
    "okt": 10,
    "october": 10,
    "oct": 10,
    "november": 11,
    "nov": 11,
    "dezember": 12,
    "dez": 12,
    "december": 12,
    "dec": 12,
}

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

LABEL_PROPERTY_HINTS: Dict[str, List[str]] = {
    "Invoice": ["id", "invoice_number", "invoice_date", "status", "currency", "gross_amount"],
    "Supplier": ["name"],
    "Currency": ["code"],
    "InvoiceStatus": ["name"],
    "InvoiceDataField": ["field_name", "value"],
    "InvoiceLine": ["id", "line_no", "description", "quantity", "line_amount"],
    "InvoiceAction": ["id", "action_type", "from_status", "to_status"],
    "Recipient": ["name"],
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


def _normalize_known_property_mismatches(cypher: str) -> str:
    query = str(cypher or "")
    # Our graph model stores Currency as :Currency {code: "..."}.
    # If LLM emits {name: "..."} for Currency, rewrite to {code: "..."}.
    query = re.sub(
        r"(:Currency\s*\{\s*)name(\s*:\s*)",
        r"\1code\2",
        query,
        flags=re.IGNORECASE,
    )
    return query


def _normalize_question_text(question: str) -> str:
    q = str(question or "")
    q = q.replace("€", " euro ").replace("$", " dollar ").replace("£", " pound ")
    return re.sub(r"\s+", " ", q).strip()


def _extract_currency_hints(question: str) -> List[str]:
    q = _normalize_question_text(question).lower()
    out: List[str] = []
    for code, synonyms in CURRENCY_SYNONYMS.items():
        for token in [code.lower(), *synonyms]:
            token_l = token.lower()
            if token_l in q:
                out.append(code)
                break
    # stable dedupe
    return list(dict.fromkeys(out))


def _extract_question_tokens(question: str, max_tokens: int = 6) -> List[str]:
    q = _normalize_question_text(question).lower()
    q = re.sub(r"[^a-z0-9äöüß_\\-\\s]", " ", q)
    parts = [p.strip() for p in q.split() if p.strip()]
    tokens: List[str] = []
    for p in parts:
        if p in QUESTION_STOPWORDS:
            continue
        if len(p) < 3:
            continue
        tokens.append(p)
    deduped = list(dict.fromkeys(tokens))
    return deduped[:max_tokens]


def _month_range(year: int, month: int) -> Tuple[str, str]:
    start = date(year, month, 1)
    end = date(year + 1, 1, 1) if month == 12 else date(year, month + 1, 1)
    return start.isoformat(), end.isoformat()


def _year_range(year: int) -> Tuple[str, str]:
    return date(year, 1, 1).isoformat(), date(year + 1, 1, 1).isoformat()


def _extract_hard_constraints(question: str) -> Dict[str, Any]:
    q = _normalize_question_text(question).lower()
    constraints: Dict[str, Any] = {
        "currency_codes": _extract_currency_hints(question),
        "date_from": None,
        "date_to": None,
    }

    month = None
    for name, num in MONTH_NAMES.items():
        if re.search(rf"\b{re.escape(name)}\b", q):
            month = num
            break

    year_match = re.search(r"\b(20\d{2})\b", q)
    year = int(year_match.group(1)) if year_match else None

    if month and year:
        constraints["date_from"], constraints["date_to"] = _month_range(year, month)
    elif year:
        constraints["date_from"], constraints["date_to"] = _year_range(year)
    return constraints


def _row_matches_constraints(row: Dict[str, Any], constraints: Dict[str, Any]) -> bool:
    currency_codes = set(constraints.get("currency_codes") or [])
    date_from = str(constraints.get("date_from") or "").strip()
    date_to = str(constraints.get("date_to") or "").strip()

    if currency_codes:
        currency = str(row.get("currency") or "").strip().upper()
        if not currency or currency not in currency_codes:
            return False

    if date_from and date_to:
        inv_date = str(row.get("invoice_date") or "").strip()
        if not inv_date:
            return False
        if not (date_from <= inv_date < date_to):
            return False

    return True


def _apply_constraints_to_result(result: Dict[str, Any], constraints: Dict[str, Any]) -> Dict[str, Any]:
    if result.get("status") != "ok":
        return result
    if not (constraints.get("currency_codes") or constraints.get("date_from") or constraints.get("date_to")):
        return result
    rows = result.get("rows") or []
    filtered = [r for r in rows if isinstance(r, dict) and _row_matches_constraints(r, constraints)]
    return {
        **result,
        "rows": filtered,
        "row_count": len(filtered),
    }


def _run_semantic_contains_fallback(question: str, max_rows: int, constraints: Dict[str, Any]) -> Dict[str, Any]:
    tokens = _extract_question_tokens(question)
    if not tokens:
        return {
            "status": "ok",
            "columns": [],
            "rows": [],
            "row_count": 0,
            "truncated": False,
            "query": "",
        }

    cypher = """
    MATCH (i:Invoice)
    OPTIONAL MATCH (i)-[:BELONGS_TO]->(sup:Supplier)
    OPTIONAL MATCH (i)-[:IN_CURRENCY]->(cur:Currency)
    OPTIONAL MATCH (i)-[:HAS_STATUS]->(st:InvoiceStatus)
    OPTIONAL MATCH (i)-[:HAS_DATA_FIELD]->(df:InvoiceDataField)
    WITH i, sup, cur, st, collect(distinct df) AS dfs, $tokens AS tokens
    WITH i, sup, cur, st, dfs, tokens,
         CASE WHEN i.invoice_date IS NULL THEN NULL ELSE toString(date(i.invoice_date)) END AS inv_date,
         reduce(score = 0,
                t IN tokens |
                 score
                  + CASE WHEN toLower(toString(coalesce(i.invoice_number, ''))) CONTAINS t THEN 3 ELSE 0 END
                  + CASE WHEN toLower(toString(coalesce(i.supplier_name, ''))) CONTAINS t THEN 3 ELSE 0 END
                  + CASE WHEN toLower(toString(coalesce(sup.name, ''))) CONTAINS t THEN 3 ELSE 0 END
                  + CASE WHEN toLower(toString(coalesce(i.currency, ''))) CONTAINS t THEN 2 ELSE 0 END
                  + CASE WHEN toLower(toString(coalesce(cur.code, ''))) CONTAINS t THEN 2 ELSE 0 END
                  + CASE WHEN toLower(toString(coalesce(st.name, ''))) CONTAINS t THEN 1 ELSE 0 END
                  + reduce(dfScore = 0,
                           d IN dfs |
                             dfScore
                             + CASE WHEN toLower(toString(coalesce(d.value, ''))) CONTAINS t THEN 4 ELSE 0 END
                             + CASE WHEN toLower(toString(coalesce(d.field_name, ''))) CONTAINS t THEN 1 ELSE 0 END
                    )
         ) AS relevance,
         $currency_codes AS currency_codes,
         $date_from AS date_from,
         $date_to AS date_to
    WHERE relevance > 0
      AND (size(currency_codes) = 0 OR toUpper(toString(coalesce(cur.code, i.currency, ''))) IN currency_codes)
      AND (
        date_from IS NULL OR date_to IS NULL
        OR (
          inv_date IS NOT NULL
          AND inv_date >= date_from
          AND inv_date < date_to
        )
      )
    RETURN
      i.id AS invoice_id,
      i.invoice_number AS invoice_number,
      inv_date AS invoice_date,
      coalesce(sup.name, i.supplier_name) AS supplier_name,
      coalesce(cur.code, i.currency) AS currency,
      i.status AS status,
      i.gross_amount AS gross_amount,
      relevance
    ORDER BY relevance DESC, inv_date DESC
    LIMIT $max_rows
    """
    result = _run_cypher_read_query(
        cypher,
        max_rows=max_rows,
        params={
            "tokens": tokens,
            "max_rows": max_rows,
            "currency_codes": constraints.get("currency_codes") or [],
            "date_from": constraints.get("date_from"),
            "date_to": constraints.get("date_to"),
        },
    )
    result["query"] = cypher.strip()
    result["tokens"] = tokens
    return result


def _rewrite_query_flexible(
    *,
    question: str,
    original_cypher: str,
    explanation: str,
    max_rows: int,
    api_key: str,
) -> Tuple[bool, str, str]:
    currency_hints = _extract_currency_hints(question)
    system_prompt = (
        "You are a Neo4j Cypher expert. "
        "Rewrite a read-only query to improve recall when value spellings/synonyms differ. "
        "Return JSON only."
    )
    user_prompt = (
        "Die bisherige Query lieferte 0 Treffer. Schreibe eine robustere, aber weiterhin read-only Query.\n"
        "Regeln:\n"
        "1) Nur MATCH/OPTIONAL MATCH/WITH/WHERE/RETURN/ORDER BY/SKIP/LIMIT.\n"
        "2) Keine Schreiboperationen.\n"
        f"3) LIMIT <= {max_rows}.\n"
        "4) Nutze case-insensitive Vergleiche fuer String-Werte (toLower(...)).\n"
        "5) Fuer Freitext-Attribute nutze bevorzugt exact-insensitive oder contains-insensitive.\n"
        "6) Fuer Currency nutze Property c.code und canonical ISO-Code (z. B. EUR statt Euro).\n"
        "7) Erhalte die fachliche Intention der Frage.\n"
        "8) JSON-Format: {\"cypher\": string, \"explanation\": string}.\n\n"
        f"Frage: {question}\n"
        f"Vorherige Query: {original_cypher}\n"
        f"Vorherige Erklaerung: {explanation}\n"
        f"Waehrungshinweise: {currency_hints}\n"
        f"Erlaubte Labels: {ALLOWED_SCHEMA['labels']}\n"
        f"Erlaubte Relationen: {ALLOWED_SCHEMA['relationships']}\n"
        f"Label-Property-Hints: {LABEL_PROPERTY_HINTS}"
    )
    ok, payload, reason = _call_mistral_json(system_prompt, user_prompt, api_key)
    if not ok:
        return False, "", reason
    cypher = _normalize_known_property_mismatches(str(payload.get("cypher") or "").strip())
    valid, safe_cypher, validation_reason = _validate_readonly_cypher(cypher, max_rows=max_rows)
    if not valid:
        return False, "", validation_reason
    return True, safe_cypher, str(payload.get("explanation") or "").strip()


def _run_cypher_read_query(cypher: str, max_rows: int, params: Dict[str, Any] | None = None) -> Dict[str, Any]:
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
            result = session.run(cypher, **(params or {}))
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


def _deterministic_answer_text(question: str, rows: List[Dict[str, Any]]) -> str:
    row_count = len(rows or [])
    if row_count <= 0:
        return f"Keine Treffer zur Frage '{question}' gefunden."
    sample_numbers: List[str] = []
    for row in rows[:5]:
        inv = str(row.get("invoice_number") or "").strip()
        if inv:
            sample_numbers.append(inv)
    if sample_numbers:
        return f"Gefunden: {row_count} Rechnungen (z. B. {', '.join(sample_numbers)})."
    return f"Gefunden: {row_count} Rechnungen."


def _enforce_answer_consistency(question: str, rows: List[Dict[str, Any]], answer_text: str) -> str:
    text = str(answer_text or "").strip()
    row_count = len(rows or [])
    if not text:
        return _deterministic_answer_text(question, rows)
    lower = text.lower()
    says_none = any(token in lower for token in ["keine", "nicht gefunden", "no results", "no match"])
    if row_count > 0 and says_none:
        return _deterministic_answer_text(question, rows)
    if row_count == 0 and not says_none:
        return _deterministic_answer_text(question, rows)
    return text


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
    q = _normalize_question_text(question)
    if not q:
        return {
            "status": "error",
            "reason": "question is required",
            "question": q,
        }

    bounded_max_rows = max(1, min(int(max_rows or 100), 500))
    constraints = _extract_hard_constraints(q)

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
        f"5) Nutze passende Properties je Label: {LABEL_PROPERTY_HINTS}.\n"
        "6) Wichtig: Bei :Currency immer Property 'code' (nicht 'name') und bei Waehrungswoertern wie Euro/€ canonical ISO-Code verwenden (EUR).\n"
        "7) Interpretiere Werte flexibel (Synonyme, Gross/Kleinschreibung, kleine Schreibvarianten).\n"
        "8) Gib JSON zurueck: {\"cypher\": string, \"explanation\": string}.\n\n"
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
    cypher_raw = _normalize_known_property_mismatches(cypher_raw)
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
    query_result = _apply_constraints_to_result(query_result, constraints)
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
    final_cypher = cypher
    final_explanation = explanation
    match_mode = "exact"

    fallback_attempted = False
    fallback_reason = ""

    if len(rows) == 0:
        fallback_attempted = True
        ok_flex, flex_cypher, flex_reason = _rewrite_query_flexible(
            question=q,
            original_cypher=cypher,
            explanation=explanation,
            max_rows=bounded_max_rows,
            api_key=api_key,
        )
        if ok_flex and flex_cypher != cypher:
            flex_result = _run_cypher_read_query(flex_cypher, max_rows=bounded_max_rows)
            flex_result = _apply_constraints_to_result(flex_result, constraints)
            if flex_result.get("status") == "ok" and int(flex_result.get("row_count") or 0) > 0:
                query_result = flex_result
                rows = query_result.get("rows") or []
                final_cypher = flex_cypher
                match_mode = "flexible"
                if flex_reason:
                    final_explanation = f"{explanation} | Flexible fallback: {flex_reason}".strip(" |")
            else:
                fallback_reason = str(flex_result.get("reason") or "")
        elif not ok_flex:
            fallback_reason = str(flex_reason or "")

    if len(rows) == 0:
        fallback_attempted = True
        semantic_result = _run_semantic_contains_fallback(q, max_rows=bounded_max_rows, constraints=constraints)
        if semantic_result.get("status") == "ok" and int(semantic_result.get("row_count") or 0) > 0:
            query_result = semantic_result
            rows = query_result.get("rows") or []
            final_cypher = str(semantic_result.get("query") or final_cypher)
            match_mode = "semantic_contains"
            final_explanation = f"{final_explanation} | Semantic fallback: contains search over invoice core fields and InvoiceDataField values.".strip(" |")
        elif semantic_result.get("status") != "ok":
            fallback_reason = str(semantic_result.get("reason") or fallback_reason)

    if len(rows) == 0 and fallback_attempted:
        match_mode = "fallback_no_match"
        if fallback_reason:
            final_explanation = f"{final_explanation} | Fallback reason: {fallback_reason}".strip(" |")

    answer_text = _summarize_result(q, final_cypher, rows, api_key)
    answer_text = _enforce_answer_consistency(q, rows, answer_text)

    return {
        "status": "ok",
        "provider": "mistral",
        "model": MISTRAL_MODEL,
        "question": q,
        "explanation": final_explanation,
        "cypher": final_cypher,
        "cypher_primary": cypher,
        "match_mode": match_mode,
        "columns": query_result.get("columns") or [],
        "rows": rows,
        "row_count": int(query_result.get("row_count") or 0),
        "truncated": bool(query_result.get("truncated")),
        "answer_text": answer_text,
    }
