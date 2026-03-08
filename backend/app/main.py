import logging
from datetime import datetime, timezone
from typing import Dict, List, Optional

from fastapi import Depends, FastAPI, HTTPException, Response
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, EmailStr, Field

from .auth import authenticate_user, create_access_token, get_current_user, require_admin
from .audit_storage import log_admin_event
from .case_storage import create_case, get_case_by_id, list_cases, update_case
from .config import ADMIN_PASSWORD, ADMIN_USERNAME, CORS_ORIGINS
from .config_storage import get_connector, list_connectors, update_connector
from .document_processing import download_minio_object, extract_text_for_document
from .document_storage import (
    create_document,
    get_document_by_id,
    get_document_by_source_uri,
    list_documents,
    list_documents_by_status,
    update_document,
)
from .extraction_field_storage import list_extraction_fields, upsert_extraction_field
from .graph import graph_healthcheck
from .graph import (
    graph_get_global_subgraph,
    graph_get_insight_drilldown,
    graph_get_insights,
    graph_get_trend_insights,
    graph_get_invoice_subgraph,
    graph_reset_invoice_domain,
    graph_sync_invoice,
)
from .graph_config_storage import get_graph_config, update_graph_config
from .invoice_action_storage import create_invoice_action, list_invoice_actions
from .invoice_mapping import map_extracted_document
from .invoice_storage import (
    create_invoice,
    create_invoice_lines,
    get_invoice_by_id,
    get_invoice_by_document,
    list_invoice_lines,
    list_invoices,
    list_invoices_filtered,
    list_invoices_by_status,
    update_invoice,
)
from .invoice_validation import load_validation_context, validate_invoice
from .insight_explainer import explain_graph_insights
from .minio_ingestion import classify_file_type, list_minio_objects, parse_minio_config, source_uri
from .provider_storage import get_provider, list_providers, update_provider
from .recipient_resolution_storage import create_attribute_alias, get_attribute_alias_by_id, list_attribute_aliases, update_attribute_alias
from .reset_service import reset_invoice_pipeline_data
from .user_storage import bootstrap_admin, create_user, list_users, update_user
from .workflow_rules_storage import get_workflow_rules, update_workflow_rules
from .kpi_service import get_kpi_overview

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


class InvoiceActionRequest(BaseModel):
    comment: Optional[str] = Field(default=None, max_length=2000)


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


class WorkflowRulesResponse(BaseModel):
    id: Optional[str] = None
    rule_name: str
    rules_json: Dict = Field(default_factory=dict)
    updated_by: Optional[str] = None
    updated_at: Optional[str] = None


class WorkflowRulesUpdateRequest(BaseModel):
    rules_json: Dict


class GraphConfigResponse(BaseModel):
    id: Optional[str] = None
    config_name: str
    config_json: Dict = Field(default_factory=dict)
    updated_by: Optional[str] = None
    updated_at: Optional[str] = None


class GraphConfigUpdateRequest(BaseModel):
    data_layer_fields: List[str] = Field(default_factory=list)


class AttributeAliasResponse(BaseModel):
    id: str
    entity_type: str
    raw_value: str
    raw_value_key: str
    normalized_value: str
    canonical_value: str
    match_method: str
    confidence: float
    created_at: Optional[str] = None
    updated_at: Optional[str] = None


class AttributeAliasUpdateRequest(BaseModel):
    canonical_value: str = Field(min_length=1, max_length=255)


class AttributeAliasCreateRequest(BaseModel):
    entity_type: str = Field(default="recipient", min_length=1, max_length=128)
    raw_value: str = Field(min_length=1, max_length=255)
    canonical_value: str = Field(min_length=1, max_length=255)


class InvoiceCaseResponse(BaseModel):
    id: str
    invoice_id: str
    title: str
    description: Optional[str] = None
    status: str
    created_by_user_id: Optional[str] = None
    created_by_username: Optional[str] = None
    resolved_note: Optional[str] = None
    resolved_by_user_id: Optional[str] = None
    resolved_by_username: Optional[str] = None
    resolved_at: Optional[str] = None
    created_at: Optional[str] = None
    updated_at: Optional[str] = None


class UpdateCaseRequest(BaseModel):
    status: str = Field(pattern="^(OPEN|IN_PROGRESS|RESOLVED|CLOSED)$")
    resolved_note: Optional[str] = Field(default=None, max_length=2000)


