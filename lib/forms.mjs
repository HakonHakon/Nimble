// Form builder submissions: validates the posted values against the published field list and
// detects uploaded file types by content. Ported 1:1 in php-backend/lib/forms.php.
import { spec } from './site-model-v2.mjs';

const L = spec.limits;
const EMAIL = /^[^\s@<>"']{1,64}@[^\s@<>"']{1,190}\.[^\s@<>"']{2,}$/;
const fail = message => { throw Object.assign(new Error(message), { statusCode: 400 }); };

// File types accepted by file fields, recognised by their first bytes (and the name for text and Word).
export function formFileType(bytes, name) {
  const head = bytes.subarray(0, 8), lower = String(name).toLowerCase();
  if (head.subarray(0, 5).toString('latin1') === '%PDF-') return 'pdf';
  if (head.equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return 'png';
  if (head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) return 'jpg';
  if (head.subarray(0, 4).toString('latin1') === 'RIFF' && bytes.subarray(8, 12).toString('latin1') === 'WEBP') return 'webp';
  if (head.subarray(0, 4).equals(Buffer.from([0x50, 0x4b, 0x03, 0x04])) && lower.endsWith('.docx')) return 'docx';
  if (head.equals(Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])) && lower.endsWith('.doc')) return 'doc';
  if (lower.endsWith('.txt') && !bytes.includes(0) && Buffer.from(bytes.toString('utf8'), 'utf8').equals(bytes)) return 'txt';
  return null;
}
export const FORM_FILE_TYPES = { pdf: 'application/pdf', png: 'image/png', jpg: 'image/jpeg', webp: 'image/webp', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', doc: 'application/msword', txt: 'text/plain; charset=utf-8' };

const cleanName = name => String(name || 'file').replace(/[\u0000-\u001f\u007f"\\/<>:|?*]+/g, '_').trim().slice(0, 120) || 'file';
const missing = value => value === undefined || value === null || value === '' || (Array.isArray(value) && !value.length);

// Returns { entries, files, name, email, message }: entries for the inbox, files still to be stored
// ({ bytes, extension, entry }), and the classic columns (name, email, summary message).
export function validateSubmission(fields, input) {
  const values = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
  const entries = [], files = [];
  for (const field of fields) {
    const raw = values[field.id];
    const label = '“' + field.label + '”';
    if (missing(raw) || (field.type === 'checkbox' && !field.options && raw !== 'yes' && raw !== true)) {
      if (field.required) fail('Fill in ' + label + '.');
      continue;
    }
    let value;
    if (field.type === 'file') {
      const match = typeof raw?.data === 'string' && raw.data.match(/^data:[a-z0-9.+/-]*;base64,([a-z0-9+/]+={0,2})$/i);
      if (!match) fail('Upload a file for ' + label + '.');
      const bytes = Buffer.from(match[1], 'base64');
      if (bytes.length > L.formFileBytes) fail('Files must be at most ' + Math.round(L.formFileBytes / 1048576) + ' MB.');
      const extension = formFileType(bytes, raw.name);
      if (!extension) fail(label + ' must be a PDF, image, Word or text file.');
      const entry = { id: field.id, label: field.label, type: 'file', name: cleanName(raw.name), size: bytes.length };
      entries.push(entry); files.push({ bytes, extension, entry });
      continue;
    }
    if (field.type === 'checkbox' && field.options) {
      if (!Array.isArray(raw) || raw.some(item => !field.options.includes(item))) fail('Choose from the options for ' + label + '.');
      value = field.options.filter(option => raw.includes(option));
    } else if (field.type === 'checkbox') value = 'Yes';
    else {
      if (typeof raw !== 'string') fail('Invalid value for ' + label + '.');
      value = raw.trim();
      if (!value) { if (field.required) fail('Fill in ' + label + '.'); continue; }
      const max = field.type === 'textarea' ? 5000 : 500;
      if ([...value].length > max) fail(label + ' can be at most ' + max + ' characters.');
      if (field.type === 'email' && !EMAIL.test(value)) fail('Enter a valid email address for ' + label + '.');
      if (field.type === 'phone' && !/^\+?[0-9() .-]{3,30}$/.test(value)) fail('Enter a valid phone number for ' + label + '.');
      if (field.type === 'number' && !/^-?\d{1,15}(\.\d{1,6})?$/.test(value)) fail('Enter a number for ' + label + '.');
      if (field.type === 'date' && (!/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(Date.parse(value + 'T00:00:00Z')) || new Date(value + 'T00:00:00Z').toISOString().slice(0, 10) !== value)) fail('Enter a valid date for ' + label + '.');
      if ((field.type === 'select' || field.type === 'radio') && !field.options.includes(value)) fail('Choose one of the options for ' + label + '.');
    }
    entries.push({ id: field.id, label: field.label, type: field.type, value });
  }
  const text = entry => entry.type === 'file' ? entry.name : Array.isArray(entry.value) ? entry.value.join(', ') : entry.value;
  const name = (entries.find(entry => entry.type === 'text')?.value || 'Website visitor').slice(0, 120);
  const email = (entries.find(entry => entry.type === 'email')?.value || '').toLowerCase();
  const message = entries.map(entry => entry.label + ': ' + text(entry)).join('\n').slice(0, 5000) || '(empty)';
  return { entries, files, name, email, message };
}
