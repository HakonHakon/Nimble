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

// Background scroll effects. "reveal" is pure CSS (fixed background); "parallax" moves the
// background more slowly than the page. The effect can differ per breakpoint, so it is read from CSS.
(() => {
  const items = [...document.querySelectorAll('[data-fx]')];
  if (!items.length || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  let queued = false;
  const update = () => {
    queued = false;
    const height = innerHeight;
    for (const element of items) {
      const effect = getComputedStyle(element).getPropertyValue('--fx').trim();
      if (effect !== 'parallax') { element.style.removeProperty('background-position-y'); continue; }
      const rect = element.getBoundingClientRect();
      if (rect.bottom < 0 || rect.top > height) continue;
      const progress = (rect.top + rect.height) / (height + rect.height) - 0.5;
      element.style.backgroundPositionY = 'calc(50% + ' + Math.round(progress * rect.height * 0.35) + 'px)';
    }
  };
  const queue = () => { if (!queued) { queued = true; requestAnimationFrame(update); } };
  addEventListener('scroll', queue, { passive: true });
  addEventListener('resize', queue);
  update();
})();
