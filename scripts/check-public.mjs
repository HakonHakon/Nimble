const origin = new URL(process.env.NIMBLE_PUBLIC_URL).origin;
if (!origin.startsWith('https://')) throw new Error('Public verification requires HTTPS.');
let lastError;
for (let attempt = 1; attempt <= 12; attempt++) {
  try {
    const response = await fetch(origin + '/api/ready', { redirect: 'error', signal: AbortSignal.timeout(10000) });
    const data = await response.json();
    if (!response.ok || data.ok !== true || data.application !== 'nimble-studio') throw new Error('The public address is not serving the ready Nimble release.');
    console.log(JSON.stringify({ ok: true, url: origin, verification: 'public HTTPS certificate and application readiness' }));
    process.exit(0);
  } catch (error) {
    lastError = error;
    console.error('Waiting for public HTTPS readiness (' + attempt + '/12).');
    if (attempt < 12) await new Promise(resolve => setTimeout(resolve, 5000));
  }
}
throw new Error('Containers may be running, but public HTTPS verification failed. Check DNS, firewall and Caddy certificate logs. ' + lastError.message);
