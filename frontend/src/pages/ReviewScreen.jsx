import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import toast from 'react-hot-toast'
import { useAuth } from '../context/AuthContext'
import { apiFetch, readJson } from '../lib/api'
import AppShell from '../components/AppShell'
import DocumentViewer from '../components/DocumentViewer'
import { buildCalendarEvents, toIcs, downloadIcs } from '../lib/ics'
import { daysUntil, grantReference, isCompleted, isDueSoon, isFlagged, isOverdue } from '../lib/grantStatus'
import { supabase } from '../lib/supabase'

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
  const [grant, setGrant] = useState(null)
  // Name passed from the previous page shows instantly; the loaded row wins
  const grantName = grant?.name || window.history.state?.usr?.grantName || ''
  const [error, setError] = useState('')

  const [editingId, setEditingId] = useState(null)
  const [editForm, setEditForm] = useState({ description: '', due_date: '', type: '' })
  const [saving, setSaving] = useState(false)

  const [confirming, setConfirming] = useState(false)
  const [verifyingId, setVerifyingId] = useState(null)
  const [completingId, setCompletingId] = useState(null)
  const [approvingId, setApprovingId] = useState(null)

  const [detail, setDetail] = useState(null)
  const [showDocument, setShowDocument] = useState(false)
  const [shareOpen, setShareOpen] = useState(false)
  const [shareToken, setShareToken] = useState(null)
  const [shareBusy, setShareBusy] = useState(false)

  function exportToCalendar() {
    const grantNameMap = { [grantId]: grantName }
    const events = buildCalendarEvents(obligations, grantNameMap)
    if (events.length === 0) {
      toast.error('This grant has no dated obligations to export.')
      return
    }
    const ics = toIcs(events)
    const safe = (grantName || 'grant').toLowerCase().replace(/[^a-z0-9]+/g, '-')
    downloadIcs(`grantguard-${safe}-deadlines.ics`, ics)
    toast.success(`Exported ${events.length} deadline${events.length === 1 ? '' : 's'} to calendar`)
  }

  async function fetchShareToken() {
    try {
      const res = await apiFetch(`/api/grants/${grantId}/share`, { headers })
      if (!res.ok) throw new Error('Could not load share status')
      const payload = await readJson(res)
      setShareToken(payload.share_token || null)
    } catch (err) {
      toast.error(err.message || 'Could not load share status')
    }
  }

  async function handleGenerateShare() {
    setShareBusy(true)
    try {
      const res = await apiFetch(`/api/grants/${grantId}/share`, {
        method: 'POST',
        headers,
      })
      const payload = await readJson(res)
      if (!res.ok) throw new Error(payload.error || 'Could not create share link')
      setShareToken(payload.share_token)
      toast.success('Share link generated')
    } catch (err) {
      toast.error(err.message || 'Could not create share link')
    } finally {
      setShareBusy(false)
    }
  }

  async function handleRevokeShare() {
    setShareBusy(true)
    try {
      const res = await apiFetch(`/api/grants/${grantId}/share/revoke`, {
        method: 'POST',
        headers,
      })
      const payload = await readJson(res)
      if (!res.ok) throw new Error(payload.error || 'Could not revoke share link')
      setShareToken(null)
      toast.success('Share link revoked')
    } catch (err) {
      toast.error(err.message || 'Could not revoke share link')
    } finally {
      setShareBusy(false)
    }
  }

  function copyShareLink() {
    const link = `${window.location.origin}/s/${shareToken}`
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(link)
      toast.success('Link copied')
    } else {
      toast('Copy the link from the field below')
    }
  }

  const headers = { Authorization: `Bearer ${session.access_token}` }

  useEffect(() => {
    let active = true
    const authHeaders = { Authorization: `Bearer ${session.access_token}` }

    async function load() {
      try {
        const res = await apiFetch(`/api/grants/${grantId}/obligations`, {
          headers: authHeaders,
        })
        const payload = await readJson(res)
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

  // Grant details (name, funder, reference number), read directly under RLS
  useEffect(() => {
    let active = true
    supabase
      .from('grants')
      .select('*')
      .eq('id', grantId)
      .maybeSingle()
      .then(({ data }) => {
        if (active && data) setGrant(data)
      })
    return () => { active = false }
  }, [grantId])

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

      const res = await apiFetch(
        `/api/grants/${grantId}/obligations/${obligationId}`,
        { method: 'PATCH', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify(body) }
      )
      const payload = await readJson(res)
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
      const res = await apiFetch(
        `/api/grants/${grantId}/obligations/confirm`,
        { method: 'POST', headers }
      )
      const payload = await readJson(res)
      if (!res.ok) throw new Error(payload.error || 'Approve failed')

      setObligations((prev) =>
        prev.map((o) => (o.status === 'pending_review' ? { ...o, status: 'confirmed' } : o))
      )
      const n = payload.confirmed ?? pendingCount
      toast.success(`${n} obligation${n === 1 ? '' : 's'} approved. Their deadlines are now tracked.`)
    } catch (err) {
      toast.error(err.message || 'Could not approve the obligations')
    } finally {
      setConfirming(false)
    }
  }

  // Approve a single extraction (same as Approve all, for one obligation)
  async function handleApprove(obligationId) {
    setApprovingId(obligationId)
    try {
      const res = await apiFetch(`/api/grants/${grantId}/obligations/${obligationId}`, {
        method: 'PATCH',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'confirmed' }),
      })
      const payload = await readJson(res)
      if (!res.ok) throw new Error(payload.error || 'Approve failed')
      setObligations((prev) => prev.map((o) => (o.id === obligationId ? { ...o, status: 'confirmed' } : o)))
      toast.success('Obligation approved and tracked')
    } catch (err) {
      toast.error(err.message || 'Could not approve the obligation')
    } finally {
      setApprovingId(null)
    }
  }

  async function handleVerify(obligationId) {
    setVerifyingId(obligationId)
    try {
      const res = await apiFetch(
        `/api/grants/${grantId}/obligations/${obligationId}`,
        {
          method: 'PATCH',
          headers: { ...headers, 'Content-Type': 'application/json' },
          body: JSON.stringify({ verified: true }),
        }
      )
      const payload = await readJson(res)
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

  // Done is separate from confirmed: confirming checks the AI extraction,
  // done means the report was submitted / the condition was met
  async function handleToggleDone(o) {
    const completed = !isCompleted(o)
    setCompletingId(o.id)
    try {
      const res = await apiFetch(`/api/grants/${grantId}/obligations/${o.id}`, {
        method: 'PATCH',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ completed }),
      })
      const payload = await readJson(res)
      if (!res.ok) throw new Error(payload.error || 'Could not update the obligation')

      setObligations((prev) =>
        prev.map((x) => (x.id === o.id ? { ...x, completed_at: payload.obligation?.completed_at ?? null } : x)),
      )
      toast.success(completed ? 'Marked as done' : 'Marked as not done')
    } catch (err) {
      toast.error(err.message || 'Could not update the obligation')
    } finally {
      setCompletingId(null)
    }
  }

  const grouped = obligations.reduce((acc, o) => {
    ;(acc[o.type] = acc[o.type] || []).push(o)
    return acc
  }, {})

  const pendingCount = obligations.filter((o) => o.status === 'pending_review').length
  const flaggedCount = obligations.filter(isFlagged).length
  const overdueCount = obligations.filter((o) => isOverdue(o)).length
  const needsReview = pendingCount > 0 || flaggedCount > 0

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
          <div className="flex flex-wrap justify-center gap-3">
            <button
              onClick={() => window.location.reload()}
              className="bg-primary text-on-primary py-2.5 px-5 font-label-caps text-label-caps tracking-wider hover:bg-surface-tint transition-colors notched-br"
            >
              TRY AGAIN
            </button>
            <button
              onClick={() => navigate('/')}
              className="py-2.5 px-5 border border-outline text-primary font-label-caps text-label-caps tracking-wider hover:bg-surface-container transition-colors notched-br"
            >
              BACK TO DASHBOARD
            </button>
          </div>
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
            Dashboard
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
              {overdueCount > 0 && (
                <span className="inline-flex items-center gap-1 px-2.5 py-1 bg-alert-crimson text-white border border-alert-crimson font-label-caps text-label-caps uppercase">
                  <span className="material-symbols-outlined text-[14px]">schedule</span>
                  Overdue ({overdueCount})
                </span>
              )}
              {needsReview && (
                <span className="inline-flex items-center gap-1 px-2.5 py-1 bg-error-container text-on-error-container border border-outline-variant font-label-caps text-label-caps uppercase">
                  <span className="material-symbols-outlined text-[14px]">flag</span>
                  Needs Review
                </span>
              )}
              {obligations.length > 0 && !needsReview && overdueCount === 0 && (
                <span className="inline-flex items-center gap-1 px-2.5 py-1 bg-primary-container text-on-primary-container border border-outline-variant font-label-caps text-label-caps uppercase">
                  <span className="material-symbols-outlined filled-icon text-[14px]">check_circle</span>
                  On Track
                </span>
              )}
            </div>
            <p className="text-body-md text-on-surface-variant mt-1">
              {grantName || 'Grant agreement'}
              {grant && (
                <>
                  {grant.funder_name && <span> · {grant.funder_name}</span>}
                  <span className="ml-2 font-source-code text-source-code bg-surface-variant px-1.5 py-0.5 rounded-sm text-on-surface-variant">
                    {grantReference(grant)}
                  </span>
                </>
              )}
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
            <button
              onClick={exportToCalendar}
              disabled={obligations.length === 0}
              className="py-3 px-4 border border-outline text-primary font-label-caps text-label-caps tracking-wider uppercase hover:bg-surface-container transition-colors notched-br flex items-center gap-2 disabled:opacity-40"
              title="Export this grant's dated obligations to a calendar file"
            >
              <span className="material-symbols-outlined text-[16px]">calendar_month</span>
              Export Calendar
            </button>
            <button
              onClick={() => {
                setShareOpen(true)
                fetchShareToken()
              }}
              className="py-3 px-4 border border-outline text-primary font-label-caps text-label-caps tracking-wider uppercase hover:bg-surface-container transition-colors notched-br flex items-center gap-2"
              title="Generate a read-only summary link to share with your funder"
            >
              <span className="material-symbols-outlined text-[16px]">share</span>
              Share with Funder
            </button>
            {pendingCount > 0 && (
              <button
                onClick={confirmAll}
                disabled={confirming}
                title="Confirm the AI's extractions are correct and start tracking deadlines."
                aria-describedby="approve-all-help"
                className="bg-primary text-on-primary py-3 px-5 font-label-caps text-label-caps tracking-wider hover:bg-surface-tint transition-colors notched-br disabled:opacity-60 flex items-center gap-2"
              >
                <span className="material-symbols-outlined filled-icon text-[16px]">check_circle</span>
                {confirming ? 'APPROVING…' : `APPROVE ALL (${pendingCount})`}
              </button>
            )}
            <button
              onClick={() => navigate('/')}
              className="py-3 px-4 border border-outline text-primary font-label-caps text-label-caps tracking-wider uppercase hover:bg-surface-container transition-colors notched-br flex items-center gap-2"
            >
              <span className="material-symbols-outlined text-[16px]">arrow_back</span>
              Dashboard
            </button>
          </div>
        </header>

        {pendingCount > 0 && (
          <p id="approve-all-help" className="-mt-4 text-body-sm text-secondary">
            <span className="font-medium text-on-surface">Approve all</span> confirms the AI&apos;s extractions are
            correct and starts tracking deadlines. You can also approve or edit each obligation below.
          </p>
        )}

        {/* Summary line */}
        <p className="text-body-md text-on-surface-variant flex items-center gap-3 flex-wrap">
          {obligations.length} obligation{obligations.length !== 1 ? 's' : ''} extracted
          {overdueCount > 0 && (
            <span className="inline-flex items-center gap-1 font-label-caps text-label-caps text-alert-crimson uppercase bg-error-container px-2 py-1">
              <span className="material-symbols-outlined text-[14px]">schedule</span>
              {overdueCount} overdue
            </span>
          )}
          {pendingCount > 0 && (
            <span className="inline-flex items-center gap-1 font-label-caps text-label-caps text-warning-ochre uppercase bg-surface-container inkwell-border px-2 py-1">
              <span className="material-symbols-outlined text-[14px]">visibility</span>
              {pendingCount} pending
            </span>
          )}
          {flaggedCount > 0 && (
            <span className="inline-flex items-center gap-1 font-label-caps text-label-caps text-alert-crimson uppercase bg-error-container px-2 py-1">
              <span className="material-symbols-outlined text-[14px]">gavel</span>
              {flaggedCount} flagged
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
                      const flagged = isFlagged(o)
                      const isConfirmed = o.status === 'confirmed'
                      const isEditing = editingId === o.id
                      return (
                        <div
                          key={o.id}
                          className={`bg-surface-container-lowest inkwell-border p-5 flex flex-col gap-3 notched-card ${
                            flagged || isOverdue(o)
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
                                  {isOverdue(o) && (
                                    <span className="inline-flex items-center gap-1 font-label-caps text-label-caps text-white uppercase bg-alert-crimson px-2 py-0.5 border border-alert-crimson">
                                      <span className="material-symbols-outlined text-[14px]">schedule</span>
                                      overdue · {-daysUntil(o.due_date)}d
                                    </span>
                                  )}
                                  {isDueSoon(o) && (
                                    <span className="inline-flex items-center gap-1 font-label-caps text-label-caps text-alert-crimson uppercase bg-error-container px-2 py-0.5 border border-outline-variant">
                                      due soon
                                    </span>
                                  )}
                                  {isCompleted(o) && (
                                    <span className="inline-flex items-center gap-1 font-label-caps text-label-caps text-on-primary uppercase bg-primary px-2 py-0.5 border border-primary">
                                      <span className="material-symbols-outlined filled-icon text-[14px]">task_alt</span>
                                      done
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
                                      approved
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
                                <p className={`font-source-code text-source-code ${isOverdue(o) ? 'text-alert-crimson font-semibold' : 'text-on-surface-variant'}`}>
                                  Due: {o.due_date}
                                  {isCompleted(o) && ` · Done ${new Date(o.completed_at).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })}`}
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
                                  className="px-3 py-1.5 border border-outline text-primary font-label-caps text-[12px] uppercase tracking-wider hover:bg-surface-container transition-colors flex items-center gap-1.5"
                                >
                                  <span className="material-symbols-outlined text-[14px]">plagiarism</span>
                                  Source
                                </button>
                                {o.status === 'pending_review' && (
                                  <>
                                    <button
                                      onClick={() => handleApprove(o.id)}
                                      disabled={approvingId === o.id}
                                      title="This extraction is correct: start tracking it"
                                      className="px-3 py-1.5 bg-primary text-on-primary font-label-caps text-[12px] uppercase tracking-wider hover:bg-surface-tint transition-colors disabled:opacity-60 flex items-center gap-1.5"
                                    >
                                      <span className="material-symbols-outlined filled-icon text-[14px]">check_circle</span>
                                      {approvingId === o.id ? 'Approving…' : 'Approve'}
                                    </button>
                                    <button
                                      onClick={() => startEdit(o)}
                                      title="Fix the AI's extraction before approving"
                                      className="px-3 py-1.5 border border-outline text-primary font-label-caps text-[12px] uppercase tracking-wider hover:bg-surface-container transition-colors flex items-center gap-1.5"
                                    >
                                      <span className="material-symbols-outlined text-[14px]">edit</span>
                                      Edit
                                    </button>
                                  </>
                                )}
                                {flagged && (
                                  <button
                                    onClick={() => handleVerify(o.id)}
                                    disabled={verifyingId === o.id}
                                    className="px-3 py-1.5 bg-primary text-on-primary font-label-caps text-[12px] uppercase tracking-wider hover:bg-surface-tint transition-colors disabled:opacity-60 flex items-center gap-1.5"
                                  >
                                    <span className="material-symbols-outlined filled-icon text-[14px]">verified</span>
                                    {verifyingId === o.id ? 'Marking…' : 'Mark as reviewed'}
                                  </button>
                                )}
                                {(o.due_date || o.type === 'deadline' || o.type === 'reporting') && (
                                  <button
                                    onClick={() => handleToggleDone(o)}
                                    disabled={completingId === o.id}
                                    aria-pressed={isCompleted(o)}
                                    className="px-3 py-1.5 border border-outline text-primary font-label-caps text-[12px] uppercase tracking-wider hover:bg-surface-container transition-colors disabled:opacity-60 flex items-center gap-1.5"
                                  >
                                    <span className={`material-symbols-outlined text-[14px] ${isCompleted(o) ? '' : 'filled-icon'}`}>
                                      {isCompleted(o) ? 'undo' : 'task_alt'}
                                    </span>
                                    {completingId === o.id ? 'Saving…' : isCompleted(o) ? 'Mark as not done' : 'Mark as done'}
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
                    {detail.status === 'confirmed' ? 'Approved' : isFlagged(detail) ? 'Flagged' : 'Needs Review'}
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
                    {verifyingId === detail.id ? 'Resolving…' : 'Mark as resolved'}
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
                Source clause
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
      {shareOpen && (
        <div
          className="fixed inset-0 z-[70] flex items-center justify-center p-4 md:p-8"
          role="dialog"
          aria-modal="true"
          aria-label="Share compliance summary"
        >
          <div className="absolute inset-0 bg-black/40" onClick={() => setShareOpen(false)} />
          <div className="relative w-full max-w-xl bg-surface-container-lowest inkwell-border notched-card shadow-2xl">
            <div className="p-6 md:p-8">
              <div className="flex items-start justify-between mb-6">
                <div className="flex items-center gap-2">
                  <span className="material-symbols-outlined filled-icon text-primary">share</span>
                  <h3 className="font-headline-lg-mobile text-headline-lg-mobile font-semibold text-on-surface">
                    Share compliance summary
                  </h3>
                </div>
                <button
                  onClick={() => setShareOpen(false)}
                  aria-label="Close share dialog"
                  className="text-secondary hover:text-primary transition-colors p-1"
                >
                  <span className="material-symbols-outlined">close</span>
                </button>
              </div>

              <p className="text-body-md text-on-surface-variant mb-6">
                Share a <strong className="text-on-surface">read-only summary</strong> of this grant&apos;s
                confirmed obligations with your funder. They will not need an account, and they will
                not see the full agreement, clause excerpts, or any other grant.
              </p>

              {shareToken ? (
                <div className="space-y-4">
                  <div className="flex flex-col gap-2">
                    <span className="font-label-caps text-label-caps text-secondary uppercase">Share link</span>
                    <div className="flex items-center gap-2">
                      <input
                        readOnly
                        value={`${window.location.origin}/s/${shareToken}`}
                        onFocus={(e) => e.target.select()}
                        className="flex-1 min-w-0 bg-surface-container-high inkwell-border px-3 py-2 font-source-code text-source-code text-sm text-on-surface focus:outline-none focus:border-primary"
                      />
                      <button
                        onClick={copyShareLink}
                        className="shrink-0 py-2 px-3 border border-outline text-primary font-label-caps text-label-caps tracking-wider uppercase hover:bg-surface-container transition-colors notched-br"
                      >
                        Copy
                      </button>
                    </div>
                    <a
                      href={`${window.location.origin}/s/${shareToken}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="font-label-caps text-label-caps text-primary hover:text-surface-tint uppercase self-start"
                    >
                      Open preview →
                    </a>
                  </div>

                  <div className="flex flex-wrap gap-3 pt-2 border-t border-outline-variant">
                    <button
                      onClick={handleGenerateShare}
                      disabled={shareBusy}
                      className="py-2.5 px-4 border border-outline text-primary font-label-caps text-label-caps tracking-wider uppercase hover:bg-surface-container transition-colors notched-br disabled:opacity-60"
                    >
                      {shareBusy ? 'Working…' : 'Regenerate'}
                    </button>
                    <button
                      onClick={handleRevokeShare}
                      disabled={shareBusy}
                      className="py-2.5 px-4 bg-error text-on-error font-label-caps text-label-caps tracking-wider uppercase hover:bg-alert-crimson transition-colors notched-br disabled:opacity-60"
                    >
                      {shareBusy ? 'Working…' : 'Revoke link'}
                    </button>
                  </div>
                </div>
              ) : (
                <div className="space-y-4">
                  <div className="bg-surface-container-high inkwell-border p-4 text-body-md text-on-surface-variant">
                    No active share link. Generate one to send a read-only summary to your funder.
                  </div>
                  <button
                    onClick={handleGenerateShare}
                    disabled={shareBusy}
                    className="w-full bg-primary text-on-primary py-3 font-label-caps text-label-caps tracking-wider uppercase hover:bg-surface-tint transition-colors notched-br flex items-center justify-center gap-2 disabled:opacity-60"
                  >
                    <span className="material-symbols-outlined filled-icon text-[16px]">add_link</span>
                    {shareBusy ? 'Generating…' : 'Generate share link'}
                  </button>
                </div>
              )}
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