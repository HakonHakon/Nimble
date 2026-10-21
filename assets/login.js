const $ = id => document.getElementById(id);
const requested = new URLSearchParams(location.search).get('next') || '/editor.html';
const next = ['/builder.html', '/editor.html', '/control-panel.html'].includes(requested.split('#')[0]) ? requested : '/editor.html';
let setup = false;
const message = text => { $('message').textContent = text; };
const tokenField = document.createElement('div'); tokenField.className = 'field hidden';
tokenField.innerHTML = '<label for="setupToken">Private setup token</label><input id="setupToken" type="password" autocomplete="off">';
$('authForm').insertBefore(tokenField, $('authForm').firstChild);
$('message').setAttribute('role', 'status');
$('submit').disabled = true;
async function init() {
  try {
    const response = await fetch('/api/auth/me');
    if (response.ok) return location.replace(next);
    const result = await fetch('/api/auth/setup-status');
    if (!result.ok) throw new Error('Sign in is temporarily unavailable.');
    const status = await result.json(); setup = status.setupRequired;
    if (setup) {
      $('title').textContent = 'Create your owner account';
      $('subtitle').textContent = 'Set up secure access for your team.';
      $('nameField').classList.remove('hidden'); $('name').required = true;
      $('password').autocomplete = 'new-password'; $('submit').textContent = 'Create owner account';
      $('setupHint').classList.remove('hidden');
      if (status.tokenRequired) { tokenField.classList.remove('hidden'); $('setupToken').required = true; }
    }
    $('submit').disabled = false;
  } catch (error) { message(error.message || 'The server is unavailable. Reload to retry.'); }
}
$('authForm').addEventListener('submit', async event => {
  event.preventDefault(); message(''); $('submit').disabled = true;
  try {
    const response = await fetch(setup ? '/api/auth/setup' : '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: $('name').value, email: $('email').value, password: $('password').value, setupToken: $('setupToken').value }) });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Unable to sign in.');
    location.replace(next);
  } catch (error) { message(error.message); $('submit').disabled = false; }
});
init();
