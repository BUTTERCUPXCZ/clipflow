import type { Params } from 'nestjs-pino';

// Terminal: one readable colored line per event. Piped/redirected: structured JSON for log tooling.
const pretty = process.stdout.isTTY === true;

export const loggerParams: Params = {
  pinoHttp: {
    redact: ['req.headers.authorization', 'req.headers.cookie'],
    customSuccessMessage: (req, res, ms) => `${req.method} ${req.url} → ${res.statusCode} (${Math.round(ms)} ms)`,
    customErrorMessage: (req, res, err) => `${req.method} ${req.url} → ${res.statusCode} failed: ${err.message}`,
    transport: pretty
      ? {
          target: 'pino-pretty',
          options: {
            colorize: true,
            singleLine: true,
            translateTime: 'SYS:HH:MM:ss',
            // req/res/responseTime are already in the message; keep them in JSON mode only.
            ignore: 'pid,hostname,context,req,res,responseTime',
            messageFormat: '{if context}[{context}] {end}{msg}',
          },
        }
      : undefined,
  },
};
