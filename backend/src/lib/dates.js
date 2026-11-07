// Finds an explicit calendar date in a clause, for obligations the AI left
// without a due_date. Only full dates count (day, month and year); periods
// like "November 2026" or "within 30 days" don't.

const MONTHS = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
}
const MONTH = '(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sept?(?:ember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\\.?'
const DAY = '(\\d{1,2})(?:st|nd|rd|th)?'
const YEAR = '(\\d{4})'

// "January 15, 2027" / "Jan. 15 2027" / "15 January 2027" / "15th of January, 2027" / "2027-01-15"
const DATE_PATTERNS = [
  { re: new RegExp(`\\b${MONTH}\\s+${DAY},?\\s+${YEAR}\\b`, 'gi'), order: ['m', 'd', 'y'] },
  { re: new RegExp(`\\b${DAY}\\s+(?:of\\s+)?${MONTH},?\\s+${YEAR}\\b`, 'gi'), order: ['d', 'm', 'y'] },
  { re: /\b(\d{4})-(\d{2})-(\d{2})\b/g, order: ['y', 'mm', 'd'] },
]

// Words that mark a date as the deadline ("by May 1, 2027", "due on ...")
const DEADLINE_CUE = /\b(?:by|before|due(?:\s+(?:on|by))?|deadline(?:\s+(?:of|is))?|no later than|not later than|on or before|until)\s*:?\s*(?:the\s+)?$/i

function toIso(y, m, d) {
  const iso = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
  const date = new Date(`${iso}T00:00:00Z`)
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === iso ? iso : null
}

// Every full date in the text, in order of appearance: [{ iso, index }]
export function findDates(text) {
  const found = []
  for (const { re, order } of DATE_PATTERNS) {
    for (const match of String(text || '').matchAll(re)) {
      const parts = {}
      order.forEach((key, i) => { parts[key] = match[i + 1] })
      const month = parts.mm ? Number(parts.mm) : MONTHS[parts.m.slice(0, 3).toLowerCase()]
      const iso = toIso(Number(parts.y), month, Number(parts.d))
      if (iso) found.push({ iso, index: match.index })
    }
  }
  return found.sort((a, b) => a.index - b.index)
}

// The due date stated in a clause, or null. A date right after "by",
// "no later than", "due" etc. wins; otherwise a clause with exactly one
// date (e.g. a schedule row "January 15, 2027 Submission of Q4 report")
// uses that date, unless it's an eligible-activity rule, where a lone date
// is more likely a period boundary than a deadline.
export function dueDateFromText(text, type = null) {
  const source = String(text || '')
  const dates = findDates(source)
  if (dates.length === 0) return null

  const cued = dates.find(({ index }) => DEADLINE_CUE.test(source.slice(Math.max(0, index - 40), index)))
  if (cued) return cued.iso

  const distinct = [...new Set(dates.map((d) => d.iso))]
  if (distinct.length === 1 && type !== 'eligible_activity') return distinct[0]
  return null
}

// Obligation rows with due_date filled from their source_excerpt where it
// was missing. Returns { rows, filled } where filled lists the changed rows.
export function fillMissingDueDates(rows) {
  const filled = []
  const out = (rows || []).map((o) => {
    if (o.due_date || !o.source_excerpt) return o
    const due = dueDateFromText(o.source_excerpt, o.type)
    if (!due) return o
    const row = { ...o, due_date: due }
    filled.push(row)
    return row
  })
  return { rows: out, filled }
}
