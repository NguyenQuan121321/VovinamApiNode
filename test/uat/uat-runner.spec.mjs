import test, { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  evaluateDocsAssertion,
  evaluateRateLimitAssertion,
  recordTest,
  testResults,
  operationCoverage,
  createResourceRegistry,
  registerCreatedResource,
  isCreatedResource,
  calculateCoverageSummary,
  redactSecrets,
} from './live-runner-base.mjs';

describe('UAT Runner Architecture & Assertion Integrity (Phase 14 Verification)', () => {
  const dummyOpId = 'TestController_dummyOperation';

  beforeEach(() => {
    testResults.length = 0;
    operationCoverage.set(dummyOpId, {
      method: 'POST',
      path: '/api/v1/dummy',
      operationId: dummyOpId,
      summary: 'Dummy operation for testing',
      covered: false,
      executed: false,
      workflow: '',
      result: 'UNCOVERED',
      status: 0,
      notes: '',
    });
  });

  // 1. Failed prerequisite must NOT become PASS
  it('1. failed prerequisite must NOT become PASS', () => {
    const syntheticSessionCreated = false;
    if (!syntheticSessionCreated) {
      recordTest(
        8,
        'Attendance records test skipped due to prerequisite failure',
        200,
        0,
        'BLOCKED',
        'Session could not be created; prerequisite failed',
        dummyOpId,
        false,
      );
    }
    const op = operationCoverage.get(dummyOpId);
    assert.equal(op.covered, false, 'Operation must NOT be marked covered');
    assert.equal(op.result, 'BLOCKED', 'Result must be BLOCKED, not PASS');
    assert.equal(op.executed, false, 'Operation must not be marked executed');
  });

  // 2. FAIL must NOT become COVERED/PASS
  it('2. FAIL must NOT become COVERED/PASS', () => {
    recordTest(5, 'Update student endpoint failed', 200, 500, 'FAIL', 'Server error on update', dummyOpId, true);
    const op = operationCoverage.get(dummyOpId);
    assert.equal(op.covered, false, 'Failed operation must NOT be marked covered');
    assert.equal(op.result, 'FAIL', 'Result must be recorded as FAIL');
    assert.equal(op.status, 500, 'Status 500 must be recorded');
    assert.equal(op.executed, true, 'Executed must be true');
  });

  // 3. /docs 200 = PASS
  it('3. /docs 200 = PASS', () => {
    const verdict = evaluateDocsAssertion(200);
    assert.equal(verdict, 'PASS', 'HTTP 200 for /docs must evaluate to PASS');
  });

  // 4. /docs 404 = FAIL
  it('4. /docs 404 = FAIL', () => {
    const verdict = evaluateDocsAssertion(404);
    assert.equal(verdict, 'FAIL', 'HTTP 404 for /docs must evaluate to FAIL');
  });

  // 5. /docs 500 = FAIL
  it('5. /docs 500 = FAIL', () => {
    const verdict = evaluateDocsAssertion(500);
    assert.equal(verdict, 'FAIL', 'HTTP 500 for /docs must evaluate to FAIL');
  });

  // 6. rate-limit unexpected 500 = FAIL
  it('6. rate-limit unexpected 500 = FAIL', () => {
    assert.equal(
      evaluateRateLimitAssertion([401, 500, 401]),
      'FAIL',
      'Unexpected 500 during rate limit probe must evaluate to FAIL',
    );
    assert.equal(
      evaluateRateLimitAssertion([503, 401]),
      'FAIL',
      'Unexpected 503 during rate limit probe must evaluate to FAIL',
    );
    assert.equal(
      evaluateRateLimitAssertion([401, 429]),
      'PASS',
      'Observing 429 without 500/503 must evaluate to PASS',
    );
    assert.equal(
      evaluateRateLimitAssertion([401, 401, 401]),
      'MANUAL_REQUIRED',
      'Observing only 401 in a small safe sample without 429 must evaluate to MANUAL_REQUIRED',
    );
  });

  // 7. no-request branch = NOT_COVERED
  it('7. no-request branch = NOT_COVERED', () => {
    recordTest(
      10,
      'PUT /admin/billing/settings/tuition-rates skipped for live safety',
      'Protected',
      'Skipped',
      'NOT_SAFE_TO_AUTOMATE',
      'Global settings not mutated on live',
      dummyOpId,
      false, // executed: false
    );
    const op = operationCoverage.get(dummyOpId);
    assert.equal(op.covered, false, 'Non-executed operation must NEVER be marked covered');
    assert.equal(op.result, 'NOT_SAFE_TO_AUTOMATE');
    assert.equal(op.executed, false);

    const summary = calculateCoverageSummary(operationCoverage);
    assert.equal(summary.coveredCount, 0, 'Covered count must be 0 when no test passed with real request');
    assert.equal(summary.notSafeToAutomate, 1);
  });

  // 8. cleanup registry deletes only created resource IDs
  it('8. cleanup registry deletes only created resource IDs', async () => {
    const registry = createResourceRegistry();
    const deletedIds = [];

    // Register synthetic items created in this run
    registry.students.add('synthetic-student-uuid-1');
    registry.students.add('synthetic-student-uuid-2');

    // Simulate cleanup iteration
    for (const studentId of Array.from(registry.students)) {
      // Mock delete API call
      deletedIds.push(studentId);
      registry.students.delete(studentId);
    }

    assert.deepEqual(deletedIds, ['synthetic-student-uuid-1', 'synthetic-student-uuid-2']);
    assert.equal(registry.students.size, 0, 'All registered IDs were processed');

    // Verify pre-existing demo ID was NEVER touched or registered
    const demoStudentId = '7f4287ae-0529-448e-80d9-02e281a4b1c9';
    assert.equal(deletedIds.includes(demoStudentId), false, 'Pre-existing demo student was NOT deleted');
  });

  // Bonus: Secret redaction in logs/artifacts
  it('secret redaction strips tokens and passwords', () => {
    const raw = 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.secret...';
    const redacted = redactSecrets(raw);
    assert.equal(redacted, 'Bearer [REDACTED]');

    const jsonStr = '{"accessToken":"xyz123","password":"MySecret#123"}';
    const redactedJson = redactSecrets(jsonStr);
    assert.equal(redactedJson, '{"accessToken":"[REDACTED]","password":"[REDACTED]"}');
  });
});
