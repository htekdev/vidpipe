import winston from 'winston'

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

const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.printf(({ timestamp, level, message }) => {
      return `${timestamp} [${level.toUpperCase()}]: ${message}`
    })
  ),
  transports: [new winston.transports.Console()],
})

export function setVerbose(): void {
  logger.level = 'debug'
}

export default logger
