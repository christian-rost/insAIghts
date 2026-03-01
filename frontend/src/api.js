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
