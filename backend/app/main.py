import logging
from typing import Dict, List, Optional

from fastapi import Depends, FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, EmailStr, Field

from .auth import authenticate_user, create_access_token, get_current_user, require_admin
from .audit_storage import log_admin_event
from .config import ADMIN_PASSWORD, ADMIN_USERNAME, CORS_ORIGINS
from .config_storage import get_connector, list_connectors, update_connector
from .document_processing import download_minio_object, extract_text_for_document
from .document_storage import (
    create_document,
    get_document_by_source_uri,
    list_documents,
    list_documents_by_status,
    update_document,
)
from .graph import graph_healthcheck
from .invoice_mapping import map_extracted_document
from .invoice_storage import (
    create_invoice,
    create_invoice_lines,
    get_invoice_by_document,
    list_invoices,
    list_invoices_by_status,
    update_invoice,
)
from .invoice_validation import load_validation_context, validate_invoice
from .minio_ingestion import classify_file_type, list_minio_objects, parse_minio_config, source_uri
from .provider_storage import get_provider, list_providers, update_provider
from .user_storage import bootstrap_admin, create_user, list_users, update_user

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
logger = logging.getLogger(__name__)

app = FastAPI(title="insAIghts API", version="0.1.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type"],
)


class LoginRequest(BaseModel):
    username: str
    password: str


class RegisterRequest(BaseModel):
    username: str = Field(min_length=3, max_length=64)
    email: EmailStr
    password: str = Field(min_length=8)


class LoginResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"


class UserResponse(BaseModel):
    id: str
    username: str
    email: str
    roles: List[str]
    is_active: bool


class CreateUserRequest(BaseModel):
    username: str = Field(min_length=3, max_length=64)
    email: EmailStr
    password: str = Field(min_length=8)
    roles: List[str] = Field(default_factory=lambda: ["AP_CLERK"])


class UpdateUserRequest(BaseModel):
    email: Optional[EmailStr] = None
    is_active: Optional[bool] = None
    roles: Optional[List[str]] = None


class ConnectorConfigResponse(BaseModel):
    id: Optional[str] = None
    connector_name: str
    enabled: bool = False
    schedule_cron: Optional[str] = None
    poll_interval_seconds: Optional[int] = None
    retry_max_attempts: Optional[int] = None
    retry_backoff_seconds: Optional[int] = None
    timeout_seconds: Optional[int] = None
    config_json: Dict = Field(default_factory=dict)
    updated_by: Optional[str] = None
    updated_at: Optional[str] = None


class ConnectorUpdateRequest(BaseModel):
    enabled: Optional[bool] = None
    schedule_cron: Optional[str] = None
    poll_interval_seconds: Optional[int] = Field(default=None, ge=5)
    retry_max_attempts: Optional[int] = Field(default=None, ge=0)
    retry_backoff_seconds: Optional[int] = Field(default=None, ge=0)
    timeout_seconds: Optional[int] = Field(default=None, ge=1)
    config_json: Optional[Dict] = None


class MinioPullRequest(BaseModel):
    max_objects: int = Field(default=200, ge=1, le=5000)


class ExtractDocumentsRequest(BaseModel):
    max_documents: int = Field(default=20, ge=1, le=500)


class MapInvoicesRequest(BaseModel):
    max_documents: int = Field(default=20, ge=1, le=500)


class ValidateInvoicesRequest(BaseModel):
    max_invoices: int = Field(default=50, ge=1, le=500)


class ProviderConfigResponse(BaseModel):
    id: Optional[str] = None
    provider_name: str
    is_enabled: bool = False
    key_present: bool = False
    updated_by: Optional[str] = None
    updated_at: Optional[str] = None


class ProviderUpdateRequest(BaseModel):
    is_enabled: Optional[bool] = None
    key_value: Optional[str] = None


@app.on_event("startup")
async def startup_bootstrap() -> None:
    try:
        user = bootstrap_admin(ADMIN_USERNAME, ADMIN_PASSWORD)
        if user:
            logger.info("Bootstrap admin available: %s", user["username"])
            log_admin_event(
                event_type="system.bootstrap_admin",
                actor_user_id=user["id"],
                target_type="user",
                target_id=user["id"],
                metadata_json={"username": user["username"]},
            )
        else:
            logger.warning("Bootstrap admin skipped: ADMIN_USERNAME/ADMIN_PASSWORD not configured")
    except Exception as exc:
        logger.exception("Bootstrap admin failed: %s", exc)


@app.get("/")
async def root() -> Dict[str, str]:
    return {"status": "ok", "service": "insAIghts-backend"}


@app.get("/api/health")
async def health() -> Dict[str, str]:
    return {"status": "healthy"}


