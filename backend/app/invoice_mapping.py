from __future__ import annotations

import json
import re
from datetime import datetime
from typing import Any, Dict, List, Optional

import httpx

from .provider_storage import get_provider_key


CORE_INVOICE_FIELDS = {
    "supplier_name",
    "invoice_number",
    "invoice_date",
    "due_date",
    "currency",
    "gross_amount",
    "net_amount",
    "tax_amount",
}


CORE_LINE_ITEM_FIELDS = {
    "line_no",
    "description",
    "quantity",
    "unit_price",
    "line_amount",
    "tax_rate",
}


TYPE_EXAMPLES = {
    "string": '"text"',
    "number": "123.45",
    "integer": "12",
    "date": '"YYYY-MM-DD"',
    "boolean": "true",
}


def _parse_date(value: Any) -> Optional[str]:
    raw = str(value or "").strip()
    if not raw:
        return None
    for fmt in ("%Y-%m-%d", "%d.%m.%Y", "%d/%m/%Y", "%d-%m-%Y"):
        try:
            return datetime.strptime(raw, fmt).date().isoformat()
        except ValueError:
            continue
    return None


def _parse_amount(value: Any) -> Optional[float]:
    if value in [None, ""]:
        return None
    if isinstance(value, (int, float)):
        return round(float(value), 2)

    normalized = str(value).strip().replace(" ", "")
    if "," in normalized and "." in normalized:
        if normalized.rfind(",") > normalized.rfind("."):
            normalized = normalized.replace(".", "").replace(",", ".")
        else:
            normalized = normalized.replace(",", "")
    elif "," in normalized:
        normalized = normalized.replace(".", "").replace(",", ".")

    try:
        return round(float(normalized), 2)
    except ValueError:
        return None


def _to_float(value: Any, digits: int = 3) -> Optional[float]:
    if value in [None, ""]:
        return None
    try:
        return round(float(value), digits)
    except Exception:
        return _parse_amount(value)


def _extract_json_from_text(content: str) -> Dict[str, Any]:
    raw = content.strip()
    if raw.startswith("```"):
        raw = re.sub(r"^```[a-zA-Z]*", "", raw).strip()
        raw = re.sub(r"```$", "", raw).strip()

    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        match = re.search(r"\{[\s\S]*\}", raw)
        if not match:
            raise ValueError("No JSON object returned by LLM")
        return json.loads(match.group(0))


def _build_field_instructions(fields: List[Dict[str, Any]]) -> str:
    rows: List[str] = []
    for field in fields:
        name = str(field.get("field_name") or "").strip()
        if not name:
            continue
        data_type = str(field.get("data_type") or "string").lower()
        required = "required" if field.get("is_required") else "optional"
        description = str(field.get("description") or "").strip()
        example = TYPE_EXAMPLES.get(data_type, '"text"')
        rows.append(f'- "{name}": {data_type} ({required}) - {description} | example: {example}')
    return "\n".join(rows)


