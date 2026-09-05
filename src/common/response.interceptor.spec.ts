import { of } from 'rxjs';
import type { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { SkipEnvelope } from './envelope';
import { ResponseInterceptor } from './response.interceptor';

class DemoController {
  @SkipEnvelope()
  skipped(): string {
    return 'raw';
  }

  enveloped(): { id: number } {
    return { id: 1 };
  }
}

describe('ResponseInterceptor', () => {
  const reflector = new Reflector();

  const makeContext = (handler: () => unknown, statusCode: number): ExecutionContext =>
    ({
      getHandler: () => handler,
      getClass: () => DemoController,
      switchToHttp: () => ({
        getResponse: () => ({ statusCode }),
        getRequest: () => ({}),
      }),
    }) as unknown as ExecutionContext;

  const collect = (result: unknown): unknown[] => {
    const seen: unknown[] = [];
    of(result).subscribe({ next: (value) => seen.push(value) });
    return seen;
  };

  it('wraps 2xx payloads into the uniform envelope', () => {
    const interceptor = new ResponseInterceptor<{ id: number }>(reflector);
    const output: unknown[] = [];
    interceptor
      .intercept(makeContext(DemoController.prototype.enveloped, 201), {
        handle: () => of({ id: 1 }),
      })
      .subscribe((value) => output.push(value));
    expect(output).toEqual([{ code: 201, message: 'Created', data: { id: 1 } }]);
  });

  it('maps an undefined body to data null', () => {
    const interceptor = new ResponseInterceptor<void>(reflector);
    const output: unknown[] = [];
    interceptor
      .intercept(makeContext(DemoController.prototype.enveloped, 200), {
        handle: () => of(undefined),
      })
      .subscribe((value) => output.push(value));
    expect(output).toEqual([{ code: 200, message: 'OK', data: null }]);
  });

  it('leaves handlers flagged with SkipEnvelope untouched', () => {
    const interceptor = new ResponseInterceptor<string>(reflector);
    const output: unknown[] = [];
    interceptor
      .intercept(makeContext(DemoController.prototype.skipped, 200), { handle: () => of('raw') })
      .subscribe((value) => output.push(value));
    expect(output).toEqual(['raw']);
  });

  it('collect helper sanity (of emits once)', () => {
    expect(collect('x')).toEqual(['x']);
  });
});