@app.get("/api/health/graph")
async def health_graph() -> Dict:
    return graph_healthcheck()


@app.post("/api/auth/login", response_model=LoginResponse)
async def login(payload: LoginRequest) -> LoginResponse:
    user = authenticate_user(payload.username, payload.password)
    if not user:
        log_admin_event(
            event_type="auth.login_failed",
            metadata_json={"username": payload.username},
        )
        raise HTTPException(status_code=401, detail="Invalid credentials")
    token = create_access_token(user["id"])
    log_admin_event(
        event_type="auth.login",
        actor_user_id=user["id"],
        target_type="user",
        target_id=user["id"],
        metadata_json={"username": user["username"]},
    )
    return LoginResponse(access_token=token)


@app.post("/api/auth/register", response_model=UserResponse)
async def register(payload: RegisterRequest) -> UserResponse:
    try:
        user = create_user(
            username=payload.username,
            email=payload.email,
            password=payload.password,
            roles=["AP_CLERK"],
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    log_admin_event(
        event_type="auth.register",
        target_type="user",
        target_id=user["id"],
        metadata_json={"username": user["username"]},
    )
    return UserResponse(**user)


@app.get("/api/auth/me", response_model=UserResponse)
async def auth_me(current_user: Dict = Depends(get_current_user)) -> UserResponse:
    return UserResponse(**current_user)


@app.post("/api/auth/logout")
async def auth_logout(current_user: Dict = Depends(get_current_user)) -> Dict[str, str]:
    # JWT is stateless in current MVP. Logout is client-side token discard,
    # but we still expose this endpoint for explicit session-close semantics + audit.
    log_admin_event(
        event_type="auth.logout",
        actor_user_id=current_user["id"],
        target_type="user",
        target_id=current_user["id"],
        metadata_json={"username": current_user["username"]},
    )
    return {"status": "ok", "detail": "logged out"}


@app.get("/api/admin/users", response_model=List[UserResponse])
async def admin_list_users(_: Dict = Depends(require_admin)) -> List[UserResponse]:
    return [UserResponse(**u) for u in list_users()]


@app.post("/api/admin/users", response_model=UserResponse)
async def admin_create_user(payload: CreateUserRequest, admin_user: Dict = Depends(require_admin)) -> UserResponse:
    user = create_user(payload.username, payload.email, payload.password, payload.roles)
    log_admin_event(
        event_type="admin.user_created",
        actor_user_id=admin_user["id"],
        target_type="user",
        target_id=user["id"],
        metadata_json={"username": user["username"], "roles": user["roles"]},
        diff_after={"user": user},
    )
    return UserResponse(**user)


@app.patch("/api/admin/users/{user_id}", response_model=UserResponse)
async def admin_update_user(
    user_id: str,
    payload: UpdateUserRequest,
    admin_user: Dict = Depends(require_admin),
) -> UserResponse:
    before = next((u for u in list_users() if u["id"] == user_id), None)
    updates = payload.model_dump(exclude_none=True)
    user = update_user(user_id, updates)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    log_admin_event(
        event_type="admin.user_updated",
        actor_user_id=admin_user["id"],
        target_type="user",
        target_id=user_id,
        metadata_json={"fields": list(updates.keys())},
        diff_before={"user": before} if before else None,
        diff_after={"user": user},
    )
    return UserResponse(**user)


@app.get("/api/admin/config/connectors", response_model=List[ConnectorConfigResponse])
async def admin_list_connectors(_: Dict = Depends(require_admin)) -> List[ConnectorConfigResponse]:
    return [ConnectorConfigResponse(**row) for row in list_connectors()]


@app.get("/api/admin/config/providers", response_model=List[ProviderConfigResponse])
async def admin_list_providers(_: Dict = Depends(require_admin)) -> List[ProviderConfigResponse]:
    return [ProviderConfigResponse(**row) for row in list_providers()]


@app.put("/api/admin/config/providers/{provider_name}", response_model=ProviderConfigResponse)
async def admin_update_provider(
    provider_name: str,
    payload: ProviderUpdateRequest,
    admin_user: Dict = Depends(require_admin),
) -> ProviderConfigResponse:
    before = get_provider(provider_name)
    if not before:
        raise HTTPException(status_code=404, detail="Provider not found")
    after = update_provider(
        provider_name,
        is_enabled=payload.is_enabled,
        key_value=payload.key_value,
        actor_user_id=admin_user["id"],
    )
    if not after:
        raise HTTPException(status_code=404, detail="Provider not found")
    log_admin_event(
        event_type="admin.provider_updated",
        actor_user_id=admin_user["id"],
        target_type="provider",
        target_id=provider_name,
        metadata_json={
            "is_enabled": payload.is_enabled,
            "key_updated": payload.key_value is not None,
        },
        diff_before={"provider": {"provider_name": before.get("provider_name"), "is_enabled": before.get("is_enabled")}},
        diff_after={"provider": {"provider_name": after.get("provider_name"), "is_enabled": after.get("is_enabled"), "key_present": bool(after.get("key_value"))}},
    )
    return ProviderConfigResponse(
        id=after.get("id"),
        provider_name=after.get("provider_name"),
        is_enabled=bool(after.get("is_enabled", False)),
        key_present=bool(after.get("key_value")),
        updated_by=after.get("updated_by"),
        updated_at=after.get("updated_at"),
    )


@app.put("/api/admin/config/connectors/{connector_name}", response_model=ConnectorConfigResponse)
async def admin_update_connector(
    connector_name: str,
    payload: ConnectorUpdateRequest,
    admin_user: Dict = Depends(require_admin),
) -> ConnectorConfigResponse:
    before = get_connector(connector_name)
    if not before:
        raise HTTPException(status_code=404, detail="Connector not found")
    updates = payload.model_dump(exclude_none=True)
    after = update_connector(connector_name, updates, actor_user_id=admin_user["id"])
    if not after:
        raise HTTPException(status_code=404, detail="Connector not found")
    log_admin_event(
        event_type="admin.connector_updated",
        actor_user_id=admin_user["id"],
        target_type="connector",
        target_id=connector_name,
        metadata_json={"fields": list(updates.keys())},
        diff_before={"connector": before},
        diff_after={"connector": after},
    )
    return ConnectorConfigResponse(**after)


@app.post("/api/admin/config/connectors/{connector_name}/test")
async def admin_test_connector(
    connector_name: str,
    admin_user: Dict = Depends(require_admin),
) -> Dict[str, str]:
    connector = get_connector(connector_name)
    if not connector:
        raise HTTPException(status_code=404, detail="Connector not found")
    log_admin_event(
        event_type="admin.connector_test",
        actor_user_id=admin_user["id"],
        target_type="connector",
        target_id=connector_name,
        metadata_json={"result": "ok-simulated"},
    )
    return {"status": "ok", "connector": connector_name, "mode": "simulated"}


@app.post("/api/ingestion/minio/pull")
async def ingestion_minio_pull(
    payload: MinioPullRequest,
    admin_user: Dict = Depends(require_admin),
) -> Dict:
    connector = get_connector("minio")
    if not connector:
        raise HTTPException(status_code=404, detail="MinIO connector config not found")
    if not connector.get("enabled", False):
        raise HTTPException(status_code=400, detail="MinIO connector is disabled")

    try:
        cfg = parse_minio_config(connector.get("config_json") or {})
        objects = list_minio_objects(cfg, max_objects=payload.max_objects)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"MinIO read failed: {exc}")

    created = 0
    skipped = 0
    sample_documents = []
    for obj in objects:
        uri = source_uri(cfg.bucket, obj["object_name"])
        if get_document_by_source_uri(uri):
            skipped += 1
            continue
        doc = create_document(
            source_system="minio",
            source_uri=uri,
            filename=obj["object_name"].split("/")[-1],
            file_type=classify_file_type(obj["object_name"]),
            file_size_bytes=int(obj.get("size") or 0),
            status="INGESTED",
            raw_metadata_json=obj,
        )
        created += 1
        if len(sample_documents) < 10:
            sample_documents.append(
                {
                    "id": doc.get("id"),
                    "filename": doc.get("filename"),
                    "source_uri": doc.get("source_uri"),
                }
            )

    log_admin_event(
        event_type="ingestion.minio_pull",
        actor_user_id=admin_user["id"],
        target_type="connector",
        target_id="minio",
        metadata_json={
            "total_seen": len(objects),
            "created": created,
            "skipped": skipped,
            "max_objects": payload.max_objects,
        },
    )
    return {
        "status": "ok",
        "total_seen": len(objects),
        "created": created,
        "skipped": skipped,
        "sample_documents": sample_documents,
    }


