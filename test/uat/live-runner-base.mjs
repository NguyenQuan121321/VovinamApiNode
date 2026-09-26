import fs from 'fs';
import path from 'path';

const BASE_URL = 'https://vovinamapinode.onrender.com';
const RUN_ID = `live-uat-${Date.now()}`;
console.log(`[LIVE UAT] Initializing live UAT pass against ${BASE_URL} (Run ID: ${RUN_ID})`);

// Rate limit pacing: 150ms between standard calls; track /auth calls to respect AUTH_IP_LIMIT_MAX (30/min).
let lastRequestTime = 0;
let authRequestTimestamps = [];

async function paceRequest(isAuth = false) {
  const now = Date.now();
  if (isAuth) {
    authRequestTimestamps = authRequestTimestamps.filter(t => now - t < 60000);
    if (authRequestTimestamps.length >= 22) {
      const oldest = authRequestTimestamps[0];
      const waitTime = Math.max(0, 60000 - (now - oldest) + 1500);
      console.log(`[PACE] Approaching auth IP rate limit (${authRequestTimestamps.length}/30). Pacing for ${(waitTime/1000).toFixed(1)}s...`);
      await new Promise(r => setTimeout(r, waitTime));
    }
    authRequestTimestamps.push(Date.now());
  }

  const elapsed = Date.now() - lastRequestTime;
  if (elapsed < 180) {
    await new Promise(r => setTimeout(r, 180 - elapsed));
  }
  lastRequestTime = Date.now();
}

const testResults = [];
const operationCoverage = new Map(); // operationId -> { covered: boolean, status: string, result: string, notes: string }

// Load OpenAPI operations
const openapiDoc = JSON.parse(fs.readFileSync('openapi.json', 'utf8'));
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
        workflow: '',
        result: 'PENDING',
        status: 0,
        notes: ''
      });
    }
  }
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
  let res, text, json = null, latency = 0;
  try {
    res = await fetch(url, {
      method,
      headers,
      body: options.body ? (typeof options.body === 'string' ? options.body : JSON.stringify(options.body)) : undefined
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
      error: err
    };
  }

  return {
    ok: res.ok,
    status: res.status,
    headers: res.headers,
    text,
    json,
    latency
  };
}

function recordTest(phase, name, expected, actual, result, notes = '', opId = null) {
  const record = { phase, name, expected, actual, result, notes, opId };
  testResults.push(record);
  if (opId && operationCoverage.has(opId)) {
    const op = operationCoverage.get(opId);
    op.covered = true;
    op.workflow = name;
    op.result = result;
    op.status = actual?.status || (typeof actual === 'number' ? actual : (actual ?? 'N/A'));
    op.notes = notes;
  }
  const symbol = result === 'PASS' ? '✓' : (result === 'FAIL' ? '✗' : (result === 'BLOCKED' ? '⊘' : 'ℹ'));
  console.log(`[${symbol} ${result}] Phase ${phase} - ${name} (${actual?.status ?? actual}) ${notes ? `[${notes}]` : ''}`);
}

export {
  BASE_URL,
  RUN_ID,
  request,
  recordTest,
  testResults,
  operationCoverage,
  openapiDoc
};
