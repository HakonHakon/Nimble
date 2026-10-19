document.querySelectorAll('[data-contact-form]').forEach(form => {
  let tokenPromise;
  const status = form.querySelector('[role=status]');
  const loadToken = () => tokenPromise ||= fetch('/api/contact-token?block=' + encodeURIComponent(form.dataset.block)).then(async response => {
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Contact form unavailable.');
    form.elements.token.value = data.token;
    return data.token;
  });
  loadToken().catch(error => { status.textContent = error.message; tokenPromise = null; });
  form.addEventListener('submit', async event => {
    event.preventDefault();
    const button = form.querySelector('button');
    button.disabled = true;
    status.textContent = 'Sending…';
    try {
      await loadToken();
      const response = await fetch(form.action, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(Object.fromEntries(new FormData(form))) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Message could not be sent.');
      form.reset();
      status.textContent = 'Thank you. Your message has reached our team.';
      tokenPromise = null;
      loadToken().catch(() => { tokenPromise = null; });
    } catch (error) { status.textContent = error.message; tokenPromise = null; }
    finally { button.disabled = false; }
  });
});
