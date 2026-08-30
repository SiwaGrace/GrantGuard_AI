import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import toast from 'react-hot-toast'
import { useAuth } from '../context/AuthContext'
import API_URL from '../lib/api'
import AppShell from '../components/AppShell'
import DocumentViewer from '../components/DocumentViewer'

const DUE_SOON_DAYS = 14

function isDueSoon(dueDate) {
  if (!dueDate) return false
  const now = new Date()
  const due = new Date(dueDate)
  const deadline = new Date(now.getTime() + DUE_SOON_DAYS * 24 * 60 * 60 * 1000)
  return due >= now && due <= deadline
}

const TYPE_LABELS = {
  deadline: 'Deadline',
  reporting: 'Reporting',
  eligible_activity: 'Eligible Activity',
  compliance_condition: 'Compliance Condition',
}

const TYPE_META = {
  deadline: { icon: 'event', color: 'text-primary', bg: 'bg-primary-container' },
  reporting: { icon: 'summarize', color: 'text-primary', bg: 'bg-primary-container' },
  eligible_activity: { icon: 'checklist', color: 'text-warning-ochre', bg: 'bg-surface-container' },
  compliance_condition: { icon: 'gavel', color: 'text-alert-crimson', bg: 'bg-error-container' },
}

export default function ReviewScreen() {
  const { session } = useAuth()
  const { grantId } = useParams()
  const navigate = useNavigate()

  const [loading, setLoading] = useState(true)
  const [obligations, setObligations] = useState([])
  const [grantName, setGrantName] = useState('')
  const [error, setError] = useState('')

  const [editingId, setEditingId] = useState(null)
  const [editForm, setEditForm] = useState({ description: '', due_date: '', type: '' })
  const [saving, setSaving] = useState(false)

  const [confirming, setConfirming] = useState(false)
  const [confirmed, setConfirmed] = useState(false)
  const [verifyingId, setVerifyingId] = useState(null)

  const [detail, setDetail] = useState(null)
  const [showDocument, setShowDocument] = useState(false)

  const headers = { Authorization: `Bearer ${session.access_token}` }

  useEffect(() => {
    let active = true
    const authHeaders = { Authorization: `Bearer ${session.access_token}` }

    async function load() {
      try {
        const res = await fetch(`${API_URL}/api/grants/${grantId}/obligations`, {
          headers: authHeaders,
        })
        const payload = await res.json()
        if (!active) return
        if (!res.ok) throw new Error(payload.error || 'Failed to load obligations')
        setObligations(payload.obligations || [])
      } catch (err) {
        if (active) setError(err.message)
      } finally {
        if (active) setLoading(false)
      }
    }

    load()
    return () => { active = false }
  }, [grantId, session.access_token])

  useEffect(() => {
    const state = window.history.state?.usr
    if (state?.grantName) setGrantName(state.grantName)
  }, [])

  useEffect(() => {
    if (!detail) return
    function onKey(e) {
      if (e.key === 'Escape') setDetail(null)
    }
    window.addEventListener('keydown', onKey)
    document.body.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('keydown', onKey)
      document.body.style.overflow = ''
    }
  }, [detail])

  function startEdit(o) {
    setEditingId(o.id)
    setEditForm({
      description: o.description,
      due_date: o.due_date || '',
      type: o.type,
    })
  }

  function cancelEdit() {
    setEditingId(null)
    setEditForm({ description: '', due_date: '', type: '' })
  }

  async function saveEdit(obligationId) {
    setSaving(true)
    try {
      const body = {
        description: editForm.description,
        type: editForm.type,
        due_date: editForm.due_date || null,
      }

      const res = await fetch(
        `${API_URL}/api/grants/${grantId}/obligations/${obligationId}`,
        { method: 'PATCH', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify(body) }
      )
      const payload = await res.json()
      if (!res.ok) throw new Error(payload.error || 'Save failed')

      setObligations((prev) =>
        prev.map((o) => (o.id === obligationId ? { ...o, ...body } : o))
      )
      cancelEdit()
      toast.success('Obligation updated')
    } catch (err) {
      toast.error(err.message || 'Could not save changes')
    } finally {
      setSaving(false)
    }
  }

  async function confirmAll() {
    setConfirming(true)
    setError('')
    try {
      const res = await fetch(
        `${API_URL}/api/grants/${grantId}/obligations/confirm`,
        { method: 'POST', headers }
      )
      const payload = await res.json()
      if (!res.ok) throw new Error(payload.error || 'Confirm failed')

      setObligations((prev) =>
        prev.map((o) => (o.status === 'pending_review' ? { ...o, status: 'confirmed' } : o))
      )
      setConfirmed(true)
      toast.success('All obligations confirmed — tracking is active')
    } catch (err) {
      toast.error(err.message || 'Could not confirm obligations')
    } finally {
      setConfirming(false)
    }
  }

  async function handleVerify(obligationId) {
    setVerifyingId(obligationId)
    try {
      const res = await fetch(
        `${API_URL}/api/grants/${grantId}/obligations/${obligationId}`,
        {
          method: 'PATCH',
          headers: { ...headers, 'Content-Type': 'application/json' },
          body: JSON.stringify({ verified: true }),
        }
      )
      const payload = await res.json()
      if (!res.ok) throw new Error(payload.error || 'Verify failed')

      setObligations((prev) =>
        prev.map((o) => (o.id === obligationId ? { ...o, verified: true } : o))
      )
      toast.success('Marked as verified')
    } catch (err) {
      toast.error(err.message || 'Could not mark as verified')
    } finally {
      setVerifyingId(null)
    }
  }

  const grouped = obligations.reduce((acc, o) => {
    ;(acc[o.type] = acc[o.type] || []).push(o)
    return acc
  }, {})

  const pendingCount = obligations.filter((o) => o.status === 'pending_review').length
  const lowConfidenceCount = obligations.filter((o) => o.confidence === 'low').length
  const needsReview = pendingCount > 0 || lowConfidenceCount > 0

  if (loading) {
    return (
      <AppShell>
        <div className="flex flex-col items-center justify-center py-24 text-on-surface-variant">
          <div className="w-8 h-8 border-2 border-outline-variant border-t-primary rounded-full animate-spin mb-3" />
          <p className="text-body-md">Loading obligations…</p>
        </div>
      </AppShell>
    )
  }

  if (error && obligations.length === 0) {
    return (
      <AppShell>
        <div className="max-w-md mx-auto bg-surface-container-lowest inkwell-border notched-card p-6 text-center">
          <span className="material-symbols-outlined text-[40px] text-alert-crimson mb-3">error_outline</span>
          <p className="text-body-md text-on-surface mb-4">{error}</p>
          <button
            onClick={() => navigate('/')}
            className="bg-primary text-on-primary py-2.5 px-5 font-label-caps text-label-caps tracking-wider hover:bg-surface-tint transition-colors notched-br"
          >
            BACK TO PORTFOLIO
          </button>
        </div>
      </AppShell>
    )
  }

  return (
    <AppShell>
      <div className="space-y-8">
        {/* Breadcrumb */}
        <nav className="flex items-center gap-2 font-label-caps text-label-caps text-on-surface-variant uppercase tracking-wider">
          <button onClick={() => navigate('/')} className="hover:text-primary transition-colors">
            Portfolio
          </button>
          <span className="material-symbols-outlined text-[14px]">chevron_right</span>
          <span className="text-primary">{grantName || 'Grant'}</span>
        </nav>

        {/* Header */}
        <header className="flex flex-col md:flex-row md:items-start justify-between gap-4 inkwell-border-b pb-6">
          <div>
            <div className="flex items-center gap-3 flex-wrap">
              <h1 className="font-headline-lg text-headline-lg text-on-surface">
                Obligation Review
              </h1>
              {needsReview && (
                <span className="inline-flex items-center gap-1 px-2.5 py-1 bg-error-container text-on-error-container border border-outline-variant font-label-caps text-label-caps uppercase">
                  <span className="material-symbols-outlined text-[14px]">flag</span>
                  Needs Review
                </span>
              )}
              {confirmed && !needsReview && (
                <span className="inline-flex items-center gap-1 px-2.5 py-1 bg-primary-container text-on-primary-container border border-outline-variant font-label-caps text-label-caps uppercase">
                  <span className="material-symbols-outlined filled-icon text-[14px]">check_circle</span>
                  On Track
                </span>
              )}
            </div>
            <p className="text-body-md text-on-surface-variant mt-1">
              {grantName || 'Grant agreement'}
            </p>
          </div>
          <div className="flex items-center gap-3 shrink-0 flex-wrap">
            <button
              onClick={() => setShowDocument(true)}
              className="py-3 px-4 border border-outline text-primary font-label-caps text-label-caps tracking-wider uppercase hover:bg-surface-container transition-colors notched-br flex items-center gap-2"
            >
              <span className="material-symbols-outlined text-[16px]">visibility</span>
              View Document
            </button>
            {pendingCount > 0 && (
              <button
                onClick={confirmAll}
                disabled={confirming}
                className="bg-primary text-on-primary py-3 px-5 font-label-caps text-label-caps tracking-wider hover:bg-surface-tint transition-colors notched-br disabled:opacity-60 flex items-center gap-2"
              >
                <span className="material-symbols-outlined filled-icon text-[16px]">check_circle</span>
                {confirming
                  ? 'CONFIRMING…'
                  : `CONFIRM & TRACK (${pendingCount})`}
              </button>
            )}
            <button
              onClick={() => navigate('/')}
              className="py-3 px-4 border border-outline text-primary font-label-caps text-label-caps tracking-wider uppercase hover:bg-surface-container transition-colors notched-br flex items-center gap-2"
            >
              <span className="material-symbols-outlined text-[16px]">arrow_back</span>
              Portfolio
            </button>
          </div>
        </header>

        {/* Summary line */}
        <p className="text-body-md text-on-surface-variant flex items-center gap-3 flex-wrap">
          {obligations.length} obligation{obligations.length !== 1 ? 's' : ''} extracted
          {pendingCount > 0 && (
            <span className="inline-flex items-center gap-1 font-label-caps text-label-caps text-warning-ochre uppercase bg-surface-container inkwell-border px-2 py-1">
              <span className="material-symbols-outlined text-[14px]">visibility</span>
              {pendingCount} pending
            </span>
          )}
          {lowConfidenceCount > 0 && (
            <span className="inline-flex items-center gap-1 font-label-caps text-label-caps text-alert-crimson uppercase bg-error-container px-2 py-1">
              <span className="material-symbols-outlined text-[14px]">gavel</span>
              {lowConfidenceCount} low confidence
            </span>
          )}
        </p>

        {error && obligations.length > 0 && (
          <p role="alert" className="text-body-md text-alert-crimson">{error}</p>
        )}

        {obligations.length === 0 ? (
          <div className="bg-surface-container-lowest inkwell-border notched-card p-10 text-center">
            <p className="text-body-md text-on-surface-variant">No obligations were found for this grant.</p>
          </div>
        ) : (
          <div className="space-y-8">
            {Object.entries(TYPE_LABELS).map(([type, label]) => {
              const items = grouped[type]
              if (!items || items.length === 0) return null
              const meta = TYPE_META[type] || TYPE_META.deadline
              return (
                <section key={type}>
                  <div className="flex items-center gap-3 mb-3">
                    <span className={`w-7 h-7 rounded flex items-center justify-center inkwell-border ${meta.bg}`}>
                      <span className={`material-symbols-outlined filled-icon text-[18px] ${meta.color}`}>{meta.icon}</span>
                    </span>
                    <h2 className="font-headline-lg-mobile text-headline-lg-mobile font-semibold text-primary">{label}</h2>
                    <span className="font-source-code text-source-code text-on-surface-variant">
                      {items.length}
                    </span>
                  </div>
                  <div className="grid grid-cols-1 gap-4">
                    {items.map((o) => {
                      const flagged = o.confidence === 'low' && !o.verified
                      const isConfirmed = o.status === 'confirmed'
                      const isEditing = editingId === o.id
                      return (
                        <div
                          key={o.id}
                          className={`bg-surface-container-lowest inkwell-border p-5 flex flex-col gap-3 notched-card ${
                            flagged
                              ? 'border-l-4 border-alert-crimson'
                              : isConfirmed
                                ? 'border-l-4 border-primary'
                                : ''
                          }`}
                        >
                          {isEditing ? (
                            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                              <div className="flex flex-col gap-1">
                                <label htmlFor={`edit-type-${o.id}`} className="font-label-caps text-label-caps text-on-surface-variant uppercase tracking-wider">Type</label>
                                <select
                                  id={`edit-type-${o.id}`}
                                  value={editForm.type}
                                  onChange={(e) => setEditForm((f) => ({ ...f, type: e.target.value }))}
                                  className="w-full bg-transparent border-0 border-b border-outline hover:border-primary focus:border-primary focus:outline-none px-0 py-2 font-source-code text-source-code text-on-surface"
                                >
                                  {Object.entries(TYPE_LABELS).map(([val, lbl]) => (
                                    <option key={val} value={val}>{lbl}</option>
                                  ))}
                                </select>
                              </div>
                              <div className="flex flex-col gap-1 md:col-span-2">
                                <label htmlFor={`edit-desc-${o.id}`} className="font-label-caps text-label-caps text-on-surface-variant uppercase tracking-wider">Description</label>
                                <textarea
                                  id={`edit-desc-${o.id}`}
                                  value={editForm.description}
                                  onChange={(e) => setEditForm((f) => ({ ...f, description: e.target.value }))}
                                  rows={3}
                                  className="w-full bg-transparent border-0 border-b border-outline hover:border-primary focus:border-primary focus:outline-none px-0 py-2 font-source-code text-source-code text-on-surface resize-none"
                                />
                              </div>
                              <div className="flex flex-col gap-1">
                                <label htmlFor={`edit-due-${o.id}`} className="font-label-caps text-label-caps text-on-surface-variant uppercase tracking-wider">Due date (optional)</label>
                                <input
                                  id={`edit-due-${o.id}`}
                                  type="date"
                                  value={editForm.due_date}
                                  onChange={(e) => setEditForm((f) => ({ ...f, due_date: e.target.value }))}
                                  className="w-full bg-transparent border-0 border-b border-outline hover:border-primary focus:border-primary focus:outline-none px-0 py-2 font-source-code text-source-code text-on-surface"
                                />
                              </div>
                              <div className="flex gap-2 md:col-span-2 md:justify-end items-end">
                                <button
                                  onClick={() => saveEdit(o.id)}
                                  disabled={saving}
                                  className="bg-primary text-on-primary py-2.5 px-5 font-label-caps text-label-caps tracking-wider hover:bg-surface-tint transition-colors notched-br disabled:opacity-60"
                                >
                                  {saving ? 'SAVING…' : 'SAVE'}
                                </button>
                                <button
                                  onClick={cancelEdit}
                                  disabled={saving}
                                  className="py-2.5 px-5 border border-outline text-primary font-label-caps text-label-caps tracking-wider uppercase hover:bg-surface-container transition-colors notched-br"
                                >
                                  Cancel
                                </button>
                              </div>
                            </div>
                          ) : (
                            <>
                              <div className="flex items-center justify-between gap-2 flex-wrap">
                                <div className="flex items-center gap-2 flex-wrap">
                                  {isDueSoon(o.due_date) && (
                                    <span className="inline-flex items-center gap-1 font-label-caps text-label-caps text-alert-crimson uppercase bg-error-container px-2 py-0.5 border border-outline-variant">
                                      due soon
                                    </span>
                                  )}
                                  {flagged && (
                                    <span className="inline-flex items-center gap-1 font-label-caps text-label-caps text-alert-crimson uppercase bg-error-container px-2 py-0.5 border border-outline-variant">
                                      flagged
                                    </span>
                                  )}
                                  {o.confidence === 'low' && o.verified && (
                                    <span className="inline-flex items-center gap-1 font-label-caps text-label-caps text-primary uppercase bg-primary-container px-2 py-0.5 border border-outline-variant">
                                      verified
                                    </span>
                                  )}
                                  {isConfirmed && (
                                    <span className="inline-flex items-center gap-1 font-label-caps text-label-caps text-primary uppercase bg-primary-container px-2 py-0.5 border border-outline-variant">
                                      confirmed
                                    </span>
                                  )}
                                  {o.source_page && (
                                    <span className="font-source-code text-source-code text-on-surface-variant">
                                      p.{o.source_page}
                                    </span>
                                  )}
                                </div>
                              </div>

                              <p className="font-headline-lg-mobile text-headline-lg-mobile font-medium text-on-surface">
                                {o.description}
                              </p>
                              {o.due_date && (
                                <p className="font-source-code text-source-code text-on-surface-variant">
                                  Due: {o.due_date}
                                </p>
                              )}
                              {o.source_excerpt && (
                                <blockquote className="border-l-2 border-outline pl-3 text-body-md text-on-surface-variant italic bg-surface-container-low px-3 py-2">
                                  &ldquo;{o.source_excerpt}&rdquo;
                                </blockquote>
                              )}
                              {flagged && (
                                <p className="font-label-caps text-label-caps text-alert-crimson uppercase">
                                  Low extraction confidence — please verify against the source clause
                                </p>
                              )}
                              <div className="flex gap-2 flex-wrap">
                                <button
                                  onClick={() => setDetail(o)}
                                  className="px-3 py-1.5 border border-outline text-primary font-label-caps text-[10px] uppercase tracking-wider hover:bg-surface-container transition-colors flex items-center gap-1.5"
                                >
                                  <span className="material-symbols-outlined text-[14px]">plagiarism</span>
                                  Source
                                </button>
                                {o.status === 'pending_review' && (
                                  <button
                                    onClick={() => startEdit(o)}
                                    className="px-3 py-1.5 border border-outline text-primary font-label-caps text-[10px] uppercase tracking-wider hover:bg-surface-container transition-colors flex items-center gap-1.5"
                                  >
                                    <span className="material-symbols-outlined text-[14px]">edit</span>
                                    Edit
                                  </button>
                                )}
                                {flagged && (
                                  <button
                                    onClick={() => handleVerify(o.id)}
                                    disabled={verifyingId === o.id}
                                    className="px-3 py-1.5 bg-primary text-on-primary font-label-caps text-[10px] uppercase tracking-wider hover:bg-surface-tint transition-colors disabled:opacity-60 flex items-center gap-1.5"
                                  >
                                    <span className="material-symbols-outlined filled-icon text-[14px]">verified</span>
                                    {verifyingId === o.id ? 'Marking…' : 'Mark as reviewed'}
                                  </button>
                                )}
                              </div>
                            </>
                          )}
                        </div>
                      )
                    })}
                  </div>
                </section>
              )
            })}
          </div>
        )}
      </div>

      {detail && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 md:p-8"
          role="dialog"
          aria-modal="true"
          aria-label="Obligation detail"
        >
          <div
            className="absolute inset-0 bg-inverse-surface/50 backdrop-blur-[2px]"
            onClick={() => setDetail(null)}
          />
          <div className="relative w-full max-w-4xl max-h-[85vh] overflow-y-auto bg-surface-container-lowest inkwell-border shadow-2xl flex flex-col md:flex-row">
            <div className="w-full md:w-1/2 p-6 md:p-10 flex flex-col md:border-r md:border-outline-variant">
              <div className="flex items-center justify-between mb-8">
                <div className="flex items-center gap-2">
                  <span className="material-symbols-outlined text-alert-crimson text-[20px]">flag</span>
                  <span className="font-label-caps text-label-caps text-alert-crimson uppercase tracking-widest">
                    {detail.status === 'confirmed' ? 'Confirmed' : detail.confidence === 'low' ? 'Flagged' : 'Needs Review'}
                  </span>
                </div>
                <div className="bg-surface-dim px-2 py-1 flex items-center gap-2 inkwell-border">
                  <span className="font-label-caps text-label-caps text-on-surface uppercase">Type:</span>
                  <span className="font-source-code text-source-code text-on-surface">
                    {TYPE_LABELS[detail.type] || detail.type}
                  </span>
                </div>
              </div>

              <div className="mb-8 flex-grow">
                <h2 className="font-headline-lg-mobile md:font-headline-lg text-headline-lg-mobile md:text-headline-lg text-on-surface mb-4">
                  {detail.description}
                </h2>
                <p className="text-body-md text-body-md text-on-surface-variant">
                  {detail.source_excerpt || detail.description}
                </p>
                {detail.due_date && (
                  <p className="font-source-code text-source-code text-on-surface-variant mt-4">
                    Due: {detail.due_date}
                  </p>
                )}
              </div>

              <div className="flex flex-col sm:flex-row gap-4 mt-auto pt-8 border-t border-outline-variant">
                {detail.confidence === 'low' && !detail.verified && (
                  <button
                    onClick={async () => {
                      await handleVerify(detail.id)
                      setDetail(null)
                    }}
                    disabled={verifyingId === detail.id}
                    className="bg-primary hover:bg-surface-tint text-on-primary font-label-caps text-label-caps px-6 py-3 flex items-center justify-center gap-2 transition-colors w-full sm:w-auto notched-br disabled:opacity-60"
                  >
                    <span className="material-symbols-outlined filled-icon text-[16px]">verified</span>
                    {verifyingId === detail.id ? 'Resolving…' : 'Resolve Flag'}
                  </button>
                )}
                <button
                  onClick={() => setDetail(null)}
                  className="bg-transparent inkwell-border text-on-surface hover:bg-surface-variant font-label-caps text-label-caps px-6 py-3 transition-colors w-full sm:w-auto notched-br"
                >
                  Close
                </button>
              </div>
            </div>

            <div className="w-full md:w-1/2 bg-surface-container-low p-6 md:p-10 flex flex-col relative">
              <h3 className="font-label-caps text-label-caps text-secondary mb-4 flex items-center gap-2 uppercase tracking-widest">
                <span className="material-symbols-outlined text-[16px]">menu_book</span>
                The Source Evidence
              </h3>

              {detail.source_excerpt ? (
                <div className="bg-surface-dim p-6 mb-8 relative inkwell-border">
                  <p className="font-source-code text-source-code text-on-surface leading-relaxed">
                    &ldquo;{detail.source_excerpt}&rdquo;
                  </p>
                  <div className="absolute -top-3 -right-3 text-outline bg-surface-container-low p-1">
                    <span className="material-symbols-outlined text-[14px]">content_cut</span>
                  </div>
                </div>
              ) : (
                <p className="text-body-md text-body-md text-on-surface-variant mb-8">
                  No verbatim source excerpt was captured for this obligation.
                </p>
              )}

              <div className="mt-auto flex flex-col gap-4">
                <div className="flex justify-between items-center border-b border-outline-variant pb-2 mb-2">
                  <span className="font-label-caps text-label-caps text-secondary uppercase">Page Ref</span>
                  <span className="font-source-code text-source-code text-on-surface">
                    {detail.source_page ? `p. ${detail.source_page}` : '—'}
                  </span>
                </div>
                <div className="flex justify-between items-center border-b border-outline-variant pb-2 mb-4">
                  <span className="font-label-caps text-label-caps text-secondary uppercase">Confidence</span>
                  <span
                    className={`font-source-code text-source-code flex items-center gap-1 ${
                      detail.confidence === 'low' ? 'text-alert-crimson' : 'text-primary'
                    }`}
                  >
                    {detail.confidence === 'high' ? 'High' : detail.confidence === 'medium' ? 'Medium' : 'Low'}
                    <span className="material-symbols-outlined text-[14px]">
                      {detail.confidence === 'low' ? 'help' : 'verified'}
                    </span>
                  </span>
                </div>
                <div className="relative w-full h-32 inkwell-border bg-surface overflow-hidden flex items-center justify-center">
                  <div className="absolute inset-0 blueprint-grid text-primary opacity-10" />
                  <button
                    onClick={() => setDetail(null)}
                    className="z-10 bg-surface text-primary font-label-caps text-label-caps px-4 py-2 flex items-center gap-2 inkwell-border hover:bg-surface-variant transition-colors uppercase"
                  >
                    <span className="material-symbols-outlined text-[16px]">description</span>
                    Return to Review
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
      {showDocument && (
        <DocumentViewer
          grantId={grantId}
          grantName={grantName}
          onClose={() => setShowDocument(false)}
        />
      )}
    </AppShell>
  )
}