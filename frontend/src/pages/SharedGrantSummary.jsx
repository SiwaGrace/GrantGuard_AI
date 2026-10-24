import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'

const TYPE_LABELS = {
  deadline: { label: 'Deadline', icon: 'event' },
  reporting: { label: 'Reporting', icon: 'summarize' },
  eligible_activity: { label: 'Eligible Activity', icon: 'checklist' },
  compliance_condition: { label: 'Compliance Condition', icon: 'gavel' },
}

function formatDate(d) {
  if (!d) return '—'
  const date = new Date(d)
  if (Number.isNaN(date.getTime())) return d
  return date.toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' })
}

export default function SharedGrantSummary() {
  const { token } = useParams()
  const [loading, setLoading] = useState(true)
  const [data, setData] = useState(null)
  const [error, setError] = useState('')

  useEffect(() => {
    let active = true
    async function load() {
      try {
        const { data: result, error: rpcErr } = await supabase.rpc(
          'anon_grant_summary',
          { p_token: token },
        )
        if (!active) return
        if (rpcErr) throw new Error(rpcErr.message)
        if (!result || result.status === 'not_found') {
          setError('This link is invalid or has been revoked.')
          setLoading(false)
          return
        }
        setData(result)
        setLoading(false)
      } catch {
        if (active) {
          setError('This link could not be loaded.')
          setLoading(false)
        }
      }
    }
    load()
    return () => { active = false }
  }, [token])

  return (
    <div className="min-h-screen bg-background text-on-background font-body-md">
      <div className="max-w-2xl mx-auto px-4 sm:px-6 py-10">
        {/* Identity bar */}
        <div className="flex items-center gap-3 mb-8">
          <div className="w-10 h-10 bg-surface-container-high rounded flex items-center justify-center inkwell-border">
            <span className="material-symbols-outlined text-primary">account_balance</span>
          </div>
          <div>
            <h1 className="font-headline-lg-mobile text-headline-lg-mobile font-bold text-primary">
              GrantGuard AI
            </h1>
            <p className="font-label-caps text-label-caps text-secondary uppercase">
              Funded Project Compliance Summary
            </p>
          </div>
        </div>

        {/* Prominent shared-summary notice */}
        <div className="flex items-start gap-3 bg-surface-container-high inkwell-border p-4 mb-8">
          <span className="material-symbols-outlined text-warning-text shrink-0 mt-0.5">info</span>
          <p className="text-body-sm text-on-surface-variant">
            <strong className="text-on-surface">This is a shared compliance summary, not the full grant agreement.</strong>{' '}
            It shows only confirmed obligations for this project. For complete agreement terms,
            please contact the grantee.
          </p>
        </div>

        {loading ? (
          <div className="flex flex-col items-center justify-center py-16 text-on-surface-variant">
            <div className="w-8 h-8 border-2 border-outline-variant border-t-primary rounded-full animate-spin mb-3" />
            <p className="text-body-md">Loading summary…</p>
          </div>
        ) : error ? (
          <div className="bg-surface-container-lowest inkwell-border notched-card p-10 text-center">
            <span className="material-symbols-outlined text-[44px] text-alert-crimson mb-3">link_off</span>
            <h2 className="font-headline-lg-mobile md:font-headline-lg text-headline-lg-mobile md:text-headline-lg text-on-surface mb-2">
              Link unavailable
            </h2>
            <p className="text-body-md text-on-surface-variant max-w-md mx-auto">{error}</p>
          </div>
        ) : (
          <div className="space-y-6">
            {/* Summary card */}
            <div className="bg-surface-container-lowest inkwell-border notched-card p-6">
              <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
                <div>
                  <p className="font-label-caps text-label-caps text-secondary uppercase mb-1">Project</p>
                  <h2 className="font-headline-lg-mobile md:font-headline-lg text-headline-lg-mobile md:text-headline-lg text-on-surface">
                    {data.grant.name}
                  </h2>
                  <p className="text-body-md text-on-surface-variant mt-1">
                    {data.grant.funder_name || 'Funder not specified'}
                  </p>
                </div>
                <div
                  className={`inline-flex items-center gap-2 px-3 py-1.5 border border-outline-variant font-label-caps text-label-caps uppercase ${
                    data.overall_status === 'on track' ? 'text-primary bg-primary-tint' : 'text-warning-text bg-surface-container'
                  }`}
                >
                  <span className="material-symbols-outlined text-[16px]">
                    {data.overall_status === 'on track' ? 'check_circle' : 'pending'}
                  </span>
                  {data.overall_status}
                </div>
              </div>
            </div>

            {/* Obligations */}
            <div>
              <h3 className="font-label-caps text-label-caps text-secondary uppercase tracking-widest mb-3">
                Confirmed Obligations ({data.confirmed_obligations.length})
              </h3>
              {data.confirmed_obligations.length === 0 ? (
                <div className="bg-surface-container-lowest inkwell-border p-6 text-center text-body-md text-on-surface-variant">
                  No confirmed obligations to display yet.
                </div>
              ) : (
                <div className="space-y-3">
                  {data.confirmed_obligations.map((o, i) => {
                    const meta = TYPE_LABELS[o.type] || { label: o.type, icon: 'task_alt' }
                    return (
                      <div
                        key={i}
                        className="bg-surface-container-lowest inkwell-border p-5 flex flex-col sm:flex-row sm:items-start gap-3"
                      >
                        <div className="flex items-center gap-2 sm:w-44 shrink-0">
                          <span className="material-symbols-outlined text-primary text-[18px]">{meta.icon}</span>
                          <span className="font-label-caps text-label-caps text-primary uppercase">{meta.label}</span>
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-body-md text-on-surface">{o.description}</p>
                          <p className="font-source-code text-source-code text-on-surface-variant mt-1">
                            Due: {formatDate(o.due_date)}
                          </p>
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>

            <p className="text-center font-label-caps text-label-caps text-secondary uppercase pt-4">
              Generated with GrantGuard AI
            </p>
          </div>
        )}
      </div>
    </div>
  )
}
