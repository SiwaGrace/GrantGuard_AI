const OPENROUTER_API_URL = 'https://openrouter.ai/api/v1/chat/completions'

const SYSTEM_PROMPT = `You are a grant compliance analyst. Given the text of a grant agreement, extract ALL obligations the grantee must fulfil. Return ONLY valid JSON — no markdown, no explanation, no code fences.

Return a JSON array of obligation objects. Each obligation must have exactly these fields:
- type: one of "deadline", "reporting", "eligible_activity", "compliance_condition"
- description: a clear, concise summary of the obligation (1-2 sentences)
- due_date: the due date in ISO 8601 format (YYYY-MM-DD) if mentioned, otherwise null
- source_page: the page number where this obligation appears (use 1 if unknown)
- source_excerpt: the exact clause or sentence from the source text this obligation was extracted from (copy verbatim)
- confidence: "high" if the obligation is clearly stated, "low" if ambiguous or implied

Rules:
1. Extract EVERY obligation — do not summarize or merge distinct requirements.
2. Deadlines: any date-specific deliverable, milestone, or submission deadline.
3. Reporting: any duty to submit reports, updates, audits, or financial statements.
4. Eligible activities: any restriction on what funds may/may not be used for.
5. Compliance conditions: any regulatory, legal, procurement, or policy requirements.
6. If the text contains no obligations at all, return an empty array [].
7. Do NOT invent obligations not present in the text.`

export async function extractObligations(text, { retries = 3 } = {}) {
  const model = process.env.MODEL || 'openai/gpt-4o-mini'
  const apiKey = process.env.OPENROUTER_API_KEY

  if (!apiKey) {
    throw new Error('OPENROUTER_API_KEY is not set')
  }

  let lastError = null

  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const res = await fetch(OPENROUTER_API_URL, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': 'https://grantguard.ai',
          'X-Title': 'GrantGuard AI',
        },
        body: JSON.stringify({
          model,
          messages: [
            { role: 'system', content: SYSTEM_PROMPT },
            { role: 'user', content: `Extract obligations from this grant agreement text:\n\n${text}` },
          ],
          temperature: 0.1,
          max_tokens: 4096,
        }),
      })

      if (res.status === 429 || res.status >= 500) {
        const body = await res.text().catch(() => '')
        lastError = new Error(`OpenRouter ${res.status}: ${body.slice(0, 200)}`)
        if (attempt < retries) {
          const delay = Math.min(1000 * 2 ** (attempt - 1), 10000)
          console.warn(`OpenRouter ${res.status}, retrying in ${delay}ms (attempt ${attempt}/${retries})`)
          await new Promise((r) => setTimeout(r, delay))
          continue
        }
        throw lastError
      }

      if (!res.ok) {
        const body = await res.text().catch(() => '')
        throw new Error(`OpenRouter ${res.status}: ${body.slice(0, 300)}`)
      }

      const data = await res.json()
      const raw = data.choices?.[0]?.message?.content

      if (!raw) {
        throw new Error('OpenRouter returned empty content')
      }

      return parseObligations(raw)
    } catch (err) {
      lastError = err
      if (attempt < retries && isRetryable(err)) {
        const delay = Math.min(1000 * 2 ** (attempt - 1), 10000)
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
  return /429|500|502|503|504|timeout|ECONNREFUSED|network/i.test(msg)
}

function parseObligations(raw) {
  let cleaned = raw.trim()

  // Strip markdown code fences
  cleaned = cleaned.replace(/^```(?:json)?\s*\n?/i, '').replace(/\n?```\s*$/i, '')

  // Try to extract JSON array if surrounded by extra text
  const arrayMatch = cleaned.match(/\[[\s\S]*\]/)
  if (arrayMatch) {
    cleaned = arrayMatch[0]
  }

  let parsed
  try {
    parsed = JSON.parse(cleaned)
  } catch {
    throw new Error(`Failed to parse LLM output as JSON. Raw output:\n${raw.slice(0, 500)}`)
  }

  if (!Array.isArray(parsed)) {
    throw new Error(`Expected JSON array from LLM, got ${typeof parsed}`)
  }

  const validTypes = ['deadline', 'reporting', 'eligible_activity', 'compliance_condition']
  const validConfidence = ['high', 'low']

  return parsed.map((item, i) => ({
    type: validTypes.includes(item.type) ? item.type : 'compliance_condition',
    description: typeof item.description === 'string' ? item.description.trim() : `Obligation ${i + 1}`,
    due_date: item.due_date || null,
    source_page: typeof item.source_page === 'number' ? item.source_page : 1,
    source_excerpt: typeof item.source_excerpt === 'string' ? item.source_excerpt.trim() : '',
    confidence: validConfidence.includes(item.confidence) ? item.confidence : 'low',
  }))
}
