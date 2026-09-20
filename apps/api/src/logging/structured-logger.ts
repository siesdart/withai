import type { PinoLogger } from 'nestjs-pino';

export type StructuredLogger = {
  debug(fields: Record<string, unknown>, message: string): void;
  info(fields: Record<string, unknown>, message: string): void;
  warn(fields: Record<string, unknown>, message: string): void;
  error(fields: Record<string, unknown>, message: string): void;
};

export const createStructuredLogger = (logger?: PinoLogger): StructuredLogger => ({
  debug: (fields, message) => logger?.debug(fields, message),
  info: (fields, message) => logger?.info(fields, message),
  warn: (fields, message) => logger?.warn(fields, message),
  error: (fields, message) => logger?.error(fields, message),
});
