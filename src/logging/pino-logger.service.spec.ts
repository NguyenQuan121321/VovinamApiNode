import { pino } from 'pino';
import { PinoLoggerService } from './pino-logger.service';

describe('PinoLoggerService', () => {
  const service = new PinoLoggerService(pino({ enabled: false }));

  it('forwards every Nest log level without throwing', () => {
    expect(() => {
      service.log('message', 'Context');
      service.warn('message', 'Context');
      service.debug('message', 'Context');
      service.verbose('message', 'Context');
      service.fatal('message', 'Context');
      service.error(new Error('boom'), 'stack-trace', 'Context');
      service.error('plain message', undefined, 'Context');
      service.log({ structured: true });
    }).not.toThrow();
  });
});
