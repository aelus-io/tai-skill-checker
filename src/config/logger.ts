import pino, { type Logger } from 'pino'
import type { AppConfig } from './env.js'

export function createLogger(config: Pick<AppConfig, 'nodeEnv' | 'logLevel'>): Logger {
  return pino({
    level: config.logLevel,
    redact: {
      paths: ['req.headers.authorization', 'req.headers.cookie', '*.token', '*.tokenHash', '*.magicLink', '*.signedUrl'],
      censor: '[REDACTED]',
    },
    ...(config.nodeEnv === 'development'
      ? { transport: { target: 'pino-pretty', options: { colorize: true, singleLine: true } } }
      : {}),
  })
}
