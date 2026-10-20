export function formatIcsDate(dateOnly) {
  return String(dateOnly).replace(/[-:]/g, '').replace(/\.\d{3}/, '') + 'Z'
}

export function formatIcsDateTime(date) {
  const iso = new Date(date).toISOString()
  return iso.replace(/-/g, '').replace(/:/g, '').replace(/\.\d{3}Z$/, 'Z')
}

const MAX_LINE_OCTETS = 75

export function foldLine(content) {
  const bytes = new TextEncoder().encode(content)
  if (bytes.length <= MAX_LINE_OCTETS) {
    return content
  }

  // RFC 5545 §3.1: fold long content lines at 75 octets, continuing with a
  // single leading space. We fold on UTF-8 octet boundaries (never between
  // a multi-byte character's bytes).
  const lines = []
  let start = 0
  while (start < bytes.length) {
    const isFirst = lines.length === 0
    // First segment, and continuation segments, carry one extra leading space
    // on continuations. We reserve 1 octet on continuations for that space.
    const limit = isFirst ? MAX_LINE_OCTETS : MAX_LINE_OCTETS - 1
    let end = start + limit
    // Do not split inside a multi-byte character.
    const decoder = new TextDecoder('utf-8', { fatal: true })
    while (end > start) {
      try {
        decoder.decode(bytes.subarray(start, end))
        break
      } catch {
        end--
      }
    }
    if (end === start) {
      // Unlikely: a single multi-byte char longer than limit. Take one char.
      end = start + 1
      while (end < bytes.length) {
        try {
          new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(start, end + 1))
          end++
        } catch {
          break
        }
      }
    }
    const chunk = new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(start, end))
    lines.push(isFirst ? chunk : ' ' + chunk)
    start = end
  }
  return lines.join('\r\n')
}

export function toIcs(events) {
  const now = formatIcsDateTime(new Date())
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//GrantGuard AI//GrantGuard//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
  ]

  for (let i = 0; i < events.length; i++) {
    const ev = events[i]
    const uid = `${ev.uid || `grantguard-${i}-${Date.now()}`}`
    lines.push('BEGIN:VEVENT')
    lines.push(`UID:${uid}`)
    lines.push(`DTSTAMP:${now}`)
    if (ev.due_date) {
      lines.push(`DTSTART;VALUE=DATE:${formatIcsDate(ev.due_date)}`)
      // These Microsoft CDO properties make Outlook recognise the all-day
      // event during import (Outlook otherwise rejects/ignores lone VALUE=DATE
      // all-day events). Harmless for Google/Apple.
      lines.push('X-MICROSOFT-CDO-ALLDAYEVENT:TRUE')
      lines.push('X-MICROSOFT-CDO-BUSYSTATUS:FREE')
      lines.push('X-MICROSOFT-CDO-INTENDEDSTATUS:FREE')
    }
    lines.push(`SUMMARY:${escapeIcs(ev.title)}`)
    if (ev.description) {
      lines.push(`DESCRIPTION:${escapeIcs(ev.description)}`)
    }
    lines.push('END:VEVENT')
  }

  lines.push('END:VCALENDAR')
  // Fold all content lines, then join with CRLF.
  return lines.map(foldLine).join('\r\n') + '\r\n'
}

function escapeIcs(value) {
  return String(value)
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r?\n/g, '\\n')
}

export function buildCalendarEvents(obligations, grantNameMap) {
  const events = []
  for (const o of obligations) {
    if (!o.due_date) continue
    const grantName = grantNameMap ? grantNameMap[o.grant_id] || 'Grant' : 'Grant'
    events.push({
      title: o.description || 'Obligation',
      due_date: o.due_date,
      description: `${grantName} — ${o.type || 'obligation'}`,
    })
  }
  return events
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
