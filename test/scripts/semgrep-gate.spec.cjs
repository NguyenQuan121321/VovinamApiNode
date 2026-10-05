const { test } = require('node:test');
const assert = require('node:assert/strict');
const { checkReport } = require('../../scripts/check-semgrep-report.cjs');

test('accepts only a completed scanner with an explicit clean report', () => {
  assert.equal(checkReport({ results: [], errors: [] }, 0), true);
});

test('rejects scanner errors, exit failures, findings and malformed reports', () => {
  for (const [report, exit] of [
    [{ results: [], errors: [{ message: 'Fatal scanner failure' }] }, 0],
    [{ results: [], errors: [] }, 2],
    [{ results: [{}], errors: [] }, 0],
    [{ results: [], errors: [] }, 1],
    [{ results: [] }, 0],
    [null, 0],
    [{}, 0],
    [{ results: [], errors: [] }, NaN],
  ])
    assert.equal(checkReport(report, exit), false);
});
