import { MODEL } from './supabaseAdmin.js'

const SYSTEM_PROMPT = `You are a grant compliance analyst. Given the full text of a grant agreement, extract ALL obligations the recipient must fulfill. Return ONLY valid JSON — no markdown, no explanation, no code fences.

Return a JSON array of obligation objects. Each obligation must have exactly these fields:
- type: one of "deadline", "reporting", "eligible_activity", "compliance_condition"
- description: a clear, concise summary of the obligation (1-2 sentences)
- due_date: the specific date if mentioned (ISO 8601 format, e.g. "2026-03-15"), or null if no specific date
- source_page: the page number where this obligation appears (integer), or null if unknown
- source_excerpt: the exact original clause/sentence from the document this obligation was extracted from (verbatim, not summarized)
- confidence: "high" if the obligation is unambiguous and clearly stated, "low" if it is implicit, vague, or you are uncertain

Rules:
1. Extract EVERY obligation — deadlines, reporting duties, eligible activities, compliance conditions.
2. Do not skip obligations that seem minor or repetitive.
3. source_excerpt must be the EXACT text from the document, not a paraphrase.
4. If a single clause contains multiple obligations, split them into separate entries.
5. Return ONLY the JSON array, nothing else.`

const MAX_RETRIES = 3
const INITIAL_BACKOFF_MS = 1000

function stripCodeFences(text) {
  let cleaned = text.trim()
  cleaned = cleaned.replace(/^```(?:json)?\s*\n?/i, '')
  cleaned = cleaned.replace(/\n?\s*```\s*$/i, '')
  return cleaned.trim()
}

function parseObligations(raw) {
  const cleaned = stripCodeFences(raw)
  const parsed = JSON.parse(cleaned)

  if (!Array.isArray(parsed)) {
    throw new Error('LLM response is not an array')
  }

  return parsed.map((o, i) => {
    if (!o.type || !o.description) {
      throw new Error(`Obligation at index ${i} missing required fields (type, description)`)
    }
    const validTypes = ['deadline', 'reporting', 'eligible_activity', 'compliance_condition']
    if (!validTypes.includes(o.type)) {
      throw new Error(`Obligation at index ${i} has invalid type "${o.type}"`)
    }
    return {
      type: o.type,
      description: o.description,
      due_date: o.due_date || null,
      source_page: o.source_page ?? null,
      source_excerpt: o.source_excerpt || '',
      confidence: o.confidence === 'low' ? 'low' : 'high',
    }
  })
}

async function callOpenRouter(text) {
  const body = {
    model: MODEL,
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: `Extract all obligations from this grant agreement:\n\n${text}` },
    ],
    temperature: 0.1,
    max_tokens: 4096,
  }

  const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': 'https://grantguard.ai',
      'X-Title': 'GrantGuard AI',
    },
    body: JSON.stringify(body),
  })

  if (res.status === 429 || res.status >= 500) {
    const err = new Error(`OpenRouter returned ${res.status}`)
    err.retryable = true
    err.status = res.status
    throw err
  }

  if (!res.ok) {
    const errBody = await res.text()
    throw new Error(`OpenRouter error ${res.status}: ${errBody.slice(0, 300)}`)
  }

  const data = await res.json()
  const content = data.choices?.[0]?.message?.content
  if (!content) {
    throw new Error('OpenRouter returned empty content')
  }
  return content
}

export async function extractObligations(text) {
  let lastError = null
  let backoff = INITIAL_BACKOFF_MS

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const raw = await callOpenRouter(text)
      const obligations = parseObligations(raw)
      return obligations
    } catch (err) {
      lastError = err
      if (err.retryable && attempt < MAX_RETRIES) {
        console.log(`OpenRouter retry ${attempt}/${MAX_RETRIES} (status ${err.status}), waiting ${backoff}ms`)
        await new Promise((r) => setTimeout(r, backoff))
        backoff *= 2
        continue
      }
      break
    }
  }

  throw lastError
}
