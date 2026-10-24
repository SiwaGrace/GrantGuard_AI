// Overall health of a grant, shown on the Dashboard (table and cards views).
//   processing     – no finished document yet
//   failed         – the PDF or the AI extraction failed (Retry is offered)
//   no obligations – extraction finished but nothing was saved (Retry is offered)
//   overdue        – at least one obligation is past its due date and not done
//   needs review   – obligations awaiting confirmation, or low-confidence ones not yet verified
//   on track       – everything confirmed and verified, nothing overdue
export function grantStatus({ docStatus, obligationCount, pendingCount, flaggedCount, overdueCount = 0 }) {
  if (docStatus === 'pending') return 'processing'
  if (docStatus === 'failed') return 'failed'
  if (obligationCount === 0) return 'no obligations'
  if (overdueCount > 0) return 'overdue'
  if (pendingCount > 0 || flaggedCount > 0) return 'needs review'
  return 'on track'
}

export function canRetryExtraction(status) {
  return status === 'failed' || status === 'no obligations'
}

// Low-confidence obligations nobody has marked as reviewed yet
export function isFlagged(obligation) {
  return obligation.confidence === 'low' && !obligation.verified
}

export const DUE_SOON_DAYS = 14

// Today's date in the user's timezone as YYYY-MM-DD, to compare with due_date
export function todayISO() {
  return new Date().toLocaleDateString('en-CA')
}

function addDaysISO(isoDate, days) {
  const d = new Date(`${isoDate}T00:00:00`)
  d.setDate(d.getDate() + days)
  return d.toLocaleDateString('en-CA')
}

// Whole days from today until the due date (negative when overdue)
export function daysUntil(dueDate, today = todayISO()) {
  return Math.round((new Date(`${dueDate}T00:00:00`) - new Date(`${today}T00:00:00`)) / 86400000)
}

// "Confirmed" only means the extraction was checked; completed_at means done
export function isCompleted(obligation) {
  return Boolean(obligation.completed_at)
}

export function isOverdue(obligation, today = todayISO()) {
  return Boolean(obligation.due_date) && !isCompleted(obligation) && obligation.due_date < today
}

// Not done, due today or within the next DUE_SOON_DAYS days
export function isDueSoon(obligation, today = todayISO()) {
  if (!obligation.due_date || isCompleted(obligation)) return false
  return obligation.due_date >= today && obligation.due_date <= addDaysISO(today, DUE_SOON_DAYS)
}

// The agreement's own reference number when it was found in the document
// (e.g. GD-2026-WASH-0417); otherwise a short internal ID
export function grantReference(grant) {
  if (grant?.grant_number) return grant.grant_number
  return `G-${String(grant?.id || '').replace(/-/g, '').slice(0, 7).toUpperCase()}`
}
