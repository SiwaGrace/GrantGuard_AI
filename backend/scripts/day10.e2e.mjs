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
const email = `day10-e2e-${stamp}@example.com`
const password = `E2e-${stamp}-GrantGuard!`
let userId = null

try {
  console.log(`\n=== GrantGuard Day 10 E2E — ${new Date().toISOString()} ===\n`)

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

  // Upload BrightPath (known to have 1 low-confidence obligation)
  console.log('--- Upload BrightPath (has low-confidence item) ---\n')

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

  // Find low-confidence obligations
  const lowConfItems = obligations.filter((o) => o.confidence === 'low')
  const highConfItems = obligations.filter((o) => o.confidence === 'high')
  console.log(`  High confidence: ${highConfItems.length}, Low confidence: ${lowConfItems.length}\n`)

  check('has at least 1 low-confidence obligation', lowConfItems.length >= 1)

  // ── Dashboard flag count ──────────────────────────────────────
  console.log('--- Dashboard flag logic ---\n')

  const { data: allObs } = await frontendClient
    .from('obligations')
    .select('*')
    .eq('grant_id', grantId)

  const unverifiedFlags = allObs?.filter((o) => o.confidence === 'low' && !o.verified) || []
  check('unverified flag count matches low-conf count', unverifiedFlags.length === lowConfItems.length,
    `unverified=${unverifiedFlags.length}, lowConf=${lowConfItems.length}`)

  // All low-conf start as unverified
  check('all low-confidence start as unverified', allObs?.filter((o) => o.confidence === 'low').every((o) => o.verified === false))

  // ── Verify a low-confidence obligation ────────────────────────
  console.log('--- Verify obligation ---\n')

  if (lowConfItems.length > 0) {
    const target = lowConfItems[0]
    console.log(`  Target: [${target.type}] ${target.description.slice(0, 60)}...`)
    console.log(`  ID: ${target.id}`)

    // PATCH verified=true
    const patchRes = await fetch(`${API}/api/grants/${grantId}/obligations/${target.id}`, {
      method: 'PATCH',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ verified: true }),
    })
    const patchBody = await patchRes.json()
    check('PATCH verified=true -> 200', patchRes.status === 200)
    check('verified field updated in response', patchBody.obligation?.verified === true)

    // Verify in DB
    const { data: verifiedObs } = await frontendClient
      .from('obligations')
      .select('*')
      .eq('id', target.id)
      .single()

    check('verified persisted in DB', verifiedObs?.verified === true)

    // Dashboard flag count should decrease
    const afterFlags = allObs?.filter((o) => o.confidence === 'low' && !o.verified) || []
    // After verifying one, one less unverified flag
    // But since we're using the cached allObs, we need to re-query
    const { data: reObs } = await frontendClient
      .from('obligations')
      .select('*')
      .eq('grant_id', grantId)

    const afterUnverifiedFlags = reObs?.filter((o) => o.confidence === 'low' && !o.verified) || []
    check('flag count decreased after verify', afterUnverifiedFlags.length === unverifiedFlags.length - 1,
      `before=${unverifiedFlags.length}, after=${afterUnverifiedFlags.length}`)

    // The verified obligation should NOT be in the flag list
    check('verified obligation not in flag list', !afterUnverifiedFlags.some((o) => o.id === target.id))

    // High-confidence obligations should remain unflagged
    check('high-confidence obligations unaffected', highConfItems.every((o) => {
      const dbObs = reObs?.find((x) => x.id === o.id)
      return dbObs?.verified === false
    }))
  }

  // ── Verify remaining flags still show ─────────────────────────
  console.log('\n--- Remaining flags ---\n')

  const { data: finalObs } = await frontendClient
    .from('obligations')
    .select('*')
    .eq('grant_id', grantId)

  const remainingFlags = finalObs?.filter((o) => o.confidence === 'low' && !o.verified) || []
  const verifiedItems = finalObs?.filter((o) => o.confidence === 'low' && o.verified) || []

  console.log(`  Remaining unverified flags: ${remainingFlags.length}`)
  console.log(`  Verified items: ${verifiedItems.length}`)
  console.log(`  Total low-confidence: ${remainingFlags.length + verifiedItems.length}`)

  check('remaining flags + verified = total low-conf',
    remainingFlags.length + verifiedItems.length === lowConfItems.length)

  // Flags persist after confirm
  await fetch(`${API}/api/grants/${grantId}/obligations/confirm`, { method: 'POST', headers })

  const { data: postConfirmObs } = await frontendClient
    .from('obligations')
    .select('*')
    .eq('grant_id', grantId)

  const postConfirmFlags = postConfirmObs?.filter((o) => o.confidence === 'low' && !o.verified) || []
  check('flags persist after confirm', postConfirmFlags.length === remainingFlags.length,
    `flags=${postConfirmFlags.length}`)

  // ── Cannot verify with invalid body ───────────────────────────
  console.log('\n--- Edge cases ---\n')

  if (remainingFlags.length > 0) {
    const badRes = await fetch(`${API}/api/grants/${grantId}/obligations/${remainingFlags[0].id}`, {
      method: 'PATCH',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    })
    check('PATCH empty body -> 400', badRes.status === 400)
  }

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
