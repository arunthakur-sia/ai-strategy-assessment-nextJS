import express, { type Express } from 'express'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

export function serveStaticFrontend(app: Express) {
  const distPath = path.resolve(__dirname, '..', 'public')
  if (!fs.existsSync(distPath)) {
    console.warn(`Frontend build not found at ${distPath}. API-only mode.`)
    return
  }
  app.use(express.static(distPath))
  app.use('/{*path}', (_req, res) => {
    res.sendFile(path.resolve(distPath, 'index.html'))
  })
}
