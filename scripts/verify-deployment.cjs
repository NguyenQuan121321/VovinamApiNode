function matchesDeployment(version, expectedCommit, healthStatus, readyStatus) {
  return (
    /^[a-f0-9]{40}$/i.test(expectedCommit) &&
    version?.data?.commit === expectedCommit &&
    healthStatus === 200 &&
    readyStatus === 200
  );
}

async function verifyDeployment(baseUrl, expectedCommit) {
  const base = new URL(baseUrl);
  if (base.protocol !== 'https:' || !/^[a-f0-9]{40}$/i.test(expectedCommit)) {
    throw new Error('A HTTPS deployment URL and full commit are required');
  }
  for (let attempt = 1; attempt <= 60; attempt += 1) {
    try {
      const versionResponse = await fetch(new URL('/version', base), {
        signal: AbortSignal.timeout(6000),
      });
      if (versionResponse.ok) {
        const version = await versionResponse.json();
        if (version?.data?.commit === expectedCommit) {
          const health = await fetch(new URL('/healthz', base), {
            signal: AbortSignal.timeout(6000),
          });
          const ready = await fetch(new URL('/readyz', base), {
            signal: AbortSignal.timeout(6000),
          });
          if (matchesDeployment(version, expectedCommit, health.status, ready.status)) {
            console.log(
              JSON.stringify({
                commit: expectedCommit,
                health: health.status,
                readiness: ready.status,
                attempt,
              }),
            );
            return;
          }
        }
      }
    } catch {
      // Startup and traffic switching may briefly interrupt a probe.
    }
    console.log(`Deployment verification pending (attempt ${attempt}/60)`);
    if (attempt < 60) await new Promise((resolve) => setTimeout(resolve, 10000));
  }
  throw new Error('Deployment identity or readiness was not verified');
}

if (require.main === module) {
  verifyDeployment(process.env.SMOKE_TEST_URL, process.env.GITHUB_SHA).catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}

module.exports = { matchesDeployment };
