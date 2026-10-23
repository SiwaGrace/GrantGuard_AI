import { useCallback, useEffect, useMemo, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import toast from 'react-hot-toast'
import { useAuth } from '../context/AuthContext'
import { supabase } from '../lib/supabase'
import { apiFetch, readJson } from '../lib/api'
import AppShell from '../components/AppShell'
import DocumentViewer from '../components/DocumentViewer'
import { buildCalendarEvents, toIcs, downloadIcs } from '../lib/ics'
import {
  DUE_SOON_DAYS,
  canRetryExtraction,
  daysUntil,
  grantReference,
  grantStatus,
  isCompleted,
  isDueSoon,
  isFlagged,
  isOverdue,
  todayISO,
} from '../lib/grantStatus'

const VIEW_STORAGE_KEY = 'grantguard:grant-list-view'

function readSavedView() {
  try {
    return localStorage.getItem(VIEW_STORAGE_KEY) === 'cards' ? 'cards' : 'table'
  } catch {
    return 'table'
  }
}

const HEALTH = {
  'on track': { text: 'text-primary', icon: 'check_circle', filled: true },
  overdue: { text: 'text-alert-crimson', icon: 'schedule' },
  'needs review': { text: 'text-warning-ochre', icon: 'radio_button_unchecked' },
  failed: { text: 'text-alert-crimson', icon: 'error' },
  'no obligations': { text: 'text-alert-crimson', icon: 'report' },
  processing: { text: 'text-on-surface-variant', icon: 'cloud_sync' },
}

export default function Dashboard() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()

  const [loading, setLoading] = useState(true)
  const [grants, setGrants] = useState([])
  const [portfolioObligations, setPortfolioObligations] = useState([])
  const [stats, setStats] = useState({ total: 0, obligations: 0, overdue: 0, dueSoon: 0, lowConf: 0 })
  const [dueSoonList, setDueSoonList] = useState([])
  const [flagList, setFlagList] = useState([])

  const [query, setQuery] = useState('')
  const [deletingId, setDeletingId] = useState(null)
  const [confirmDeleteId, setConfirmDeleteId] = useState(null)
  const [retryingId, setRetryingId] = useState(null)
  const [viewDocGrant, setViewDocGrant] = useState(null)
  const [view, setView] = useState(readSavedView)

  function changeView(next) {
    setView(next)
    try {
      localStorage.setItem(VIEW_STORAGE_KEY, next)
    } catch {
      // Storage unavailable (private mode etc.): the choice just isn't remembered
    }
  }

  function openUploadModal() {
    window.dispatchEvent(new Event('grantguard:open-upload'))
  }

  function exportToCalendar() {
    const grantNameMap = {}
    grants.forEach((g) => {
      grantNameMap[g.id] = g.name
    })
    const events = buildCalendarEvents(portfolioObligations, grantNameMap)
    if (events.length === 0) {
      toast.error('No dated obligations to export yet.')
      return
    }
    const ics = toIcs(events)
    downloadIcs('grantguard-deadlines.ics', ics)
    toast.success(`Exported ${events.length} deadline${events.length === 1 ? '' : 's'} to calendar`)
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
      const res = await apiFetch(`/api/grants/${grantId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      })
      if (!res.ok) {
        const payload = await readJson(res)
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
      const res = await apiFetch(`/api/grants/${grantId}/retry`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      })
      const payload = await readJson(res)
      if (!res.ok) throw new Error(payload.error || 'Retry failed')

      if (payload.obligationError) {
        toast.error(`Retry failed: ${payload.obligationError}`)
        await loadData()
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

    const today = todayISO()
    const overdueItems = allObligations.filter((o) => isOverdue(o, today))
    const dueSoonItems = allObligations.filter((o) => isDueSoon(o, today))

    const lowConf = allObligations.filter(isFlagged).length

    const flagItems = allObligations
      .filter(isFlagged)
      .map((o) => {
        const grant = grantList.find((g) => g.id === o.grant_id)
        return { ...o, grantName: grant?.name || 'Unknown grant' }
      })

    setPortfolioObligations(allObligations)
    setStats({
      total: grantList.length,
      obligations: allObligations.length,
      overdue: overdueItems.length,
      dueSoon: dueSoonItems.length,
      lowConf,
    })

    // Overdue first (most overdue at the top), then due soon
    const dueSoonList = [...overdueItems, ...dueSoonItems]
      .map((o) => {
        const grant = grantList.find((g) => g.id === o.grant_id)
        return { ...o, grantName: grant?.name || 'Unknown grant', daysLeft: daysUntil(o.due_date, today) }
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
      // Earliest deadline that isn't done yet, even if it has already passed
      const nextOutstanding = grantObligations
        .filter((o) => o.due_date && !isCompleted(o))
        .sort((a, b) => a.due_date.localeCompare(b.due_date))[0]

      return {
        ...g,
        docStatus: latestDoc?.extraction_status || 'pending',
        pendingCount: pending,
        flaggedCount: grantObligations.filter(isFlagged).length,
        overdueCount: grantObligations.filter((o) => isOverdue(o, today)).length,
        obligationCount: grantObligations.length,
        nextDue: nextOutstanding ? new Date(`${nextOutstanding.due_date}T00:00:00`) : null,
        nextDueOverdue: nextOutstanding ? isOverdue(nextOutstanding, today) : false,
        nextDueDueSoon: nextOutstanding ? isDueSoon(nextOutstanding, today) : false,
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
  }, [user, loadData, location.key])

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
              onClick={exportToCalendar}
              disabled={portfolioObligations.length === 0}
              className="py-2 px-4 notched-br border border-outline text-primary hover:bg-surface-container transition-colors flex items-center gap-2 font-label-caps text-label-caps uppercase tracking-widest disabled:opacity-40"
              title="Export all dated obligations to a calendar file"
            >
              <span className="material-symbols-outlined text-[16px]">calendar_month</span>
              Export Calendar
            </button>
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
            <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
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
                <p className="font-label-caps text-label-caps text-secondary mb-2 uppercase">Overdue</p>
                <div className="flex items-end gap-3">
                  <span className={`font-display-lg text-display-lg ${stats.overdue > 0 ? 'text-alert-crimson' : 'text-on-surface'}`}>
                    {stats.overdue}
                  </span>
                  <span className="font-label-caps text-label-caps text-alert-crimson mb-1.5 flex items-center gap-1">
                    <span className="material-symbols-outlined text-[14px]">schedule</span> Past due, not done
                  </span>
                </div>
              </div>

              <div className="bg-surface-container-lowest inkwell-border p-6 notched-card relative overflow-hidden group hover:bg-surface-container-low transition-colors">
                <div className="absolute top-0 right-0 w-16 h-16 bg-warning-ochre opacity-5 rounded-bl-full transform translate-x-4 -translate-y-4 group-hover:scale-110 transition-transform" />
                <p className="font-label-caps text-label-caps text-secondary mb-2 uppercase">Due Soon ({DUE_SOON_DAYS}d)</p>
                <div className="flex items-end gap-3">
                  <span className="font-display-lg text-display-lg text-warning-ochre">{stats.dueSoon}</span>
                  <span className="font-label-caps text-label-caps text-warning-ochre mb-1.5 flex items-center gap-1">
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
                    <span className="material-symbols-outlined text-[14px]">visibility</span> Needs review
                  </span>
                </div>
              </div>
            </section>

            {/* Due soon */}
            {dueSoonList.length > 0 && (
              <section>
                <h3 className="font-label-caps text-label-caps text-secondary mb-4 uppercase tracking-widest">
                  Overdue &amp; Upcoming · Next {DUE_SOON_DAYS} Days
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
                      className={`text-left bg-surface-container-lowest inkwell-border p-4 hover:bg-surface-container-low transition-colors notched-card ${
                        o.daysLeft < 0 ? 'border-l-4 border-l-alert-crimson' : ''
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2 mb-2">
                        <span className="font-label-caps text-label-caps text-on-surface-variant uppercase">{o.type.replace('_', ' ')}</span>
                        <span className={`font-label-caps text-label-caps ${o.daysLeft < 0 ? 'text-alert-crimson' : 'text-warning-ochre'}`}>
                          {o.daysLeft < 0
                            ? `OVERDUE · ${-o.daysLeft} DAY${o.daysLeft === -1 ? '' : 'S'}`
                            : o.daysLeft === 0
                              ? 'DUE TODAY'
                              : o.daysLeft === 1
                                ? 'TOMORROW'
                                : `${o.daysLeft} DAYS`}
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

            {/* Grant list: table or cards */}
            <section>
              <div className="flex items-center justify-between gap-4 mb-4">
                <h3 className="font-label-caps text-label-caps text-secondary uppercase tracking-widest">
                  Your grants
                </h3>
                <div className="flex inkwell-border" role="group" aria-label="Grant list layout">
                  {[
                    ['table', 'table_rows', 'Table'],
                    ['cards', 'grid_view', 'Cards'],
                  ].map(([value, icon, label]) => (
                    <button
                      key={value}
                      onClick={() => changeView(value)}
                      aria-pressed={view === value}
                      className={`px-3 py-1.5 flex items-center gap-1.5 font-label-caps text-label-caps uppercase transition-colors ${
                        view === value
                          ? 'bg-primary text-on-primary'
                          : 'text-secondary hover:bg-surface-container'
                      }`}
                    >
                      <span className="material-symbols-outlined text-[16px]">{icon}</span>
                      {label}
                    </button>
                  ))}
                </div>
              </div>
              {visibleGrants.length === 0 ? (
                <p className="text-body-md text-on-surface-variant bg-surface-container-lowest inkwell-border p-6">
                  No grants match &ldquo;{query}&rdquo;.
                </p>
              ) : view === 'cards' ? (
                <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-6">
                  {visibleGrants.map((g) => {
                    const badge = grantStatus(g)
                    const health = HEALTH[badge] || HEALTH.processing
                    const openReview = () =>
                      navigate(`/grants/${g.id}/review`, { state: { grantName: g.name } })
                    return (
                      <div
                        key={g.id}
                        className="bg-surface-container-lowest inkwell-border notched-card p-6 flex flex-col hover:bg-surface-container-low transition-colors"
                      >
                        <div className="flex justify-between items-start mb-6">
                          <span className="bg-surface-container text-on-surface font-source-code text-source-code px-2 py-1 inkwell-border">
                            § {grantReference(g)}
                          </span>
                          <div className={`flex items-center gap-2 ${health.text}`}>
                            <span className={`material-symbols-outlined text-[16px] ${health.filled ? 'filled-icon' : ''}`}>
                              {health.icon}
                            </span>
                            <span className="font-label-caps text-label-caps uppercase">{badge}</span>
                          </div>
                        </div>

                        <button onClick={openReview} className="text-left group">
                          <h4 className="font-headline-lg-mobile text-headline-lg-mobile text-on-surface mb-2 group-hover:text-primary transition-colors">
                            {g.name}
                          </h4>
                        </button>
                        <p className="font-label-caps text-label-caps text-secondary mb-6 uppercase">
                          {g.funder_name || '—'}
                        </p>

                        <div className="grid grid-cols-2 gap-4 mb-6 mt-auto">
                          <div className="flex flex-col">
                            <span className="font-label-caps text-label-caps text-secondary mb-1 uppercase">Obligations</span>
                            <span className="text-body-md text-on-surface font-medium">{g.obligationCount}</span>
                          </div>
                          <div className="flex flex-col">
                            <span className="font-label-caps text-label-caps text-secondary mb-1 uppercase">Added</span>
                            <span className="text-body-md text-on-surface font-medium">
                              {new Date(g.created_at).toLocaleDateString(undefined, { month: 'short', year: 'numeric' })}
                            </span>
                          </div>
                        </div>

                        {g.nextDue && (
                          <div
                            className={`p-3 mb-6 inkwell-border flex items-start gap-3 ${
                              g.nextDueOverdue || g.nextDueDueSoon ? 'bg-error-container border-l-2 border-l-alert-crimson' : 'bg-surface'
                            }`}
                          >
                            <span className={`material-symbols-outlined text-[18px] mt-0.5 ${g.nextDueOverdue || g.nextDueDueSoon ? 'text-alert-crimson' : 'text-warning-ochre'}`}>
                              {g.nextDueOverdue ? 'schedule' : g.nextDueDueSoon ? 'warning' : 'event'}
                            </span>
                            <div>
                              <span className="font-label-caps text-label-caps text-on-surface block mb-1 uppercase">
                                Next Deadline
                              </span>
                              <span className={`text-body-sm ${g.nextDueOverdue || g.nextDueDueSoon ? 'text-alert-crimson font-medium' : 'text-secondary'}`}>
                                {g.nextDue.toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' })}
                                {g.nextDueOverdue ? ' — overdue' : g.nextDueDueSoon ? ' — due soon' : ''}
                              </span>
                            </div>
                          </div>
                        )}

                        <div className="inkwell-border-t pt-4 flex flex-wrap justify-between items-center gap-3 mt-auto">
                          <div className="flex gap-2">
                            <button
                              onClick={() => setViewDocGrant(g)}
                              className="inline-flex items-center gap-1.5 px-3 py-1.5 border border-outline text-primary font-label-caps text-[12px] uppercase tracking-wider hover:bg-surface-container transition-colors"
                            >
                              <span className="material-symbols-outlined text-[13px]">visibility</span>
                              Document
                            </button>
                            {canRetryExtraction(badge) && (
                              <button
                                disabled={retryingId === g.id}
                                onClick={(e) => handleRetryExtraction(e, g.id)}
                                className="px-3 py-1.5 border border-outline text-primary font-label-caps text-[12px] uppercase tracking-wider hover:bg-surface-container transition-colors"
                              >
                                {retryingId === g.id ? '…' : 'Retry'}
                              </button>
                            )}
                          </div>
                          <button
                            onClick={openReview}
                            className="flex items-center gap-2 text-secondary hover:text-primary transition-colors"
                          >
                            <span className="font-label-caps text-label-caps uppercase">
                              {g.pendingCount > 0 ? `${g.pendingCount} pending review` : 'View obligations'}
                            </span>
                            <span className="material-symbols-outlined">arrow_forward</span>
                          </button>
                        </div>
                      </div>
                    )
                  })}
                </div>
              ) : (
                <div className="bg-surface-container-lowest inkwell-border">
                  {/* Table header */}
                  <div className="hidden md:grid grid-cols-12 gap-4 px-4 py-3 inkwell-border-b bg-surface-container-low">
                    <div className="col-span-4 font-label-caps text-label-caps text-secondary uppercase">Grant ID / Name</div>
                    <div className="col-span-3 font-label-caps text-label-caps text-secondary uppercase">Funder</div>
                    <div className="col-span-2 font-label-caps text-label-caps text-secondary uppercase">Health</div>
                    <div className="col-span-3 font-label-caps text-label-caps text-secondary uppercase text-right">Next Deadline</div>
                  </div>

                  <div className="divide-y divide-outline">
                    {visibleGrants.map((g) => {
                      const badge = grantStatus(g)
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
                              {grantReference(g)}
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
                              <span className={`font-label-caps text-[12px] uppercase ${health.text}`}>{badge}</span>
                            </span>
                          </div>
                          <div className="col-span-3 flex items-center justify-between md:justify-end gap-3">
                            <span className={`font-source-code text-source-code ${g.nextDueOverdue || g.nextDueDueSoon ? 'text-alert-crimson' : 'text-on-surface'}`}>
                              {g.nextDue
                                ? g.nextDue.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
                                : '—'}
                            </span>
                            <div className="flex gap-2">
                              <button
                                className="px-2.5 py-1 border border-outline text-primary font-label-caps text-[12px] uppercase hover:bg-surface-container transition-colors flex items-center gap-1"
                                onClick={(e) => {
                                  e.stopPropagation()
                                  setViewDocGrant(g)
                                }}
                                title="View uploaded document"
                              >
                                <span className="material-symbols-outlined text-[12px]">visibility</span>
                                View
                              </button>
                              {canRetryExtraction(badge) && (
                                <button
                                  className="px-2.5 py-1 border border-outline text-primary font-label-caps text-[12px] uppercase hover:bg-surface-container transition-colors"
                                  disabled={retryingId === g.id}
                                  onClick={(e) => handleRetryExtraction(e, g.id)}
                                >
                                  {retryingId === g.id ? '…' : 'Retry'}
                                </button>
                              )}
                              <button
                                className={`px-2.5 py-1 border font-label-caps text-[12px] uppercase transition-colors ${
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