class ResetPipelineRequest(BaseModel):
    reset_graph: bool = True


ALLOWED_ACTION_TRANSITIONS = {
    "approve": {
        "allowed_from": {"VALIDATED", "PENDING_APPROVAL", "NEEDS_REVIEW"},
        "to_status": "APPROVED",
        "roles_any_of": {"APPROVER", "ADMIN"},
    },
    "reject": {
        "allowed_from": {"NEEDS_REVIEW", "VALIDATED", "PENDING_APPROVAL", "ON_HOLD"},
        "to_status": "REJECTED",
        "roles_any_of": {"AP_CLERK", "APPROVER", "ADMIN"},
    },
    "hold": {
        "allowed_from": {"NEEDS_REVIEW", "VALIDATED", "PENDING_APPROVAL"},
        "to_status": "ON_HOLD",
        "roles_any_of": {"AP_CLERK", "APPROVER", "ADMIN"},
    },
    "request_clarification": {
        "allowed_from": {"NEEDS_REVIEW", "VALIDATED", "PENDING_APPROVAL", "ON_HOLD"},
        "to_status": "CLARIFICATION_REQUESTED",
        "roles_any_of": {"AP_CLERK", "APPROVER", "ADMIN"},
    },
}


class ExtractionFieldResponse(BaseModel):
    id: Optional[str] = None
    entity_name: str
    scope: str
    field_name: str
    description: str = ""
    data_type: str = "string"
    is_required: bool = False
    is_enabled: bool = True
    sort_order: int = 0
    updated_by: Optional[str] = None
    updated_at: Optional[str] = None


class ExtractionFieldUpsertRequest(BaseModel):
    entity_name: str = "invoice"
    scope: str = Field(pattern="^(header|line_item)$")
    field_name: str = Field(min_length=1, max_length=128)
    description: str = ""
    data_type: str = Field(default="string", pattern="^(string|number|integer|date|boolean)$")
    is_required: bool = False
    is_enabled: bool = True
    sort_order: int = 0


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


def _sync_invoice_graph_best_effort(invoice_id: str) -> Dict:
    invoice = get_invoice_by_id(invoice_id)
    if not invoice:
        return {"status": "not_found", "invoice_id": invoice_id}
    line_items = list_invoice_lines(invoice_id)
    actions = list_invoice_actions(invoice_id, limit=500)
    graph_cfg = get_graph_config()
    data_layer_fields = (graph_cfg.get("config_json") or {}).get("data_layer_fields") or []
    return graph_sync_invoice(invoice, line_items, actions, data_layer_fields=data_layer_fields)


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


@app.get("/api/admin/config/extraction-fields", response_model=List[ExtractionFieldResponse])
async def admin_list_extraction_fields(
    entity_name: str = "invoice",
    enabled_only: bool = False,
    _: Dict = Depends(require_admin),
) -> List[ExtractionFieldResponse]:
    rows = list_extraction_fields(entity_name=entity_name, enabled_only=enabled_only)
    return [ExtractionFieldResponse(**row) for row in rows]


@app.post("/api/admin/config/extraction-fields", response_model=ExtractionFieldResponse)
async def admin_upsert_extraction_field(
    payload: ExtractionFieldUpsertRequest,
    admin_user: Dict = Depends(require_admin),
) -> ExtractionFieldResponse:
    before = list_extraction_fields(entity_name=payload.entity_name, enabled_only=False)
    before_row = next(
        (
            row
            for row in before
            if row.get("scope") == payload.scope and row.get("field_name") == payload.field_name
        ),
        None,
    )
    after = upsert_extraction_field(
        entity_name=payload.entity_name,
        scope=payload.scope,
        field_name=payload.field_name,
        description=payload.description,
        data_type=payload.data_type,
        is_required=payload.is_required,
        is_enabled=payload.is_enabled,
        sort_order=payload.sort_order,
        actor_user_id=admin_user["id"],
    )
    log_admin_event(
        event_type="admin.extraction_field_upserted",
        actor_user_id=admin_user["id"],
        target_type="extraction_field",
        target_id=f"{payload.entity_name}:{payload.scope}:{payload.field_name}",
        metadata_json={
            "entity_name": payload.entity_name,
            "scope": payload.scope,
            "field_name": payload.field_name,
        },
        diff_before={"field": before_row} if before_row else None,
        diff_after={"field": after},
    )
    return ExtractionFieldResponse(**after)


