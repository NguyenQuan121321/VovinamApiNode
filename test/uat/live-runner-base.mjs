import fs from 'fs';
import crypto from 'crypto';

const BASE_URL = process.env.LIVE_UAT_BASE_URL || 'https://vovinamapinode.onrender.com';
const RUN_ID = process.env.LIVE_UAT_RUN_ID || `uat-${Date.now().toString(36)}-${crypto.randomBytes(3).toString('hex')}`;

// Rate limit pacing: 180ms between standard calls; track /auth calls to respect AUTH_IP_LIMIT_MAX (30/min).
let lastRequestTime = 0;
let authRequestTimestamps = [];

async function paceRequest(isAuth = false) {
  const now = Date.now();
  if (isAuth) {
    authRequestTimestamps = authRequestTimestamps.filter((t) => now - t < 60000);
    if (authRequestTimestamps.length >= 22) {
      const oldest = authRequestTimestamps[0];
      const waitTime = Math.max(0, 60000 - (now - oldest) + 1500);
      console.log(
        `[PACE] Approaching auth IP rate limit (${authRequestTimestamps.length}/30). Pacing for ${(waitTime / 1000).toFixed(1)}s...`,
      );
      await new Promise((r) => setTimeout(r, waitTime));
    }
    authRequestTimestamps.push(Date.now());
  }

  const elapsed = Date.now() - lastRequestTime;
  if (elapsed < 180) {
    await new Promise((r) => setTimeout(r, 180 - elapsed));
  }
  lastRequestTime = Date.now();
}

function createResourceRegistry() {
  return {
    users: new Set(),
    students: new Set(),
    classes: new Set(),
    schedules: new Set(),
    enrollments: new Set(),
    attendanceSessions: new Set(),
    attendanceRecords: new Set(),
    beltRanks: new Set(),
    exams: new Set(),
    registrations: new Set(),
    invoices: new Set(),
    payments: new Set(),
    announcements: new Set(),
    leaves: new Set(),
    evaluations: new Set(),
    proposals: new Set(),
    discounts: new Set(),
  };
}

const createdResources = createResourceRegistry();

function registerCreatedResource(category, id) {
  if (!id || typeof id !== 'string') return;
  if (!createdResources[category]) {
    throw new Error(`Unknown resource category: ${category}`);
  }
  createdResources[category].add(id);
}

function isCreatedResource(category, id) {
  if (!createdResources[category]) return false;
  return createdResources[category].has(id);
}

const testResults = [];
const operationCoverage = new Map(); // operationId -> coverage record

// Load OpenAPI operations
let openapiDoc = { paths: {} };
if (fs.existsSync('openapi.json')) {
  try {
    openapiDoc = JSON.parse(fs.readFileSync('openapi.json', 'utf8'));
    for (const p of Object.keys(openapiDoc.paths)) {
      for (const m of Object.keys(openapiDoc.paths[p])) {
        if (['get', 'post', 'put', 'patch', 'delete'].includes(m.toLowerCase())) {
          const op = openapiDoc.paths[p][m];
          operationCoverage.set(op.operationId, {
            method: m.toUpperCase(),
            path: p,
            operationId: op.operationId,
            summary: op.summary || '',
            covered: false,
            executed: false,
            workflow: '',
            result: 'UNCOVERED',
            status: 0,
            notes: '',
          });
        }
      }
    }
  } catch (err) {
    console.error('Failed to parse openapi.json:', err.message);
  }
}

// Information leak detection
const LEAK_PATTERNS = [
  /DATABASE_URL/i,
  /JWT_SECRET/i,
  /APP_ENCRYPTION_KEY/i,
  /passwordHash/i,
  /PrismaClientKnownRequestError/i,
  /PrismaClientUnknownRequestError/i,
  /at\s+.*\(.*:[0-9]+:[0-9]+\)/,
  /at\s+processTicksAndRejections/,
];

const leakScanResults = {
  scannedCount: 0,
  leaks: [],
};

function scanForLeaks(method, endpoint, status, text) {
  if (!text || typeof text !== 'string') return;
  leakScanResults.scannedCount++;
  for (const pattern of LEAK_PATTERNS) {
    if (pattern.test(text)) {
      leakScanResults.leaks.push({
        method,
        endpoint,
        status,
        matchedPattern: pattern.toString(),
        snippet: text.slice(0, 100).replace(/[\r\n]+/g, ' '),
      });
      break;
    }
  }
}

function redactSecrets(val) {
  if (typeof val !== 'string') {
    if (typeof val === 'object' && val !== null) {
      try {
        return redactSecrets(JSON.stringify(val));
      } catch {
        return '[Object]';
      }
    }
    return val;
  }
  return val
    .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, 'Bearer [REDACTED]')
    .replace(/"accessToken":\s*"[^"]+"/gi, '"accessToken":"[REDACTED]"')
    .replace(/"refreshToken":\s*"[^"]+"/gi, '"refreshToken":"[REDACTED]"')
    .replace(/"password":\s*"[^"]+"/gi, '"password":"[REDACTED]"')
    .replace(/"passwordHash":\s*"[^"]+"/gi, '"passwordHash":"[REDACTED]"')
    .replace(/"totpSecret":\s*"[^"]+"/gi, '"totpSecret":"[REDACTED]"')
    .replace(/"mfaToken":\s*"[^"]+"/gi, '"mfaToken":"[REDACTED]"');
}

