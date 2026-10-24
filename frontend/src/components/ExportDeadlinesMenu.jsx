import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import toast from 'react-hot-toast'
import { buildCalendarEvents, toIcs, downloadIcs } from '../lib/ics'
import {
  GOOGLE_IMPORT_HELP_URL,
  TYPE_LABELS,
  downloadFile,
  formatDueDate,
  googleCalendarUrl,
  obligationStatusLabel,
  sortByDueDate,
  toCsv,
} from '../lib/deadlineExport'
import { grantReference, isCompleted } from '../lib/grantStatus'

// "Export deadlines" dropdown on the review screen: Google Calendar, .ics
// (Outlook / Apple), Excel CSV, and a printable deadline sheet.
// grant is the grants row with its display name filled in.
export default function ExportDeadlinesMenu({ obligations, grant }) {
  const [open, setOpen] = useState(false)
  const [googleHelpOpen, setGoogleHelpOpen] = useState(false)
  const [printing, setPrinting] = useState(false)
  const wrapperRef = useRef(null)
  const buttonRef = useRef(null)
  const menuRef = useRef(null)

  const grantName = grant?.name || 'Grant'
  const events = buildCalendarEvents(obligations, { [grant?.id]: grant || {} })
  const openDated = obligations.filter((o) => o.due_date && !isCompleted(o))
  const fileBase = `grantguard-${grantName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'grant'}-deadlines`

  useEffect(() => {
    if (!open) return
    menuRef.current?.querySelector('[role="menuitem"]:not(:disabled)')?.focus()
    function onPointer(e) {
      if (!wrapperRef.current?.contains(e.target)) setOpen(false)
    }
    document.addEventListener('mousedown', onPointer)
    return () => document.removeEventListener('mousedown', onPointer)
  }, [open])

  // Render the sheet first, then print it; drop it again afterwards
  useEffect(() => {
    if (!printing) return
    const done = () => setPrinting(false)
    window.addEventListener('afterprint', done)
    window.print()
    return () => window.removeEventListener('afterprint', done)
  }, [printing])

  function closeMenu() {
    setOpen(false)
    buttonRef.current?.focus()
  }

  function onMenuKeyDown(e) {
    const items = [...(menuRef.current?.querySelectorAll('[role="menuitem"]:not(:disabled)') || [])]
    const index = items.indexOf(document.activeElement)
    if (e.key === 'Escape') {
      e.preventDefault()
      closeMenu()
    } else if (e.key === 'ArrowDown') {
      e.preventDefault()
      items[(index + 1) % items.length]?.focus()
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      items[(index - 1 + items.length) % items.length]?.focus()
    } else if (e.key === 'Tab') {
      setOpen(false)
    }
  }

  function addToGoogle() {
    setOpen(false)
    // Google can pre-fill one event from a link; several need the .ics import
    if (openDated.length === 1) {
      window.open(googleCalendarUrl(openDated[0], grant), '_blank', 'noopener,noreferrer')
    } else {
      setGoogleHelpOpen(true)
    }
  }

  function exportIcs() {
    setOpen(false)
    if (events.length === 0) return
    downloadIcs(`${fileBase}.ics`, toIcs(events))
    toast.success(
      `${events.length} deadline${events.length === 1 ? '' : 's'} exported. Open the file to add them to your calendar.`,
    )
  }

  function exportCsv() {
    setOpen(false)
    downloadFile(`${fileBase}.csv`, toCsv(obligations, grant), 'text/csv;charset=utf-8')
    toast.success(`${obligations.length} obligation${obligations.length === 1 ? '' : 's'} exported for Excel`)
  }

  function printSheet() {
    setOpen(false)
    setPrinting(true)
  }

  const itemClass =
    'w-full text-left px-4 py-3 flex items-start gap-3 hover:bg-surface-container focus:bg-surface-container focus:outline-none transition-colors disabled:opacity-40 disabled:pointer-events-none'

  return (
    <>
      <div ref={wrapperRef} className="relative">
        <button
          ref={buttonRef}
          onClick={() => setOpen((v) => !v)}
          aria-haspopup="menu"
          aria-expanded={open}
          disabled={obligations.length === 0}
          className="py-3 px-4 border border-outline text-primary font-label-caps text-label-caps tracking-wider uppercase hover:bg-surface-container transition-colors notched-br flex items-center gap-2 disabled:opacity-40 disabled:pointer-events-none"
        >
          <span className="material-symbols-outlined text-[16px]">calendar_month</span>
          Export deadlines
          <span className="material-symbols-outlined text-[16px]">expand_more</span>
        </button>

        {open && (
          <div
            ref={menuRef}
            role="menu"
            aria-label="Export deadlines"
            onKeyDown={onMenuKeyDown}
            className="absolute right-0 mt-2 z-40 w-72 bg-surface-container-lowest inkwell-border shadow-lg py-1"
          >
            <button role="menuitem" onClick={addToGoogle} disabled={openDated.length === 0} className={itemClass}>
              <span className="material-symbols-outlined text-[18px] text-primary mt-0.5">event</span>
              <span>
                <span className="block text-body-sm font-medium text-on-surface">Add to Google Calendar</span>
                <span className="block text-[13px] text-on-surface-variant">
                  {openDated.length === 1 ? 'Opens Google Calendar with the deadline filled in' : 'How to import all deadlines'}
                </span>
              </span>
            </button>
            <button role="menuitem" onClick={exportIcs} disabled={events.length === 0} className={itemClass}>
              <span className="material-symbols-outlined text-[18px] text-primary mt-0.5">download</span>
              <span>
                <span className="block text-body-sm font-medium text-on-surface">Outlook / Apple Calendar (.ics)</span>
                <span className="block text-[13px] text-on-surface-variant">
                  {events.length === 0
                    ? 'No open obligations have a due date'
                    : `${events.length} deadline${events.length === 1 ? '' : 's'}, reminder a week before`}
                </span>
              </span>
            </button>
            <button role="menuitem" onClick={exportCsv} className={itemClass}>
              <span className="material-symbols-outlined text-[18px] text-primary mt-0.5">table_view</span>
              <span>
                <span className="block text-body-sm font-medium text-on-surface">Excel (.csv)</span>
                <span className="block text-[13px] text-on-surface-variant">All obligations with due dates and status</span>
              </span>
            </button>
            <button role="menuitem" onClick={printSheet} className={itemClass}>
              <span className="material-symbols-outlined text-[18px] text-primary mt-0.5">print</span>
              <span>
                <span className="block text-body-sm font-medium text-on-surface">Print / PDF</span>
                <span className="block text-[13px] text-on-surface-variant">A deadline sheet sorted by date</span>
              </span>
            </button>
          </div>
        )}
      </div>

      {googleHelpOpen && (
        <GoogleImportDialog
          count={events.length}
          onDownload={() => {
            downloadIcs(`${fileBase}.ics`, toIcs(events))
            toast.success('Calendar file downloaded. Import it in Google Calendar.')
          }}
          onClose={() => setGoogleHelpOpen(false)}
        />
      )}

      {printing && createPortal(<DeadlineSheet obligations={obligations} grant={grant} />, document.body)}
    </>
  )
}

