import { promises as fs } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

const queues = new Map();
export function publishAtomic(options) {
  const key = path.resolve(options.publishedDir);
  const task = (queues.get(key) || Promise.resolve()).catch(() => {}).then(() => writeRelease(options));
  queues.set(key, task);
  task.finally(() => { if (queues.get(key) === task) queues.delete(key); }).catch(() => {});
  return task;
}
async function writeRelease({ publishedDir, site, renderPage }) {
  const id = randomUUID();
  const releaseDir = path.join(publishedDir, 'releases', id);
  await fs.mkdir(releaseDir, { recursive: true });
  // Releases are immutable. An incomplete generation is never reachable by readers.
  for (const page of site.pages) {
    await fs.writeFile(path.join(releaseDir, page.id === 'home' ? 'index.html' : page.id + '.html'), renderPage(site, page), { encoding: 'utf8', flag: 'wx' });
  }
  await fs.writeFile(path.join(releaseDir, 'site.json'), JSON.stringify(site), { flag: 'wx' });
  const publishedAt = new Date().toISOString();
  const marker = path.join(publishedDir, 'current-' + id + '.tmp');
  const handle = await fs.open(marker, 'wx');
  try {
    await handle.writeFile(JSON.stringify({ id, publishedAt }));
    await handle.sync();
  } finally { await handle.close(); }
  await fs.rename(marker, path.join(publishedDir, 'current.json'));
  return { url: '/published/', publicUrl: '/', publishedAt, releaseId: id };
}
export async function currentRelease(publishedDir) {
  try {
    const marker = JSON.parse(await fs.readFile(path.join(publishedDir, 'current.json'), 'utf8'));
    if (!/^[a-f0-9-]{36}$/.test(marker.id)) throw new Error('Invalid publication marker.');
    const directory = path.join(publishedDir, 'releases', marker.id);
    const site = JSON.parse(await fs.readFile(path.join(directory, 'site.json'), 'utf8'));
    await fs.access(path.join(directory, 'index.html'));
    return { ...marker, directory, site };
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}
