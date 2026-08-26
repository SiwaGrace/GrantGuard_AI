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

const port = Number(process.env.PORT) || 4000
app.listen(port, () => {
  console.log(`GrantGuard AI backend listening on http://localhost:${port}`)
})
