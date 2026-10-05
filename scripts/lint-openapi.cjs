const fs = require('node:fs');
const { Spectral, Document } = require('@stoplight/spectral-core');
const { Json } = require('@stoplight/spectral-parsers');
const { oas } = require('@stoplight/spectral-rulesets');
const yaml = require('js-yaml');

async function lintDocument(content, source = 'openapi.json') {
  const configured = yaml.load(fs.readFileSync('.spectral.yaml', 'utf8'));
  if (configured.extends?.length !== 1 || configured.extends[0] !== 'spectral:oas') {
    throw new Error('Unsupported Spectral ruleset extension');
  }
  const spectral = new Spectral();
  spectral.setRuleset({ extends: [oas], rules: configured.rules });
  return spectral.run(new Document(content, Json, source));
}

if (require.main === module) {
  lintDocument(fs.readFileSync(process.argv[2] ?? 'openapi.json', 'utf8'))
    .then((diagnostics) => {
      for (const item of diagnostics)
        console.log(
          JSON.stringify({
            code: item.code,
            severity: item.severity,
            path: item.path,
            message: item.message,
          }),
        );
      const errors = diagnostics.filter((item) => item.severity === 0).length;
      console.log(`Spectral diagnostics: ${diagnostics.length}; errors: ${errors}`);
      process.exitCode = errors === 0 ? 0 : 1;
    })
    .catch(() => {
      console.error('OpenAPI validation could not complete');
      process.exitCode = 1;
    });
}

module.exports = { lintDocument };
