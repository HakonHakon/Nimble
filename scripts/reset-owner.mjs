import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { passwordHash } from '../lib/passwords.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const storage = path.resolve(process.env.PARSEN_STORAGE_DIR || root);
const credentials = await passwordHash(process.env.PARSEN_OWNER_NEW_PASSWORD);
const db = new DatabaseSync(path.join(storage, 'data', 'parsen.sqlite'));
db.exec('PRAGMA busy_timeout=5000; BEGIN IMMEDIATE;');
try {
  const site = db.prepare("SELECT owner_id FROM sites WHERE id='parsen'").get();
  if (!site) throw new Error('No site owner exists. Use initial provisioning or restore an account database.');
  db.prepare('UPDATE users SET password_hash=?,password_salt=? WHERE id=?').run(credentials.hash, credentials.salt, site.owner_id);
  db.prepare('DELETE FROM sessions WHERE user_id=?').run(site.owner_id);
  db.prepare('INSERT INTO audit_events(user_id,action,metadata_json,created_at) VALUES(?,?,?,?)').run(site.owner_id, 'owner_recovered_from_host', '{}', new Date().toISOString());
  db.exec('COMMIT');
  console.log('Owner password reset. All owner sessions were revoked.');
} catch (error) { db.exec('ROLLBACK'); throw error; }
finally { db.close(); }
