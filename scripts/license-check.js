/**
 * License compliance gate (fail on GPL/AGPL and unknown licenses outside the
 * allowlist). The root package itself is UNLICENSED (private project) and exempt.
 * Run: node scripts/license-check.js
 */
const { execSync } = require('node:child_process');

const ALLOWED = [
  'MIT',
  'MIT*',
  'ISC',
  'BSD-3-Clause',
  'BSD-2-Clause',
  'Apache-2.0',
  'Python-2.0',
  '0BSD',
  'Unlicense',
  'CC0-1.0',
  'BlueOak-1.0.0',
];

const output = execSync('npx license-checker --production --json', {
  encoding: 'utf8',
  maxBuffer: 1024 * 1024 * 50,
});
const dependencies = JSON.parse(output);
const violations = [];
for (const [name, info] of Object.entries(dependencies)) {
  if (name.startsWith('vovinam-api-node@')) {
    continue;
  }
  const licenses = String(info.licenses ?? '');
  if (!ALLOWED.some((allowed) => licenses.includes(allowed))) {
    violations.push(`${name} -> ${licenses || 'UNKNOWN'}`);
  }
}
if (violations.length > 0) {
  console.error(`License violations (${violations.length}):`);
  for (const violation of violations) {
    console.error(`::error title=license violation::${violation}`);
  }
  process.exit(1);
}
console.log(`License check OK (${Object.keys(dependencies).length - 1} production packages).`);
