from __future__ import annotations

import re
from datetime import datetime
from typing import Any, Dict, List, Optional


def _pick(regexes: List[str], text: str, flags: int = re.IGNORECASE) -> Optional[str]:
    for pattern in regexes:
        m = re.search(pattern, text, flags)
        if m:
            value = (m.group(1) or "").strip()
            if value:
                return value
    return None


def _parse_date(value: Optional[str]) -> Optional[str]:
    if not value:
        return None
    raw = value.strip()
    for fmt in ("%Y-%m-%d", "%d.%m.%Y", "%d/%m/%Y", "%d-%m-%Y"):
        try:
            return datetime.strptime(raw, fmt).date().isoformat()
        except ValueError:
            continue
    return None


def _parse_amount(value: Optional[str]) -> Optional[float]:
    if not value:
        return None
    normalized = value.strip().replace(" ", "")
    if "," in normalized and "." in normalized:
        # heuristik: letzter separator ist dezimal
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


def _detect_currency(text: str) -> str:
    upper = text.upper()
    if "USD" in upper or "$" in text:
        return "USD"
    if "CHF" in upper:
        return "CHF"
    if "GBP" in upper:
        return "GBP"
    return "EUR"


def _guess_supplier(text: str, filename: str) -> Optional[str]:
    lines = [ln.strip() for ln in text.splitlines() if ln.strip()]
    for ln in lines[:8]:
        if any(k in ln.lower() for k in ["rechnung", "invoice", "kundennr", "customer"]):
            continue
        if len(ln) >= 3:
            return ln[:180]
    stem = filename.rsplit(".", 1)[0].strip()
    return stem or None


def map_extracted_document(document: Dict[str, Any]) -> Dict[str, Any]:
    text = str(document.get("extracted_text") or "")
    filename = str(document.get("filename") or "")

    invoice_number = _pick(
        [
            r"(?:Rechnungsnummer|Rechnung\s*Nr\.?|Invoice\s*(?:No\.?|Number|Nr\.?))\s*[:#-]?\s*([A-Za-z0-9\-_/]+)",
        ],
        text,
    )
    invoice_date_raw = _pick([r"(?:Rechnungsdatum|Invoice\s*Date|Datum)\s*[:#-]?\s*([0-9]{1,4}[./-][0-9]{1,2}[./-][0-9]{1,4})"], text)
    due_date_raw = _pick([r"(?:Faelligkeit|Due\s*Date)\s*[:#-]?\s*([0-9]{1,4}[./-][0-9]{1,2}[./-][0-9]{1,4})"], text)
    gross_raw = _pick(
        [
            r"(?:Gesamtbetrag|Bruttobetrag|Total\s*Amount|Amount\s*Due)\s*[:#-]?\s*([0-9.,\s]+)",
            r"(?:EUR|USD|CHF|GBP)\s*([0-9.,\s]+)",
        ],
        text,
    )
    tax_raw = _pick([r"(?:MwSt|USt|VAT|Tax)\s*[:#-]?\s*([0-9.,\s]+)"], text)
    net_raw = _pick([r"(?:Nettobetrag|Net\s*Amount|Subtotal)\s*[:#-]?\s*([0-9.,\s]+)"], text)

    gross_amount = _parse_amount(gross_raw)
    net_amount = _parse_amount(net_raw)
    tax_amount = _parse_amount(tax_raw)
    if gross_amount is None and net_amount is not None and tax_amount is not None:
        gross_amount = round(net_amount + tax_amount, 2)

    confidence = 0.0
    for present in [invoice_number, invoice_date_raw, due_date_raw, gross_amount, _guess_supplier(text, filename)]:
        if present:
            confidence += 0.2

    return {
        "source_system": str(document.get("source_system") or "minio"),
        "supplier_name": _guess_supplier(text, filename),
        "invoice_number": invoice_number,
        "invoice_date": _parse_date(invoice_date_raw),
        "due_date": _parse_date(due_date_raw),
        "currency": _detect_currency(text),
        "gross_amount": gross_amount,
        "net_amount": net_amount,
        "tax_amount": tax_amount,
        "status": "MAPPED",
        "confidence_score": round(confidence, 2),
        "extraction_json": {
            "invoice_date_raw": invoice_date_raw,
            "due_date_raw": due_date_raw,
            "gross_amount_raw": gross_raw,
            "net_amount_raw": net_raw,
            "tax_amount_raw": tax_raw,
        },
    }
