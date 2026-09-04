import { Injectable, type LoggerService } from '@nestjs/common';
import type { Logger } from 'pino';

/** Bridges the Nest logger surface onto the pino instance so framework logs share the JSON pipeline. */
@Injectable()
export class PinoLoggerService implements LoggerService {
  constructor(private readonly logger: Logger) {}

  log(message: unknown, context?: string): void {
    this.write('info', message, context);
  }

  error(message: unknown, trace?: string, context?: string): void {
    const text =
      message instanceof Error
        ? message.message
        : typeof message === 'string'
          ? message
          : JSON.stringify(message);
    this.logger.error({ context, trace }, text);
  }

  warn(message: unknown, context?: string): void {
    this.write('warn', message, context);
  }

  debug(message: unknown, context?: string): void {
    this.write('debug', message, context);
  }

  verbose(message: unknown, context?: string): void {
    this.write('trace', message, context);
  }

  fatal(message: unknown, context?: string): void {
    this.write('fatal', message, context);
  }

  private write(
    level: 'info' | 'warn' | 'debug' | 'trace' | 'fatal',
    message: unknown,
    context?: string,
  ): void {
    if (typeof message === 'string') {
      this.logger[level]({ context }, message);
    } else {
      this.logger[level]({ context, data: message }, '');
    }
  }
}
