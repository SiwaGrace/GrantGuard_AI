const GROQ_API_URL = 'https://api.groq.com/openai/v1/chat/completions'

// ~4 characters per token, so the default keeps a request around 10k input
// tokens. Raise it if your Groq plan allows larger requests.
const DEFAULT_MAX_EXTRACT_CHARS = 40000

const SYSTEM_PROMPT = `You are a grant compliance analyst. Given the text of a grant agreement, extract ALL obligations the grantee must fulfil. Return ONLY valid JSON — no markdown, no explanation, no code fences.

The text is split into pages. Each page starts with a marker line of the form "--- Page N ---".

Return a JSON object of the form {"grant_number": ..., "funder_name": ..., "obligations": [ ... ]}:
- grant_number: the agreement's own grant / agreement / award / reference number exactly as written (e.g. "GD-2026-WASH-0417"), or null if the document doesn't state one. Never invent one.
- funder_name: the name of the funding organisation (the funder/donor/grantor), or null if unclear.
- obligations: an array where each obligation has exactly these fields:
- type: one of "deadline", "reporting", "eligible_activity", "compliance_condition"
- description: a clear, concise summary of the obligation (1-2 sentences)
- due_date: the due date in ISO 8601 format (YYYY-MM-DD) if a specific date is stated, otherwise null
- source_page: the number N from the nearest "--- Page N ---" marker ABOVE the clause (integer)
- source_excerpt: the exact clause or sentence from the source text this obligation was extracted from (copy verbatim, without the page marker)
- confidence: "high" if the obligation is clearly stated, "low" if ambiguous or implied

Rules:
1. Extract EVERY obligation — do not summarize or merge distinct requirements.
2. Deadlines: any date-specific deliverable, milestone, or submission deadline.
3. Reporting: any duty to submit reports, updates, audits, or financial statements.
4. Eligible activities: any restriction on what funds may/may not be used for.
5. Compliance conditions: any regulatory, legal, procurement, or policy requirements.
6. If the text contains no obligations at all, return an empty "obligations" array.
7. Do NOT invent obligations not present in the text.`

function maxExtractChars() {
  const fromEnv = Number(process.env.MAX_EXTRACT_CHARS)
  return Number.isFinite(fromEnv) && fromEnv > 0 ? fromEnv : DEFAULT_MAX_EXTRACT_CHARS
}

// Join page texts with "--- Page N ---" markers, stopping at a page boundary
// once the character cap is reached.
export function buildPagedText(pageTexts) {
  const cap = maxExtractChars()
  let text = ''
  let pagesIncluded = 0

  for (let i = 0; i < pageTexts.length; i++) {
    const block = `--- Page ${i + 1} ---\n${pageTexts[i].trim()}\n\n`
    if (text.length + block.length > cap) {
      // A single oversized first page is cut rather than dropped
      if (pagesIncluded === 0) {
        text = block.slice(0, cap)
        pagesIncluded = 1
      }
      break
    }
    text += block
    pagesIncluded++
  }

  return {
    text: text.trim(),
    pagesIncluded,
    truncated: pagesIncluded < pageTexts.length || text.length >= cap,
  }
}

function isGptOss(model) {
  return model.startsWith('openai/gpt-oss')
}

export async function extractObligations(text, { pageCount = null, retries = 3 } = {}) {
  const model = process.env.MODEL || 'openai/gpt-oss-120b'
  const apiKey = process.env.GROQ_API_KEY

  if (!apiKey) {
    throw new Error('GROQ_API_KEY is not set')
  }

  const body = {
    model,
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: `Extract obligations from this grant agreement text:\n\n${text}` },
    ],
    temperature: 0.1,
    max_tokens: 8192,
    response_format: { type: 'json_object' },
  }
  // gpt-oss models spend output tokens on reasoning; keep that short so the
  // JSON answer isn't cut off by max_tokens.
  if (isGptOss(model)) {
    body.reasoning_effort = 'low'
  }

  let lastError = null

  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const res = await fetch(GROQ_API_URL, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      })

      if (res.status === 413) {
        throw new Error(
          'Document is too large for the AI provider’s request limit. Lower MAX_EXTRACT_CHARS or upload a shorter agreement.',
        )
      }

      if (res.status === 429 || res.status >= 500) {
        const errBody = await res.text().catch(() => '')
        lastError = new Error(`Groq ${res.status}: ${errBody.slice(0, 200)}`)
        if (attempt < retries) {
          const delay = Math.min(2000 * 2 ** (attempt - 1), 10000)
          console.warn(`Groq ${res.status}, retrying in ${delay}ms (attempt ${attempt}/${retries})`)
          await new Promise((r) => setTimeout(r, delay))
          continue
        }
        throw lastError
      }

      if (!res.ok) {
        const errBody = await res.text().catch(() => '')
        throw new Error(`Groq ${res.status}: ${errBody.slice(0, 300)}`)
      }

      const data = await res.json()
      const raw = data.choices?.[0]?.message?.content

      if (!raw) {
        throw new Error('Groq returned empty content')
      }

      return parseExtraction(raw, pageCount)
    } catch (err) {
      lastError = err
      if (attempt < retries && isRetryable(err)) {
        const delay = Math.min(2000 * 2 ** (attempt - 1), 10000)
        console.warn(`Retryable error, retrying in ${delay}ms (attempt ${attempt}/${retries}): ${err.message}`)
        await new Promise((r) => setTimeout(r, delay))
        continue
      }
      throw err
    }
  }

  throw lastError
}

