from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Dict, List, Optional, Tuple

from minio import Minio


@dataclass
class MinioIngestionConfig:
    endpoint: str
    access_key: str
    secret_key: str
    bucket: str
    prefix: str = ""
    secure: bool = True


def _as_bool(value: Any, default: bool = True) -> bool:
    if isinstance(value, bool):
        return value
    if value is None:
        return default
    s = str(value).strip().lower()
    return s in {"1", "true", "yes", "on"}


def parse_minio_config(config_json: Dict[str, Any]) -> MinioIngestionConfig:
    endpoint = str(config_json.get("endpoint", "")).strip()
    access_key = str(config_json.get("access_key", "")).strip()
    secret_key = str(config_json.get("secret_key", "")).strip()
    bucket = str(config_json.get("bucket", "")).strip()
    prefix = str(config_json.get("prefix", "")).strip()
    secure = _as_bool(config_json.get("secure", True), default=True)

    missing = [k for k, v in {
        "endpoint": endpoint,
        "access_key": access_key,
        "secret_key": secret_key,
        "bucket": bucket,
    }.items() if not v]
    if missing:
        raise ValueError(f"Missing MinIO config keys: {', '.join(missing)}")

    return MinioIngestionConfig(
        endpoint=endpoint,
        access_key=access_key,
        secret_key=secret_key,
        bucket=bucket,
        prefix=prefix,
        secure=secure,
    )


def list_minio_objects(config: MinioIngestionConfig, max_objects: int = 500) -> List[Dict[str, Any]]:
    client = Minio(
        endpoint=config.endpoint,
        access_key=config.access_key,
        secret_key=config.secret_key,
        secure=config.secure,
    )
    objects = []
    for obj in client.list_objects(config.bucket, prefix=config.prefix, recursive=True):
        if obj.is_dir:
            continue
        objects.append(
            {
                "object_name": obj.object_name,
                "size": int(obj.size or 0),
                "etag": obj.etag,
                "last_modified": obj.last_modified.isoformat() if obj.last_modified else None,
            }
        )
        if len(objects) >= max_objects:
            break
    return objects


def classify_file_type(filename: str) -> str:
    lower = (filename or "").lower()
    if lower.endswith(".pdf"):
        return "pdf"
    if lower.endswith(".txt"):
        return "txt"
    if lower.endswith((".png", ".jpg", ".jpeg", ".webp")):
        return "image"
    return "binary"


def source_uri(bucket: str, object_name: str) -> str:
    return f"minio://{bucket}/{object_name}"

