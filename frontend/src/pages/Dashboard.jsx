import { useCallback, useEffect, useMemo, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import toast from 'react-hot-toast'
import { useAuth } from '../context/AuthContext'
import { supabase } from '../lib/supabase'
import API_URL from '../lib/api'
import AppShell from '../components/AppShell'
import DocumentViewer from '../components/DocumentViewer'

const DUE_SOON_DAYS = 14

function statusBadge(grant, docStatus, pendingCount) {
  if (docStatus === 'pending') return 'processing'
  if (docStatus === 'failed') return 'failed'
  if (pendingCount > 0) return 'needs review'
  return 'on track'
}

const HEALTH = {
  'on track': { text: 'text-primary', icon: 'check_circle', filled: true },
  'needs review': { text: 'text-warning-ochre', icon: 'radio_button_unchecked' },
  failed: { text: 'text-alert-crimson', icon: 'error' },
  processing: { text: 'text-on-surface-variant', icon: 'cloud_sync' },
}

function shortId(id) {
  return String(id || '')
    .replace(/-/g, '')
    .slice(0, 7)
    .toUpperCase()
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

  const [query, setQuery] = useState('')
  const [deletingId, setDeletingId] = useState(null)
  const [confirmDeleteId, setConfirmDeleteId] = useState(null)
  const [retryingId, setRetryingId] = useState(null)
  const [viewDocGrant, setViewDocGrant] = useState(null)

  function openUploadModal() {
    window.dispatchEvent(new Event('grantguard:open-upload'))
  }

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

      const grantObligations = allObligations.filter((o) => o.grant_id === g.id)
      const upcoming = grantObligations
        .map((o) => o.due_date && new Date(o.due_date))
        .filter((d) => d && d >= now)
        .sort((a, b) => a - b)
      const nextDue = upcoming.length > 0 ? new Date(upcoming[0]) : null

      return {
        ...g,
        docStatus: latestDoc?.extraction_status || 'pending',
        pendingCount: pending,
        obligationCount: grantObligations.length,
        nextDue,
        nextDueDueSoon: nextDue ? nextDue <= dueSoonDeadline : false,
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

  const visibleGrants = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return grants
    return grants.filter(
      (g) =>
        g.name?.toLowerCase().includes(q) ||
        g.funder_name?.toLowerCase().includes(q)
    )
  }, [grants, query])

  const avatarInitial = (user?.email || '?').slice(0, 1).toUpperCase()

  return (
    <AppShell>
      <div className="flex flex-col h-full space-y-8">
        {/* Top header */}
        <header className="inkwell-border-b flex justify-between items-center shrink-0 pb-6 gap-4 flex-wrap">
          <h2 className="font-headline-lg text-headline-lg text-on-surface">Portfolio Overview</h2>
          <div className="flex items-center gap-4">
            <div className="relative hidden sm:block">
              <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-secondary text-[18px]">
                search
              </span>
              <input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search grants, clauses, or donors..."
                className="bg-surface-container-low inkwell-border py-2 pl-10 pr-4 text-source-code font-source-code w-64 focus:outline-none focus:border-primary placeholder-secondary"
              />
            </div>
            <div className="w-8 h-8 rounded-full bg-surface-container-high inkwell-border flex items-center justify-center overflow-hidden font-label-caps text-label-caps text-primary uppercase">
              {avatarInitial}
            </div>
            <button
              onClick={openUploadModal}
              className="bg-primary text-on-primary py-2 px-4 notched-br hover:bg-surface-tint transition-colors flex items-center gap-2 font-label-caps text-label-caps uppercase tracking-widest"
            >
              <span className="material-symbols-outlined text-[16px]">upload_file</span>
              Upload Grant
            </button>
          </div>
        </header>

        {/* Loading */}
        {loading ? (
          <div className="flex flex-col items-center justify-center py-24 text-on-surface-variant">
            <div className="w-8 h-8 border-2 border-outline-variant border-t-primary rounded-full animate-spin mb-3" />
            <p className="text-body-md">Loading your grants…</p>
          </div>
        ) : grants.length === 0 ? (
          <div className="bg-surface-container-lowest inkwell-border notched-card p-10 flex flex-col items-center justify-center text-center relative overflow-hidden">
            <div className="absolute inset-0 pointer-events-none opacity-5 blueprint-grid text-primary" />
            <span className="material-symbols-outlined text-[48px] text-secondary mb-4">description</span>
            <h2 className="font-headline-lg-mobile md:font-headline-lg text-headline-lg-mobile md:text-headline-lg text-on-surface mb-2">
              Welcome to your Compliance Vault
            </h2>
            <p className="text-body-md text-on-surface-variant max-w-md">
              You haven&apos;t uploaded any grant agreements yet. Upload your first one to track
              obligations, deadlines, and compliance requirements.
            </p>
            <button
              onClick={openUploadModal}
              className="mt-6 bg-primary text-on-primary py-3 px-5 font-label-caps text-label-caps tracking-wider flex items-center gap-2 hover:bg-surface-tint transition-colors notched-br"
            >
              <span className="material-symbols-outlined filled-icon text-[16px]">upload</span>
              UPLOAD FIRST AGREEMENT
            </button>
          </div>
        ) : (
          <>
            {/* Stat ledger */}
            <section className="grid grid-cols-1 md:grid-cols-3 gap-6">
              <div className="bg-surface-container-lowest inkwell-border p-6 notched-card relative overflow-hidden group hover:bg-surface-container-low transition-colors">
                <div className="absolute top-0 right-0 w-16 h-16 bg-primary opacity-5 rounded-bl-full transform translate-x-4 -translate-y-4 group-hover:scale-110 transition-transform" />
                <p className="font-label-caps text-label-caps text-secondary mb-2 uppercase">Active Grants</p>
                <div className="flex items-end gap-3">
                  <span className="font-display-lg text-display-lg text-on-surface">{stats.total}</span>
                  <span className="font-label-caps text-label-caps text-primary mb-1.5 flex items-center gap-1">
                    <span className="material-symbols-outlined text-[14px]">domain</span> In portfolio
                  </span>
                </div>
              </div>

              <div className="bg-surface-container-lowest inkwell-border p-6 notched-card relative overflow-hidden group hover:bg-surface-container-low transition-colors">
                <div className="absolute top-0 right-0 w-16 h-16 bg-alert-crimson opacity-5 rounded-bl-full transform translate-x-4 -translate-y-4 group-hover:scale-110 transition-transform" />
                <p className="font-label-caps text-label-caps text-secondary mb-2 uppercase">Due Soon ({DUE_SOON_DAYS}d)</p>
                <div className="flex items-end gap-3">
                  <span className="font-display-lg text-display-lg text-alert-crimson">{stats.dueSoon}</span>
                  <span className="font-label-caps text-label-caps text-alert-crimson mb-1.5 flex items-center gap-1">
                    <span className="material-symbols-outlined text-[14px]">warning</span> Action required
                  </span>
                </div>
              </div>

              <div className="bg-surface-container-lowest inkwell-border p-6 notched-card relative overflow-hidden group hover:bg-surface-container-low transition-colors">
                <div className="absolute top-0 right-0 w-16 h-16 bg-warning-ochre opacity-5 rounded-bl-full transform translate-x-4 -translate-y-4 group-hover:scale-110 transition-transform" />
                <p className="font-label-caps text-label-caps text-secondary mb-2 uppercase">Clauses Flagged</p>
                <div className="flex items-end gap-3">
                  <span className="font-display-lg text-display-lg text-warning-ochre">{stats.lowConf}</span>
                  <span className="font-label-caps text-label-caps text-warning-ochre mb-1.5 flex items-center gap-1">
                    <span className="material-symbols-outlined text-[14px]">visibility</span> Needs audit
                  </span>
                </div>
              </div>
            </section>

            {/* Due soon */}
            {dueSoonList.length > 0 && (
              <section>
                <h3 className="font-label-caps text-label-caps text-secondary mb-4 uppercase tracking-widest">
                  Upcoming Obligations · {DUE_SOON_DAYS} Day Window
                </h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {dueSoonList.map((o) => (
                    <button
                      key={o.id}
                      onClick={() =>
                        navigate(`/grants/${o.grant_id}/review`, {
                          state: { grantName: o.grantName },
                        })
                      }
                      className="text-left bg-surface-container-lowest inkwell-border p-4 hover:bg-surface-container-low transition-colors notched-card"
                    >
                      <div className="flex items-center justify-between gap-2 mb-2">
                        <span className="font-label-caps text-label-caps text-on-surface-variant uppercase">{o.type.replace('_', ' ')}</span>
                        <span className="font-label-caps text-label-caps text-alert-crimson">
                          {o.daysLeft === 0 ? 'TODAY' : o.daysLeft === 1 ? 'TOMORROW' : `${o.daysLeft} DAYS`}
                        </span>
                      </div>
                      <p className="text-body-md font-medium text-primary mb-1">{o.description}</p>
                      <p className="font-source-code text-source-code text-on-surface-variant">
                        {o.grantName}
                        {o.due_date && ` · Due ${o.due_date}`}
                      </p>
                    </button>
                  ))}
                </div>
              </section>
            )}

            {/* Compliance flags */}
            {flagList.length > 0 && (
              <section>
                <h3 className="font-label-caps text-label-caps text-secondary mb-4 uppercase tracking-widest">
                  Compliance Flags · Low Confidence Clauses
                </h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {flagList.map((o) => (
                    <button
                      key={o.id}
                      onClick={() =>
                        navigate(`/grants/${o.grant_id}/review`, {
                          state: { grantName: o.grantName },
                        })
                      }
                      className="text-left bg-surface-container-lowest border-l-4 border-alert-crimson inkwell-border notched-card p-4 flex gap-3 hover:bg-error-container/40 transition-colors"
                    >
                      <span className="material-symbols-outlined text-alert-crimson shrink-0">gavel</span>
                      <div>
                        <p className="text-body-md font-medium text-on-surface mb-1">{o.description}</p>
                        <p className="font-source-code text-source-code text-on-surface-variant">
                          {o.grantName}
                          {o.due_date && ` · Due ${o.due_date}`}
                        </p>
                      </div>
                    </button>
                  ))}
                </div>
              </section>
            )}

            {/* Agreements ledger */}
            <section>
              <h3 className="font-label-caps text-label-caps text-secondary mb-4 uppercase tracking-widest">
                Active Agreements Ledger
              </h3>
              {visibleGrants.length === 0 ? (
                <p className="text-body-md text-on-surface-variant bg-surface-container-lowest inkwell-border p-6">
                  No grants match &ldquo;{query}&rdquo;.
                </p>
              ) : (
                <div className="bg-surface-container-lowest inkwell-border">
                  {/* Table header */}
                  <div className="hidden md:grid grid-cols-12 gap-4 px-4 py-3 inkwell-border-b bg-surface-container-low">
                    <div className="col-span-4 font-label-caps text-label-caps text-secondary uppercase">Grant ID / Name</div>
                    <div className="col-span-3 font-label-caps text-label-caps text-secondary uppercase">Donor Entity</div>
                    <div className="col-span-2 font-label-caps text-label-caps text-secondary uppercase">Health</div>
                    <div className="col-span-3 font-label-caps text-label-caps text-secondary uppercase text-right">Next Deadline</div>
                  </div>

                  <div className="divide-y divide-outline">
                    {visibleGrants.map((g) => {
                      const badge = statusBadge(g, g.docStatus, g.pendingCount)
                      const health = HEALTH[badge] || HEALTH.processing
                      return (
                        <div key={g.id} className="grid grid-cols-1 md:grid-cols-12 gap-3 md:gap-4 px-4 py-4 items-center hover:bg-surface-container-low transition-colors">
                          <button
                            onClick={() =>
                              navigate(`/grants/${g.id}/review`, {
                                state: { grantName: g.name },
                              })
                            }
                            className="col-span-4 text-left group"
                          >
                            <span className="font-source-code text-source-code bg-surface-variant px-1.5 py-0.5 rounded-sm mr-2 text-on-surface-variant">
                              G-{shortId(g.grant_id || g.id)}
                            </span>
                            <span className="text-body-sm text-body-sm text-on-surface group-hover:text-primary transition-colors">
                              {g.name}
                            </span>
                          </button>
                          <div className="col-span-3 text-body-sm text-body-sm text-secondary">{g.funder_name || '—'}</div>
                          <div className="col-span-2">
                            <span className="inline-flex items-center gap-1.5 px-2 py-1 bg-surface-container inkwell-border rounded-sm">
                              <span className={`material-symbols-outlined text-[16px] ${health.filled ? 'filled-icon' : ''} ${health.text}`}>
                                {health.icon}
                              </span>
                              <span className={`font-label-caps text-[10px] uppercase ${health.text}`}>{badge}</span>
                            </span>
                          </div>
                          <div className="col-span-3 flex items-center justify-between md:justify-end gap-3">
                            <span className={`font-source-code text-source-code ${g.nextDueDueSoon ? 'text-alert-crimson' : 'text-on-surface'}`}>
                              {g.nextDue
                                ? g.nextDue.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
                                : '—'}
                            </span>
                            <div className="flex gap-2">
                              <button
                                className="px-2.5 py-1 border border-outline text-primary font-label-caps text-[10px] uppercase hover:bg-surface-container transition-colors flex items-center gap-1"
                                onClick={(e) => {
                                  e.stopPropagation()
                                  setViewDocGrant(g)
                                }}
                                title="View uploaded document"
                              >
                                <span className="material-symbols-outlined text-[12px]">visibility</span>
                                View
                              </button>
                              {g.docStatus === 'failed' && (
                                <button
                                  className="px-2.5 py-1 border border-outline text-primary font-label-caps text-[10px] uppercase hover:bg-surface-container transition-colors"
                                  disabled={retryingId === g.id}
                                  onClick={(e) => handleRetryExtraction(e, g.id)}
                                >
                                  {retryingId === g.id ? '…' : 'Retry'}
                                </button>
                              )}
                              <button
                                className={`px-2.5 py-1 border font-label-caps text-[10px] uppercase transition-colors ${
                                  confirmDeleteId === g.id
                                    ? 'bg-error text-on-error border-error'
                                    : 'border-outline text-on-surface hover:bg-surface-container'
                                }`}
                                disabled={deletingId === g.id}
                                onClick={(e) => handleDeleteGrant(e, g.id)}
                                onBlur={() => setConfirmDeleteId((cur) => (cur === g.id ? null : cur))}
                              >
                                {deletingId === g.id
                                  ? '…'
                                  : confirmDeleteId === g.id
                                    ? 'Confirm?'
                                    : 'Delete'}
                              </button>
                            </div>
                          </div>
                          {/* Mobile sub-line */}
                          <div className="md:hidden text-body-sm text-body-sm text-secondary">
                            {g.funder_name || '—'} · {g.obligationCount} obligation{g.obligationCount !== 1 ? 's' : ''}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </div>
              )}
            </section>
          </>
        )}

        {viewDocGrant && (
          <DocumentViewer
            grantId={viewDocGrant.id}
            grantName={viewDocGrant.name}
            onClose={() => setViewDocGrant(null)}
          />
        )}
      </div>
    </AppShell>
  )
}