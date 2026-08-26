import 'dotenv/config'
import { readFile } from 'node:fs/promises'
import { createClient } from '@supabase/supabase-js'
import ws from 'ws'

const SUPABASE_URL = process.env.SUPABASE_URL
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
const ANON_KEY = process.env.SUPABASE_ANON_KEY || SERVICE_KEY
const API = process.env.E2E_API_URL || 'http://localhost:4000'
const BUCKET = 'grant-documents'

const PDF_PATH = process.argv[2]
if (!PDF_PATH) {
  console.error('Usage: node scripts/day5.e2e.mjs <path-to-pdf>')
  process.exit(1)
}

let failures = 0
function check(label, condition, detail = '') {
  const ok = Boolean(condition)
  if (!ok) failures += 1
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`)
  return ok
}

const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
  realtime: { transport: ws },
})

const stamp = Date.now()
const email = `day5-e2e-${stamp}@example.com`
const password = `E2e-${stamp}-GrantGuard!`
let userId = null

try {
  console.log(`\n=== GrantGuard Day 5 E2E — ${new Date().toISOString()} ===\n`)
  console.log(`PDF: ${PDF_PATH}\n`)

  // 1. health
  const healthRes = await fetch(`${API}/health`)
  check('GET /health returns ok', healthRes.ok && (await healthRes.json()).status === 'ok')

  // 2. create confirmed test user (admin)
  const { data: created, error: createError } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  })
  if (createError) throw new Error(`createUser failed: ${createError.message}`)
  userId = created.user.id
  console.log(`\nTest user: ${email} (${userId})\n`)

  // 3. sign in as that user
  const anon = createClient(SUPABASE_URL, ANON_KEY, {
    realtime: { transport: ws },
  })
  const { data: session, error: signInError } = await anon.auth.signInWithPassword({
    email,
    password,
  })
  if (signInError) throw new Error(`signIn failed: ${signInError.message}`)
  const token = session.session.access_token

  // 4. upload an actual grant agreement PDF
  const pdfBytes = await readFile(PDF_PATH)
  const pdfForm = new FormData()
  pdfForm.append('name', 'WASH Access Programme 2026')
  pdfForm.append('funder_name', 'GlobalDev Foundation')
  pdfForm.append(
    'file',
    new Blob([pdfBytes], { type: 'application/pdf' }),
    PDF_PATH.split(/[\\/]/).pop(),
  )

  console.log('Uploading PDF and running extraction (may take 10-30s for LLM call)...\n')

  const upRes = await fetch(`${API}/api/grants`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: pdfForm,
  })
  const upBody = await upRes.json()

  check('upload real PDF -> 201', upRes.status === 201, `got ${upRes.status} ${JSON.stringify(upBody).slice(0, 300)}`)
  check('response contains grant id', typeof upBody.grant?.id === 'string')
  check('response contains document id', typeof upBody.document?.id === 'string')
  check(
    'extraction status is "extracted"',
    upBody.extraction?.status === 'extracted',
    `got ${upBody.extraction?.status}`,
  )
  check(
    'pages >= 1',
    Number(upBody.extraction?.pages) >= 1,
    `pages=${upBody.extraction?.pages}`,
  )
  check(
    'characters > 200',
    Number(upBody.extraction?.characters) > 200,
    `chars=${upBody.extraction?.characters}`,
  )

  // 5. obligations extracted
  const obligations = upBody.obligations ?? []
  console.log(`\n--- obligations extracted: ${obligations.length} ---`)
  if (obligations.length > 0) {
    for (const o of obligations) {
      console.log(`  [${o.type}] ${o.description.slice(0, 80)}${o.description.length > 80 ? '…' : ''}`)
      if (o.due_date) console.log(`    due: ${o.due_date}`)
      console.log(`    excerpt: "${(o.source_excerpt || '').slice(0, 100)}…"`)
      console.log(`    confidence: ${o.confidence}`)
    }
  }
  console.log('---\n')

  check('obligations is a non-empty array', Array.isArray(obligations) && obligations.length > 0, `count=${obligations.length}`)
  check('obligationError is null', upBody.obligationError === null || upBody.obligationError === undefined, `error=${upBody.obligationError}`)

  if (obligations.length > 0) {
    const first = obligations[0]
    const validTypes = ['deadline', 'reporting', 'eligible_activity', 'compliance_condition']
    check('first obligation has valid type', validTypes.includes(first.type), `type=${first.type}`)
    check('first obligation has description', typeof first.description === 'string' && first.description.length > 5)
    check('first obligation has source_excerpt', typeof first.source_excerpt === 'string' && first.source_excerpt.length > 5)
    check('first obligation has valid confidence', ['high', 'low'].includes(first.confidence), `confidence=${first.confidence}`)
  }

  // 6. obligations persisted in DB
  const { data: obRows } = await admin
    .from('obligations')
    .select('*')
    .eq('grant_id', upBody.grant.id)
  check(
    'obligations rows persisted in DB',
    Array.isArray(obRows) && obRows.length > 0,
    `db_count=${obRows?.length ?? 0}`,
  )
  if (obRows && obRows.length > 0) {
    check('all DB obligations have status pending_review', obRows.every((r) => r.status === 'pending_review'))
    check('all DB obligations link to correct grant', obRows.every((r) => r.grant_id === upBody.grant.id))
    console.log(`\n--- DB obligations sample ---`)
    console.log(JSON.stringify(obRows[0], null, 2))
    console.log('---\n')
  }

  console.log(failures === 0 ? '\nALL CHECKS PASSED\n' : `\n${failures} CHECK(S) FAILED\n`)
} catch (err) {
  failures += 1
  console.error('\nE2E ABORTED:', err.message)
} finally {
  if (userId) {
    // cleanup obligations
    await admin.from('obligations').delete().eq('grant_id', '00000000-0000-0000-0000-000000000000').then(() => {})
    // cleanup storage + grant + document
    const toRemove = []
    const { data: topLevel } = await admin.storage.from(BUCKET).list(userId)
    for (const entry of topLevel ?? []) {
      if (entry.id === null) {
        const { data: nested } = await admin.storage
          .from(BUCKET)
          .list(`${userId}/${entry.name}`)
        for (const file of nested ?? []) {
          toRemove.push(`${userId}/${entry.name}/${file.name}`)
        }
      } else {
        toRemove.push(`${userId}/${entry.name}`)
      }
    }
    if (toRemove.length) {
      await admin.storage.from(BUCKET).remove(toRemove)
    }

    // delete grants (cascades to documents + obligations via FK)
    await admin.from('grants').delete().eq('user_id', userId)
    await admin.auth.admin.deleteUser(userId)
    console.log(`cleanup done (user ${email} removed, ${toRemove.length} storage object(s) deleted)`)
  }
}
process.exit(failures === 0 ? 0 : 1)
