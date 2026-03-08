import { useEffect, useMemo, useRef, useState } from "react"
import {
  createUser,
  extractDocuments,
  getInvoice,
  getInvoiceGraph,
  getGlobalGraph,
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
  listDocuments,
  listProviders,
  listUsers,
  login,
  mapInvoices,
  logout,
  me,
  pullMinio,
  register,
  resetInvoicePipeline,
  updateProvider,
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
  const [graphSyncLimit, setGraphSyncLimit] = useState(200)
  const [globalGraphData, setGlobalGraphData] = useState(null)
  const [globalGraphError, setGlobalGraphError] = useState("")
  const [globalGraphMaxNodes, setGlobalGraphMaxNodes] = useState(500)
  const [globalGraphMaxEdges, setGlobalGraphMaxEdges] = useState(1200)
  const [resetGraph, setResetGraph] = useState(true)
  const [adminTab, setAdminTab] = useState("kpi")
  const [graphFieldOptions, setGraphFieldOptions] = useState(CORE_GRAPH_FIELD_OPTIONS)
  const [selectedGraphFields, setSelectedGraphFields] = useState(CORE_GRAPH_FIELD_OPTIONS)
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

  useEffect(() => {
    loadUsers()
    loadProvidersConfig()
    loadMinioConnector()
    loadDocumentsList()
    loadInvoicesList()
    loadExtractionFields()
    loadGraphConfig()
    loadWorkflowRules()
    loadKpi()
  }, [])

  const isAdmin = useMemo(() => (currentUser?.roles || []).includes("ADMIN"), [currentUser])

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
                  </div>
                </>
              )}
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
                    onClick={async () => {
                      try {
                        setError("")
                        setNotice("")
                        const res = await pullMinio(token, minio.max_objects || 200)
                        setNotice(`MinIO Pull: ${res.created} neu, ${res.skipped} uebersprungen`)
                        await loadDocumentsList()
                      } catch (err) {
                        setError(String(err.message || err))
                      }
                    }}
                  >
                    Pull ausfuehren
                  </button>
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
              {globalGraphData ? <GraphCanvas graphData={globalGraphData} /> : null}
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
              <button className="btn btn-outline" onClick={loadDocumentsList}>Neu laden</button>
            </div>
            <div className="card-body">
              <table className="table">
                <thead>
                  <tr>
                    <th>Datei</th>
                    <th>Typ</th>
                    <th>Status</th>
                    <th>Quelle</th>
                  </tr>
                </thead>
                <tbody>
                  {documents.map((d) => (
                    <tr key={d.id}>
                      <td>{d.filename}</td>
                      <td>{d.file_type}</td>
                      <td>{d.status}</td>
                      <td className="mono">{d.source_uri}</td>
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
        </>
      )}
    </main>
  )
}

