from __future__ import annotations

import base64
from typing import Any, Dict, Tuple

import httpx
from minio import Minio

from .minio_ingestion import MinioIngestionConfig
from .provider_storage import get_provider_key


def parse_minio_source_uri(source_uri: str) -> Tuple[str, str]:
    # expected: minio://bucket/path/to/object.pdf
    if not source_uri.startswith("minio://"):
        raise ValueError("Unsupported source uri")
    raw = source_uri[len("minio://"):]
    if "/" not in raw:
        raise ValueError("Invalid source uri format")
    bucket, object_name = raw.split("/", 1)
    return bucket, object_name


def download_minio_object(config: MinioIngestionConfig, source_uri: str) -> bytes:
    bucket_from_uri, object_name = parse_minio_source_uri(source_uri)
    bucket = config.bucket or bucket_from_uri
    client = Minio(
        endpoint=config.endpoint,
        access_key=config.access_key,
        secret_key=config.secret_key,
        secure=config.secure,
    )
    response = client.get_object(bucket, object_name)
    try:
        return response.read()
    finally:
        response.close()
        response.release_conn()


def _mistral_extract(file_type: str, file_bytes: bytes) -> str:
    api_key = get_provider_key("mistral")
    if not api_key:
        raise ValueError("Mistral API key is not configured/enabled in Admin settings")

    if file_type == "pdf":
        b64 = base64.b64encode(file_bytes).decode("ascii")
        payload = {
            "model": "mistral-ocr-latest",
            "document": {"type": "document_url", "document_url": f"data:application/pdf;base64,{b64}"},
        }
    elif file_type == "image":
        b64 = base64.b64encode(file_bytes).decode("ascii")
        payload = {
            "model": "mistral-ocr-latest",
            "document": {"type": "image_url", "image_url": f"data:image/png;base64,{b64}"},
        }
    else:
        # fallback: plain decode for txt/binary where possible
        return file_bytes.decode("utf-8", errors="replace")

    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
    }
    with httpx.Client(timeout=120.0) as client:
        response = client.post("https://api.mistral.ai/v1/ocr", headers=headers, json=payload)
    if response.status_code != 200:
        raise ValueError(f"Mistral OCR failed: HTTP {response.status_code} {response.text[:240]}")
    data = response.json()
    pages = data.get("pages", []) or []
    markdown_parts = []
    for page in pages:
        md = str(page.get("markdown") or page.get("content") or page.get("text") or "").strip()
        if md:
            markdown_parts.append(md)
    if markdown_parts:
        return "\n\n".join(markdown_parts).strip()
    fallback = str(data.get("markdown") or data.get("text") or "").strip()
    return fallback


def extract_text_for_document(file_type: str, file_bytes: bytes) -> str:
    if file_type == "txt":
        return file_bytes.decode("utf-8", errors="replace")
    return _mistral_extract(file_type, file_bytes)
