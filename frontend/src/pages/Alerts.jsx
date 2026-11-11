import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import toast from 'react-hot-toast'
import { useAuth } from '../context/AuthContext'
import { supabase } from '../lib/supabase'
import { apiFetch, readJson } from '../lib/api'
import AppShell from '../components/AppShell'
import { todayISO } from '../lib/grantStatus'
import { buildAlertBuckets, dueLabel, uniqueAlertCount } from '../lib/alertModel'

const TYPE_LABELS = {
  deadline: 'Deadline',
  reporting: 'Reporting',
  eligible_activity: 'Eligible Activity',
  compliance_condition: 'Compliance Condition',
}

const SNOOZE_OPTIONS = [
  { days: 1, label: '1 day' },
  { days: 3, label: '3 days' },
  { days: 7, label: '1 week' },
]

const SECTION_META = {
  overdue: {
    title: 'Overdue',
    subtitle: 'Past the deadline and not marked done.',
    icon: 'schedule',
    iconClass: 'text-alert-crimson',
    iconBg: 'bg-error-container',
    badgeClass: 'bg-alert-crimson text-white border-alert-crimson',
  },
  dueSoon: {
    title: 'Due in the next 14 days',
    subtitle: 'Coming up soon. Resolve them before they become overdue.',
    icon: 'warning',
    iconClass: 'text-warning-text',
    iconBg: 'bg-warning-ochre/20',
    badgeClass: 'bg-warning-ochre/20 text-warning-text border-warning-ochre',
  },
  flagged: {
    title: 'Flagged clauses',
    subtitle: 'Low-confidence extractions that still need a human check.',
    icon: 'flag',
    iconClass: 'text-alert-crimson',
    iconBg: 'bg-error-container',
    badgeClass: 'bg-error-container text-alert-crimson border-outline-variant',
  },
}

function formatDate(isoDate) {
  if (!isoDate) return ''
  return new Date(`${isoDate}T00:00:00`).toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  })
}

function snoozeUntilISO(days) {
  const date = new Date()
  date.setDate(date.getDate() + days)
  return date.toISOString()
}

function showUndoToast(message, onUndo) {
  toast(
    (t) => (
      <span className="flex items-center gap-3">
        <span className="text-body-sm text-on-surface">{message}</span>
        <button
          onClick={() => {
            toast.dismiss(t.id)
            onUndo()
          }}
          className="shrink-0 border border-outline px-2.5 py-1 font-label-caps text-[11px] uppercase tracking-wider text-primary hover:bg-surface-container transition-colors"
        >
          Undo
        </button>
      </span>
    ),
    { duration: 8000 },
  )
}

