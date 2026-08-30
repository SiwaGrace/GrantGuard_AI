import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { supabase } from '../lib/supabase'
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
  'on track': { color: 'text-primary', icon: 'check_circle', filled: true, chip: 'text-primary' },
  'needs review': { color: 'text-warning-ochre', icon: 'radio_button_unchecked', filled: false, chip: 'text-warning-ochre' },
  failed: { color: 'text-alert-crimson', icon: 'error', filled: false, chip: 'text-alert-crimson' },
  processing: { color: 'text-on-surface-variant', icon: 'cloud_sync', filled: false, chip: 'text-on-surface-variant' },
}

function shortId(id) {
  return String(id || '')
    .replace(/-/g, '')
    .slice(0, 7)
    .toUpperCase()
}

export default function Portfolio() {
  const { user } = useAuth()
  const navigate = useNavigate()

  const [loading, setLoading] = useState(true)
  const [grants, setGrants] = useState([])
  const [query, setQuery] = useState('')
  const [viewDocGrant, setViewDocGrant] = useState(null)

  const loadData = useCallback(async () => {
    if (!user) return

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
    const deadline = new Date(now.getTime() + DUE_SOON_DAYS * 24 * 60 * 60 * 1000)

    const enriched = grantList.map((g) => {
      const docs = allDocs.filter((d) => d.grant_id === g.id)
      const latestDoc = docs.sort(
        (a, b) => new Date(b.uploaded_at) - new Date(a.uploaded_at)
      )[0]
      const grantObligations = allObligations.filter((o) => o.grant_id === g.id)
      const pending = grantObligations.filter(
        (o) => o.status === 'pending_review'
      ).length

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
        nextDueDueSoon: nextDue ? nextDue <= deadline : false,
      }
    })

    setGrants(enriched)
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
  }, [user, loadData])

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return grants
    return grants.filter(
      (g) =>
        g.name?.toLowerCase().includes(q) ||
        g.funder_name?.toLowerCase().includes(q),
    )
  }, [grants, query])

  return (
    <AppShell>
      <div className="flex flex-col h-full space-y-8">
        <header className="inkwell-border-b flex flex-col md:flex-row md:items-end justify-between gap-4 pb-6 shrink-0">
          <div>
            <h2 className="font-display-lg text-display-lg text-on-surface">Portfolio Ledger</h2>
            <p className="text-body-md text-body-md text-secondary mt-2 max-w-2xl">
              Active grant agreements and compliance health overview.
            </p>
          </div>
          <div className="relative w-full md:w-72">
            <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-secondary text-[18px]">
              search
            </span>
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search grants or donors..."
              className="w-full bg-surface-container-lowest inkwell-border py-2 pl-10 pr-4 text-source-code font-source-code focus:outline-none focus:border-primary placeholder:text-secondary"
            />
          </div>
        </header>

        {loading ? (
          <div className="flex flex-col items-center justify-center py-24 text-on-surface-variant">
            <div className="w-8 h-8 border-2 border-outline-variant border-t-primary rounded-full animate-spin mb-3" />
            <p className="text-body-md">Loading your grants…</p>
          </div>
        ) : visible.length === 0 ? (
          <div className="bg-surface-container-lowest inkwell-border notched-card p-10 flex flex-col items-center justify-center text-center">
            <span className="material-symbols-outlined text-[48px] text-secondary mb-4">folder_shared</span>
            <h2 className="font-headline-lg-mobile md:font-headline-lg text-headline-lg-mobile md:text-headline-lg text-on-surface mb-2">
              {query ? 'No matching grants' : 'Your portfolio is empty'}
            </h2>
            <p className="text-body-md text-on-surface-variant max-w-md">
              {query
                ? `Nothing matches "${query}". Try a different grant or funder name.`
                : 'Upload your first grant agreement to start tracking obligations and deadlines.'}
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-6">
            {visible.map((g) => {
              const badge = statusBadge(g, g.docStatus, g.pendingCount)
              const health = HEALTH[badge] || HEALTH.processing
              return (
                <button
                  key={g.id}
                  onClick={() =>
                    navigate(`/grants/${g.id}/review`, { state: { grantName: g.name } })
                  }
                  className="text-left bg-surface-container-lowest inkwell-border notched-card p-6 flex flex-col hover:bg-surface-container-low transition-colors group cursor-pointer relative"
                >
                  <div className="flex justify-between items-start mb-6">
                    <span className="bg-surface-container text-on-surface font-source-code text-source-code px-2 py-1 inkwell-border">
                      § G-{shortId(g.grant_id || g.id)}
                    </span>
                    <div className={`flex items-center gap-2 ${health.color}`}>
                      <span className={`material-symbols-outlined text-[16px] ${health.filled ? 'filled-icon' : ''}`}>
                        {health.icon}
                      </span>
                      <span className="font-label-caps text-label-caps uppercase">{badge}</span>
                    </div>
                  </div>

                  <h3 className="font-headline-lg-mobile text-headline-lg-mobile text-on-surface mb-2 group-hover:text-primary transition-colors">
                    {g.name}
                  </h3>
                  <p className="font-label-caps text-label-caps text-secondary mb-6 uppercase">
                    {g.funder_name || '—'}
                  </p>

                  <div className="grid grid-cols-2 gap-4 mb-6 mt-auto">
                    <div className="flex flex-col">
                      <span className="font-label-caps text-label-caps text-secondary mb-1 uppercase">Obligations</span>
                      <span className="text-body-md text-body-md text-on-surface font-medium">
                        {g.obligationCount}
                      </span>
                    </div>
                    <div className="flex flex-col">
                      <span className="font-label-caps text-label-caps text-secondary mb-1 uppercase">Added</span>
                      <span className="text-body-md text-body-md text-on-surface font-medium">
                        {new Date(g.created_at).toLocaleDateString(undefined, { month: 'short', year: 'numeric' })}
                      </span>
                    </div>
                  </div>

                  {g.nextDue && (
                    <div
                      className={`p-3 mb-6 inkwell-border flex items-start gap-3 ${
                        g.nextDueDueSoon ? 'bg-error-container border-l-2 border-l-alert-crimson' : 'bg-surface'
                      }`}
                    >
                      <span className={`material-symbols-outlined text-[18px] mt-0.5 ${g.nextDueDueSoon ? 'text-alert-crimson' : 'text-warning-ochre'}`}>
                        {g.nextDueDueSoon ? 'warning' : 'event'}
                      </span>
                      <div>
                        <span className="font-label-caps text-label-caps text-on-surface block mb-1 uppercase">
                          Next Deadline
                        </span>
                        <span className={`text-body-sm text-body-sm ${g.nextDueDueSoon ? 'text-alert-crimson font-medium' : 'text-secondary'}`}>
                          {g.nextDue.toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' })}
                          {g.nextDueDueSoon && ' — due soon'}
                        </span>
                      </div>
                    </div>
                  )}

                  <div className="inkwell-border-t pt-4 flex justify-between items-center gap-3 mt-auto">
                    <span
                      role="button"
                      tabIndex={0}
                      onClick={(e) => {
                        e.stopPropagation()
                        setViewDocGrant(g)
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault()
                          e.stopPropagation()
                          setViewDocGrant(g)
                        }
                      }}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 border border-outline text-primary font-label-caps text-[10px] uppercase tracking-wider hover:bg-surface-container transition-colors cursor-pointer shrink-0"
                    >
                      <span className="material-symbols-outlined text-[13px]">visibility</span>
                      View Document
                    </span>
                    <span className="flex items-center gap-2 text-secondary group-hover:text-primary transition-colors">
                      <span className="font-label-caps text-label-caps uppercase">
                        {g.pendingCount > 0
                          ? `${g.pendingCount} pending review`
                          : 'View obligations'}
                      </span>
                      <span className="material-symbols-outlined">arrow_forward</span>
                    </span>
                  </div>
                </button>
              )
            })}
          </div>
        )}
      </div>

      {viewDocGrant && (
        <DocumentViewer
          grantId={viewDocGrant.id}
          grantName={viewDocGrant.name}
          onClose={() => setViewDocGrant(null)}
        />
      )}
    </AppShell>
  )
}