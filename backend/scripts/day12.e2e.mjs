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
const email = `day12-e2e-${stamp}@example.com`
const password = `E2e-${stamp}-GrantGuard!`
let userId = null

try {
  console.log(`\n=== GrantGuard Day 12 E2E — ${new Date().toISOString()} ===\n`)

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

  // ── 1. Empty state: new user with no grants ───────────────────
  console.log('--- Empty state ---\n')

  const { data: emptyGrants } = await frontendClient
    .from('grants')
    .select('*')
    .eq('user_id', userId)

  check('new user has 0 grants', emptyGrants?.length === 0)

  const { data: emptyObs } = await frontendClient
    .from('obligations')
    .select('*')
    .eq('grant_id', '00000000-0000-0000-0000-000000000000')

  check('no obligations for nonexistent grant', emptyObs?.length === 0)

  // ── 2. Upload + loading states ────────────────────────────────
  console.log('\n--- Upload and data loading ---\n')

  const pdfBytes = await readFile('../pdf/Sample_Grant_2_BrightPath_YouthSkills.pdf')
  const form = new FormData()
  form.append('name', 'BrightPath Youth Skills')
  form.append('funder_name', 'Community Foundation')
  form.append('file', new Blob([pdfBytes], { type: 'application/pdf' }), 'brightpath.pdf')

  console.log('  Uploading (~10-30s)...')
  const upRes = await fetch(`${API}/api/grants`, { method: 'POST', headers, body: form })
  const upBody = await upRes.json()
  check('upload returns 201', upRes.status === 201)
  check('upload returns grant data', !!upBody.grant?.id)
  check('upload returns obligations', upBody.obligations?.length > 0)
  const grantId = upBody.grant.id

  // ── 3. Dashboard data loads fully ─────────────────────────────
  console.log('\n--- Dashboard data completeness ---\n')

  const { data: grants } = await frontendClient
    .from('grants')
    .select('*')
    .eq('user_id', userId)

  check('grants loaded', grants?.length === 1)

  const { data: allObs } = await frontendClient
    .from('obligations')
    .select('*')
    .eq('grant_id', grantId)

  check('obligations loaded', allObs?.length > 0, `count=${allObs?.length}`)

  const { data: docs } = await frontendClient
    .from('documents')
    .select('*')
    .eq('grant_id', grantId)

  check('documents loaded', docs?.length === 1)

  // ── 4. Error state: invalid auth token ────────────────────────
  console.log('\n--- Error handling ---\n')

  const badTokenRes = await fetch(`${API}/api/grants/${grantId}/obligations`, {
    headers: { Authorization: 'Bearer invalid-token-12345' },
  })
  check('invalid token returns 401', badTokenRes.status === 401)

  const badTokenBody = await badTokenRes.json()
  check('401 response has error message', !!badTokenBody.error)

  // Bad grant ID
  const badGrantRes = await fetch(`${API}/api/grants/00000000-0000-0000-0000-000000000000/obligations`, {
    headers,
  })
  check('nonexistent grant returns 404', badGrantRes.status === 404)

  // Invalid PATCH body
  const emptyPatchRes = await fetch(`${API}/api/grants/${grantId}/obligations/${allObs[0].id}`, {
    method: 'PATCH',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  })
  check('empty PATCH body returns 400', emptyPatchRes.status === 400)

  // ── 5. Obligation data integrity for UI rendering ─────────────
  console.log('\n--- UI data integrity ---\n')

  const withType = allObs?.filter((o) => o.type) || []
  check('all obligations have type', withType.length === allObs.length)

  const withDesc = allObs?.filter((o) => o.description && o.description.trim().length > 0) || []
  check('all obligations have non-empty description', withDesc.length === allObs.length)

  const withConfidence = allObs?.filter((o) => ['high', 'low'].includes(o.confidence)) || []
  check('all obligations have valid confidence', withConfidence.length === allObs.length)

  const withStatus = allObs?.filter((o) => ['pending_review', 'confirmed'].includes(o.status)) || []
  check('all obligations have valid status', withStatus.length === allObs.length)

  const withVerified = allObs?.filter((o) => typeof o.verified === 'boolean') || []
  check('all obligations have verified boolean', withVerified.length === allObs.length)

  // ── 6. Confirm flow works end-to-end ──────────────────────────
  console.log('\n--- Confirm flow ---\n')

  const pendingBefore = allObs?.filter((o) => o.status === 'pending_review').length || 0
  check('has pending obligations before confirm', pendingBefore > 0)

  const confirmRes = await fetch(`${API}/api/grants/${grantId}/obligations/confirm`, {
    method: 'POST',
    headers,
  })
  check('confirm returns 200', confirmRes.status === 200)

  const { data: afterConfirmObs } = await frontendClient
    .from('obligations')
    .select('*')
    .eq('grant_id', grantId)

  const confirmedAfter = afterConfirmObs?.filter((o) => o.status === 'confirmed').length || 0
  check('all obligations confirmed after confirm', confirmedAfter === allObs.length)

  // ── 7. Second upload for stats variety ────────────────────────
  console.log('\n--- Stats variety ---\n')

  const pdfBytes2 = await readFile('../pdf/Sample_Grant_3_KosuaTrust_SmallGrant.pdf')
  const form2 = new FormData()
  form2.append('name', 'KosuaTrust Small Grant')
  form2.append('funder_name', 'KosuaTrust Foundation')
  form2.append('file', new Blob([pdfBytes2], { type: 'application/pdf' }), 'kosu.pdf')

  console.log('  Uploading second grant (~10-30s)...')
  const up2Res = await fetch(`${API}/api/grants`, { method: 'POST', headers, body: form2 })
  const up2Body = await up2Res.json()
  check('second upload returns 201', up2Res.status === 201)

  const { data: finalGrants } = await frontendClient
    .from('grants')
    .select('*')
    .eq('user_id', userId)

  const { data: finalObs } = await frontendClient
    .from('obligations')
    .select('*')
    .in('grant_id', finalGrants?.map((g) => g.id) || [])

  const stats = {
    totalGrants: finalGrants?.length || 0,
    totalObs: finalObs?.length || 0,
    dueSoon: finalObs?.filter((o) => {
      if (!o.due_date) return false
      const diff = Math.ceil((new Date(o.due_date) - new Date()) / 86400000)
      return diff >= 0 && diff <= 14
    }).length || 0,
    lowConfUnverified: finalObs?.filter((o) => o.confidence === 'low' && !o.verified).length || 0,
  }

  console.log(`  Stats: grants=${stats.totalGrants}, obs=${stats.totalObs}, dueSoon=${stats.dueSoon}, flags=${stats.lowConfUnverified}`)
  check('dashboard has 2 grants', stats.totalGrants === 2)
  check('dashboard has multiple obligations', stats.totalObs > 0)

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
