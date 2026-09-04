import { ConfigService } from '@nestjs/config';
import type { DestinationStream } from 'pino';
import { EnvService } from '../config/env.service';
import type { Env } from '../config/env.validation';
import { createAppLogger } from './pino-logger.factory';

function makeEnvService(): EnvService {
  return new EnvService(new ConfigService({ NODE_ENV: 'local' }) as ConfigService<Env, true>);
}

describe('createAppLogger', () => {
  it('redacts secret-shaped fields from the output', () => {
    const lines: string[] = [];
    const destination: DestinationStream = {
      write: (line: string): void => {
        lines.push(line);
      },
    };
    const logger = createAppLogger(makeEnvService(), destination);

    logger.info({ password: 'hunter2', authorization: 'Bearer xyz' }, 'login attempt');

    expect(lines).toHaveLength(1);
    expect(lines[0]).not.toContain('hunter2');
    expect(lines[0]).not.toContain('Bearer xyz');
    expect(lines[0]).toContain('[REDACTED]');
  });

  it('writes valid JSON lines', () => {
    const lines: string[] = [];
    const destination: DestinationStream = {
      write: (line: string): void => {
        lines.push(line);
      },
    };
    createAppLogger(makeEnvService(), destination).info('plain');
    expect(() => JSON.parse(lines[0] ?? '')).not.toThrow();
  });
});
