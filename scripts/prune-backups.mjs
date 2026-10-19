import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export async function pruneBackups() {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const storage = path.resolve(process.env.PARSEN_STORAGE_DIR || root);
  const backupRoot = path.resolve(process.env.PARSEN_BACKUP_DIR || path.join(storage, 'backups'));
  const retain = Number(process.env.PARSEN_BACKUP_RETENTION_COUNT || 14);
  if (!Number.isInteger(retain) || retain < 2 || retain > 365) throw new Error('Backup retention must be an integer from 2 to 365.');
  const backups = [];
  for (const entry of await fs.readdir(backupRoot, { withFileTypes: true })) {
    if (!entry.isDirectory() || !/^parsen-\d{4}-\d{2}-\d{2}T[0-9Z-]+-[a-f0-9]{8}$/.test(entry.name)) continue;
    const directory = path.resolve(backupRoot, entry.name);
    if (path.dirname(directory) !== backupRoot) throw new Error('Unexpected backup path.');
    let manifest;
    try { manifest = JSON.parse(await fs.readFile(path.join(directory, 'manifest.json'), 'utf8')); } catch { continue; }
    if (manifest.format === 2 && manifest.application === 'parsen-studio' && Number.isFinite(Date.parse(manifest.createdAt))) backups.push({ directory, createdAt: manifest.createdAt });
  }
  backups.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const expired = backups.slice(retain);
  for (const backup of expired) await fs.rm(backup.directory, { recursive: true });
  return { retained: Math.min(retain, backups.length), removed: expired.length };
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) console.log(JSON.stringify(await pruneBackups()));
