import 'dotenv/config'
import express from 'express'
import cors from 'cors'
import grantsRouter from './routes/grants.js'

const app = express()

const allowedOrigins = ['http://localhost:5173']
if (process.env.CORS_ORIGIN) {
  allowedOrigins.push(process.env.CORS_ORIGIN)
}

app.use(
  cors({
    origin(origin, callback) {
      if (!origin || allowedOrigins.includes(origin)) {
        return callback(null, true)
      }
      return callback(null, false)
    },
  }),
)

app.use(express.json({ limit: '1mb' }))

app.use('/api', grantsRouter)

app.get('/health', (_req, res) => {
  res.json({
    status: 'ok',
    uptimeSeconds: Math.floor(process.uptime()),
  })
})

app.get('/api/diagnose', async (_req, res) => {
  const results = { checks: [] }

  results.checks.push({
    name: 'OPENROUTER_API_KEY',
    ok: !!process.env.OPENROUTER_API_KEY,
    detail: process.env.OPENROUTER_API_KEY ? `starts with ${process.env.OPENROUTER_API_KEY.slice(0, 12)}...` : 'MISSING',
  })

  results.checks.push({
    name: 'SUPABASE_URL',
    ok: !!process.env.SUPABASE_URL,
    detail: process.env.SUPABASE_URL || 'MISSING',
  })

  results.checks.push({
    name: 'SUPABASE_SERVICE_ROLE_KEY',
    ok: !!process.env.SUPABASE_SERVICE_ROLE_KEY,
    detail: process.env.SUPABASE_SERVICE_ROLE_KEY ? 'set' : 'MISSING',
  })

  results.checks.push({
    name: 'CORS_ORIGIN',
    ok: !!process.env.CORS_ORIGIN,
    detail: process.env.CORS_ORIGIN || 'not set (only localhost allowed)',
  })

  try {
    const testText = 'The Grantee shall submit quarterly reports within 30 days of each quarter end. All funds must be used for WASH activities. The project must be completed by December 31, 2026.'
    const { extractObligations } = await import('./lib/openrouter.js')
    const obligations = await extractObligations(testText)
    results.checks.push({
      name: 'LLM Extraction',
      ok: obligations.length > 0,
      detail: `returned ${obligations.length} obligations from test text`,
    })
  } catch (err) {
    results.checks.push({
      name: 'LLM Extraction',
      ok: false,
      detail: err.message,
    })
  }

  try {
    const { supabaseAdmin } = await import('./lib/supabaseAdmin.js')
    const { error } = await supabaseAdmin.from('obligations').select('id').limit(1)
    if (error) {
      results.checks.push({
        name: 'Obligations Table',
        ok: false,
        detail: error.message,
      })
    } else {
      results.checks.push({
        name: 'Obligations Table',
        ok: true,
        detail: 'table exists and is queryable',
      })
    }
  } catch (err) {
    results.checks.push({
      name: 'Obligations Table',
      ok: false,
      detail: err.message,
    })
  }

  res.json(results)
})

const port = Number(process.env.PORT) || 4000
app.listen(port, () => {
  console.log(`GrantGuard AI backend listening on http://localhost:${port}`)
})