@app.get("/api/admin/config/workflow-rules", response_model=WorkflowRulesResponse)
async def admin_get_workflow_rules(_: Dict = Depends(require_admin)) -> WorkflowRulesResponse:
    row = get_workflow_rules()
    return WorkflowRulesResponse(**row)


@app.put("/api/admin/config/workflow-rules", response_model=WorkflowRulesResponse)
async def admin_update_workflow_rules(
    payload: WorkflowRulesUpdateRequest,
    admin_user: Dict = Depends(require_admin),
) -> WorkflowRulesResponse:
    before = get_workflow_rules()
    after = update_workflow_rules(payload.rules_json, actor_user_id=admin_user["id"])
    log_admin_event(
        event_type="admin.workflow_rules_updated",
        actor_user_id=admin_user["id"],
        target_type="workflow_rules",
        target_id="invoice_approval",
        metadata_json={"keys": list((payload.rules_json or {}).keys())},
        diff_before={"workflow_rules": before.get("rules_json")},
        diff_after={"workflow_rules": after.get("rules_json")},
    )
    return WorkflowRulesResponse(**after)


@app.get("/api/admin/config/graph", response_model=GraphConfigResponse)
async def admin_get_graph_config(_: Dict = Depends(require_admin)) -> GraphConfigResponse:
    return GraphConfigResponse(**get_graph_config())


@app.put("/api/admin/config/graph", response_model=GraphConfigResponse)
async def admin_update_graph_config(
    payload: GraphConfigUpdateRequest,
    admin_user: Dict = Depends(require_admin),
) -> GraphConfigResponse:
    cleaned = []
    seen = set()
    for raw in payload.data_layer_fields:
        name = str(raw or "").strip()
        if not name or name in seen:
            continue
        seen.add(name)
        cleaned.append(name)
    before = get_graph_config()
    after = update_graph_config(cleaned, actor_user_id=admin_user["id"])
    log_admin_event(
        event_type="admin.graph_config_updated",
        actor_user_id=admin_user["id"],
        target_type="graph_config",
        target_id="invoice_data_layer",
        metadata_json={"data_layer_fields_count": len(cleaned)},
        diff_before={"graph_config": before.get("config_json")},
        diff_after={"graph_config": after.get("config_json")},
    )
    return GraphConfigResponse(**after)


@app.get("/api/admin/graph/aliases", response_model=List[AttributeAliasResponse])
async def admin_list_attribute_aliases(
    entity_type: str,
    limit: int = 200,
    search: str = "",
    _: Dict = Depends(require_admin),
) -> List[AttributeAliasResponse]:
    rows = list_attribute_aliases(entity_type=entity_type, limit=limit, search=search)
    return [AttributeAliasResponse(**r) for r in rows]


@app.post("/api/admin/graph/aliases", response_model=AttributeAliasResponse)
async def admin_create_attribute_alias(
    payload: AttributeAliasCreateRequest,
    admin_user: Dict = Depends(require_admin),
) -> AttributeAliasResponse:
    created = create_attribute_alias(payload.entity_type, payload.raw_value, payload.canonical_value, match_method="manual")
    if not created:
        raise HTTPException(status_code=400, detail="Invalid alias payload")
    log_admin_event(
        event_type="admin.attribute_alias_created",
        actor_user_id=admin_user["id"],
        target_type="attribute_alias",
        target_id=str(created.get("id") or ""),
        metadata_json={
            "entity_type": created.get("entity_type"),
            "raw_value": created.get("raw_value"),
            "canonical_value": created.get("canonical_value"),
        },
        diff_after={"alias": created},
    )
    return AttributeAliasResponse(**created)


