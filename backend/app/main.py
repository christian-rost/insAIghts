import logging
from typing import Dict, List, Optional

from fastapi import Depends, FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, EmailStr, Field

from .auth import authenticate_user, create_access_token, get_current_user, require_admin
from .audit_storage import log_admin_event
from .config import ADMIN_PASSWORD, ADMIN_USERNAME, CORS_ORIGINS
from .config_storage import get_connector, list_connectors, update_connector
from .document_storage import create_document, get_document_by_source_uri, list_documents
from .graph import graph_healthcheck
from .minio_ingestion import classify_file_type, list_minio_objects, parse_minio_config, source_uri
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
