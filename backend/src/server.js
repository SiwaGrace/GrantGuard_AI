import 'dotenv/config'
import express from 'express'
import cors from 'cors'
import grantsRouter from './routes/grants.js'
import chatRouter from './routes/chat.js'

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
app.use('/api', chatRouter)

app.get('/health', (_req, res) => {
  res.json({
    status: 'ok',
    uptimeSeconds: Math.floor(process.uptime()),
  })
})

app.use('/api', (_req, res) => {
  res.status(404).json({ error: 'Not found' })
})

// Every error ends as JSON, so the frontend can show a real message instead
// of failing to parse Express's default HTML error page.
app.use((err, req, res, _next) => {
  const status = err.status || err.statusCode || 500
  console.error(`[error] ${req.method} ${req.originalUrl}: ${err.message}`)
  if (res.headersSent) return
  let message = 'Something went wrong on the server. Please try again.'
  if (status === 413) message = 'The request is too large.'
  else if (err.type === 'entity.parse.failed') message = 'The request body isn’t valid JSON.'
  else if (status < 500 && err.expose) message = err.message
  res.status(status).json({ error: message })
})

// Log stray rejections instead of letting them kill the server
process.on('unhandledRejection', (reason) => {
  console.error('[unhandledRejection]', reason)
})

const port = Number(process.env.PORT) || 4000
app.listen(port, () => {
  console.log(`GrantGuard AI backend listening on http://localhost:${port}`)
})