@app.put("/api/admin/graph/aliases/{alias_id}", response_model=AttributeAliasResponse)
async def admin_update_attribute_alias(
    alias_id: str,
    payload: AttributeAliasUpdateRequest,
    admin_user: Dict = Depends(require_admin),
) -> AttributeAliasResponse:
    before = get_attribute_alias_by_id(alias_id)
    updated = update_attribute_alias(alias_id, payload.canonical_value, match_method="manual")
    if not updated:
        raise HTTPException(status_code=404, detail="Attribute alias not found")
    log_admin_event(
        event_type="admin.attribute_alias_updated",
        actor_user_id=admin_user["id"],
        target_type="attribute_alias",
        target_id=alias_id,
        metadata_json={"entity_type": updated.get("entity_type"), "canonical_value": updated.get("canonical_value")},
        diff_before={"alias": before} if before else None,
        diff_after={"alias": updated},
    )
    return AttributeAliasResponse(**updated)


# Legacy compatibility endpoints: default recipient alias scope.
@app.get("/api/admin/graph/recipient-aliases", response_model=List[AttributeAliasResponse])
async def admin_list_recipient_aliases_legacy(
    limit: int = 200,
    search: str = "",
    _: Dict = Depends(require_admin),
) -> List[AttributeAliasResponse]:
    rows = list_attribute_aliases(entity_type="recipient", limit=limit, search=search)
    if len(rows) < limit:
        existing_ids = {str(r.get("id") or "") for r in rows}
        extra = list_attribute_aliases(entity_type="empfaenger", limit=limit, search=search)
        rows.extend([r for r in extra if str(r.get("id") or "") not in existing_ids])
        rows = rows[:limit]
    return [AttributeAliasResponse(**r) for r in rows]


@app.post("/api/admin/graph/recipient-aliases", response_model=AttributeAliasResponse)
async def admin_create_recipient_alias_legacy(
    payload: AttributeAliasCreateRequest,
    admin_user: Dict = Depends(require_admin),
) -> AttributeAliasResponse:
    # Preserve old route behavior while allowing modern payloads.
    entity_type = str(payload.entity_type or "recipient").strip() or "recipient"
    created = create_attribute_alias(entity_type, payload.raw_value, payload.canonical_value, match_method="manual")
    if not created:
        raise HTTPException(status_code=400, detail="Invalid alias payload")
    log_admin_event(
        event_type="admin.attribute_alias_created",
        actor_user_id=admin_user["id"],
        target_type="attribute_alias",
        target_id=str(created.get("id") or ""),
        metadata_json={
            "entity_type": created.get("entity_type"),
            "raw_value": created.get("raw_value"),
            "canonical_value": created.get("canonical_value"),
        },
        diff_after={"alias": created},
    )
    return AttributeAliasResponse(**created)


@app.put("/api/admin/graph/recipient-aliases/{alias_id}", response_model=AttributeAliasResponse)
async def admin_update_recipient_alias_legacy(
    alias_id: str,
    payload: AttributeAliasUpdateRequest,
    admin_user: Dict = Depends(require_admin),
) -> AttributeAliasResponse:
    updated = update_attribute_alias(alias_id, payload.canonical_value, match_method="manual")
    if not updated:
        raise HTTPException(status_code=404, detail="Attribute alias not found")
    log_admin_event(
        event_type="admin.attribute_alias_updated",
        actor_user_id=admin_user["id"],
        target_type="attribute_alias",
        target_id=alias_id,
        metadata_json={"entity_type": updated.get("entity_type"), "canonical_value": updated.get("canonical_value")},
        diff_after={"alias": updated},
    )
    return AttributeAliasResponse(**updated)


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


@app.get("/api/admin/kpi/overview")
async def admin_kpi_overview(_: Dict = Depends(require_admin)) -> Dict:
    return get_kpi_overview(limit=5000)


@app.get("/api/admin/graph/insights")
async def admin_graph_insights(limit: int = 10, _: Dict = Depends(require_admin)) -> Dict:
    return graph_get_insights(limit=limit)


@app.get("/api/admin/graph/insights/trends")
async def admin_graph_insight_trends(
    window_days: int = 30,
    compare_days: int = 30,
    granularity: str = "week",
    _: Dict = Depends(require_admin),
) -> Dict:
    return graph_get_trend_insights(
        window_days=window_days,
        compare_days=compare_days,
        granularity=granularity,
    )


@app.get("/api/admin/graph/insights/drilldown")
async def admin_graph_insight_drilldown(
    metric: str,
    period_start: str,
    period_end: str,
    limit: int = 100,
    offset: int = 0,
    _: Dict = Depends(require_admin),
) -> Dict:
    return graph_get_insight_drilldown(
        metric=metric,
        period_start=period_start,
        period_end=period_end,
        limit=limit,
        offset=offset,
    )


