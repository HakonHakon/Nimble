import { escapeHtml as e } from '/assets/site-model.mjs';
const $ = id => document.getElementById(id);
let csrf = '', identity, before = null;
async function api(url, options = {}) {
  const response = await fetch(url, { ...options, headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf, ...(options.headers || {}) } });
  if (response.status === 401) { location.replace('/login.html?next=/control-panel.html'); throw new Error('Please sign in again.'); }
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || 'Request failed.');
  return result;
}
const notice = (message, error = false) => { $('notice').textContent = message; $('notice').style.color = error ? '#b54747' : '#2b8a64'; };
async function loadUsers() {
  if (!['owner', 'admin'].includes(identity.role)) return;
  const result = await api('/api/admin/users');
  $('users').innerHTML = '<div class="table-scroll"><table class="table"><thead><tr><th>Name</th><th>Email</th><th>Access</th><th>Actions</th></tr></thead><tbody>' + result.users.map(user => '<tr><td>' + e(user.name) + '</td><td>' + e(user.email) + '</td><td>' + (user.site_role === 'owner' || user.id === identity.user.id ? e(user.site_role) : '<select data-role="' + user.id + '" aria-label="Access for ' + e(user.name) + '">' + ['viewer', 'editor', 'admin'].map(role => '<option ' + (role === user.site_role ? 'selected' : '') + '>' + role + '</option>').join('') + '</select>') + '</td><td>' + (user.site_role === 'owner' || user.id === identity.user.id ? '' : '<button class="btn" data-reset="' + user.id + '">Reset password</button> <button class="delete" data-remove="' + user.id + '">Remove</button>') + '</td></tr>').join('') + '</tbody></table></div>';
}
async function loadMessages(older = false) {
  const result = await api('/api/messages' + (older && before ? '?before=' + before : ''));
  before = result.nextBefore;
  if (!older) $('messages').replaceChildren();
  for (const message of result.messages) {
    const article = document.createElement('article'); article.className = 'message-card';
    // Form builder submissions list every field; files download through the authenticated API.
    let fields = null;
    try { fields = message.fields_json ? JSON.parse(message.fields_json) : null; } catch { fields = null; }
    const body = fields ? '<dl class="message-fields">' + fields.map(field => '<dt>' + e(field.label) + '</dt><dd>' + (field.type === 'file'
      ? '<a href="/api/messages/' + message.id + '/files/' + encodeURIComponent(field.file) + '" download="' + e(field.name) + '">' + e(field.name) + '</a> <small>(' + Math.max(1, Math.round(field.size / 1024)) + ' KB)</small>'
      : e(Array.isArray(field.value) ? field.value.join(', ') : field.value)) + '</dd>').join('') + '</dl>' : '<p class="message-body">' + e(message.message) + '</p>';
    article.innerHTML = '<h3>' + e(message.name) + '</h3><p>' + (message.email ? '<a href="mailto:' + e(message.email) + '">' + e(message.email) + '</a> · ' : '') + e(new Date(message.created_at).toLocaleString()) + '</p>' + body + '<button class="delete" data-message-delete="' + message.id + '">Delete message</button>';
    $('messages').append(article);
  }
  if (!$('messages').children.length) $('messages').textContent = 'No messages yet. Enquiries from your published contact forms appear here.';
  $('older').hidden = !before;
}
async function init() {
  try {
    identity = await api('/api/auth/me'); csrf = identity.csrf;
    $('accountName').textContent = identity.user.name + ' · ' + identity.role;
    const administrator = ['owner', 'admin'].includes(identity.role), editor = ['owner', 'admin', 'editor'].includes(identity.role);
    $('teamSection').hidden = !administrator;
    $('inboxSection').hidden = !editor;
    if (administrator) await loadUsers();
    if (editor) await loadMessages();
  } catch (error) { notice(error.message, true); }
}
$('createUser').addEventListener('submit', async event => {
  event.preventDefault(); const button = event.target.querySelector('button'); button.disabled = true;
  try {
    await api('/api/admin/users', { method: 'POST', body: JSON.stringify(Object.fromEntries(new FormData(event.target))) });
    event.target.reset(); notice('Team member added. Share their temporary password securely.'); await loadUsers();
  } catch (error) { notice(error.message, true); } finally { button.disabled = false; }
});
$('passwordForm').addEventListener('submit', async event => {
  event.preventDefault(); const button = event.target.querySelector('button'); button.disabled = true;
  try {
    const result = await api('/api/auth/password', { method: 'POST', body: JSON.stringify(Object.fromEntries(new FormData(event.target))) });
    csrf = result.csrf; event.target.reset(); notice('Password changed. Other sessions have been signed out.');
  } catch (error) { notice(error.message, true); } finally { button.disabled = false; }
});
$('resetForm').addEventListener('submit', async event => {
  event.preventDefault();
  try {
    await api('/api/admin/users/' + $('resetId').value + '/reset-password', { method: 'POST', body: JSON.stringify({ password: $('resetPassword').value }) });
    $('resetDialog').close(); event.target.reset(); notice('Password reset. Share the temporary password securely.');
  } catch (error) { $('resetError').textContent = error.message; }
});
$('users').addEventListener('change', async event => {
  if (!event.target.dataset.role) return;
  try { await api('/api/admin/users/' + event.target.dataset.role, { method: 'PATCH', body: JSON.stringify({ role: event.target.value }) }); notice('Access updated. This member must sign in again.'); }
  catch (error) { notice(error.message, true); } finally { await loadUsers(); }
});
document.addEventListener('click', async event => {
  const button = event.target.closest('button'); if (!button) return;
  try {
    if (button.dataset.reset) { $('resetId').value = button.dataset.reset; $('resetPassword').value = ''; $('resetError').textContent = ''; $('resetDialog').showModal(); }
    if (button.dataset.remove && confirm('Remove this team member? Their sessions will be revoked.')) { await api('/api/admin/users/' + button.dataset.remove, { method: 'DELETE' }); await loadUsers(); notice('Team member removed.'); }
    if (button.dataset.messageDelete && confirm('Delete this enquiry permanently?')) { await api('/api/messages/' + button.dataset.messageDelete, { method: 'DELETE' }); await loadMessages(); }
  } catch (error) { notice(error.message, true); }
});
$('closeReset').addEventListener('click', () => $('resetDialog').close());
$('older').addEventListener('click', () => loadMessages(true).catch(error => notice(error.message, true)));
$('refreshInbox').addEventListener('click', () => loadMessages().catch(error => notice(error.message, true)));
$('logout').addEventListener('click', async () => {
  try { await api('/api/auth/logout', { method: 'POST' }); localStorage.removeItem('nimble-draft-v2-' + identity.user.id); location.replace('/login.html'); }
  catch (error) { notice(error.message, true); }
});
init();
