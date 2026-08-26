import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { supabase } from '../lib/supabase'

const API_URL = import.meta.env.VITE_API_URL

const DUE_SOON_DAYS = 14

function statusBadge(grant, docStatus, pendingCount) {
  if (docStatus === 'pending') return 'processing'
  if (docStatus === 'failed') return 'failed'
  if (pendingCount > 0) return 'needs review'
  return 'on track'
}

export default function Dashboard() {
  const { user, signOut } = useAuth()
  const navigate = useNavigate()

  const [signingOut, setSigningOut] = useState(false)
  const [loading, setLoading] = useState(true)
  const [grants, setGrants] = useState([])
  const [stats, setStats] = useState({ total: 0, obligations: 0, dueSoon: 0, lowConf: 0 })
  const [dueSoonList, setDueSoonList] = useState([])
  const [flagList, setFlagList] = useState([])

  const [showUpload, setShowUpload] = useState(false)
  const formRef = useRef(null)
  const [uploading, setUploading] = useState(false)
  const [uploadError, setUploadError] = useState('')
  const [loadError, setLoadError] = useState('')

  async function handleSignOut() {
    setSigningOut(true)
    await signOut()
    navigate('/login', { replace: true })
  }

  useEffect(() => {
    if (!user) return
    let active = true

    async function load() {
      try {
        const { data: authData } = await supabase.auth.getSession()
        const token = authData.session?.access_token
        if (!token || !active) return

        // Fetch grants
        const { data: grantsData } = await supabase
          .from('grants')
          .select('*')
          .eq('user_id', user.id)
          .order('created_at', { ascending: false })

        if (!active) return
        const grantList = grantsData || []

        // Fetch all obligations for this user's grants
        let allObligations = []
        let allDocs = []
        if (grantList.length > 0) {
          const grantIds = grantList.map((g) => g.id)

          const { data: obligationsData } = await supabase
            .from('obligations')
            .select('*')
            .in('grant_id', grantIds)

          allObligations = obligationsData || []

          const { data: docsData } = await supabase
            .from('documents')
            .select('*')
            .in('grant_id', grantIds)

          allDocs = docsData || []
        }

        if (!active) return

        // Compute stats
        const now = new Date()
        const dueSoonDeadline = new Date(now.getTime() + DUE_SOON_DAYS * 24 * 60 * 60 * 1000)

        const dueSoonItems = allObligations.filter((o) => {
          if (!o.due_date) return false
          const d = new Date(o.due_date)
          return d >= now && d <= dueSoonDeadline
        })

        const lowConf = allObligations.filter(
          (o) => o.confidence === 'low' && !o.verified
        ).length

        // Build compliance flag list (low-confidence, not yet verified)
        const flagItems = allObligations
          .filter((o) => o.confidence === 'low' && !o.verified)
          .map((o) => {
            const grant = grantList.find((g) => g.id === o.grant_id)
            return { ...o, grantName: grant?.name || 'Unknown grant' }
          })

        setStats({
          total: grantList.length,
          obligations: allObligations.length,
          dueSoon: dueSoonItems.length,
          lowConf,
        })

        // Build due-soon list with grant names, sorted by closest due date
        const dueSoonList = dueSoonItems
          .map((o) => {
            const grant = grantList.find((g) => g.id === o.grant_id)
            const daysLeft = Math.ceil((new Date(o.due_date) - now) / (1000 * 60 * 60 * 24))
            return { ...o, grantName: grant?.name || 'Unknown grant', daysLeft }
          })
          .sort((a, b) => a.daysLeft - b.daysLeft)

        // Enrich grants with doc status + pending obligation count
        const enriched = grantList.map((g) => {
          const docs = allDocs.filter((d) => d.grant_id === g.id)
          const latestDoc = docs.sort(
            (a, b) => new Date(b.uploaded_at) - new Date(a.uploaded_at)
          )[0]
          const pending = allObligations.filter(
            (o) => o.grant_id === g.id && o.status === 'pending_review'
          ).length

          return {
            ...g,
            docStatus: latestDoc?.extraction_status || 'pending',
            pendingCount: pending,
            obligationCount: allObligations.filter((o) => o.grant_id === g.id).length,
          }
        })

        setGrants(enriched)
        setDueSoonList(dueSoonList)
        setFlagList(flagItems)
      } catch (err) {
        console.error('Dashboard load failed:', err)
        if (active) setLoadError('Could not load your grants. Please try again later.')
      } finally {
        if (active) setLoading(false)
      }
    }

    load()
    return () => { active = false }
  }, [user])

  async function handleUpload(event) {
    event.preventDefault()
    setUploadError('')

    const formData = new FormData(event.currentTarget)
    const name = formData.get('name').trim()
    const funderName = formData.get('funder_name').trim()
    const file = formData.get('file')

    if (!name || !funderName) {
      setUploadError('Grant name and funder are required.')
      return
    }
    if (!file || file.size === 0) {
      setUploadError('Choose a PDF to upload.')
      return
    }

    try {
      setUploading(true)
      const { data: authData } = await supabase.auth.getSession()
      const token = authData.session?.access_token

      const response = await fetch(`${API_URL}/api/grants`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: formData,
      })
      const payload = await response.json()

      if (!response.ok) {
        throw new Error(payload.error || `Upload failed (${response.status})`)
      }

      navigate(`/grants/${payload.grant.id}/review`, {
        state: { grantName: payload.grant.name },
      })
    } catch (err) {
      setUploadError(err.message)
    } finally {
      setUploading(false)
    }
  }

  return (
    <div className="app-shell">
      <header className="app-header">
        <span className="app-brand">GrantGuard AI</span>
        <div className="app-header-user">
          <span className="app-user-email">{user?.email}</span>
          <button
            type="button"
            className="auth-button auth-button-ghost"
            onClick={handleSignOut}
            disabled={signingOut}
          >
            {signingOut ? 'Logging out…' : 'Log out'}
          </button>
        </div>
      </header>

      <main className="app-main dashboard-main">
        <div className="dashboard-container">
          <div className="dashboard-top">
            <div>
              <h1>Dashboard</h1>
              <p className="dashboard-subtitle">Signed in as <strong>{user?.email}</strong></p>
            </div>
            <button
              className="auth-button dashboard-upload-btn"
              onClick={() => setShowUpload(!showUpload)}
            >
              {showUpload ? 'Cancel' : '+ Upload agreement'}
            </button>
          </div>

          {showUpload && (
            <div className="dashboard-upload-form auth-card">
              <h2>Upload a grant agreement</h2>
              <form ref={formRef} onSubmit={handleUpload} className="upload-form">
                <div className="auth-field">
                  <label htmlFor="grant-name">Grant name</label>
                  <input
                    id="grant-name"
                    name="name"
                    type="text"
                    placeholder="e.g. WASH Access Programme 2026"
                  />
                </div>
                <div className="auth-field">
                  <label htmlFor="grant-funder">Funder</label>
                  <input
                    id="grant-funder"
                    name="funder_name"
                    type="text"
                    placeholder="e.g. GlobalDev Foundation"
                  />
                </div>
                <div className="auth-field">
                  <label htmlFor="grant-file">Agreement PDF (max 15 MB)</label>
                  <input id="grant-file" name="file" type="file" accept="application/pdf" />
                </div>
                {uploadError && (
                  <p role="alert" className="auth-alert auth-alert-error">{uploadError}</p>
                )}
                <button type="submit" className="auth-button" disabled={uploading}>
                  {uploading ? 'Uploading & extracting…' : 'Upload & extract'}
                </button>
              </form>
            </div>
          )}

          {loading ? (
            <div className="review-loading">
              <div className="review-spinner" />
              <p>Loading your grants…</p>
            </div>
          ) : loadError ? (
            <div className="auth-card">
              <div className="auth-alert auth-alert-error" role="alert">
                {loadError}
              </div>
              <button
                className="auth-button"
                onClick={() => window.location.reload()}
              >
                Try again
              </button>
            </div>
          ) : grants.length === 0 ? (
            <div className="dashboard-empty auth-card">
              <h2>Welcome to GrantGuard AI</h2>
              <p>
                You haven't uploaded any grant agreements yet. Upload your first one to
                track obligations, deadlines, and compliance requirements.
              </p>
              <button
                className="auth-button"
                onClick={() => setShowUpload(true)}
              >
                Upload your first agreement
              </button>
            </div>
          ) : (
            <>
              <div className="dashboard-stats">
                <div className="stat-card">
                  <span className="stat-value">{stats.total}</span>
                  <span className="stat-label">Active grants</span>
                </div>
                <div className="stat-card">
                  <span className="stat-value">{stats.obligations}</span>
                  <span className="stat-label">Obligations tracked</span>
                </div>
                <div className="stat-card">
                  <span className={`stat-value ${stats.dueSoon > 0 ? 'stat-attention' : ''}`}>
                    {stats.dueSoon}
                  </span>
                  <span className="stat-label">Due soon (14 days)</span>
                </div>
                <div className="stat-card">
                  <span className={`stat-value ${stats.lowConf > 0 ? 'stat-attention' : ''}`}>
                    {stats.lowConf}
                  </span>
                  <span className="stat-label">Needs review</span>
                </div>
              </div>

              {dueSoonList.length > 0 && (
                <section className="dashboard-due-soon">
                  <h2>Due soon</h2>
                  <p className="dashboard-due-soon-subtitle">
                    Obligations with due dates in the next {DUE_SOON_DAYS} days
                  </p>
                  <div className="due-soon-list">
                    {dueSoonList.map((o) => (
                      <button
                        key={o.id}
                        className="due-soon-card"
                        onClick={() =>
                          navigate(`/grants/${o.grant_id}/review`, {
                            state: { grantName: o.grantName },
                          })
                        }
                      >
                        <div className="due-soon-card-top">
                          <span className={`obligation-type type-${o.type}`}>
                            {o.type.replace('_', ' ')}
                          </span>
                          <span className="due-soon-countdown">
                            {o.daysLeft === 0 ? 'Today' : o.daysLeft === 1 ? 'Tomorrow' : `${o.daysLeft} days`}
                          </span>
                        </div>
                        <p className="due-soon-description">{o.description}</p>
                        {o.source_excerpt && (
                          <blockquote className="dashboard-excerpt">
                            &ldquo;{o.source_excerpt}&rdquo;
                          </blockquote>
                        )}
                        <div className="due-soon-meta">
                          <span className="due-soon-grant">{o.grantName}</span>
                          <span className="due-soon-date">Due {o.due_date}</span>
                          {o.source_page && <span className="dashboard-page">p.{o.source_page}</span>}
                        </div>
                      </button>
                    ))}
                  </div>
                </section>
              )}

              {flagList.length > 0 && (
                <section className="dashboard-flags">
                  <h2>Compliance flags</h2>
                  <p className="dashboard-flags-subtitle">
                    These obligations have low extraction confidence and need your review
                  </p>
                  <div className="flag-list">
                    {flagList.map((o) => (
                      <button
                        key={o.id}
                        className="flag-card"
                        onClick={() =>
                          navigate(`/grants/${o.grant_id}/review`, {
                            state: { grantName: o.grantName },
                          })
                        }
                      >
                        <div className="flag-card-top">
                          <span className={`obligation-type type-${o.type}`}>
                            {o.type.replace('_', ' ')}
                          </span>
                          <span className="flag-badge">needs verification</span>
                        </div>
                        <p className="flag-description">{o.description}</p>
                        {o.source_excerpt && (
                          <blockquote className="dashboard-excerpt">
                            &ldquo;{o.source_excerpt}&rdquo;
                          </blockquote>
                        )}
                        <p className="flag-explanation">
                          Low extraction confidence — please verify against the source clause
                        </p>
                        <div className="flag-meta">
                          <span className="flag-grant">{o.grantName}</span>
                          {o.due_date && <span className="flag-due">Due {o.due_date}</span>}
                          {o.source_page && <span className="dashboard-page">p.{o.source_page}</span>}
                        </div>
                      </button>
                    ))}
                  </div>
                </section>
              )}

              <section className="dashboard-grants">
                <h2>Your grants</h2>
                <div className="grant-list">
                  {grants.map((g) => (
                    <button
                      key={g.id}
                      className="grant-card"
                      onClick={() =>
                        navigate(`/grants/${g.id}/review`, {
                          state: { grantName: g.name },
                        })
                      }
                    >
                      <div className="grant-card-header">
                        <h3 className="grant-card-name">{g.name}</h3>
                        <span className={`grant-badge grant-badge-${statusBadge(g, g.docStatus, g.pendingCount).replace(/\s/g, '-')}`}>
                          {statusBadge(g, g.docStatus, g.pendingCount)}
                        </span>
                      </div>
                      <p className="grant-card-funder">{g.funder_name}</p>
                      <div className="grant-card-meta">
                        <span>{g.obligationCount} obligation{g.obligationCount !== 1 ? 's' : ''}</span>
                        {g.pendingCount > 0 && (
                          <span className="grant-card-pending">{g.pendingCount} pending</span>
                        )}
                        <span className="grant-card-date">
                          Created {new Date(g.created_at).toLocaleDateString()}
                        </span>
                      </div>
                    </button>
                  ))}
                </div>
              </section>
            </>
          )}
        </div>
      </main>
    </div>
  )
}
