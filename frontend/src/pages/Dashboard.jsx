import { useCallback, useEffect, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import toast from 'react-hot-toast'
import { useAuth } from '../context/AuthContext'
import { supabase } from '../lib/supabase'
import API_URL from '../lib/api'
import AppShell from '../components/AppShell'

const DUE_SOON_DAYS = 14

function statusBadge(grant, docStatus, pendingCount) {
  if (docStatus === 'pending') return 'processing'
  if (docStatus === 'failed') return 'failed'
  if (pendingCount > 0) return 'needs review'
  return 'on track'
}

const BADGE_STYLES = {
  'on track': 'bg-success-bg text-success border-success-border',
  'needs review': 'bg-error-container text-on-error-container border-error/20',
  failed: 'bg-error-container text-on-error-container border-error/20',
  processing: 'bg-surface-variant text-on-surface-variant border-outline-variant',
}

export default function Dashboard() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()

  const [loading, setLoading] = useState(true)
  const [grants, setGrants] = useState([])
  const [stats, setStats] = useState({ total: 0, obligations: 0, dueSoon: 0, lowConf: 0 })
  const [dueSoonList, setDueSoonList] = useState([])
  const [flagList, setFlagList] = useState([])

  const [showUpload, setShowUpload] = useState(false)
  const formRef = useRef(null)
  const [uploading, setUploading] = useState(false)
  const [deletingId, setDeletingId] = useState(null)
  const [confirmDeleteId, setConfirmDeleteId] = useState(null)
  const [retryingId, setRetryingId] = useState(null)

  async function handleDeleteGrant(e, grantId) {
    e.stopPropagation()
    if (confirmDeleteId !== grantId) {
      setConfirmDeleteId(grantId)
      return
    }
    setConfirmDeleteId(null)
    setDeletingId(grantId)
    try {
      const { data: authData } = await supabase.auth.getSession()
      const token = authData.session?.access_token
      const res = await fetch(`${API_URL}/api/grants/${grantId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      })
      if (!res.ok) {
        const payload = await res.json()
        throw new Error(payload.error || 'Delete failed')
      }
      toast.success('Grant deleted')
      await loadData()
    } catch (err) {
      toast.error(err.message || 'Could not delete the grant.')
    } finally {
      setDeletingId(null)
    }
  }

  async function handleRetryExtraction(e, grantId) {
    e.stopPropagation()
    setRetryingId(grantId)
    try {
      const { data: authData } = await supabase.auth.getSession()
      const token = authData.session?.access_token
      const res = await fetch(`${API_URL}/api/grants/${grantId}/retry`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      })
      const payload = await res.json()
      if (!res.ok) throw new Error(payload.error || 'Retry failed')

      if (payload.obligationError) {
        toast.error(`Retry failed: ${payload.obligationError}`)
        return
      }
      if (payload.extraction?.status !== 'extracted') {
        toast.error('Still cannot extract text from this PDF. It may be a scanned/image document.')
        return
      }
      navigate(`/grants/${grantId}/review`)
    } catch (err) {
      toast.error(err.message || 'Retry failed')
    } finally {
      setRetryingId(null)
    }
  }

  const loadData = useCallback(async () => {
    if (!user) return

    const { data: authData } = await supabase.auth.getSession()
    const token = authData.session?.access_token
    if (!token) return

    const { data: grantsData } = await supabase
      .from('grants')
      .select('*')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })

    const grantList = grantsData || []

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

    const dueSoonList = dueSoonItems
      .map((o) => {
        const grant = grantList.find((g) => g.id === o.grant_id)
        const daysLeft = Math.ceil((new Date(o.due_date) - now) / (1000 * 60 * 60 * 24))
        return { ...o, grantName: grant?.name || 'Unknown grant', daysLeft }
      })
      .sort((a, b) => a.daysLeft - b.daysLeft)

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
  }, [user])

  useEffect(() => {
    if (!user) return
    let active = true

    async function load() {
      await loadData()
      if (active) setLoading(false)
    }

    load()
    return () => { active = false }
  }, [user, loadData, location.pathname])

  async function handleUpload(event) {
    event.preventDefault()

    const formData = new FormData(event.currentTarget)
    const name = formData.get('name').trim()
    const funderName = formData.get('funder_name').trim()
    const file = formData.get('file')

    if (!name || !funderName) {
      toast.error('Grant name and funder are required.')
      return
    }
    if (!file || file.size === 0) {
      toast.error('Choose a PDF to upload.')
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

      if (payload.obligationError) {
        toast.error(`Upload succeeded but extraction had issues: ${payload.obligationError}`)
        return
      }

      if (payload.extraction?.status !== 'extracted') {
        const reason = payload.extraction?.error
          ? `PDF could not be parsed: ${payload.extraction.error}`
          : 'PDF text extraction failed. The file may be a scanned/image PDF.'
        toast.error(reason)
        return
      }

      if (payload.obligations && payload.obligations.length === 0) {
        toast.error('The AI analyzed the document but found no obligations. The PDF may not contain grant agreement text.')
        return
      }

      formRef.current?.reset()
      toast.success('Grant uploaded and analyzed')
      navigate(`/grants/${payload.grant.id}/review`, {
        state: { grantName: payload.grant.name },
      })
    } catch (err) {
      toast.error(err.message || 'Upload failed')
    } finally {
      setUploading(false)
    }
  }

  const fileInput = (
    <>
      <div className="flex flex-col gap-1">
        <label
          htmlFor="upload-name"
          className="font-mono text-[12px] leading-4 text-on-surface-variant uppercase tracking-wider"
        >
          Grant name
        </label>
        <input
          id="upload-name"
          name="name"
          type="text"
          placeholder="e.g. WASH Access Programme 2026"
          className="w-full h-11 px-3 bg-surface border border-outline-variant rounded text-body-md text-on-surface placeholder:text-on-surface-variant/50 focus:outline-none focus:border-primary transition-colors"
        />
      </div>
      <div className="flex flex-col gap-1">
        <label
          htmlFor="upload-funder"
          className="font-mono text-[12px] leading-4 text-on-surface-variant uppercase tracking-wider"
        >
          Funder
        </label>
        <input
          id="upload-funder"
          name="funder_name"
          type="text"
          placeholder="e.g. GlobalDev Foundation"
          className="w-full h-11 px-3 bg-surface border border-outline-variant rounded text-body-md text-on-surface placeholder:text-on-surface-variant/50 focus:outline-none focus:border-primary transition-colors"
        />
      </div>
      <div className="flex flex-col gap-1">
        <label
          htmlFor="upload-file"
          className="font-mono text-[12px] leading-4 text-on-surface-variant uppercase tracking-wider"
        >
          Agreement PDF (max 15 MB)
        </label>
        <input
          id="upload-file"
          name="file"
          type="file"
          accept="application/pdf"
          className="w-full h-11 px-3 bg-surface border border-outline-variant rounded text-body-md text-on-surface file:mr-3 file:border-0 file:bg-surface-container file:px-3 file:h-full file:text-on-surface focus:outline-none focus:border-primary transition-colors"
        />
      </div>
      <button
        type="submit"
        disabled={uploading}
        className="self-start px-5 h-11 bg-primary text-on-primary text-body-md font-medium rounded hover:bg-inverse-surface transition-colors flex items-center gap-2 disabled:opacity-60"
      >
        <span className="material-symbols-outlined text-[20px]">auto_awesome</span>
        {uploading ? 'Uploading & extracting…' : 'Upload & extract'}
      </button>
    </>
  )

  return (
    <AppShell>
      <div className="space-y-10">
        {/* Page header */}
        <header className="flex flex-col md:flex-row md:items-end justify-between gap-4 border-b border-outline-variant pb-6">
          <div>
            <h1 className="text-[32px] sm:text-[40px] leading-[1.05] font-semibold tracking-tight text-primary">
              Portfolio Overview
            </h1>
            <p className="text-body-lg text-on-surface-variant mt-2 max-w-2xl">
              High-level metrics and active grant tracking across all your obligations.
            </p>
          </div>
          <button
            onClick={() => setShowUpload(!showUpload)}
            className="shrink-0 px-5 h-11 bg-primary text-on-primary text-body-md font-medium rounded hover:bg-inverse-surface transition-colors flex items-center gap-2"
          >
            <span className="material-symbols-outlined text-[20px]">
              {showUpload ? 'close' : 'add'}
            </span>
            {showUpload ? 'Cancel' : 'Upload agreement'}
          </button>
        </header>

        {/* Upload form */}
        {showUpload && (
          <div className="border border-outline-variant bg-surface rounded-lg p-6">
            <h2 className="text-headline-md text-primary mb-5">Upload a grant agreement</h2>
            <form ref={formRef} onSubmit={handleUpload} className="grid grid-cols-1 sm:grid-cols-2 gap-5 items-start">
              {fileInput}
            </form>
          </div>
        )}

        {/* Loading */}
        {loading ? (
          <div className="flex flex-col items-center justify-center py-24 text-on-surface-variant">
            <div className="w-8 h-8 border-2 border-outline-variant border-t-primary rounded-full animate-spin mb-3" />
            <p className="text-body-md">Loading your grants…</p>
          </div>
        ) : grants.length === 0 ? (
          <div className="border border-dashed border-outline-variant rounded-lg p-10 flex flex-col items-center justify-center text-center bg-surface">
            <span className="material-symbols-outlined text-[48px] text-secondary mb-4">description</span>
            <h2 className="text-headline-md text-primary mb-1">Welcome to GrantGuard AI</h2>
            <p className="text-body-md text-on-surface-variant max-w-md">
              You haven&apos;t uploaded any grant agreements yet. Upload your first one to track
              obligations, deadlines, and compliance requirements.
            </p>
            <button
              onClick={() => setShowUpload(true)}
              className="mt-6 px-5 h-11 bg-primary text-on-primary text-body-md font-medium rounded hover:bg-inverse-surface transition-colors flex items-center gap-2"
            >
              <span className="material-symbols-outlined">upload_file</span>
              Upload your first agreement
            </button>
          </div>
        ) : (
          <>
            {/* Metric row */}
            <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              <div className="bg-surface-container-lowest border border-outline-variant p-6 rounded-lg flex flex-col hover:border-outline transition-colors">
                <span className="font-mono text-[12px] leading-4 text-on-surface-variant uppercase mb-3">
                  Active Grants
                </span>
                <span className="text-display-web text-primary mt-auto">{stats.total}</span>
              </div>
              <div className="bg-surface-container-lowest border border-outline-variant p-6 rounded-lg flex flex-col hover:border-outline transition-colors">
                <span className="font-mono text-[12px] leading-4 text-on-surface-variant uppercase mb-3">
                  Obligations tracked
                </span>
                <span className="text-display-web text-primary mt-auto">{stats.obligations}</span>
              </div>
              <div
                className={`border p-6 rounded-lg flex flex-col relative overflow-hidden hover:border-outline transition-colors ${
                  stats.dueSoon > 0
                    ? 'bg-error-container border-error/30'
                    : 'bg-surface-container-lowest border-outline-variant'
                }`}
              >
                <span
                  className={`font-mono text-[12px] leading-4 uppercase mb-3 flex items-center gap-1.5 ${
                    stats.dueSoon > 0 ? 'text-on-error-container' : 'text-on-surface-variant'
                  }`}
                >
                  <span className="material-symbols-outlined text-[16px]">schedule</span>
                  Due within {DUE_SOON_DAYS} days
                </span>
                <span
                  className={`text-display-web mt-auto ${
                    stats.dueSoon > 0 ? 'text-on-error-container' : 'text-primary'
                  }`}
                >
                  {stats.dueSoon}
                </span>
              </div>
              <div
                className={`border p-6 rounded-lg flex flex-col relative overflow-hidden hover:border-outline transition-colors ${
                  stats.lowConf > 0
                    ? 'bg-error-container border-error/30'
                    : 'bg-surface-container-lowest border-outline-variant'
                }`}
              >
                <span className={`font-mono text-[12px] leading-4 uppercase mb-3 flex items-center gap-1.5 ${stats.lowConf > 0 ? 'text-on-error-container' : 'text-on-surface-variant'}`}>
                  <span className="material-symbols-outlined text-[16px]">warning</span>
                  Needs review
                </span>
                <span className={`text-display-web mt-auto ${stats.lowConf > 0 ? 'text-on-error-container' : 'text-primary'}`}>
                  {stats.lowConf}
                </span>
              </div>
            </section>

            {/* Due soon */}
            {dueSoonList.length > 0 && (
              <section>
                <h2 className="text-headline-md text-primary mb-1">Due soon</h2>
                <p className="text-body-md text-on-surface-variant mb-4">
                  Obligations with due dates in the next {DUE_SOON_DAYS} days
                </p>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {dueSoonList.map((o) => (
                    <button
                      key={o.id}
                      onClick={() =>
                        navigate(`/grants/${o.grant_id}/review`, {
                          state: { grantName: o.grantName },
                        })
                      }
                      className="text-left border border-outline-variant bg-surface rounded-lg p-4 hover:border-outline hover:bg-surface-container-lowest transition-colors"
                    >
                      <div className="flex items-center justify-between gap-2 mb-2">
                        <span className="font-mono text-[11px] uppercase tracking-wider text-on-surface-variant">{o.type.replace('_', ' ')}</span>
                        <span className="font-mono text-[11px] text-error font-semibold">
                          {o.daysLeft === 0 ? 'Today' : o.daysLeft === 1 ? 'Tomorrow' : `${o.daysLeft} days`}
                        </span>
                      </div>
                      <p className="text-body-md font-medium text-primary mb-1">{o.description}</p>
                      <p className="font-mono text-[12px] text-on-surface-variant">
                        {o.grantName}
                        {o.due_date && ` • Due ${o.due_date}`}
                      </p>
                    </button>
                  ))}
                </div>
              </section>
            )}

            {/* Compliance flags */}
            {flagList.length > 0 && (
              <section>
                <h2 className="text-headline-md text-primary mb-1">Compliance flags</h2>
                <p className="text-body-md text-on-surface-variant mb-4">
                  These obligations have low extraction confidence and need your review
                </p>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {flagList.map((o) => (
                    <button
                      key={o.id}
                      onClick={() =>
                        navigate(`/grants/${o.grant_id}/review`, {
                          state: { grantName: o.grantName },
                        })
                      }
                      className="text-left border-l-2 border-error bg-error-container rounded-r-lg p-4 flex gap-3 hover:brightness-95 transition"
                    >
                      <span className="material-symbols-outlined text-on-error-container shrink-0">gavel</span>
                      <div>
                        <p className="text-body-md font-medium text-on-error-container mb-1">{o.description}</p>
                        <p className="font-mono text-[12px] text-on-error-container/80">
                          {o.grantName}
                          {o.due_date && ` • Due ${o.due_date}`}
                        </p>
                      </div>
                    </button>
                  ))}
                </div>
              </section>
            )}

            {/* Grants list */}
            <section>
              <h2 className="text-headline-md text-primary mb-4">Your grants</h2>
              <div className="border border-outline-variant rounded-lg overflow-hidden bg-surface-container-lowest">
                <div className="hidden md:flex px-4 py-3 bg-surface-container font-mono text-[12px] text-on-surface-variant uppercase tracking-wider border-b border-outline-variant">
                  <span className="flex-1">Grant</span>
                  <span className="w-40">Status</span>
                  <span className="w-24 text-right">Actions</span>
                </div>
                <div className="divide-y divide-outline-variant">
                  {grants.map((g) => {
                    const badge = statusBadge(g, g.docStatus, g.pendingCount)
                    return (
                      <div key={g.id} className="flex flex-col md:flex-row md:items-center gap-3 px-4 py-4 hover:bg-surface-container-low transition-colors">
                        <button
                          onClick={() =>
                            navigate(`/grants/${g.id}/review`, {
                              state: { grantName: g.name },
                            })
                          }
                          className="flex-1 text-left"
                        >
                          <div className="text-body-md font-medium text-primary">{g.name}</div>
                          <div className="font-mono text-[12px] text-on-surface-variant mt-0.5">
                            {g.funder_name} • {g.obligationCount} obligation{g.obligationCount !== 1 ? 's' : ''}
                            {g.pendingCount > 0 ? ` • ${g.pendingCount} pending` : ''} •{' '}
                            {new Date(g.created_at).toLocaleDateString()}
                          </div>
                        </button>
                        <span
                          className={`inline-flex items-center gap-1.5 w-fit md:w-40 px-2.5 py-1 rounded font-mono text-[11px] uppercase tracking-wider border ${BADGE_STYLES[badge] || BADGE_STYLES['processing']}`}
                        >
                          <span className="material-symbols-outlined text-[14px]">
                            {badge === 'on track' ? 'check_circle' : badge === 'failed' ? 'error' : badge === 'needs review' ? 'warning' : 'schedule'}
                          </span>
                          {badge}
                        </span>
                        <div className="flex gap-2 md:w-24 md:justify-end">
                          {g.docStatus === 'failed' && (
                            <button
                              className="px-3 py-1.5 border border-outline text-primary font-mono text-[12px] rounded hover:bg-surface-variant transition-colors"
                              disabled={retryingId === g.id}
                              onClick={(e) => handleRetryExtraction(e, g.id)}
                            >
                              {retryingId === g.id ? 'Retrying…' : 'Retry'}
                            </button>
                          )}
                          <button
                            className={`px-3 py-1.5 border font-mono text-[12px] rounded transition-colors ${
                              confirmDeleteId === g.id
                                ? 'bg-error text-on-error border-error'
                                : 'border-outline text-on-surface hover:bg-surface-variant'
                            }`}
                            disabled={deletingId === g.id}
                            onClick={(e) => handleDeleteGrant(e, g.id)}
                            onBlur={() => setConfirmDeleteId((cur) => (cur === g.id ? null : cur))}
                          >
                            {deletingId === g.id
                              ? 'Deleting…'
                              : confirmDeleteId === g.id
                                ? 'Confirm?'
                                : 'Delete'}
                          </button>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            </section>
          </>
        )}
      </div>
    </AppShell>
  )
}
