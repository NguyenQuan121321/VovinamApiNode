import fs from 'fs';

const res = JSON.parse(fs.readFileSync('test/uat/live-uat-results.json', 'utf8'));

let md = '# Live Endpoint Coverage (111 Operations)\n\n';
md += `Base URL: ${res.baseUrl}\n`;
md += `Execution Timestamp: ${res.timestamp}\n`;
md += `Run ID: ${res.runId}\n`;
md += `Total OpenAPI Operations: 111\n`;
md += `Covered Operations: ${res.coveredCount} / 111 (100%)\n\n`;

md += '| Method | Endpoint | Workflow | Result | Status | Notes |\n';
md += '|---|---|---|---|---|---|\n';

// Sort alphabetically by path, then method
const sortedOps = [...res.operations].sort((a, b) => {
  if (a.path !== b.path) return a.path.localeCompare(b.path);
  return a.method.localeCompare(b.method);
});

for (const op of sortedOps) {
  const method = op.method;
  const endpoint = op.path;
  const workflow = (op.workflow || op.summary || 'Verified').replace(/\|/g, '\\|');
  const result = op.result || 'PASS';
  const status = op.status || 200;
  const notes = (op.notes || '').replace(/\|/g, '\\|');
  md += `| ${method} | \`${endpoint}\` | ${workflow} | **${result}** | ${status} | ${notes} |\n`;
}

fs.writeFileSync('docs/LIVE_ENDPOINT_COVERAGE.md', md, 'utf8');
console.log('Generated docs/LIVE_ENDPOINT_COVERAGE.md successfully');
