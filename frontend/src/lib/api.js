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

// Parse a backend response body as JSON. A non-JSON body is only reported
// as a cold start for gateway errors from a hosted backend.
function parseBody(text, status) {
  if (!text) return {}
  try {
    return JSON.parse(text)
  } catch {
    if ([502, 503, 504].includes(status) && !isLocalApi()) {
      throw new Error(SERVER_WAKING_MESSAGE)
    }
    throw new Error(
      status >= 200 && status < 300
        ? 'Unexpected response from the server.'
        : `The server returned an unexpected error (${status}). Please try again.`,
    )
  }
}

export async function readJson(res) {
  return parseBody(await res.text(), res.status)
}

// POST a FormData body with upload progress (fetch can't report it).
// onUploadProgress gets 0..1 while sending; onUploaded fires once the file
// has been sent and the server is processing it.
// Resolves to { ok, status, payload }.
export function uploadWithProgress(path, { body, headers = {}, onUploadProgress, onUploaded } = {}) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open('POST', `${API_URL}${path}`)
    for (const [name, value] of Object.entries(headers)) xhr.setRequestHeader(name, value)
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onUploadProgress?.(e.loaded / e.total)
    }
    xhr.upload.onload = () => onUploaded?.()
    xhr.onerror = () => reject(new Error(isLocalApi() ? LOCAL_SERVER_DOWN_MESSAGE : SERVER_WAKING_MESSAGE))
    xhr.onload = () => {
      try {
        const payload = parseBody(xhr.responseText, xhr.status)
        resolve({ ok: xhr.status >= 200 && xhr.status < 300, status: xhr.status, payload })
      } catch (err) {
        reject(err)
      }
    }
    xhr.send(body)
  })
}
