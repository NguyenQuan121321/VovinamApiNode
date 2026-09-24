// Thesis-scale load smoke (plan 12 / TASK-05): measures throughput, p50/p95/p99
// latency and error rate for a small endpoint mix, plus process CPU/RSS scraped
// from /metrics. Uses only the repo's own runtime deps (fetch, @prisma/client,
// bcryptjs, otplib); not a runtime component.
//
// Scenarios (recorded workload assumption: ~300 users, one club, single instance):
//   healthz   GET /healthz           — no auth, no DB: HTTP-stack floor
//   readyz    GET /readyz            — SELECT 1: DB round-trip + HTTP overhead
//   classes   GET /api/v1/classes    — any-authenticated indexed DB read (page 1)
//   invoices  GET /api/v1/invoices   — ADMIN route: exercises the ADMIN MFA guard path
//
// Setup: parses the repo .env (Windows node does not inherit WSL env vars),
// seeds an ADMIN + INSTRUCTOR directly through Prisma (verified emails; an
// existing admin with MFA is never overwritten), logs in, enrolls TOTP over the
// real API (ADMIN MFA enforcement, plan 4.1), then creates a small dataset
// (20 classes, 10 students + invoices) before measuring.
//
// Usage: node load/smoke.mjs  (BASE_URL / CONCURRENCY / DURATION_SECONDS optional overrides)

import { readFileSync } from 'node:fs';

