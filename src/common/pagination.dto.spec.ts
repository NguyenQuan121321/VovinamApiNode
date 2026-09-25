import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { PageDto } from './pagination.dto';

/** The shared pagination query is on every list endpoint — lock its contract in. */
describe('PageDto', () => {
  const toDto = (query: Record<string, unknown>) =>
    plainToInstance(PageDto, query, { enableImplicitConversion: false });

  it('accepts valid pagination values as strings (query strings are strings)', async () => {
    const errors = await validate(toDto({ page: '1', limit: '20' }));
    expect(errors).toHaveLength(0);
  });

  it('defaults to page 1 / limit 20 when absent', async () => {
    const dto = toDto({});
    expect(dto.page).toBe(1);
    expect(dto.limit).toBe(20);
    expect(await validate(dto)).toHaveLength(0);
  });

  it('rejects a non-numeric page or limit', async () => {
    expect(await validate(toDto({ page: 'abc' })).then((e) => e.length)).toBeGreaterThan(0);
    expect(await validate(toDto({ limit: 'not-a-number' })).then((e) => e.length)).toBeGreaterThan(
      0,
    );
  });

  it('rejects out-of-range values: page 0, limit 0 and limit over the 100 cap', async () => {
    expect(await validate(toDto({ page: '0' })).then((e) => e.length)).toBeGreaterThan(0);
    expect(await validate(toDto({ page: '-1', limit: '5' })).then((e) => e.length)).toBeGreaterThan(
      0,
    );
    expect(await validate(toDto({ limit: '0' })).then((e) => e.length)).toBeGreaterThan(0);
    expect(await validate(toDto({ limit: '101' })).then((e) => e.length)).toBeGreaterThan(0);
    expect(await validate(toDto({ limit: '100' })).then((e) => e.length)).toBe(0);
  });
});
