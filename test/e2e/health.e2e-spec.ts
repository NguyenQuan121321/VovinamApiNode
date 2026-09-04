import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createApp } from '../../src/bootstrap';

const METRICS_TOKEN = 'e2e-metrics-token-0123456789';

describe('Health and ops endpoints (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    if (process.env.DATABASE_URL === undefined || process.env.DATABASE_URL === '') {
      throw new Error('DATABASE_URL must be set for e2e tests');
    }
    process.env.METRICS_TOKEN = METRICS_TOKEN;
    app = await createApp();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('GET /healthz answers 200 inside the uniform envelope with a request id', () =>
    request(app.getHttpServer())
      .get('/healthz')
      .expect(200)
      .expect((res) => {
        expect(res.body).toEqual({ code: 200, message: 'OK', data: { status: 'ok' } });
        expect(res.headers['x-request-id']).toBeDefined();
      }));

  it('GET /readyz answers 200 when the database is reachable', () =>
    request(app.getHttpServer())
      .get('/readyz')
      .expect(200)
      .expect((res) => {
        expect(res.body.data).toEqual({ status: 'ok', database: 'up' });
      }));

  it('GET /metrics rejects a missing or wrong bearer token', async () => {
    const server = app.getHttpServer();
    await request(server).get('/metrics').expect(401);
    await request(server).get('/metrics').set('Authorization', 'Bearer wrong').expect(401);
  });

  it('GET /metrics returns raw Prometheus text for the correct bearer', () =>
    request(app.getHttpServer())
      .get('/metrics')
      .set('Authorization', `Bearer ${METRICS_TOKEN}`)
      .expect(200)
      .expect('Content-Type', /text\/plain/)
      .expect((res) => {
        expect(res.text).toContain('http_request_duration_seconds');
        expect(res.text).not.toContain('"code":200');
      }));

  it('unknown API routes return the 404 envelope', () =>
    request(app.getHttpServer())
      .get('/api/v1/does-not-exist')
      .expect(404)
      .expect((res) => {
        expect(res.body.code).toBe(404);
        expect(res.body.data).toBeNull();
      }));

  it('rejects request bodies over the 1 MB cap', () =>
    request(app.getHttpServer())
      .post('/api/v1/students')
      .set('Content-Type', 'application/json')
      .send({ padding: 'x'.repeat(2 * 1024 * 1024) })
      .expect(413)
      .expect((res) => {
        expect(res.body).toEqual({ code: 413, message: 'Payload too large', data: null });
      }));
});
