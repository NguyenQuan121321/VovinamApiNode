import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { CONTRACT, TAG_DESCRIPTIONS } from './contract';
import { enrichOpenApiDocument } from './enrich-openapi';

interface OpLike {
  summary?: string;
  description?: string;
  security?: Array<Record<string, string[]>>;
  parameters?: Array<Record<string, unknown>>;
  responses?: Record<string, unknown>;
  requestBody?: Record<string, unknown>;
}

interface DocLike {
  info: { description?: string };
  paths: Record<string, Record<string, OpLike>>;
  components: { schemas: Record<string, unknown> };
  tags?: Array<{ name: string; description: string }>;
}

/** The committed contract document, enriched exactly like runtime Swagger does. */
const committed = JSON.parse(readFileSync(join(process.cwd(), 'openapi.json'), 'utf8')) as DocLike;
const enriched = enrichOpenApiDocument(JSON.parse(JSON.stringify(committed))) as unknown as DocLike;

function operationsOf(doc: DocLike): Array<{ key: string; op: OpLike }> {
  return Object.entries(doc.paths).flatMap(([path, item]) =>
    Object.entries(item)
      .filter(([method]) => ['get', 'post', 'put', 'patch', 'delete'].includes(method))
      .map(([method, op]) => ({ key: `${method.toUpperCase()} ${path}`, op })),
  );
}

describe('OpenAPI contract coverage', () => {
  const committedKeys = operationsOf(committed).map(({ key }) => key);

  it('has a contract entry for every committed operation', () => {
    const missing = committedKeys.filter((key) => CONTRACT[key] === undefined);
    expect(missing).toEqual([]);
  });

  it('has no stale contract entries', () => {
    const stale = Object.keys(CONTRACT).filter((key) => !committedKeys.includes(key));
    expect(stale).toEqual([]);
  });

  it('enrichment fails loudly on missing and stale entries', () => {
    const staleDoc = JSON.parse(JSON.stringify(committed)) as DocLike;
    delete staleDoc.paths['/api/v1/students'];
    expect(() => enrichOpenApiDocument(staleDoc)).toThrow(/matches no operation/);

    const missingDoc = JSON.parse(JSON.stringify(committed)) as DocLike;
    missingDoc.paths['/api/v1/ghost-route'] = {
      get: { summary: 'Ghost route' },
    };
    expect(() => enrichOpenApiDocument(missingDoc)).toThrow(/no contract entry/);
  });
});

describe('Enriched contract quality', () => {
  const operations = operationsOf(enriched);

  it('documents every operation with a meaningful summary and description', () => {
    const weak = operations.filter(
      ({ op }) =>
        op.summary === undefined ||
        op.summary.length < 10 ||
        op.description === undefined ||
        op.description.length < 40,
    );
    expect(weak.map(({ key }) => key)).toEqual([]);
  });

  it('declares security matching the contract auth class on every operation', () => {
    const insecure = operations.filter(({ op }) => op.security === undefined);
    expect(insecure.map(({ key }) => key)).toEqual([]);
    for (const { key, op } of operations) {
      const meta = CONTRACT[key];
      if (meta === undefined) throw new Error(`contract entry missing for ${key}`);
      const expected = meta.auth === 'public' || meta.auth === 'webhook' ? [] : [{ bearer: [] }];
      expect(op.security).toEqual(expected);
    }
    // Spot-check the documented posture: public surfaces are explicit, the rest
    // require the JWT bearer.
    expect(
      operations.find(({ key }) => key === 'POST /api/v1/payments/webhook/{provider}')?.op.security,
    ).toEqual([]);
    expect(operations.find(({ key }) => key === 'GET /api/v1/invoices')?.op.security).toEqual([
      { bearer: [] },
    ]);
  });

  it('keeps controller path parameters when adding documented query parameters', () => {
    const history = operations.find(({ key }) => key === 'GET /api/v1/students/{id}/attendance');
    expect(history).toBeDefined();
    const params = history?.op.parameters ?? [];
    const pathParam = params.find((param) => param['in'] === 'path');
    expect(pathParam).toMatchObject({ name: 'id', required: true });
    expect(params.some((param) => param['name'] === 'page')).toBe(true);
  });

  it('wraps every JSON success response in the documented envelope', () => {
    const unenveloped = operations
      .filter(({ key }) => key !== 'GET /metrics')
      .filter(
        ({ op }) => op.responses?.['200'] !== undefined || op.responses?.['201'] !== undefined,
      )
      .filter(({ op }) => {
        const response = op.responses?.['200'] ?? op.responses?.['201'];
        const schema = (
          response as { content?: Record<string, { schema?: Record<string, unknown> }> }
        )?.content?.['application/json']?.schema;
        const properties = schema?.properties as Record<string, unknown> | undefined;
        return properties?.code === undefined || properties?.data === undefined;
      });
    expect(unenveloped.map(({ key }) => key)).toEqual([]);
    // /metrics intentionally returns raw Prometheus text, not the envelope.
    expect(
      operations.find(({ key }) => key === 'GET /metrics')?.op.responses?.['200'],
    ).toBeDefined();
  });

  it('gives every operation at least one documented error status except trivial reads', () => {
    const bare = operations.filter(({ op }) => Object.keys(op.responses ?? {}).length < 2);
    // 200-only operations are acceptable for simple scoped reads; everything
    // else must document its errors.
    const allowed = new Set([
      'GET /healthz',
      'GET /readyz',
      'GET /api/v1/belt-ranks',
      'GET /api/v1/consent/me',
      'GET /api/v1/auth/sessions',
      'GET /api/v1/parents/me/children',
    ]);
    expect(bare.map(({ key }) => key).filter((key) => !allowed.has(key))).toEqual([]);
  });

  it('registers every referenced response component', () => {
    const schemas = enriched.components.schemas;
    const referenced = new Set<string>();
    const walk = (node: unknown): void => {
      if (Array.isArray(node)) {
        node.forEach(walk);
        return;
      }
      if (node !== null && typeof node === 'object') {
        for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
          if (
            key === '$ref' &&
            typeof value === 'string' &&
            value.startsWith('#/components/schemas/')
          ) {
            referenced.add(value.slice('#/components/schemas/'.length));
          } else {
            walk(value);
          }
        }
      }
    };
    walk(enriched.paths);
    const unresolved = [...referenced].filter((name) => schemas[name] === undefined);
    expect(unresolved).toEqual([]);
  });

  it('exposes the tag descriptions for Swagger UI', () => {
    expect(enriched.tags?.length).toBe(Object.keys(TAG_DESCRIPTIONS).length);
    for (const tag of enriched.tags ?? []) {
      expect(tag.description.length).toBeGreaterThan(10);
    }
  });

  it('explains the envelope and auth model at the top level', () => {
    expect(enriched.info.description).toContain('"code"');
    expect(enriched.info.description).toContain('Bearer');
    expect(enriched.info.description).toContain('404');
  });
});
