import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import API_URL from '../lib/api'

export default function DocumentViewer({ grantId, grantName, onClose }) {
  const [objectUrl, setObjectUrl] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    let active = true
    let url = null

    async function load() {
      try {
        const { data: authData } = await supabase.auth.getSession()
        const token = authData.session?.access_token
        if (!token) throw new Error('Not authenticated')

        const res = await fetch(`${API_URL}/api/grants/${grantId}/document`, {
          headers: { Authorization: `Bearer ${token}` },
        })

        if (!res.ok) {
          const payload = await res.json().catch(() => ({}))
          throw new Error(payload.error || `Failed to load document (${res.status})`)
        }

        const blob = await res.blob()
        if (blob.type !== 'application/pdf' && blob.size === 0) {
          throw new Error('The document could not be rendered.')
        }
        url = URL.createObjectURL(blob)
        if (active) setObjectUrl(url)
      } catch (err) {
        if (active) setError(err.message)
      } finally {
        if (active) setLoading(false)
      }
    }

    load()

    function onKey(e) {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    document.body.style.overflow = 'hidden'

    return () => {
      active = false
      if (url) URL.revokeObjectURL(url)
      window.removeEventListener('keydown', onKey)
      document.body.style.overflow = ''
    }
  }, [grantId, onClose])

  return (
    <div
      className="fixed inset-0 z-[60] flex flex-col bg-surface-container-low p-2 md:p-6"
      role="dialog"
      aria-modal="true"
      aria-label="Document viewer"
    >
      {/* Toolbar */}
      <div className="flex items-center justify-between gap-3 bg-surface-container-lowest inkwell-border notched-card px-4 py-3 mb-3 shrink-0">
        <div className="flex items-center gap-3 min-w-0">
          <span className="material-symbols-outlined filled-icon text-primary">description</span>
          <div className="min-w-0">
            <h3 className="font-label-caps text-label-caps text-on-surface uppercase tracking-wider truncate">
              Source Document
            </h3>
            {grantName && (
              <p className="font-source-code text-source-code text-on-surface-variant truncate">
                {grantName}
              </p>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {objectUrl && (
            <a
              href={objectUrl}
              download="document.pdf"
              className="py-2 px-4 border border-outline text-primary font-label-caps text-label-caps tracking-wider uppercase hover:bg-surface-container transition-colors notched-br flex items-center gap-2"
            >
              <span className="material-symbols-outlined text-[15px]">download</span>
              Download
            </a>
          )}
          <button
            onClick={onClose}
            aria-label="Close document"
            className="bg-primary text-on-primary py-2 px-4 font-label-caps text-label-caps tracking-wider uppercase hover:bg-surface-tint transition-colors notched-br flex items-center gap-2"
          >
            <span className="material-symbols-outlined text-[15px]">close</span>
            Close
          </button>
        </div>
      </div>

      {/* Body */}
      <div className="flex-1 min-h-0 bg-surface-container-lowest relative overflow-hidden flex flex-col">
        {loading && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-on-surface-variant">
            <div className="w-8 h-8 border-2 border-outline-variant border-t-primary rounded-full animate-spin" />
            <p className="text-body-md">Loading document…</p>
          </div>
        )}

        {error && (
          <div className="flex-1 flex flex-col items-center justify-center gap-4 p-6 text-center">
            <span className="material-symbols-outlined text-[44px] text-alert-crimson">error_outline</span>
            <p className="text-body-md text-on-surface-variant max-w-md">{error}</p>
            <button
              onClick={onClose}
              className="py-2 px-4 border border-outline text-primary font-label-caps text-label-caps tracking-wider uppercase hover:bg-surface-container transition-colors notched-br"
            >
              Close
            </button>
          </div>
        )}

        {objectUrl && !error && (
          <iframe
            title={grantName || 'Grant document'}
            src={objectUrl}
            className="flex-1 w-full h-full border-0"
          />
        )}
      </div>
    </div>
  )
}
