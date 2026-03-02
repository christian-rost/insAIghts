const API_BASE = import.meta.env.VITE_API_BASE || "http://localhost:8000"

function authHeaders(token) {
  return token ? { Authorization: `Bearer ${token}` } : {}
}

async function handleJson(response) {
  if (!response.ok) {
    let message = `${response.status} ${response.statusText}`
    try {
      const body = await response.json()
      if (body?.detail) message = body.detail
    } catch {
      // ignore non-json
    }
    throw new Error(message)
  }
  return response.json()
}

export async function login(username, password) {
  const response = await fetch(`${API_BASE}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password }),
  })
  return handleJson(response)
}

export async function register(username, email, password) {
  const response = await fetch(`${API_BASE}/api/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, email, password }),
  })
  return handleJson(response)
}

export async function me(token) {
  const response = await fetch(`${API_BASE}/api/auth/me`, {
    headers: { ...authHeaders(token) },
  })
  return handleJson(response)
}

export async function logout(token) {
  const response = await fetch(`${API_BASE}/api/auth/logout`, {
    method: "POST",
    headers: { ...authHeaders(token) },
  })
  return handleJson(response)
}

export async function listUsers(token) {
  const response = await fetch(`${API_BASE}/api/admin/users`, {
    headers: { ...authHeaders(token) },
  })
  return handleJson(response)
}

export async function createUser(token, payload) {
  const response = await fetch(`${API_BASE}/api/admin/users`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...authHeaders(token),
    },
    body: JSON.stringify(payload),
  })
  return handleJson(response)
}

export async function listConnectors(token) {
  const response = await fetch(`${API_BASE}/api/admin/config/connectors`, {
    headers: { ...authHeaders(token) },
  })
  return handleJson(response)
}

export async function listProviders(token) {
  const response = await fetch(`${API_BASE}/api/admin/config/providers`, {
    headers: { ...authHeaders(token) },
  })
  return handleJson(response)
}

export async function updateProvider(token, providerName, payload) {
  const response = await fetch(`${API_BASE}/api/admin/config/providers/${providerName}`, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      ...authHeaders(token),
    },
    body: JSON.stringify(payload),
  })
  return handleJson(response)
}

export async function updateConnector(token, connectorName, payload) {
  const response = await fetch(`${API_BASE}/api/admin/config/connectors/${connectorName}`, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      ...authHeaders(token),
    },
    body: JSON.stringify(payload),
  })
  return handleJson(response)
}

export async function testConnector(token, connectorName) {
  const response = await fetch(`${API_BASE}/api/admin/config/connectors/${connectorName}/test`, {
    method: "POST",
    headers: { ...authHeaders(token) },
  })
  return handleJson(response)
}

export async function pullMinio(token, maxObjects = 200) {
  const response = await fetch(`${API_BASE}/api/ingestion/minio/pull`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...authHeaders(token),
    },
    body: JSON.stringify({ max_objects: maxObjects }),
  })
  return handleJson(response)
}

export async function listDocuments(token, limit = 50) {
  const response = await fetch(`${API_BASE}/api/documents?limit=${encodeURIComponent(limit)}`, {
    headers: { ...authHeaders(token) },
  })
  return handleJson(response)
}

export async function extractDocuments(token, maxDocuments = 20) {
  const response = await fetch(`${API_BASE}/api/processing/documents/extract`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...authHeaders(token),
    },
    body: JSON.stringify({ max_documents: maxDocuments }),
  })
  return handleJson(response)
}

export async function mapInvoices(token, maxDocuments = 20) {
  const response = await fetch(`${API_BASE}/api/processing/invoices/map`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...authHeaders(token),
    },
    body: JSON.stringify({ max_documents: maxDocuments }),
  })
  return handleJson(response)
}

export async function listInvoices(token, { limit = 50, status = "", search = "" } = {}) {
  const qs = new URLSearchParams({ limit: String(limit) })
  if (status) qs.set("status", status)
  if (search) qs.set("search", search)
  const response = await fetch(`${API_BASE}/api/invoices?${qs.toString()}`, {
    headers: { ...authHeaders(token) },
  })
  return handleJson(response)
}

export async function getInvoice(token, invoiceId) {
  const response = await fetch(`${API_BASE}/api/invoices/${encodeURIComponent(invoiceId)}`, {
    headers: { ...authHeaders(token) },
  })
  return handleJson(response)
}

export async function listInvoiceLines(token, invoiceId) {
  const response = await fetch(`${API_BASE}/api/invoices/${encodeURIComponent(invoiceId)}/lines`, {
    headers: { ...authHeaders(token) },
  })
  return handleJson(response)
}

export async function listInvoiceActions(token, invoiceId) {
  const response = await fetch(`${API_BASE}/api/invoices/${encodeURIComponent(invoiceId)}/actions`, {
    headers: { ...authHeaders(token) },
  })
  return handleJson(response)
}

export async function getInvoiceDocumentBlob(token, invoiceId) {
  const response = await fetch(`${API_BASE}/api/invoices/${encodeURIComponent(invoiceId)}/document`, {
    headers: { ...authHeaders(token) },
  })
  if (!response.ok) {
    let message = `${response.status} ${response.statusText}`
    try {
      const body = await response.json()
      if (body?.detail) message = body.detail
    } catch {
      // ignore non-json
    }
    throw new Error(message)
  }
  const blob = await response.blob()
  const contentType = response.headers.get("content-type") || ""
  const disposition = response.headers.get("content-disposition") || ""
  const m = disposition.match(/filename=\"?([^\";]+)\"?/)
  const filename = m ? m[1] : "document"
  return { blob, contentType, filename }
}

export async function invoiceApprove(token, invoiceId, comment = "") {
  const response = await fetch(`${API_BASE}/api/invoices/${encodeURIComponent(invoiceId)}/approve`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders(token) },
    body: JSON.stringify({ comment }),
  })
  return handleJson(response)
}

export async function invoiceReject(token, invoiceId, comment = "") {
  const response = await fetch(`${API_BASE}/api/invoices/${encodeURIComponent(invoiceId)}/reject`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders(token) },
    body: JSON.stringify({ comment }),
  })
  return handleJson(response)
}

export async function invoiceHold(token, invoiceId, comment = "") {
  const response = await fetch(`${API_BASE}/api/invoices/${encodeURIComponent(invoiceId)}/hold`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders(token) },
    body: JSON.stringify({ comment }),
  })
  return handleJson(response)
}

export async function validateInvoices(token, maxInvoices = 50) {
  const response = await fetch(`${API_BASE}/api/processing/invoices/validate`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...authHeaders(token),
    },
    body: JSON.stringify({ max_invoices: maxInvoices }),
  })
  return handleJson(response)
}

export async function listExtractionFields(token, entityName = "invoice", enabledOnly = false) {
  const qs = new URLSearchParams({
    entity_name: entityName,
    enabled_only: String(enabledOnly),
  })
  const response = await fetch(`${API_BASE}/api/admin/config/extraction-fields?${qs.toString()}`, {
    headers: { ...authHeaders(token) },
  })
  return handleJson(response)
}

export async function upsertExtractionField(token, payload) {
  const response = await fetch(`${API_BASE}/api/admin/config/extraction-fields`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...authHeaders(token),
    },
    body: JSON.stringify(payload),
  })
  return handleJson(response)
}
