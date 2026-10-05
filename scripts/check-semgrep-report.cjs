const fs = require('node:fs');

function checkReport(report, scannerExitCode) {
  if (!Number.isInteger(scannerExitCode) || scannerExitCode !== 0) return false;
  if (!report || !Array.isArray(report.results) || !Array.isArray(report.errors)) return false;
  return report.results.length === 0 && report.errors.length === 0;
}

if (require.main === module) {
  try {
    const report = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
    const scannerExitCode = Number(process.argv[3]);
    console.log(
      JSON.stringify({
        scannerExitCode,
        findings: report.results?.length,
        scannerErrors: report.errors?.length,
      }),
    );
    process.exitCode = checkReport(report, scannerExitCode) ? 0 : 1;
  } catch {
    console.error('Semgrep report is missing or invalid');
    process.exitCode = 1;
  }
}

module.exports = { checkReport };
