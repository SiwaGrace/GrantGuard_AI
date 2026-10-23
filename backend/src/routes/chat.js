import { safeRouter } from '../lib/safeRouter.js'
import { supabaseAdmin } from '../lib/supabaseAdmin.js'
import { requireAuth } from '../middleware/auth.js'

const GROQ_API_URL = 'https://api.groq.com/openai/v1/chat/completions'

const SYSTEM_PROMPT = `You are GrantGuard, a grant compliance assistant. You help a nonprofit/grantee organisation manage their grant portfolio.

You are given a structured snapshot of the user's grants and their compliance obligations (deadlines, reporting duties, eligible activities, compliance conditions). Today is represented by CURRENT_DATE.

Answer the user's question using ONLY the data in this snapshot. Be precise and concrete. If the data cannot answer the question, say so clearly instead of guessing.

Guidelines:
- Count and arithmetic must be computed exactly from the snapshot. State numbers plainly, e.g. "3 grants" and list them if helpful.
- For deadline questions, compare dates using CURRENT_DATE. "Tomorrow" = CURRENT_DATE + 1 day. "This week" = 7 days from CURRENT_DATE. "Overdue" = due_date < CURRENT_DATE and not completed (each obligation has an "overdue" flag). "completed" means the grantee marked it done; "review_status" only says whether the AI extraction was checked, not whether the work is done.
- Reference obligations by their grant name, type, and due date.
- Use "you have N grants", not "we".
- If a question is not about compliance/grants, gently steer back.

Format the answer as short, readable markdown (bullet lists are fine). No JSON.`

function buildSnapshot(grants, obligationsByGrant) {
  const today = new Date().toISOString().slice(0, 10)
  const grantsWithCounts = grants.map((g) => {
    const obs = obligationsByGrant.get(g.id) || []
    return {
      id: g.id,
      name: g.name,
      funder: g.funder_name || null,
      uploaded: g.created_at ? g.created_at.slice(0, 10) : null,
      obligations: obs.map((o) => ({
        type: o.type,
        description: o.description,
        due_date: o.due_date || null,
        review_status: o.status || null,
        completed: Boolean(o.completed_at),
        overdue: Boolean(o.due_date && !o.completed_at && o.due_date < today),
        verified: o.verified ?? false,
        confidence: o.confidence || null,
        source_page: o.source_page || null,
      })),
    }
  })
  // Compact JSON: the free Groq tier allows ~8k tokens per minute
  return JSON.stringify({ current_date: today, grants: grantsWithCounts })
}

const MAX_HISTORY_MESSAGES = 12
const GROQ_TIMEOUT_MS = 55000

function buildChatRequestBody(snapshot, question, history) {
  const model = process.env.CHAT_MODEL || process.env.MODEL || 'openai/gpt-oss-120b'
  const messages = [{ role: 'system', content: SYSTEM_PROMPT }]

  // Only well-formed, non-empty turns (a failed answer is stored as an empty
  // assistant message), and only the most recent ones
  const turns = (Array.isArray(history) ? history : []).filter(
    (h) =>
      (h?.role === 'user' || h?.role === 'assistant') &&
      typeof h.content === 'string' &&
      h.content.trim(),
  )
  for (const h of turns.slice(-MAX_HISTORY_MESSAGES)) {
    messages.push({ role: h.role, content: h.content.slice(0, 4000) })
  }

  messages.push({
    role: 'user',
    content: `Here is the current state of your grant portfolio:\n\n${snapshot}\n\nQuestion: ${question}`,
  })

  const body = {
    model,
    messages,
    temperature: 0.2,
    max_tokens: 2048,
  }
  // gpt-oss spends output tokens on hidden reasoning; keep it short so the
  // visible answer isn't cut off or empty
  if (model.startsWith('openai/gpt-oss')) {
    body.reasoning_effort = 'low'
  }
  return body
}

function friendlyAiError(status, detail) {
  if (status === 429) return 'The AI service is busy right now (rate limit). Please wait a minute and try again.'
  if (status === 401 || status === 403) return 'The AI service rejected the API key. Check GROQ_API_KEY in backend/.env.'
  if (status === 413) return 'Your portfolio is too large to send to the AI in one question.'
  return `The AI service returned an error (${status})${detail ? `: ${detail}` : ''}.`
}

const router = safeRouter()

router.post('/chat', requireAuth, async (req, res) => {
  const userId = req.user.id
  const { message, history = [] } = req.body || {}

  if (!message || typeof message !== 'string' || !message.trim()) {
    return res.status(400).json({ error: 'Message is required' })
  }
  if (message.length > 4000) {
    return res.status(400).json({ error: 'Message is too long' })
  }

  const apiKey = process.env.GROQ_API_KEY
  if (!apiKey) {
    return res.status(500).json({ error: 'GROQ_API_KEY is not set' })
  }

  try {
    const { data: grants, error: grantErr } = await supabaseAdmin
      .from('grants')
      .select('id, name, funder_name, created_at')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })

    if (grantErr) throw new Error(`Could not load grants: ${grantErr.message}`)

    const { data: obligations, error: obErr } = await supabaseAdmin
      .from('obligations')
      .select('*')
      .in('grant_id', (grants || []).map((g) => g.id))

    if (obErr) throw new Error(`Could not load obligations: ${obErr.message}`)

    const byGrant = new Map()
    for (const o of obligations || []) {
      if (!byGrant.has(o.grant_id)) byGrant.set(o.grant_id, [])
      byGrant.get(o.grant_id).push(o)
    }

    const snapshot = buildSnapshot(grants || [], byGrant)
    const body = buildChatRequestBody(snapshot, message.trim(), history)

    const callGroq = () =>
      fetch(GROQ_API_URL, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(GROQ_TIMEOUT_MS),
      })

    let resLLM
    try {
      resLLM = await callGroq()
      // Free-tier per-minute limits reset quickly: wait as Groq asks (max 8s) and retry once
      if (resLLM.status === 429) {
        const waitSeconds = Math.min(Number(resLLM.headers.get('retry-after')) || 3, 8)
        console.warn(`[chat] Groq 429, retrying in ${waitSeconds}s`)
        await new Promise((r) => setTimeout(r, waitSeconds * 1000))
        resLLM = await callGroq()
      }
    } catch (err) {
      const timedOut = err.name === 'TimeoutError' || err.name === 'AbortError'
      console.error('[chat] Groq request failed:', err.message)
      return res.status(504).json({
        error: timedOut
          ? 'The AI took too long to answer. Please try again.'
          : 'Could not reach the AI service. Check your internet connection and try again.',
      })
    }

    const payload = await resLLM.json().catch(() => null)

    if (!resLLM.ok) {
      const detail = payload?.error?.message || ''
      console.error(`[chat] Groq ${resLLM.status}: ${detail.slice(0, 300)}`)
      return res.status(502).json({ error: friendlyAiError(resLLM.status, detail.slice(0, 200)) })
    }

    const choice = payload?.choices?.[0]
    const answer = choice?.message?.content?.trim()
    if (!answer) {
      console.error(`[chat] Empty answer (finish_reason=${choice?.finish_reason})`)
      return res.status(502).json({ error: 'The AI didn’t return an answer. Please try rephrasing your question.' })
    }

    res.json({ answer })
  } catch (err) {
    console.error('[chat] Error:', err.message)
    res.status(500).json({ error: 'Something went wrong while answering. Please try again.' })
  }
})

export default router
