from __future__ import annotations

import json
from typing import Any, Dict, List

import httpx

from .provider_storage import get_provider_key


def _safe_number(value: Any) -> float:
    try:
        return float(value)
    except Exception:
        return 0.0


def _compact_trend_rows(trend_rows: List[Dict[str, Any]], max_rows: int = 16) -> List[Dict[str, Any]]:
    rows = trend_rows or []
    if len(rows) <= max_rows:
        return rows
    # Keep tail of series for concise model context.
    return rows[-max_rows:]


def _build_fallback_analysis(payload: Dict[str, Any]) -> Dict[str, Any]:
    trend = payload.get("trend") or {}
    summary = trend.get("summary") or {}
    current = summary.get("current") or {}
    delta = summary.get("delta") or {}

    lines = []
    lines.append("Automatische Analyse (Fallback ohne LLM):")
    lines.append(
        f"- Rechnungen: {int(_safe_number(current.get('invoice_count')))} | "
        f"Betrag: {_safe_number(current.get('total_amount')):.2f}"
    )

    dr = delta.get("reject_rate", {})
    dh = delta.get("hold_rate", {})
    dc = delta.get("clarification_rate", {})
    lines.append(
        "- Delta Rates ggü. Vergleich: "
        f"Reject {dr.get('absolute', 0)}, Hold {dh.get('absolute', 0)}, Clarification {dc.get('absolute', 0)}"
    )

    recommendations = [
        {
            "kpi": "avg_gross_amount",
            "reason": "Hilft, Mengeneffekt und Preiseffekt zu trennen.",
            "formula": "sum(gross_amount) / invoice_count",
        },
        {
            "kpi": "supplier_concentration_top3",
            "reason": "Erkennt Abhaengigkeiten auf wenige Lieferanten.",
            "formula": "sum(amount top 3 suppliers) / total_amount",
        },
        {
            "kpi": "line_items_per_invoice",
            "reason": "Proxy fuer Rechnungs-Komplexitaet und Pruefaufwand.",
            "formula": "count(invoice_lines) / invoice_count",
        },
        {
            "kpi": "rework_rate",
            "reason": "Zeigt Prozessinstabilitaet (mehrfache Aktionen pro Rechnung).",
            "formula": "invoices with >=2 actions / invoice_count",
        },
    ]

    return {
        "status": "ok",
        "provider": "fallback",
        "model": None,
        "analysis_text": "\n".join(lines),
        "recommendations": recommendations,
    }


def explain_graph_insights(payload: Dict[str, Any]) -> Dict[str, Any]:
    api_key = get_provider_key("mistral")
    if not api_key:
        return {
            **_build_fallback_analysis(payload),
            "status": "provider_unavailable",
            "reason": "Mistral provider key is not configured/enabled",
        }

    trend = payload.get("trend") or {}
    insights = payload.get("insights") or {}

    system_prompt = (
        "You are a finance operations analytics expert. "
        "Analyze provided graph KPI data and produce concise German management guidance. "
        "Return strict JSON only."
    )

    compact_payload = {
        "config": trend.get("config"),
        "periods": trend.get("periods"),
        "summary": trend.get("summary"),
        "trends": _compact_trend_rows(trend.get("trends") or []),
        "supplier_risk": insights.get("supplier_risk") or [],
        "top_recipients": insights.get("top_recipients") or [],
        "top_products": insights.get("top_products") or [],
        "status_distribution": insights.get("status_distribution") or [],
        "anomaly_candidates": insights.get("anomaly_candidates") or [],
    }

    response_schema_hint = {
        "analysis_text": "Kurze Management-Zusammenfassung in Deutsch, 6-10 Saetze.",
        "highlights": [
            {"topic": "string", "signal": "up|down|stable|risk", "detail": "string"}
        ],
        "recommendations": [
            {
                "kpi": "string",
                "reason": "string",
                "formula": "string",
                "priority": "high|medium|low",
            }
        ],
    }

    user_prompt = (
        "Analysiere die KPI-Daten und gib Management-Insights aus.\n"
        "Aufgaben:\n"
        "1) Erklaere wichtigste Trends und Risiken.\n"
        "2) Nenne konkrete Ursachen-Hypothesen auf Basis der Daten.\n"
        "3) Schlage 4-8 zusaetzliche Trend-KPIs vor, die mit vorhandenen Daten berechenbar sind.\n"
        "4) Formuliere die Antwort auf Deutsch.\n"
        "5) Gib nur JSON mit den Schluesseln aus dem Schema aus.\n\n"
        f"Schema: {json.dumps(response_schema_hint, ensure_ascii=True)}\n\n"
        f"Daten: {json.dumps(compact_payload, ensure_ascii=True)}"
    )

    payload_req = {
        "model": "mistral-small-latest",
        "temperature": 0.2,
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
        response = client.post("https://api.mistral.ai/v1/chat/completions", headers=headers, json=payload_req)

    if response.status_code != 200:
        return {
            **_build_fallback_analysis(payload),
            "status": "provider_error",
            "reason": f"Mistral call failed: HTTP {response.status_code}",
        }

    data = response.json()
    choices = data.get("choices") or []
    if not choices:
        return {
            **_build_fallback_analysis(payload),
            "status": "provider_error",
            "reason": "Mistral returned no choices",
        }

    message = choices[0].get("message") or {}
    content = message.get("content")
    if isinstance(content, list):
        content = "".join(str(part.get("text") or "") for part in content if isinstance(part, dict))

    try:
        parsed = json.loads(str(content or "{}"))
    except Exception:
        return {
            **_build_fallback_analysis(payload),
            "status": "provider_error",
            "reason": "Mistral JSON parsing failed",
        }

    return {
        "status": "ok",
        "provider": "mistral",
        "model": "mistral-small-latest",
        "analysis_text": str(parsed.get("analysis_text") or "").strip(),
        "highlights": parsed.get("highlights") or [],
        "recommendations": parsed.get("recommendations") or [],
    }