function AlertCard({
  item,
  variant,
  expanded,
  onToggleSource,
  busyAction,
  disabled,
  snoozeOpen,
  onToggleSnooze,
  onSnooze,
  onMarkDone,
  onVerify,
  onOpenReview,
}) {
  const meta = SECTION_META[variant]
  const typeLabel = TYPE_LABELS[item.type] || 'Obligation'
  const due = item.due_date ? dueLabel(item.due_date) : null
  const sourceId = `source-${item.id}`
  const titleId = `alert-title-${item.id}`
  const isWorking = Boolean(busyAction)

  return (
    <article
      aria-labelledby={titleId}
      className={`bg-surface-container-lowest inkwell-border notched-card p-5 flex flex-col gap-3 ${
        variant === 'overdue' ? 'border-l-4 border-l-alert-crimson' : ''
      }`}
    >
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="min-w-0 flex flex-col gap-1">
          <span className="inline-flex items-center gap-1 self-start font-source-code text-source-code text-secondary bg-surface-variant px-1.5 py-0.5 rounded-sm border border-outline-variant/50">
            <span className="whitespace-nowrap">{item.grantRef}</span>
            <span>·</span>
            <span>{typeLabel}</span>
          </span>
          <span className="text-body-sm font-semibold text-on-surface break-words">
            {item.grantName}
          </span>
        </div>
        <span
          className={`inline-flex items-center gap-1 px-2 py-1 border font-label-caps text-[11px] uppercase tracking-wider ${meta.badgeClass}`}
        >
          <span className={`material-symbols-outlined text-[14px] ${variant === 'flagged' ? 'filled-icon' : ''}`}>
            {variant === 'flagged' ? 'flag' : due?.overdue ? 'schedule' : 'warning'}
          </span>
          {variant === 'flagged' ? 'Flagged' : due?.text || 'No date'}
        </span>
      </div>

      <h4 id={titleId} className="font-headline-lg-mobile text-headline-lg-mobile font-medium text-on-surface">
        {item.description}
      </h4>

      <div className="flex items-center gap-x-3 gap-y-1 flex-wrap text-body-sm text-secondary">
        {item.due_date ? (
          <span className="inline-flex items-center gap-1">
            <span className="material-symbols-outlined text-[15px]">event</span>
            Due {formatDate(item.due_date)}
            {variant !== 'flagged' && due && (
              <span className={due.overdue ? 'text-alert-crimson font-medium' : 'text-warning-text font-medium'}>
                · {due.text}
              </span>
            )}
          </span>
        ) : (
          <span className="inline-flex items-center gap-1">
            <span className="material-symbols-outlined text-[15px]">event</span>
            No due date
          </span>
        )}
        {variant === 'flagged' && (
          <span className="inline-flex items-center gap-1 text-alert-crimson">
            <span className="material-symbols-outlined text-[15px]">help</span>
            Low confidence
          </span>
        )}
      </div>

      <button
        onClick={onToggleSource}
        aria-expanded={expanded}
        aria-controls={sourceId}
        className="self-start inline-flex items-center gap-1.5 text-body-sm text-primary underline underline-offset-2 hover:text-surface-tint transition-colors"
      >
        <span className={`material-symbols-outlined text-[16px] transition-transform ${expanded ? 'rotate-180' : ''}`}>
          expand_more
        </span>
        {expanded ? 'Hide source clause' : 'Show source clause'}
        {item.source_page && (
          <span className="font-source-code text-source-code text-on-surface-variant">p.{item.source_page}</span>
        )}
      </button>

      {expanded && (
        <div id={sourceId} className="border-l-2 border-primary bg-surface-container-low px-3 py-2">
          <p className="font-source-code text-source-code text-on-surface-variant leading-relaxed">
            {item.source_excerpt ? `“${item.source_excerpt}”` : 'No source excerpt was captured for this obligation.'}
          </p>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2 mt-auto pt-1">
        <button
          onClick={onOpenReview}
          className="px-3 py-1.5 border border-outline text-primary font-label-caps text-[12px] uppercase tracking-wider hover:bg-surface-container transition-colors flex items-center gap-1.5"
        >
          <span className="material-symbols-outlined text-[14px]">plagiarism</span>
          Review
        </button>

        {variant === 'flagged' ? (
          <button
            onClick={onVerify}
            disabled={disabled}
            className="px-3 py-1.5 bg-primary text-on-primary font-label-caps text-[12px] uppercase tracking-wider hover:bg-surface-tint transition-colors flex items-center gap-1.5 disabled:opacity-60"
          >
            <span className="material-symbols-outlined filled-icon text-[14px]">verified</span>
            {busyAction === 'verify' ? 'Verifying…' : 'Verify flag'}
          </button>
        ) : (
          <>
            <button
              onClick={onMarkDone}
              disabled={disabled}
              className="px-3 py-1.5 bg-primary text-on-primary font-label-caps text-[12px] uppercase tracking-wider hover:bg-surface-tint transition-colors flex items-center gap-1.5 disabled:opacity-60"
            >
              <span className="material-symbols-outlined filled-icon text-[14px]">task_alt</span>
              {busyAction === 'done' ? 'Saving…' : 'Mark done'}
            </button>
            <button
              onClick={onToggleSnooze}
              disabled={disabled}
              aria-expanded={snoozeOpen}
              title="Temporarily hide this alert"
              className="px-3 py-1.5 border border-outline text-primary font-label-caps text-[12px] uppercase tracking-wider hover:bg-surface-container transition-colors flex items-center gap-1.5 disabled:opacity-60"
            >
              <span className="material-symbols-outlined text-[14px]">schedule</span>
              Snooze
            </button>
          </>
        )}

        {isWorking && (
          <span className="font-label-caps text-[11px] uppercase text-secondary ml-auto">Working…</span>
        )}
      </div>

      {snoozeOpen && variant !== 'flagged' && (
        <div
          role="group"
          aria-label="Snooze this alert for"
          className="flex flex-wrap items-center gap-2 bg-surface-container-low inkwell-border px-3 py-2"
        >
          <span className="font-label-caps text-[11px] uppercase tracking-wider text-secondary">Snooze for</span>
          {SNOOZE_OPTIONS.map((option) => (
            <button
              key={option.days}
              onClick={() => onSnooze(option.days)}
              disabled={disabled}
              className="px-2.5 py-1 border border-outline-variant text-on-surface bg-surface-container-lowest font-label-caps text-[11px] uppercase tracking-wider hover:border-primary hover:text-primary transition-colors disabled:opacity-60"
            >
              {busyAction === `snooze-${option.days}` ? 'Saving…' : option.label}
            </button>
          ))}
          <button
            onClick={onToggleSnooze}
            className="ml-auto text-body-sm text-secondary hover:text-primary transition-colors"
          >
            Cancel
          </button>
        </div>
      )}
    </article>
  )
}

export default function Alerts() {
  const { user } = useAuth()
  const navigate = useNavigate()

  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [grants, setGrants] = useState([])
  const [rows, setRows] = useState([])
  const [filter, setFilter] = useState('all')
  const [expandedId, setExpandedId] = useState(null)
  const [snoozeOpenId, setSnoozeOpenId] = useState(null)
  const [busy, setBusy] = useState(null)

  const loadData = useCallback(async () => {
    if (!user) return

    const { data: grantsData, error: grantsError } = await supabase
      .from('grants')
      .select('*')
      .eq('user_id', user.id)
      .eq('status', 'active')

    if (grantsError) throw grantsError

    const grantList = grantsData || []
    let allObligations = []
    if (grantList.length > 0) {
      const { data: obligationsData, error: obligationsError } = await supabase
        .from('obligations')
        .select('*')
        .in('grant_id', grantList.map((g) => g.id))

      if (obligationsError) throw obligationsError
      allObligations = obligationsData || []
    }

    setGrants(grantList)
    setRows(allObligations)
  }, [user])

  useEffect(() => {
    if (!user) return
    let active = true

    async function load() {
      try {
        await loadData()
      } catch (err) {
        if (active) setError(err.message || 'Could not load your alerts.')
      } finally {
        if (active) setLoading(false)
      }
    }

    load()
    return () => {
      active = false
    }
  }, [user, loadData])

  async function retryLoad() {
    setLoading(true)
    setError('')
    try {
      await loadData()
    } catch (err) {
      setError(err.message || 'Could not load your alerts.')
    } finally {
      setLoading(false)
    }
  }

  const grantsById = useMemo(
    () => Object.fromEntries(grants.map((g) => [g.id, g])),
    [grants],
  )
  const today = todayISO()
  const buckets = useMemo(
    () => buildAlertBuckets(rows, { today, grantsById }),
    [rows, today, grantsById],
  )
  const counts = useMemo(
    () => ({
      overdue: buckets.overdue.length,
      dueSoon: buckets.dueSoon.length,
      flagged: buckets.flagged.length,
      all: uniqueAlertCount(buckets),
    }),
    [buckets],
  )

  const sections = useMemo(() => {
    const list = [
      { key: 'overdue', items: buckets.overdue },
      { key: 'dueSoon', items: buckets.dueSoon },
      { key: 'flagged', items: buckets.flagged },
    ]
    const withMeta = list.map((section) => ({ ...section, ...SECTION_META[section.key] }))
    if (filter === 'all') return withMeta
    return withMeta.filter((section) => section.key === filter)
  }, [buckets, filter])

  async function patchObligation(obligation, body) {
    const { data } = await supabase.auth.getSession()
    const token = data.session?.access_token
    if (!token) throw new Error('Your session has expired. Please sign in again.')

    const res = await apiFetch(`/api/grants/${obligation.grant_id}/obligations/${obligation.id}`, {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    })
    const payload = await readJson(res)
    if (!res.ok) throw new Error(payload.error || 'Could not update the alert')
    return payload.obligation
  }

  function updateRow(id, patch) {
    setRows((prev) => prev.map((item) => (item.id === id ? { ...item, ...patch } : item)))
  }

  async function handleMarkDone(obligation) {
    if (busy) return
    setBusy({ id: obligation.id, action: 'done' })
    setSnoozeOpenId(null)
    const previous = {
      completed_at: obligation.completed_at ?? null,
      status: obligation.status,
    }
    updateRow(obligation.id, {
      completed_at: new Date().toISOString(),
      status: 'confirmed',
    })

    try {
      const updated = await patchObligation(obligation, { completed: true })
      updateRow(obligation.id, updated)
      showUndoToast('Marked as done.', () => undoDone(obligation, previous))
    } catch (err) {
      updateRow(obligation.id, previous)
      toast.error(err.message || 'Could not mark it as done.')
    } finally {
      setBusy(null)
    }
  }

  async function undoDone(obligation, previous) {
    setBusy({ id: obligation.id, action: 'undo' })
    try {
      const updated = await patchObligation(obligation, {
        completed: false,
        status: previous.status,
      })
      updateRow(obligation.id, updated)
      toast.success('Marked as not done.')
    } catch (err) {
      toast.error(err.message || 'Could not undo that.')
    } finally {
      setBusy(null)
    }
  }

  async function handleSnooze(obligation, days) {
    if (busy) return
    const option = SNOOZE_OPTIONS.find((item) => item.days === days)
    const until = snoozeUntilISO(days)
    const previous = { snoozed_until: obligation.snoozed_until ?? null }
    setBusy({ id: obligation.id, action: `snooze-${days}` })
    setSnoozeOpenId(null)
    updateRow(obligation.id, { snoozed_until: until })

    try {
      const updated = await patchObligation(obligation, {
        snoozed_until: until,
      })
      updateRow(obligation.id, updated)
      toast.success(`Snoozed for ${option?.label || `${days} days`}.`)
    } catch (err) {
      updateRow(obligation.id, previous)
      toast.error(err.message || 'Could not snooze that alert.')
    } finally {
      setBusy(null)
    }
  }

  async function handleVerify(obligation) {
    if (busy) return
    const previous = {
      verified: obligation.verified,
      flag_verified_at: obligation.flag_verified_at ?? null,
    }
    setBusy({ id: obligation.id, action: 'verify' })
    updateRow(obligation.id, {
      verified: true,
      flag_verified_at: new Date().toISOString(),
    })

    try {
      const updated = await patchObligation(obligation, { verified: true })
      updateRow(obligation.id, updated)
      toast.success('Flag verified. It will no longer appear here.')
    } catch (err) {
      updateRow(obligation.id, previous)
      toast.error(err.message || 'Could not verify that flag.')
    } finally {
      setBusy(null)
    }
  }

  function toggleFilter(next) {
    setFilter((current) => (current === next ? 'all' : next))
    setExpandedId(null)
    setSnoozeOpenId(null)
  }

  function openReview(item) {
    navigate(`/grants/${item.grant_id}/review`, {
      state: { grantName: item.grantName },
    })
  }

  const summaryChips = [
    {
      key: 'overdue',
      label: 'Overdue',
      count: counts.overdue,
      icon: 'schedule',
      valueClass: 'text-alert-crimson',
      activeClass: 'border-alert-crimson bg-error-container/40',
      idleClass: 'border-outline-variant bg-surface-container-lowest',
    },
    {
      key: 'dueSoon',
      label: 'Due in 14 days',
      count: counts.dueSoon,
      icon: 'warning',
      valueClass: 'text-warning-text',
      activeClass: 'border-warning-ochre bg-warning-ochre/10',
      idleClass: 'border-outline-variant bg-surface-container-lowest',
    },
    {
      key: 'flagged',
      label: 'Flagged',
      count: counts.flagged,
      icon: 'flag',
      valueClass: 'text-alert-crimson',
      activeClass: 'border-alert-crimson bg-error-container/30',
      idleClass: 'border-outline-variant bg-surface-container-lowest',
    },
  ]

  return (
    <AppShell>
      <div className="flex flex-col h-full space-y-8">
        <header className="inkwell-border-b flex flex-col md:flex-row md:items-end justify-between gap-4 pb-6 shrink-0">
          <div>
            <div className="flex items-center gap-3 flex-wrap mb-2">
              <h2 className="font-headline-lg text-headline-lg text-on-surface">
                Critical Compliance Alerts
              </h2>
              {!loading && !error && (
                <span
                  className={`inline-flex items-center gap-1.5 px-2.5 py-1 border font-label-caps text-[11px] uppercase tracking-wider ${
                    counts.all === 0
                      ? 'border-primary bg-primary-tint text-primary'
                      : 'border-alert-crimson bg-error-container/30 text-alert-crimson'
                  }`}
                >
                  <span className={`material-symbols-outlined text-[14px] ${counts.all === 0 ? 'filled-icon' : ''}`}>
                    {counts.all === 0 ? 'check_circle' : 'notification_important'}
                  </span>
                  {counts.all === 0 ? 'All clear' : 'Needs attention'}
                </span>
              )}
            </div>
            <p className="text-body-md text-body-md text-secondary max-w-2xl">
              Live view of overdue, upcoming and flagged obligations across your grants. Every
              alert links back to the clause it came from.
            </p>
          </div>
          {filter !== 'all' && (
            <button
              onClick={() => setFilter('all')}
              className="self-start md:self-auto px-3 py-1.5 border border-outline-variant text-secondary font-label-caps text-label-caps uppercase hover:bg-surface-variant transition-colors"
            >
              Show all alerts
            </button>
          )}
        </header>

        {loading ? (
          <div className="flex flex-col items-center justify-center py-24 text-on-surface-variant">
            <div className="w-8 h-8 border-2 border-outline-variant border-t-primary rounded-full animate-spin mb-3" />
            <p className="text-body-md">Loading alerts…</p>
          </div>
        ) : error ? (
          <div className="bg-surface-container-lowest inkwell-border notched-card p-10 flex flex-col items-center justify-center text-center">
            <span className="material-symbols-outlined text-[44px] text-alert-crimson mb-3">error_outline</span>
            <h2 className="font-headline-lg-mobile text-headline-lg-mobile text-on-surface mb-2">
              Could not load alerts
            </h2>
            <p className="text-body-md text-on-surface-variant max-w-md mb-5">{error}</p>
            <button
              onClick={retryLoad}
              className="bg-primary text-on-primary py-2.5 px-5 font-label-caps text-label-caps tracking-wider uppercase hover:bg-surface-tint transition-colors notched-br"
            >
              Try again
            </button>
          </div>
        ) : counts.all === 0 ? (
          <div className="bg-surface-container-lowest inkwell-border notched-card p-10 flex flex-col items-center justify-center text-center relative overflow-hidden">
            <div className="absolute inset-0 pointer-events-none opacity-5 blueprint-grid text-primary" />
            <span className="material-symbols-outlined text-[48px] text-primary mb-4">verified</span>
            <h2 className="font-headline-lg-mobile md:font-headline-lg text-headline-lg-mobile md:text-headline-lg text-on-surface mb-2">
              Nothing needs attention
            </h2>
            <p className="text-body-md text-on-surface-variant max-w-md">
              Every confirmed obligation is on track, nothing is overdue, and there are no
              unverified flags. We will keep watching your portfolio.
            </p>
          </div>
        ) : (
          <>
            <section className="relative overflow-hidden bg-surface-container-lowest inkwell-border notched-card p-5 sm:p-6">
              <div className="absolute inset-0 pointer-events-none opacity-5 blueprint-grid text-primary" />
              <div className="relative flex flex-col lg:flex-row lg:items-center justify-between gap-5">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span
                      className={`inline-block w-2 h-2 rounded-full motion-safe:animate-pulse ${
                        counts.overdue > 0 ? 'bg-alert-crimson' : 'bg-primary'
                      }`}
                    />
                    <p className="font-label-caps text-label-caps text-secondary uppercase tracking-widest">
                      Live portfolio pulse
                    </p>
                  </div>
                  <h3 className="font-headline-lg-mobile text-headline-lg-mobile text-on-surface">
                    {counts.all} item{counts.all === 1 ? '' : 's'}{' '}
                    {counts.all === 1 ? 'needs' : 'need'} attention
                  </h3>
                  <p className="text-body-sm text-secondary mt-1">
                    {counts.overdue > 0
                      ? 'Start with the overdue items below.'
                      : 'You are ahead of your deadlines. Keep it up.'}
                  </p>
                </div>
                <div className="grid grid-cols-3 gap-2 w-full lg:w-auto">
                  {summaryChips.map((chip) => {
                    const active = filter === chip.key
                    return (
                      <button
                        key={chip.key}
                        onClick={() => toggleFilter(chip.key)}
                        aria-pressed={active}
                        title={active ? 'Click again to show all alerts' : `Show ${chip.label.toLowerCase()} alerts`}
                        className={`text-left border px-3 py-3 transition-all hover:bg-surface-container-low ${
                          active ? chip.activeClass : chip.idleClass
                        }`}
                      >
                        <span className="flex items-center gap-1.5 font-label-caps text-[10px] uppercase tracking-wider text-secondary">
                          <span className={`material-symbols-outlined text-[13px] ${chip.valueClass}`}>
                            {chip.icon}
                          </span>
                          {chip.label}
                        </span>
                        <span className={`block font-display-lg text-[28px] leading-none mt-1 ${chip.valueClass}`}>
                          {chip.count}
                        </span>
                      </button>
                    )
                  })}
                </div>
              </div>
            </section>

            {sections.map((section) => (
              <section key={section.key} aria-labelledby={`alerts-${section.key}`}>
                <div className="flex items-start gap-3 mb-4 flex-wrap">
                  <span className={`w-8 h-8 rounded flex items-center justify-center inkwell-border shrink-0 ${section.iconBg}`}>
                    <span className={`material-symbols-outlined filled-icon text-[18px] ${section.iconClass}`}>
                      {section.icon}
                    </span>
                  </span>
                  <div className="min-w-0 flex-1">
                    <h3
                      id={`alerts-${section.key}`}
                      className="font-headline-lg-mobile text-headline-lg-mobile font-semibold text-on-surface"
                    >
                      {section.title}
                    </h3>
                    <p className="text-body-sm text-secondary">{section.subtitle}</p>
                  </div>
                  <span className="font-source-code text-source-code text-on-surface-variant bg-surface-container px-2 py-1 inkwell-border">
                    {section.items.length}
                  </span>
                </div>

                {section.items.length === 0 ? (
                  <div className="bg-surface-container-lowest inkwell-border p-5 text-body-sm text-secondary flex items-center gap-2">
                    <span className="material-symbols-outlined text-[18px] text-primary">check_circle</span>
                    Nothing in this section right now.
                  </div>
                ) : (
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                    {section.items.map((item) => (
                      <AlertCard
                        key={`${section.key}-${item.id}`}
                        item={item}
                        variant={section.key}
                        expanded={expandedId === item.id}
                        onToggleSource={() => setExpandedId((id) => (id === item.id ? null : item.id))}
                        busyAction={busy?.id === item.id ? busy.action : null}
                        disabled={Boolean(busy)}
                        snoozeOpen={snoozeOpenId === item.id}
                        onToggleSnooze={() => setSnoozeOpenId((id) => (id === item.id ? null : item.id))}
                        onSnooze={(days) => handleSnooze(item, days)}
                        onMarkDone={() => handleMarkDone(item)}
                        onVerify={() => handleVerify(item)}
                        onOpenReview={() => openReview(item)}
                      />
                    ))}
                  </div>
                )}
              </section>
            ))}
          </>
        )}
      </div>
    </AppShell>
  )
}
