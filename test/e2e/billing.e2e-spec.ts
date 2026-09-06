import type { INestApplication } from '@nestjs/common';
import { createHmac } from 'node:crypto';
import bcrypt from 'bcryptjs';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { createApp } from '../../src/bootstrap';

/**
 * P4 acceptance (plan 13): invoices + generate-monthly idempotency, QR payment
 * through the simulated gateway, webhook signature/amount rules, CASH
 * confirmation, refunds and the revenue report. Covers S-03 (duplicate
 * gateway_txn_id, incl. parallel deliveries) and S-11 (bad signature / wrong
 * amount never marks paid).
 */
describe('Billing: invoices and payments (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  const stamp = Date.now();
  const password = 'Str0ngPass';
  const webhookSecret =
    process.env.PAYMENTS_WEBHOOK_SECRET ?? 'e2e-payments-webhook-secret-0123456789';
  const users = {
    admin: `admin-${stamp}@example.com`,
    instructor: `instructor-${stamp}@example.com`,
    student: `student-${stamp}@example.com`,
    parent: `parent-${stamp}@example.com`,
    parentB: `parent-b-${stamp}@example.com`,
  };
  let adminToken = '';
  let studentToken = '';
  let parentToken = '';
  let parentBToken = '';
  let instructorToken = '';
  let studentProfileId = '';
  let classId = '';
  let classWithoutRateId = '';
  let tuitionInvoiceId = '';
  let uniformInvoice1 = '';
  let uniformInvoice2 = '';
  let uniformInvoice3 = '';

  const get = (url: string, token?: string) => {
    const req = request(app.getHttpServer()).get(url);
    return token === undefined ? req : req.set('Authorization', `Bearer ${token}`);
  };
  const send = (
    method: 'post' | 'patch' | 'delete',
    url: string,
    body: unknown,
    token?: string,
  ) => {
    const agent = request(app.getHttpServer());
    const req =
      method === 'post'
        ? agent.post(url)
        : method === 'patch'
          ? agent.patch(url)
          : agent.delete(url);
    const withAuth = token === undefined ? req : req.set('Authorization', `Bearer ${token}`);
    return withAuth.set('Content-Type', 'application/json').send(body as object);
  };

  const sign = (body: string): string =>
    createHmac('sha256', webhookSecret).update(body).digest('hex');
  const webhook = (payload: object, signature?: string) => {
    const raw = JSON.stringify(payload);
    return request(app.getHttpServer())
      .post('/api/v1/payments/webhook/simulated')
      .set('Content-Type', 'application/json')
      .set('x-signature', signature ?? sign(raw))
      .send(raw);
  };

  const login = async (email: string): Promise<string> => {
    const res = await send('post', '/api/v1/auth/login', { email, password }).expect(200);
    return res.body.data.tokens.accessToken as string;
  };

  const createUniformInvoice = async (): Promise<string> => {
    const res = await send(
      'post',
      '/api/v1/invoices',
      {
        studentId: studentProfileId,
        type: 'UNIFORM',
        items: [{ description: 'Club uniform', quantity: 1, unitAmount: 200000 }],
      },
      adminToken,
    ).expect(201);
    return res.body.data.id as string;
  };

  const qrRequest = async (invoiceId: string): Promise<{ orderRef: string; amount: number }> => {
    const res = await send('post', `/api/v1/payments/qr/${invoiceId}`, {}, studentToken).expect(
      201,
    );
    return { orderRef: res.body.data.orderRef as string, amount: res.body.data.amount as number };
  };

  const successCount = async (invoiceId: string): Promise<number> => {
    const res = await get(`/api/v1/payments?invoiceId=${invoiceId}`, adminToken).expect(200);
    return (res.body.data.items as Array<{ status: string }>).filter((p) => p.status === 'SUCCESS')
      .length;
  };

  beforeAll(async () => {
    if (process.env.DATABASE_URL === undefined || process.env.DATABASE_URL === '') {
      throw new Error('DATABASE_URL must be set for e2e tests');
    }
    app = await createApp();
    await app.init();
    prisma = new PrismaClient();
    const passwordHash = await bcrypt.hash(password, 10);
    const rows: Array<[keyof typeof users, 'ADMIN' | 'STUDENT' | 'PARENT' | 'INSTRUCTOR']> = [
      ['admin', 'ADMIN'],
      ['instructor', 'INSTRUCTOR'],
      ['student', 'STUDENT'],
      ['parent', 'PARENT'],
      ['parentB', 'PARENT'],
    ];
    for (const [key, role] of rows) {
      await prisma.user.upsert({
        where: { email: users[key] },
        update: {},
        create: { email: users[key], passwordHash, role, emailVerifiedAt: new Date() },
      });
    }
    adminToken = await login(users.admin);
    studentToken = await login(users.student);
    parentToken = await login(users.parent);
    parentBToken = await login(users.parentB);
    instructorToken = await login(users.instructor);

    const adminId = (await prisma.user.findUniqueOrThrow({ where: { email: users.admin } })).id;
    const profile = await send(
      'post',
      '/api/v1/students',
      {
        fullName: 'Nguyen Van A',
        dob: '2005-06-15',
        gender: 'MALE',
        linkedUserEmail: users.student,
      },
      adminToken,
    ).expect(201);
    studentProfileId = profile.body.data.id as string;
    const regen = await send(
      'post',
      `/api/v1/students/${studentProfileId}/invite-code`,
      {},
      adminToken,
    ).expect(200);
    await send(
      'post',
      '/api/v1/parents/link',
      { inviteCode: regen.body.data.inviteCode },
      parentToken,
    ).expect(201);

    const cls = await send(
      'post',
      '/api/v1/classes',
      {
        name: `Billing class ${stamp}`,
        instructorId: (await prisma.user.findUniqueOrThrow({ where: { email: users.instructor } }))
          .id,
      },
      adminToken,
    ).expect(201);
    classId = cls.body.data.id as string;
    const second = await send(
      'post',
      '/api/v1/classes',
      {
        name: `No-rate class ${stamp}`,
        instructorId: (await prisma.user.findUniqueOrThrow({ where: { email: users.instructor } }))
          .id,
      },
      adminToken,
    ).expect(201);
    classWithoutRateId = second.body.data.id as string;
    await send(
      'post',
      '/api/v1/enrollments',
      { studentId: studentProfileId, classId },
      adminToken,
    ).expect(201);

    // Club configuration for the billing flow (seed-equivalent, values per test run).
    await prisma.appSetting.upsert({
      where: { key: 'tuition_rates' },
      create: { key: 'tuition_rates', value: { [classId]: 500000 } },
      update: { value: { [classId]: 500000 } },
    });
    await prisma.appSetting.upsert({
      where: { key: 'bank_account' },
      create: {
        key: 'bank_account',
        value: { owner_type: 'BUSINESS', bin: '9704', number: '0123456789', name: 'CLUB LLC' },
      },
      update: {
        value: { owner_type: 'BUSINESS', bin: '9704', number: '0123456789', name: 'CLUB LLC' },
      },
    });
    void adminId;
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  it('generate-monthly is idempotent per (student, period) and skips classes without rates', async () => {
    const first = await send(
      'post',
      '/api/v1/admin/billing/generate-monthly',
      { month: 10, year: 2026, classIds: [classId, classWithoutRateId] },
      adminToken,
    ).expect(200);
    expect(first.body.data.created).toBe(1);
    expect(first.body.data.skippedExisting).toBe(0);
    expect(first.body.data.classesSkipped).toEqual([
      { classId: classWithoutRateId, reason: 'no tuition rate configured' },
    ]);

    const again = await send(
      'post',
      '/api/v1/admin/billing/generate-monthly',
      { month: 10, year: 2026, classIds: [classId] },
      adminToken,
    ).expect(200);
    expect(again.body.data.created).toBe(0);
    expect(again.body.data.skippedExisting).toBe(1);

    await send(
      'post',
      '/api/v1/admin/billing/generate-monthly',
      { month: 10, year: 2026, classIds: [classId] },
      studentToken,
    ).expect(403);

    const list = await get('/api/v1/invoices?type=TUITION', adminToken).expect(200);
    const mine = (list.body.data.items as Array<Record<string, unknown>>).find(
      (i) => i.periodMonth === 10 && i.periodYear === 2026,
    );
    expect(mine).toBeDefined();
    tuitionInvoiceId = mine!.id as string;
  });

  it('scopes invoice reads per role (plan 7.4): instructor sees nothing', async () => {
    const own = await get('/api/v1/invoices', studentToken).expect(200);
    expect(own.body.data.total).toBeGreaterThanOrEqual(1);

    const children = await get('/api/v1/invoices', parentToken).expect(200);
    expect(children.body.data.total).toBe(own.body.data.total);
    const stranger = await get('/api/v1/invoices', parentBToken).expect(200);
    expect(stranger.body.data.total).toBe(0);

    await get('/api/v1/invoices', instructorToken).expect(403);
    const detail = await get(`/api/v1/invoices/${tuitionInvoiceId}`, instructorToken).expect(404);
    void detail;
    await get(`/api/v1/invoices/${tuitionInvoiceId}`, studentToken).expect(200);
    await get(`/api/v1/invoices/${tuitionInvoiceId}`, parentBToken).expect(404);
  });

  it('QR + verified webhook marks the invoice PAID; bad signature and wrong amount never do (S-11)', async () => {
    const qr = await qrRequest(tuitionInvoiceId);
    expect(qr.amount).toBe(500000);

    // Bad signature: 401 and no state change.
    await webhook(
      { orderRef: qr.orderRef, gatewayTxnId: `GW-${stamp}-A`, amount: qr.amount, success: true },
      'deadbeef',
    ).expect(401);
    await expect(successCount(tuitionInvoiceId)).resolves.toBe(0);

    // Wrong amount: accepted (200) but flagged, invoice stays UNPAID.
    await webhook({
      orderRef: qr.orderRef,
      gatewayTxnId: `GW-${stamp}-B`,
      amount: 500,
      success: true,
    }).expect(200);
    await expect(successCount(tuitionInvoiceId)).resolves.toBe(0);
    const afterMismatch = await get(
      `/api/v1/payments?invoiceId=${tuitionInvoiceId}`,
      adminToken,
    ).expect(200);
    expect(
      (afterMismatch.body.data.items as Array<{ status: string; orderRef: string }>).find(
        (p) => p.orderRef === qr.orderRef,
      ),
    ).toMatchObject({ status: 'DISPUTED' });
    const stillUnpaid = await get(`/api/v1/invoices/${tuitionInvoiceId}`, adminToken).expect(200);
    expect(stillUnpaid.body.data.status).toBe('UNPAID');

    // A new QR attempt for the still-unpaid invoice settles with the exact amount
    // (the flagged transaction is terminal and cannot be reused).
    const retry = await qrRequest(tuitionInvoiceId);
    expect(retry.orderRef).not.toBe(qr.orderRef);
    await webhook({
      orderRef: retry.orderRef,
      gatewayTxnId: `GW-${stamp}-C`,
      amount: retry.amount,
      success: true,
    }).expect(200);
    const paid = await get(`/api/v1/invoices/${tuitionInvoiceId}`, parentToken).expect(200);
    expect(paid.body.data.status).toBe('PAID');
  });

  it('processes duplicate gateway_txn_id once, including parallel deliveries (S-03)', async () => {
    uniformInvoice1 = await createUniformInvoice();
    uniformInvoice2 = await createUniformInvoice();

    // Sequential duplicate: second delivery is a 200 no-op.
    const qr1 = await qrRequest(uniformInvoice1);
    const payload1 = {
      orderRef: qr1.orderRef,
      gatewayTxnId: `GW-${stamp}-D`,
      amount: qr1.amount,
      success: true,
    };
    await webhook(payload1).expect(200);
    await webhook(payload1).expect(200);
    await expect(successCount(uniformInvoice1)).resolves.toBe(1);

    // Parallel duplicates of one event: exactly one wins.
    const qr2 = await qrRequest(uniformInvoice2);
    const payload2 = {
      orderRef: qr2.orderRef,
      gatewayTxnId: `GW-${stamp}-E`,
      amount: qr2.amount,
      success: true,
    };
    const [a, b] = await Promise.all([webhook(payload2), webhook(payload2)]);
    expect([a.status, b.status]).toEqual([200, 200]);
    const processed = [a.body.data.processed, b.body.data.processed].filter(Boolean).length;
    expect(processed).toBe(1);
    await expect(successCount(uniformInvoice2)).resolves.toBe(1);
    const paid = await get(`/api/v1/invoices/${uniformInvoice2}`, adminToken).expect(200);
    expect(paid.body.data.status).toBe('PAID');
  });

  it('CASH confirmation is admin-only and idempotent (plan 7.5)', async () => {
    uniformInvoice3 = await createUniformInvoice();
    await send(
      'post',
      `/api/v1/payments/${uniformInvoice3}/confirm-cash`,
      { note: 'Paid at the club' },
      studentToken,
    ).expect(403);
    await send(
      'post',
      `/api/v1/payments/${uniformInvoice3}/confirm-cash`,
      { note: 'Paid at the club' },
      adminToken,
    ).expect(200);
    await send(
      'post',
      `/api/v1/payments/${uniformInvoice3}/confirm-cash`,
      { note: 'Duplicate' },
      adminToken,
    ).expect(409);
    const paid = await get(`/api/v1/invoices/${uniformInvoice3}`, adminToken).expect(200);
    expect(paid.body.data.status).toBe('PAID');
  });

  it('refund re-derives the invoice to UNPAID and the revenue report aggregates by month/channel', async () => {
    // Refund the bank-transfer payment of the parallel-duplicate invoice; the
    // CASH payment of invoice 3 stays SUCCESS so the revenue report keeps both.
    const payments = await get(`/api/v1/payments?invoiceId=${uniformInvoice2}`, adminToken).expect(
      200,
    );
    const transfer = (
      payments.body.data.items as Array<{ id: string; gateway: string; status: string }>
    ).find((p) => p.gateway === 'BANK_TRANSFER' && p.status === 'SUCCESS');
    if (transfer === undefined) {
      throw new Error('Expected a successful BANK_TRANSFER payment');
    }

    await send(
      'patch',
      `/api/v1/payments/${transfer.id}`,
      { status: 'REFUNDED', note: 'Refunded in person' },
      adminToken,
    ).expect(200);
    const after = await get(`/api/v1/invoices/${uniformInvoice2}`, adminToken).expect(200);
    expect(after.body.data.status).toBe('UNPAID');

    await send(
      'patch',
      `/api/v1/payments/${transfer.id}`,
      { status: 'REFUNDED' },
      studentToken,
    ).expect(403);

    const revenue = await get(
      '/api/v1/admin/reports/revenue?from=2026-01-01&to=2026-12-31',
      adminToken,
    ).expect(200);
    expect(revenue.body.data.grandTotal).toBeGreaterThan(0);
    const gateways = (revenue.body.data.rows as Array<{ gateway: string }>).map((r) => r.gateway);
    expect(gateways).toContain('BANK_TRANSFER');
    expect(gateways).toContain('CASH');
    await get('/api/v1/admin/reports/revenue?from=2026-01-01&to=2026-12-31', studentToken).expect(
      403,
    );
  });
});