@app.get("/api/admin/graph/insights/explain")
async def admin_graph_insight_explain(
    window_days: int = 30,
    compare_days: int = 30,
    granularity: str = "week",
    limit: int = 10,
    _: Dict = Depends(require_admin),
) -> Dict:
    trend = graph_get_trend_insights(
        window_days=window_days,
        compare_days=compare_days,
        granularity=granularity,
    )
    insights = graph_get_insights(limit=limit)
    if trend.get("status") not in {"ok"} and insights.get("status") not in {"ok"}:
        return {
            "status": "error",
            "reason": "trend and insights unavailable",
            "trend": trend,
            "insights": insights,
        }
    explanation = explain_graph_insights({"trend": trend, "insights": insights})
    return {
        "status": explanation.get("status") or "ok",
        "trend": trend,
        "insights": insights,
        "explanation": explanation,
    }


@app.post("/api/admin/reset/invoice-pipeline")
async def admin_reset_invoice_pipeline(
    payload: ResetPipelineRequest,
    admin_user: Dict = Depends(require_admin),
) -> Dict:
    data_reset_result = reset_invoice_pipeline_data()
    graph_reset_result: Dict = {"status": "skipped", "reason": "reset_graph=false"}
    if payload.reset_graph:
        graph_reset_result = graph_reset_invoice_domain()

    log_admin_event(
        event_type="admin.reset_invoice_pipeline",
        actor_user_id=admin_user["id"],
        target_type="pipeline",
        target_id="invoice_pipeline",
        metadata_json={
            "data_reset": data_reset_result,
            "graph_reset": graph_reset_result,
            "reset_graph": payload.reset_graph,
        },
    )
    return {
        "status": "ok",
        "data_reset": data_reset_result,
        "graph_reset": graph_reset_result,
    }


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
    extraction_fields = list_extraction_fields(entity_name="invoice", enabled_only=True)
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
            mapped_row = map_extracted_document(doc, extraction_fields)
            line_items = mapped_row.pop("line_items", [])
            invoice = create_invoice({"document_id": doc_id, **mapped_row})
            lines = create_invoice_lines(str(invoice.get("id")), line_items)
            update_document(doc_id, {"status": "MAPPED"})
            _sync_invoice_graph_best_effort(str(invoice.get("id")))
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
    status: Optional[str] = None,
    search: Optional[str] = None,
    _: Dict = Depends(get_current_user),
) -> Dict:
    items = list_invoices_filtered(limit=limit, status=status, search=search)
    return {"count": len(items), "items": items}


@app.get("/api/invoices/{invoice_id}")
async def invoices_get(
    invoice_id: str,
    _: Dict = Depends(get_current_user),
) -> Dict:
    item = get_invoice_by_id(invoice_id)
    if not item:
        raise HTTPException(status_code=404, detail="Invoice not found")
    return {"item": item}


@app.get("/api/invoices/{invoice_id}/lines")
async def invoice_lines_get(
    invoice_id: str,
    _: Dict = Depends(get_current_user),
) -> Dict:
    item = get_invoice_by_id(invoice_id)
    if not item:
        raise HTTPException(status_code=404, detail="Invoice not found")
    lines = list_invoice_lines(invoice_id)
    return {"count": len(lines), "items": lines}


@app.get("/api/invoices/{invoice_id}/actions")
async def invoice_actions_get(
    invoice_id: str,
    _: Dict = Depends(get_current_user),
) -> Dict:
    item = get_invoice_by_id(invoice_id)
    if not item:
        raise HTTPException(status_code=404, detail="Invoice not found")
    actions = list_invoice_actions(invoice_id, limit=200)
    return {"count": len(actions), "items": actions}


@app.get("/api/graph/invoices/{invoice_id}")
async def graph_invoice_get(
    invoice_id: str,
    _: Dict = Depends(get_current_user),
) -> Dict:
    # Ensure invoice exists in relational source of truth first.
    invoice = get_invoice_by_id(invoice_id)
    if not invoice:
        raise HTTPException(status_code=404, detail="Invoice not found")
    graph_data = graph_get_invoice_subgraph(invoice_id, max_nodes=300)
    if graph_data.get("status") in {"unavailable", "error"}:
        raise HTTPException(status_code=502, detail=graph_data.get("reason", "Graph unavailable"))
    return graph_data


