export type LogLevel = 'debug' | 'info' | 'warn' | 'error'

export type LogContext = Record<string, unknown>

function sanitize(context: LogContext): LogContext {
  const blocked = /token|secret|password|authorization|cookie|pan|cvc|cvv|card(number)?/i
  return Object.fromEntries(
    Object.entries(context).map(([key, value]) => [
      key,
      blocked.test(key) ? '[REDACTED]' : value,
    ]),
  )
}

export function log(level: LogLevel, message: string, context: LogContext = {}) {
  const entry = {
    timestamp: new Date().toISOString(),
    level,
    service: 'althea-pay',
    message,
    ...sanitize(context),
  }

  const output = JSON.stringify(entry)
  if (level === 'error') console.error(output)
  else if (level === 'warn') console.warn(output)
  else console.log(output)
}
