from __future__ import annotations

import json
import re
from datetime import datetime
from typing import Any, Dict, List, Optional

import httpx

from .provider_storage import get_provider_key


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


def _llm_extract_invoice_fields(text: str, filename: str) -> Dict[str, Any]:
    api_key = get_provider_key("mistral")
    if not api_key:
        raise ValueError("Mistral API key is not configured/enabled in Admin settings")

    system_prompt = (
        "You extract invoice data from OCR text. "
        "Return ONLY valid JSON without markdown. "
        "If a field is unknown, return null."
    )

    user_prompt = (
        "Extract structured invoice data from this OCR text.\n"
        "Output schema:\n"
        "{\n"
        "  \"supplier_name\": string|null,\n"
        "  \"invoice_number\": string|null,\n"
        "  \"invoice_date\": string|null,\n"
        "  \"due_date\": string|null,\n"
        "  \"currency\": string|null,\n"
        "  \"gross_amount\": number|null,\n"
        "  \"net_amount\": number|null,\n"
        "  \"tax_amount\": number|null,\n"
        "  \"confidence_score\": number|null,\n"
        "  \"line_items\": [\n"
        "    {\n"
        "      \"line_no\": number|null,\n"
        "      \"description\": string|null,\n"
        "      \"quantity\": number|null,\n"
        "      \"unit_price\": number|null,\n"
        "      \"line_amount\": number|null,\n"
        "      \"tax_rate\": number|null\n"
        "    }\n"
        "  ]\n"
        "}\n\n"
        "Rules:\n"
        "- Dates should stay in source format if unclear.\n"
        "- currency as ISO code if possible (EUR, USD, CHF, GBP).\n"
        "- confidence_score between 0 and 1.\n"
        "- line_items should include all recognizable invoice lines.\n\n"
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


def map_extracted_document(document: Dict[str, Any]) -> Dict[str, Any]:
    text = str(document.get("extracted_text") or "")
    filename = str(document.get("filename") or "")

    extracted = _llm_extract_invoice_fields(text, filename)
    raw_confidence = extracted.get("confidence_score")
    try:
        confidence_score = max(0.0, min(1.0, float(raw_confidence))) if raw_confidence is not None else 0.0
    except Exception:
        confidence_score = 0.0

    line_items: List[Dict[str, Any]] = []
    for idx, item in enumerate(extracted.get("line_items") or [], start=1):
        if not isinstance(item, dict):
            continue
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

    return {
        "source_system": str(document.get("source_system") or "minio"),
        "supplier_name": extracted.get("supplier_name"),
        "invoice_number": extracted.get("invoice_number"),
        "invoice_date": _parse_date(extracted.get("invoice_date")),
        "due_date": _parse_date(extracted.get("due_date")),
        "currency": str(extracted.get("currency") or "EUR").upper(),
        "gross_amount": _parse_amount(extracted.get("gross_amount")),
        "net_amount": _parse_amount(extracted.get("net_amount")),
        "tax_amount": _parse_amount(extracted.get("tax_amount")),
        "status": "MAPPED",
        "confidence_score": round(confidence_score, 2),
        "line_items": line_items,
        "extraction_json": {
            "method": "mistral_llm",
            "model": "mistral-small-latest",
            "llm_output": extracted,
        },
    }
