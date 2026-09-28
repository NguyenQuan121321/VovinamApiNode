import test, { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { generateUatMarkdown, computeOperationalVerdicts } from './generate-uat-md.mjs';

describe('UAT Report Generator Honesty & Evidence Verification (R1 Repair)', () => {
  // Base fixtures
  const baseResult = {
    runId: 'uat-test-run-123',
    timestamp: '2026-09-28T12:00:00.000Z',
    baseUrl: 'https://vovinamapinode.onrender.com',
    runStatus: 'COMPLETED',
    cleanupStatus: 'CLEANUP COMPLETED',
    totalTests: 10,
    passCount: 10,
    failCount: 0,
    blockedCount: 0,
    manualCount: 0,
    notSafeCount: 0,
    coveredCount: 111,
    totalOperations: 111,
    executedOperations: 111,
    financialResidue: {
      invoices: ['inv-syn-1'],
      payments: ['pay-syn-1'],
    },
    createdResourcesSummary: {
      users: ['usr-1'],
      students: ['stu-1'],
      classes: ['cls-1'],
      schedules: ['sch-1'],
      enrollments: ['enr-1'],
      announcements: ['ann-1'],
      leaves: ['lve-1'],
      evaluations: ['evl-1'],
      discounts: ['dsc-1'],
    },
    leakScan: {
      scannedCount: 20,
      leaksDetected: 0,
      leaks: [],
    },
    testResults: [
      { phase: 0, name: 'GET /healthz probe', expected: 200, actual: 200, result: 'PASS' },
      { phase: 0, name: 'GET /readyz probe', expected: 200, actual: 200, result: 'PASS' },
      { phase: 0, name: 'GET /docs probe', expected: 200, actual: 200, result: 'PASS' },
      { phase: 0, name: 'GET /docs-json probe', expected: 200, actual: 200, result: 'PASS' },
      { phase: 1, name: 'Admin bootstrap authentication', expected: 200, actual: 200, result: 'PASS' },
      { phase: 4, name: 'Rate limit safe probe', expected: 200, actual: 200, result: 'PASS' },
      { phase: 7, name: 'Evaluation scoping anti-probing 404', expected: 404, actual: 404, result: 'PASS' },
      { phase: 9, name: 'Payment QR generation', expected: 200, actual: 200, result: 'PASS' },
      { phase: 10, name: 'PUT /admin/billing/settings/tuition-rates skipped', expected: 'SKIPPED', actual: 'SKIPPED', result: 'NOT_SAFE_TO_AUTOMATE' },
    ],
  };

  // 1. Completed successful run
  it('1. completed successful run marks operational invariants as VERIFIED based on evidence', () => {
    const md = generateUatMarkdown(baseResult);
    const verdicts = computeOperationalVerdicts(baseResult);

    const f3 = verdicts.find((v) => v.id.includes('F3'));
    assert.equal(f3.liveStatus, 'VERIFIED');
    assert.equal(f3.implStatus, 'VERIFIED');

    const n3 = verdicts.find((v) => v.id.includes('N3'));
    assert.equal(n3.liveStatus, 'VERIFIED');

    const f1 = verdicts.find((v) => v.id.includes('F1/F2'));
    assert.equal(f1.liveStatus, 'VERIFIED');

    const f5 = verdicts.find((v) => v.id.includes('F5'));
    assert.equal(f5.liveStatus, 'VERIFIED');

    assert.match(md, /\|\s*\*\*F3 Resource Isolation\*\*\s*\|[^|]+\|\s*\*\*VERIFIED\*\*\s*\|\s*\*\*VERIFIED\*\*/);
    assert.match(md, /\|\s*\*\*N3 Evaluation Class Scoping\*\*\s*\|[^|]+\|\s*\*\*VERIFIED\*\*\s*\|\s*\*\*VERIFIED\*\*/);
  });

  // 2. Credential-gate blocked run
  it('2. credential-gate blocked run NEVER marks unexecuted domain invariants as VERIFIED', () => {
    const blockedResult = {
      ...baseResult,
      runStatus: 'RUN ABORTED',
      cleanupStatus: 'CLEANUP COMPLETED',
      totalTests: 6,
      passCount: 5,
      blockedCount: 1,
      coveredCount: 3,
      financialResidue: { invoices: [], payments: [] },
      createdResourcesSummary: {
        users: [],
        students: [],
        classes: [],
        schedules: [],
        enrollments: [],
        announcements: [],
        leaves: [],
        evaluations: [],
        discounts: [],
      },
      testResults: [
        { phase: 0, name: 'GET /healthz probe', expected: 200, actual: 200, result: 'PASS' },
        { phase: 0, name: 'GET /readyz probe', expected: 200, actual: 200, result: 'PASS' },
        { phase: 0, name: 'GET /docs probe', expected: 200, actual: 200, result: 'PASS' },
        { phase: 0, name: 'GET /docs-json probe', expected: 200, actual: 200, result: 'PASS' },
        { phase: 0, name: 'GET /metrics without token', expected: 401, actual: 401, result: 'PASS' },
        { phase: 1, name: 'Safety Gate: Runtime credentials present', expected: 'LIVE_UAT_ADMIN_PASSWORD set in environment', actual: 'MISSING', result: 'BLOCKED' },
      ],
    };

    const md = generateUatMarkdown(blockedResult);
    const verdicts = computeOperationalVerdicts(blockedResult);

    const f1 = verdicts.find((v) => v.id.includes('F1/F2'));
    assert.equal(f1.liveStatus, 'BLOCKED');

    const f3 = verdicts.find((v) => v.id.includes('F3'));
    assert.equal(f3.liveStatus, 'NOT_PROVEN');

    const f4 = verdicts.find((v) => v.id.includes('F4'));
    assert.equal(f4.liveStatus, 'NOT_PROVEN');

    const f5 = verdicts.find((v) => v.id.includes('F5'));
    assert.equal(f5.liveStatus, 'NOT_PROVEN');

    const f6 = verdicts.find((v) => v.id.includes('F6'));
    assert.equal(f6.liveStatus, 'NOT_PROVEN');

    const n3 = verdicts.find((v) => v.id.includes('N3'));
    assert.equal(n3.liveStatus, 'NOT_PROVEN');

    const f10 = verdicts.find((v) => v.id.includes('F10'));
    assert.equal(f10.liveStatus, 'NOT_APPLICABLE');

    // Assert that the generated markdown never claims VERIFIED for unexecuted live claims
    assert.doesNotMatch(md, /\|\s*\*\*F3 Resource Isolation\*\*\s*\|[^|]+\|\s*\*\*VERIFIED\*\*\s*\|\s*\*\*VERIFIED\*\*/);
    assert.doesNotMatch(md, /\|\s*\*\*N3 Evaluation Class Scoping\*\*\s*\|[^|]+\|\s*\*\*VERIFIED\*\*\s*\|\s*\*\*VERIFIED\*\*/);
    assert.doesNotMatch(md, /\|\s*\*\*F5 Financial Mutation Safety\*\*\s*\|[^|]+\|\s*\*\*VERIFIED\*\*\s*\|\s*\*\*VERIFIED\*\*/);

    // Section 2 Resource table must not claim VERIFIED for 0 created resources
    assert.match(md, /\|\s*User Accounts\s*\|\s*0\s*\|\s*0 \(Deactivated\)\s*\|\s*\*\*NOT_APPLICABLE\*\*/);
  });

  // 3. Partial run
  it('3. partial run distinguishes executed verified claims from unreached NOT_PROVEN claims', () => {
    const partialResult = {
      ...baseResult,
      runStatus: 'RUN ABORTED',
      createdResourcesSummary: {
        users: ['usr-1'],
        students: ['stu-1'],
        classes: [],
        schedules: [],
        enrollments: [],
        announcements: [],
        leaves: [],
        evaluations: [],
        discounts: [],
      },
      testResults: [
        { phase: 0, name: 'GET /healthz probe', expected: 200, actual: 200, result: 'PASS' },
        { phase: 1, name: 'Admin bootstrap authentication', expected: 200, actual: 200, result: 'PASS' },
        // Aborted before evaluations (N3) and settings (F4)
      ],
      financialResidue: { invoices: [], payments: [] },
    };

    const verdicts = computeOperationalVerdicts(partialResult);

    const f1 = verdicts.find((v) => v.id.includes('F1/F2'));
    assert.equal(f1.liveStatus, 'VERIFIED');

    const f3 = verdicts.find((v) => v.id.includes('F3'));
    // Created resources > 0, so synthetic resources were created
    assert.equal(f3.liveStatus, 'VERIFIED');

    const n3 = verdicts.find((v) => v.id.includes('N3'));
    assert.equal(n3.liveStatus, 'NOT_PROVEN');

    const f4 = verdicts.find((v) => v.id.includes('F4'));
    assert.equal(f4.liveStatus, 'NOT_PROVEN');

    const f5 = verdicts.find((v) => v.id.includes('F5'));
    assert.equal(f5.liveStatus, 'NOT_PROVEN');
  });

  // 4. Failed authenticated operation
  it('4. failed authenticated operation marks live status as FAILED', () => {
    const failedResult = {
      ...baseResult,
      testResults: [
        ...baseResult.testResults.filter((t) => !t.name.includes('Evaluation')),
        {
          phase: 7,
          name: 'Evaluation scoping anti-probing 404',
          expected: 404,
          actual: 500,
          result: 'FAIL',
          notes: 'Server error on evaluation class check',
        },
      ],
    };

    const verdicts = computeOperationalVerdicts(failedResult);
    const n3 = verdicts.find((v) => v.id.includes('N3'));
    assert.equal(n3.liveStatus, 'FAILED');
    assert.match(n3.notes, /failed/i);

    const md = generateUatMarkdown(failedResult);
    assert.match(md, /\|\s*\*\*N3 Evaluation Class Scoping\*\*\s*\|[^|]+\|\s*\*\*VERIFIED\*\*\s*\|\s*\*\*FAILED\*\*/);
  });

  // 5. Manual-required operation
  it('5. manual-required operation marks live status as MANUAL_REQUIRED', () => {
    const manualResult = {
      ...baseResult,
      testResults: [
        ...baseResult.testResults.filter((t) => !t.name.includes('Evaluation')),
        {
          phase: 7,
          name: 'Evaluation scoping anti-probing 404',
          expected: 404,
          actual: 0,
          result: 'MANUAL_REQUIRED',
          notes: 'Requires human instructor account confirmation',
        },
      ],
    };

    const verdicts = computeOperationalVerdicts(manualResult);
    const n3 = verdicts.find((v) => v.id.includes('N3'));
    assert.equal(n3.liveStatus, 'MANUAL_REQUIRED');

    const md = generateUatMarkdown(manualResult);
    assert.match(md, /\|\s*\*\*N3 Evaluation Class Scoping\*\*\s*\|[^|]+\|\s*\*\*VERIFIED\*\*\s*\|\s*\*\*MANUAL_REQUIRED\*\*/);
  });

  // 6. Not-safe-to-automate operation
  it('6. not-safe-to-automate operation marks live status appropriately and preserves integrity', () => {
    const notSafeResult = {
      ...baseResult,
      testResults: [
        ...baseResult.testResults.filter((t) => !t.name.includes('tuition-rates')),
        {
          phase: 10,
          name: 'PUT /admin/billing/settings/tuition-rates skipped for live safety',
          expected: 'SKIPPED',
          actual: 'SKIPPED',
          result: 'NOT_SAFE_TO_AUTOMATE',
          notes: 'Global settings not mutated on live',
        },
      ],
    };

    const verdicts = computeOperationalVerdicts(notSafeResult);
    const f4 = verdicts.find((v) => v.id.includes('F4'));
    assert.equal(f4.liveStatus, 'VERIFIED');
    assert.match(f4.notes, /untouched on live/i);

    const md = generateUatMarkdown(notSafeResult);
    assert.match(md, /\|\s*\*\*F4 Global Settings Preservation\*\*\s*\|[^|]+\|\s*\*\*VERIFIED\*\*\s*\|\s*\*\*VERIFIED\*\*/);
  });
});
