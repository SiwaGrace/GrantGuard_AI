import { useEffect, useRef, useState } from 'react'
import toast from 'react-hot-toast'
import { useAuth } from '../context/AuthContext'
import { supabase } from '../lib/supabase'
import API_URL from '../lib/api'

const SUGGESTIONS = [
  'How many grants have a due date this week?',
  'Which obligations are overdue?',
  'List reporting deadlines coming up.',
  'Summarize my portfolio health.',
]

function renderHtml(text) {
  const html = text.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
  return { __html: html }
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
    if (open && inputRef.current) inputRef.current.focus()
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
    const history = initial
      ? []
      : messages.map((m) => ({ role: m.role, content: m.content }))

    setMessages((prev) => [...prev, userMsg])
    setInput('')
    setSending(true)

    const assistantMsg = { role: 'assistant', content: '', pending: true }
    setMessages((prev) => [...prev, assistantMsg])

    try {
      const { data: authData } = await supabase.auth.getSession()
      const token = authData.session?.access_token
      if (!token) throw new Error('Not authenticated')

      const res = await fetch(`${API_URL}/api/chat`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ message: content, history }),
      })

      const payload = await res.json()
      if (!res.ok) throw new Error(payload.error || 'Chat request failed')

      setMessages((prev) => {
        const next = [...prev]
        next[next.length - 1] = { role: 'assistant', content: payload.answer }
        return next
      })
    } catch (err) {
      setMessages((prev) => {
        const next = [...prev]
        next[next.length - 1] = { role: 'assistant', content: '', error: true }
        return next
      })
      toast.error(err.message || 'Could not reach the assistant')
    } finally {
      setSending(false)
    }
  }

  return (
    <>
      {/* Floating launcher */}
      <button
        onClick={() => setOpen((v) => !v)}
        aria-label={open ? 'Close grant assistant' : 'Open grant assistant'}
        className="fixed bottom-6 right-6 z-[100] w-14 h-14 rounded-full bg-primary text-on-primary shadow-xl flex items-center justify-center hover:bg-surface-tint transition-all notched-br"
      >
        <span className="material-symbols-outlined filled-icon text-[24px]">
          {open ? 'close' : 'forum'}
        </span>
      </button>

      {/* Chat panel */}
      {open && (
        <div className="fixed inset-y-0 right-0 z-[90] w-full max-w-md bg-surface-container-lowest border-l border-outline-variant flex flex-col shadow-2xl">
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
                      className="text-left text-body-sm text-primary bg-surface-container-high inkwell-border notched-card px-4 py-3 hover:bg-surface-container transition-colors"
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
                          <span className="inline-flex items-center gap-2 text-on-surface-variant">
                            <span className="w-4 h-4 border-2 border-outline-variant border-t-primary rounded-full animate-spin" />
                            Thinking…
                          </span>
                        ) : m.error ? (
                          <p className="text-alert-crimson">Something went wrong. Please try again.</p>
                        ) : (
                          <div dangerouslySetInnerHTML={renderHtml(m.content)} />
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
              className="flex items-end gap-2"
            >
              <textarea
                ref={inputRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                rows={1}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault()
                    send()
                  }
                }}
                placeholder="Ask about your grants…"
                className="flex-1 resize-none bg-transparent border-0 border-b border-outline focus:border-primary focus:outline-none px-1 py-2 font-source-code text-source-code text-on-surface placeholder:text-on-surface-variant/60"
              />
              <button
                type="submit"
                disabled={sending || !input.trim()}
                aria-label="Send message"
                className="w-11 h-11 shrink-0 rounded bg-primary text-on-primary flex items-center justify-center hover:bg-surface-tint transition-colors disabled:opacity-40 notched-br"
              >
                <span className="material-symbols-outlined filled-icon">arrow_upward</span>
              </button>
            </form>
            <div className="flex justify-end mt-1">
              <button
                onClick={clearChat}
                className="font-label-caps text-[10px] text-secondary uppercase hover:text-primary transition-colors"
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
