import { useEffect, useMemo, useState } from "react"
import {
  createUser,
  extractDocuments,
  getInvoice,
  getInvoiceGraph,
  getInvoiceDocumentBlob,
  invoiceApprove,
  invoiceHold,
  invoiceReject,
  listExtractionFields,
  listInvoiceActions,
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
  updateProvider,
  upsertExtractionField,
  syncInvoicesGraphBulk,
  validateInvoices,
  testConnector,
  updateConnector,
} from "./api"

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

  useEffect(() => {
    loadUsers()
    loadProvidersConfig()
    loadMinioConnector()
    loadDocumentsList()
    loadInvoicesList()
    loadExtractionFields()
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

      {!isAdmin ? (
        <section className="card">
          <div className="card-body"><p>Kein Admin-Zugriff.</p></div>
        </section>
      ) : (
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

          <section className="card">
            <div className="card-header"><h3>Graph Sync (Neo4j)</h3></div>
            <div className="card-body">
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
              </div>
            </div>
          </section>

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
        </>
      )}

      {notice ? <p className="notice">{notice}</p> : null}
      {error ? <p className="error">{error}</p> : null}
    </main>
  )
}

function UserView({ token, currentUser, onLogout }) {
  const [items, setItems] = useState([])
  const [selectedId, setSelectedId] = useState("")
  const [selectedInvoice, setSelectedInvoice] = useState(null)
  const [selectedLines, setSelectedLines] = useState([])
  const [selectedActions, setSelectedActions] = useState([])
  const [documentUrl, setDocumentUrl] = useState("")
  const [documentType, setDocumentType] = useState("")
  const [documentName, setDocumentName] = useState("")
  const [documentError, setDocumentError] = useState("")
  const [graphData, setGraphData] = useState(null)
  const [graphError, setGraphError] = useState("")
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
        setGraphData(null)
        setGraphError("")
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
      }
      setActionComment("")
      await loadInbox(selectedId)
      setNotice(`Aktion ${actionName} erfolgreich`)
    } catch (e) {
      setError(String(e.message || e))
    }
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
                        <tr key={line.id}>
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
                        <tr key={a.id}>
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
                  <p className="muted-inline">
                    Knoten: {(graphData.nodes || []).length} | Kanten: {(graphData.edges || []).length}
                  </p>
                ) : (
                  <p className="muted-inline">Kein Graph geladen.</p>
                )}
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
