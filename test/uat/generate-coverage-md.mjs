import fs from 'fs';

const resultsPath = 'test/uat/live-uat-results.json';
if (!fs.existsSync(resultsPath)) {
  console.error(`Results file ${resultsPath} does not exist. Run UAT first.`);
  process.exit(1);
}

const res = JSON.parse(fs.readFileSync(resultsPath, 'utf8'));

const operations = res.operations || [];
const total = operations.length || res.totalOperations || 111;
let executedCount = 0;
let passCount = 0;
let failCount = 0;
let blockedCount = 0;
let manualCount = 0;
let notSafeCount = 0;
let uncoveredCount = 0;

for (const op of operations) {
  if (op.executed) executedCount++;
  if (op.result === 'PASS') passCount++;
  else if (op.result === 'FAIL') failCount++;
  else if (op.result === 'BLOCKED') blockedCount++;
  else if (op.result === 'MANUAL_REQUIRED') manualCount++;
  else if (op.result === 'NOT_SAFE_TO_AUTOMATE') notSafeCount++;
  else uncoveredCount++;
}

let md = '# Live OpenAPI Endpoint & Operation Coverage\n\n';
md += `**Target Base URL**: \`${res.baseUrl}\`  \n`;
md += `**Run ID**: \`${res.runId}\`  \n`;
md += `**Execution Timestamp**: \`${res.timestamp}\`  \n`;
md += `**Run Lifecycle Status**: \`${res.runStatus || 'N/A'}\`  \n`;
md += `**Cleanup Status**: \`${res.cleanupStatus || 'N/A'}\`  \n\n`;

md += '## 1. Coverage Accounting Summary\n\n';
md += '| Metric | Count | Percentage |\n';
md += '|---|---|---|\n';
md += `| **Total OpenAPI Operations** | ${total} | 100.0% |\n`;
md += `| **Executed HTTP Requests** | ${executedCount} | ${((executedCount / (total || 1)) * 100).toFixed(1)}% |\n`;
md += `| **PASS (Executed + Successful Assertion)** | ${passCount} | ${((passCount / (total || 1)) * 100).toFixed(1)}% |\n`;
md += `| **FAIL (Executed + Failed Assertion)** | ${failCount} | ${((failCount / (total || 1)) * 100).toFixed(1)}% |\n`;
md += `| **BLOCKED (Cannot Safely Execute on Target)** | ${blockedCount} | ${((blockedCount / (total || 1)) * 100).toFixed(1)}% |\n`;
md += `| **MANUAL_REQUIRED (Requires External Actor / Fixture)** | ${manualCount} | ${((manualCount / (total || 1)) * 100).toFixed(1)}% |\n`;
md += `| **NOT_SAFE_TO_AUTOMATE (Protected Global Config)** | ${notSafeCount} | ${((notSafeCount / (total || 1)) * 100).toFixed(1)}% |\n`;
md += `| **UNCOVERED (No Workflow Defined)** | ${uncoveredCount} | ${((uncoveredCount / (total || 1)) * 100).toFixed(1)}% |\n\n`;

md += '## 2. Operations Traceability Matrix\n\n';
md += '| Method | Endpoint | Operation ID | Executed | Result | Status | Workflow / Notes |\n';
md += '|---|---|---|---|---|---|---|\n';

// Sort alphabetically by path, then method
const sortedOps = [...operations].sort((a, b) => {
  if (a.path !== b.path) return a.path.localeCompare(b.path);
  return a.method.localeCompare(b.method);
});

for (const op of sortedOps) {
  const method = op.method;
  const endpoint = op.path;
  const opId = op.operationId;
  const executed = op.executed ? 'YES' : 'NO';
  const result = op.result || 'UNCOVERED';
  const status = op.status || 'N/A';
  const workflow = (op.workflow || op.notes || op.summary || '').replace(/\|/g, '\\|');
  md += `| ${method} | \`${endpoint}\` | \`${opId}\` | ${executed} | **${result}** | ${status} | ${workflow} |\n`;
}

fs.writeFileSync('docs/LIVE_ENDPOINT_COVERAGE.md', md, 'utf8');
console.log('Successfully generated docs/LIVE_ENDPOINT_COVERAGE.md from actual JSON results.');