async function request(method, endpoint, options = {}) {
  const isAuth = endpoint.includes('/auth');
  await paceRequest(isAuth);

  const url = `${BASE_URL}${endpoint}`;
  const headers = { ...(options.headers || {}) };
  if (options.token) {
    headers['Authorization'] = `Bearer ${options.token}`;
  }
  if (options.body && typeof options.body === 'object' && !headers['Content-Type']) {
    headers['Content-Type'] = 'application/json';
  }

  const t0 = Date.now();
  let res,
    text,
    json = null,
    latency = 0;
  try {
    res = await fetch(url, {
      method,
      headers,
      body: options.body
        ? typeof options.body === 'string'
          ? options.body
          : JSON.stringify(options.body)
        : undefined,
    });
    latency = Date.now() - t0;
    text = await res.text();
    try {
      json = JSON.parse(text);
    } catch {
      // not JSON
    }
  } catch (err) {
    latency = Date.now() - t0;
    return {
      ok: false,
      status: 0,
      headers: {},
      text: err.message,
      json: null,
      latency,
      error: err,
    };
  }

  // Scan actual response text for potential data/stack leaks
  scanForLeaks(method, endpoint, res.status, text);

  return {
    ok: res.ok,
    status: res.status,
    headers: res.headers,
    text,
    json,
    latency,
  };
}

// Fail-closed assertion evaluation helpers
function evaluateDocsAssertion(status) {
  return status === 200 ? 'PASS' : 'FAIL';
}

function evaluateRateLimitAssertion(statuses) {
  if (!Array.isArray(statuses) || statuses.length === 0) return 'FAIL';
  if (statuses.some((s) => s === 500 || s === 503)) return 'FAIL';
  if (statuses.some((s) => s === 429)) return 'PASS';
  // If no 429 observed in a small non-flooding sample, rate-limiting is not proven on live
  return 'MANUAL_REQUIRED';
}

function recordTest(phase, name, expected, actual, result, notes = '', opId = null, executed = true) {
  const sanitizedActual =
    typeof actual === 'string'
      ? redactSecrets(actual)
      : typeof actual === 'number'
        ? actual
        : (actual?.status ?? (typeof actual === 'object' ? redactSecrets(JSON.stringify(actual)) : 'N/A'));

  const sanitizedExpected = typeof expected === 'string' ? redactSecrets(expected) : expected;

  const record = {
    phase,
    name,
    expected: sanitizedExpected,
    actual: sanitizedActual,
    result,
    notes: redactSecrets(notes),
    opId,
    executed,
  };
  testResults.push(record);

  if (opId && operationCoverage.has(opId)) {
    const op = operationCoverage.get(opId);
    op.workflow = name;
    op.result = result;
    op.status = typeof actual === 'number' ? actual : (actual?.status || 0);
    op.notes = notes;
    op.executed = executed;
    // An operation is COVERED only when an actual request executed AND the assertion PASSED!
    op.covered = executed === true && result === 'PASS';
  }

  const symbol =
    result === 'PASS'
      ? '✓'
      : result === 'FAIL'
        ? '✗'
        : result === 'BLOCKED'
          ? '⊘'
          : result === 'NOT_SAFE_TO_AUTOMATE'
            ? '⚠'
            : 'ℹ';
  console.log(
    `[${symbol} ${result}] Phase ${phase} - ${name} (${sanitizedActual}) ${notes ? `[${notes}]` : ''}`,
  );
}

function calculateCoverageSummary(coverageMap = operationCoverage) {
  const total = coverageMap.size;
  let executed = 0;
  let pass = 0;
  let fail = 0;
  let blocked = 0;
  let manualRequired = 0;
  let notSafeToAutomate = 0;
  let uncovered = 0;

  for (const op of coverageMap.values()) {
    if (op.executed) executed++;
    if (op.result === 'PASS') pass++;
    else if (op.result === 'FAIL') fail++;
    else if (op.result === 'BLOCKED') blocked++;
    else if (op.result === 'MANUAL_REQUIRED') manualRequired++;
    else if (op.result === 'NOT_SAFE_TO_AUTOMATE') notSafeToAutomate++;
    else uncovered++;
  }

  return {
    total,
    executed,
    pass,
    fail,
    blocked,
    manualRequired,
    notSafeToAutomate,
    uncovered,
    coveredCount: pass, // Only real PASS counts as covered
  };
}

export {
  BASE_URL,
  RUN_ID,
  request,
  recordTest,
  testResults,
  operationCoverage,
  openapiDoc,
  createdResources,
  createResourceRegistry,
  registerCreatedResource,
  isCreatedResource,
  leakScanResults,
  redactSecrets,
  evaluateDocsAssertion,
  evaluateRateLimitAssertion,
  calculateCoverageSummary,
};
