import express from 'express'
import path from 'path'
import { fileURLToPath } from 'url'
import { createRouter } from './routes'
import { getConfig } from '../config/environment'
import logger from '../config/logger'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

export interface ReviewServerOptions {
  port?: number
}

export async function startReviewServer(options: ReviewServerOptions = {}): Promise<{ 
  port: number
  close: () => Promise<void>
}> {
  const app = express()
  const port = options.port || 3847

  // Middleware
  app.use(express.json())

  // API routes
  app.use(createRouter())

  // Serve media files from publish-queue and published directories
  const cfg = getConfig()
  const queueDir = path.join(cfg.OUTPUT_DIR, 'publish-queue')
  const publishedDir = path.join(cfg.OUTPUT_DIR, 'published')
  app.use('/media/queue', express.static(queueDir))
  app.use('/media/published', express.static(publishedDir))

  // Serve static frontend
  const publicDir = path.join(__dirname, 'public')
  app.use(express.static(publicDir))

  // SPA fallback — serve index.html for non-API routes
  app.get('/{*splat}', (req, res) => {
    if (!req.path.startsWith('/api/') && !req.path.startsWith('/media/')) {
      res.sendFile(path.join(publicDir, 'index.html'))
    }
  })

  // Start server with port retry logic
  return new Promise((resolve, reject) => {
    const tryPort = (p: number, attempts: number) => {
      const server = app.listen(p, () => {
        logger.info(`Review server running at http://localhost:${p}`)

        // Track open connections so we can destroy them on shutdown
        const connections = new Set<import('net').Socket>()
        server.on('connection', (conn) => {
          connections.add(conn)
          conn.on('close', () => connections.delete(conn))
        })

        resolve({
          port: p,
          close: () => new Promise<void>((res) => {
            for (const conn of connections) conn.destroy()
            server.close(() => res())
            setTimeout(() => res(), 2000).unref()
          }),
        })
      })
      
      server.on('error', (err: NodeJS.ErrnoException) => {
        if (err.code === 'EADDRINUSE' && attempts < 5) {
          logger.warn(`Port ${p} in use, trying ${p + 1}...`)
          tryPort(p + 1, attempts + 1)
        } else {
          reject(err)
        }
      })
    }
    
    tryPort(port, 0)
  })
}