@app.get("/api/documents")
async def documents_list(
    limit: int = 100,
    _: Dict = Depends(get_current_user),
) -> Dict:
    items = list_documents(limit=limit)
    return {"count": len(items), "items": items}


@app.post("/api/processing/documents/extract")
async def processing_documents_extract(
    payload: ExtractDocumentsRequest,
    admin_user: Dict = Depends(require_admin),
) -> Dict:
    connector = get_connector("minio")
    if not connector:
        raise HTTPException(status_code=404, detail="MinIO connector config not found")
    if not connector.get("enabled", False):
        raise HTTPException(status_code=400, detail="MinIO connector is disabled")

    try:
        cfg = parse_minio_config(connector.get("config_json") or {})
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))

    candidates = list_documents_by_status("INGESTED", limit=payload.max_documents)
    extracted = 0
    failed = 0
    details = []
    for doc in candidates:
        doc_id = str(doc.get("id"))
        try:
            file_bytes = download_minio_object(cfg, str(doc.get("source_uri", "")))
            text = extract_text_for_document(str(doc.get("file_type", "")), file_bytes).strip()
            update_document(doc_id, {"status": "EXTRACTED", "extracted_text": text})
            extracted += 1
            details.append({"id": doc_id, "status": "EXTRACTED"})
        except Exception as exc:
            update_document(doc_id, {"status": "ERROR"})
            failed += 1
            details.append({"id": doc_id, "status": "ERROR", "reason": str(exc)[:240]})

    log_admin_event(
        event_type="processing.documents_extract",
        actor_user_id=admin_user["id"],
        target_type="documents",
        metadata_json={"selected": len(candidates), "extracted": extracted, "failed": failed},
    )
    return {
        "status": "ok",
        "selected": len(candidates),
        "extracted": extracted,
        "failed": failed,
        "details": details,
    }


