import { useEffect, useMemo, useState } from "react"
import { createUser, listUsers, login, me } from "./api"

function LoginView({ onLogin, loading, error }) {
  const [username, setUsername] = useState("")
  const [password, setPassword] = useState("")

  return (
    <section className="card">
      <h1>insAIghts</h1>
      <p className="muted">Login mit Username</p>
      <form
        onSubmit={(e) => {
          e.preventDefault()
          onLogin(username, password)
        }}
      >
        <label>
          Username
          <input value={username} onChange={(e) => setUsername(e.target.value)} required />
        </label>
        <label>
          Passwort
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        </label>
        <button disabled={loading} type="submit">
          {loading ? "Anmelden..." : "Anmelden"}
        </button>
      </form>
      {error ? <p className="error">{error}</p> : null}
    </section>
  )
}

function AdminView({ token, currentUser }) {
  const [users, setUsers] = useState([])
  const [error, setError] = useState("")
  const [form, setForm] = useState({
    username: "",
    email: "",
    password: "",
    roles: "AP_CLERK",
  })

  async function loadUsers() {
    try {
      setError("")
      setUsers(await listUsers(token))
    } catch (e) {
      setError(String(e.message || e))
    }
  }

  useEffect(() => {
    loadUsers()
  }, [])

  const isAdmin = useMemo(() => (currentUser?.roles || []).includes("ADMIN"), [currentUser])

  return (
    <main className="layout">
      <header className="card">
        <h2>Admin-Panel</h2>
        <p className="muted">Angemeldet als {currentUser?.username}</p>
      </header>

      {!isAdmin ? (
        <section className="card">
          <p>Kein Admin-Zugriff.</p>
        </section>
      ) : (
        <>
          <section className="card">
            <h3>Benutzer anlegen</h3>
            <form
              className="grid"
              onSubmit={async (e) => {
                e.preventDefault()
                try {
                  setError("")
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
                  value={form.username}
                  onChange={(e) => setForm((f) => ({ ...f, username: e.target.value }))}
                  required
                />
              </label>
              <label>
                E-Mail
                <input
                  type="email"
                  value={form.email}
                  onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
                  required
                />
              </label>
              <label>
                Passwort
                <input
                  type="password"
                  value={form.password}
                  onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))}
                  required
                />
              </label>
              <label>
                Rollen (CSV)
                <input
                  value={form.roles}
                  onChange={(e) => setForm((f) => ({ ...f, roles: e.target.value }))}
                  required
                />
              </label>
              <button type="submit">Benutzer speichern</button>
            </form>
          </section>

          <section className="card">
            <div className="row">
              <h3>Benutzerliste</h3>
              <button onClick={loadUsers}>Neu laden</button>
            </div>
            <table>
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
          </section>
        </>
      )}

      {error ? <p className="error">{error}</p> : null}
    </main>
  )
}

export default function App() {
  const [token, setToken] = useState(localStorage.getItem("access_token") || "")
  const [currentUser, setCurrentUser] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")

  async function handleLogin(username, password) {
    try {
      setLoading(true)
      setError("")
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

  if (!token) {
    return <LoginView onLogin={handleLogin} loading={loading} error={error} />
  }

  return <AdminView token={token} currentUser={currentUser} />
}

