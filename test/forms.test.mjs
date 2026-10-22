import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fixture, sourceRoot } from './helpers.mjs';
import { validateSubmission } from '../lib/forms.mjs';
import { normalizeSiteV2 } from '../lib/site-model-v2.mjs';

const FIELDS = [
  { id: 'who', type: 'step', label: 'About you' },
  { id: 'name', type: 'text', label: 'Full name', required: true },
  { id: 'mail', type: 'email', label: 'Email', required: true },
  { id: 'phone', type: 'phone', label: 'Phone' },
  { id: 'next', type: 'step', label: 'Details' },
  { id: 'role', type: 'select', label: 'Role', options: ['Design', 'Code'], required: true },
  { id: 'level', type: 'radio', label: 'Level', options: ['Junior', 'Senior'] },
  { id: 'skills', type: 'checkbox', label: 'Skills', options: ['CSS', 'JS', 'SQL'] },
  { id: 'years', type: 'number', label: 'Years' },
  { id: 'start', type: 'date', label: 'Start' },
  { id: 'cv', type: 'file', label: 'CV' },
  { id: 'consent', type: 'checkbox', label: 'I agree', required: true },
  { id: 'notes', type: 'textarea', label: 'Notes' }
];
const PDF = 'data:application/pdf;base64,' + Buffer.from('%PDF-1.4\n%fake pdf\n').toString('base64');
const valid = { name: '  Ada Lovelace ', mail: 'ADA@example.com', role: 'Code', level: 'Senior', skills: ['SQL', 'CSS'], years: '12', start: '2026-03-01', cv: { name: 'cv/../ada<1>.pdf', data: PDF }, consent: 'yes', notes: 'Line 1\nLine 2', extra: 'ignored' };
const definition = FIELDS.filter(field => field.type !== 'step');
const site = (fields, extra = {}) => ({ version: 2, site: { name: 'Forms' }, pages: [{ id: 'home', name: 'Home', children: ['s'] }], nodes: { s: { type: 'section', children: ['apply', 'contact'] }, apply: { type: 'form', props: { fields, ...extra } }, contact: { type: 'form' } } });

test('form submissions are validated against the field list, the same in Node and PHP', { skip: false }, () => {
  normalizeSiteV2(site(FIELDS));
  const cases = [
    valid,
    { ...valid, mail: 'not-an-email' },
    { ...valid, name: '' },
    { ...valid, role: 'Management' },
    { ...valid, skills: ['CSS', 'Cobol'] },
    { ...valid, years: '12a' },
    { ...valid, start: '2026-02-30' },
    { ...valid, cv: { name: 'cv.exe', data: 'data:application/octet-stream;base64,' + Buffer.from('MZ binary').toString('base64') } },
    { ...valid, cv: { name: 'notes.txt', data: 'data:text/plain;base64,' + Buffer.from('plain text ✓').toString('base64') } },
    { ...valid, consent: '' },
    { ...valid, phone: '+47 (22) 33-44' , notes: 'x'.repeat(5001) },
    { name: 'Only', mail: 'a@b.co', role: 'Design', consent: true }
  ];
  const js = cases.map(input => {
    try { const result = validateSubmission(definition, input); return { entries: result.entries, files: result.files.map(file => [file.extension, file.bytes.length]), name: result.name, email: result.email, message: result.message }; }
    catch (error) { return { error: error.message }; }
  });
  assert.equal(js[0].name, 'Ada Lovelace');
  assert.equal(js[0].email, 'ada@example.com');
  assert.deepEqual(js[0].entries.find(entry => entry.id === 'skills').value, ['CSS', 'SQL'], 'options keep their defined order');
  assert.deepEqual(js[0].entries.find(entry => entry.id === 'cv'), { id: 'cv', label: 'CV', type: 'file', name: 'cv_.._ada_1_.pdf', size: 19 });
  assert.deepEqual(js[0].files, [['pdf', 19]]);
  assert.match(js[0].message, /^Full name: Ada Lovelace\nEmail: ADA@example.com\n/);
  assert.deepEqual(js.slice(1, 8).map(item => item.error), ['Enter a valid email address for “Email”.', 'Fill in “Full name”.', 'Choose one of the options for “Role”.', 'Choose from the options for “Skills”.', 'Enter a number for “Years”.', 'Enter a valid date for “Start”.', '“CV” must be a PDF, image, Word or text file.']);
  assert.deepEqual(js[8].files, [['txt', 14]]);
  assert.equal(js[9].error, 'Fill in “I agree”.');
  assert.equal(js[10].error, '“Notes” can be at most 5000 characters.');
  assert.deepEqual(js[11].entries.map(entry => entry.id), ['name', 'mail', 'role', 'consent']);
  if (spawnSync('php', ['-v']).status !== 0) return;
  const result = spawnSync('php', [path.join(sourceRoot, 'test/php/forms-run.php')], { input: JSON.stringify({ fields: definition, cases }), encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), js);
});

