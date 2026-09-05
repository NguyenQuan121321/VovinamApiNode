import 'reflect-metadata';
import { writeFileSync } from 'node:fs';
import { SwaggerModule } from '@nestjs/swagger';
import { createApp, buildOpenApiDocumentConfig } from '../src/bootstrap';

/**
 * Generates the committed OpenAPI contract (openapi.json) without opening a
 * database connection: module compilation is enough to build the document, so
 * DATABASE_URL only has to pass validation, never to answer.
 *
 * CI regenerates this file and fails when it is stale, then compares it against
 * the previous commit with oasdiff to block breaking changes.
 */
async function main(): Promise<void> {
  process.env.SWAGGER_ENABLED = 'true';
  const app = await createApp();
  const document = SwaggerModule.createDocument(app, buildOpenApiDocumentConfig());
  writeFileSync('openapi.json', `${JSON.stringify(document, null, 2)}\n`, 'utf8');
  console.info(`openapi.json written (${Object.keys(document.paths ?? {}).length} paths)`);
}

void main();
