import { promises as fs } from 'node:fs';
import path from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import { currentRelease } from '../lib/publish-atomic.mjs';

export async function inventory(directory, relative = '') {
  const result = [];
  for (const entry of await fs.readdir(path.join(directory, relative), { withFileTypes: true })) {
    const name = path.join(relative, entry.name);
    if (entry.isSymbolicLink()) throw new Error('Symlinks are not supported in backups.');
    if (entry.isDirectory()) result.push(...await inventory(directory, name));
    else if (entry.isFile() && name !== 'manifest.json') {
      const bytes = await fs.readFile(path.join(directory, name));
      result.push({ path: name.split(path.sep).join('/'), size: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') });
    }
  }
  return result.sort((a, b) => a.path.localeCompare(b.path));
}
export async function backup() {
  const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const storage = path.resolve(process.env.NIMBLE_STORAGE_DIR || appRoot);
  const backupRoot = path.resolve(process.env.NIMBLE_BACKUP_DIR || path.join(storage, 'backups'));
  const id = 'nimble-' + new Date().toISOString().replace(/[:.]/g, '-') + '-' + randomUUID().slice(0, 8);
  const destination = path.join(backupRoot, id), pending = destination + '.partial';
  await fs.mkdir(path.join(pending, 'data'), { recursive: true, mode: 0o700 });
  try {
    const database = new DatabaseSync(path.join(storage, 'data', 'nimble.sqlite'), { readOnly: true });
    try { database.exec("VACUUM INTO '" + path.join(pending, 'data', 'nimble.sqlite').replaceAll("'", "''") + "'"); }
    finally { database.close(); }
    // Database first: uploads are immutable and always exist before a draft can reference them.
    await fs.cp(path.join(storage, 'uploads'), path.join(pending, 'uploads'), { recursive: true });
    const release = await currentRelease(path.join(storage, 'published'));
    await fs.mkdir(path.join(pending, 'published', 'releases'), { recursive: true });
    if (release) {
      await fs.cp(release.directory, path.join(pending, 'published', 'releases', release.id), { recursive: true });
      await fs.writeFile(path.join(pending, 'published', 'current.json'), JSON.stringify({ id: release.id, publishedAt: release.publishedAt }));
    }
    const check = new DatabaseSync(path.join(pending, 'data', 'nimble.sqlite'), { readOnly: true });
    try { if (check.prepare('PRAGMA integrity_check').get().integrity_check !== 'ok') throw new Error('Backup database failed integrity validation.'); }
    finally { check.close(); }
    const manifest = { format: 2, application: 'nimble-studio', createdAt: new Date().toISOString(), files: await inventory(pending) };
    await fs.writeFile(path.join(pending, 'manifest.json'), JSON.stringify(manifest, null, 2));
    await fs.rename(pending, destination);
    return { ok: true, backup: destination, createdAt: manifest.createdAt };
  } catch (error) {
    await fs.rm(pending, { recursive: true, force: true });
    throw error;
  }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) console.log(JSON.stringify(await backup()));
