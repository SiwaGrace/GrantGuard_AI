import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { supabase } from '../lib/supabase'
import AppShell from '../components/AppShell'

const PAGE_SIZE = 10

function shortId(id) {
  return String(id || '')
    .replace(/-/g, '')
    .slice(0, 7)
    .toUpperCase()
}

const TYPE_LABELS = {
  deadline: 'Deadline',
  reporting: 'Reporting',
  eligible_activity: 'Eligible Activity',
  compliance_condition: 'Compliance Condition',
}

const STATUS_META = {
  flagged: { label: 'Flagged', icon: 'flag', color: 'text-alert-crimson', fill: true },
  'needs review': { label: 'Needs Review', icon: 'radio_button_unchecked', color: 'text-warning-ochre', fill: false },
}

function rowStatus(obligation) {
  if (obligation.confidence === 'low' && !obligation.verified) return 'flagged'
  return 'needs review'
}

export default function Alerts() {
  const { user } = useAuth()
  const navigate = useNavigate()

  const [loading, setLoading] = useState(true)
  const [rows, setRows] = useState([])
  const [filter, setFilter] = useState('all')
  const [page, setPage] = useState(1)

  const loadData = useCallback(async () => {
    if (!user) return

    const { data: grantsData } = await supabase
      .from('grants')
      .select('id, name, funder_name')
      .eq('user_id', user.id)

    const grantList = grantsData || []
    let allObligations = []
    if (grantList.length > 0) {
      const grantIds = grantList.map((g) => g.id)
      const { data: obligationsData } = await supabase
        .from('obligations')
        .select('*')
        .in('grant_id', grantIds)
      allObligations = obligationsData || []
    }

    const alertRows = allObligations
      .filter(
        (o) =>
          (o.confidence === 'low' && !o.verified) || o.status === 'pending_review',
      )
      .map((o) => {
        const grant = grantList.find((g) => g.id === o.grant_id)
        return {
          ...o,
          grantName: grant?.name || 'Unknown grant',
          funderName: grant?.funder_name || '',
          grantShort: shortId(grant?.id || o.grant_id),
        }
      })
      .sort((a, b) => {
        const rank = { flagged: 0, 'needs review': 1 }
        const ar = rank[rowStatus(a)]
        const br = rank[rowStatus(b)]
        if (ar !== br) return ar - br
        return new Date(a.created_at) - new Date(b.created_at)
      })

    setRows(alertRows)
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

  const counts = useMemo(() => {
    const flagged = rows.filter((r) => rowStatus(r) === 'flagged').length
    const needsReview = rows.length - flagged
    return { all: rows.length, flagged, needsReview }
  }, [rows])

  const visible = useMemo(() => {
    if (filter === 'flagged') return rows.filter((r) => rowStatus(r) === 'flagged')
    if (filter === 'needs review') return rows.filter((r) => rowStatus(r) === 'needs review')
    return rows
  }, [rows, filter])

  const totalPages = Math.max(1, Math.ceil(visible.length / PAGE_SIZE))
  const pageRows = useMemo(
    () => visible.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE),
    [visible, page],
  )

  function openFilters(next) {
    setPage(1)
    setFilter(next)
  }

  const pill = (key, label, count, active, className) => (
    <button
      onClick={() => openFilters(key)}
      className={`px-4 py-1.5 border rounded-full font-label-caps text-label-caps uppercase transition-colors ${
        active
          ? className
          : 'border-outline-variant text-secondary hover:bg-surface-variant'
      }`}
    >
      {label} ({count})
    </button>
  )

  return (
    <AppShell>
      <div className="flex flex-col h-full space-y-8">
        <header className="inkwell-border-b flex flex-col md:flex-row md:items-end justify-between gap-4 pb-6 shrink-0">
          <div>
            <h2 className="font-headline-lg text-headline-lg text-on-surface mb-2">
              Critical Compliance Alerts
            </h2>
            <p className="text-body-md text-body-md text-secondary max-w-2xl">
              Portfolio-wide obligations requiring immediate review or intervention. Data is
              extracted directly from source agreements.
            </p>
          </div>
          <div className="flex items-center gap-2 font-label-caps text-label-caps uppercase flex-wrap">
            {pill('all', 'All', counts.all, filter === 'all', 'border-outline text-primary')}
            {pill(
              'flagged',
              'Flagged',
              counts.flagged,
              filter === 'flagged',
              'border-alert-crimson bg-error-container/20 text-alert-crimson font-bold',
            )}
            {pill(
              'needs review',
              'Needs Review',
              counts.needsReview,
              filter === 'needs review',
              'border-warning-ochre bg-warning-ochre/10 text-warning-ochre font-bold',
            )}
          </div>
        </header>

        {loading ? (
          <div className="flex flex-col items-center justify-center py-24 text-on-surface-variant">
            <div className="w-8 h-8 border-2 border-outline-variant border-t-primary rounded-full animate-spin mb-3" />
            <p className="text-body-md">Loading alerts…</p>
          </div>
        ) : visible.length === 0 ? (
          <div className="bg-surface-container-lowest inkwell-border notched-card p-10 flex flex-col items-center justify-center text-center">
            <span className="material-symbols-outlined text-[48px] text-secondary mb-4">verified</span>
            <h2 className="font-headline-lg-mobile md:font-headline-lg text-headline-lg-mobile md:text-headline-lg text-on-surface mb-2">
              No open alerts
            </h2>
            <p className="text-body-md text-on-surface-variant max-w-md">
              {filter === 'all'
                ? 'Every extracted obligation has been reviewed and confirmed. Nothing needs attention right now.'
                : `No ${filter} obligations in your portfolio right now.`}
            </p>
          </div>
        ) : (
          <>
            <div className="bg-surface-container-lowest inkwell-border">
              <div className="hidden md:grid grid-cols-12 gap-4 px-6 py-3 inkwell-border-b bg-surface-container-low font-label-caps text-label-caps text-secondary uppercase tracking-wider">
                <div className="col-span-3">Grant / Ref ID</div>
                <div className="col-span-2">Status</div>
                <div className="col-span-5">Flagged Issue</div>
                <div className="col-span-2 text-right">Action</div>
              </div>

              <div className="divide-y divide-outline-variant">
                {pageRows.map((o) => {
                  const status = rowStatus(o)
                  const meta = STATUS_META[status]
                  const typeLabel = TYPE_LABELS[o.type] || 'Obligation'
                  const due = o.due_date
                    ? ` · Due ${o.due_date}`
                    : ''
                  return (
                    <div
                      key={o.id}
                      className="grid grid-cols-1 md:grid-cols-12 gap-4 md:items-center px-6 py-4 hover:bg-surface-container-low transition-colors"
                    >
                      <div className="col-span-3 flex flex-col gap-1">
                        <div className="flex items-center gap-2">
                          <span className="font-source-code text-source-code text-secondary px-1.5 py-0.5 bg-surface-variant rounded-sm border border-outline-variant/50">
                            G-{o.grantShort} · {typeLabel}
                          </span>
                        </div>
                        <span className="text-body-md text-body-md font-semibold text-on-surface">
                          {o.grantName}
                        </span>
                      </div>
                      <div className={`col-span-2 flex items-center gap-1.5 font-label-caps text-label-caps font-bold uppercase ${meta.color}`}>
                        <span className={`material-symbols-outlined text-[18px] ${meta.fill ? 'filled-icon' : ''}`}>
                          {meta.icon}
                        </span>
                        {meta.label}
                      </div>
                      <div className="col-span-5 pr-4">
                        <p className="text-body-sm text-body-sm text-on-surface-variant leading-snug">
                          {o.description}
                        </p>
                        {due && (
                          <p className="font-source-code text-source-code text-on-surface-variant mt-1">
                            {due}
                          </p>
                        )}
                      </div>
                      <div className="col-span-2 flex justify-end">
                        <button
                          onClick={() =>
                            navigate(`/grants/${o.grant_id}/review`, {
                              state: { grantName: o.grantName },
                            })
                          }
                          className="border border-outline-variant px-4 py-1.5 text-body-sm text-body-sm font-medium text-on-surface hover:bg-surface-variant hover:border-outline transition-colors active:scale-95 flex items-center gap-1 whitespace-nowrap"
                        >
                          <span className="material-symbols-outlined text-[16px]">plagiarism</span>
                          Review
                        </button>
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>

            <div className="flex items-center justify-between text-secondary text-body-sm text-body-sm">
              <span>
                Showing {(page - 1) * PAGE_SIZE + 1} to{' '}
                {Math.min(page * PAGE_SIZE, visible.length)} of {visible.length} alerts
              </span>
              <div className="flex gap-2">
                <button
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={page <= 1}
                  className="px-3 py-1 border border-outline-variant rounded hover:bg-surface-variant transition-colors disabled:opacity-50"
                >
                  Prev
                </button>
                <button
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  disabled={page >= totalPages}
                  className="px-3 py-1 border border-outline-variant rounded hover:bg-surface-variant transition-colors disabled:opacity-50"
                >
                  Next
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </AppShell>
  )
}