@app.get("/api/graph/global")
async def graph_global_get(
    max_nodes: int = 500,
    max_edges: int = 1200,
    _: Dict = Depends(require_admin),
) -> Dict:
    graph_data = graph_get_global_subgraph(max_nodes=max_nodes, max_edges=max_edges)
    if graph_data.get("status") in {"unavailable", "error"}:
        raise HTTPException(status_code=502, detail=graph_data.get("reason", "Graph unavailable"))
    return graph_data


@app.post("/api/graph/sync/invoices/{invoice_id}")
async def graph_sync_invoice_one(
    invoice_id: str,
    admin_user: Dict = Depends(require_admin),
) -> Dict:
    invoice = get_invoice_by_id(invoice_id)
    if not invoice:
        raise HTTPException(status_code=404, detail="Invoice not found")
    result = _sync_invoice_graph_best_effort(invoice_id)
    log_admin_event(
        event_type="graph.sync_invoice",
        actor_user_id=admin_user["id"],
        target_type="invoice",
        target_id=invoice_id,
        metadata_json=result,
    )
    if result.get("status") == "error":
        raise HTTPException(status_code=502, detail=result.get("reason", "Graph sync failed"))
    return result


@app.post("/api/graph/sync/invoices")
async def graph_sync_invoices_bulk(
    limit: int = 200,
    admin_user: Dict = Depends(require_admin),
) -> Dict:
    rows = list_invoices(limit=limit)
    synced = 0
    failed = 0
    details = []
    for row in rows:
        invoice_id = str(row.get("id") or "")
        if not invoice_id:
            continue
        result = _sync_invoice_graph_best_effort(invoice_id)
        if result.get("status") == "ok":
            synced += 1
        else:
            failed += 1
        if len(details) < 50:
            details.append({"invoice_id": invoice_id, "status": result.get("status"), "reason": result.get("reason")})

    summary = {"status": "ok", "selected": len(rows), "synced": synced, "failed": failed, "details": details}
    log_admin_event(
        event_type="graph.sync_invoices_bulk",
        actor_user_id=admin_user["id"],
        target_type="invoices",
        metadata_json={"selected": len(rows), "synced": synced, "failed": failed},
    )
    return summary


def _content_type_for_file_type(file_type: str) -> str:
    if file_type == "pdf":
        return "application/pdf"
    if file_type == "image":
        return "image/png"
    if file_type == "txt":
        return "text/plain; charset=utf-8"
    return "application/octet-stream"


@app.get("/api/invoices/{invoice_id}/document")
async def invoice_document_get(
    invoice_id: str,
    _: Dict = Depends(get_current_user),
) -> Response:
    invoice = get_invoice_by_id(invoice_id)
    if not invoice:
        raise HTTPException(status_code=404, detail="Invoice not found")
    document_id = str(invoice.get("document_id") or "")
    if not document_id:
        raise HTTPException(status_code=404, detail="No document linked to invoice")

    document = get_document_by_id(document_id)
    if not document:
        raise HTTPException(status_code=404, detail="Document not found")
    if str(document.get("source_system") or "") != "minio":
        raise HTTPException(status_code=400, detail="Document source is not supported for preview")

    connector = get_connector("minio")
    if not connector:
        raise HTTPException(status_code=404, detail="MinIO connector config not found")
    try:
        cfg = parse_minio_config(connector.get("config_json") or {})
        content = download_minio_object(cfg, str(document.get("source_uri") or ""))
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Document fetch failed: {exc}")

    file_type = str(document.get("file_type") or "")
    filename = str(document.get("filename") or "document.bin")
    return Response(
        content=content,
        media_type=_content_type_for_file_type(file_type),
        headers={"Content-Disposition": f'inline; filename="{filename}"'},
    )


