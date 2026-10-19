import { promises as fs } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { inventory } from './backup.mjs';

if (process.env.PARSEN_ALLOW_RESTORE !== 'yes') throw new Error('Stop Studio and the backup service, then set PARSEN_ALLOW_RESTORE=yes for this restore command.');
const source = path.resolve(process.argv[2] || '');
const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const storage = path.resolve(process.env.PARSEN_STORAGE_DIR || appRoot);
if (!process.argv[2] || source === storage || source.startsWith(path.join(storage, 'data') + path.sep)) throw new Error('Supply a separate backup directory.');
const manifest = JSON.parse(await fs.readFile(path.join(source, 'manifest.json'), 'utf8'));
if (manifest.format !== 2 || manifest.application !== 'parsen-studio') throw new Error('Unsupported backup format.');
const actual = await inventory(source);
if (JSON.stringify(actual) !== JSON.stringify(manifest.files)) throw new Error('The backup checksum inventory does not match. No data was changed.');
const validation = new DatabaseSync(path.join(source, 'data', 'parsen.sqlite'), { readOnly: true });
try { if (validation.prepare('PRAGMA integrity_check').get().integrity_check !== 'ok') throw new Error('The backup database is damaged.'); }
finally { validation.close(); }
const staged = path.join(storage, '.restore-' + randomUUID());
const previous = path.join(storage, '.before-restore-' + randomUUID());
await fs.mkdir(staged, { recursive: true }); await fs.mkdir(previous);
const moved = [], installed = [];
try {
  for (const name of ['data', 'uploads', 'published']) await fs.cp(path.join(source, name), path.join(staged, name), { recursive: true });
  for (const name of ['data', 'uploads', 'published']) {
    try { await fs.rename(path.join(storage, name), path.join(previous, name)); moved.push(name); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    await fs.rename(path.join(staged, name), path.join(storage, name)); installed.push(name);
  }
  console.log(JSON.stringify({ ok: true, restoredFrom: source, previousData: previous }));
} catch (error) {
  for (const name of installed.reverse()) await fs.rename(path.join(storage, name), path.join(staged, name));
  for (const name of moved.reverse()) await fs.rename(path.join(previous, name), path.join(storage, name));
  throw error;
} finally { await fs.rm(staged, { recursive: true, force: true }); }
