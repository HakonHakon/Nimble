import { backup } from './backup.mjs';
import { pruneBackups } from './prune-backups.mjs';
const hours = Number(process.env.PARSEN_BACKUP_INTERVAL_HOURS || 24);
if (!Number.isFinite(hours) || hours < 1 || hours > 168) throw new Error('Backup interval must be 1–168 hours.');
const interval = hours * 3600000;
async function run() {
  try { console.log(JSON.stringify({ ...await backup(), retention: await pruneBackups() })); }
  catch (error) { console.error(JSON.stringify({ event: 'backup_failed', message: error.message })); process.exitCode = 1; }
}
await run();
if (process.exitCode) process.exit(process.exitCode);
setInterval(async () => { await run(); if (process.exitCode) process.exit(process.exitCode); }, interval);
