import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import toast from 'react-hot-toast'
import { useAuth } from '../context/AuthContext'
import API_URL from '../lib/api'
import AppShell from '../components/AppShell'

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
  deadline: { icon: 'event', color: '#1c1b1b', bg: '#e5e2e1' },
  reporting: { icon: 'summarize', color: '#1c1b1b', bg: '#e5e2e1' },
  eligible_activity: { icon: 'checklist', color: '#1c1b1b', bg: '#e5e2e1' },
  compliance_condition: { icon: 'gavel', color: '#93000a', bg: '#ffdad6' },
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
        <div className="max-w-md mx-auto border border-outline-variant bg-surface rounded-lg p-6 text-center">
          <span className="material-symbols-outlined text-[40px] text-error mb-3">error_outline</span>
          <p className="text-body-md text-on-surface mb-4">{error}</p>
          <button
            onClick={() => navigate('/')}
            className="px-5 h-11 bg-primary text-on-primary text-body-md font-medium rounded hover:bg-inverse-surface transition-colors"
          >
            Back to Dashboard
          </button>
        </div>
      </AppShell>
    )
  }

  return (
    <AppShell>
      <div className="space-y-6">
        {/* Breadcrumb */}
        <nav className="flex items-center gap-2 font-mono text-[12px] leading-4 text-on-surface-variant">
          <button onClick={() => navigate('/')} className="hover:text-primary transition-colors">
            Portfolio
          </button>
          <span className="material-symbols-outlined text-[14px]">chevron_right</span>
          <span className="text-primary">{grantName || 'Grant'}</span>
        </nav>

        {/* Header */}
        <header className="flex flex-col md:flex-row md:items-start justify-between gap-4 border-b border-outline-variant pb-6">
          <div>
            <div className="flex items-center gap-3 flex-wrap">
              <h1 className="text-[24px] sm:text-[32px] leading-[1.1] font-semibold tracking-tight text-primary">
                Review Obligations
              </h1>
              {needsReview && (
                <span className="inline-flex items-center px-2.5 py-1 rounded border border-error bg-error-container text-on-error-container font-mono text-[11px] uppercase tracking-wider">
                  Needs Review
                </span>
              )}
              {confirmed && !needsReview && (
                <span className="inline-flex items-center px-2.5 py-1 rounded border border-success-border bg-success-bg text-success font-mono text-[11px] uppercase tracking-wider">
                  On Track
                </span>
              )}
            </div>
            <p className="text-body-md text-on-surface-variant mt-1">
              {grantName || 'Grant agreement'}
            </p>
          </div>
          <div className="flex items-center gap-3 shrink-0 flex-wrap">
            {pendingCount > 0 && (
              <button
                onClick={confirmAll}
                disabled={confirming}
                className="px-5 h-11 bg-primary text-on-primary text-body-md font-medium rounded hover:bg-inverse-surface transition-colors flex items-center gap-2 disabled:opacity-60"
              >
                <span className="material-symbols-outlined text-[20px]">check_circle</span>
                {confirming
                  ? 'Confirming…'
                  : `Confirm & activate tracking (${pendingCount})`}
              </button>
            )}
            <button
              onClick={() => navigate('/')}
              className="px-4 h-11 border border-outline text-primary text-body-md rounded hover:bg-surface-variant transition-colors flex items-center gap-2"
            >
              <span className="material-symbols-outlined text-[20px]">arrow_back</span>
              Dashboard
            </button>
          </div>
        </header>

        {/* Summary line */}
        <p className="text-body-md text-on-surface-variant">
          {obligations.length} obligation{obligations.length !== 1 ? 's' : ''} extracted
          {pendingCount > 0 && (
            <span className="ml-3 inline-flex items-center gap-1 font-mono text-[11px] uppercase tracking-wider text-on-surface-variant bg-surface-variant px-2 py-1 rounded">
              {pendingCount} pending review
            </span>
          )}
          {lowConfidenceCount > 0 && (
            <span className="ml-2 inline-flex items-center gap-1 font-mono text-[11px] uppercase tracking-wider text-on-error-container bg-error-container px-2 py-1 rounded">
              {lowConfidenceCount} low confidence
            </span>
          )}
        </p>

        {error && obligations.length > 0 && (
          <p role="alert" className="text-body-md text-error">{error}</p>
        )}

        {obligations.length === 0 ? (
          <div className="border border-dashed border-outline-variant rounded-lg p-10 text-center bg-surface">
            <p className="text-body-md text-on-surface-variant">No obligations were found for this grant.</p>
          </div>
        ) : (
          <div className="blueprint-bg space-y-8 rounded-xl border border-outline-variant/60 p-4 sm:p-6 lg:p-8">
            {Object.entries(TYPE_LABELS).map(([type, label]) => {
              const items = grouped[type]
              if (!items || items.length === 0) return null
              const meta = TYPE_META[type] || TYPE_META.deadline
              return (
                <section key={type}>
                  <div className="flex items-center gap-2 mb-3">
                    <span
                      className="w-7 h-7 rounded flex items-center justify-center"
                      style={{ color: meta.color, backgroundColor: meta.bg }}
                    >
                      <span className="material-symbols-outlined text-[18px]">{meta.icon}</span>
                    </span>
                    <h2 className="text-headline-md text-primary">{label}</h2>
                    <span className="font-mono text-[12px] text-on-surface-variant">
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
                          className={`border rounded-lg p-5 flex flex-col gap-3 ${
                            flagged
                              ? 'border-error/40 bg-error-container/40'
                              : isConfirmed
                                ? 'border-success-border bg-success-bg/40'
                                : 'border-outline-variant bg-surface'
                          }`}
                        >
                          {isEditing ? (
                            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                              <div className="flex flex-col gap-1">
                                <label htmlFor={`edit-type-${o.id}`} className="font-mono text-[12px] text-on-surface-variant uppercase tracking-wider">Type</label>
                                <select
                                  id={`edit-type-${o.id}`}
                                  value={editForm.type}
                                  onChange={(e) => setEditForm((f) => ({ ...f, type: e.target.value }))}
                                  className="w-full h-11 px-3 bg-surface border border-outline-variant rounded text-body-md text-on-surface focus:outline-none focus:border-primary"
                                >
                                  {Object.entries(TYPE_LABELS).map(([val, lbl]) => (
                                    <option key={val} value={val}>{lbl}</option>
                                  ))}
                                </select>
                              </div>
                              <div className="flex flex-col gap-1 md:col-span-2">
                                <label htmlFor={`edit-desc-${o.id}`} className="font-mono text-[12px] text-on-surface-variant uppercase tracking-wider">Description</label>
                                <textarea
                                  id={`edit-desc-${o.id}`}
                                  value={editForm.description}
                                  onChange={(e) => setEditForm((f) => ({ ...f, description: e.target.value }))}
                                  rows={3}
                                  className="w-full p-3 bg-surface border border-outline-variant rounded text-body-md text-on-surface focus:outline-none focus:border-primary resize-none"
                                />
                              </div>
                              <div className="flex flex-col gap-1">
                                <label htmlFor={`edit-due-${o.id}`} className="font-mono text-[12px] text-on-surface-variant uppercase tracking-wider">Due date (optional)</label>
                                <input
                                  id={`edit-due-${o.id}`}
                                  type="date"
                                  value={editForm.due_date}
                                  onChange={(e) => setEditForm((f) => ({ ...f, due_date: e.target.value }))}
                                  className="w-full h-11 px-3 bg-surface border border-outline-variant rounded text-body-md text-on-surface focus:outline-none focus:border-primary"
                                />
                              </div>
                              <div className="flex gap-2 md:col-span-2 md:justify-end items-end">
                                <button
                                  onClick={() => saveEdit(o.id)}
                                  disabled={saving}
                                  className="px-5 h-11 bg-primary text-on-primary text-body-md font-medium rounded hover:bg-inverse-surface transition-colors disabled:opacity-60"
                                >
                                  {saving ? 'Saving…' : 'Save'}
                                </button>
                                <button
                                  onClick={cancelEdit}
                                  disabled={saving}
                                  className="px-5 h-11 border border-outline text-primary text-body-md rounded hover:bg-surface-variant transition-colors"
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
                                    <span className="inline-flex items-center gap-1 font-mono text-[11px] uppercase tracking-wider text-error bg-error-container px-2 py-0.5 rounded border border-error/20">
                                      due soon
                                    </span>
                                  )}
                                  {flagged && (
                                    <span className="inline-flex items-center gap-1 font-mono text-[11px] uppercase tracking-wider text-on-error-container bg-error-container px-2 py-0.5 rounded border border-error/20">
                                      flagged
                                    </span>
                                  )}
                                  {o.confidence === 'low' && o.verified && (
                                    <span className="inline-flex items-center gap-1 font-mono text-[11px] uppercase tracking-wider text-success bg-success-bg px-2 py-0.5 rounded border border-success-border">
                                      verified
                                    </span>
                                  )}
                                  {isConfirmed && (
                                    <span className="inline-flex items-center gap-1 font-mono text-[11px] uppercase tracking-wider text-success bg-success-bg px-2 py-0.5 rounded border border-success-border">
                                      confirmed
                                    </span>
                                  )}
                                  {o.source_page && (
                                    <span className="font-mono text-[12px] text-on-surface-variant">
                                      p.{o.source_page}
                                    </span>
                                  )}
                                </div>
                              </div>

                              <p className="text-body-lg text-on-surface">{o.description}</p>
                              {o.due_date && (
                                <p className="font-mono text-[13px] text-on-surface-variant">
                                  Due: {o.due_date}
                                </p>
                              )}
                              {o.source_excerpt && (
                                <blockquote className="border-l-2 border-outline-variant pl-3 text-body-md text-on-surface-variant italic">
                                  &ldquo;{o.source_excerpt}&rdquo;
                                </blockquote>
                              )}
                              {flagged && (
                                <p className="font-mono text-[12px] text-on-error-container">
                                  Low extraction confidence — please verify against the source clause
                                </p>
                              )}
                              <div className="flex gap-2 flex-wrap">
                                {o.status === 'pending_review' && (
                                  <button
                                    onClick={() => startEdit(o)}
                                    className="px-3 py-1.5 border border-outline text-primary font-mono text-[12px] rounded hover:bg-surface-variant transition-colors flex items-center gap-1.5"
                                  >
                                    <span className="material-symbols-outlined text-[16px]">edit</span>
                                    Edit
                                  </button>
                                )}
                                {flagged && (
                                  <button
                                    onClick={() => handleVerify(o.id)}
                                    disabled={verifyingId === o.id}
                                    className="px-3 py-1.5 bg-primary text-on-primary font-mono text-[12px] rounded hover:bg-inverse-surface transition-colors disabled:opacity-60 flex items-center gap-1.5"
                                  >
                                    <span className="material-symbols-outlined text-[16px]">verified</span>
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
    </AppShell>
  )
}
