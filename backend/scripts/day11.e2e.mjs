import 'dotenv/config'
import { readFile } from 'node:fs/promises'
import { createClient } from '@supabase/supabase-js'
import ws from 'ws'

const SUPABASE_URL = process.env.SUPABASE_URL
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
const ANON_KEY = process.env.SUPABASE_ANON_KEY || SERVICE_KEY
const API = process.env.E2E_API_URL || 'http://localhost:4000'
const BUCKET = 'grant-documents'

let failures = 0
let totalChecks = 0
function check(label, condition, detail = '') {
  totalChecks++
  const ok = Boolean(condition)
  if (!ok) failures += 1
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`)
  return ok
}

const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
  realtime: { transport: ws },
})

const stamp = Date.now()
const email = `day11-e2e-${stamp}@example.com`
const password = `E2e-${stamp}-GrantGuard!`
let userId = null

try {
  console.log(`\n=== GrantGuard Day 11 E2E — ${new Date().toISOString()} ===\n`)

  const healthRes = await fetch(`${API}/health`)
  check('GET /health returns ok', healthRes.ok)

  const { data: created, error: ce } = await admin.auth.admin.createUser({ email, password, email_confirm: true })
  if (ce) throw new Error(ce.message)
  userId = created.user.id
  console.log(`Test user: ${email} (${userId})\n`)

  const anon = createClient(SUPABASE_URL, ANON_KEY, { realtime: { transport: ws } })
  const { data: sess, error: se } = await anon.auth.signInWithPassword({ email, password })
  if (se) throw new Error(se.message)
  const token = sess.session.access_token
  const headers = { Authorization: `Bearer ${token}` }

  const frontendClient = createClient(SUPABASE_URL, ANON_KEY, {
    realtime: { transport: ws },
    global: { headers: { Authorization: `Bearer ${token}` } },
  })

  const pdfBytes = await readFile('../pdf/Sample_Grant_2_BrightPath_YouthSkills.pdf')
  const form = new FormData()
  form.append('name', 'BrightPath Youth Skills')
  form.append('funder_name', 'Community Foundation')
  form.append('file', new Blob([pdfBytes], { type: 'application/pdf' }), 'brightpath.pdf')

  console.log('  Uploading (~10-30s)...')
  const upRes = await fetch(`${API}/api/grants`, { method: 'POST', headers, body: form })
  const upBody = await upRes.json()
  check('upload -> 201', upRes.status === 201)
  const grantId = upBody.grant?.id
  const obligations = upBody.obligations || []
  check('obligations extracted', obligations.length > 0, `count=${obligations.length}`)

  // ── Evidence in review screen obligations ──────────────────────
  console.log('\n--- Review screen evidence ---\n')

  const { data: allObs } = await frontendClient
    .from('obligations')
    .select('*')
    .eq('grant_id', grantId)

  const withExcerpt = allObs?.filter((o) => o.source_excerpt) || []
  const withPage = allObs?.filter((o) => o.source_page) || []

  check('all obligations have source_excerpt', withExcerpt.length === allObs.length,
    `excerpted=${withExcerpt.length}, total=${allObs.length}`)
  check('all obligations have source_page', withPage.length === allObs.length,
    `page=${withPage.length}, total=${allObs.length}`)

  // Excerpts are non-empty strings
  check('all excerpts are non-empty', withExcerpt.every((o) =>
    typeof o.source_excerpt === 'string' && o.source_excerpt.trim().length > 0
  ))

  // Page numbers are positive integers
  check('all page numbers are positive integers', withPage.every((o) =>
    Number.isInteger(o.source_page) && o.source_page > 0
  ))

  // ── Evidence in dashboard due-soon section ────────────────────
  console.log('\n--- Dashboard due-soon evidence ---\n')

  // Set one obligation to be due in 5 days
  const targetObs = allObs?.find((o) => o.due_date)
  if (targetObs) {
    const futureDate = new Date()
    futureDate.setDate(futureDate.getDate() + 5)
    const dateStr = futureDate.toISOString().split('T')[0]

    await fetch(`${API}/api/grants/${grantId}/obligations/${targetObs.id}`, {
      method: 'PATCH',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ due_date: dateStr }),
    })

    // Fetch again to get updated data
    const { data: updatedObs } = await frontendClient
      .from('obligations')
      .select('*')
      .eq('grant_id', grantId)

    const dueSoon = updatedObs?.filter((o) => {
      if (!o.due_date) return false
      const diff = Math.ceil((new Date(o.due_date) - new Date()) / 86400000)
      return diff >= 0 && diff <= 14
    }) || []

    check('due-soon items found', dueSoon.length > 0, `count=${dueSoon.length}`)
    check('due-soon items have source_excerpt', dueSoon.every((o) =>
      typeof o.source_excerpt === 'string' && o.source_excerpt.trim().length > 0
    ))
    check('due-soon items have source_page', dueSoon.every((o) =>
      Number.isInteger(o.source_page) && o.source_page > 0
    ))
  } else {
    console.log('  SKIP — no obligation with due_date found')
  }

  // ── Evidence in dashboard flags section ────────────────────────
  console.log('\n--- Dashboard flags evidence ---\n')

  const { data: flagObs } = await frontendClient
    .from('obligations')
    .select('*')
    .eq('grant_id', grantId)
    .eq('confidence', 'low')
    .eq('verified', false)

  if (flagObs && flagObs.length > 0) {
    check('flag items have source_excerpt', flagObs.every((o) =>
      typeof o.source_excerpt === 'string' && o.source_excerpt.trim().length > 0
    ))
    check('flag items have source_page', flagObs.every((o) =>
      Number.isInteger(o.source_page) && o.source_page > 0
    ))
    check('flag excerpt is non-trivial length', flagObs.every((o) =>
      o.source_excerpt.length >= 20
    ), `min length=${Math.min(...flagObs.map((o) => o.source_excerpt.length))}`)
  } else {
    console.log('  SKIP — no unverified low-confidence obligations found')
  }

  // ── Excerpt quality check ─────────────────────────────────────
  console.log('\n--- Excerpt quality ---\n')

  const excerptLengths = allObs?.map((o) => o.source_excerpt?.length || 0) || []
  const avgLength = excerptLengths.reduce((a, b) => a + b, 0) / excerptLengths.length
  const minLength = Math.min(...excerptLengths)
  const maxLength = Math.max(...excerptLengths)

  console.log(`  Excerpt lengths: min=${minLength}, avg=${Math.round(avgLength)}, max=${maxLength}`)
  check('average excerpt length >= 30 chars', avgLength >= 30, `avg=${Math.round(avgLength)}`)
  check('no excerpt shorter than 10 chars', minLength >= 10, `min=${minLength}`)

  // Each excerpt should contain actual words (not just numbers/symbols)
  const hasWords = allObs?.every((o) => /[a-zA-Z]{3,}/.test(o.source_excerpt)) || false
  check('all excerpts contain real words', hasWords)

  console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} OF ${totalChecks} CHECKS FAILED`)
  console.log(`Total: ${totalChecks}\n`)
} catch (err) {
  failures += 1
  console.error('\nE2E ABORTED:', err.message)
} finally {
  if (userId) {
    const toRemove = []
    const { data: tl } = await admin.storage.from(BUCKET).list(userId)
    for (const e of tl ?? []) {
      if (e.id === null) {
        const { data: n } = await admin.storage.from(BUCKET).list(`${userId}/${e.name}`)
        for (const f of n ?? []) toRemove.push(`${userId}/${e.name}/${f.name}`)
      } else toRemove.push(`${userId}/${e.name}`)
    }
    if (toRemove.length) await admin.storage.from(BUCKET).remove(toRemove)
    await admin.from('grants').delete().eq('user_id', userId)
    await admin.auth.admin.deleteUser(userId)
    console.log(`cleanup done (${toRemove.length} storage objects)`)
  }
}
process.exit(failures === 0 ? 0 : 1)
