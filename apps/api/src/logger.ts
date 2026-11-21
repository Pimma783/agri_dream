import { pino, type Logger } from 'pino';

/** Keys never written to logs. `*.x` covers one nesting level, so both forms are listed. */
const SENSITIVE_KEYS = [
  'authorization',
  'cookie',
  'set-cookie',
  'x-line-signature',
  'password',
  'passwordHash',
  'channelSecret',
  'channel_secret',
  'accessToken',
  'access_token',
  'token',
  'sessionToken',
  'csrf_secret',
  'csrfToken',
  'x-csrf-token',
  'agrimatch_sid',
  'token_hash',
  'linkCode',
  'link_code',
  'code',
  'text',
  'replyToken',
];

export const REDACT_PATHS: string[] = [
  ...SENSITIVE_KEYS,
  ...SENSITIVE_KEYS.map((k) => `*.${k}`),
  ...SENSITIVE_KEYS.map((k) => `*.*.${k}`),
  ...SENSITIVE_KEYS.map((k) => `req.headers["${k}"]`),
  ...SENSITIVE_KEYS.map((k) => `res.headers["${k}"]`),
  'message.text',
  'events[*].message.text',
  'events[*].replyToken',
  '*.events[*].message.text',
  '*.events[*].replyToken',
];

export function createLogger(level = 'info', destination?: pino.DestinationStream): Logger {
  const opts: pino.LoggerOptions = {
    level,
    redact: { paths: REDACT_PATHS, censor: '[REDACTED]' },
  };
  return destination ? pino(opts, destination) : pino(opts);
}
