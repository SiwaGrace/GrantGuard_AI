import {
  daysUntil,
  grantReference,
  isDueSoon,
  isFlagged,
  isOverdue,
  todayISO,
} from './grantStatus'

// A snoozed obligation is hidden from Overdue / Due soon until the
// timestamp passes. A snooze in the past is simply ignored.
export function isSnoozed(obligation, now = new Date()) {
  if (!obligation?.snoozed_until) return false
  const until = new Date(obligation.snoozed_until).getTime()
  return Number.isFinite(until) && until > now.getTime()
}

// "12 days overdue", "Due today", "Due in 5 days" plus the sortable day count.
export function dueLabel(dueDate, today = todayISO()) {
  const days = daysUntil(dueDate, today)
  if (days < 0) {
    const count = -days
    return { days, text: `${count} day${count === 1 ? '' : 's'} overdue`, overdue: true }
  }
  if (days === 0) return { days, text: 'Due today', overdue: false }
  if (days === 1) return { days, text: 'Due tomorrow', overdue: false }
  return { days, text: `Due in ${days} days`, overdue: false }
}

// The single source of truth for the Dashboard and Alerts page.
// Overdue / Due soon only count confirmed obligations; Flagged is every
// low-confidence clause nobody has verified yet (the same rule the Review
// screen uses).
export function buildAlertBuckets(
  obligations,
  { today = todayISO(), grantsById = {}, confirmedOnly = true, now = new Date() } = {},
) {
  const isActionable = (o) => !confirmedOnly || o.status === 'confirmed'
  const enriched = obligations.map((o) => {
    const grant = grantsById[o.grant_id] || {}
    return {
      ...o,
      grantName: grant.name || 'Unknown grant',
      funderName: grant.funder_name || '',
      grantRef: grantReference(grant.id ? grant : { id: o.grant_id }),
    }
  })

  const overdue = enriched
    .filter((o) => isActionable(o) && isOverdue(o, today) && !isSnoozed(o, now))
    .sort((a, b) => a.due_date.localeCompare(b.due_date))

  const dueSoon = enriched
    .filter((o) => isActionable(o) && isDueSoon(o, today) && !isSnoozed(o, now))
    .sort((a, b) => a.due_date.localeCompare(b.due_date))

  const flagged = enriched
    .filter(isFlagged)
    .sort(
      (a, b) =>
        a.grantName.localeCompare(b.grantName) ||
        (a.due_date || '').localeCompare(b.due_date || '') ||
        new Date(a.created_at) - new Date(b.created_at),
    )

  return { overdue, dueSoon, flagged }
}

// Overdue and Due soon never overlap, but a flagged item can also be due
// soon, so dedupe by id for the "All" count.
export function uniqueAlertCount({ overdue, dueSoon, flagged }) {
  const ids = new Set()
  for (const item of [...overdue, ...dueSoon, ...flagged]) ids.add(item.id)
  return ids.size
}
