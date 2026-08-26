import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'

const API_URL = import.meta.env.VITE_API_URL

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

  // Grant name from navigation state (passed after upload)
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
    } catch (err) {
      setError(err.message)
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
    } catch (err) {
      setError(err.message)
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
    } catch (err) {
      setError(err.message)
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
  const dueSoonCount = obligations.filter((o) => isDueSoon(o.due_date)).length

  if (loading) {
    return (
      <div className="app-shell">
        <header className="app-header">
          <span className="app-brand">GrantGuard AI</span>
        </header>
        <main className="app-main">
          <div className="review-loading">
            <div className="review-spinner" />
            <p>Loading obligations…</p>
          </div>
        </main>
      </div>
    )
  }

  if (error && obligations.length === 0) {
    return (
      <div className="app-shell">
        <header className="app-header">
          <span className="app-brand">GrantGuard AI</span>
        </header>
        <main className="app-main">
          <div className="auth-card">
            <p role="alert" className="auth-alert auth-alert-error">{error}</p>
            <button className="auth-button" onClick={() => navigate('/')}>Back to Dashboard</button>
          </div>
        </main>
      </div>
    )
  }

  return (
    <div className="app-shell">
      <header className="app-header">
        <span className="app-brand">GrantGuard AI</span>
        <button className="auth-button auth-button-ghost" onClick={() => navigate('/')}>
          Back to Dashboard
        </button>
      </header>

      <main className="app-main review-main">
        <div className="review-container">
          <div className="review-header">
            <h1>Review Obligations</h1>
            {grantName && <p className="review-grant-name">{grantName}</p>}
            <p className="review-summary">
              {obligations.length} obligation{obligations.length !== 1 ? 's' : ''} extracted
              {pendingCount > 0 && (
                <span className="review-pending-badge">{pendingCount} pending review</span>
              )}
              {lowConfidenceCount > 0 && (
                <span className="review-low-badge">{lowConfidenceCount} low confidence — needs review</span>
              )}
              {dueSoonCount > 0 && (
                <span className="review-due-soon-badge">{dueSoonCount} due within {DUE_SOON_DAYS} days</span>
              )}
            </p>
          </div>

          {error && (
            <p role="alert" className="auth-alert auth-alert-error">{error}</p>
          )}

          {confirmed && (
            <div className="review-confirmed-banner">
              All obligations confirmed — tracking is now active.
            </div>
          )}

          {obligations.length === 0 ? (
            <div className="auth-card">
              <p>No obligations were found for this grant.</p>
            </div>
          ) : (
            <>
              {Object.entries(TYPE_LABELS).map(([type, label]) => {
                const items = grouped[type]
                if (!items || items.length === 0) return null
                return (
                  <section key={type} className="review-group">
                    <h2 className={`review-group-title type-${type}`}>{label}</h2>
                    <div className="review-group-list">
                      {items.map((o) => (
                        <div key={o.id} className={`review-card ${o.status === 'confirmed' ? 'review-card-confirmed' : ''} ${isDueSoon(o.due_date) ? 'review-card-due-soon' : ''} ${o.confidence === 'low' && !o.verified ? 'review-card-flagged' : ''}`}>
                          <div className="review-card-top">
                            <span className={`obligation-type type-${o.type}`}>
                              {TYPE_LABELS[o.type] || o.type}
                            </span>
                            <div className="review-card-badges">
                              {isDueSoon(o.due_date) && (
                                <span className="due-soon-badge">due soon</span>
                              )}
                              {o.confidence === 'low' && !o.verified && (
                                <span className="review-flag-badge">flagged</span>
                              )}
                              {o.confidence === 'low' && o.verified && (
                                <span className="review-verified-badge">verified</span>
                              )}
                              {o.status === 'confirmed' && (
                                <span className="review-confirmed-badge">confirmed</span>
                              )}
                              {o.source_page && (
                                <span className="obligation-source">p.{o.source_page}</span>
                              )}
                            </div>
                          </div>

                          {editingId === o.id ? (
                            <div className="review-edit-form">
                              <div className="auth-field">
                                <label htmlFor={`edit-type-${o.id}`}>Type</label>
                                <select
                                  id={`edit-type-${o.id}`}
                                  value={editForm.type}
                                  onChange={(e) => setEditForm((f) => ({ ...f, type: e.target.value }))}
                                >
                                  {Object.entries(TYPE_LABELS).map(([val, lbl]) => (
                                    <option key={val} value={val}>{lbl}</option>
                                  ))}
                                </select>
                              </div>
                              <div className="auth-field">
                                <label htmlFor={`edit-desc-${o.id}`}>Description</label>
                                <textarea
                                  id={`edit-desc-${o.id}`}
                                  value={editForm.description}
                                  onChange={(e) => setEditForm((f) => ({ ...f, description: e.target.value }))}
                                  rows={3}
                                />
                              </div>
                              <div className="auth-field">
                                <label htmlFor={`edit-due-${o.id}`}>Due date (optional)</label>
                                <input
                                  id={`edit-due-${o.id}`}
                                  type="date"
                                  value={editForm.due_date}
                                  onChange={(e) => setEditForm((f) => ({ ...f, due_date: e.target.value }))}
                                />
                              </div>
                              <div className="review-edit-actions">
                                <button
                                  className="auth-button"
                                  onClick={() => saveEdit(o.id)}
                                  disabled={saving}
                                >
                                  {saving ? 'Saving…' : 'Save'}
                                </button>
                                <button
                                  className="auth-button auth-button-ghost"
                                  onClick={cancelEdit}
                                  disabled={saving}
                                >
                                  Cancel
                                </button>
                              </div>
                            </div>
                          ) : (
                            <>
                              <p className="obligation-description">{o.description}</p>
                              {o.due_date && (
                                <p className="obligation-due">Due: {o.due_date}</p>
                              )}
                              {o.source_excerpt && (
                                <blockquote className="obligation-excerpt">
                                  &ldquo;{o.source_excerpt}&rdquo;
                                </blockquote>
                              )}
                              {o.confidence === 'low' && !o.verified && (
                                <p className="review-flag-explanation">
                                  Low extraction confidence — please verify against the source clause
                                </p>
                              )}
                              {o.status === 'pending_review' && (
                                <button
                                  className="review-edit-btn"
                                  onClick={() => startEdit(o)}
                                >
                                  Edit
                                </button>
                              )}
                              {o.confidence === 'low' && !o.verified && (
                                <button
                                  className="review-verify-btn"
                                  onClick={() => handleVerify(o.id)}
                                  disabled={verifyingId === o.id}
                                >
                                  {verifyingId === o.id ? 'Marking…' : 'Mark as reviewed'}
                                </button>
                              )}
                            </>
                          )}
                        </div>
                      ))}
                    </div>
                  </section>
                )
              })}

              {pendingCount > 0 && (
                <div className="review-confirm-section">
                  <button
                    className="auth-button review-confirm-btn"
                    onClick={confirmAll}
                    disabled={confirming}
                  >
                    {confirming ? 'Confirming…' : `Confirm and activate tracking (${pendingCount})`}
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      </main>
    </div>
  )
}
