// iCalendar (RFC 5545) export of obligation deadlines as all-day events
// with a reminder a week before, for Google Calendar, Outlook and Apple.

const REMINDER_DAYS = 7
const MAX_LINE_OCTETS = 75

// All-day DATE values are YYYYMMDD with no time and no "Z" (RFC 5545 §3.3.4)
export function formatIcsDate(isoDate) {
  return String(isoDate).slice(0, 10).replace(/-/g, '')
}

// The exclusive end of a one-day event: the next calendar day
export function nextDayIcsDate(isoDate) {
  const [y, m, d] = String(isoDate).slice(0, 10).split('-').map(Number)
  const next = new Date(Date.UTC(y, m - 1, d + 1))
  return next.toISOString().slice(0, 10).replace(/-/g, '')
}

// UTC DATE-TIME, e.g. 20261023T153000Z (used for DTSTAMP)
export function formatIcsDateTime(date) {
  return new Date(date).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z')
}

// RFC 5545 §3.1: fold content lines longer than 75 octets, continuing with a
// single leading space, without splitting a multi-byte UTF-8 character.
export function foldLine(content) {
  const bytes = new TextEncoder().encode(content)
  if (bytes.length <= MAX_LINE_OCTETS) return content

  const decoder = new TextDecoder('utf-8', { fatal: true })
  const lines = []
  let start = 0
  while (start < bytes.length) {
    // Continuation lines spend one octet on the leading space
    let end = Math.min(start + (lines.length === 0 ? MAX_LINE_OCTETS : MAX_LINE_OCTETS - 1), bytes.length)
    while (end > start) {
      try {
        decoder.decode(bytes.subarray(start, end))
        break
      } catch {
        end--
      }
    }
    const chunk = decoder.decode(bytes.subarray(start, end))
    lines.push(lines.length === 0 ? chunk : ` ${chunk}`)
    start = end
  }
  return lines.join('\r\n')
}

// TEXT escaping (RFC 5545 §3.3.11)
function escapeText(value) {
  return String(value)
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r?\n/g, '\\n')
}

const TYPE_LABELS = {
  deadline: 'Deadline',
  reporting: 'Reporting',
  eligible_activity: 'Eligible activity',
  compliance_condition: 'Compliance condition',
}

// One event per dated obligation that isn't done yet.
// grantsById maps grant id -> { name, funder_name, grant_number }.
export function buildCalendarEvents(obligations, grantsById = {}) {
  return obligations
    .filter((o) => o.due_date && !o.completed_at)
    .map((o) => {
      const grant = grantsById[o.grant_id] || {}
      const grantLabel = grant.name || 'Grant'
      return {
        uid: `${o.id}@grantguard`,
        dueDate: o.due_date,
        summary: `[${grantLabel}] ${o.description || 'Obligation'}`,
        description: [
          o.description,
          '',
          `Grant: ${grantLabel}${grant.grant_number ? ` (${grant.grant_number})` : ''}`,
          grant.funder_name && `Funder: ${grant.funder_name}`,
          `Type: ${TYPE_LABELS[o.type] || 'Obligation'}`,
          `Due: ${o.due_date}`,
          o.source_excerpt && `Source clause: "${o.source_excerpt}"`,
        ]
          .filter((line) => line !== null && line !== undefined && line !== false)
          .join('\n'),
      }
    })
}

export function toIcs(events) {
  const stamp = formatIcsDateTime(new Date())
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//GrantGuard AI//Grant Deadlines//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'X-WR-CALNAME:GrantGuard deadlines',
  ]

  for (const ev of events) {
    lines.push(
      'BEGIN:VEVENT',
      `UID:${ev.uid}`,
      `DTSTAMP:${stamp}`,
      `DTSTART;VALUE=DATE:${formatIcsDate(ev.dueDate)}`,
      `DTEND;VALUE=DATE:${nextDayIcsDate(ev.dueDate)}`,
      `SUMMARY:${escapeText(ev.summary)}`,
      `DESCRIPTION:${escapeText(ev.description)}`,
      'TRANSP:TRANSPARENT',
      // Helps Outlook treat the import as all-day; ignored elsewhere
      'X-MICROSOFT-CDO-ALLDAYEVENT:TRUE',
      'BEGIN:VALARM',
      'ACTION:DISPLAY',
      `DESCRIPTION:${escapeText(`Due in ${REMINDER_DAYS} days: ${ev.summary}`)}`,
      `TRIGGER:-P${REMINDER_DAYS}D`,
      'END:VALARM',
      'END:VEVENT',
    )
  }

  lines.push('END:VCALENDAR')
  return lines.map(foldLine).join('\r\n') + '\r\n'
}

export function downloadIcs(filename, icsString) {
  const blob = new Blob([icsString], { type: 'text/calendar;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}
