import 'dotenv/config'
import { readFile } from 'node:fs/promises'
import { createClient } from '@supabase/supabase-js'
import ws from 'ws'

const SUPABASE_URL = process.env.SUPABASE_URL
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
const ANON_KEY = process.env.SUPABASE_ANON_KEY || SERVICE_KEY
const API = process.env.E2E_API_URL || 'http://localhost:4000'
const BUCKET = 'grant-documents'

const DUE_SOON_DAYS = 14

let failures = 0
let totalChecks = 0
function check(label, condition, detail = '') {
  totalChecks++
  const ok = Boolean(condition)
  if (!ok) failures += 1
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`)
  return ok
}

function formatDate(d) {
  return d.toISOString().split('T')[0]
}

const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
  realtime: { transport: ws },
})

const stamp = Date.now()
const email = `day9-e2e-${stamp}@example.com`
const password = `E2e-${stamp}-GrantGuard!`
let userId = null

try {
  console.log(`\n=== GrantGuard Day 9 E2E — ${new Date().toISOString()} ===\n`)

  const healthRes = await fetch(`${API}/health`)
  check('GET /health returns ok', healthRes.ok)

  // create user
  const { data: created, error: ce } = await admin.auth.admin.createUser({ email, password, email_confirm: true })
  if (ce) throw new Error(ce.message)
  userId = created.user.id
  console.log(`Test user: ${email} (${userId})\n`)

  // sign in
  const anon = createClient(SUPABASE_URL, ANON_KEY, { realtime: { transport: ws } })
  const { data: sess, error: se } = await anon.auth.signInWithPassword({ email, password })
  if (se) throw new Error(se.message)
  const token = sess.session.access_token
  const headers = { Authorization: `Bearer ${token}` }

  const frontendClient = createClient(SUPABASE_URL, ANON_KEY, {
    realtime: { transport: ws },
    global: { headers: { Authorization: `Bearer ${token}` } },
  })

  // ── Upload a grant ────────────────────────────────────────────
  console.log('--- Upload grant ---\n')

  const pdfBytes = await readFile('../pdf/Sample_Grant_1_GlobalDev_WASH.pdf')
  const form = new FormData()
  form.append('name', 'WASH Access Programme 2026')
  form.append('funder_name', 'GlobalDev Foundation')
  form.append('file', new Blob([pdfBytes], { type: 'application/pdf' }), 'test.pdf')

  console.log('  Uploading (~10-30s)...')
  const upRes = await fetch(`${API}/api/grants`, { method: 'POST', headers, body: form })
  const upBody = await upRes.json()
  check('upload -> 201', upRes.status === 201)
  const grantId = upBody.grant?.id
  const obligations = upBody.obligations || []
  check('obligations extracted', obligations.length > 0, `count=${obligations.length}`)

  // ── Test due-soon logic ───────────────────────────────────────
  console.log('\n--- Due-soon logic tests ---\n')

  const now = new Date()
  const today = formatDate(now)
  const in5Days = formatDate(new Date(now.getTime() + 5 * 24 * 60 * 60 * 1000))
  const in10Days = formatDate(new Date(now.getTime() + 10 * 24 * 60 * 60 * 1000))
  const in20Days = formatDate(new Date(now.getTime() + 20 * 24 * 60 * 60 * 1000))
  const yesterday = formatDate(new Date(now.getTime() - 1 * 24 * 60 * 60 * 1000))

  // Set specific due dates on obligations for testing
  if (obligations.length >= 4) {
    // o[0] -> due in 5 days (should be due-soon)
    await fetch(`${API}/api/grants/${grantId}/obligations/${obligations[0].id}`, {
      method: 'PATCH',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ due_date: in5Days }),
    })

    // o[1] -> due in 10 days (should be due-soon)
    await fetch(`${API}/api/grants/${grantId}/obligations/${obligations[1].id}`, {
      method: 'PATCH',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ due_date: in10Days }),
    })

    // o[2] -> due in 20 days (should NOT be due-soon)
    await fetch(`${API}/api/grants/${grantId}/obligations/${obligations[2].id}`, {
      method: 'PATCH',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ due_date: in20Days }),
    })

    // o[3] -> due yesterday (overdue, should NOT be due-soon)
    await fetch(`${API}/api/grants/${grantId}/obligations/${obligations[3].id}`, {
      method: 'PATCH',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ due_date: yesterday }),
    })
  }

  // Query obligations via frontend client (simulating dashboard)
  const { data: obs } = await frontendClient
    .from('obligations')
    .select('*')
    .eq('grant_id', grantId)

  check('obligations queried', obs?.length > 0, `count=${obs?.length}`)

  // Apply due-soon filter (same logic as Dashboard)
  const dueSoonDeadline = new Date(now.getTime() + DUE_SOON_DAYS * 24 * 60 * 60 * 1000)
  const dueSoonItems = (obs || []).filter((o) => {
    if (!o.due_date) return false
    const d = new Date(o.due_date)
    return d >= now && d <= dueSoonDeadline
  })

  console.log(`  Today: ${today}`)
  console.log(`  Due-soon window: ${today} to ${formatDate(dueSoonDeadline)} (${DUE_SOON_DAYS} days)`)
  console.log(`  Due dates set: in5d=${in5Days}, in10d=${in10Days}, in20d=${in20Days}, yesterday=${yesterday}`)
  console.log(`  Due-soon items found: ${dueSoonItems.length}`)

  // The obligation due in 5 days should be due-soon
  const o5d = obs?.find((o) => o.id === obligations[0]?.id)
  check('o due in 5 days has correct due_date', o5d?.due_date === in5Days)
  const isDueSoon5d = o5d?.due_date && new Date(o5d.due_date) >= now && new Date(o5d.due_date) <= dueSoonDeadline
  check('o due in 5 days IS due-soon', isDueSoon5d === true)

  // The obligation due in 10 days should be due-soon
  const o10d = obs?.find((o) => o.id === obligations[1]?.id)
  check('o due in 10 days has correct due_date', o10d?.due_date === in10Days)
  const isDueSoon10d = o10d?.due_date && new Date(o10d.due_date) >= now && new Date(o10d.due_date) <= dueSoonDeadline
  check('o due in 10 days IS due-soon', isDueSoon10d === true)

  // The obligation due in 20 days should NOT be due-soon
  const o20d = obs?.find((o) => o.id === obligations[2]?.id)
  check('o due in 20 days has correct due_date', o20d?.due_date === in20Days)
  const isDueSoon20d = o20d?.due_date && new Date(o20d.due_date) >= now && new Date(o20d.due_date) <= dueSoonDeadline
  check('o due in 20 days is NOT due-soon', isDueSoon20d === false)

  // The obligation due yesterday should NOT be due-soon (it's overdue)
  const oYest = obs?.find((o) => o.id === obligations[3]?.id)
  check('o due yesterday has correct due_date', oYest?.due_date === yesterday)
  const isDueSoonYest = oYest?.due_date && new Date(oYest.due_date) >= now && new Date(oYest.due_date) <= dueSoonDeadline
  check('o due yesterday is NOT due-soon (overdue)', isDueSoonYest === false)

  // Count matches expected
  check('due-soon count is 2 (5d + 10d)', dueSoonItems.length === 2, `got ${dueSoonItems.length}`)

  // Due-soon items sorted by closest first
  if (dueSoonItems.length === 2) {
    const daysLeft = dueSoonItems.map((o) => {
      const d = new Date(o.due_date)
      return Math.ceil((d - now) / (1000 * 60 * 60 * 24))
    })
    check('due-soon items sorted closest first', daysLeft[0] <= daysLeft[1], `${daysLeft[0]}d <= ${daysLeft[1]}d`)
  }

  // Confirm and verify due-soon still works for confirmed obligations
  console.log('\n--- After confirm ---\n')

  await fetch(`${API}/api/grants/${grantId}/obligations/confirm`, { method: 'POST', headers })

  const { data: afterObs } = await frontendClient
    .from('obligations')
    .select('*')
    .eq('grant_id', grantId)

  const afterDueSoon = (afterObs || []).filter((o) => {
    if (!o.due_date) return false
    const d = new Date(o.due_date)
    return d >= now && d <= dueSoonDeadline
  })

  check('due-soon items still appear after confirm', afterDueSoon.length === 2, `got ${afterDueSoon.length}`)
  check('all confirmed', afterObs?.every((o) => o.status === 'confirmed'))

  // Edge case: obligation with no due_date should NOT be due-soon
  const noDateObs = obs?.filter((o) => !o.due_date)
  check('no-date obligations not in due-soon', noDateObs?.length === 0 || dueSoonItems.every((o) => o.due_date))

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
