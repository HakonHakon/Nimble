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

// Gallery sliders: arrow buttons and optional autoplay (paused on hover, focus and reduced motion).
document.querySelectorAll('[data-slider]').forEach(slider => {
  const track = slider.querySelector('.g-track');
  const count = track.children.length;
  const current = () => Math.round(track.scrollLeft / Math.max(1, track.clientWidth));
  const go = index => track.scrollTo({ left: ((index + count) % count) * track.clientWidth });
  slider.querySelector('.g-prev')?.addEventListener('click', () => go(current() - 1));
  slider.querySelector('.g-next')?.addEventListener('click', () => go(current() + 1));
  const seconds = Number(slider.dataset.autoplay);
  if (!seconds || count < 2 || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  let paused = false;
  for (const [type, value] of [['mouseenter', true], ['mouseleave', false], ['focusin', true], ['focusout', false]]) slider.addEventListener(type, () => { paused = value; });
  setInterval(() => { if (!paused && !document.hidden) go(current() + 1); }, seconds * 1000);
});

// Gallery lightbox: opens the clicked image full screen; arrows and Esc work as expected.
document.querySelectorAll('[data-lightbox]').forEach(gallery => {
  const items = [...gallery.querySelectorAll('.g-open')];
  let dialog = null, index = 0;
  const show = next => {
    index = (next + items.length) % items.length;
    const source = items[index], caption = source.parentElement.querySelector('figcaption');
    dialog.querySelector('img').src = source.getAttribute('href');
    dialog.querySelector('img').alt = source.querySelector('img')?.alt || '';
    dialog.querySelector('figcaption').textContent = caption ? caption.textContent : '';
  };
  const open = start => {
    if (!dialog) {
      dialog = document.createElement('dialog');
      dialog.className = 'lightbox';
      dialog.setAttribute('aria-label', 'Image viewer');
      dialog.innerHTML = '<figure><img alt=""><figcaption></figcaption></figure><button type="button" class="lb-close" aria-label="Close">×</button><button type="button" class="lb-prev" aria-label="Previous image">‹</button><button type="button" class="lb-next" aria-label="Next image">›</button>';
      dialog.querySelector('.lb-close').addEventListener('click', () => dialog.close());
      dialog.querySelector('.lb-prev').addEventListener('click', () => show(index - 1));
      dialog.querySelector('.lb-next').addEventListener('click', () => show(index + 1));
      dialog.addEventListener('keydown', event => { if (event.key === 'ArrowLeft') show(index - 1); if (event.key === 'ArrowRight') show(index + 1); });
      dialog.addEventListener('click', event => { if (event.target === dialog) dialog.close(); });
      document.body.append(dialog);
    }
    show(start);
    dialog.showModal();
  };
  items.forEach((item, i) => item.addEventListener('click', event => { event.preventDefault(); open(i); }));
});
