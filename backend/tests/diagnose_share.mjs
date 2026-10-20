// Read-only diagnostic: inspect current Supabase security state.
// Run:
//   cd backend
//   $env:SUPABASE_URL="..." ; $env:SUPABASE_ANON_KEY="..." ; node ../tests/diagnose_share.mjs
import { createClient } from '@supabase/supabase-js'
import ws from 'ws'

const url = process.env.SUPABASE_URL
const anonKey = process.env.SUPABASE_ANON_KEY
if (!url || !anonKey) {
  console.error('Need SUPABASE_URL and SUPABASE_ANON_KEY')
  process.exit(1)
}

const visitor = createClient(url, anonKey, {
  auth: { persistSession: false },
  realtime: { transport: ws },
})

async function probe(name, fn) {
  const r = await fn()
  console.log(`[${name}]`, r.error ? 'BLOCKED -> ' + r.error.message : 'ALLOWED')
}

await probe('anon SELECT grants', () => visitor.from('grants').select('*').limit(1))
await probe('anon SELECT obligations', () => visitor.from('obligations').select('*').limit(1))
await probe('anon RPC anon_grant_summary (missing token)', () =>
  visitor.rpc('anon_grant_summary', { p_token: 'probe-token' }),
)
console.log('If the RPC returns an error about the function not existing, the migration has NOT been applied yet.')