def _execute_invoice_action(action_type: str, invoice_id: str, payload: InvoiceActionRequest, current_user: Dict) -> Dict:
    rule = ALLOWED_ACTION_TRANSITIONS.get(action_type)
    if not rule:
        raise HTTPException(status_code=400, detail="Unsupported action")

    user_roles = set(current_user.get("roles") or [])
    if not user_roles.intersection(set(rule["roles_any_of"])):
        raise HTTPException(status_code=403, detail=f"Role required: one of {sorted(rule['roles_any_of'])}")

    invoice = get_invoice_by_id(invoice_id)
    if not invoice:
        raise HTTPException(status_code=404, detail="Invoice not found")
    from_status = str(invoice.get("status") or "")
    allowed_from = set(rule["allowed_from"])
    if from_status not in allowed_from:
        raise HTTPException(
            status_code=409,
            detail=f"Action '{action_type}' not allowed from status '{from_status}'",
        )

    if action_type == "approve":
        wf = get_workflow_rules().get("rules_json") or {}
        approval_cfg = wf.get("approval") if isinstance(wf, dict) else {}
        if not isinstance(approval_cfg, dict):
            approval_cfg = {}

        # Optional hard gate: approval only from VALIDATED status.
        require_validated_status = bool(approval_cfg.get("require_validated_status", False))
        if require_validated_status and from_status != "VALIDATED":
            raise HTTPException(
                status_code=409,
                detail=f"Approval requires status VALIDATED, current status is '{from_status}'",
            )

        supplier_name = str(invoice.get("supplier_name") or "").strip().lower()
        gross_amount = invoice.get("gross_amount")
        try:
            amount = float(gross_amount) if gross_amount is not None else 0.0
        except Exception:
            amount = 0.0

        allowed_roles_by_rule = None
        supplier_overrides = approval_cfg.get("supplier_role_overrides") or []
        if isinstance(supplier_overrides, list):
            for override in supplier_overrides:
                if not isinstance(override, dict):
                    continue
                if str(override.get("supplier_name") or "").strip().lower() == supplier_name:
                    roles = override.get("allowed_roles")
                    if isinstance(roles, list):
                        allowed_roles_by_rule = {str(r) for r in roles}
                        break

        if allowed_roles_by_rule is None:
            amount_limits = approval_cfg.get("amount_limits") or []
            chosen_roles = None
            if isinstance(amount_limits, list):
                for row in amount_limits:
                    if not isinstance(row, dict):
                        continue
                    max_amount = row.get("max_amount")
                    if max_amount is None:
                        chosen_roles = row.get("allowed_roles")
                        break
                    try:
                        if amount <= float(max_amount):
                            chosen_roles = row.get("allowed_roles")
                            break
                    except Exception:
                        continue
            if isinstance(chosen_roles, list) and chosen_roles:
                allowed_roles_by_rule = {str(r) for r in chosen_roles}

        if allowed_roles_by_rule:
            if not user_roles.intersection(allowed_roles_by_rule):
                raise HTTPException(
                    status_code=403,
                    detail=f"Approval rule violation: required role one of {sorted(allowed_roles_by_rule)} for amount {amount}",
                )

        # Optional four-eyes principle:
        # Approver must differ from the actor of the most recent action.
        if bool(approval_cfg.get("four_eyes", False)):
            prior_actions = list_invoice_actions(invoice_id, limit=1)
            if prior_actions:
                prior_actor = str(prior_actions[0].get("actor_user_id") or "")
                if prior_actor and prior_actor == str(current_user.get("id") or ""):
                    raise HTTPException(
                        status_code=409,
                        detail="Approval rule violation: four-eyes principle requires a different approver",
                    )

    to_status = str(rule["to_status"])
    updated = update_invoice(invoice_id, {"status": to_status})
    if not updated:
        raise HTTPException(status_code=500, detail="Invoice update failed")
    doc_id = updated.get("document_id")
    if doc_id:
        update_document(str(doc_id), {"status": to_status})

    action_row = create_invoice_action(
        invoice_id=invoice_id,
        action_type=action_type,
        from_status=from_status,
        to_status=to_status,
        comment=payload.comment,
        actor_user_id=current_user["id"],
        actor_username=current_user.get("username"),
    )
    case_row = None
    if action_type == "request_clarification":
        case_row = create_case(
            invoice_id=invoice_id,
            title="Rueckfrage zur Rechnung",
            description=payload.comment,
            status="OPEN",
            created_by_user_id=current_user.get("id"),
            created_by_username=current_user.get("username"),
        )
    log_admin_event(
        event_type=f"invoices.{action_type}",
        actor_user_id=current_user["id"],
        target_type="invoice",
        target_id=invoice_id,
        metadata_json={
            "from_status": from_status,
            "to_status": to_status,
            "comment_present": bool(payload.comment),
        },
    )
    _sync_invoice_graph_best_effort(invoice_id)
    return {
        "status": "ok",
        "invoice_id": invoice_id,
        "from_status": from_status,
        "to_status": to_status,
        "action": action_row,
        "case": case_row,
    }


