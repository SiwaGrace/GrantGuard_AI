import 'dotenv/config'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createClient } from '@supabase/supabase-js'
import ws from 'ws'

const SUPABASE_URL = process.env.SUPABASE_URL
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
const ANON_KEY = process.env.SUPABASE_ANON_KEY || SERVICE_KEY
const API = process.env.E2E_API_URL || 'http://localhost:4000'
const BUCKET = 'grant-documents'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

const PDFS = [
  path.join(__dirname, '..', '..', 'pdf', 'Sample_Grant_1_GlobalDev_WASH.pdf'),
  path.join(__dirname, '..', '..', 'pdf', 'Sample_Grant_2_BrightPath_YouthSkills.pdf'),
  path.join(__dirname, '..', '..', 'pdf', 'Sample_Grant_3_KosuaTrust_SmallGrant.pdf'),
]

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
const email = `day7-e2e-${stamp}@example.com`
const password = `E2e-${stamp}-GrantGuard!`
let userId = null
const createdGrantIds = []

try {
  console.log(`\n=== GrantGuard Day 7 Integration Test — ${new Date().toISOString()} ===\n`)

  // health check
  const healthRes = await fetch(`${API}/health`)
  check('GET /health returns ok', healthRes.ok && (await healthRes.json()).status === 'ok')

  // create test user
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

  const extractionResults = []

  // ── TEST EACH PDF ──────────────────────────────────────────────
  for (let i = 0; i < PDFS.length; i++) {
    const pdfPath = PDFS[i]
    const pdfName = pdfPath.split(/[\\/]/).pop()
    console.log(`\n${'='.repeat(60)}`)
    console.log(`PDF ${i + 1}/${PDFS.length}: ${pdfName}`)
    console.log('='.repeat(60))

    // Step 1: Upload + extract
    const pdfBytes = await readFile(pdfPath)
    const form = new FormData()
    form.append('name', `Test Grant ${i + 1}`)
    form.append('funder_name', `Test Funder ${i + 1}`)
    form.append('file', new Blob([pdfBytes], { type: 'application/pdf' }), pdfName)

    console.log(`  Uploading + LLM extraction (~10-30s)...`)
    const t0 = Date.now()
    const upRes = await fetch(`${API}/api/grants`, { method: 'POST', headers, body: form })
    const elapsed = ((Date.now() - t0) / 1000).toFixed(1)
    const upBody = await upRes.json()

    check(`upload -> 201`, upRes.status === 201, `${upRes.status} (${elapsed}s)`)
    if (upRes.status !== 201) {
      console.log(`  ERROR: ${JSON.stringify(upBody).slice(0, 500)}`)
      continue
    }

    const grantId = upBody.grant.id
    createdGrantIds.push(grantId)

    check('grant has id', typeof grantId === 'string')
    check('document created', typeof upBody.document?.id === 'string')
    check('extraction extracted', upBody.extraction?.status === 'extracted',
      `pages=${upBody.extraction?.pages}, chars=${upBody.extraction?.characters}`)

    const obligations = upBody.obligations ?? []
    check('obligations extracted', obligations.length > 0, `count=${obligations.length}`)

    // Step 2: Analyze extraction quality
    const types = {}
    const confidences = { high: 0, low: 0 }
    let emptyExcerpts = 0
    let emptyDescriptions = 0
    let hasDueDate = 0

    for (const o of obligations) {
      types[o.type] = (types[o.type] || 0) + 1
      confidences[o.confidence] = (confidences[o.confidence] || 0) + 1
      if (!o.source_excerpt || o.source_excerpt.length < 10) emptyExcerpts++
      if (!o.description || o.description.length < 5) emptyDescriptions++
      if (o.due_date) hasDueDate++
    }

    console.log(`\n  --- Extraction Quality Report ---`)
    console.log(`  Total obligations: ${obligations.length}`)
    console.log(`  Types: ${Object.entries(types).map(([k, v]) => `${k}=${v}`).join(', ')}`)
    console.log(`  Confidence: high=${confidences.high}, low=${confidences.low}`)
    console.log(`  With due dates: ${hasDueDate}`)
    console.log(`  Empty/short excerpts: ${emptyExcerpts}`)
    console.log(`  Empty/short descriptions: ${emptyDescriptions}`)

    // Print each obligation
    for (let j = 0; j < obligations.length; j++) {
      const o = obligations[j]
      const excerptPreview = (o.source_excerpt || '').slice(0, 80)
      console.log(`\n  [${o.type}] #${j + 1} (${o.confidence})`)
      console.log(`    Desc: ${(o.description || '').slice(0, 120)}`)
      if (o.due_date) console.log(`    Due: ${o.due_date}`)
      console.log(`    Excerpt: "${excerptPreview}..."`)
      console.log(`    Page: ${o.source_page}`)
    }
    console.log('')

    extractionResults.push({
      pdf: pdfName,
      obligations: obligations.length,
      types,
      confidences,
      emptyExcerpts,
      emptyDescriptions,
      hasDueDate,
    })

    // Step 3: Review screen — GET obligations
    const listRes = await fetch(`${API}/api/grants/${grantId}/obligations`, { headers })
    const listBody = await listRes.json()
    check('list obligations -> 200', listRes.status === 200)
    check('listed count matches', listBody.obligations?.length === obligations.length,
      `listed=${listBody.obligations?.length}, expected=${obligations.length}`)

    // Step 4: Edit one obligation
    if (obligations.length > 0) {
      const editId = obligations[0].id
      const patchRes = await fetch(`${API}/api/grants/${grantId}/obligations/${editId}`, {
        method: 'PATCH',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ description: 'INTEGRATION TEST: edited description' }),
      })
      check('edit obligation -> 200', patchRes.status === 200)
      const patchBody = await patchRes.json()
      check('edit reflected in response', patchBody.obligation?.description === 'INTEGRATION TEST: edited description')
    }

    // Step 5: Confirm all
    const confirmRes = await fetch(`${API}/api/grants/${grantId}/obligations/confirm`, {
      method: 'POST',
      headers,
    })
    const confirmBody = await confirmRes.json()
    check('confirm -> 200', confirmRes.status === 200)
    check('confirm count matches', confirmBody.confirmed === obligations.length)

    // Step 6: Verify all confirmed
    const verifyRes = await fetch(`${API}/api/grants/${grantId}/obligations`, { headers })
    const verifyBody = await verifyRes.json()
    check('all confirmed after confirm', verifyBody.obligations?.every((o) => o.status === 'confirmed'))

    // Step 7: Re-confirm should return 0
    const reConfirmRes = await fetch(`${API}/api/grants/${grantId}/obligations/confirm`, {
      method: 'POST',
      headers,
    })
    const reConfirmBody = await reConfirmRes.json()
    check('re-confirm returns 0', reConfirmBody.confirmed === 0)
  }

  // ── RLS TEST ────────────────────────────────────────────────────
  console.log(`\n${'='.repeat(60)}`)
  console.log('RLS / Cross-user access test')
  console.log('='.repeat(60))

  // Create second user
  const email2 = `day7-other-${stamp}@example.com`
  const password2 = `E2e-other-${stamp}-Pass!`
  const { data: other } = await admin.auth.admin.createUser({
    email: email2,
    password: password2,
    email_confirm: true,
  })
  const otherAnon = createClient(SUPABASE_URL, ANON_KEY, { realtime: { transport: ws } })
  const { data: otherSess } = await otherAnon.auth.signInWithPassword({ email: email2, password: password2 })
  const otherHeaders = { Authorization: `Bearer ${otherSess.session.access_token}` }

  // Try to access first user's grants
  if (createdGrantIds.length > 0) {
    const stolenRes = await fetch(`${API}/api/grants/${createdGrantIds[0]}/obligations`, {
      headers: otherHeaders,
    })
    check('other user cannot list obligations -> 404', stolenRes.status === 404)

    // Try to edit
    if (extractionResults.length > 0 && extractionResults[0].obligations > 0) {
      // We need an obligation ID from first user — get from DB
      const { data: firstObligations } = await admin
        .from('obligations')
        .select('id')
        .eq('grant_id', createdGrantIds[0])
        .limit(1)

      if (firstObligations?.length > 0) {
        const stolenEdit = await fetch(
          `${API}/api/grants/${createdGrantIds[0]}/obligations/${firstObligations[0].id}`,
          {
            method: 'PATCH',
            headers: { ...otherHeaders, 'Content-Type': 'application/json' },
            body: JSON.stringify({ description: 'HACKED' }),
          }
        )
        check('other user cannot edit obligation -> 404', stolenEdit.status === 404)
      }
    }

    // Try to confirm
    const stolenConfirm = await fetch(`${API}/api/grants/${createdGrantIds[0]}/obligations/confirm`, {
      method: 'POST',
      headers: otherHeaders,
    })
    check('other user cannot confirm -> 404', stolenConfirm.status === 404)
  }

  await admin.auth.admin.deleteUser(other.user.id)

  // ── SUMMARY ─────────────────────────────────────────────────────
  console.log(`\n${'='.repeat(60)}`)
  console.log('EXTRACTION QUALITY SUMMARY')
  console.log('='.repeat(60))
  for (const r of extractionResults) {
    const issueCount = r.emptyExcerpts + r.emptyDescriptions
    const flag = issueCount > 0 ? ' ⚠️' : ' ✅'
    console.log(`  ${r.pdf}${flag}`)
    console.log(`    Obligations: ${r.obligations} | Types: ${JSON.stringify(r.types)}`)
    console.log(`    High conf: ${r.confidences.high} | Low conf: ${r.confidences.low}`)
    console.log(`    With due dates: ${r.hasDueDate} | Issues: ${issueCount}`)
  }

  console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} OF ${totalChecks} CHECKS FAILED`}`)
  console.log(`Total checks: ${totalChecks}\n`)
} catch (err) {
  failures += 1
  console.error('\nE2E ABORTED:', err.message)
} finally {
  if (userId) {
    // cleanup storage
    const toRemove = []
    const { data: topLevel } = await admin.storage.from(BUCKET).list(userId)
    for (const entry of topLevel ?? []) {
      if (entry.id === null) {
        const { data: nested } = await admin.storage.from(BUCKET).list(`${userId}/${entry.name}`)
        for (const file of nested ?? []) {
          toRemove.push(`${userId}/${entry.name}/${file.name}`)
        }
      } else {
        toRemove.push(`${userId}/${entry.name}`)
      }
    }
    if (toRemove.length) await admin.storage.from(BUCKET).remove(toRemove)

    // delete grants (cascades)
    await admin.from('grants').delete().eq('user_id', userId)
    await admin.auth.admin.deleteUser(userId)
    console.log(`cleanup done (user ${email} removed, ${toRemove.length} storage object(s) deleted)`)
  }
}
process.exit(failures === 0 ? 0 : 1)
