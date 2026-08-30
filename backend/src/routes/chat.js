import { Router } from 'express'
import { supabaseAdmin } from '../lib/supabaseAdmin.js'
import { requireAuth } from '../middleware/auth.js'

const OPENROUTER_API_URL = 'https://openrouter.ai/api/v1/chat/completions'

const SYSTEM_PROMPT = `You are GrantGuard, a grant compliance assistant. You help a nonprofit/grantee organisation manage their grant portfolio.

You are given a structured snapshot of the user's grants and their compliance obligations (deadlines, reporting duties, eligible activities, compliance conditions). Today is represented by CURRENT_DATE.

Answer the user's question using ONLY the data in this snapshot. Be precise and concrete. If the data cannot answer the question, say so clearly instead of guessing.

Guidelines:
- Count and arithmetic must be computed exactly from the snapshot. State numbers plainly, e.g. "3 grants" and list them if helpful.
- For deadline questions, compare dates using CURRENT_DATE. "Tomorrow" = CURRENT_DATE + 1 day. "This week" = 7 days from CURRENT_DATE. "Overdue" = due_date < CURRENT_DATE.
- Reference obligations by their grant name, type, and due date.
- Use "you have N grants", not "we".
- If a question is not about compliance/grants, gently steer back.

Format the answer as short, readable markdown (bullet lists are fine). No JSON.`

function buildSnapshot(grants, obligationsByGrant) {
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
        status: o.status || null,
        verified: o.verified ?? false,
        confidence: o.confidence || null,
        source_page: o.source_page || null,
      })),
    }
  })
  return JSON.stringify({ current_date: new Date().toISOString().slice(0, 10), grants: grantsWithCounts }, null, 2)
}

function buildChatRequestBody(snapshot, question, history) {
  const model = process.env.CHAT_MODEL || process.env.MODEL || 'openai/gpt-4o-mini'
  const messages = [{ role: 'system', content: SYSTEM_PROMPT }]

  for (const h of history || []) {
    if (h.role === 'user' || h.role === 'assistant') {
      messages.push({ role: h.role, content: h.content })
    }
  }

  messages.push({
    role: 'user',
    content: `Here is the current state of your grant portfolio:\n\n${snapshot}\n\nQuestion: ${question}`,
  })

  return {
    model,
    messages,
    temperature: 0.2,
    max_tokens: 1024,
  }
}

const router = Router()

router.post('/chat', requireAuth, async (req, res) => {
  const userId = req.user.id
  const { message, history = [] } = req.body || {}

  if (!message || typeof message !== 'string' || !message.trim()) {
    return res.status(400).json({ error: 'Message is required' })
  }
  if (message.length > 4000) {
    return res.status(400).json({ error: 'Message is too long' })
  }

  const apiKey = process.env.OPENROUTER_API_KEY
  if (!apiKey) {
    return res.status(500).json({ error: 'OPENROUTER_API_KEY is not set' })
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
      .select('grant_id, type, description, due_date, status, verified, confidence, source_page')
      .in('grant_id', (grants || []).map((g) => g.id))

    if (obErr) throw new Error(`Could not load obligations: ${obErr.message}`)

    const byGrant = new Map()
    for (const o of obligations || []) {
      if (!byGrant.has(o.grant_id)) byGrant.set(o.grant_id, [])
      byGrant.get(o.grant_id).push(o)
    }

    const snapshot = buildSnapshot(grants || [], byGrant)
    const body = buildChatRequestBody(snapshot, message.trim(), history)

    const resLLM = await fetch(OPENROUTER_API_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://grantguard.ai',
        'X-Title': 'GrantGuard AI',
      },
      body: JSON.stringify(body),
    })

    const payload = await resLLM.json()

    if (!resLLM.ok) {
      const msg = payload?.error?.message || payload?.error || `OpenRouter ${resLLM.status}`
      return res.status(502).json({ error: `AI request failed: ${msg}` })
    }

    const answer = payload.choices?.[0]?.message?.content
    if (!answer) {
      return res.status(502).json({ error: 'AI returned an empty response' })
    }

    res.json({ answer })
  } catch (err) {
    console.error('[chat] Error:', err.message)
    res.status(500).json({ error: err.message || 'Chat failed' })
  }
})

export default router
