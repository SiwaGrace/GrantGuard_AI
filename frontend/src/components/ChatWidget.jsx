import { useEffect, useRef, useState } from 'react'
import { useAuth } from '../context/AuthContext'
import { supabase } from '../lib/supabase'
import { apiFetch, readJson } from '../lib/api'

const SUGGESTIONS = [
  'How many grants have a due date this week?',
  'Which obligations are overdue?',
  'List reporting deadlines coming up.',
  'Summarize my portfolio health.',
]

// Renders the assistant's markdown as React elements (never raw HTML), so any
// markup in the answer is shown as text instead of being executed.
function renderInline(text) {
  return text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g).map((part, i) => {
    if (part.length > 4 && part.startsWith('**') && part.endsWith('**')) {
      return <strong key={i}>{part.slice(2, -2)}</strong>
    }
    if (part.length > 2 && part.startsWith('`') && part.endsWith('`')) {
      return (
        <code key={i} className="font-source-code text-source-code bg-surface-container px-1">
          {part.slice(1, -1)}
        </code>
      )
    }
    return part
  })
}

function splitRow(line) {
  return line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim())
}

function parseBlocks(text) {
  const blocks = []
  let current = null

  function push(kind, value) {
    if (!current || current.kind !== kind) {
      current = { kind, items: [] }
      blocks.push(current)
    }
    current.items.push(value)
  }

  for (const raw of String(text || '').replace(/\r\n/g, '\n').split('\n')) {
    const line = raw.trimEnd()
    const bullet = line.match(/^\s*[-*•]\s+(.*)$/)
    const numbered = line.match(/^\s*\d+[.)]\s+(.*)$/)
    const heading = line.match(/^\s*#{1,6}\s+(.*)$/)

    if (!line.trim()) {
      current = null
    } else if (/^\s*\|/.test(line)) {
      // Skip the |---|---| separator row under a table header
      if (!/^\s*\|?[\s:|-]+\|?\s*$/.test(line)) push('table', splitRow(line))
    } else if (bullet) {
      push('ul', bullet[1])
    } else if (numbered) {
      push('ol', numbered[1])
    } else if (heading) {
      current = null
      blocks.push({ kind: 'h', items: [heading[1]] })
    } else {
      push('p', line)
    }
  }
  return blocks
}

