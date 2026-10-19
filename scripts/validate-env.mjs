import { loadEnvFile } from 'node:process';
loadEnvFile(process.argv[2] || '.env');
const fail = message => { console.error(message); process.exit(1); };
let origin;
try { origin = new URL(process.env.PARSEN_PUBLIC_URL); } catch { fail('Set PARSEN_PUBLIC_URL to the HTTPS URL of this deployment.'); }
if (origin.protocol !== 'https:' || origin.pathname !== '/' || origin.search || origin.hash || origin.username || origin.password) fail('PARSEN_PUBLIC_URL must be an HTTPS origin without a path or credentials.');
if (process.env.PARSEN_DOMAIN !== origin.hostname) fail('PARSEN_DOMAIN must match the hostname in PARSEN_PUBLIC_URL.');
if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(process.env.PARSEN_ADMIN_EMAIL || '') || /@example\./.test(process.env.PARSEN_ADMIN_EMAIL)) fail('Set the real site-owner email.');
const password = process.env.PARSEN_ADMIN_PASSWORD || '';
if (password.length < 12 || password.length > 256 || /replace-with|test-only|example-password/i.test(password)) fail('Set a unique owner password of 12–256 characters.');
console.log(process.argv.includes('--print-origin') ? origin.origin : 'Production environment validated. No secrets printed.');
