import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createApp } from '../../src/bootstrap';

describe('Swagger (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    if (process.env.DATABASE_URL === undefined || process.env.DATABASE_URL === '') {
      throw new Error('DATABASE_URL must be set for e2e tests');
    }
    app = await createApp();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('serves the OpenAPI document when enabled', () =>
    request(app.getHttpServer())
      .get('/docs-json')
      .expect(200)
      .expect((res) => {
        expect(res.body.info.title).toBe('VovinamApiNode');
        expect(res.body.paths['/healthz']).toBeDefined();
      }));

  it('serves Swagger UI', () =>
    request(app.getHttpServer()).get('/docs').expect(200).expect('Content-Type', /html/));
});