@app.post("/api/processing/invoices/map")
async def processing_invoices_map(
    payload: MapInvoicesRequest,
    admin_user: Dict = Depends(require_admin),
) -> Dict:
    candidates = list_documents_by_status("EXTRACTED", limit=payload.max_documents)
    mapped = 0
    skipped = 0
    failed = 0
    details = []

    for doc in candidates:
        doc_id = str(doc.get("id"))
        if get_invoice_by_document(doc_id):
            skipped += 1
            details.append({"id": doc_id, "status": "SKIPPED", "reason": "already mapped"})
            continue
        try:
            mapped_row = map_extracted_document(doc)
            line_items = mapped_row.pop("line_items", [])
            invoice = create_invoice({"document_id": doc_id, **mapped_row})
            lines = create_invoice_lines(str(invoice.get("id")), line_items)
            update_document(doc_id, {"status": "MAPPED"})
            mapped += 1
            details.append(
                {
                    "id": doc_id,
                    "status": "MAPPED",
                    "invoice_id": invoice.get("id"),
                    "invoice_number": invoice.get("invoice_number"),
                    "line_items": len(lines),
                }
            )
        except Exception as exc:
            failed += 1
            details.append({"id": doc_id, "status": "ERROR", "reason": str(exc)[:240]})

    log_admin_event(
        event_type="processing.invoices_map",
        actor_user_id=admin_user["id"],
        target_type="invoices",
        metadata_json={"selected": len(candidates), "mapped": mapped, "skipped": skipped, "failed": failed},
    )
    return {
        "status": "ok",
        "selected": len(candidates),
        "mapped": mapped,
        "skipped": skipped,
        "failed": failed,
        "details": details,
    }


@app.get("/api/invoices")
async def invoices_list(
    limit: int = 100,
    _: Dict = Depends(get_current_user),
) -> Dict:
    items = list_invoices(limit=limit)
    return {"count": len(items), "items": items}


@app.post("/api/processing/invoices/validate")
async def processing_invoices_validate(
    payload: ValidateInvoicesRequest,
    admin_user: Dict = Depends(require_admin),
) -> Dict:
    candidates = list_invoices_by_status("MAPPED", limit=payload.max_invoices)
    validation_context = load_validation_context(limit=3000)
    validated = 0
    review = 0
    failed = 0
    details = []

    for inv in candidates:
        inv_id = str(inv.get("id"))
        try:
            result = validate_invoice(inv, validation_context)
            updated = update_invoice(
                inv_id,
                {
                    "status": result["status"],
                    "extraction_json": {
                        **(inv.get("extraction_json") or {}),
                        "validation": result["validation"],
                    },
                },
            )
            if not updated:
                raise ValueError("invoice update failed")
            if result["status"] == "VALIDATED":
                validated += 1
            else:
                review += 1
            doc_id = updated.get("document_id")
            if doc_id:
                update_document(str(doc_id), {"status": result["status"]})
            details.append(
                {
                    "invoice_id": inv_id,
                    "status": result["status"],
                    "errors": result["validation"].get("errors", []),
                }
            )
        except Exception as exc:
            failed += 1
            details.append({"invoice_id": inv_id, "status": "ERROR", "reason": str(exc)[:240]})

    log_admin_event(
        event_type="processing.invoices_validate",
        actor_user_id=admin_user["id"],
        target_type="invoices",
        metadata_json={
            "selected": len(candidates),
            "validated": validated,
            "needs_review": review,
            "failed": failed,
        },
    )
    return {
        "status": "ok",
        "selected": len(candidates),
        "validated": validated,
        "needs_review": review,
        "failed": failed,
        "details": details,
    }
