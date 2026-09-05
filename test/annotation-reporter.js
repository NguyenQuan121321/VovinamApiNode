/**
 * Emits one GitHub annotation per failed test AND per failed suite so CI results
 * stay reviewable without Actions log access (annotations are readable via the API).
 */
class AnnotationReporter {
  onRunComplete(_contexts, results) {
    for (const suite of results.testResults) {
      const relative = suite.testFilePath.replace(/^.*[\\/]test[\\/]/, 'test/');

      if (suite.testExecError || suite.failureMessage) {
        const detail = String(suite.failureMessage ?? suite.testExecError)
          .split('\n')
          .slice(0, 4)
          .join(' | ')
          .slice(0, 160);
        process.stdout.write(`::error file=${relative},line=1,title=Suite failed::${detail}\n`);
        continue;
      }

      for (const testCase of suite.testResults.filter((t) => t.status === 'failed')) {
        const firstFailure = (testCase.failureMessages && testCase.failureMessages[0]) || '';
        const location = /(?:at .+?)?(\d+):\d+/.exec(firstFailure);
        const line = location ? location[1] : '1';
        const title = testCase.ancestorTitles.join(' > ');
        const detail = firstFailure
          .split('\n')
          .filter((l) => l.includes('Expected') || l.includes('Received') || l.includes('Error'))
          .slice(0, 3)
          .join(' | ')
          .slice(0, 140);
        process.stdout.write(
          `::error file=${relative},line=${line},title=${title} :: ${testCase.title}::${detail}\n`,
        );
      }
    }
  }
}

module.exports = AnnotationReporter;
