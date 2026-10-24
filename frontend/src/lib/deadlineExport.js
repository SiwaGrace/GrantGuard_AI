// Deadline exports other than the .ics file (see ics.js): a Google Calendar
// link for one obligation, an Excel-friendly CSV, and helpers for the
// printable deadline sheet.
import { formatIcsDate, nextDayIcsDate } from './ics'
import { isCompleted, isOverdue } from './grantStatus'

export const TYPE_LABELS = {
  deadline: 'Deadline',
  reporting: 'Reporting',
  eligible_activity: 'Eligible activity',
  compliance_condition: 'Compliance condition',
}

// Google's help page for importing an .ics file (it has no link that adds
// several events at once)
export const GOOGLE_IMPORT_HELP_URL = 'https://support.google.com/calendar/answer/37118'

// Done wins over overdue, overdue over approved
export function obligationStatusLabel(o) {
  if (isCompleted(o)) return 'Done'
  if (isOverdue(o)) return 'Overdue'
  if (o.status === 'confirmed') return 'Approved'
  return 'Pending'
}

// Dated obligations first in date order, then the undated ones
export function sortByDueDate(obligations) {
  return [...obligations].sort((a, b) => {
    if (a.due_date && b.due_date) return a.due_date.localeCompare(b.due_date)
    if (a.due_date) return -1
    if (b.due_date) return 1
    return 0
  })
}

// "15 Jan 2027"
export function formatDueDate(isoDate) {
  if (!isoDate) return ''
  return new Date(`${String(isoDate).slice(0, 10)}T00:00:00`).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  })
}

// Keeps the link well under the ~8k characters browsers and Google accept
const MAX_DETAILS_CHARS = 1200

// An all-day event in Google Calendar's "create event" form, pre-filled.
// grant is { name, funder_name, grant_number }.
export function googleCalendarUrl(o, grant = {}) {
  if (!o?.due_date) return null
  const grantLabel = grant.name || 'Grant'
  const details = [
    o.description,
    '',
    `Grant: ${grantLabel}${grant.grant_number ? ` (${grant.grant_number})` : ''}`,
    grant.funder_name && `Funder: ${grant.funder_name}`,
    `Type: ${TYPE_LABELS[o.type] || 'Obligation'}`,
    o.source_page && `Page: ${o.source_page}`,
    o.source_excerpt && `Source clause: "${o.source_excerpt}"`,
  ]
    .filter((line) => line !== null && line !== undefined && line !== false)
    .join('\n')

  const params = new URLSearchParams({
    action: 'TEMPLATE',
    text: `[${grantLabel}] ${o.description || 'Obligation'}`,
    // All-day: start date / exclusive end date
    dates: `${formatIcsDate(o.due_date)}/${nextDayIcsDate(o.due_date)}`,
    details: details.length > MAX_DETAILS_CHARS ? `${details.slice(0, MAX_DETAILS_CHARS - 1)}…` : details,
  })
  return `https://calendar.google.com/calendar/render?${params}`
}

// Quote every field; stop Excel reading text that starts with = + - @ as a formula
function csvField(value) {
  let text = value === null || value === undefined ? '' : String(value)
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`
  return `"${text.replace(/"/g, '""')}"`
}

export const CSV_COLUMNS = [
  'Grant',
  'Grant number',
  'Funder',
  'Obligation',
  'Type',
  'Due date',
  'Status',
  'Page',
  'Source clause',
]

// One row per obligation, sorted by due date. The BOM makes Excel open the
// file as UTF-8 (otherwise accents and curly quotes come out garbled).
export function toCsv(obligations, grant = {}) {
  const rows = sortByDueDate(obligations).map((o) => [
    grant.name || '',
    grant.grant_number || '',
    grant.funder_name || '',
    o.description || '',
    TYPE_LABELS[o.type] || o.type || '',
    o.due_date || '',
    obligationStatusLabel(o),
    o.source_page ?? '',
    o.source_excerpt || '',
  ])
  return '﻿' + [CSV_COLUMNS, ...rows].map((row) => row.map(csvField).join(',')).join('\r\n') + '\r\n'
}

export function downloadFile(filename, content, type) {
  const blob = new Blob([content], { type })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}
