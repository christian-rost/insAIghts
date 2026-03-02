import { useEffect, useMemo, useState } from "react"
import {
  createUser,
  extractDocuments,
  listExtractionFields,
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
      const res = await listInvoices(token, 50)
      setInvoices(res.items || [])
    } catch (e) {
      setError(String(e.message || e))
    }
  }

  async function loadExtractionFields() {
    try {
      const rows = await listExtractionFields(token, "invoice", false)
      setExtractionFields(rows || [])
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
                    <th>Aktion</th>
                  </tr>
                </thead>
                <tbody>
                  {extractionFields.map((f) => (
                    <tr key={`${f.scope}:${f.field_name}`}>
                      <td>{f.scope}</td>
                      <td className="mono">{f.field_name}</td>
                      <td>{f.description}</td>
                      <td>{f.data_type}</td>
                      <td>{f.is_required ? "ja" : "nein"}</td>
                      <td>{f.is_enabled ? "ja" : "nein"}</td>
                      <td>
                        <button
                          className="btn btn-outline"
                          type="button"
                          onClick={async () => {
                            try {
                              setError("")
                              setNotice("")
                              await upsertExtractionField(token, {
                                entity_name: f.entity_name,
                                scope: f.scope,
                                field_name: f.field_name,
                                description: f.description,
                                data_type: f.data_type,
                                is_required: !!f.is_required,
                                is_enabled: !f.is_enabled,
                                sort_order: Number(f.sort_order || 0),
                              })
                              await loadExtractionFields()
                              setNotice(`Feld ${f.field_name} aktualisiert`)
                            } catch (err) {
                              setError(String(err.message || err))
                            }
                          }}
                        >
                          {f.is_enabled ? "Deaktivieren" : "Aktivieren"}
                        </button>
                      </td>
                    </tr>
                  ))}
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

  return <AdminView token={token} currentUser={currentUser} onLogout={handleLogout} />
}
