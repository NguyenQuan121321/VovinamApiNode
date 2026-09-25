import { CONTRACT, TAG_DESCRIPTIONS, type OpContract } from './contract';
import { RESPONSE_COMPONENTS, envelopeError, envelopeOf, type JsonSchema } from './schema-kit';

/**
 * Applies the committed per-operation contract (contract.ts) onto the document
 * @nestjs/swagger generated from decorators, and registers the shared response
 * schemas. Called by BOTH runtime Swagger (bootstrap) and
 * scripts/generate-openapi.ts, so /docs-json and openapi.json can never drift
 * apart.
 *
 * Fail-loud by design: an operation without a contract entry, or a contract
 * entry without an operation, throws — a route cannot ship undocumented, and a
 * renamed/deleted route cannot leave stale metadata behind.
 */

interface OperationObject {
  summary?: string;
  description?: string;
  operationId?: string;
  tags?: string[];
  security?: Array<Record<string, string[]>>;
  parameters?: Array<Record<string, unknown>>;
  requestBody?: Record<string, unknown>;
  responses?: Record<string, unknown>;
}

type DocumentLike = {
  info: { title: string; version: string; description?: string };
  paths: Record<string, Record<string, OperationObject>>;
  components: { schemas: Record<string, JsonSchema> } & Record<string, unknown>;
  tags?: Array<{ name: string; description: string }>;
  security?: Array<Record<string, string[]>>;
};

const HTTP_METHODS = new Set(['get', 'post', 'put', 'patch', 'delete']);
const BEARER_SECURITY = [{ bearer: [] }];

const INFO_DESCRIPTION = [
  'Vovinam club management API.',
  '',
  '## Response envelope',
  'Every JSON response — success AND error — uses the uniform envelope',
  '`{"code": <HTTP status>, "message": string, "data": <payload>}`.',
  '`data` is the operation-specific payload documented per endpoint below and',
  'is `null` on errors. `/metrics` is the only exception (raw Prometheus text).',
  '',
  '## Authentication',
  '- Endpoints marked with the lock icon require `Authorization: Bearer <accessToken>`',
  '  (JWT from POST /auth/login).',
  '- Role requirements are stated per endpoint; ownership-scoped endpoints answer',
  '  the same uniform 404 for foreign and unknown ids (no probing).',
  '- Public endpoints (auth flows, /healthz, /readyz, payment webhook) carry no security.',
  '  The payment webhook authenticates via HMAC signature over the raw body, not a JWT.',
  '  /metrics authenticates with the METRICS_TOKEN bearer token.',
  '',
  '## Errors',
  'Errors use the same envelope (`data: null`) with `message` describing the',
  'failure; per-endpoint error catalogs list the statuses each route can produce.',
].join('\n');

export function enrichOpenApiDocument<T extends object>(document: T): T {
  const doc = document as unknown as DocumentLike;
  const seen = new Set<string>();
  const problems: string[] = [];

  for (const [path, pathItem] of Object.entries(doc.paths ?? {})) {
    for (const [method, operation] of Object.entries(pathItem)) {
      if (!HTTP_METHODS.has(method)) continue;
      const key = `${method.toUpperCase()} ${path}`;
      const meta = CONTRACT[key];
      if (meta === undefined) {
        problems.push(`no contract entry for operation "${key}"`);
        continue;
      }
      seen.add(key);
      applyContract(operation, meta, key, problems);
    }
  }

  for (const key of Object.keys(CONTRACT)) {
    if (!seen.has(key)) {
      problems.push(`contract entry "${key}" matches no operation`);
    }
  }
  if (problems.length > 0) {
    throw new Error(`OpenAPI contract is incomplete:\n  - ${problems.join('\n  - ')}`);
  }

  doc.components.schemas = {
    ...doc.components.schemas,
    ...RESPONSE_COMPONENTS,
    ErrorEnvelope: envelopeError(),
  };
  doc.info.description = INFO_DESCRIPTION;
  doc.tags = Object.entries(TAG_DESCRIPTIONS).map(([name, description]) => ({ name, description }));
  return document;
}

function applyContract(
  operation: OperationObject,
  meta: OpContract,
  key: string,
  problems: string[],
): void {
  operation.summary = meta.summary;
  operation.description = [
    meta.description,
    meta.roles === undefined ? '' : `**Roles:** ${meta.roles.join(', ')}.`,
  ]
    .filter((part) => part !== '')
    .join('\n\n');
  operation.security = meta.auth === 'public' || meta.auth === 'webhook' ? [] : BEARER_SECURITY;

  if (meta.query !== undefined && meta.query.length > 0) {
    // Keep the path parameters @nestjs/swagger generated from the controllers;
    // the contract entries only contribute query parameters.
    const pathParams = (operation.parameters ?? []).filter((param) => param['in'] === 'path');
    operation.parameters = [
      ...pathParams,
      ...meta.query.map((param) => ({
        name: param.name,
        in: 'query',
        required: param.required ?? false,
        description: param.description,
        schema: param.schema,
      })),
    ];
  }

  if (meta.requestExample !== undefined) {
    const body = operation.requestBody as
      { content?: Record<string, { example?: Record<string, unknown> }> } | undefined;
    const json = body?.content?.['application/json'];
    if (json === undefined) {
      problems.push(`"${key}" declares a request example but exposes no JSON body`);
    } else {
      json.example = meta.requestExample;
    }
  }

  const responses: Record<string, unknown> = {};
  const status = String(meta.status ?? 200);
  if (meta.auth === 'metrics') {
    responses[status] = {
      description: meta.dataDescription ?? 'Prometheus text exposition.',
      content: {
        'text/plain; version=0.0.4; charset=utf-8': { schema: { type: 'string' } },
      },
    };
  } else if (meta.data !== undefined) {
    responses[status] = {
      description:
        meta.dataDescription ??
        `${status === '201' ? 'Resource created' : 'Success'}; the envelope wraps the documented data.`,
      content: { 'application/json': { schema: envelopeOf(meta.data) } },
    };
  } else {
    problems.push(`"${key}" documents no response data`);
  }
  for (const error of meta.errors ?? []) {
    responses[String(error.status)] = {
      description: error.description,
      content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorEnvelope' } } },
    };
  }
  operation.responses = responses;
}
