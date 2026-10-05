const { test } = require('node:test');
const assert = require('node:assert/strict');
const { matchesDeployment } = require('../../scripts/verify-deployment.cjs');

test('healthy old deployments cannot satisfy the deployment gate', () => {
  assert.equal(
    matchesDeployment({ data: { commit: 'a'.repeat(40) } }, 'b'.repeat(40), 200, 200),
    false,
  );
  assert.equal(matchesDeployment({ data: { commit: null } }, 'b'.repeat(40), 200, 200), false);
});

test('requires the expected commit and both liveness and readiness', () => {
  const expected = 'b'.repeat(40);
  const version = { data: { commit: expected } };
  assert.equal(matchesDeployment(version, expected, 200, 200), true);
  assert.equal(matchesDeployment(version, expected, 200, 503), false);
  assert.equal(matchesDeployment(version, expected, 503, 200), false);
  assert.equal(matchesDeployment(version, 'invalid', 200, 200), false);
});
