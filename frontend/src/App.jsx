import { useEffect, useMemo, useRef, useState } from "react"
import {
  askGraphQuestion,
  createUser,
  createInvoiceDeleteRequest,
  createAttributeAlias,
  extractDocuments,
  getInvoice,
  getInvoiceGraph,
  getGlobalGraph,
  getGraphInsights,
  getGraphInsightDrilldown,
  getGraphInsightExplanation,
  getGraphTrendInsights,
  getInvoiceDocumentBlob,
  getKpiOverview,
  getGraphConfig,
  invoiceApprove,
  invoiceHold,
  invoiceRequestClarification,
  invoiceReject,
  listExtractionFields,
  listInvoiceActions,
  listInvoiceCases,
  listInvoiceLines,
  listInvoices,
  listConnectors,
  listAttributeAliases,
  listDocuments,
  listProviders,
  listAdminAuditEvents,
  listUsers,
  login,
  mapInvoices,
  logout,
  me,
  approveDeleteRequest,
  deleteDocument,
  listDeleteRequests,
  previewMinioObjects,
  reprocessDocuments,
  rejectDeleteRequest,
  runPipeline,
  pullMinioSelected,
  register,
  resetInvoicePipeline,
  updateProvider,
  updateAttributeAlias,
  upsertExtractionField,
  syncInvoicesGraphBulk,
  updateCase,
  validateInvoices,
  getWorkflowRules,
  testConnector,
  updateWorkflowRules,
  updateConnector,
  updateGraphConfig,
} from "./api"

const APPROVAL_ROLE_OPTIONS = ["AP_CLERK", "APPROVER", "ADMIN"]
const CORE_GRAPH_FIELD_OPTIONS = ["supplier_name", "currency", "status"]

function defaultWorkflowRules() {
  return {
    approval: {
      four_eyes: false,
      require_validated_status: false,
      amount_limits: [
        { max_amount: "1000", allowed_roles: ["AP_CLERK", "APPROVER", "ADMIN"] },
        { max_amount: "10000", allowed_roles: ["APPROVER", "ADMIN"] },
        { max_amount: "", allowed_roles: ["ADMIN"] },
      ],
      supplier_role_overrides: [],
    },
  }
}

function normalizeWorkflowRules(raw) {
  const base = defaultWorkflowRules()
  const approval = raw?.approval || {}
  const limits = Array.isArray(approval.amount_limits) ? approval.amount_limits : base.approval.amount_limits
  const overrides = Array.isArray(approval.supplier_role_overrides) ? approval.supplier_role_overrides : []
  return {
    approval: {
      four_eyes: !!approval.four_eyes,
      require_validated_status: !!approval.require_validated_status,
      amount_limits: limits.map((l, idx) => ({
        max_amount: l?.max_amount === null || l?.max_amount === undefined ? "" : String(l.max_amount),
        allowed_roles: Array.isArray(l?.allowed_roles) && l.allowed_roles.length ? l.allowed_roles : base.approval.amount_limits[Math.min(idx, base.approval.amount_limits.length - 1)].allowed_roles,
      })),
      supplier_role_overrides: overrides.map((o) => ({
        supplier_name: String(o?.supplier_name || ""),
        allowed_roles: Array.isArray(o?.allowed_roles) ? o.allowed_roles : [],
      })),
    },
  }
}

function toWorkflowRulesPayload(rules) {
  const approval = rules?.approval || {}
  return {
    approval: {
      four_eyes: !!approval.four_eyes,
      require_validated_status: !!approval.require_validated_status,
      amount_limits: (approval.amount_limits || []).map((r) => ({
        max_amount: String(r.max_amount || "").trim() === "" ? null : Number(r.max_amount),
        allowed_roles: (r.allowed_roles || []).filter(Boolean).length
          ? (r.allowed_roles || []).filter(Boolean)
          : ["ADMIN"],
      })),
      supplier_role_overrides: (approval.supplier_role_overrides || [])
        .filter((r) => String(r.supplier_name || "").trim() !== "")
        .map((r) => ({
          supplier_name: String(r.supplier_name || "").trim(),
          allowed_roles: (r.allowed_roles || []).filter(Boolean).length
            ? (r.allowed_roles || []).filter(Boolean)
            : ["ADMIN"],
        })),
    },
  }
}

function buildExtractedHeaderRows(invoice) {
  const extraction = invoice?.extraction_json || {}
  const configured = Array.isArray(extraction?.configured_fields) ? extraction.configured_fields : []
  const llmOutput = extraction?.llm_output || {}
  const header = llmOutput && typeof llmOutput.header === "object" && llmOutput.header !== null
    ? llmOutput.header
    : (llmOutput && typeof llmOutput === "object" ? llmOutput : {})

  const coreValueMap = {
    supplier_name: invoice?.supplier_name,
    invoice_number: invoice?.invoice_number,
    invoice_date: invoice?.invoice_date,
    due_date: invoice?.due_date,
    currency: invoice?.currency,
    gross_amount: invoice?.gross_amount,
    net_amount: invoice?.net_amount,
    tax_amount: invoice?.tax_amount,
  }

  const rows = configured
    .filter((f) => f?.scope === "header" && f?.is_enabled !== false)
    .sort((a, b) => Number(a?.sort_order || 0) - Number(b?.sort_order || 0))
    .map((f) => {
      const fieldName = String(f?.field_name || "")
      const hasLlmValue = Object.prototype.hasOwnProperty.call(header, fieldName)
      const llmValue = hasLlmValue ? header[fieldName] : undefined
      const value = hasLlmValue ? llmValue : coreValueMap[fieldName]
      return {
        field_name: fieldName,
        description: f?.description || "",
        data_type: f?.data_type || "string",
        is_required: !!f?.is_required,
        has_value: value !== null && value !== undefined && String(value) !== "",
        provided_by_llm: hasLlmValue,
        value,
      }
    })
  const known = new Set(rows.map((r) => r.field_name))
  for (const [fieldName, value] of Object.entries(header || {})) {
    if (!fieldName || known.has(fieldName)) continue
    rows.push({
      field_name: fieldName,
      description: "nicht im Feld-Snapshot konfiguriert",
      data_type: "string",
      is_required: false,
      has_value: value !== null && value !== undefined && String(value) !== "",
      provided_by_llm: true,
      value,
    })
  }
  return rows
}

function formatMoney(value) {
  if (value === null || value === undefined || value === "") return "-"
  const n = Number(value)
  if (!Number.isFinite(n)) return String(value)
  return n.toFixed(2)
}

function extractGraphResultInvoiceKeys(result) {
  const rows = Array.isArray(result?.rows) ? result.rows : []
  const invoiceIds = new Set()
  const invoiceNumbers = new Set()

  for (const row of rows) {
    if (!row || typeof row !== "object") continue
    const directId = String(row.invoice_id || row.id || "").trim()
    const directNumber = String(row.invoice_number || "").trim()
    if (directId) invoiceIds.add(directId)
    if (directNumber) invoiceNumbers.add(directNumber)

    const nested = row.i
    if (nested && typeof nested === "object") {
      const nestedId = String(nested.id || "").trim()
      const nestedNumber = String(nested.invoice_number || "").trim()
      if (nestedId) invoiceIds.add(nestedId)
      if (nestedNumber) invoiceNumbers.add(nestedNumber)
    }
  }

  return {
    invoiceIds: Array.from(invoiceIds),
    invoiceNumbers: Array.from(invoiceNumbers),
  }
}

function LoginView({ onLogin, loading, error }) {
  const [mode, setMode] = useState("login")
  const [username, setUsername] = useState("")
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [confirmPassword, setConfirmPassword] = useState("")
  const [localError, setLocalError] = useState("")

  return (
    <div className="login-container">
      <section className="login-box">
      <div className="login-logo">
        <h1>insAIghts</h1>
        <p>Daten- und Operationsplattform</p>
      </div>

      <div className="login-tabs">
        <button
          type="button"
          className={`login-tab ${mode === "login" ? "active" : ""}`}
          onClick={() => {
            setMode("login")
            setLocalError("")
          }}
        >
          Login
        </button>
        <button
          type="button"
          className={`login-tab ${mode === "register" ? "active" : ""}`}
          onClick={() => {
            setMode("register")
            setLocalError("")
          }}
        >
          Registrieren
        </button>
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault()
          if (mode === "register" && password !== confirmPassword) {
            setLocalError("Passwoerter stimmen nicht ueberein")
            return
          }
          setLocalError("")
          onLogin({ mode, username, email, password })
        }}
      >
        <div className="form-group">
          <label>Benutzername</label>
          <input className="input" value={username} onChange={(e) => setUsername(e.target.value)} required />
        </div>
        {mode === "register" ? (
          <div className="form-group">
            <label>E-Mail</label>
            <input className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
          </div>
        ) : null}
        <div className="form-group">
          <label>Passwort</label>
          <input className="input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        </div>
        {mode === "register" ? (
          <div className="form-group">
            <label>Passwort bestaetigen</label>
            <input className="input" type="password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} required />
          </div>
        ) : null}
        <button className="btn btn-primary form-submit" disabled={loading} type="submit">
          {loading ? "Bitte warten..." : mode === "login" ? "Anmelden" : "Registrieren"}
        </button>
      </form>
      {localError ? <p className="error">{localError}</p> : null}
      {error ? <p className="error">{error}</p> : null}
      </section>
    </div>
  )
}

