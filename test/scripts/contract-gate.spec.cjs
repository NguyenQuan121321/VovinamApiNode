const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { lintDocument } = require('../../scripts/lint-openapi.cjs');

test('Spectral rejects a missing operationId under the unchanged rules', async () => {
  const document = JSON.parse(fs.readFileSync('openapi.json', 'utf8'));
  delete document.paths['/healthz'].get.operationId;
  const findings = await lintDocument(JSON.stringify(document));
  assert.ok(
    findings.some((finding) => finding.code === 'operation-operationId' && finding.severity === 0),
  );
});