function loadDotEnv() {
  try {
    for (const line of readFileSync('.env', 'utf8').split('\n')) {
      const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
      if (match && process.env[match[1]] === undefined) {
        process.env[match[1]] = match[2].replace(/^["']|["']$/g, '');
      }
    }
  } catch {
    // .env is optional; every consumer below has a fallback or fails loudly.
  }
}
loadDotEnv();

const BASE_URL = process.env.BASE_URL ?? 'http://localhost:3000';
const CONCURRENCY = Number(process.env.CONCURRENCY ?? 20);
const DURATION_SECONDS = Number(process.env.DURATION_SECONDS ?? 12);
const WARMUP_SECONDS = Number(process.env.WARMUP_SECONDS ?? 4);
const ADMIN_EMAIL = process.env.ADMIN_EMAIL ?? 'admin@example.com';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD ?? 'ChangeMe123';
const METRICS_TOKEN = process.env.METRICS_TOKEN ?? '';

const { PrismaClient } = await import('@prisma/client');
const { default: bcryptjs } = await import('bcryptjs');
const { authenticator } = await import('otplib');
const prisma = new PrismaClient();

async function call(method, path, { token, body } = {}) {
  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers: {
      ...(token === undefined ? {} : { authorization: `Bearer ${token}` }),
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = await res.json().catch(() => null);
  return { status: res.status, json };
}

async function seedUsers() {
  const passwordHash = await bcryptjs.hash(ADMIN_PASSWORD, 10);
  // A previous run's TOTP credential would turn the login into an mfa_pending
  // flow the script cannot complete (the stored secret is sealed from a secret
  // this run never saw) — reset it; this is throwaway load data.
  await prisma.totpCredential.deleteMany({
    where: { user: { email: ADMIN_EMAIL } },
  });
  // An existing admin (possibly with MFA enabled) is never overwritten.
  await prisma.user.upsert({
    where: { email: ADMIN_EMAIL },
    update: {},
    create: {
      email: ADMIN_EMAIL,
      passwordHash,
      role: 'ADMIN',
      emailVerifiedAt: new Date(),
    },
  });
  const instructorEmail = `load-instructor-${ADMIN_EMAIL}`;
  await prisma.user.upsert({
    where: { email: instructorEmail },
    update: {},
    create: {
      email: instructorEmail,
      passwordHash,
      role: 'INSTRUCTOR',
      emailVerifiedAt: new Date(),
    },
  });
  return (await prisma.user.findUniqueOrThrow({ where: { email: instructorEmail } })).id;
}

async function loginAdmin() {
  const login = await call('POST', '/api/v1/auth/login', {
    body: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD },
  });
  if (login.status !== 200) throw new Error(`admin login failed: ${login.status}`);
  return login.json.data.tokens.accessToken;
}

/** Enrolls TOTP over the real API (the ADMIN MFA guard requires it for admin routes). */
async function enrollTotp(token) {
  const enable = await call('POST', '/api/v1/auth/mfa/totp/enable', { token });
  if (enable.status !== 201) throw new Error(`totp enable failed: ${enable.status}`);
  const secret = /secret=([A-Z2-7]+)/.exec(enable.json.data.otpauthUrl)?.[1];
  if (secret === undefined) throw new Error('no TOTP secret in otpauth URL');
  const verify = async (epoch) => {
    const verifier = authenticator.create({ ...authenticator.options, epoch });
    return call('POST', '/api/v1/auth/mfa/totp/verify', {
      token,
      body: { code: verifier.generate(secret) },
    });
  };
  const first = await verify(Date.now());
  if (first.status !== 201) {
    const second = await verify(Date.now() + 30_000);
    if (second.status !== 201) throw new Error(`totp verify failed: ${second.status}`);
  }
}

async function seedDataset(token, instructorId) {
  const existing = await call('GET', '/api/v1/classes?page=1&limit=100', { token });
  const need = 20 - existing.json.data.total;
  for (let i = 0; i < need; i += 1) {
    await call('POST', '/api/v1/classes', {
      token,
      body: { name: `Load class ${Date.now()}-${i}`, instructorId, capacity: 30 },
    });
  }
  const inv = await call('GET', '/api/v1/invoices?page=1&limit=1', { token });
  if (inv.json.data.total >= 10) return;
  const stamp = Date.now();
  for (let i = 0; i < 10; i += 1) {
    const student = await call('POST', '/api/v1/students', {
      token,
      body: { fullName: `Load Student ${stamp}-${i}`, dob: '2005-06-15', gender: 'MALE' },
    });
    if (student.status !== 201) throw new Error(`student create failed: ${student.status}`);
    await call('POST', '/api/v1/invoices', {
      token,
      body: {
        studentId: student.json.data.id,
        type: 'UNIFORM',
        items: [{ description: 'Uniform', quantity: 1, unitAmount: 200000 }],
      },
    });
  }
}

async function scrapeProcessMetrics() {
  if (METRICS_TOKEN === '') return null;
  const res = await fetch(`${BASE_URL}/metrics`, {
    headers: { authorization: `Bearer ${METRICS_TOKEN}` },
  });
  if (res.status !== 200) return null;
  const text = await res.text();
  const pick = (name) => {
    const line = text.split('\n').find((l) => l.startsWith(`${name} `));
    return line === undefined ? null : Number(line.slice(name.length).trim());
  };
  return {
    rssBytes: pick('process_resident_memory_bytes'),
    cpuSecondsTotal: pick('process_cpu_seconds_total'),
    heapUsedBytes: pick('nodejs_heap_size_used_bytes'),
    eventLoopLagSeconds: pick('nodejs_eventloop_lag_seconds'),
  };
}

async function runScenario(name, path, token) {
  const latencies = [];
  let errors = 0;
  const statuses = {};
  const deadline = Date.now() + DURATION_SECONDS * 1000;
  const worker = async () => {
    while (Date.now() < deadline) {
      const t0 = performance.now();
      let ok = false;
      try {
        const res = await fetch(`${BASE_URL}${path}`, {
          headers: token === undefined ? {} : { authorization: `Bearer ${token}` },
        });
        statuses[res.status] = (statuses[res.status] ?? 0) + 1;
        ok = res.status >= 200 && res.status < 300;
        await res.arrayBuffer();
      } catch {
        statuses.fetch_error = (statuses.fetch_error ?? 0) + 1;
      }
      if (!ok) errors += 1;
      latencies.push(performance.now() - t0);
    }
  };
  const warmupDeadline = Date.now() + WARMUP_SECONDS * 1000;
  const warmup = async () => {
    while (Date.now() < warmupDeadline) {
      await fetch(`${BASE_URL}${path}`, {
        headers: token === undefined ? {} : { authorization: `Bearer ${token}` },
      }).then((r) => r.arrayBuffer());
    }
  };
  await Promise.all(Array.from({ length: CONCURRENCY }, warmup));
  const started = performance.now();
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  const elapsedSeconds = (performance.now() - started) / 1000;
  latencies.sort((a, b) => a - b);
  const pct = (p) => {
    const index = Math.min(latencies.length - 1, Math.floor((p / 100) * latencies.length));
    return latencies[index];
  };
  return {
    scenario: name,
    requests: latencies.length,
    throughputRps: Number((latencies.length / elapsedSeconds).toFixed(1)),
    p50Ms: Number(pct(50).toFixed(2)),
    p95Ms: Number(pct(95).toFixed(2)),
    p99Ms: Number(pct(99).toFixed(2)),
    maxMs: Number(latencies[latencies.length - 1].toFixed(2)),
    errorRate: Number((errors / latencies.length).toFixed(5)),
    statuses,
  };
}

try {
  const instructorId = await seedUsers();
  const adminToken = await loginAdmin();
  await enrollTotp(adminToken);
  await seedDataset(adminToken, instructorId);

  const metricsBefore = await scrapeProcessMetrics();
  const scenarios = [
    ['healthz', '/healthz', undefined],
    ['readyz', '/readyz', undefined],
    ['classes', '/api/v1/classes?page=1&limit=20', adminToken],
    ['invoices', '/api/v1/invoices?page=1&limit=20', adminToken],
  ];
  const results = [];
  for (const [name, path, token] of scenarios) {
    results.push(await runScenario(name, path, token));
  }
  const metricsAfter = await scrapeProcessMetrics();

  console.log(
    JSON.stringify(
      {
        baseUrl: BASE_URL,
        concurrency: CONCURRENCY,
        durationSeconds: DURATION_SECONDS,
        warmupSeconds: WARMUP_SECONDS,
        metricsBefore,
        metricsAfter,
        results,
      },
      null,
      2,
    ),
  );
} finally {
  await prisma.$disconnect();
}