function AdminView({ token, currentUser, onLogout }) {
  const ADMIN_TABS = [
    { id: "kpi", label: "KPI" },
    { id: "model", label: "Model / Felder" },
    { id: "providers", label: "Provider" },
    { id: "users", label: "User Management" },
    { id: "pipeline", label: "MinIO Pipeline" },
    { id: "graph", label: "Graph" },
    { id: "audit", label: "Audit" },
    { id: "reset", label: "Reset" },
  ]
  const [users, setUsers] = useState([])
  const [documents, setDocuments] = useState([])
  const [invoices, setInvoices] = useState([])
  const [extractionFields, setExtractionFields] = useState([])
  const [extractionFieldDrafts, setExtractionFieldDrafts] = useState({})
  const [error, setError] = useState("")
  const [notice, setNotice] = useState("")
  const [form, setForm] = useState({
    username: "",
    email: "",
    password: "",
    roles: "AP_CLERK",
  })
  const [providers, setProviders] = useState({
    mistral_enabled: false,
    mistral_key: "",
    mistral_key_present: false,
  })
  const [minio, setMinio] = useState({
    enabled: false,
    endpoint: "",
    access_key: "",
    secret_key: "",
    bucket: "",
    prefix: "",
    secure: true,
    max_objects: 200,
    max_extract: 20,
    max_map: 20,
    max_validate: 50,
  })
  const [minioPreviewOpen, setMinioPreviewOpen] = useState(false)
  const [minioPreviewItems, setMinioPreviewItems] = useState([])
  const [minioPreviewSelection, setMinioPreviewSelection] = useState({})
  const [minioPreviewLoading, setMinioPreviewLoading] = useState(false)
  const [selectedDocumentIds, setSelectedDocumentIds] = useState({})
  const [pipelineRunning, setPipelineRunning] = useState(false)
  const [pipelineProgressText, setPipelineProgressText] = useState("")
  const [deleteRequests, setDeleteRequests] = useState([])
  const [deleteRequestStatusFilter, setDeleteRequestStatusFilter] = useState("PENDING")
  const pipelineProgressIntervalRef = useRef(null)
  const [auditEvents, setAuditEvents] = useState([])
  const [auditLimit, setAuditLimit] = useState(200)
  const [auditEventTypeFilter, setAuditEventTypeFilter] = useState("")
  const [auditActorFilter, setAuditActorFilter] = useState("")
  const [auditTargetTypeFilter, setAuditTargetTypeFilter] = useState("")
  const [graphSyncLimit, setGraphSyncLimit] = useState(200)
  const [globalGraphData, setGlobalGraphData] = useState(null)
  const [globalGraphError, setGlobalGraphError] = useState("")
  const [globalGraphMaxNodes, setGlobalGraphMaxNodes] = useState(500)
  const [globalGraphMaxEdges, setGlobalGraphMaxEdges] = useState(1200)
  const [graphInsights, setGraphInsights] = useState(null)
  const [graphInsightsLimit, setGraphInsightsLimit] = useState(10)
  const [adminGraphQuestion, setAdminGraphQuestion] = useState("")
  const [adminGraphQuestionLoading, setAdminGraphQuestionLoading] = useState(false)
  const [adminGraphQuestionError, setAdminGraphQuestionError] = useState("")
  const [adminGraphQuestionResult, setAdminGraphQuestionResult] = useState(null)
  const [graphTrend, setGraphTrend] = useState(null)
  const [trendWindowDays, setTrendWindowDays] = useState(30)
  const [trendCompareDays, setTrendCompareDays] = useState(30)
  const [trendGranularity, setTrendGranularity] = useState("week")
  const [graphDrilldown, setGraphDrilldown] = useState(null)
  const [graphExplanation, setGraphExplanation] = useState(null)
  const [resetGraph, setResetGraph] = useState(true)
  const [adminTab, setAdminTab] = useState("kpi")
  const [graphFieldOptions, setGraphFieldOptions] = useState(CORE_GRAPH_FIELD_OPTIONS)
  const [selectedGraphFields, setSelectedGraphFields] = useState(CORE_GRAPH_FIELD_OPTIONS)
  const [attributeAliases, setAttributeAliases] = useState([])
  const [attributeAliasDrafts, setAttributeAliasDrafts] = useState({})
  const [attributeAliasSearch, setAttributeAliasSearch] = useState("")
  const [selectedAliasEntityType, setSelectedAliasEntityType] = useState("recipient")
  const [newAliasRaw, setNewAliasRaw] = useState("")
  const [newAliasCanonical, setNewAliasCanonical] = useState("")
  const [workflowRules, setWorkflowRules] = useState(defaultWorkflowRules())
  const [kpi, setKpi] = useState(null)
  const [fieldForm, setFieldForm] = useState({
    entity_name: "invoice",
    scope: "header",
    field_name: "",
    description: "",
    data_type: "string",
    is_required: false,
    is_enabled: true,
    sort_order: 100,
  })

  async function loadUsers() {
    try {
      setError("")
      setUsers(await listUsers(token))
    } catch (e) {
      setError(String(e.message || e))
    }
  }

  async function loadMinioConnector() {
    try {
      const connectors = await listConnectors(token)
      const row = connectors.find((c) => c.connector_name === "minio")
      if (!row) return
      const cfg = row.config_json || {}
      setMinio((prev) => ({
        ...prev,
        enabled: !!row.enabled,
        endpoint: cfg.endpoint || "",
        access_key: cfg.access_key || "",
        secret_key: cfg.secret_key || "",
        bucket: cfg.bucket || "",
        prefix: cfg.prefix || "",
        secure: cfg.secure !== false,
      }))
    } catch (e) {
      setError(String(e.message || e))
    }
  }

  async function loadProvidersConfig() {
    try {
      const rows = await listProviders(token)
      const mistral = rows.find((r) => r.provider_name === "mistral")
      if (!mistral) return
      setProviders((p) => ({
        ...p,
        mistral_enabled: !!mistral.is_enabled,
        mistral_key_present: !!mistral.key_present,
      }))
    } catch (e) {
      setError(String(e.message || e))
    }
  }

  async function loadDocumentsList() {
    try {
      const res = await listDocuments(token, 50)
      setDocuments(res.items || [])
    } catch (e) {
      setError(String(e.message || e))
    }
  }

  async function loadDeleteRequests() {
    try {
      const res = await listDeleteRequests(token, { status: deleteRequestStatusFilter, limit: 300 })
      setDeleteRequests(res.items || [])
    } catch (e) {
      setError(String(e.message || e))
    }
  }

  async function refreshPipelineProgress(runId) {
    const res = await listAdminAuditEvents(token, 300)
    const rows = (res.items || []).filter(
      (row) =>
        String(row?.event_type || "") === "admin.pipeline_run.progress" &&
        String(row?.metadata_json?.run_id || "") === String(runId),
    )
    if (!rows.length) return
    const latest = rows.reduce((best, row) => {
      const seq = Number(row?.metadata_json?.seq || 0)
      const bestSeq = Number(best?.metadata_json?.seq || 0)
      if (seq > bestSeq) return row
      if (seq < bestSeq) return best
      return String(row?.created_at || "") > String(best?.created_at || "") ? row : best
    }, rows[0])
    const meta = latest.metadata_json || {}
    const label = String(meta.step_label || meta.step || "Pipeline")
    const state = String(meta.state || "").toLowerCase()
    const result = meta.result || {}
    const metrics = [
      result.created != null ? `neu: ${result.created}` : "",
      result.extracted != null ? `extract: ${result.extracted}` : "",
      result.mapped != null ? `map: ${result.mapped}` : "",
      result.validated != null ? `validate: ${result.validated}` : "",
      result.synced != null ? `graph: ${result.synced}` : "",
    ].filter(Boolean)
    const suffix = metrics.length ? ` (${metrics.join(", ")})` : ""
    if (state === "running") {
      setPipelineProgressText(`Status: ${label} laeuft...${suffix}`)
    } else if (state === "done") {
      setPipelineProgressText(`Status: ${label} abgeschlossen${suffix}`)
    } else if (state === "failed") {
      setPipelineProgressText(`Status: ${label} fehlgeschlagen${suffix}`)
    }
  }

  async function loadAuditEvents(limit = auditLimit) {
    try {
      const res = await listAdminAuditEvents(token, limit || 200)
      setAuditEvents(res.items || [])
    } catch (e) {
      setError(String(e.message || e))
    }
  }

  async function loadInvoicesList() {
    try {
      const res = await listInvoices(token, { limit: 50 })
      setInvoices(res.items || [])
    } catch (e) {
      setError(String(e.message || e))
    }
  }

  async function loadExtractionFields() {
    try {
      const rows = await listExtractionFields(token, "invoice", false)
      setExtractionFields(rows || [])
      const headerFields = (rows || [])
        .filter((r) => r.scope === "header")
        .map((r) => String(r.field_name || "").trim())
        .filter(Boolean)
      const merged = Array.from(new Set([...CORE_GRAPH_FIELD_OPTIONS, ...headerFields]))
      setGraphFieldOptions(merged)
      setSelectedAliasEntityType((current) => {
        const value = String(current || "").trim()
        if (value && merged.includes(value)) return value
        if (value) return value
        return merged[0] || "recipient"
      })
      const drafts = {}
      for (const row of rows || []) {
        const key = `${row.scope}:${row.field_name}`
        drafts[key] = {
          description: row.description || "",
          data_type: row.data_type || "string",
          is_required: !!row.is_required,
          is_enabled: !!row.is_enabled,
          sort_order: Number(row.sort_order || 0),
        }
      }
      setExtractionFieldDrafts(drafts)
    } catch (e) {
      setError(String(e.message || e))
    }
  }

  async function loadGraphConfig() {
    try {
      const row = await getGraphConfig(token)
      const fields = (row?.config_json?.data_layer_fields || []).map((x) => String(x || "").trim()).filter(Boolean)
      setSelectedGraphFields(fields.length ? fields : CORE_GRAPH_FIELD_OPTIONS)
    } catch (e) {
      setError(String(e.message || e))
    }
  }

  async function loadAttributeAliases(search = attributeAliasSearch, entityType = selectedAliasEntityType) {
    const scope = String(entityType || "").trim()
    if (!scope) {
      setAttributeAliases([])
      setAttributeAliasDrafts({})
      return
    }
    try {
      const rows = await listAttributeAliases(token, {
        entityType: scope,
        limit: 300,
        search,
      })
      setAttributeAliases(rows || [])
      const drafts = {}
      for (const row of rows || []) {
        drafts[row.id] = row.canonical_value || ""
      }
      setAttributeAliasDrafts(drafts)
    } catch (e) {
      setError(String(e.message || e))
    }
  }

  async function loadWorkflowRules() {
    try {
      const row = await getWorkflowRules(token)
      setWorkflowRules(normalizeWorkflowRules(row.rules_json || {}))
    } catch (e) {
      setError(String(e.message || e))
    }
  }

  async function loadKpi() {
    try {
      const next = await getKpiOverview(token)
      setKpi(next)
    } catch (e) {
      setError(String(e.message || e))
    }
  }

  async function openMinioPreviewDialog() {
    try {
      setError("")
      setNotice("")
      setMinioPreviewLoading(true)
      const res = await previewMinioObjects(token, minio.max_objects || 200)
      const items = res.items || []
      setMinioPreviewItems(items)
      const initialSelection = {}
      for (const item of items) {
        const key = String(item.object_name || "")
        if (!key) continue
        initialSelection[key] = !item.is_duplicate
      }
      setMinioPreviewSelection(initialSelection)
      setMinioPreviewOpen(true)
    } catch (e) {
      setError(String(e.message || e))
    } finally {
      setMinioPreviewLoading(false)
    }
  }

  async function loadGraphInsights(limit = graphInsightsLimit) {
    try {
      const next = await getGraphInsights(token, { limit })
      setGraphInsights(next)
    } catch (e) {
      setError(String(e.message || e))
    }
  }

  async function loadGraphTrendInsights() {
    try {
      const next = await getGraphTrendInsights(token, {
        windowDays: trendWindowDays,
        compareDays: trendCompareDays,
        granularity: trendGranularity,
      })
      setGraphTrend(next)
    } catch (e) {
      setError(String(e.message || e))
    }
  }

  async function loadGraphDrilldown(metric, periodStart, periodEnd) {
    try {
      const next = await getGraphInsightDrilldown(token, {
        metric,
        periodStart,
        periodEnd,
        limit: 200,
        offset: 0,
      })
      setGraphDrilldown(next)
    } catch (e) {
      setError(String(e.message || e))
    }
  }

  async function loadGraphExplanation() {
    try {
      const next = await getGraphInsightExplanation(token, {
        windowDays: trendWindowDays,
        compareDays: trendCompareDays,
        granularity: trendGranularity,
        limit: graphInsightsLimit,
      })
      setGraphExplanation(next)
      if (next?.trend?.status === "ok") setGraphTrend(next.trend)
      if (next?.insights?.status === "ok") setGraphInsights(next.insights)
    } catch (e) {
      setError(String(e.message || e))
    }
  }

  async function runAdminGraphQuestion() {
    const question = String(adminGraphQuestion || "").trim()
    if (!question) {
      setAdminGraphQuestionError("Bitte eine Frage eingeben.")
      return
    }
    try {
      setAdminGraphQuestionLoading(true)
      setAdminGraphQuestionError("")
      const res = await askGraphQuestion(token, { question, maxRows: 200 })
      setAdminGraphQuestionResult(res)
    } catch (e) {
      setAdminGraphQuestionResult(null)
      setAdminGraphQuestionError(String(e.message || e))
    } finally {
      setAdminGraphQuestionLoading(false)
    }
  }

  function exportDrilldownCsv() {
    const rows = graphDrilldown?.items || []
    if (!rows.length) {
      setError("Keine Drilldown-Daten fuer CSV vorhanden.")
      return
    }
    const header = ["invoice_id", "invoice_number", "supplier_name", "invoice_date", "status", "gross_amount", "currency", "action_types"]
    const lines = [header.join(",")]
    for (const row of rows) {
      const values = [
        row.invoice_id,
        row.invoice_number,
        row.supplier_name,
        row.invoice_date,
        row.status,
        row.gross_amount,
        row.currency,
        Array.isArray(row.action_types) ? row.action_types.join("|") : "",
      ].map((v) => `"${String(v ?? "").replaceAll("\"", "\"\"")}"`)
      lines.push(values.join(","))
    }
    const csv = lines.join("\\n")
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = `graph-drilldown-${graphDrilldown?.metric || "metric"}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  useEffect(() => {
    loadUsers()
    loadProvidersConfig()
    loadMinioConnector()
    loadDocumentsList()
    loadInvoicesList()
    loadExtractionFields()
    loadGraphConfig()
    loadAttributeAliases("", "recipient")
    loadWorkflowRules()
    loadKpi()
    loadDeleteRequests()
    loadAuditEvents()
  }, [])

  useEffect(() => {
    loadDeleteRequests()
  }, [deleteRequestStatusFilter])

  useEffect(() => {
    return () => {
      if (pipelineProgressIntervalRef.current) {
        clearInterval(pipelineProgressIntervalRef.current)
        pipelineProgressIntervalRef.current = null
      }
    }
  }, [])

  const isAdmin = useMemo(() => (currentUser?.roles || []).includes("ADMIN"), [currentUser])
  const adminGraphHighlights = useMemo(
    () => extractGraphResultInvoiceKeys(adminGraphQuestionResult),
    [adminGraphQuestionResult],
  )
  const filteredAuditEvents = useMemo(() => {
    const byType = String(auditEventTypeFilter || "").trim().toLowerCase()
    const byActor = String(auditActorFilter || "").trim().toLowerCase()
    const byTargetType = String(auditTargetTypeFilter || "").trim().toLowerCase()
    return (auditEvents || []).filter((row) => {
      const eventType = String(row.event_type || "").toLowerCase()
      const actor = String(row.actor_user_id || "").toLowerCase()
      const targetType = String(row.target_type || "").toLowerCase()
      if (byType && !eventType.includes(byType)) return false
      if (byActor && !actor.includes(byActor)) return false
      if (byTargetType && !targetType.includes(byTargetType)) return false
      return true
    })
  }, [auditEvents, auditActorFilter, auditEventTypeFilter, auditTargetTypeFilter])

  return (
    <main className="app-layout">
      <header className="header">
        <h2>insAIghts Admin</h2>
        <div className="header-user">
          Angemeldet als <span>{currentUser?.username}</span>
          <button className="btn btn-outline-light btn-sm" onClick={onLogout}>Logout</button>
        </div>
      </header>
      {notice ? <p className="notice">{notice}</p> : null}
      {error ? <p className="error top-error">{error}</p> : null}

      {!isAdmin ? (
        <section className="card">
          <div className="card-body"><p>Kein Admin-Zugriff.</p></div>
        </section>
      ) : (
        <>
          <section className="card">
            <div className="card-body">
              <div className="admin-tabs">
                {ADMIN_TABS.map((tab) => (
                  <button
                    key={tab.id}
                    type="button"
                    className={`admin-tab ${adminTab === tab.id ? "active" : ""}`}
                    onClick={() => setAdminTab(tab.id)}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>
            </div>
          </section>

          {adminTab === "users" ? (
            <>
          <section className="card">
            <div className="card-header"><h3>Benutzer anlegen</h3></div>
            <div className="card-body">
            <form
              className="grid"
              onSubmit={async (e) => {
                e.preventDefault()
                try {
                  setError("")
                  setNotice("")
                  await createUser(token, {
                    username: form.username,
                    email: form.email,
                    password: form.password,
                    roles: form.roles.split(",").map((r) => r.trim()).filter(Boolean),
                  })
                  setForm({ username: "", email: "", password: "", roles: "AP_CLERK" })
                  await loadUsers()
                } catch (err) {
                  setError(String(err.message || err))
                }
              }}
            >
              <label>
                Username
                <input
                  className="input"
                  value={form.username}
                  onChange={(e) => setForm((f) => ({ ...f, username: e.target.value }))}
                  required
                />
              </label>
              <label>
                E-Mail
                <input
                  className="input"
                  type="email"
                  value={form.email}
                  onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
                  required
                />
              </label>
              <label>
                Passwort
                <input
                  className="input"
                  type="password"
                  value={form.password}
                  onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))}
                  required
                />
              </label>
              <label>
                Rollen (CSV)
                <input
                  className="input"
                  value={form.roles}
                  onChange={(e) => setForm((f) => ({ ...f, roles: e.target.value }))}
                  required
                />
              </label>
              <button className="btn btn-primary" type="submit">Benutzer speichern</button>
            </form>
            </div>
          </section>
            </>
          ) : null}

          {adminTab === "providers" ? (
          <section className="card">
            <div className="card-header"><h3>Provider (Mistral)</h3></div>
            <div className="card-body">
              <form
                className="grid"
                onSubmit={async (e) => {
                  e.preventDefault()
                  try {
                    setError("")
                    setNotice("")
                    await updateProvider(token, "mistral", {
                      is_enabled: providers.mistral_enabled,
                      key_value: providers.mistral_key ? providers.mistral_key : undefined,
                    })
                    setProviders((p) => ({ ...p, mistral_key: "" }))
                    await loadProvidersConfig()
                    setNotice("Mistral Provider gespeichert")
                  } catch (err) {
                    setError(String(err.message || err))
                  }
                }}
              >
                <label>
                  Mistral aktiv
                  <select
                    className="input"
                    value={providers.mistral_enabled ? "true" : "false"}
                    onChange={(e) => setProviders((p) => ({ ...p, mistral_enabled: e.target.value === "true" }))}
                  >
                    <option value="false">Nein</option>
                    <option value="true">Ja</option>
                  </select>
                </label>
                <label>
                  Mistral API Key
                  <input
                    className="input"
                    type="password"
                    value={providers.mistral_key}
                    onChange={(e) => setProviders((p) => ({ ...p, mistral_key: e.target.value }))}
                    placeholder={providers.mistral_key_present ? "Key vorhanden (nur bei Aenderung neu setzen)" : "Mistral API Key"}
                  />
                </label>
                <div className="actions-row">
                  <button className="btn btn-primary" type="submit">Provider speichern</button>
                  <span className="muted-inline">Key vorhanden: {providers.mistral_key_present ? "ja" : "nein"}</span>
                </div>
              </form>
            </div>
          </section>
          ) : null}

          {adminTab === "model" ? (
          <section className="card">
            <div className="card-header row">
              <h3>Extraktionsfelder (LLM)</h3>
              <button className="btn btn-outline" onClick={loadExtractionFields}>Neu laden</button>
            </div>
            <div className="card-body">
              <form
                className="grid"
                onSubmit={async (e) => {
                  e.preventDefault()
                  try {
                    setError("")
                    setNotice("")
                    await upsertExtractionField(token, {
                      entity_name: fieldForm.entity_name,
                      scope: fieldForm.scope,
                      field_name: fieldForm.field_name.trim(),
                      description: fieldForm.description.trim(),
                      data_type: fieldForm.data_type,
                      is_required: fieldForm.is_required,
                      is_enabled: fieldForm.is_enabled,
                      sort_order: Number(fieldForm.sort_order || 0),
                    })
                    setFieldForm((f) => ({ ...f, field_name: "", description: "", sort_order: 100 }))
                    await loadExtractionFields()
                    setNotice("Extraktionsfeld gespeichert")
                  } catch (err) {
                    setError(String(err.message || err))
                  }
                }}
              >
                <label>
                  Scope
                  <select className="input" value={fieldForm.scope} onChange={(e) => setFieldForm((f) => ({ ...f, scope: e.target.value }))}>
                    <option value="header">header</option>
                    <option value="line_item">line_item</option>
                  </select>
                </label>
                <label>
                  Feldname
                  <input className="input" value={fieldForm.field_name} onChange={(e) => setFieldForm((f) => ({ ...f, field_name: e.target.value }))} required />
                </label>
                <label>
                  Beschreibung (Prompt)
                  <input className="input" value={fieldForm.description} onChange={(e) => setFieldForm((f) => ({ ...f, description: e.target.value }))} required />
                </label>
                <label>
                  Datentyp
                  <select className="input" value={fieldForm.data_type} onChange={(e) => setFieldForm((f) => ({ ...f, data_type: e.target.value }))}>
                    <option value="string">string</option>
                    <option value="number">number</option>
                    <option value="integer">integer</option>
                    <option value="date">date</option>
                    <option value="boolean">boolean</option>
                  </select>
                </label>
                <label>
                  Sortierung
                  <input className="input" type="number" value={fieldForm.sort_order} onChange={(e) => setFieldForm((f) => ({ ...f, sort_order: Number(e.target.value || 0) }))} />
                </label>
                <label>
                  Pflichtfeld
                  <select className="input" value={fieldForm.is_required ? "true" : "false"} onChange={(e) => setFieldForm((f) => ({ ...f, is_required: e.target.value === "true" }))}>
                    <option value="false">Nein</option>
                    <option value="true">Ja</option>
                  </select>
                </label>
                <label>
                  Aktiv
                  <select className="input" value={fieldForm.is_enabled ? "true" : "false"} onChange={(e) => setFieldForm((f) => ({ ...f, is_enabled: e.target.value === "true" }))}>
                    <option value="true">Ja</option>
                    <option value="false">Nein</option>
                  </select>
                </label>
                <button className="btn btn-primary" type="submit">Feld speichern</button>
              </form>

              <table className="table">
                <thead>
                  <tr>
                    <th>Scope</th>
                    <th>Feld</th>
                    <th>Beschreibung</th>
                    <th>Typ</th>
                    <th>Pflicht</th>
                    <th>Aktiv</th>
                    <th>Sort</th>
                    <th>Status</th>
                    <th>Aktion</th>
                  </tr>
                </thead>
                <tbody>
                  {extractionFields.map((f) => {
                    const key = `${f.scope}:${f.field_name}`
                    const draft = extractionFieldDrafts[key] || {
                      description: f.description || "",
                      data_type: f.data_type || "string",
                      is_required: !!f.is_required,
                      is_enabled: !!f.is_enabled,
                      sort_order: Number(f.sort_order || 0),
                    }
                    const isDirty =
                      (draft.description || "") !== (f.description || "") ||
                      (draft.data_type || "string") !== (f.data_type || "string") ||
                      !!draft.is_required !== !!f.is_required ||
                      !!draft.is_enabled !== !!f.is_enabled ||
                      Number(draft.sort_order || 0) !== Number(f.sort_order || 0)
                    return (
                    <tr key={key}>
                      <td>{f.scope}</td>
                      <td className="mono">{f.field_name}</td>
                      <td>
                        <input
                          className="input"
                          value={draft.description}
                          onChange={(e) => setExtractionFieldDrafts((all) => ({ ...all, [key]: { ...draft, description: e.target.value } }))}
                        />
                      </td>
                      <td>
                        <select
                          className="input"
                          value={draft.data_type}
                          onChange={(e) => setExtractionFieldDrafts((all) => ({ ...all, [key]: { ...draft, data_type: e.target.value } }))}
                        >
                          <option value="string">string</option>
                          <option value="number">number</option>
                          <option value="integer">integer</option>
                          <option value="date">date</option>
                          <option value="boolean">boolean</option>
                        </select>
                      </td>
                      <td>
                        <select
                          className="input"
                          value={draft.is_required ? "true" : "false"}
                          onChange={(e) => setExtractionFieldDrafts((all) => ({ ...all, [key]: { ...draft, is_required: e.target.value === "true" } }))}
                        >
                          <option value="false">nein</option>
                          <option value="true">ja</option>
                        </select>
                      </td>
                      <td>
                        <select
                          className="input"
                          value={draft.is_enabled ? "true" : "false"}
                          onChange={(e) => setExtractionFieldDrafts((all) => ({ ...all, [key]: { ...draft, is_enabled: e.target.value === "true" } }))}
                        >
                          <option value="true">ja</option>
                          <option value="false">nein</option>
                        </select>
                      </td>
                      <td>
                        <input
                          className="input"
                          type="number"
                          value={draft.sort_order}
                          onChange={(e) => setExtractionFieldDrafts((all) => ({ ...all, [key]: { ...draft, sort_order: Number(e.target.value || 0) } }))}
                        />
                      </td>
                      <td>
                        {isDirty ? <span className="notice">ungespeichert</span> : <span className="muted-inline">gespeichert</span>}
                      </td>
                      <td>
                        <button
                          className="btn btn-outline"
                          type="button"
                          disabled={!isDirty}
                          onClick={async () => {
                            try {
                              setError("")
                              setNotice("")
                              await upsertExtractionField(token, {
                                entity_name: f.entity_name,
                                scope: f.scope,
                                field_name: f.field_name,
                                description: draft.description,
                                data_type: draft.data_type,
                                is_required: !!draft.is_required,
                                is_enabled: !!draft.is_enabled,
                                sort_order: Number(draft.sort_order || 0),
                              })
                              await loadExtractionFields()
                              setNotice(`Feld ${f.field_name} aktualisiert`)
                            } catch (err) {
                              setError(String(err.message || err))
                            }
                          }}
                        >
                          Speichern
                        </button>
                      </td>
                    </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </section>
          ) : null}

          {adminTab === "kpi" ? (
          <section className="card">
            <div className="card-header row">
              <h3>KPI Uebersicht</h3>
              <button className="btn btn-outline" onClick={loadKpi}>Neu laden</button>
            </div>
            <div className="card-body">
              {!kpi ? (
                <p className="muted">Keine KPI-Daten geladen.</p>
              ) : (
                <>
                  <div className="kpi-grid">
                    <div className="kpi-tile"><span>Dokumente</span><strong>{kpi?.totals?.documents ?? 0}</strong></div>
                    <div className="kpi-tile"><span>Rechnungen</span><strong>{kpi?.totals?.invoices ?? 0}</strong></div>
                    <div className="kpi-tile"><span>Offene Cases</span><strong>{kpi?.totals?.open_cases ?? 0}</strong></div>
                    <div className="kpi-tile"><span>Freigaben 24h</span><strong>{kpi?.throughput?.approved_last_24h ?? 0}</strong></div>
                    <div className="kpi-tile"><span>Avg. Min bis Approve</span><strong>{kpi?.throughput?.avg_minutes_to_approve ?? "-"}</strong></div>
                    <div className="kpi-tile"><span>Touchless Rate</span><strong>{kpi?.throughput?.touchless_rate != null ? `${(Number(kpi?.throughput?.touchless_rate || 0) * 100).toFixed(1)}%` : "-"}</strong></div>
                  </div>
                  <div className="kpi-subgrid">
                    <div>
                      <div className="invoice-label">RECHNUNGSSTATUS</div>
                      <ul className="simple-list">
                        {Object.entries(kpi?.invoices_by_status || {}).map(([key, value]) => (
                          <li key={key}><span>{key}</span><strong>{value}</strong></li>
                        ))}
                      </ul>
                    </div>
                    <div>
                      <div className="invoice-label">CASE STATUS</div>
                      <ul className="simple-list">
                        {Object.entries(kpi?.cases_by_status || {}).map(([key, value]) => (
                          <li key={key}><span>{key}</span><strong>{value}</strong></li>
                        ))}
                      </ul>
                    </div>
                    <div>
                      <div className="invoice-label">AKTIONEN NACH TYP</div>
                      <ul className="simple-list">
                        {Object.entries(kpi?.actions_by_type || {}).map(([key, value]) => (
                          <li key={key}><span>{key}</span><strong>{value}</strong></li>
                        ))}
                      </ul>
                    </div>
                  </div>
                  <div className="kpi-subgrid">
                    <div>
                      <div className="invoice-label">TREND LETZTE 14 TAGE</div>
                      <table className="table">
                        <thead>
                          <tr>
                            <th>Tag</th>
                            <th>Dokumente</th>
                            <th>Rechnungen</th>
                            <th>Approvals</th>
                          </tr>
                        </thead>
                        <tbody>
                          {(kpi?.trend_last_14d || []).map((row) => (
                            <tr key={row.day}>
                              <td>{row.day}</td>
                              <td>
                                <div>{row.documents_ingested ?? 0}</div>
                                <div className="mini-bar"><span style={{ width: `${Math.min(100, Number(row.documents_ingested || 0) * 10)}%` }} /></div>
                              </td>
                              <td>
                                <div>{row.invoices_created ?? 0}</div>
                                <div className="mini-bar"><span style={{ width: `${Math.min(100, Number(row.invoices_created || 0) * 10)}%` }} /></div>
                              </td>
                              <td>
                                <div>{row.approvals ?? 0}</div>
                                <div className="mini-bar"><span style={{ width: `${Math.min(100, Number(row.approvals || 0) * 10)}%` }} /></div>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    <div>
                      <div className="invoice-label">LIEFERANTEN AUSNAHMEQUOTE</div>
                      <table className="table">
                        <thead>
                          <tr>
                            <th>Lieferant</th>
                            <th>Rechnungen</th>
                            <th>Ausnahmen</th>
                            <th>Quote</th>
                          </tr>
                        </thead>
                        <tbody>
                          {(kpi?.supplier_quality?.top_exception_rate || []).length === 0 ? (
                            <tr><td colSpan={4}>Keine Daten.</td></tr>
                          ) : (
                            (kpi?.supplier_quality?.top_exception_rate || []).map((row) => (
                              <tr key={`${row.supplier_name}:${row.invoice_count}`}>
                                <td>{row.supplier_name}</td>
                                <td>{row.invoice_count}</td>
                                <td>{row.exception_count}</td>
                                <td>
                                  <div>{(Number(row.exception_rate || 0) * 100).toFixed(1)}%</div>
                                  <div className="mini-bar"><span style={{ width: `${Math.min(100, Number(row.exception_rate || 0) * 100)}%` }} /></div>
                                </td>
                              </tr>
                            ))
                          )}
                        </tbody>
                      </table>
                    </div>
                  </div>
                  <div className="kpi-subgrid">
                    <div>
                      <div className="invoice-label">TOP LIEFERANTEN (VOLUMEN)</div>
                      <table className="table">
                        <thead>
                          <tr>
                            <th>Lieferant</th>
                            <th>Rechnungen</th>
                          </tr>
                        </thead>
                        <tbody>
                          {(kpi?.supplier_quality?.top_by_volume || []).length === 0 ? (
                            <tr><td colSpan={2}>Keine Daten.</td></tr>
                          ) : (
                            (kpi?.supplier_quality?.top_by_volume || []).map((row) => (
                              <tr key={`${row.supplier_name}:${row.invoice_count}`}>
                                <td>{row.supplier_name}</td>
                                <td>{row.invoice_count}</td>
                              </tr>
                            ))
                          )}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </>
              )}
            </div>
          </section>
          ) : null}

          {adminTab === "audit" ? (
          <section className="card">
            <div className="card-header row">
              <h3>Audit Events</h3>
              <div className="actions-row">
                <input
                  className="input"
                  type="number"
                  min={20}
                  max={2000}
                  value={auditLimit}
                  onChange={(e) => setAuditLimit(Math.max(20, Math.min(2000, Number(e.target.value || 200))))}
                />
                <button
                  className="btn btn-outline"
                  onClick={async () => {
                    setError("")
                    await loadAuditEvents(auditLimit || 200)
                  }}
                >
                  Neu laden
                </button>
              </div>
            </div>
            <div className="card-body">
              <div className="grid">
                <label>
                  Filter Event-Typ
                  <input
                    className="input"
                    value={auditEventTypeFilter}
                    onChange={(e) => setAuditEventTypeFilter(e.target.value)}
                    placeholder="z. B. admin.pipeline_run"
                  />
                </label>
                <label>
                  Filter Actor User ID
                  <input
                    className="input"
                    value={auditActorFilter}
                    onChange={(e) => setAuditActorFilter(e.target.value)}
                    placeholder="UUID (Teilstring)"
                  />
                </label>
                <label>
                  Filter Target Type
                  <input
                    className="input"
                    value={auditTargetTypeFilter}
                    onChange={(e) => setAuditTargetTypeFilter(e.target.value)}
                    placeholder="invoice, documents, ..."
                  />
                </label>
              </div>
              <table className="table">
                <thead>
                  <tr>
                    <th>Zeit</th>
                    <th>Event</th>
                    <th>Actor</th>
                    <th>Target</th>
                    <th>Metadata</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredAuditEvents.length === 0 ? (
                    <tr><td colSpan={5}>Keine Audit-Events gefunden.</td></tr>
                  ) : (
                    filteredAuditEvents.map((row) => (
                      <tr key={row.id}>
                        <td>{row.created_at || "-"}</td>
                        <td className="mono">{row.event_type || "-"}</td>
                        <td className="mono">{row.actor_user_id || "-"}</td>
                        <td>
                          <div className="mono">{row.target_type || "-"}</div>
                          <div className="mono">{row.target_id || "-"}</div>
                        </td>
                        <td>
                          <pre className="graph-node-json">{JSON.stringify(row.metadata_json || {}, null, 2)}</pre>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </section>
          ) : null}

          {adminTab === "model" ? (
          <section className="card">
            <div className="card-header row">
              <h3>Workflow-Regeln (Approval)</h3>
              <button className="btn btn-outline" onClick={loadWorkflowRules}>Neu laden</button>
            </div>
            <div className="card-body">
              <p className="muted">
                Regeln steuern serverseitig die Freigabepruefung bei <span className="mono">approve</span>
                (Betragsgrenzen, Rollen, optional 4-Augen).
              </p>
              <div className="grid">
                <label>
                  4-Augen-Prinzip
                  <select
                    className="input"
                    value={workflowRules.approval.four_eyes ? "true" : "false"}
                    onChange={(e) =>
                      setWorkflowRules((w) => ({
                        ...w,
                        approval: { ...w.approval, four_eyes: e.target.value === "true" },
                      }))
                    }
                  >
                    <option value="false">nein</option>
                    <option value="true">ja</option>
                  </select>
                </label>
                <label>
                  Nur VALIDATED erlauben
                  <select
                    className="input"
                    value={workflowRules.approval.require_validated_status ? "true" : "false"}
                    onChange={(e) =>
                      setWorkflowRules((w) => ({
                        ...w,
                        approval: { ...w.approval, require_validated_status: e.target.value === "true" },
                      }))
                    }
                  >
                    <option value="false">nein</option>
                    <option value="true">ja</option>
                  </select>
                </label>
              </div>

              <div className="invoice-divider" />
              <div className="row">
                <div className="invoice-label">BETRAGSGRENZEN</div>
                <button
                  className="btn btn-outline btn-sm"
                  type="button"
                  onClick={() =>
                    setWorkflowRules((w) => ({
                      ...w,
                      approval: {
                        ...w.approval,
                        amount_limits: [...(w.approval.amount_limits || []), { max_amount: "", allowed_roles: ["ADMIN"] }],
                      },
                    }))
                  }
                >
                  Zeile hinzufuegen
                </button>
              </div>
              <table className="table">
                <thead>
                  <tr>
                    <th>Max Amount (leer = unbegrenzt)</th>
                    <th>Rollen</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {(workflowRules.approval.amount_limits || []).map((row, idx) => (
                    <tr key={`limit-${idx}`}>
                      <td>
                        <input
                          className="input"
                          value={row.max_amount}
                          onChange={(e) =>
                            setWorkflowRules((w) => {
                              const next = [...(w.approval.amount_limits || [])]
                              next[idx] = { ...next[idx], max_amount: e.target.value }
                              return { ...w, approval: { ...w.approval, amount_limits: next } }
                            })
                          }
                          placeholder="z.B. 1000"
                        />
                      </td>
                      <td>
                        <select
                          className="input"
                          multiple
                          value={row.allowed_roles || []}
                          onChange={(e) =>
                            setWorkflowRules((w) => {
                              const next = [...(w.approval.amount_limits || [])]
                              next[idx] = {
                                ...next[idx],
                                allowed_roles: Array.from(e.target.selectedOptions).map((o) => o.value),
                              }
                              return { ...w, approval: { ...w.approval, amount_limits: next } }
                            })
                          }
                        >
                          {APPROVAL_ROLE_OPTIONS.map((role) => (
                            <option key={role} value={role}>{role}</option>
                          ))}
                        </select>
                      </td>
                      <td>
                        <button
                          className="btn btn-outline btn-sm"
                          type="button"
                          onClick={() =>
                            setWorkflowRules((w) => ({
                              ...w,
                              approval: {
                                ...w.approval,
                                amount_limits: (w.approval.amount_limits || []).filter((_, i) => i !== idx),
                              },
                            }))
                          }
                        >
                          Entfernen
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>

              <div className="invoice-divider" />
              <div className="row">
                <div className="invoice-label">LIEFERANTEN-OVERRIDES</div>
                <button
                  className="btn btn-outline btn-sm"
                  type="button"
                  onClick={() =>
                    setWorkflowRules((w) => ({
                      ...w,
                      approval: {
                        ...w.approval,
                        supplier_role_overrides: [...(w.approval.supplier_role_overrides || []), { supplier_name: "", allowed_roles: ["ADMIN"] }],
                      },
                    }))
                  }
                >
                  Zeile hinzufuegen
                </button>
              </div>
              <table className="table">
                <thead>
                  <tr>
                    <th>Lieferant</th>
                    <th>Rollen</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {(workflowRules.approval.supplier_role_overrides || []).map((row, idx) => (
                    <tr key={`override-${idx}`}>
                      <td>
                        <input
                          className="input"
                          value={row.supplier_name || ""}
                          onChange={(e) =>
                            setWorkflowRules((w) => {
                              const next = [...(w.approval.supplier_role_overrides || [])]
                              next[idx] = { ...next[idx], supplier_name: e.target.value }
                              return { ...w, approval: { ...w.approval, supplier_role_overrides: next } }
                            })
                          }
                          placeholder="z.B. Telekom Deutschland GmbH"
                        />
                      </td>
                      <td>
                        <select
                          className="input"
                          multiple
                          value={row.allowed_roles || []}
                          onChange={(e) =>
                            setWorkflowRules((w) => {
                              const next = [...(w.approval.supplier_role_overrides || [])]
                              next[idx] = {
                                ...next[idx],
                                allowed_roles: Array.from(e.target.selectedOptions).map((o) => o.value),
                              }
                              return { ...w, approval: { ...w.approval, supplier_role_overrides: next } }
                            })
                          }
                        >
                          {APPROVAL_ROLE_OPTIONS.map((role) => (
                            <option key={role} value={role}>{role}</option>
                          ))}
                        </select>
                      </td>
                      <td>
                        <button
                          className="btn btn-outline btn-sm"
                          type="button"
                          onClick={() =>
                            setWorkflowRules((w) => ({
                              ...w,
                              approval: {
                                ...w.approval,
                                supplier_role_overrides: (w.approval.supplier_role_overrides || []).filter((_, i) => i !== idx),
                              },
                            }))
                          }
                        >
                          Entfernen
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="actions-row" style={{ marginTop: "0.7rem" }}>
                <button
                  className="btn btn-primary"
                  type="button"
                  onClick={async () => {
                    try {
                      setError("")
                      setNotice("")
                      await updateWorkflowRules(token, toWorkflowRulesPayload(workflowRules))
                      await loadWorkflowRules()
                      setNotice("Workflow-Regeln gespeichert")
                    } catch (err) {
                      setError(String(err.message || err))
                    }
                  }}
                >
                  Regeln speichern
                </button>
              </div>
            </div>
          </section>
          ) : null}

          {adminTab === "pipeline" ? (
          <section className="card">
            <div className="card-header"><h3>MinIO Connector</h3></div>
            <div className="card-body">
              <form
                className="grid"
                onSubmit={async (e) => {
                  e.preventDefault()
                  try {
                    setError("")
                    setNotice("")
                    await updateConnector(token, "minio", {
                      enabled: minio.enabled,
                      config_json: {
                        endpoint: minio.endpoint,
                        access_key: minio.access_key,
                        secret_key: minio.secret_key,
                        bucket: minio.bucket,
                        prefix: minio.prefix,
                        secure: minio.secure,
                      },
                    })
                    setNotice("MinIO-Konfiguration gespeichert")
                  } catch (err) {
                    setError(String(err.message || err))
                  }
                }}
              >
                <label>
                  Aktiv
                  <select
                    className="input"
                    value={minio.enabled ? "true" : "false"}
                    onChange={(e) => setMinio((m) => ({ ...m, enabled: e.target.value === "true" }))}
                  >
                    <option value="false">Nein</option>
                    <option value="true">Ja</option>
                  </select>
                </label>
                <label>
                  Endpoint
                  <input className="input" value={minio.endpoint} onChange={(e) => setMinio((m) => ({ ...m, endpoint: e.target.value }))} required />
                </label>
                <label>
                  Access Key
                  <input className="input" value={minio.access_key} onChange={(e) => setMinio((m) => ({ ...m, access_key: e.target.value }))} required />
                </label>
                <label>
                  Secret Key
                  <input className="input" type="password" value={minio.secret_key} onChange={(e) => setMinio((m) => ({ ...m, secret_key: e.target.value }))} required />
                </label>
                <label>
                  Bucket
                  <input className="input" value={minio.bucket} onChange={(e) => setMinio((m) => ({ ...m, bucket: e.target.value }))} required />
                </label>
                <label>
                  Prefix (optional)
                  <input className="input" value={minio.prefix} onChange={(e) => setMinio((m) => ({ ...m, prefix: e.target.value }))} />
                </label>
                <label>
                  Secure
                  <select
                    className="input"
                    value={minio.secure ? "true" : "false"}
                    onChange={(e) => setMinio((m) => ({ ...m, secure: e.target.value === "true" }))}
                  >
                    <option value="true">true</option>
                    <option value="false">false</option>
                  </select>
                </label>
                <label>
                  Max Objects Pull
                  <input
                    className="input"
                    type="number"
                    min="1"
                    max="5000"
                    value={minio.max_objects}
                    onChange={(e) => setMinio((m) => ({ ...m, max_objects: Number(e.target.value || 1) }))}
                  />
                </label>
                <label>
                  Max Documents Extract
                  <input
                    className="input"
                    type="number"
                    min="1"
                    max="500"
                    value={minio.max_extract}
                    onChange={(e) => setMinio((m) => ({ ...m, max_extract: Number(e.target.value || 1) }))}
                  />
                </label>
                <label>
                  Max Documents Map
                  <input
                    className="input"
                    type="number"
                    min="1"
                    max="500"
                    value={minio.max_map}
                    onChange={(e) => setMinio((m) => ({ ...m, max_map: Number(e.target.value || 1) }))}
                  />
                </label>
                <label>
                  Max Invoices Validate
                  <input
                    className="input"
                    type="number"
                    min="1"
                    max="500"
                    value={minio.max_validate}
                    onChange={(e) => setMinio((m) => ({ ...m, max_validate: Number(e.target.value || 1) }))}
                  />
                </label>
                <div className="actions-row">
                  <button className="btn btn-primary" type="submit">Speichern</button>
                  <button
                    className="btn btn-primary"
                    type="button"
                    disabled={pipelineRunning}
                    onClick={async () => {
                      let pollBusy = false
                      try {
                        setPipelineRunning(true)
                        setError("")
                        setNotice("")
                        const runId = globalThis.crypto?.randomUUID?.() || `run-${Date.now()}`
                        setPipelineProgressText("Status: Pipeline gestartet...")
                        if (pipelineProgressIntervalRef.current) {
                          clearInterval(pipelineProgressIntervalRef.current)
                          pipelineProgressIntervalRef.current = null
                        }
                        pipelineProgressIntervalRef.current = setInterval(async () => {
                          if (pollBusy) return
                          pollBusy = true
                          try {
                            await refreshPipelineProgress(runId)
                          } catch {
                            // keep run resilient even if progress polling fails temporarily
                          } finally {
                            pollBusy = false
                          }
                        }, 1500)
                        const res = await runPipeline(token, {
                          client_run_id: runId,
                          max_objects: minio.max_objects || 200,
                          max_extract: minio.max_extract || 20,
                          max_map: minio.max_map || 20,
                          max_validate: minio.max_validate || 50,
                          sync_limit: graphSyncLimit || 200,
                        })
                        await refreshPipelineProgress(runId)
                        await Promise.all([loadDocumentsList(), loadInvoicesList(), loadKpi(), loadDeleteRequests()])
                        const s = res.summary || {}
                        setNotice(
                          `One-Click Run: Pull ${s.pull_created || 0}/${(s.pull_created || 0) + (s.pull_skipped || 0)}, Extract ${s.extract_ok || 0}, Map ${s.map_ok || 0}, Validate ${s.validate_ok || 0}, Graph ${s.graph_synced || 0}`
                        )
                        setPipelineProgressText("Status: Pipeline abgeschlossen.")
                      } catch (err) {
                        setError(String(err.message || err))
                        setPipelineProgressText(`Status: Fehler - ${String(err.message || err)}`)
                      } finally {
                        if (pipelineProgressIntervalRef.current) {
                          clearInterval(pipelineProgressIntervalRef.current)
                          pipelineProgressIntervalRef.current = null
                        }
                        setPipelineRunning(false)
                      }
                    }}
                  >
                    {pipelineRunning ? "Pipeline laeuft..." : "One-Click Pipeline Run"}
                  </button>
                  <button
                    className="btn btn-outline"
                    type="button"
                    onClick={async () => {
                      try {
                        setError("")
                        setNotice("")
                        await testConnector(token, "minio")
                        setNotice("MinIO-Test erfolgreich")
                      } catch (err) {
                        setError(String(err.message || err))
                      }
                    }}
                  >
                    Testen
                  </button>
                  <button
                    className="btn btn-outline"
                    type="button"
                    disabled={minioPreviewLoading}
                    onClick={openMinioPreviewDialog}
                  >
                    Dateien auswaehlen & Pull
                  </button>
                  {pipelineProgressText ? <span className="muted-inline">{pipelineProgressText}</span> : null}
                  <button
                    className="btn btn-outline"
                    type="button"
                    onClick={async () => {
                      try {
                        setError("")
                        setNotice("")
                        const res = await extractDocuments(token, minio.max_extract || 20)
                        setNotice(`Extract: ${res.extracted} EXTRACTED, ${res.failed} ERROR`)
                        await loadDocumentsList()
                      } catch (err) {
                        setError(String(err.message || err))
                      }
                    }}
                  >
                    OCR/Extract
                  </button>
                  <button
                    className="btn btn-outline"
                    type="button"
                    onClick={async () => {
                      try {
                        setError("")
                        setNotice("")
                        const res = await mapInvoices(token, minio.max_map || 20)
                        setNotice(`Map: ${res.mapped} MAPPED, ${res.skipped} SKIPPED, ${res.failed} ERROR`)
                        await loadDocumentsList()
                        await loadInvoicesList()
                      } catch (err) {
                        setError(String(err.message || err))
                      }
                    }}
                  >
                    Invoice Mapping
                  </button>
                  <button
                    className="btn btn-outline"
                    type="button"
                    onClick={async () => {
                      try {
                        setError("")
                        setNotice("")
                        const res = await validateInvoices(token, minio.max_validate || 50)
                        setNotice(`Validate: ${res.validated} VALIDATED, ${res.needs_review} NEEDS_REVIEW, ${res.failed} ERROR`)
                        await loadInvoicesList()
                        await loadDocumentsList()
                      } catch (err) {
                        setError(String(err.message || err))
                      }
                    }}
                  >
                    Invoice Validation
                  </button>
                </div>
              </form>
            </div>
          </section>
          ) : null}

          {adminTab === "graph" ? (
          <section className="card">
            <div className="card-header"><h3>Graph Sync (Neo4j)</h3></div>
            <div className="card-body">
              <div className="invoice-label">DATENEBENE FELDER (KONFIGURIERBAR)</div>
              <p className="muted">
                Diese Felder verbinden Rechnungen in der Datenebene ueber gemeinsame Werte.
                Nach Aenderung bitte "Sync alle Rechnungen" ausfuehren.
              </p>
              <div className="graph-fields-grid">
                {graphFieldOptions.map((fieldName) => {
                  const checked = selectedGraphFields.includes(fieldName)
                  return (
                    <label key={fieldName} className="graph-field-item">
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={(e) => {
                          setSelectedGraphFields((current) => {
                            if (e.target.checked) return Array.from(new Set([...current, fieldName]))
                            return current.filter((f) => f !== fieldName)
                          })
                        }}
                      />
                      <span className="mono">{fieldName}</span>
                    </label>
                  )
                })}
              </div>
              <div className="actions-row" style={{ marginBottom: "0.8rem" }}>
                <button
                  className="btn btn-outline"
                  type="button"
                  onClick={async () => {
                    try {
                      setError("")
                      setNotice("")
                      await updateGraphConfig(token, selectedGraphFields)
                      await loadGraphConfig()
                      setNotice(`Graph-Felder gespeichert (${selectedGraphFields.length})`)
                    } catch (err) {
                      setError(String(err.message || err))
                    }
                  }}
                >
                  Graph-Felder speichern
                </button>
                <button className="btn btn-outline" type="button" onClick={loadGraphConfig}>Neu laden</button>
              </div>

              <div className="invoice-divider" />
              <div className="row">
                <div className="invoice-label">ATTRIBUTE ALIAS REVIEW</div>
                <div className="actions-row">
                  <input
                    className="input"
                    value={selectedAliasEntityType}
                    onChange={(e) => setSelectedAliasEntityType(e.target.value)}
                    list="alias-entity-type-options"
                    placeholder="Attribut (entity_type), z.B. empfaenger"
                  />
                  <datalist id="alias-entity-type-options">
                    {graphFieldOptions.map((fieldName) => (
                      <option key={fieldName} value={fieldName} />
                    ))}
                  </datalist>
                  <input
                    className="input"
                    value={attributeAliasSearch}
                    onChange={(e) => setAttributeAliasSearch(e.target.value)}
                    placeholder="Suche Alias..."
                  />
                  <button className="btn btn-outline" type="button" onClick={() => loadAttributeAliases(attributeAliasSearch, selectedAliasEntityType)}>
                    Suchen
                  </button>
                  <button className="btn btn-outline" type="button" onClick={() => { setAttributeAliasSearch(""); loadAttributeAliases("", selectedAliasEntityType) }}>
                    Reset
                  </button>
                </div>
              </div>
              <div className="alias-create-grid">
                <input
                  className="input"
                  value={newAliasRaw}
                  onChange={(e) => setNewAliasRaw(e.target.value)}
                  placeholder="Raw-Wert"
                />
                <input
                  className="input"
                  value={newAliasCanonical}
                  onChange={(e) => setNewAliasCanonical(e.target.value)}
                  placeholder="Canonical-Wert"
                />
                <button
                  className="btn btn-outline"
                  type="button"
                  onClick={async () => {
                    try {
                      setError("")
                      setNotice("")
                      if (!String(selectedAliasEntityType || "").trim()) {
                        throw new Error("Bitte zuerst ein Attribut (entity_type) angeben")
                      }
                      await createAttributeAlias(token, {
                        entityType: selectedAliasEntityType,
                        rawValue: newAliasRaw,
                        canonicalValue: newAliasCanonical,
                      })
                      setNewAliasRaw("")
                      setNewAliasCanonical("")
                      await loadAttributeAliases(attributeAliasSearch, selectedAliasEntityType)
                      setNotice("Alias angelegt")
                    } catch (err) {
                      setError(String(err.message || err))
                    }
                  }}
                >
                  Alias hinzufuegen
                </button>
              </div>
              <table className="table">
                <thead>
                  <tr>
                    <th>ATTRIBUT</th>
                    <th>RAW</th>
                    <th>NORMALIZED</th>
                    <th>CANONICAL</th>
                    <th>METHOD</th>
                    <th>CONF</th>
                    <th>AKTION</th>
                  </tr>
                </thead>
                <tbody>
                  {attributeAliases.length === 0 ? (
                    <tr><td colSpan={7}>Keine Alias-Daten gefunden.</td></tr>
                  ) : (
                    attributeAliases.map((row) => {
                      const draft = attributeAliasDrafts[row.id] ?? row.canonical_value ?? ""
                      const dirty = (draft || "").trim() !== (row.canonical_value || "").trim()
                      return (
                        <tr key={row.id}>
                          <td className="mono">{row.entity_type || "-"}</td>
                          <td>{row.raw_value || "-"}</td>
                          <td className="mono">{row.normalized_value || "-"}</td>
                          <td>
                            <input
                              className="input"
                              value={draft}
                              onChange={(e) => setAttributeAliasDrafts((all) => ({ ...all, [row.id]: e.target.value }))}
                            />
                          </td>
                          <td>{row.match_method || "-"}</td>
                          <td>{row.confidence ?? "-"}</td>
                          <td>
                            <button
                              className="btn btn-outline btn-sm"
                              type="button"
                              disabled={!dirty}
                              onClick={async () => {
                                try {
                                  setError("")
                                  setNotice("")
                                  await updateAttributeAlias(token, row.id, draft)
                                  await loadAttributeAliases(attributeAliasSearch, selectedAliasEntityType)
                                  setNotice(`Alias aktualisiert: ${row.raw_value}`)
                                } catch (err) {
                                  setError(String(err.message || err))
                                }
                              }}
                            >
                              Speichern
                            </button>
                          </td>
                        </tr>
                      )
                    })
                  )}
                </tbody>
              </table>

              <div className="invoice-divider" />
              <div className="actions-row">
                <label>
                  Max Invoices
                  <input
                    className="input"
                    type="number"
                    min="1"
                    max="5000"
                    value={graphSyncLimit}
                    onChange={(e) => setGraphSyncLimit(Number(e.target.value || 1))}
                  />
                </label>
                <button
                  className="btn btn-primary"
                  type="button"
                  onClick={async () => {
                    try {
                      setError("")
                      setNotice("")
                      const res = await syncInvoicesGraphBulk(token, graphSyncLimit || 200)
                      setNotice(`Graph sync: ${res.synced} synchronisiert, ${res.failed} Fehler`)
                    } catch (err) {
                      setError(String(err.message || err))
                    }
                  }}
                >
                  Sync alle Rechnungen
                </button>
                <label>
                  Max Nodes
                  <input
                    className="input"
                    type="number"
                    min="10"
                    max="5000"
                    value={globalGraphMaxNodes}
                    onChange={(e) => setGlobalGraphMaxNodes(Number(e.target.value || 10))}
                  />
                </label>
                <label>
                  Max Edges
                  <input
                    className="input"
                    type="number"
                    min="10"
                    max="10000"
                    value={globalGraphMaxEdges}
                    onChange={(e) => setGlobalGraphMaxEdges(Number(e.target.value || 10))}
                  />
                </label>
                <button
                  className="btn btn-outline"
                  type="button"
                  onClick={async () => {
                    try {
                      setError("")
                      setNotice("")
                      const res = await getGlobalGraph(token, {
                        maxNodes: globalGraphMaxNodes || 500,
                        maxEdges: globalGraphMaxEdges || 1200,
                      })
                      setGlobalGraphData(res)
                      setGlobalGraphError("")
                      setNotice(`Global Graph geladen: ${res.nodes?.length || 0} Knoten, ${res.edges?.length || 0} Kanten`)
                    } catch (err) {
                      setGlobalGraphData(null)
                      setGlobalGraphError(String(err.message || err))
                    }
                  }}
                >
                  Global Graph laden
                </button>
              </div>
              {globalGraphError ? <p className="error">{globalGraphError}</p> : null}
              {globalGraphData ? (
                <GraphCanvas
                  graphData={globalGraphData}
                  highlightInvoiceIds={adminGraphHighlights.invoiceIds}
                  highlightInvoiceNumbers={adminGraphHighlights.invoiceNumbers}
                />
              ) : null}

              <div className="invoice-divider" />
              <div className="row">
                <div className="invoice-label">GRAPH FRAGEN (LLM)</div>
              </div>
              <div className="graph-question-box">
                <form
                  className="graph-question-form"
                  onSubmit={async (e) => {
                    e.preventDefault()
                    await runAdminGraphQuestion()
                  }}
                >
                  <input
                    className="input"
                    value={adminGraphQuestion}
                    onChange={(e) => setAdminGraphQuestion(e.target.value)}
                    placeholder="Frage an den Graphen, z. B. Welche Rechnungen sind in Euro gestellt?"
                  />
                  <button className="btn btn-outline" type="submit" disabled={adminGraphQuestionLoading}>
                    {adminGraphQuestionLoading ? "Frage laeuft..." : "Graph fragen"}
                  </button>
                </form>
                {adminGraphQuestionError ? <p className="error">{adminGraphQuestionError}</p> : null}
                {adminGraphQuestionResult ? (
                  <div className="graph-question-result">
                    <p className="muted-inline">
                      <strong>Antwort:</strong> {adminGraphQuestionResult.answer_text || "-"}
                    </p>
                    {adminGraphQuestionResult.match_mode ? (
                      <p className="muted-inline">
                        <strong>Modus:</strong> {adminGraphQuestionResult.match_mode === "flexible"
                          ? "flexibel (LLM-Fallback)"
                          : adminGraphQuestionResult.match_mode === "semantic_contains"
                            ? "flexibel (semantic contains)"
                            : adminGraphQuestionResult.match_mode === "fallback_no_match"
                              ? "fallback versucht (kein Treffer)"
                            : "direkt"}
                      </p>
                    ) : null}
                    {adminGraphQuestionResult.explanation ? (
                      <p className="muted-inline">
                        <strong>Interpretation:</strong> {adminGraphQuestionResult.explanation}
                      </p>
                    ) : null}
                    {adminGraphQuestionResult.cypher_primary && adminGraphQuestionResult.cypher_primary !== adminGraphQuestionResult.cypher ? (
                      <>
                        <div className="invoice-label">PRIMAERE CYPHER-QUERY</div>
                        <pre className="graph-node-json">{adminGraphQuestionResult.cypher_primary}</pre>
                      </>
                    ) : null}
                    <div className="invoice-label">GENERIERTE CYPHER-QUERY</div>
                    <pre className="graph-node-json">{adminGraphQuestionResult.cypher || "-"}</pre>
                    <div className="invoice-label">ERGEBNIS ({adminGraphQuestionResult.row_count || 0})</div>
                    {(adminGraphQuestionResult.rows || []).length === 0 ? (
                      <p className="muted-inline">Keine Treffer.</p>
                    ) : (
                      <table className="table">
                        <thead>
                          <tr>
                            {(adminGraphQuestionResult.columns || Object.keys(adminGraphQuestionResult.rows[0] || {})).map((col) => (
                              <th key={col}>{String(col || "-")}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {(adminGraphQuestionResult.rows || []).map((row, idx) => (
                            <tr key={`admin-gq-row-${idx}`}>
                              {(adminGraphQuestionResult.columns || Object.keys(row || {})).map((col) => (
                                <td key={`${idx}:${col}`}>{row?.[col] == null ? "-" : String(row[col])}</td>
                              ))}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                    {adminGraphQuestionResult.truncated ? (
                      <p className="muted-inline">Ergebnis gekuerzt (LIMIT aktiv).</p>
                    ) : null}
                  </div>
                ) : null}
              </div>

              <div className="invoice-divider" />
              <div className="row">
                <div className="invoice-label">GRAPH INSIGHTS</div>
                <div className="actions-row">
                  <label>
                    Top N
                    <input
                      className="input"
                      type="number"
                      min="1"
                      max="100"
                      value={graphInsightsLimit}
                      onChange={(e) => setGraphInsightsLimit(Number(e.target.value || 1))}
                    />
                  </label>
                  <button
                    className="btn btn-outline"
                    type="button"
                    onClick={async () => {
                      try {
                        setError("")
                        setNotice("")
                        await loadGraphInsights(graphInsightsLimit || 10)
                        setNotice("Graph Insights geladen")
                      } catch (err) {
                        setError(String(err.message || err))
                      }
                    }}
                  >
                    Insights laden
                  </button>
                </div>
              </div>

              {graphInsights ? (
                <div className="insights-grid">
                  <section className="card">
                    <div className="card-header"><h3>Lieferanten-Risiko</h3></div>
                    <div className="card-body">
                      <table className="table">
                        <thead>
                          <tr>
                            <th>Lieferant</th>
                            <th>Rechnungen</th>
                            <th>Summe</th>
                            <th>Reject-Rate</th>
                          </tr>
                        </thead>
                        <tbody>
                          {(graphInsights.supplier_risk || []).map((r, idx) => (
                            <tr key={`sr-${idx}`}>
                              <td>{r.supplier_name || "-"}</td>
                              <td>{r.invoice_count ?? 0}</td>
                              <td>{r.gross_amount_sum ?? 0}</td>
                              <td>{r.reject_rate ?? 0}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </section>

                  <section className="card">
                    <div className="card-header"><h3>Top Empfaenger</h3></div>
                    <div className="card-body">
                      <table className="table">
                        <thead>
                          <tr>
                            <th>Empfaenger</th>
                            <th>Rechnungen</th>
                            <th>Summe</th>
                          </tr>
                        </thead>
                        <tbody>
                          {(graphInsights.top_recipients || []).map((r, idx) => (
                            <tr key={`tr-${idx}`}>
                              <td>{r.recipient_value || "-"}</td>
                              <td>{r.invoice_count ?? 0}</td>
                              <td>{r.gross_amount_sum ?? 0}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </section>

                  <section className="card">
                    <div className="card-header"><h3>Top Produkte</h3></div>
                    <div className="card-body">
                      <table className="table">
                        <thead>
                          <tr>
                            <th>Produkt</th>
                            <th>Positionen</th>
                            <th>Betrag</th>
                          </tr>
                        </thead>
                        <tbody>
                          {(graphInsights.top_products || []).map((r, idx) => (
                            <tr key={`tp-${idx}`}>
                              <td>{r.product_name || "-"}</td>
                              <td>{r.line_count ?? 0}</td>
                              <td>{r.amount_sum ?? 0}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </section>

                  <section className="card">
                    <div className="card-header"><h3>Status/Prozess</h3></div>
                    <div className="card-body">
                      <table className="table">
                        <thead>
                          <tr>
                            <th>Status</th>
                            <th>Rechnungen</th>
                            <th>Aktionen</th>
                            <th>Aktionen/Invoice</th>
                          </tr>
                        </thead>
                        <tbody>
                          {(graphInsights.status_distribution || []).map((r, idx) => (
                            <tr key={`sd-${idx}`}>
                              <td>{r.status_name || "-"}</td>
                              <td>{r.invoice_count ?? 0}</td>
                              <td>{r.action_count ?? 0}</td>
                              <td>{r.actions_per_invoice ?? 0}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </section>

                  <section className="card">
                    <div className="card-header"><h3>Anomalie-Kandidaten</h3></div>
                    <div className="card-body">
                      <table className="table">
                        <thead>
                          <tr>
                            <th>Lieferant</th>
                            <th>Signal</th>
                            <th>Rechnungen</th>
                            <th>Reject-Rate</th>
                          </tr>
                        </thead>
                        <tbody>
                          {(graphInsights.anomaly_candidates || []).map((r, idx) => (
                            <tr key={`ac-${idx}`}>
                              <td>{r.supplier_name || "-"}</td>
                              <td>{r.signal || "-"}</td>
                              <td>{r.invoice_count ?? 0}</td>
                              <td>{r.reject_rate ?? 0}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </section>
                </div>
              ) : null}

              <div className="invoice-divider" />
              <div className="row">
                <div className="invoice-label">TREND-INSIGHTS (ZEITREIHE)</div>
                <div className="actions-row">
                  <label>
                    Zeitraum (Tage)
                    <input
                      className="input"
                      type="number"
                      min="1"
                      max="365"
                      value={trendWindowDays}
                      onChange={(e) => setTrendWindowDays(Number(e.target.value || 1))}
                    />
                  </label>
                  <label>
                    Vergleich (Tage)
                    <input
                      className="input"
                      type="number"
                      min="1"
                      max="365"
                      value={trendCompareDays}
                      onChange={(e) => setTrendCompareDays(Number(e.target.value || 1))}
                    />
                  </label>
                  <label>
                    Granularitaet
                    <select
                      className="input"
                      value={trendGranularity}
                      onChange={(e) => setTrendGranularity(e.target.value)}
                    >
                      <option value="day">Tag</option>
                      <option value="week">Woche</option>
                      <option value="month">Monat</option>
                    </select>
                  </label>
                  <button
                    className="btn btn-outline"
                    type="button"
                    onClick={async () => {
                      try {
                        setError("")
                        setNotice("")
                        await loadGraphTrendInsights()
                        setNotice("Trend-Insights geladen")
                      } catch (err) {
                        setError(String(err.message || err))
                      }
                    }}
                  >
                    Trends laden
                  </button>
                  <button
                    className="btn btn-primary"
                    type="button"
                    onClick={async () => {
                      try {
                        setError("")
                        setNotice("")
                        await loadGraphExplanation()
                        setNotice("LLM-Analyse erstellt")
                      } catch (err) {
                        setError(String(err.message || err))
                      }
                    }}
                  >
                    LLM Analyse erstellen
                  </button>
                </div>
              </div>

              {graphExplanation?.explanation ? (
                <div className="card" style={{ marginTop: "0.7rem" }}>
                  <div className="card-header">
                    <h3>LLM Management-Analyse ({graphExplanation.explanation.provider || "-"})</h3>
                  </div>
                  <div className="card-body">
                    {graphExplanation.explanation.reason ? (
                      <p className="muted-inline">Hinweis: {graphExplanation.explanation.reason}</p>
                    ) : null}
                    <p className="muted" style={{ whiteSpace: "pre-wrap" }}>
                      {graphExplanation.explanation.analysis_text || "Keine Analyse verfuegbar."}
                    </p>
                    {(graphExplanation.explanation.highlights || []).length ? (
                      <>
                        <div className="invoice-label">HIGHLIGHTS</div>
                        <table className="table">
                          <thead>
                            <tr>
                              <th>Thema</th>
                              <th>Signal</th>
                              <th>Detail</th>
                            </tr>
                          </thead>
                          <tbody>
                            {(graphExplanation.explanation.highlights || []).map((h, idx) => (
                              <tr key={`hl-${idx}`}>
                                <td>{h.topic || "-"}</td>
                                <td>{h.signal || "-"}</td>
                                <td>{h.detail || "-"}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </>
                    ) : null}

                    {(graphExplanation.explanation.recommendations || []).length ? (
                      <>
                        <div className="invoice-label">VORGESCHLAGENE TREND-KPIS</div>
                        <table className="table">
                          <thead>
                            <tr>
                              <th>KPI</th>
                              <th>Prioritaet</th>
                              <th>Begruendung</th>
                              <th>Formel</th>
                            </tr>
                          </thead>
                          <tbody>
                            {(graphExplanation.explanation.recommendations || []).map((r, idx) => (
                              <tr key={`rec-${idx}`}>
                                <td>{r.kpi || "-"}</td>
                                <td>{r.priority || "-"}</td>
                                <td>{r.reason || "-"}</td>
                                <td className="mono">{r.formula || "-"}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </>
                    ) : null}
                  </div>
                </div>
              ) : null}

              {graphTrend?.summary ? (
                <div className="kpi-grid" style={{ marginTop: "0.6rem" }}>
                  <div className="kpi-tile">
                    <span>Rechnungen (aktuell)</span>
                    <strong>{graphTrend.summary.current?.invoice_count ?? 0}</strong>
                  </div>
                  <div className="kpi-tile">
                    <span>Gesamtbetrag (aktuell)</span>
                    <strong>{graphTrend.summary.current?.total_amount ?? 0}</strong>
                  </div>
                  <div className="kpi-tile">
                    <span>Reject-Rate (aktuell)</span>
                    <strong>{graphTrend.summary.current?.reject_rate ?? 0}</strong>
                  </div>
                  <div className="kpi-tile">
                    <span>Hold-Rate (aktuell)</span>
                    <strong>{graphTrend.summary.current?.hold_rate ?? 0}</strong>
                  </div>
                </div>
              ) : null}

              {graphTrend?.trends?.length ? (
                <div className="card" style={{ marginTop: "0.7rem" }}>
                  <div className="card-header"><h3>Trend je Bucket</h3></div>
                  <div className="card-body">
                    <table className="table">
                      <thead>
                        <tr>
                          <th>Bucket Start</th>
                          <th>Bucket End</th>
                          <th>Rechnungen</th>
                          <th>Betrag</th>
                          <th>Reject</th>
                          <th>Hold</th>
                          <th>Clarify</th>
                          <th>Drilldown</th>
                        </tr>
                      </thead>
                      <tbody>
                        {graphTrend.trends.map((r, idx) => (
                          <tr key={`trend-${idx}`}>
                            <td>{r.bucket_start}</td>
                            <td>{r.bucket_end}</td>
                            <td>{r.invoice_count ?? 0}</td>
                            <td>
                              <div>{r.total_amount ?? 0}</div>
                              <div className="mini-bar"><span style={{ width: `${Math.min(100, Number(r.total_amount || 0) / 100)}%` }} /></div>
                            </td>
                            <td>
                              <div>{r.reject_rate ?? 0}</div>
                              <div className="mini-bar"><span style={{ width: `${Math.min(100, Number(r.reject_rate || 0) * 100)}%` }} /></div>
                            </td>
                            <td>
                              <div>{r.hold_rate ?? 0}</div>
                              <div className="mini-bar"><span style={{ width: `${Math.min(100, Number(r.hold_rate || 0) * 100)}%` }} /></div>
                            </td>
                            <td>
                              <div>{r.clarification_rate ?? 0}</div>
                              <div className="mini-bar"><span style={{ width: `${Math.min(100, Number(r.clarification_rate || 0) * 100)}%` }} /></div>
                            </td>
                            <td>
                              <div className="actions-row">
                                <button
                                  className="btn btn-outline btn-sm"
                                  type="button"
                                  onClick={() => loadGraphDrilldown("invoice_count", r.bucket_start, r.bucket_end)}
                                >
                                  Count
                                </button>
                                <button
                                  className="btn btn-outline btn-sm"
                                  type="button"
                                  onClick={() => loadGraphDrilldown("reject_rate", r.bucket_start, r.bucket_end)}
                                >
                                  Reject
                                </button>
                                <button
                                  className="btn btn-outline btn-sm"
                                  type="button"
                                  onClick={() => loadGraphDrilldown("hold_rate", r.bucket_start, r.bucket_end)}
                                >
                                  Hold
                                </button>
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              ) : null}

              {graphDrilldown?.items ? (
                <div className="card" style={{ marginTop: "0.7rem" }}>
                  <div className="card-header">
                    <h3>
                      Drilldown Rechnungen ({graphDrilldown.metric || "-"}) - {graphDrilldown.total ?? 0}
                    </h3>
                    <button className="btn btn-outline btn-sm" type="button" onClick={exportDrilldownCsv}>
                      CSV Export
                    </button>
                  </div>
                  <div className="card-body">
                    <table className="table">
                      <thead>
                        <tr>
                          <th>Rechnungsnr.</th>
                          <th>Lieferant</th>
                          <th>Datum</th>
                          <th>Status</th>
                          <th>Betrag</th>
                          <th>Waehrung</th>
                          <th>Actions</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(graphDrilldown.items || []).map((r, idx) => (
                          <tr key={`drill-${idx}`}>
                            <td>{r.invoice_number || r.invoice_id || "-"}</td>
                            <td>{r.supplier_name || "-"}</td>
                            <td>{r.invoice_date || "-"}</td>
                            <td>{r.status || "-"}</td>
                            <td>{r.gross_amount ?? 0}</td>
                            <td>{r.currency || "-"}</td>
                            <td>{Array.isArray(r.action_types) ? r.action_types.join(", ") : "-"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              ) : null}
            </div>
          </section>
          ) : null}

          {adminTab === "reset" ? (
          <section className="card">
            <div className="card-header"><h3>Global Reset (Rechnungs-Pipeline)</h3></div>
            <div className="card-body">
              <p className="muted">
                Loescht alle geladenen und verarbeiteten Rechnungsdaten (Dokumente, Rechnungen, Positionen, Aktionen, Cases),
                damit der komplette MinIO-Flow mit neuem Feldkatalog erneut laufen kann.
              </p>
              <div className="actions-row">
                <label>
                  Neo4j Graph mit resetten
                  <select
                    className="input"
                    value={resetGraph ? "true" : "false"}
                    onChange={(e) => setResetGraph(e.target.value === "true")}
                  >
                    <option value="true">ja</option>
                    <option value="false">nein</option>
                  </select>
                </label>
                <button
                  className="btn btn-outline"
                  type="button"
                  onClick={async () => {
                    const ok = window.confirm("Wirklich ALLE Rechnungsdaten zuruecksetzen?")
                    if (!ok) return
                    try {
                      setError("")
                      setNotice("")
                      const res = await resetInvoicePipeline(token, { resetGraph })
                      await Promise.all([
                        loadDocumentsList(),
                        loadInvoicesList(),
                        loadKpi(),
                      ])
                      setGlobalGraphData(null)
                      setGlobalGraphError("")
                      const d = res?.data_reset?.details || {}
                      setNotice(
                        `Reset abgeschlossen. Docs: ${d.documents_deleted || 0}, Invoices: ${d.invoices_deleted || 0}, Lines: ${d.invoice_lines_deleted || 0}, Actions: ${d.invoice_actions_deleted || 0}, Cases: ${d.invoice_cases_deleted || 0}`
                      )
                    } catch (err) {
                      setError(String(err.message || err))
                    }
                  }}
                >
                  Jetzt global resetten
                </button>
              </div>
            </div>
          </section>
          ) : null}

          {adminTab === "pipeline" ? (
          <section className="card">
            <div className="card-header row">
              <h3>Dokumente (MinIO Ingestion)</h3>
              <div className="actions-row">
                <button className="btn btn-outline" onClick={loadDocumentsList}>Neu laden</button>
                <button
                  className="btn btn-outline"
                  type="button"
                  onClick={() => {
                    const next = {}
                    for (const d of documents) next[String(d.id)] = true
                    setSelectedDocumentIds(next)
                  }}
                >
                  Alle markieren
                </button>
                <button
                  className="btn btn-outline"
                  type="button"
                  onClick={() => setSelectedDocumentIds({})}
                >
                  Auswahl leeren
                </button>
                <button
                  className="btn btn-primary"
                  type="button"
                  onClick={async () => {
                    try {
                      const ids = Object.keys(selectedDocumentIds).filter((id) => selectedDocumentIds[id])
                      if (!ids.length) throw new Error("Bitte mindestens ein Dokument markieren.")
                      setError("")
                      setNotice("")
                      const res = await reprocessDocuments(token, {
                        document_ids: ids,
                        run_extract: true,
                        run_map: true,
                        run_validate: true,
                        run_graph_sync: true,
                      })
                      await Promise.all([loadDocumentsList(), loadInvoicesList(), loadKpi()])
                      setNotice(`Reprocess abgeschlossen fuer ${res.documents?.length || 0} Dokumente`)
                    } catch (err) {
                      setError(String(err.message || err))
                    }
                  }}
                >
                  Auswahl reprocess
                </button>
              </div>
            </div>
            <div className="card-body">
              <table className="table">
                <thead>
                  <tr>
                    <th></th>
                    <th>Datei</th>
                    <th>Typ</th>
                    <th>Status</th>
                    <th>Quelle</th>
                    <th>Aktion</th>
                  </tr>
                </thead>
                <tbody>
                  {documents.map((d) => (
                    <tr key={d.id}>
                      <td>
                        <input
                          type="checkbox"
                          checked={!!selectedDocumentIds[String(d.id)]}
                          onChange={(e) =>
                            setSelectedDocumentIds((all) => ({ ...all, [String(d.id)]: e.target.checked }))
                          }
                        />
                      </td>
                      <td>{d.filename}</td>
                      <td>{d.file_type}</td>
                      <td>{d.status}</td>
                      <td className="mono">{d.source_uri}</td>
                      <td>
                        <button
                          className="btn btn-outline btn-sm"
                          type="button"
                          onClick={async () => {
                            const ok = window.confirm(`Dokument wirklich entfernen?\\n${d.filename}`)
                            if (!ok) return
                            try {
                              setError("")
                              setNotice("")
                              await deleteDocument(token, d.id)
                              await Promise.all([loadDocumentsList(), loadInvoicesList(), loadKpi()])
                              setNotice(`Dokument entfernt: ${d.filename}`)
                            } catch (err) {
                              setError(String(err.message || err))
                            }
                          }}
                        >
                          Entfernen
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
          ) : null}

          {adminTab === "pipeline" ? (
          <section className="card">
            <div className="card-header row">
              <h3>Rechnungen (Mapped)</h3>
              <button className="btn btn-outline" onClick={loadInvoicesList}>Neu laden</button>
            </div>
            <div className="card-body">
              <table className="table">
                <thead>
                  <tr>
                    <th>Lieferant</th>
                    <th>Rechnungsnr.</th>
                    <th>Datum</th>
                    <th>Betrag</th>
                    <th>Waehrung</th>
                    <th>Status</th>
                    <th>Konfidenz</th>
                  </tr>
                </thead>
                <tbody>
                  {invoices.map((inv) => (
                    <tr key={inv.id}>
                      <td>{inv.supplier_name || "-"}</td>
                      <td>{inv.invoice_number || "-"}</td>
                      <td>{inv.invoice_date || "-"}</td>
                      <td>{inv.gross_amount ?? "-"}</td>
                      <td>{inv.currency || "-"}</td>
                      <td>{inv.status || "-"}</td>
                      <td>{inv.confidence_score ?? "-"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
          ) : null}

          {adminTab === "users" ? (
          <section className="card">
            <div className="card-header row">
              <h3>Benutzerliste</h3>
              <button className="btn btn-outline" onClick={loadUsers}>Neu laden</button>
            </div>
            <div className="card-body">
            <table className="table">
              <thead>
                <tr>
                  <th>Username</th>
                  <th>E-Mail</th>
                  <th>Rollen</th>
                  <th>Aktiv</th>
                </tr>
              </thead>
              <tbody>
                {users.map((u) => (
                  <tr key={u.id}>
                    <td>{u.username}</td>
                    <td>{u.email}</td>
                    <td>{(u.roles || []).join(", ")}</td>
                    <td>{u.is_active ? "ja" : "nein"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            </div>
          </section>
          ) : null}

          {adminTab === "pipeline" ? (
          <section className="card">
            <div className="card-header row">
              <h3>Loeschantraege</h3>
              <div className="actions-row">
                <select
                  className="input"
                  value={deleteRequestStatusFilter}
                  onChange={(e) => setDeleteRequestStatusFilter(e.target.value)}
                >
                  <option value="PENDING">PENDING</option>
                  <option value="APPROVED">APPROVED</option>
                  <option value="REJECTED">REJECTED</option>
                  <option value="">ALLE</option>
                </select>
                <button className="btn btn-outline" onClick={loadDeleteRequests}>Neu laden</button>
              </div>
            </div>
            <div className="card-body">
              <table className="table">
                <thead>
                  <tr>
                    <th>Invoice</th>
                    <th>Angefragt von</th>
                    <th>Grund</th>
                    <th>Status</th>
                    <th>Aktion</th>
                  </tr>
                </thead>
                <tbody>
                  {deleteRequests.length === 0 ? (
                    <tr><td colSpan={5}>Keine Loeschantraege.</td></tr>
                  ) : (
                    deleteRequests.map((r) => (
                      <tr key={r.id}>
                        <td className="mono">{r.invoice_id || "-"}</td>
                        <td>{r.requested_by_username || r.requested_by_user_id || "-"}</td>
                        <td>{r.reason || "-"}</td>
                        <td>{r.status || "-"}</td>
                        <td>
                          {r.status === "PENDING" ? (
                            <div className="actions-row">
                              <button
                                className="btn btn-outline btn-sm"
                                type="button"
                                onClick={async () => {
                                  try {
                                    setError("")
                                    setNotice("")
                                    await approveDeleteRequest(token, r.id, "")
                                    await Promise.all([loadDeleteRequests(), loadDocumentsList(), loadInvoicesList(), loadKpi()])
                                    setNotice("Loeschantrag freigegeben")
                                  } catch (err) {
                                    setError(String(err.message || err))
                                  }
                                }}
                              >
                                Approve
                              </button>
                              <button
                                className="btn btn-outline btn-sm"
                                type="button"
                                onClick={async () => {
                                  try {
                                    setError("")
                                    setNotice("")
                                    await rejectDeleteRequest(token, r.id, "")
                                    await loadDeleteRequests()
                                    setNotice("Loeschantrag abgelehnt")
                                  } catch (err) {
                                    setError(String(err.message || err))
                                  }
                                }}
                              >
                                Reject
                              </button>
                            </div>
                          ) : (
                            <span className="muted-inline">{r.reviewed_by_username || "-"}</span>
                          )}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </section>
          ) : null}

          {minioPreviewOpen ? (
            <section className="card">
              <div className="card-header row">
                <h3>MinIO Import-Auswahl</h3>
                <button className="btn btn-outline btn-sm" type="button" onClick={() => setMinioPreviewOpen(false)}>
                  Schliessen
                </button>
              </div>
              <div className="card-body">
                <div className="actions-row" style={{ marginBottom: "0.6rem" }}>
                  <button
                    className="btn btn-outline btn-sm"
                    type="button"
                    onClick={() => {
                      const next = {}
                      for (const item of minioPreviewItems) next[String(item.object_name || "")] = !item.is_duplicate
                      setMinioPreviewSelection(next)
                    }}
                  >
                    Alle neuen markieren
                  </button>
                  <button
                    className="btn btn-outline btn-sm"
                    type="button"
                    onClick={() => {
                      const next = {}
                      for (const item of minioPreviewItems) next[String(item.object_name || "")] = true
                      setMinioPreviewSelection(next)
                    }}
                  >
                    Alle markieren
                  </button>
                  <button
                    className="btn btn-outline btn-sm"
                    type="button"
                    onClick={() => {
                      const next = {}
                      for (const item of minioPreviewItems) next[String(item.object_name || "")] = false
                      setMinioPreviewSelection(next)
                    }}
                  >
                    Alle abwaehlen
                  </button>
                  <button
                    className="btn btn-primary btn-sm"
                    type="button"
                    onClick={async () => {
                      try {
                        const selected = minioPreviewItems
                          .map((item) => String(item.object_name || ""))
                          .filter((name) => !!name && !!minioPreviewSelection[name])
                        if (!selected.length) {
                          throw new Error("Bitte mindestens eine Datei auswaehlen.")
                        }
                        setError("")
                        setNotice("")
                        const res = await pullMinioSelected(token, {
                          maxObjects: minio.max_objects || 200,
                          objectNames: selected,
                        })
                        await loadDocumentsList()
                        setMinioPreviewOpen(false)
                        setNotice(
                          `MinIO Pull: ${res.created} neu, ${res.skipped} uebersprungen (${res.skipped_duplicate || 0} Duplikate)`
                        )
                      } catch (err) {
                        setError(String(err.message || err))
                      }
                    }}
                  >
                    Auswahl importieren
                  </button>
                </div>
                <table className="table">
                  <thead>
                    <tr>
                      <th></th>
                      <th>Datei</th>
                      <th>Groesse</th>
                      <th>Duplikat</th>
                      <th>Grund</th>
                    </tr>
                  </thead>
                  <tbody>
                    {minioPreviewItems.map((item) => {
                      const key = String(item.object_name || "")
                      const checked = !!minioPreviewSelection[key]
                      return (
                        <tr key={key}>
                          <td>
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={(e) =>
                                setMinioPreviewSelection((all) => ({ ...all, [key]: e.target.checked }))
                              }
                            />
                          </td>
                          <td className="mono">{item.object_name}</td>
                          <td>{item.size ?? 0}</td>
                          <td>{item.is_duplicate ? "ja" : "nein"}</td>
                          <td>{item.duplicate_reason || "-"}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </section>
          ) : null}
        </>
      )}
    </main>
  )
}

function GraphCanvas({
  graphData,
  onNodeSelect,
  rootNodeId = "",
  showRootComponentOnly = false,
  highlightInvoiceIds = [],
  highlightInvoiceNumbers = [],
}) {
  const width = 760
  const height = 360
  const [zoom, setZoom] = useState(1)
  const [pan, setPan] = useState({ x: 0, y: 0 })
  const [selectedNodeId, setSelectedNodeId] = useState("")
  const [layerMode, setLayerMode] = useState("data")
  const [labelMode, setLabelMode] = useState("auto")
  const [showLineItems, setShowLineItems] = useState(true)
  const [showDataFields, setShowDataFields] = useState(true)
  const [showAppActions, setShowAppActions] = useState(true)
  const [aggregateLines, setAggregateLines] = useState(true)
  const [lineTopN, setLineTopN] = useState(8)
  const [minNodeDegree, setMinNodeDegree] = useState(0)
  const [showPeerInvoices, setShowPeerInvoices] = useState(true)
  const [nodeOverrides, setNodeOverrides] = useState({})
  const dragStateRef = useRef(null)
  const nodeDragRef = useRef(null)
  const highlightInvoiceIdSet = useMemo(
    () => new Set((highlightInvoiceIds || []).map((x) => String(x || "").trim()).filter(Boolean)),
    [highlightInvoiceIds],
  )
  const highlightInvoiceNumberSet = useMemo(
    () => new Set((highlightInvoiceNumbers || []).map((x) => String(x || "").trim().toLowerCase()).filter(Boolean)),
    [highlightInvoiceNumbers],
  )

  const { nodes, edges, hiddenDisconnectedCount, hiddenPeerInvoiceCount } = useMemo(() => {
    const rawNodes = (graphData?.nodes || []).map((n) => ({ ...n }))
    const rawEdges = (graphData?.edges || []).map((e) => ({ ...e }))

    const layerConfig = {
      all: {
        labels: null,
        edges: null,
      },
      data: {
        labels: new Set(["Invoice", "Supplier", "InvoiceLine", "Currency", "InvoiceDataField", "InvoiceLineGroup"]),
        edges: new Set(["BELONGS_TO", "HAS_LINE", "IN_CURRENCY", "HAS_DATA_FIELD", "HAS_LINE_GROUP"]),
      },
      app: {
        labels: new Set(["Invoice", "InvoiceAction", "User", "InvoiceStatus"]),
        edges: new Set(["TARGETS", "PERFORMED", "FROM_STATUS", "TO_STATUS", "HAS_STATUS"]),
      },
    }[layerMode] || { labels: null, edges: null }

    let filteredNodes = rawNodes
    if (layerConfig.labels) {
      filteredNodes = rawNodes.filter((n) => (n.labels || []).some((label) => layerConfig.labels.has(label)))
    }
    const nodeIds = new Set(filteredNodes.map((n) => String(n.id)))

    let filteredEdges = rawEdges
    if (layerConfig.edges) {
      filteredEdges = rawEdges.filter((e) => layerConfig.edges.has(String(e.type || "")))
    }
    filteredEdges = filteredEdges.filter(
      (e) => nodeIds.has(String(e.source || "")) && nodeIds.has(String(e.target || "")),
    )

    const visibleNodeIds = new Set(filteredNodes.map((n) => String(n.id)))
    if (!showLineItems) {
      for (const n of filteredNodes) {
        if ((n.labels || []).includes("InvoiceLine")) visibleNodeIds.delete(String(n.id))
      }
    }
    if (!showDataFields) {
      for (const n of filteredNodes) {
        if ((n.labels || []).includes("InvoiceDataField")) visibleNodeIds.delete(String(n.id))
      }
    }
    if (!showAppActions) {
      for (const n of filteredNodes) {
        if ((n.labels || []).includes("InvoiceAction")) visibleNodeIds.delete(String(n.id))
      }
    }

    filteredNodes = filteredNodes.filter((n) => visibleNodeIds.has(String(n.id)))
    filteredEdges = filteredEdges.filter(
      (e) => visibleNodeIds.has(String(e.source || "")) && visibleNodeIds.has(String(e.target || "")),
    )

    if (aggregateLines && showLineItems && layerMode !== "app") {
      const byId = new Map(filteredNodes.map((n) => [String(n.id), n]))
      const lineByInvoice = new Map()
      for (const e of filteredEdges) {
        if (String(e.type || "") !== "HAS_LINE") continue
        const sourceId = String(e.source || "")
        const targetId = String(e.target || "")
        const sourceNode = byId.get(sourceId)
        const targetNode = byId.get(targetId)
        if (!sourceNode || !targetNode) continue
        let invoiceId = ""
        let lineId = ""
        if ((sourceNode.labels || []).includes("Invoice") && (targetNode.labels || []).includes("InvoiceLine")) {
          invoiceId = sourceId
          lineId = targetId
        } else if ((targetNode.labels || []).includes("Invoice") && (sourceNode.labels || []).includes("InvoiceLine")) {
          invoiceId = targetId
          lineId = sourceId
        }
        if (!invoiceId || !lineId) continue
        const lines = lineByInvoice.get(invoiceId) || []
        lines.push(lineId)
        lineByInvoice.set(invoiceId, lines)
      }

      const nodesToRemove = new Set()
      const edgesToRemove = new Set()
      const nodesToAdd = []
      const edgesToAdd = []
      const topN = Math.max(1, Math.min(20, Number(lineTopN || 8)))
      let syntheticCounter = 0

      for (const [invoiceId, lineIds] of lineByInvoice.entries()) {
        if (lineIds.length <= topN) continue
        const sortedLineIds = [...lineIds].sort((a, b) => {
          const na = Number(byId.get(a)?.properties?.line_amount || 0)
          const nb = Number(byId.get(b)?.properties?.line_amount || 0)
          return nb - na
        })
        const keep = new Set(sortedLineIds.slice(0, topN))
        const grouped = sortedLineIds.slice(topN)
        if (!grouped.length) continue

        const aggId = `line-group:${invoiceId}:${syntheticCounter++}`
        nodesToAdd.push({
          id: aggId,
          labels: ["InvoiceLineGroup"],
          properties: {
            invoice_id: invoiceId,
            grouped_count: grouped.length,
            grouped_line_ids: grouped,
            name: `Weitere Positionen (${grouped.length})`,
          },
        })
        edgesToAdd.push({
          id: `edge:${aggId}`,
          source: invoiceId,
          target: aggId,
          type: "HAS_LINE_GROUP",
        })

        for (const lid of grouped) nodesToRemove.add(lid)
        for (const e of filteredEdges) {
          const s = String(e.source || "")
          const t = String(e.target || "")
          if (nodesToRemove.has(s) || nodesToRemove.has(t)) edgesToRemove.add(String(e.id || `${s}-${t}-${e.type || ""}`))
          if (keep.has(s) || keep.has(t)) continue
        }
      }

      if (nodesToRemove.size > 0) {
        filteredNodes = filteredNodes.filter((n) => !nodesToRemove.has(String(n.id)))
        filteredEdges = filteredEdges.filter((e) => !edgesToRemove.has(String(e.id || `${e.source || ""}-${e.target || ""}-${e.type || ""}`)))
      }
      if (nodesToAdd.length) filteredNodes = filteredNodes.concat(nodesToAdd)
      if (edgesToAdd.length) filteredEdges = filteredEdges.concat(edgesToAdd)
    }

    const degree = new Map()
    for (const n of filteredNodes) degree.set(String(n.id), 0)
    for (const e of filteredEdges) {
      const s = String(e.source || "")
      const t = String(e.target || "")
      degree.set(s, (degree.get(s) || 0) + 1)
      degree.set(t, (degree.get(t) || 0) + 1)
    }

    const coreLabels = new Set(["Invoice", "Supplier", "Currency", "InvoiceStatus", "InvoiceLineGroup"])
    if (minNodeDegree > 0) {
      const keepIds = new Set(
        filteredNodes
          .filter((n) => {
            const labels = n.labels || []
            if (labels.some((l) => coreLabels.has(l))) return true
            return (degree.get(String(n.id)) || 0) >= minNodeDegree
          })
          .map((n) => String(n.id)),
      )
      filteredNodes = filteredNodes.filter((n) => keepIds.has(String(n.id)))
      filteredEdges = filteredEdges.filter((e) => keepIds.has(String(e.source || "")) && keepIds.has(String(e.target || "")))
    }

    const rootId = String(rootNodeId || "").trim()
    let disconnectedHidden = 0
    let peerInvoiceHidden = 0
    if (showRootComponentOnly && rootId) {
      const rootNode =
        filteredNodes.find((n) => String(n.id) === rootId) ||
        filteredNodes.find(
          (n) =>
            (n.labels || []).includes("Invoice") &&
            String(n.properties?.id || "").trim() === rootId,
        )
      const rootGraphId = rootNode ? String(rootNode.id) : ""
      const hasRoot = !!rootGraphId
      if (hasRoot) {
        const adj = new Map()
        for (const n of filteredNodes) adj.set(String(n.id), new Set())
        for (const e of filteredEdges) {
          const s = String(e.source || "")
          const t = String(e.target || "")
          if (!adj.has(s)) adj.set(s, new Set())
          if (!adj.has(t)) adj.set(t, new Set())
          adj.get(s).add(t)
          adj.get(t).add(s)
        }
        const keep = new Set([rootGraphId])
        const q = [rootGraphId]
        while (q.length) {
          const cur = q.shift()
          const nextSet = adj.get(cur) || new Set()
          for (const nxt of nextSet) {
            if (keep.has(nxt)) continue
            keep.add(nxt)
            q.push(nxt)
          }
        }
        disconnectedHidden = Math.max(0, filteredNodes.length - keep.size)
        filteredNodes = filteredNodes.filter((n) => keep.has(String(n.id)))
        filteredEdges = filteredEdges.filter((e) => keep.has(String(e.source || "")) && keep.has(String(e.target || "")))

        if (!showPeerInvoices) {
          // In inbox mode keep only the selected invoice node as invoice anchor.
          const beforeInvoiceCount = filteredNodes.filter((n) => (n.labels || []).includes("Invoice")).length
          filteredNodes = filteredNodes.filter((n) => {
            const isInvoice = (n.labels || []).includes("Invoice")
            if (!isInvoice) return true
            return String(n.id) === rootGraphId
          })
          const afterInvoiceCount = filteredNodes.filter((n) => (n.labels || []).includes("Invoice")).length
          peerInvoiceHidden = Math.max(0, beforeInvoiceCount - afterInvoiceCount)
          const keepAfterInvoiceFilter = new Set(filteredNodes.map((n) => String(n.id)))
          filteredEdges = filteredEdges.filter(
            (e) =>
              keepAfterInvoiceFilter.has(String(e.source || "")) &&
              keepAfterInvoiceFilter.has(String(e.target || "")),
          )
        }
      }
    }

    const centerX = width / 2
    const centerY = height / 2
    const nodeById = new Map(filteredNodes.map((n) => [String(n.id), n]))
    const adjacency = new Map()
    for (const n of filteredNodes) adjacency.set(String(n.id), new Set())
    for (const e of filteredEdges) {
      const s = String(e.source || "")
      const t = String(e.target || "")
      if (!adjacency.has(s)) adjacency.set(s, new Set())
      if (!adjacency.has(t)) adjacency.set(t, new Set())
      adjacency.get(s).add(t)
      adjacency.get(t).add(s)
    }

    const invoiceNodes = filteredNodes.filter((n) => (n.labels || []).includes("Invoice"))
    const positionedMap = new Map()

    if (invoiceNodes.length === 1) {
      positionedMap.set(String(invoiceNodes[0].id), { x: centerX, y: centerY })
    } else if (invoiceNodes.length > 1) {
      const invoiceRadius = Math.max(95, Math.min(width, height) * 0.24)
      for (let i = 0; i < invoiceNodes.length; i += 1) {
        const angle = (i / invoiceNodes.length) * Math.PI * 2
        positionedMap.set(String(invoiceNodes[i].id), {
          x: centerX + Math.cos(angle) * invoiceRadius,
          y: centerY + Math.sin(angle) * invoiceRadius,
        })
      }
    }

    const invoiceIds = new Set(invoiceNodes.map((n) => String(n.id)))
    const assignedByInvoice = new Map()
    for (const inv of invoiceNodes) assignedByInvoice.set(String(inv.id), [])
    for (const n of filteredNodes) {
      const nid = String(n.id)
      if (invoiceIds.has(nid)) continue
      const neighbors = adjacency.get(nid) || new Set()
      const connectedInvoices = [...neighbors].filter((x) => invoiceIds.has(x))
      if (!connectedInvoices.length) {
        continue
      }
      const assignedInvoice = connectedInvoices[0]
      const arr = assignedByInvoice.get(assignedInvoice) || []
      arr.push(nid)
      assignedByInvoice.set(assignedInvoice, arr)
    }

    function ringRadiusForNode(node) {
      const labels = node.labels || []
      if (labels.includes("Supplier") || labels.includes("Currency") || labels.includes("InvoiceStatus")) return 95
      if (labels.includes("User") || labels.includes("InvoiceAction")) return 125
      if (labels.includes("InvoiceDataField") || labels.includes("InvoiceLine") || labels.includes("InvoiceLineGroup")) return 155
      return 140
    }

    const invoiceCount = Math.max(1, invoiceNodes.length)
    for (let i = 0; i < invoiceNodes.length; i += 1) {
      const inv = invoiceNodes[i]
      const invId = String(inv.id)
      const invPos = positionedMap.get(invId) || { x: centerX, y: centerY }
      const items = assignedByInvoice.get(invId) || []
      if (!items.length) continue
      const baseAngle = invoiceCount === 1 ? -Math.PI / 2 : (i / invoiceCount) * Math.PI * 2
      const sector = invoiceCount === 1 ? Math.PI * 2 : (Math.PI * 2 / invoiceCount) * 0.95
      const start = baseAngle - sector / 2
      for (let k = 0; k < items.length; k += 1) {
        const nid = items[k]
        if (positionedMap.has(nid)) continue
        const node = nodeById.get(nid)
        if (!node) continue
        const radius = ringRadiusForNode(node)
        const a = start + ((k + 1) / (items.length + 1)) * sector
        positionedMap.set(nid, {
          x: invPos.x + Math.cos(a) * radius,
          y: invPos.y + Math.sin(a) * radius,
        })
      }
    }

    const leftovers = filteredNodes.filter((n) => !positionedMap.has(String(n.id))).map((n) => String(n.id))
    if (leftovers.length) {
      const r = Math.max(110, Math.min(width, height) * 0.42)
      for (let i = 0; i < leftovers.length; i += 1) {
        const angle = (i / leftovers.length) * Math.PI * 2
        positionedMap.set(leftovers[i], {
          x: centerX + Math.cos(angle) * r,
          y: centerY + Math.sin(angle) * r,
        })
      }
    }

    const positioned = filteredNodes.map((n) => {
      const p = positionedMap.get(String(n.id)) || { x: centerX, y: centerY }
      return {
        ...n,
        x: p.x,
        y: p.y,
      }
    })

    return {
      nodes: positioned,
      edges: filteredEdges,
      hiddenDisconnectedCount: disconnectedHidden,
      hiddenPeerInvoiceCount: peerInvoiceHidden,
    }
  }, [graphData, layerMode, showLineItems, showDataFields, showAppActions, aggregateLines, lineTopN, minNodeDegree, rootNodeId, showRootComponentOnly, showPeerInvoices])

  const renderedNodes = useMemo(
    () => nodes.map((n) => ({ ...n, ...(nodeOverrides[String(n.id)] || {}) })),
    [nodes, nodeOverrides],
  )

  const nodeMap = useMemo(() => {
    const m = new Map()
    for (const n of renderedNodes) m.set(String(n.id), n)
    return m
  }, [renderedNodes])

  const selectedNode = useMemo(
    () => renderedNodes.find((n) => String(n.id) === String(selectedNodeId)) || null,
    [renderedNodes, selectedNodeId],
  )

  const adjacency = useMemo(() => {
    const map = new Map()
    for (const node of nodes) {
      map.set(String(node.id), new Set())
    }
    for (const edge of edges) {
      const s = String(edge.source || "")
      const t = String(edge.target || "")
      if (!map.has(s)) map.set(s, new Set())
      if (!map.has(t)) map.set(t, new Set())
      map.get(s).add(t)
      map.get(t).add(s)
    }
    return map
  }, [nodes, edges])

  useEffect(() => {
    setSelectedNodeId("")
    setNodeOverrides({})
    if (onNodeSelect) onNodeSelect(null)
  }, [graphData, layerMode, showLineItems, showDataFields, showAppActions, aggregateLines, lineTopN, minNodeDegree, showPeerInvoices])

  useEffect(() => {
    if (!selectedNodeId) return
    if (!renderedNodes.find((n) => String(n.id) === String(selectedNodeId))) {
      setSelectedNodeId("")
      if (onNodeSelect) onNodeSelect(null)
    }
  }, [renderedNodes, selectedNodeId, onNodeSelect])

  function nodeLabel(node) {
    const labels = node.labels || []
    const p = node.properties || {}
    if (labels.includes("Invoice")) return p.invoice_number || p.id || "Invoice"
    if (labels.includes("Supplier")) return p.name || "Supplier"
    if (labels.includes("InvoiceLine")) return p.description || `Line ${p.line_no || ""}`.trim()
    if (labels.includes("InvoiceLineGroup")) return p.name || `Weitere Positionen (${p.grouped_count || 0})`
    if (labels.includes("InvoiceDataField")) return `${p.field_name || "field"}: ${p.value || ""}`.trim()
    if (labels.includes("InvoiceAction")) return p.action_type || "Action"
    if (labels.includes("User")) return p.username || p.id || "User"
    if (labels.includes("InvoiceStatus")) return p.name || "Status"
    return labels[0] || "Node"
  }

  function nodeColor(node) {
    const labels = node.labels || []
    if (labels.includes("Invoice")) return "#ee7f00"
    if (labels.includes("Supplier")) return "#335b8c"
    if (labels.includes("InvoiceLine")) return "#6b7280"
    if (labels.includes("InvoiceLineGroup")) return "#7c8ea8"
    if (labels.includes("InvoiceDataField")) return "#475569"
    if (labels.includes("InvoiceAction")) return "#1f7a4a"
    if (labels.includes("User")) return "#6d28d9"
    if (labels.includes("InvoiceStatus")) return "#0f766e"
    return "#334155"
  }

  function isNodeDirectlyConnected(nodeId) {
    if (!selectedNodeId) return true
    const id = String(nodeId)
    if (id === String(selectedNodeId)) return true
    return adjacency.get(String(selectedNodeId))?.has(id) || false
  }

  function isEdgeDirectlyConnected(edge) {
    if (!selectedNodeId) return true
    const s = String(edge.source || "")
    const t = String(edge.target || "")
    const selected = String(selectedNodeId)
    return s === selected || t === selected
  }

  function isDetailNode(node) {
    const labels = node.labels || []
    return labels.includes("InvoiceLine") || labels.includes("InvoiceDataField") || labels.includes("InvoiceAction")
  }

  function isHighlightedInvoiceNode(node) {
    const labels = node.labels || []
    if (!labels.includes("Invoice")) return false
    const p = node.properties || {}
    const pid = String(p.id || "").trim()
    const pnum = String(p.invoice_number || "").trim().toLowerCase()
    if (pid && highlightInvoiceIdSet.has(pid)) return true
    if (pnum && highlightInvoiceNumberSet.has(pnum)) return true
    return false
  }

  function shouldShowLabel(node, direct) {
    if (labelMode === "none") return false
    if (labelMode === "all") return true
    if (selectedNodeId) return !!direct
    const labels = node.labels || []
    if (zoom >= 1.35) return !isDetailNode(node) || labels.includes("InvoiceLineGroup")
    return (
      labels.includes("Invoice") ||
      labels.includes("Supplier") ||
      labels.includes("Currency") ||
      labels.includes("InvoiceStatus") ||
      labels.includes("InvoiceLineGroup")
    )
  }

  return (
    <div className="graph-panel">
      <div className="graph-toolbar">
        <div className="graph-toolbar-main">
          <span className="muted-inline">
            Knoten: {nodes.length} | Kanten: {edges.length}
            {showRootComponentOnly && hiddenDisconnectedCount > 0 ? ` | ${hiddenDisconnectedCount} isolierte Knoten ausgeblendet` : ""}
            {showRootComponentOnly && hiddenPeerInvoiceCount > 0 ? ` | ${hiddenPeerInvoiceCount} weitere Rechnungen ausgeblendet` : ""}
          </span>
          <div className="actions-row">
            <select className="input btn-sm" value={layerMode} onChange={(e) => setLayerMode(e.target.value)}>
              <option value="data">Datenebene</option>
              <option value="app">Anwendungsebene</option>
              <option value="all">Alles</option>
            </select>
            <select className="input btn-sm" value={labelMode} onChange={(e) => setLabelMode(e.target.value)}>
              <option value="auto">Labels: Auto</option>
              <option value="all">Labels: Alle</option>
              <option value="none">Labels: Aus</option>
            </select>
            <button className="btn btn-outline btn-sm" type="button" onClick={() => setZoom((z) => Math.min(2.4, z + 0.1))}>+</button>
            <button className="btn btn-outline btn-sm" type="button" onClick={() => setZoom((z) => Math.max(0.5, z - 0.1))}>-</button>
            <button className="btn btn-outline btn-sm" type="button" onClick={() => { setZoom(1); setPan({ x: 0, y: 0 }) }}>Reset</button>
          </div>
        </div>
        <div className="graph-toolbar-filters">
          {showRootComponentOnly ? (
            <label className="graph-toggle-item">
              <input type="checkbox" checked={showPeerInvoices} onChange={(e) => setShowPeerInvoices(e.target.checked)} />
              Weitere Rechnungen
            </label>
          ) : null}
          <label className="graph-toggle-item"><input type="checkbox" checked={showLineItems} onChange={(e) => setShowLineItems(e.target.checked)} /> Positionen</label>
          <label className="graph-toggle-item"><input type="checkbox" checked={showDataFields} onChange={(e) => setShowDataFields(e.target.checked)} /> Datenfelder</label>
          <label className="graph-toggle-item"><input type="checkbox" checked={showAppActions} onChange={(e) => setShowAppActions(e.target.checked)} /> Aktionen</label>
          <label className="graph-toggle-item"><input type="checkbox" checked={aggregateLines} onChange={(e) => setAggregateLines(e.target.checked)} /> Positionen clustern</label>
          <label className="graph-toggle-item">Top-N:
            <input
              className="input btn-sm graph-number-input"
              type="number"
              min={1}
              max={20}
              value={lineTopN}
              onChange={(e) => setLineTopN(Math.max(1, Math.min(20, Number(e.target.value || 8))))}
            />
          </label>
          <label className="graph-toggle-item">Min Degree:
            <input
              className="input btn-sm graph-number-input"
              type="number"
              min={0}
              max={20}
              value={minNodeDegree}
              onChange={(e) => setMinNodeDegree(Math.max(0, Math.min(20, Number(e.target.value || 0))))}
            />
          </label>
        </div>
      </div>
      <svg
        className="graph-svg"
        viewBox={`0 0 ${width} ${height}`}
        onWheel={(e) => {
          e.preventDefault()
          const d = e.deltaY > 0 ? -0.08 : 0.08
          setZoom((z) => Math.max(0.5, Math.min(2.4, z + d)))
        }}
        onMouseDown={(e) => {
          if (e.target.closest(".graph-node-group")) return
          setSelectedNodeId("")
          if (onNodeSelect) onNodeSelect(null)
          dragStateRef.current = { x: e.clientX, y: e.clientY, panX: pan.x, panY: pan.y }
        }}
        onMouseMove={(e) => {
          const nodeDrag = nodeDragRef.current
          if (nodeDrag) {
            const dx = (e.clientX - nodeDrag.lastClientX) / Math.max(zoom, 0.001)
            const dy = (e.clientY - nodeDrag.lastClientY) / Math.max(zoom, 0.001)
            nodeDrag.lastClientX = e.clientX
            nodeDrag.lastClientY = e.clientY
            const current = nodeMap.get(nodeDrag.nodeId)
            if (current) {
              setNodeOverrides((all) => ({
                ...all,
                [nodeDrag.nodeId]: {
                  x: (all[nodeDrag.nodeId]?.x ?? current.x) + dx,
                  y: (all[nodeDrag.nodeId]?.y ?? current.y) + dy,
                },
              }))
            }
            return
          }
          const s = dragStateRef.current
          if (!s) return
          const dx = e.clientX - s.x
          const dy = e.clientY - s.y
          setPan({ x: s.panX + dx, y: s.panY + dy })
        }}
        onMouseUp={() => {
          dragStateRef.current = null
          nodeDragRef.current = null
        }}
        onMouseLeave={() => {
          dragStateRef.current = null
          nodeDragRef.current = null
        }}
      >
        <g transform={`translate(${pan.x},${pan.y}) scale(${zoom})`}>
          {edges.map((edge) => {
            const source = nodeMap.get(String(edge.source))
            const target = nodeMap.get(String(edge.target))
            if (!source || !target) return null
            const direct = isEdgeDirectlyConnected(edge)
            return (
              <line
                key={edge.id}
                x1={source.x}
                y1={source.y}
                x2={target.x}
                y2={target.y}
                className={direct ? "graph-edge graph-edge-direct" : "graph-edge graph-edge-dim"}
              />
            )
          })}
          {renderedNodes.map((node) => {
            const selected = String(selectedNodeId) === String(node.id)
            const direct = isNodeDirectlyConnected(node.id)
            const highlighted = isHighlightedInvoiceNode(node)
            const showLabel = shouldShowLabel(node, direct)
            return (
              <g
                key={node.id}
                onMouseDown={(e) => {
                  e.stopPropagation()
                  setSelectedNodeId(String(node.id))
                  if (onNodeSelect) onNodeSelect(node)
                  nodeDragRef.current = {
                    nodeId: String(node.id),
                    lastClientX: e.clientX,
                    lastClientY: e.clientY,
                  }
                }}
                className="graph-node-group"
              >
                <circle
                  cx={node.x}
                  cy={node.y}
                  r={selected ? 14 : (node.labels || []).includes("InvoiceLineGroup") ? 12 : 11}
                  fill={nodeColor(node)}
                  className={`${selected ? "graph-node selected" : direct ? "graph-node" : "graph-node graph-node-dim"}${highlighted ? " graph-node-hit" : ""}`}
                />
                {showLabel ? (
                  <text x={node.x + 16} y={node.y + 4} className={direct ? "graph-label" : "graph-label graph-label-dim"}>
                    {nodeLabel(node).slice(0, 48)}
                  </text>
                ) : null}
              </g>
            )
          })}
        </g>
      </svg>
      <div className="graph-node-detail">
        {!selectedNode ? (
          <span className="muted-inline">Knoten waehlen fuer Details.</span>
        ) : (
          <>
            <div className="graph-node-title">{(selectedNode.labels || []).join(", ") || "Node"}</div>
            <pre className="graph-node-json">{JSON.stringify(selectedNode.properties || {}, null, 2)}</pre>
          </>
        )}
      </div>
    </div>
  )
}

function UserView({ token, currentUser, onLogout }) {
  const [items, setItems] = useState([])
  const [selectedId, setSelectedId] = useState("")
  const [selectedInvoice, setSelectedInvoice] = useState(null)
  const [selectedLines, setSelectedLines] = useState([])
  const [selectedActions, setSelectedActions] = useState([])
  const [selectedCases, setSelectedCases] = useState([])
  const [caseNotes, setCaseNotes] = useState({})
  const [documentUrl, setDocumentUrl] = useState("")
  const [documentType, setDocumentType] = useState("")
  const [documentName, setDocumentName] = useState("")
  const [documentError, setDocumentError] = useState("")
  const [graphData, setGraphData] = useState(null)
  const [graphError, setGraphError] = useState("")
  const [graphSelection, setGraphSelection] = useState(null)
  const [graphQuestion, setGraphQuestion] = useState("")
  const [graphQuestionLoading, setGraphQuestionLoading] = useState(false)
  const [graphQuestionError, setGraphQuestionError] = useState("")
  const [graphQuestionResult, setGraphQuestionResult] = useState(null)
  const [actionComment, setActionComment] = useState("")
  const [headerFieldsOpen, setHeaderFieldsOpen] = useState(true)
  const [notice, setNotice] = useState("")
  const [statusFilter, setStatusFilter] = useState("NEEDS_REVIEW")
  const [search, setSearch] = useState("")
  const [error, setError] = useState("")
  const [loading, setLoading] = useState(false)

  async function loadInbox(nextSelectedId = "", nextStatus = statusFilter, nextSearch = search) {
    try {
      setLoading(true)
      setError("")
      const res = await listInvoices(token, {
        limit: 100,
        status: nextStatus || "",
        search: (nextSearch || "").trim(),
      })
      const nextItems = res.items || []
      setItems(nextItems)
      const keepId = nextSelectedId || selectedId
      if (keepId && nextItems.find((x) => x.id === keepId)) {
        await loadInvoiceDetail(keepId)
      } else if (nextItems[0]?.id) {
        await loadInvoiceDetail(nextItems[0].id)
      } else {
        setSelectedId("")
        setSelectedInvoice(null)
        setSelectedLines([])
        setSelectedActions([])
        setSelectedCases([])
        setGraphData(null)
        setGraphError("")
        setGraphSelection(null)
        setGraphQuestion("")
        setGraphQuestionError("")
        setGraphQuestionResult(null)
      }
    } catch (e) {
      setError(String(e.message || e))
    } finally {
      setLoading(false)
    }
  }

  async function loadInvoiceDetail(invoiceId) {
    try {
      setError("")
      setDocumentError("")
      const [invoiceRes, linesRes] = await Promise.all([
        getInvoice(token, invoiceId),
        listInvoiceLines(token, invoiceId),
      ])
      const actionsRes = await listInvoiceActions(token, invoiceId)
      let casesRes = []
      try {
        casesRes = await listInvoiceCases(token, invoiceId)
      } catch (caseErr) {
        // Case table might not be migrated yet; keep invoice detail usable.
        casesRes = []
      }
      const invoiceItem = invoiceRes.item || null

      if (documentUrl) {
        URL.revokeObjectURL(documentUrl)
      }
      if (invoiceItem?.id) {
        try {
          const doc = await getInvoiceDocumentBlob(token, invoiceId)
          const nextUrl = URL.createObjectURL(doc.blob)
          setDocumentUrl(nextUrl)
          setDocumentType(doc.contentType || "")
          setDocumentName(doc.filename || "document")
        } catch (docErr) {
          setDocumentUrl("")
          setDocumentType("")
          setDocumentName("")
          setDocumentError(String(docErr.message || docErr))
        }
        try {
          const graph = await getInvoiceGraph(token, invoiceId)
          setGraphData(graph)
          setGraphError("")
        } catch (gErr) {
          setGraphData(null)
          setGraphError(String(gErr.message || gErr))
        }
      } else {
        setDocumentUrl("")
        setDocumentType("")
        setDocumentName("")
        setGraphData(null)
        setGraphError("")
      }
      setSelectedId(invoiceId)
      setSelectedInvoice(invoiceItem)
      setSelectedLines(linesRes.items || [])
      setSelectedActions(actionsRes.items || [])
      setSelectedCases(casesRes || [])
      setGraphSelection(null)
      setGraphQuestionError("")
      setGraphQuestionResult(null)
    } catch (e) {
      setError(String(e.message || e))
    }
  }

  async function runGraphQuestion() {
    const question = String(graphQuestion || "").trim()
    if (!question) {
      setGraphQuestionError("Bitte eine Frage eingeben.")
      return
    }
    try {
      setGraphQuestionLoading(true)
      setGraphQuestionError("")
      const res = await askGraphQuestion(token, { question, maxRows: 100 })
      setGraphQuestionResult(res)
    } catch (e) {
      setGraphQuestionResult(null)
      setGraphQuestionError(String(e.message || e))
    } finally {
      setGraphQuestionLoading(false)
    }
  }

  async function runAction(actionName) {
    if (!selectedId) return
    try {
      setError("")
      setNotice("")
      if (actionName === "approve") {
        await invoiceApprove(token, selectedId, actionComment)
      } else if (actionName === "reject") {
        await invoiceReject(token, selectedId, actionComment)
      } else if (actionName === "hold") {
        await invoiceHold(token, selectedId, actionComment)
      } else if (actionName === "request_clarification") {
        await invoiceRequestClarification(token, selectedId, actionComment)
      }
      setActionComment("")
      await loadInbox(selectedId)
      setNotice(`Aktion ${actionName} erfolgreich`)
    } catch (e) {
      setError(String(e.message || e))
    }
  }

  async function runCaseUpdate(caseId, status) {
    try {
      setError("")
      setNotice("")
      const note = caseNotes[caseId] || ""
      await updateCase(token, caseId, {
        status,
        resolved_note: note,
      })
      await loadInvoiceDetail(selectedId)
      setNotice(`Case auf ${status} gesetzt`)
    } catch (e) {
      setError(String(e.message || e))
    }
  }

  function onGraphNodeSelect(node) {
    if (!node) {
      setGraphSelection(null)
      return
    }
    const labels = node.labels || []
    const properties = node.properties || {}
    if (labels.includes("InvoiceLine")) {
      const lineNo = Number(properties.line_no || 0)
      setGraphSelection({ type: "line", lineNo })
      return
    }
    if (labels.includes("InvoiceAction")) {
      const actionType = String(properties.action_type || "")
      setGraphSelection({ type: "action", actionType })
      return
    }
    if (labels.includes("Supplier")) {
      const supplierName = String(properties.name || "")
      setGraphSelection({ type: "supplier", supplierName })
      return
    }
    setGraphSelection({ type: "other", raw: properties })
  }

  useEffect(() => {
    loadInbox()
  }, [])

  useEffect(() => {
    return () => {
      if (documentUrl) {
        URL.revokeObjectURL(documentUrl)
      }
    }
  }, [documentUrl])

  const extractedHeaderRows = useMemo(
    () => (selectedInvoice ? buildExtractedHeaderRows(selectedInvoice) : []),
    [selectedInvoice],
  )
  const userGraphHighlights = useMemo(
    () => extractGraphResultInvoiceKeys(graphQuestionResult),
    [graphQuestionResult],
  )

  return (
    <main className="app-layout inbox-layout">
      <header className="header">
        <h2>View Invoices</h2>
        <div className="header-user">
          Angemeldet als <span>{currentUser?.username}</span>
          <button className="btn btn-outline-light btn-sm" onClick={onLogout}>Logout</button>
        </div>
      </header>

      <section className="card">
        <div className="card-body inbox-filterbar">
          <form
            className="inbox-filter-form"
            onSubmit={async (e) => {
              e.preventDefault()
              await loadInbox()
            }}
          >
            <select className="input" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
              <option value="">alle Status</option>
              <option value="NEEDS_REVIEW">NEEDS_REVIEW</option>
              <option value="VALIDATED">VALIDATED</option>
              <option value="MAPPED">MAPPED</option>
              <option value="PENDING_APPROVAL">PENDING_APPROVAL</option>
              <option value="APPROVED">APPROVED</option>
              <option value="REJECTED">REJECTED</option>
              <option value="ON_HOLD">ON_HOLD</option>
              <option value="CLARIFICATION_REQUESTED">CLARIFICATION_REQUESTED</option>
            </select>
            <input
              className="input"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Suche nach Lieferant oder Rechnungsnummer"
            />
            <button className="btn btn-primary" type="submit" disabled={loading}>
              {loading ? "Lade..." : "Filtern"}
            </button>
            <button
              className="btn btn-outline"
              type="button"
              onClick={async () => {
                const resetStatus = "NEEDS_REVIEW"
                const resetSearch = ""
                setStatusFilter(resetStatus)
                setSearch(resetSearch)
                await loadInbox("", resetStatus, resetSearch)
              }}
            >
              Reset
            </button>
          </form>
        </div>
      </section>

      <section className="inbox-split">
        <div className="card inbox-list-card">
          <div className="card-header"><h3>Rechnungen ({items.length})</h3></div>
          <div className="inbox-list">
            {items.length === 0 ? (
              <div className="inbox-empty">Keine Rechnungen gefunden.</div>
            ) : (
              items.map((inv) => {
                const isActive = selectedId === inv.id
                return (
                  <button
                    key={inv.id}
                    type="button"
                    className={`inbox-item ${isActive ? "active" : ""}`}
                    onClick={() => loadInvoiceDetail(inv.id)}
                  >
                    <div className="inbox-item-number">{inv.invoice_number || "-"}</div>
                    <div className="inbox-item-date">{inv.invoice_date || "-"}</div>
                    <div className="inbox-item-supplier">{inv.supplier_name || "-"}</div>
                  </button>
                )
              })
            )}
          </div>
        </div>

        <div className="card inbox-detail-card">
          <div className="card-header">
            <h3>{selectedInvoice?.invoice_number ? `Rechnung ${selectedInvoice.invoice_number}` : "Rechnungsdetail"}</h3>
          </div>
          <div className="card-body">
            {!selectedInvoice ? (
              <p className="muted">Keine Rechnung ausgewaehlt.</p>
            ) : (
              <>
                <div className="invoice-meta-grid">
                  <div>
                    <div className="invoice-label">RECHNUNGSNUMMER</div>
                    <div className="invoice-value">{selectedInvoice.invoice_number || "-"}</div>
                  </div>
                  <div>
                    <div className="invoice-label">DATUM</div>
                    <div className="invoice-value">{selectedInvoice.invoice_date || "-"}</div>
                  </div>
                  <div>
                    <div className="invoice-label">GESAMTPREIS</div>
                    <div className="invoice-value invoice-price">
                      {formatMoney(selectedInvoice.gross_amount)} {selectedInvoice.currency || ""}
                    </div>
                  </div>
                  <div>
                    <div className="invoice-label">STATUS</div>
                    <div className="invoice-value">{selectedInvoice.status || "-"}</div>
                  </div>
                </div>

                <div className="invoice-divider" />
                <div className="invoice-label">LEISTUNGSERBRINGER</div>
                <div className="invoice-detail-block">
                  <div className="invoice-label">NAME</div>
                  <div className="invoice-value">{selectedInvoice.supplier_name || "-"}</div>
                </div>

                <div className="invoice-divider" />
                <div className="section-toggle-row">
                  <div className="invoice-label">EXTRAHIERTE FELDER (HEADER)</div>
                  <button
                    className="btn btn-outline btn-sm"
                    type="button"
                    onClick={() => setHeaderFieldsOpen((v) => !v)}
                  >
                    {headerFieldsOpen ? "Einklappen" : "Ausklappen"}
                  </button>
                </div>
                {headerFieldsOpen ? (
                  extractedHeaderRows.length === 0 ? (
                    <p className="muted-inline">Keine konfigurierten Header-Felder im Mapping-Snapshot gefunden.</p>
                  ) : (
                    <table className="table">
                      <thead>
                        <tr>
                          <th>FELD</th>
                          <th>WERT</th>
                          <th>LLM</th>
                        </tr>
                      </thead>
                      <tbody>
                        {extractedHeaderRows.map((row) => (
                          <tr key={row.field_name}>
                            <td>
                              <div className="mono">{row.field_name}</div>
                              {row.description ? <div className="muted-inline">{row.description}</div> : null}
                            </td>
                            <td>{row.has_value ? String(row.value) : <span className="muted-inline">-</span>}</td>
                            <td>{row.provided_by_llm ? "ja" : "nein"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )
                ) : (
                  <p className="muted-inline">Header-Felder eingeklappt.</p>
                )}

                <div className="invoice-divider" />
                <div className="invoice-actions">
                  <div className="invoice-actions-comment-row">
                    <input
                      className="input"
                      value={actionComment}
                      onChange={(e) => setActionComment(e.target.value)}
                      placeholder="Kommentar (optional)"
                    />
                  </div>
                  <div className="invoice-actions-button-row">
                    <button className="btn btn-primary" type="button" onClick={() => runAction("approve")}>
                      Approve
                    </button>
                    <button className="btn btn-outline" type="button" onClick={() => runAction("reject")}>
                      Reject
                    </button>
                    <button className="btn btn-outline" type="button" onClick={() => runAction("hold")}>
                      Hold
                    </button>
                    <button className="btn btn-outline" type="button" onClick={() => runAction("request_clarification")}>
                      Clarify
                    </button>
                    <button
                      className="btn btn-outline"
                      type="button"
                      onClick={async () => {
                        try {
                          if (!selectedId) return
                          const reason = String(actionComment || "").trim()
                          if (!reason) throw new Error("Bitte Begruendung im Kommentarfeld eintragen.")
                          setError("")
                          setNotice("")
                          await createInvoiceDeleteRequest(token, selectedId, reason)
                          setActionComment("")
                          setNotice("Loeschantrag erstellt (warte auf Admin-Freigabe)")
                        } catch (e) {
                          setError(String(e.message || e))
                        }
                      }}
                    >
                      Loeschung anfordern
                    </button>
                  </div>
                </div>

                <div className="invoice-divider" />
                <div className="invoice-label">LEISTUNGEN</div>
                <table className="table">
                  <thead>
                    <tr>
                      <th>#</th>
                      <th>BEZEICHNUNG</th>
                      <th>MENGE</th>
                      <th>WERT</th>
                      <th>STEUER</th>
                    </tr>
                  </thead>
                  <tbody>
                    {selectedLines.length === 0 ? (
                      <tr><td colSpan={5}>Keine Positionen gefunden.</td></tr>
                    ) : (
                      selectedLines.map((line) => (
                        <tr
                          key={line.id}
                          className={
                            graphSelection?.type === "line" && Number(line.line_no || 0) === Number(graphSelection.lineNo || -1)
                              ? "row-highlight"
                              : ""
                          }
                        >
                          <td>{line.line_no ?? "-"}</td>
                          <td>{line.description || "-"}</td>
                          <td>{line.quantity ?? "-"}</td>
                          <td>{formatMoney(line.line_amount)}</td>
                          <td>{line.tax_rate ?? "-"}</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>

                <div className="invoice-divider" />
                <div className="invoice-label">AKTIONSHISTORIE</div>
                <table className="table">
                  <thead>
                    <tr>
                      <th>ZEIT</th>
                      <th>AKTION</th>
                      <th>VON</th>
                      <th>NACH</th>
                      <th>USER</th>
                    </tr>
                  </thead>
                  <tbody>
                    {selectedActions.length === 0 ? (
                      <tr><td colSpan={5}>Keine Aktionen vorhanden.</td></tr>
                    ) : (
                      selectedActions.map((a) => (
                        <tr
                          key={a.id}
                          className={
                            graphSelection?.type === "action" && String(a.action_type || "") === String(graphSelection.actionType || "")
                              ? "row-highlight"
                              : ""
                          }
                        >
                          <td>{a.created_at || "-"}</td>
                          <td>{a.action_type || "-"}</td>
                          <td>{a.from_status || "-"}</td>
                          <td>{a.to_status || "-"}</td>
                          <td>{a.actor_username || "-"}</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>

                <div className="invoice-divider" />
                <div className="invoice-label">CASES / RUECKFRAGEN</div>
                <table className="table">
                  <thead>
                    <tr>
                      <th>TITEL</th>
                      <th>STATUS</th>
                      <th>VON</th>
                      <th>NOTE</th>
                      <th>AKTION</th>
                    </tr>
                  </thead>
                  <tbody>
                    {selectedCases.length === 0 ? (
                      <tr><td colSpan={5}>Keine Cases vorhanden.</td></tr>
                    ) : (
                      selectedCases.map((c) => (
                        <tr key={c.id}>
                          <td>{c.title || "-"}</td>
                          <td>{c.status || "-"}</td>
                          <td>{c.created_by_username || "-"}</td>
                          <td>
                            <input
                              className="input"
                              value={caseNotes[c.id] ?? c.resolved_note ?? ""}
                              onChange={(e) => setCaseNotes((all) => ({ ...all, [c.id]: e.target.value }))}
                              placeholder="Kommentar"
                            />
                          </td>
                          <td>
                            <div className="actions-row">
                              <button className="btn btn-outline btn-sm" type="button" onClick={() => runCaseUpdate(c.id, "IN_PROGRESS")}>In Progress</button>
                              <button className="btn btn-outline btn-sm" type="button" onClick={() => runCaseUpdate(c.id, "RESOLVED")}>Resolve</button>
                              <button className="btn btn-outline btn-sm" type="button" onClick={() => runCaseUpdate(c.id, "CLOSED")}>Close</button>
                            </div>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>

                <div className="invoice-divider" />
                <div className="row">
                  <div className="invoice-label">GRAPH</div>
                  <button
                    className="btn btn-outline btn-sm"
                    type="button"
                    onClick={async () => {
                      try {
                        setGraphError("")
                        const graph = await getInvoiceGraph(token, selectedId)
                        setGraphData(graph)
                      } catch (gErr) {
                        setGraphData(null)
                        setGraphError(String(gErr.message || gErr))
                      }
                    }}
                  >
                    Graph neu laden
                  </button>
                </div>
                <div className="graph-question-box">
                  <form
                    className="graph-question-form"
                    onSubmit={async (e) => {
                      e.preventDefault()
                      await runGraphQuestion()
                    }}
                  >
                    <input
                      className="input"
                      value={graphQuestion}
                      onChange={(e) => setGraphQuestion(e.target.value)}
                      placeholder="Frage an den Graphen, z. B. Welche Rechnungen sind in EUR gestellt?"
                    />
                    <button className="btn btn-outline" type="submit" disabled={graphQuestionLoading}>
                      {graphQuestionLoading ? "Frage laeuft..." : "Graph fragen"}
                    </button>
                  </form>
                  {graphQuestionError ? <p className="error">{graphQuestionError}</p> : null}
                  {graphQuestionResult ? (
                    <div className="graph-question-result">
                      <p className="muted-inline">
                        <strong>Antwort:</strong> {graphQuestionResult.answer_text || "-"}
                      </p>
                      {graphQuestionResult.match_mode ? (
                        <p className="muted-inline">
                          <strong>Modus:</strong> {graphQuestionResult.match_mode === "flexible"
                            ? "flexibel (LLM-Fallback)"
                            : graphQuestionResult.match_mode === "semantic_contains"
                              ? "flexibel (semantic contains)"
                              : graphQuestionResult.match_mode === "fallback_no_match"
                                ? "fallback versucht (kein Treffer)"
                              : "direkt"}
                        </p>
                      ) : null}
                      {graphQuestionResult.explanation ? (
                        <p className="muted-inline">
                          <strong>Interpretation:</strong> {graphQuestionResult.explanation}
                        </p>
                      ) : null}
                      {graphQuestionResult.cypher_primary && graphQuestionResult.cypher_primary !== graphQuestionResult.cypher ? (
                        <>
                          <div className="invoice-label">PRIMAERE CYPHER-QUERY</div>
                          <pre className="graph-node-json">{graphQuestionResult.cypher_primary}</pre>
                        </>
                      ) : null}
                      <div className="invoice-label">GENERIERTE CYPHER-QUERY</div>
                      <pre className="graph-node-json">{graphQuestionResult.cypher || "-"}</pre>
                      <div className="invoice-label">ERGEBNIS ({graphQuestionResult.row_count || 0})</div>
                      {(graphQuestionResult.rows || []).length === 0 ? (
                        <p className="muted-inline">Keine Treffer.</p>
                      ) : (
                        <table className="table">
                          <thead>
                            <tr>
                              {(graphQuestionResult.columns || Object.keys(graphQuestionResult.rows[0] || {})).map((col) => (
                                <th key={col}>{String(col || "-")}</th>
                              ))}
                            </tr>
                          </thead>
                          <tbody>
                            {(graphQuestionResult.rows || []).map((row, idx) => (
                              <tr key={`gq-row-${idx}`}>
                                {(graphQuestionResult.columns || Object.keys(row || {})).map((col) => (
                                  <td key={`${idx}:${col}`}>{row?.[col] == null ? "-" : String(row[col])}</td>
                                ))}
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      )}
                      {graphQuestionResult.truncated ? (
                        <p className="muted-inline">Ergebnis gekuerzt (LIMIT aktiv).</p>
                      ) : null}
                    </div>
                  ) : null}
                </div>
                {graphError ? <p className="error">{graphError}</p> : null}
                {graphData ? (
                  <GraphCanvas
                    graphData={graphData}
                    onNodeSelect={onGraphNodeSelect}
                    rootNodeId={selectedId}
                    showRootComponentOnly={true}
                    highlightInvoiceIds={userGraphHighlights.invoiceIds}
                    highlightInvoiceNumbers={userGraphHighlights.invoiceNumbers}
                  />
                ) : (
                  <p className="muted-inline">Kein Graph geladen.</p>
                )}
                {graphSelection?.type === "supplier" ? (
                  <p className="muted-inline">Graph-Auswahl Lieferant: {graphSelection.supplierName || "-"}</p>
                ) : null}
              </>
            )}
          </div>
        </div>

        <div className="card inbox-pdf-card">
          <div className="card-header"><h3>PDF / Dokument</h3></div>
          <div className="card-body pdf-viewer">
            {documentError ? <p className="error">{documentError}</p> : null}
            {!selectedInvoice ? (
              <p className="muted">Keine Rechnung ausgewaehlt.</p>
            ) : !documentUrl ? (
              <p className="muted">Kein Dokument verfuegbar.</p>
            ) : documentType.includes("pdf") ? (
              <iframe title="invoice-pdf" src={documentUrl} className="pdf-frame" />
            ) : documentType.startsWith("image/") ? (
              <img className="pdf-image" src={documentUrl} alt={documentName || "Dokument"} />
            ) : (
              <div className="pdf-empty">
                <p className="muted">Vorschau fuer diesen Dateityp nicht verfuegbar.</p>
                <a className="btn btn-outline" href={documentUrl} download={documentName || "document"}>
                  Download
                </a>
              </div>
            )}
          </div>
        </div>
      </section>

      {notice ? <p className="notice">{notice}</p> : null}
      {error ? <p className="error">{error}</p> : null}
    </main>
  )
}

export default function App() {
  const [token, setToken] = useState(localStorage.getItem("access_token") || "")
  const [currentUser, setCurrentUser] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")

  async function handleLogin({ mode, username, email, password }) {
    try {
      setLoading(true)
      setError("")
      if (mode === "register") {
        await register(username, email, password)
      }
      const result = await login(username, password)
      localStorage.setItem("access_token", result.access_token)
      setToken(result.access_token)
      const user = await me(result.access_token)
      setCurrentUser(user)
    } catch (e) {
      setError(String(e.message || e))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (!token) return
    me(token)
      .then((user) => setCurrentUser(user))
      .catch(() => {
        localStorage.removeItem("access_token")
        setToken("")
      })
  }, [token])

  async function handleLogout() {
    try {
      if (token) {
        await logout(token)
      }
    } catch {
      // ignore logout API errors; local sign-out still applies
    }
    localStorage.removeItem("access_token")
    setToken("")
    setCurrentUser(null)
    setError("")
  }

  if (!token) {
    return (
      <LoginView onLogin={handleLogin} loading={loading} error={error} />
    )
  }

  const isAdmin = (currentUser?.roles || []).includes("ADMIN")
  if (isAdmin) {
    return <AdminView token={token} currentUser={currentUser} onLogout={handleLogout} />
  }
  return <UserView token={token} currentUser={currentUser} onLogout={handleLogout} />
}
