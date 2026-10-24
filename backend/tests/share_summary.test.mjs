// ============================================================================
// FEATURE 2 — End-to-end security verification for the shareable summary.
//
// IMPORTANT: Run these in the Supabase dashboard SQL editor FIRST, in order:
//   1) migrations/003_rls_enable.sql            (enable RLS + owner policies)
//   2) migrations/004_add_grant_share.sql       (share_token + anon fn)
// This script then proves the anon (no-login) path is narrowly scoped and
// that revoke works.
//
// Run:
//   cd backend
//   $env:SUPABASE_URL="https://xxx.supabase.co"
//   $env:SUPABASE_SERVICE_ROLE_KEY="<service_role>"
//   $env:SUPABASE_ANON_KEY="<anon_key>"
//   node tests/share_summary.test.mjs
// ============================================================================
import { createClient } from '@supabase/supabase-js'
import { randomBytes, randomUUID } from 'node:crypto'
import ws from 'ws'

const url = process.env.SUPABASE_URL
const serviceRole = process.env.SUPABASE_SERVICE_ROLE_KEY
const anonKey = process.env.SUPABASE_ANON_KEY

if (!url || !serviceRole || !anonKey) {
  console.error('Missing env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_ANON_KEY')
  process.exit(1)
}

const transport = { realtime: { transport: ws } }

const admin = createClient(url, serviceRole, { auth: { persistSession: false }, ...transport })
const visitor = createClient(url, anonKey, { auth: { persistSession: false }, ...transport })

let failures = 0
function check(name, cond) {
  console.log(`${cond ? 'PASS' : 'FAIL'} - ${name}`)
  if (!cond) failures++
}

async function main() {
  // ---- Security guard checks: anon must not read tables directly ----
  const anonGrants = await visitor.from('grants').select('*').limit(1)
  check('anon role cannot SELECT grants directly (RLS blocks it)', !!anonGrants.error)

  const anonObligations = await visitor.from('obligations').select('source_excerpt').limit(1)
  check('anon role cannot SELECT obligations directly (RLS blocks it)', !!anonObligations.error)

  // ---- Setup temporary grants + obligations ----
  const testUserId = randomUUID()
  const { data: grant, error: grantErr } = await admin
    .from('grants')
    .insert({ user_id: testUserId, name: 'Test Sharing Grant', funder_name: 'Test Funder' })
    .select('id')
    .single()
  if (grantErr) throw new Error('Could not create test grant: ' + grantErr.message)

  await admin.from('obligations').insert([
    { grant_id: grant.id, type: 'reporting', description: 'Submit quarterly report', due_date: '2026-12-31', status: 'confirmed' },
    { grant_id: grant.id, type: 'deadline', description: 'Closeout deadline', due_date: '2027-06-30', status: 'confirmed' },
    // Pending obligation — must NOT appear in the shared summary.
    { grant_id: grant.id, type: 'compliance_condition', description: 'Internal note not for funder', due_date: null, status: 'pending_review' },
  ])

  const otherGrant = await admin
    .from('grants')
    .insert({ user_id: randomUUID(), name: 'Secret Other Grant', funder_name: 'Other' })
    .select('id')
    .single()
  await admin.from('obligations').insert({
    grant_id: otherGrant.data.id,
    type: 'deadline',
    description: 'SECRET obligation on another grant',
    due_date: '2026-11-11',
    status: 'confirmed',
  })

  // ---- Simulate backend-generated token (crypto.randomBytes(24).base64url) ----
  const token = randomBytes(24).toString('base64url')
  await admin.from('grants').update({ share_token: token }).eq('id', grant.id)

  // ---- Anonymous visitor (no session) reads exactly this grant ----
  const { data: ok, error: okErr } = await visitor.rpc('anon_grant_summary', { p_token: token })
  check('anon visitor reads the shared grant summary', !okErr && ok && ok.status === 'ok')
  if (ok && ok.status === 'ok') {
    check('summary shows grant name', ok.grant.name === 'Test Sharing Grant')
    check('summary shows funder', ok.grant.funder_name === 'Test Funder')
    check(
      'summary exposes ONLY confirmed obligations (2)',
      Array.isArray(ok.confirmed_obligations) && ok.confirmed_obligations.length === 2,
    )
    const descs = JSON.stringify(ok.confirmed_obligations)
    check('summary does NOT leak the pending/internal obligation', !descs.includes('Internal note not for funder'))
    check('summary does NOT leak source_excerpt field', JSON.stringify(ok).indexOf('source_excerpt') === -1)
    check('summary does NOT leak source_page field', JSON.stringify(ok).indexOf('source_page') === -1)
    check('summary does NOT leak share_token', JSON.stringify(ok).indexOf('share_token') === -1)
    check('summary does NOT leak user_id', JSON.stringify(ok).indexOf('user_id') === -1)
    const all = JSON.stringify(ok)
    check(
      'summary does NOT leak other grants data',
      !all.includes('Secret Other Grant') && !all.includes('SECRET obligation'),
    )
  }

  // ---- Guessing an invalid token is rejected ----
  const { data: bad, error: badErr } = await visitor.rpc('anon_grant_summary', { p_token: 'definitely-not-a-real-token' })
  check('invalid token rejected (not_found)', !badErr && bad && bad.status === 'not_found')

  // ---- Enumerating a different (real) grant's token reveals nothing ----
  const { data: otherRpc, error: otherRpcErr } = await visitor.rpc('anon_grant_summary', { p_token: otherGrant.data.share_token || 'x' })
  check('other grant (no share token) is not readable', !otherRpcErr && otherRpc && otherRpc.status === 'not_found')

  // ---- Revoke: clear token, old link must stop working ----
  await admin.from('grants').update({ share_token: null }).eq('id', grant.id)
  const { data: afterRevoke, error: revokeErr } = await visitor.rpc('anon_grant_summary', { p_token: token })
  check('after revoke, the old token no longer returns data', !revokeErr && afterRevoke && afterRevoke.status === 'not_found')

  // ---- Cleanup ----
  await admin.from('obligations').delete().eq('grant_id', grant.id)
  await admin.from('obligations').delete().eq('grant_id', otherGrant.data.id)
  await admin.from('grants').delete().eq('id', grant.id)
  await admin.from('grants').delete().eq('id', otherGrant.data.id)

  console.log('\n' + (failures === 0 ? 'ALL CHECKS PASSED' : failures + ' CHECK(S) FAILED'))
  process.exit(failures === 0 ? 0 : 1)
}

main().catch((err) => {
  console.error('Test errored:', err.message)
  process.exit(1)
})