function isRetryable(err) {
  const msg = err.message || ''
  return /429|500|502|503|504|timeout|ECONNREFUSED|ECONNRESET|network|fetch failed/i.test(msg)
}

function parseJson(raw) {
  const cleaned = raw
    .trim()
    .replace(/^```(?:json)?\s*\n?/i, '')
    .replace(/\n?```\s*$/i, '')

  try {
    return JSON.parse(cleaned)
  } catch {
    // Fall back to the outermost {...} or [...] if the model added stray text
    const match = cleaned.match(/\{[\s\S]*\}|\[[\s\S]*\]/)
    if (match) {
      try {
        return JSON.parse(match[0])
      } catch {
        // fall through to the error below
      }
    }
  }
  throw new Error(`Failed to parse LLM output as JSON. Raw output:\n${raw.slice(0, 500)}`)
}

const VALID_TYPES = ['deadline', 'reporting', 'eligible_activity', 'compliance_condition']
const VALID_CONFIDENCE = ['high', 'low']

function normalizeDate(value) {
  if (typeof value !== 'string') return null
  const match = value.trim().match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (!match) return null
  const iso = `${match[1]}-${match[2]}-${match[3]}`
  // Reject impossible dates like 2026-02-31, which Postgres would refuse
  const d = new Date(`${iso}T00:00:00Z`)
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === iso ? iso : null
}

function normalizePage(value, pageCount) {
  const n = typeof value === 'string' ? Number.parseInt(value, 10) : value
  if (!Number.isInteger(n) || n < 1) return null
  if (pageCount && n > pageCount) return null
  return n
}

function cleanText(value, maxLength) {
  if (typeof value !== 'string') return null
  const text = value.trim()
  return text && text.length <= maxLength && !/^(null|n\/a|none|unknown)$/i.test(text) ? text : null
}

// Returns { obligations, grantNumber, funderName } from the model's JSON
export function parseExtraction(raw, pageCount = null) {
  const parsed = parseJson(raw)
  const details = parsed && !Array.isArray(parsed) && typeof parsed === 'object' ? parsed : {}
  return {
    obligations: normalizeObligations(parsed, pageCount),
    grantNumber: cleanText(details.grant_number, 60),
    funderName: cleanText(details.funder_name, 200),
  }
}

export function parseObligations(raw, pageCount = null) {
  return normalizeObligations(parseJson(raw), pageCount)
}

function normalizeObligations(parsed, pageCount) {
  // Expected shape is {"obligations": [...]}; also accept a bare array or an
  // object whose only array property holds the obligations.
  let list = null
  if (Array.isArray(parsed)) {
    list = parsed
  } else if (parsed && typeof parsed === 'object') {
    list = Array.isArray(parsed.obligations)
      ? parsed.obligations
      : Object.values(parsed).find(Array.isArray) || null
  }

  if (!list) {
    throw new Error('LLM response did not contain an obligations array')
  }

  return list
    .filter((item) => item && typeof item === 'object')
    .map((item, i) => ({
      type: VALID_TYPES.includes(item.type) ? item.type : 'compliance_condition',
      description:
        typeof item.description === 'string' && item.description.trim()
          ? item.description.trim()
          : `Obligation ${i + 1}`,
      due_date: normalizeDate(item.due_date),
      source_page: normalizePage(item.source_page, pageCount),
      source_excerpt: typeof item.source_excerpt === 'string' ? item.source_excerpt.trim() : '',
      confidence: VALID_CONFIDENCE.includes(item.confidence) ? item.confidence : 'low',
    }))
}