function GoogleImportDialog({ count, onDownload, onClose }) {
  useEffect(() => {
    function onKey(e) {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center p-4 md:p-8"
      role="dialog"
      aria-modal="true"
      aria-labelledby="google-import-title"
    >
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative w-full max-w-xl bg-surface-container-lowest inkwell-border notched-card shadow-2xl">
        <div className="p-6 md:p-8">
          <div className="flex items-start justify-between mb-6">
            <div className="flex items-center gap-2">
              <span className="material-symbols-outlined filled-icon text-primary">event</span>
              <h3
                id="google-import-title"
                className="font-headline-lg-mobile text-headline-lg-mobile font-semibold text-on-surface"
              >
                Add all deadlines to Google Calendar
              </h3>
            </div>
            <button
              onClick={onClose}
              aria-label="Close"
              className="text-secondary hover:text-primary transition-colors p-1"
            >
              <span className="material-symbols-outlined">close</span>
            </button>
          </div>

          <p className="text-body-md text-on-surface-variant mb-4">
            Google Calendar can only add one event from a link. To add all {count} deadlines at once, import the
            calendar file:
          </p>
          <ol className="list-decimal pl-5 space-y-1 text-body-md text-on-surface mb-4">
            <li>Download the .ics file below.</li>
            <li>
              On a computer, open Google Calendar and go to <strong>Settings → Import &amp; export</strong>.
            </li>
            <li>Choose the file, pick a calendar, and click <strong>Import</strong>.</li>
          </ol>
          <p className="text-body-sm text-on-surface-variant mb-6">
            To add a single deadline, use <strong>Add to Google Calendar</strong> on its card.{' '}
            <a
              href={GOOGLE_IMPORT_HELP_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary underline hover:text-surface-tint"
            >
              Google&apos;s help: import events
            </a>
          </p>

          <div className="flex flex-wrap gap-3">
            <button
              onClick={onDownload}
              disabled={count === 0}
              className="bg-primary text-on-primary py-3 px-5 font-label-caps text-label-caps tracking-wider uppercase hover:bg-surface-tint transition-colors notched-br flex items-center gap-2 disabled:opacity-60"
            >
              <span className="material-symbols-outlined text-[16px]">download</span>
              Download .ics
            </button>
            <button
              onClick={onClose}
              className="py-3 px-5 border border-outline text-primary font-label-caps text-label-caps tracking-wider uppercase hover:bg-surface-container transition-colors notched-br"
            >
              Close
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

// Print-only page (see .deadline-sheet in index.css): the grant header and
// every obligation by due date, undated ones at the end
function DeadlineSheet({ obligations, grant }) {
  const sorted = sortByDueDate(obligations)
  const dated = sorted.filter((o) => o.due_date)
  const undated = sorted.filter((o) => !o.due_date)

  const table = (rows) => (
    <table>
      <thead>
        <tr>
          <th className="sheet-date">Due date</th>
          <th>Obligation</th>
          <th>Type</th>
          <th>Status</th>
          <th className="sheet-page">Page</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((o) => (
          <tr key={o.id}>
            <td className="sheet-date">{o.due_date ? formatDueDate(o.due_date) : 'No date found'}</td>
            <td>{o.description}</td>
            <td>{TYPE_LABELS[o.type] || o.type}</td>
            <td>{obligationStatusLabel(o)}</td>
            <td className="sheet-page">{o.source_page ?? '—'}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )

  return (
    <div className="deadline-sheet">
      <header>
        <p className="sheet-kicker">GrantGuard · Deadline sheet</p>
        <h1>{grant?.name || 'Grant'}</h1>
        <p>
          {[grant?.funder_name, grantReference(grant)].filter(Boolean).join(' · ')}
          <br />
          Printed {formatDueDate(new Date().toLocaleDateString('en-CA'))} · {dated.length} dated obligation
          {dated.length === 1 ? '' : 's'}
        </p>
      </header>
      {dated.length > 0 ? table(dated) : <p>No obligations have a due date.</p>}
      {undated.length > 0 && (
        <>
          <h2>Without a due date</h2>
          {table(undated)}
        </>
      )}
    </div>
  )
}
