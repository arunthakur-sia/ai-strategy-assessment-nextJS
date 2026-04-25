process.env.PDF_PARSE_NO_NATIVE = '1'

import express, { type Request, Response, NextFunction } from 'express'
import session from 'express-session'
import cors from 'cors'
import { createServer } from 'http'
import { config } from './config.js'
import { migrate } from './migrate.js'
import { registerRoutes } from './routes.js'
import { serveStaticFrontend } from './static.js'

const app = express()
const httpServer = createServer(app)

app.use(cors({
  origin: config.frontendUrl,
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}))

app.use(session({
  secret: config.sessionSecret,
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: config.nodeEnv === 'production',
    httpOnly: true,
    maxAge: 8 * 60 * 60 * 1000,
  },
}))

app.use(express.json({ limit: '50mb' }))
app.use(express.urlencoded({ extended: false }))

app.use((req, res, next) => {
  const start = Date.now()
  res.on('finish', () => {
    const duration = Date.now() - start
    if (req.path.startsWith('/api')) {
      console.log(`${new Date().toISOString()} ${req.method} ${req.path} ${res.statusCode} in ${duration}ms`)
    }
  })
  next()
})

;(async () => {
  await migrate()
  await registerRoutes(httpServer, app)

  if (config.nodeEnv === 'production') {
    serveStaticFrontend(app)
  }

  app.use((err: any, _req: Request, res: Response, next: NextFunction) => {
    const status = err.status || err.statusCode || 500
    const message = err.message || 'Internal Server Error'
    console.error('Error:', err)
    if (res.headersSent) return next(err)
    return res.status(status).json({ message })
  })

  httpServer.listen({ port: config.port, host: '0.0.0.0' }, () => {
    console.log(`SIA Assessment Server running on port ${config.port} [${config.nodeEnv}]`)
    console.log(`CORS origin: ${config.frontendUrl}`)
  })
})()
