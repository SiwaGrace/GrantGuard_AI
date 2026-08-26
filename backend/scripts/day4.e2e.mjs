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
  console.error('Usage: node scripts/day4.e2e.mjs <path-to-pdf>')
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
const email = `day4-e2e-${stamp}@example.com`
const password = `E2e-${stamp}-GrantGuard!`
let userId = null

try {
  console.log(`\n=== GrantGuard Day 4 E2E — ${new Date().toISOString()} ===\n`)
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

  // 3. sign in as that user (real password grant)
  const anon = createClient(SUPABASE_URL, ANON_KEY, {
    realtime: { transport: ws },
  })
  const { data: session, error: signInError } = await anon.auth.signInWithPassword({
    email,
    password,
  })
  if (signInError) throw new Error(`signIn failed: ${signInError.message}`)
  const token = session.session.access_token

  // 4. negative: no token
  const noAuthRes = await fetch(`${API}/api/grants`, { method: 'POST' })
  check('POST /api/grants without token -> 401', noAuthRes.status === 401, `got ${noAuthRes.status}`)

  // 5. negative: garbage token
  const badAuthRes = await fetch(`${API}/api/grants`, {
    method: 'POST',
    headers: { Authorization: 'Bearer not-a-real-token' },
  })
  check('POST /api/grants with bogus token -> 401', badAuthRes.status === 401, `got ${badAuthRes.status}`)

  // 6. negative: wrong mime type rejected before any work
  const txtForm = new FormData()
  txtForm.append('name', 'X')
  txtForm.append('funder_name', 'Y')
  txtForm.append('file', new Blob(['not a pdf'], { type: 'text/plain' }), 'nope.txt')
  const txtRes = await fetch(`${API}/api/grants`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: txtForm,
  })
  const txtBody = await txtRes.json().catch(() => ({}))
  check(
    'non-PDF upload -> 400',
    txtRes.status === 400,
    `got ${txtRes.status} ${txtBody.error ?? ''}`,
  )

  // 7. THE REAL THING: upload an actual grant agreement PDF
  const pdfBytes = await readFile(PDF_PATH)
  const pdfForm = new FormData()
  pdfForm.append('name', 'WASH Access Programme 2026')
  pdfForm.append('funder_name', 'GlobalDev Foundation')
  pdfForm.append(
    'file',
    new Blob([pdfBytes], { type: 'application/pdf' }),
    PDF_PATH.split(/[\\/]/).pop(),
  )
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
  check(
    'preview is non-empty text',
    typeof upBody.extraction?.preview === 'string' && upBody.extraction.preview.length > 50,
  )
  console.log(`\n--- extracted preview ---\n${upBody.extraction?.preview}\n-------------------------\n`)

  const filePath = upBody.document?.file_path
  check(
    'file_path scoped under own user folder',
    typeof filePath === 'string' && filePath.startsWith(`${userId}/`),
    filePath ?? '(missing)',
  )

  // 8. DB truth: grant row owned by user
  const { data: grantRows } = await admin
    .from('grants')
    .select('*')
    .eq('id', upBody.grant.id)
  const grantRow = grantRows?.[0]
  check('grants row persisted', Boolean(grantRow))
  check('grants.user_id matches uploader', grantRow?.user_id === userId)

  // 9. DB truth: document row linked to grant
  const { data: docRows } = await admin
    .from('documents')
    .select('*')
    .eq('id', upBody.document.id)
  const docRow = docRows?.[0]
  check('documents row persisted', Boolean(docRow))
  check('documents.grant_id links to grant', docRow?.grant_id === upBody.grant.id)
  check('documents.extraction_status = extracted', docRow?.extraction_status === 'extracted', `got ${docRow?.extraction_status}`)

  // 10. Storage truth: object really exists in bucket (list is per-folder)
  const originalName = PDF_PATH.split(/[\\/]/).pop()
  const { data: objs, error: listError } = await admin.storage
    .from(BUCKET)
    .list(`${userId}/${upBody.grant.id}`)
  check(
    'object present in storage bucket',
    !listError && (objs?.length ?? 0) >= 1 && objs.some((o) => o.name.endsWith(originalName)),
    JSON.stringify({ error: listError?.message, objects: objs?.map((o) => o.name) }),
  )

  // 11. RLS sanity: owner can read their grant through PostgREST with own JWT
  const rlsRes = await fetch(`${SUPABASE_URL}/rest/v1/grants?id=eq.${upBody.grant.id}&select=id,name`, {
    headers: {
      apikey: ANON_KEY,
      Authorization: `Bearer ${token}`,
    },
  })
  const rlsRows = await rlsRes.json()
  check('owner reads own grant via RLS', Array.isArray(rlsRows) && rlsRows.length === 1 && rlsRows[0].name === 'WASH Access Programme 2026', JSON.stringify(rlsRows))

  console.log(failures === 0 ? '\nALL CHECKS PASSED\n' : `\n${failures} CHECK(S) FAILED\n`)
} catch (err) {
  failures += 1
  console.error('\nE2E ABORTED:', err.message)
} finally {
  if (userId) {
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
    await admin.auth.admin.deleteUser(userId)
    console.log(`cleanup done (user ${email} removed, ${toRemove.length} storage object(s) deleted)`)
  }
}
process.exit(failures === 0 ? 0 : 1)
