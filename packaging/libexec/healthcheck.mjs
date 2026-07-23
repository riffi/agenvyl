const service = process.argv[2] ?? 'all';
const wait = process.argv.includes('--wait');
const attempts = wait ? 60 : 1;

for (let attempt = 1; attempt <= attempts; attempt += 1) {
  try {
    if (service === 'connector' || service === 'all') await connectorHealth();
    if (service === 'core' || service === 'all') await coreHealth();
    process.exit(0);
  } catch (error) {
    if (attempt === attempts) {
      console.error(error instanceof Error ? error.message : String(error));
      process.exit(1);
    }
    await new Promise(resolve => setTimeout(resolve, 1_000));
  }
}

async function connectorHealth() {
  const url = new URL('/v2/health', process.env.AGENVYL_CONNECTOR_URL ?? 'http://127.0.0.1:4310');
  const token = process.env.AGENVYL_CONNECTOR_TOKEN;
  if (!token) throw new Error('AGENVYL_CONNECTOR_TOKEN is required for the Connector health probe');
  const response = await fetch(url, { headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(2_000) });
  if (!response.ok) throw new Error(`Connector health returned HTTP ${response.status}`);
  const body = await response.json();
  if (!body || !['ready', 'degraded'].includes(body.status)) throw new Error('Connector health returned an invalid status');
}

async function coreHealth() {
  const port = process.env.AGENVYL_PORT ?? '8791';
  const host = process.env.AGENVYL_HOST ?? '127.0.0.1';
  const response = await fetch(`http://${host}:${port}/api/v1/health`, { signal: AbortSignal.timeout(2_000) });
  if (!response.ok) throw new Error(`Core readiness returned HTTP ${response.status}`);
  const body = await response.json();
  if (body?.status !== 'ready') throw new Error('Core is not ready');
}