def _llm_extract_invoice_fields(text: str, filename: str, extraction_fields: List[Dict[str, Any]]) -> Dict[str, Any]:
    api_key = get_provider_key("mistral")
    if not api_key:
        raise ValueError("Mistral API key is not configured/enabled in Admin settings")

    header_fields = [f for f in extraction_fields if f.get("scope") == "header" and f.get("is_enabled", True)]
    line_fields = [f for f in extraction_fields if f.get("scope") == "line_item" and f.get("is_enabled", True)]

    system_prompt = (
        "You extract invoice data from OCR text. "
        "Return ONLY valid JSON without markdown. "
        "If a field is unknown, return null."
    )

    header_instructions = _build_field_instructions(header_fields)
    line_instructions = _build_field_instructions(line_fields)

    user_prompt = (
        "Extract structured invoice data from this OCR text.\n\n"
        "Return JSON with this structure:\n"
        "{\n"
        "  \"header\": { ... },\n"
        "  \"line_items\": [ { ... } ],\n"
        "  \"confidence_score\": number|null\n"
        "}\n\n"
        "Header fields to extract:\n"
        f"{header_instructions or '- none'}\n\n"
        "Line-item fields to extract:\n"
        f"{line_instructions or '- none'}\n\n"
        "Rules:\n"
        "- confidence_score between 0 and 1.\n"
        "- line_items may be empty array when none can be identified.\n"
        "- do not include explanation text. only JSON.\n\n"
        f"Filename: {filename}\n\n"
        f"OCR text:\n{text[:120000]}"
    )

    payload = {
        "model": "mistral-small-latest",
        "temperature": 0,
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
    with httpx.Client(timeout=120.0) as client:
        response = client.post("https://api.mistral.ai/v1/chat/completions", headers=headers, json=payload)

    if response.status_code != 200:
        raise ValueError(f"Mistral extraction failed: HTTP {response.status_code} {response.text[:300]}")

    data = response.json()
    choices = data.get("choices") or []
    if not choices:
        raise ValueError("Mistral extraction returned no choices")

    message = choices[0].get("message") or {}
    content = message.get("content")
    if isinstance(content, list):
        content = "".join(str(part.get("text") or "") for part in content if isinstance(part, dict))
    if not isinstance(content, str) or not content.strip():
        raise ValueError("Mistral extraction content is empty")

    extracted = _extract_json_from_text(content)
    return extracted


def map_extracted_document(document: Dict[str, Any], extraction_fields: List[Dict[str, Any]]) -> Dict[str, Any]:
    text = str(document.get("extracted_text") or "")
    filename = str(document.get("filename") or "")

    extracted = _llm_extract_invoice_fields(text, filename, extraction_fields)
    header = extracted.get("header") if isinstance(extracted.get("header"), dict) else extracted
    if not isinstance(header, dict):
        header = {}

    raw_confidence = extracted.get("confidence_score")
    try:
        confidence_score = max(0.0, min(1.0, float(raw_confidence))) if raw_confidence is not None else 0.0
    except Exception:
        confidence_score = 0.0

    line_items: List[Dict[str, Any]] = []
    custom_line_items: List[Dict[str, Any]] = []
    for idx, item in enumerate(extracted.get("line_items") or [], start=1):
        if not isinstance(item, dict):
            continue
        custom_line_items.append({k: v for k, v in item.items() if k not in CORE_LINE_ITEM_FIELDS})
        line_items.append(
            {
                "line_no": int(item.get("line_no") or idx),
                "description": item.get("description"),
                "quantity": _to_float(item.get("quantity"), digits=3),
                "unit_price": _to_float(item.get("unit_price"), digits=4),
                "line_amount": _parse_amount(item.get("line_amount")),
                "tax_rate": _to_float(item.get("tax_rate"), digits=3),
            }
        )

    custom_header_fields = {k: v for k, v in header.items() if k not in CORE_INVOICE_FIELDS}

    return {
        "source_system": str(document.get("source_system") or "minio"),
        "supplier_name": header.get("supplier_name"),
        "invoice_number": header.get("invoice_number"),
        "invoice_date": _parse_date(header.get("invoice_date")),
        "due_date": _parse_date(header.get("due_date")),
        "currency": str(header.get("currency") or "EUR").upper(),
        "gross_amount": _parse_amount(header.get("gross_amount")),
        "net_amount": _parse_amount(header.get("net_amount")),
        "tax_amount": _parse_amount(header.get("tax_amount")),
        "status": "MAPPED",
        "confidence_score": round(confidence_score, 2),
        "line_items": line_items,
        "extraction_json": {
            "method": "mistral_llm",
            "model": "mistral-small-latest",
            "configured_fields": extraction_fields,
            "custom_header_fields": custom_header_fields,
            "custom_line_items": custom_line_items,
            "llm_output": extracted,
        },
    }
