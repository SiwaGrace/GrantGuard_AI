const configured = import.meta.env.VITE_API_URL
const API_URL = (configured || '').replace(/\/+$/, '')

export default API_URL

// The free-tier hosted backend sleeps when idle. While it boots, requests
// either fail at the network level or get a gateway error page (502/503/504).
export const SERVER_WAKING_MESSAGE =
  'The server is waking up (this can take up to a minute). Please try again in a moment.'

const LOCAL_SERVER_DOWN_MESSAGE =
  'Can’t reach the GrantGuard server. Make sure the backend is running (npm run dev) and try again.'

// A backend on this machine never "wakes up", so cold-start wording would
// hide the real problem (usually: the backend isn't running).
function isLocalApi() {
  try {
    const { hostname } = new URL(API_URL || '/', window.location.href)
    return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]'
  } catch {
    return false
  }
}

// fetch() against the backend, turning network failures and timeouts into
// friendly errors. Pass timeoutMs to give up on a request that hangs.
export async function apiFetch(path, { timeoutMs, ...options } = {}) {
  try {
    return await fetch(
      `${API_URL}${path}`,
      timeoutMs ? { ...options, signal: AbortSignal.timeout(timeoutMs) } : options,
    )
  } catch (err) {
    if (err?.name === 'TimeoutError') {
      throw new Error('The server took too long to respond. Please try again.')
    }
    throw new Error(isLocalApi() ? LOCAL_SERVER_DOWN_MESSAGE : SERVER_WAKING_MESSAGE)
  }
}

// Parse a backend response as JSON. A non-JSON body is only reported as a
// cold start for gateway errors from a hosted backend.
export async function readJson(res) {
  const text = await res.text()
  if (!text) return {}
  try {
    return JSON.parse(text)
  } catch {
    if ([502, 503, 504].includes(res.status) && !isLocalApi()) {
      throw new Error(SERVER_WAKING_MESSAGE)
    }
    throw new Error(
      res.ok
        ? 'Unexpected response from the server.'
        : `The server returned an unexpected error (${res.status}). Please try again.`,
    )
  }
}