@app.post("/api/invoices/{invoice_id}/approve")
async def invoice_approve(
    invoice_id: str,
    payload: InvoiceActionRequest,
    current_user: Dict = Depends(get_current_user),
) -> Dict:
    return _execute_invoice_action("approve", invoice_id, payload, current_user)


@app.post("/api/invoices/{invoice_id}/reject")
async def invoice_reject(
    invoice_id: str,
    payload: InvoiceActionRequest,
    current_user: Dict = Depends(get_current_user),
) -> Dict:
    return _execute_invoice_action("reject", invoice_id, payload, current_user)


@app.post("/api/invoices/{invoice_id}/hold")
async def invoice_hold(
    invoice_id: str,
    payload: InvoiceActionRequest,
    current_user: Dict = Depends(get_current_user),
) -> Dict:
    return _execute_invoice_action("hold", invoice_id, payload, current_user)


@app.post("/api/invoices/{invoice_id}/request-clarification")
async def invoice_request_clarification(
    invoice_id: str,
    payload: InvoiceActionRequest,
    current_user: Dict = Depends(get_current_user),
) -> Dict:
    return _execute_invoice_action("request_clarification", invoice_id, payload, current_user)


@app.get("/api/invoices/{invoice_id}/cases", response_model=List[InvoiceCaseResponse])
async def invoice_cases_get(
    invoice_id: str,
    _: Dict = Depends(get_current_user),
) -> List[InvoiceCaseResponse]:
    item = get_invoice_by_id(invoice_id)
    if not item:
        raise HTTPException(status_code=404, detail="Invoice not found")
    rows = list_cases(invoice_id=invoice_id, limit=200)
    return [InvoiceCaseResponse(**r) for r in rows]


@app.patch("/api/cases/{case_id}", response_model=InvoiceCaseResponse)
async def invoice_case_update(
    case_id: str,
    payload: UpdateCaseRequest,
    current_user: Dict = Depends(get_current_user),
) -> InvoiceCaseResponse:
    case_row = get_case_by_id(case_id)
    if not case_row:
        raise HTTPException(status_code=404, detail="Case not found")

    updates: Dict[str, Optional[str]] = {
        "status": payload.status,
    }
    if payload.status in {"RESOLVED", "CLOSED"}:
        updates["resolved_note"] = payload.resolved_note
        updates["resolved_by_user_id"] = current_user.get("id")
        updates["resolved_by_username"] = current_user.get("username")
        updates["resolved_at"] = datetime.now(timezone.utc).isoformat()
    else:
        updates["resolved_note"] = None
        updates["resolved_by_user_id"] = None
        updates["resolved_by_username"] = None
        updates["resolved_at"] = None

    updated_case = update_case(case_id, updates)
    if not updated_case:
        raise HTTPException(status_code=500, detail="Case update failed")

    invoice_id = str(case_row.get("invoice_id") or "")
    if invoice_id:
        invoice = get_invoice_by_id(invoice_id)
        if invoice and payload.status in {"RESOLVED", "CLOSED"} and str(invoice.get("status") or "") == "CLARIFICATION_REQUESTED":
            updated_invoice = update_invoice(invoice_id, {"status": "NEEDS_REVIEW"})
            if updated_invoice and updated_invoice.get("document_id"):
                update_document(str(updated_invoice.get("document_id")), {"status": "NEEDS_REVIEW"})
            _sync_invoice_graph_best_effort(invoice_id)

    log_admin_event(
        event_type="invoices.case_updated",
        actor_user_id=current_user["id"],
        target_type="invoice_case",
        target_id=case_id,
        metadata_json={"status": payload.status, "invoice_id": invoice_id},
    )
    return InvoiceCaseResponse(**updated_case)


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
            _sync_invoice_graph_best_effort(inv_id)
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
