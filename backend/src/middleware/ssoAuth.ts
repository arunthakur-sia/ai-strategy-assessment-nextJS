import { type Request, Response, NextFunction } from 'express'
import { config } from '../config.js'

declare module 'express-session' {
  interface SessionData {
    projectId?: string
    authenticated?: boolean
  }
}

function sessionAuth(req: Request, res: Response, next: NextFunction) {
  if (req.session?.authenticated) return next()
  return res.status(401).json({ error: 'Not authenticated' })
}

export function ssoAuth(req: Request, res: Response, next: NextFunction) {
  const token = req.headers.authorization?.replace('Bearer ', '')

  if (!token) {
    return sessionAuth(req, res, next)
  }

  if (config.isDev) {
    (req as any).user = { id: 'dev-user', name: 'Developer' }
    return next()
  }

  return res.status(401).json({
    error: 'SIA SSO not yet configured',
    message: 'Replace this middleware with your SIA identity provider validation. See /src/middleware/ssoAuth.ts for integration instructions.',
  })
}
