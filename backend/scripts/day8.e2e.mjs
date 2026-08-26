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
const email = `day8-e2e-${stamp}@example.com`
const password = `E2e-${stamp}-GrantGuard!`
let userId = null

try {
  console.log(`\n=== GrantGuard Day 8 E2E — ${new Date().toISOString()} ===\n`)

  // health
  const healthRes = await fetch(`${API}/health`)
  check('GET /health returns ok', healthRes.ok && (await healthRes.json()).status === 'ok')

  // create user
  const { data: created, error: createError } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  })
  if (createError) throw new Error(`createUser failed: ${createError.message}`)
  userId = created.user.id
  console.log(`\nTest user: ${email} (${userId})\n`)

  // sign in
  const anon = createClient(SUPABASE_URL, ANON_KEY, { realtime: { transport: ws } })
  const { data: sess, error: signInError } = await anon.auth.signInWithPassword({ email, password })
  if (signInError) throw new Error(`signIn failed: ${signInError.message}`)
  const token = sess.session.access_token
  const headers = { Authorization: `Bearer ${token}` }

  // create an authenticated frontend-style supabase client (uses anon key + user JWT)
  const frontendClient = createClient(SUPABASE_URL, ANON_KEY, {
    realtime: { transport: ws },
    global: {
      headers: { Authorization: `Bearer ${token}` },
    },
  })

  // ── Empty state test ──────────────────────────────────────────
  console.log('--- Empty state (no grants yet) ---\n')

  const emptyGrants = await frontendClient.from('grants').select('*')
  check('frontend query returns empty grants list', emptyGrants.data?.length === 0, `count=${emptyGrants.data?.length ?? 'error'}`)
  check('frontend query no error on empty', !emptyGrants.error, emptyGrants.error?.message || 'ok')

  const emptyObligations = await frontendClient.from('obligations').select('*')
  check('frontend query returns empty obligations list', emptyObligations.data?.length === 0)
  check('frontend obligations no error', !emptyObligations.error)

  // ── Upload grant ──────────────────────────────────────────────
  console.log('\n--- Upload grant + extract ---\n')

  const pdfPath = '../pdf/Sample_Grant_1_GlobalDev_WASH.pdf'
  const pdfBytes = await readFile(pdfPath)
  const form = new FormData()
  form.append('name', 'WASH Access Programme 2026')
  form.append('funder_name', 'GlobalDev Foundation')
  form.append('file', new Blob([pdfBytes], { type: 'application/pdf' }), 'test.pdf')

  console.log('  Uploading (~10-30s for LLM)...')
  const upRes = await fetch(`${API}/api/grants`, { method: 'POST', headers, body: form })
  const upBody = await upRes.json()
  check('upload -> 201', upRes.status === 201)
  const grantId = upBody.grant?.id
  check('grant id exists', typeof grantId === 'string')
  check('obligations extracted', upBody.obligations?.length > 0, `count=${upBody.obligations?.length}`)

  // ── Dashboard data after upload ───────────────────────────────
  console.log('\n--- Dashboard data (pre-confirm) ---\n')

  const { data: dashGrants, error: gErr } = await frontendClient
    .from('grants')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })

  check('frontend query returns 1 grant', dashGrants?.length === 1, `count=${dashGrants?.length}`)
  check('grant query no error', !gErr, gErr?.message || 'ok')
  check('grant name matches', dashGrants?.[0]?.name === 'WASH Access Programme 2026')

  const { data: dashObs, error: oErr } = await frontendClient
    .from('obligations')
    .select('*')
    .eq('grant_id', grantId)

  check('frontend query returns obligations', dashObs?.length > 0, `count=${dashObs?.length}`)
  check('obligations query no error', !oErr, oErr?.message || 'ok')

  // Check doc status
  const { data: dashDocs } = await frontendClient
    .from('documents')
    .select('*')
    .eq('grant_id', grantId)

  check('document exists for grant', dashDocs?.length === 1)
  check('extraction status is extracted', dashDocs?.[0]?.extraction_status === 'extracted')

  // Compute stats (simulating dashboard logic)
  const pendingCount = dashObs?.filter((o) => o.status === 'pending_review').length || 0
  const lowConfCount = dashObs?.filter((o) => o.confidence === 'low').length || 0
  const now = new Date()
  const thirtyDays = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000)
  const dueSoonCount = dashObs?.filter((o) => {
    if (!o.due_date || o.status === 'confirmed') return false
    const d = new Date(o.due_date)
    return d >= now && d <= thirtyDays
  }).length || 0

  check('pending count > 0 before confirm', pendingCount > 0, `pending=${pendingCount}`)
  check('total obligations tracked', dashObs?.length === upBody.obligations?.length)

  console.log(`\n  Stats: total=${dashGrants?.length} obligations=${dashObs?.length} dueSoon=${dueSoonCount} lowConf=${lowConfCount}`)

  // Status badge logic
  const docStatus = dashDocs?.[0]?.extraction_status
  let badge = 'on track'
  if (docStatus === 'pending') badge = 'processing'
  else if (docStatus === 'failed') badge = 'failed'
  else if (pendingCount > 0) badge = 'needs review'
  check('status badge is "needs review" (pre-confirm)', badge === 'needs review', `badge=${badge}`)

  // ── Confirm obligations ───────────────────────────────────────
  console.log('\n--- Confirm obligations ---\n')

  const confirmRes = await fetch(`${API}/api/grants/${grantId}/obligations/confirm`, {
    method: 'POST',
    headers,
  })
  const confirmBody = await confirmRes.json()
  check('confirm -> 200', confirmRes.status === 200)
  check('all confirmed', confirmBody.confirmed === upBody.obligations?.length)

  // ── Dashboard data after confirm ──────────────────────────────
  console.log('\n--- Dashboard data (post-confirm) ---\n')

  const { data: afterObs } = await frontendClient
    .from('obligations')
    .select('*')
    .eq('grant_id', grantId)

  const afterPending = afterObs?.filter((o) => o.status === 'pending_review').length || 0
  check('no pending after confirm', afterPending === 0, `pending=${afterPending}`)
  check('all confirmed in DB', afterObs?.every((o) => o.status === 'confirmed'))

  const afterBadge = afterPending > 0 ? 'needs review' : 'on track'
  check('status badge is "on track" (post-confirm)', afterBadge === 'on track', `badge=${afterBadge}`)

  // ── RLS: other user sees nothing ──────────────────────────────
  console.log('\n--- RLS test (other user) ---\n')

  const email2 = `day8-other-${stamp}@example.com`
  const { data: otherUser } = await admin.auth.admin.createUser({
    email: email2,
    password: `Other-${stamp}-Pass!`,
    email_confirm: true,
  })
  const otherAnon = createClient(SUPABASE_URL, ANON_KEY, { realtime: { transport: ws } })
  const { data: otherSess } = await otherAnon.auth.signInWithPassword({
    email: email2,
    password: `Other-${stamp}-Pass!`,
  })
  const otherClient = createClient(SUPABASE_URL, ANON_KEY, {
    realtime: { transport: ws },
    global: {
      headers: { Authorization: `Bearer ${otherSess.session.access_token}` },
    },
  })

  const otherGrants = await otherClient.from('grants').select('*')
  check('other user sees 0 grants', otherGrants.data?.length === 0, `count=${otherGrants.data?.length}`)

  const otherObs = await otherClient.from('obligations').select('*')
  check('other user sees 0 obligations', otherObs.data?.length === 0)

  await admin.auth.admin.deleteUser(otherUser.user.id)

  console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} OF ${totalChecks} CHECKS FAILED`)
  console.log(`Total: ${totalChecks}\n`)
} catch (err) {
  failures += 1
  console.error('\nE2E ABORTED:', err.message)
} finally {
  if (userId) {
    const toRemove = []
    const { data: topLevel } = await admin.storage.from(BUCKET).list(userId)
    for (const entry of topLevel ?? []) {
      if (entry.id === null) {
        const { data: nested } = await admin.storage.from(BUCKET).list(`${userId}/${entry.name}`)
        for (const file of nested ?? []) toRemove.push(`${userId}/${entry.name}/${file.name}`)
      } else {
        toRemove.push(`${userId}/${entry.name}`)
      }
    }
    if (toRemove.length) await admin.storage.from(BUCKET).remove(toRemove)
    await admin.from('grants').delete().eq('user_id', userId)
    await admin.auth.admin.deleteUser(userId)
    console.log(`cleanup done (user ${email} removed, ${toRemove.length} storage object(s) deleted)`)
  }
}
process.exit(failures === 0 ? 0 : 1)
