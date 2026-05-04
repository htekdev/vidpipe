import { express } from '../../L1-infra/http/http.js'
import { join, dirname, fileURLToPath } from '../../L1-infra/paths/paths.js'
import { createRouter } from './routes.js'
import { isAzureConfigured } from '../../L3-services/azureStorage/azureStorageService.js'
import logger from '../../L1-infra/logger/configLogger.js'

const __dirname = dirname(fileURLToPath(import.meta.url))

export interface ReviewServerOptions {
  port?: number
}

export async function startReviewServer(options: ReviewServerOptions = {}): Promise<{ 
  port: number
  close: () => Promise<void>
}> {
  // Azure Storage is required for the review server
  if (!isAzureConfigured()) {
    const msg = 'Review server requires Azure Storage. Set AZURE_STORAGE_ACCOUNT_NAME and AZURE_STORAGE_ACCOUNT_KEY environment variables.'
    logger.error(msg)
    throw new Error(msg)
  }

  const app = express()
  const port = options.port || 3847

  // Middleware
  app.use(express.json())

  // API routes (including /api/media/:itemId/:filename for blob proxy)
  app.use(createRouter())

  // Serve static frontend
  const publicDir = join(__dirname, 'public')
  app.use(express.static(publicDir))

  // SPA fallback — serve index.html for non-API routes
  // Express 5 path-to-regexp requires named splat: /{*splat}
  app.get('/{*splat}', (req, res) => {
    if (!req.path.startsWith('/api/')) {
      res.sendFile(join(publicDir, 'index.html'))
    }
  })

  // Start server with port retry logic
  return new Promise((resolve, reject) => {
    const tryPort = (p: number, attempts: number) => {
      const server = app.listen(p, '127.0.0.1', () => {
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
            let done = false

            const finish = () => {
              if (done) return
              done = true
              res()
            }

            for (const conn of connections) conn.destroy()

            const timeout = setTimeout(() => {
              logger.warn('Timed out waiting for review server to close, forcing shutdown')
              finish()
            }, 2000)

            // Allow process to exit naturally even if timeout is pending
            timeout.unref()

            server.close(() => {
              clearTimeout(timeout)
              finish()
            })
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