function Markdown({ text }) {
  return (
    <div className="space-y-2">
      {parseBlocks(text).map((block, i) => {
        if (block.kind === 'ul' || block.kind === 'ol') {
          const List = block.kind
          return (
            <List key={i} className={`${block.kind === 'ul' ? 'list-disc' : 'list-decimal'} pl-5 space-y-1`}>
              {block.items.map((item, j) => (
                <li key={j}>{renderInline(item)}</li>
              ))}
            </List>
          )
        }
        if (block.kind === 'h') {
          return (
            <p key={i} className="font-semibold">
              {renderInline(block.items[0])}
            </p>
          )
        }
        if (block.kind === 'table') {
          const [head, ...rows] = block.items
          return (
            // Scrolls sideways instead of squashing the columns
            <div key={i} className="overflow-x-auto max-w-full -mx-1 px-1 pb-1">
              <table className="w-max text-[15px] border-collapse">
                <thead>
                  <tr>
                    {head.map((cell, j) => (
                      <th key={j} className="text-left font-semibold border-b border-outline-variant px-2 py-1 whitespace-nowrap">
                        {renderInline(cell)}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row, r) => (
                    <tr key={r}>
                      {row.map((cell, j) => (
                        <td key={j} className="border-b border-outline-variant px-2 py-1 align-top min-w-[7rem] max-w-[16rem]">
                          {renderInline(cell)}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        }
        return (
          <p key={i}>
            {block.items.map((line, j) => (
              <span key={j}>
                {j > 0 && <br />}
                {renderInline(line)}
              </span>
            ))}
          </p>
        )
      })}
    </div>
  )
}

export default function ChatWidget() {
  const { session } = useAuth()
  const [open, setOpen] = useState(false)
  const [messages, setMessages] = useState([])
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)
  const scrollRef = useRef(null)
  const inputRef = useRef(null)

  useEffect(() => {
    const el = scrollRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [messages, open])

  useEffect(() => {
    if (!open) return
    inputRef.current?.focus()
    function onKey(e) {
      if (e.key === 'Escape') setOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])

  useEffect(() => {
    function onToggle() {
      setOpen((v) => !v)
    }
    window.addEventListener('grantguard:toggle-chat', onToggle)
    return () => window.removeEventListener('grantguard:toggle-chat', onToggle)
  }, [])

  function clearChat() {
    setMessages([])
  }

  async function send(text, initial = false) {
    const content = (text || input).trim()
    if (!content || sending) return

    const userMsg = { role: 'user', content }
    // Failed answers aren't sent back as conversation history
    const history = initial
      ? []
      : messages.filter((m) => !m.error && m.content).map((m) => ({ role: m.role, content: m.content }))

    setMessages((prev) => [...prev, userMsg])
    setInput('')
    setSending(true)

    const assistantMsg = { role: 'assistant', content: '', pending: true }
    setMessages((prev) => [...prev, assistantMsg])

    try {
      const { data: authData } = await supabase.auth.getSession()
      const token = authData.session?.access_token
      if (!token) throw new Error('Not authenticated')

      const res = await apiFetch(`/api/chat`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ message: content, history }),
        timeoutMs: 65000,
      })

      const payload = await readJson(res)
      if (!res.ok) throw new Error(payload.error || 'Chat request failed')

      setMessages((prev) => {
        const next = [...prev]
        next[next.length - 1] = { role: 'assistant', content: payload.answer }
        return next
      })
    } catch (err) {
      // Shown inline in the conversation only (no toast as well)
      setMessages((prev) => {
        const next = [...prev]
        next[next.length - 1] = {
          role: 'assistant',
          content: '',
          error: err.message || 'Could not reach the assistant. Please try again.',
        }
        return next
      })
    } finally {
      setSending(false)
    }
  }

  return (
    <>
      {/* Floating launcher (hidden while the panel is open; the panel has its own close button) */}
      {!open && (
        <button
          onClick={() => setOpen(true)}
          aria-label="Open grant assistant"
          className="fixed bottom-6 right-6 z-[100] w-14 h-14 rounded-full bg-primary text-on-primary shadow-xl flex items-center justify-center hover:bg-surface-tint transition-all notched-br"
        >
          <span className="material-symbols-outlined filled-icon text-[24px]">forum</span>
        </button>
      )}

      {/* Chat panel */}
      {open && (
        <div
          role="dialog"
          aria-label="Ask GrantGuard"
          className="fixed z-[90] inset-x-0 top-16 bottom-0 md:inset-x-auto md:top-auto md:right-6 md:bottom-6 md:w-[420px] md:h-[min(640px,calc(100vh-8rem))] bg-surface-container-lowest inkwell-border flex flex-col shadow-2xl"
        >
          {/* Header */}
          <div className="flex items-center justify-between gap-3 px-5 py-4 inkwell-border-b bg-surface-container-low">
            <div className="flex items-center gap-3 min-w-0">
              <div className="w-10 h-10 bg-primary rounded flex items-center justify-center text-on-primary shrink-0 notched-br">
                <span className="material-symbols-outlined filled-icon">auto_awesome</span>
              </div>
              <div className="min-w-0">
                <h2 className="font-headline-lg-mobile text-headline-lg-mobile font-bold text-on-surface">
                  Ask GrantGuard
                </h2>
                <p className="font-label-caps text-label-caps text-secondary uppercase">
                  Your compliance assistant
                </p>
              </div>
            </div>
            <button
              onClick={() => setOpen(false)}
              aria-label="Close chat"
              className="text-secondary hover:text-primary transition-colors p-1"
            >
              <span className="material-symbols-outlined">close</span>
            </button>
          </div>

          {/* Messages */}
          <div ref={scrollRef} className="flex-1 overflow-y-auto px-5 py-5 space-y-4 bg-surface-container-lowest">
            {!session ? (
              <p className="text-body-md text-on-surface-variant">Please sign in to use the assistant.</p>
            ) : messages.length === 0 ? (
              <div>
                <p className="text-body-md text-on-surface mb-4">
                  Ask about your grant portfolio — deadlines, reporting duties, overdue items, and overall health.
                </p>
                <div className="flex flex-col gap-2">
                  {SUGGESTIONS.map((s) => (
                    <button
                      key={s}
                      onClick={() => send(s, true)}
                      className="text-left text-[15px] leading-snug text-primary bg-surface-container-high inkwell-border notched-card px-4 py-3 hover:bg-surface-container transition-colors"
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              messages.map((m, i) => {
                if (m.role === 'assistant') {
                  return (
                    <div key={i} className="flex justify-start">
                      <div className="bg-surface-container-high inkwell-border notched-card px-4 py-3 max-w-[88%] text-body-md text-on-surface">
                        {m.pending ? (
                          <span role="status" className="inline-flex items-center gap-2 text-on-surface-variant">
                            <span className="inline-flex gap-1" aria-hidden="true">
                              <span className="w-2 h-2 rounded-full bg-primary animate-bounce [animation-delay:-0.3s]" />
                              <span className="w-2 h-2 rounded-full bg-primary animate-bounce [animation-delay:-0.15s]" />
                              <span className="w-2 h-2 rounded-full bg-primary animate-bounce" />
                            </span>
                            GrantGuard is thinking…
                          </span>
                        ) : m.error ? (
                          <p role="alert" className="text-alert-crimson">{m.error}</p>
                        ) : (
                          <Markdown text={m.content} />
                        )}
                      </div>
                    </div>
                  )
                }
                return (
                  <div key={i} className="flex justify-end">
                    <div className="bg-primary text-on-primary px-4 py-3 max-w-[88%] text-body-md notched-br">
                      {m.content}
                    </div>
                  </div>
                )
              })
            )}
          </div>

          {/* Composer */}
          <div className="px-5 py-4 inkwell-border-t bg-surface-container-lowest">
            <form
              onSubmit={(e) => {
                e.preventDefault()
                send()
              }}
              className="flex items-end gap-2 inkwell-border bg-surface-container-lowest focus-within:border-primary focus-within:ring-1 focus-within:ring-primary pl-3 pr-1.5 py-1.5 transition-colors"
            >
              <label htmlFor="chat-input" className="sr-only">
                Ask about your grants
              </label>
              <textarea
                id="chat-input"
                ref={inputRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                rows={2}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault()
                    send()
                  }
                }}
                // The surrounding box shows focus; the global :focus-visible outline would double it
                style={{ outline: 'none' }}
                placeholder="Ask about your grants…"
                className="flex-1 resize-none bg-transparent border-0 py-1.5 text-[16px] leading-snug text-on-surface placeholder:text-on-surface-variant/70"
              />
              <button
                type="submit"
                disabled={sending || !input.trim()}
                className="shrink-0 h-10 px-3 bg-primary text-on-primary flex items-center gap-1.5 font-label-caps text-label-caps uppercase tracking-wider hover:bg-surface-tint transition-colors disabled:opacity-40 notched-br"
              >
                {sending ? 'Sending…' : 'Send'}
                <span className="material-symbols-outlined filled-icon text-[18px]">send</span>
              </button>
            </form>
            <div className="flex items-center justify-between gap-2 mt-1.5">
              <p className="text-[13px] text-secondary">Enter sends · Shift+Enter: new line</p>
              <button
                onClick={clearChat}
                className="shrink-0 whitespace-nowrap font-label-caps text-[12px] text-secondary uppercase hover:text-primary transition-colors"
              >
                Clear conversation
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