test('server: builder forms store fields and private files; the inbox serves them to editors only', async t => {
  const f = await fixture(); t.after(() => f.cleanup());
  const owner = await f.login();
  assert.equal((await f.save(owner, site(FIELDS, { success: 'Thanks!' }))).status, 200);
  const revision = (await f.request('/api/site', { auth: owner })).data.revision;
  assert.equal((await f.request('/api/publish', { method: 'POST', auth: owner, body: { revision } })).status, 200);
  const html = (await f.request('/')).text;
  assert.match(html, /<form action="\/api\/contact" method="post" data-contact-form data-block="apply" data-fields data-success="Thanks!" novalidate>/);
  assert.match(html, /<input type="file" name="cv" accept="\.pdf,\.jpg,\.jpeg,\.png,\.webp,\.txt,\.doc,\.docx">/);
  const token = async block => (await f.request('/api/contact-token?block=' + block)).data.token;
  const send = async (fields, block = 'apply') => f.request('/api/contact', { method: 'POST', body: { token: await token(block), website: '', fields } });
  assert.equal((await send({ ...valid, mail: 'nope' })).status, 400);
  const sent = await send(valid);
  assert.equal(sent.status, 201, sent.text);
  const legacy = await f.request('/api/contact', { method: 'POST', body: { token: await token('contact'), name: 'Old', email: 'old@example.com', message: 'Classic form' } });
  assert.equal(legacy.status, 201, legacy.text);
  const inbox = (await f.request('/api/messages', { auth: owner })).data.messages;
  assert.equal(inbox.length, 2);
  const message = inbox.find(item => item.page_id === 'apply');
  assert.equal(message.name, 'Ada Lovelace');
  const entries = JSON.parse(message.fields_json);
  const cv = entries.find(entry => entry.id === 'cv');
  assert.match(cv.file, /^[a-f0-9-]{36}\.pdf$/);
  const download = await f.request('/api/messages/' + message.id + '/files/' + cv.file, { auth: owner });
  assert.equal(download.status, 200);
  assert.equal(download.headers.get('content-type'), 'application/pdf');
  assert.match(download.headers.get('content-disposition'), /^attachment; filename\*=UTF-8''cv_.._ada_1_\.pdf$/);
  assert.match(download.text, /^%PDF-1\.4/);
  assert.equal((await f.request('/api/messages/' + message.id + '/files/' + cv.file)).status, 401);
  assert.equal((await f.request('/uploads/' + cv.file)).status, 404, 'form files are not public uploads');
  assert.equal(inbox.find(item => item.page_id === 'contact').fields_json, null);
  assert.equal((await f.request('/api/messages/' + message.id, { method: 'DELETE', auth: owner })).status, 200);
  assert.equal((await f.request('/api/messages/' + message.id + '/files/' + cv.file, { auth: owner })).status, 404);
});