function GraphCanvas({ graphData, onNodeSelect }) {
  const width = 760
  const height = 360
  const [zoom, setZoom] = useState(1)
  const [pan, setPan] = useState({ x: 0, y: 0 })
  const [selectedNodeId, setSelectedNodeId] = useState("")
  const [layerMode, setLayerMode] = useState("data")
  const dragStateRef = useRef(null)

  const { nodes, edges } = useMemo(() => {
    const rawNodes = (graphData?.nodes || []).map((n) => ({ ...n }))
    const rawEdges = (graphData?.edges || []).map((e) => ({ ...e }))

    const layerConfig = {
      all: {
        labels: null,
        edges: null,
      },
      data: {
        labels: new Set(["Invoice", "Supplier", "InvoiceLine", "Currency", "InvoiceDataField"]),
        edges: new Set(["BELONGS_TO", "HAS_LINE", "IN_CURRENCY", "HAS_DATA_FIELD"]),
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

    const centerX = width / 2
    const centerY = height / 2
    const radius = Math.max(90, Math.min(width, height) * 0.34)

    const positioned = filteredNodes.map((n, idx) => {
      const angle = (idx / Math.max(1, filteredNodes.length)) * Math.PI * 2
      return {
        ...n,
        x: centerX + Math.cos(angle) * radius,
        y: centerY + Math.sin(angle) * radius,
      }
    })

    return { nodes: positioned, edges: filteredEdges }
  }, [graphData, layerMode])

  const nodeMap = useMemo(() => {
    const m = new Map()
    for (const n of nodes) m.set(String(n.id), n)
    return m
  }, [nodes])

  const selectedNode = useMemo(
    () => nodes.find((n) => String(n.id) === String(selectedNodeId)) || null,
    [nodes, selectedNodeId],
  )

  useEffect(() => {
    setSelectedNodeId("")
    if (onNodeSelect) onNodeSelect(null)
  }, [graphData])

  useEffect(() => {
    if (!selectedNodeId) return
    if (!nodes.find((n) => String(n.id) === String(selectedNodeId))) {
      setSelectedNodeId("")
      if (onNodeSelect) onNodeSelect(null)
    }
  }, [nodes, selectedNodeId, onNodeSelect])

  function nodeLabel(node) {
    const labels = node.labels || []
    const p = node.properties || {}
    if (labels.includes("Invoice")) return p.invoice_number || p.id || "Invoice"
    if (labels.includes("Supplier")) return p.name || "Supplier"
    if (labels.includes("InvoiceLine")) return p.description || `Line ${p.line_no || ""}`.trim()
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
    if (labels.includes("InvoiceDataField")) return "#475569"
    if (labels.includes("InvoiceAction")) return "#1f7a4a"
    if (labels.includes("User")) return "#6d28d9"
    if (labels.includes("InvoiceStatus")) return "#0f766e"
    return "#334155"
  }

  return (
    <div className="graph-panel">
      <div className="graph-toolbar">
        <span className="muted-inline">Knoten: {nodes.length} | Kanten: {edges.length}</span>
        <div className="actions-row">
          <select className="input btn-sm" value={layerMode} onChange={(e) => setLayerMode(e.target.value)}>
            <option value="data">Datenebene</option>
            <option value="app">Anwendungsebene</option>
            <option value="all">Alles</option>
          </select>
          <button className="btn btn-outline btn-sm" type="button" onClick={() => setZoom((z) => Math.min(2.4, z + 0.1))}>+</button>
          <button className="btn btn-outline btn-sm" type="button" onClick={() => setZoom((z) => Math.max(0.5, z - 0.1))}>-</button>
          <button className="btn btn-outline btn-sm" type="button" onClick={() => { setZoom(1); setPan({ x: 0, y: 0 }) }}>Reset</button>
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
          if (e.target.closest("circle")) return
          dragStateRef.current = { x: e.clientX, y: e.clientY, panX: pan.x, panY: pan.y }
        }}
        onMouseMove={(e) => {
          const s = dragStateRef.current
          if (!s) return
          const dx = e.clientX - s.x
          const dy = e.clientY - s.y
          setPan({ x: s.panX + dx, y: s.panY + dy })
        }}
        onMouseUp={() => { dragStateRef.current = null }}
        onMouseLeave={() => { dragStateRef.current = null }}
      >
        <g transform={`translate(${pan.x},${pan.y}) scale(${zoom})`}>
          {edges.map((edge) => {
            const source = nodeMap.get(String(edge.source))
            const target = nodeMap.get(String(edge.target))
            if (!source || !target) return null
            return (
              <line
                key={edge.id}
                x1={source.x}
                y1={source.y}
                x2={target.x}
                y2={target.y}
                className="graph-edge"
              />
            )
          })}
          {nodes.map((node) => {
            const selected = String(selectedNodeId) === String(node.id)
            return (
              <g
                key={node.id}
                onClick={() => {
                  setSelectedNodeId(String(node.id))
                  if (onNodeSelect) onNodeSelect(node)
                }}
                className="graph-node-group"
              >
                <circle
                  cx={node.x}
                  cy={node.y}
                  r={selected ? 14 : 11}
                  fill={nodeColor(node)}
                  className={selected ? "graph-node selected" : "graph-node"}
                />
                <text x={node.x + 16} y={node.y + 4} className="graph-label">
                  {nodeLabel(node).slice(0, 48)}
                </text>
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
  const [actionComment, setActionComment] = useState("")
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
    } catch (e) {
      setError(String(e.message || e))
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
                      {selectedInvoice.gross_amount ?? "-"} {selectedInvoice.currency || ""}
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
                <div className="invoice-label">EXTRAHIERTE FELDER (HEADER)</div>
                {extractedHeaderRows.length === 0 ? (
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
                )}

                <div className="invoice-divider" />
                <div className="invoice-actions">
                  <input
                    className="input"
                    value={actionComment}
                    onChange={(e) => setActionComment(e.target.value)}
                    placeholder="Kommentar (optional)"
                  />
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
                          <td>{line.line_amount ?? "-"}</td>
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
                {graphError ? <p className="error">{graphError}</p> : null}
                {graphData ? (
                  <GraphCanvas graphData={graphData} onNodeSelect={onGraphNodeSelect} />
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
