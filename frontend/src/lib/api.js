const configured = import.meta.env.VITE_API_URL
const API_URL = (configured || '').replace(/\/+$/, '')

export default API_URL

// The free-tier backend sleeps when idle. While it boots, requests either
// fail at the network level or get an HTML error page instead of JSON.
export const SERVER_WAKING_MESSAGE =
  'The server is waking up (this can take up to a minute). Please try again in a moment.'

// fetch() against the backend, turning network failures into a friendly error.
export async function apiFetch(path, options) {
  try {
    return await fetch(`${API_URL}${path}`, options)
  } catch {
    throw new Error(SERVER_WAKING_MESSAGE)
  }
}

// Parse a backend response as JSON; non-JSON bodies (gateway error pages)
// become the friendly "waking up" error instead of a JSON syntax error.
export async function readJson(res) {
  const text = await res.text()
  if (!text) return {}
  try {
    return JSON.parse(text)
  } catch {
    if (!res.ok) throw new Error(SERVER_WAKING_MESSAGE)
    throw new Error('Unexpected response from the server.')
  }
}
