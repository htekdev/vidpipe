import winston from 'winston'
import { join } from '../paths/paths.js'

/**
 * Sanitize user input for logging to prevent log injection attacks.
 * Removes or escapes newlines, carriage returns, and other control characters.
 */
export function sanitizeForLog(value: unknown): string {
  if (value === null || value === undefined) return String(value)
  const str = String(value)
  return str.replace(/[\r\n\t]/g, (c) => {
    switch (c) {
      case '\r': return '\\r'
      case '\n': return '\\n'
      case '\t': return '\\t'
      default: return c
    }
  })
}

const LOG_FORMAT = winston.format.combine(
  winston.format.timestamp(),
  winston.format.printf(({ timestamp, level, message }) => {
    return `${timestamp} [${level.toUpperCase()}]: ${message}`
  })
)

const logger = winston.createLogger({
  level: 'info',
  format: LOG_FORMAT,
  transports: [new winston.transports.Console()],
})

export function setVerbose(): void {
  logger.level = 'debug'
}

/** Suppress console output for interactive modes (chat). Restores with setChatMode(false). */
const consoleTransport = logger.transports[0] as winston.transports.ConsoleTransportInstance
let savedLevel: string | undefined

export function setChatMode(enabled: boolean): void {
  if (enabled) {
    savedLevel = consoleTransport.level
    consoleTransport.silent = true
  } else {
    consoleTransport.silent = false
    if (savedLevel !== undefined) {
      consoleTransport.level = savedLevel
      savedLevel = undefined
    }
  }
}

// ── Pipe stack ───────────────────────────────────────────────────────────────

const pipeStack: winston.transports.FileTransportInstance[] = []

/**
 * Push a file transport that pipes all log output to `{folder}/pipeline.log`.
 * Supports nesting — each pushPipe adds a new file, popPipe removes the most recent.
 */
export function pushPipe(folder: string): void {
  const transport = new winston.transports.File({
    filename: join(folder, 'pipeline.log'),
    format: LOG_FORMAT,
  })
  pipeStack.push(transport)
  logger.add(transport)
}

/** Remove the most recently pushed file transport. */
export function popPipe(): void {
  const transport = pipeStack.pop()
  if (transport) {
    logger.remove(transport)
  }
}

export default logger
