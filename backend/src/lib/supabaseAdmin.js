import { createClient } from '@supabase/supabase-js'
import ws from 'ws'

const supabaseUrl = process.env.SUPABASE_URL
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!supabaseUrl || !serviceRoleKey) {
  throw new Error(
    'Missing Supabase config. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in backend/.env'
  )
}

export const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
  },
  realtime: {
    transport: ws,
  },
})

export const GRANT_DOCUMENTS_BUCKET = 'grant-documents'

export const MAX_FILE_BYTES = 15 * 1024 * 1024
