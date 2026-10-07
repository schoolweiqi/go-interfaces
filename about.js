// Standalone "about project" modal.
// Kept independent from ui.js so it works even if game initialization fails.
(() => {
  const logo = document.getElementById('schoolLogoButton');
  const modal = document.getElementById('aboutModal');
  const closeButton = document.getElementById('aboutModalClose');

  if (!logo || !modal || !closeButton) return;

  function open() {
    modal.hidden = false;
    document.body.classList.add('modalOpen');
    closeButton.focus();
  }

  function close() {
    if (modal.hidden) return;
    modal.hidden = true;
    document.body.classList.remove('modalOpen');
    logo.focus();
  }

  logo.addEventListener('click', open);
  closeButton.addEventListener('click', close);

  modal.addEventListener('click', (event) => {
    if (event.target && event.target.hasAttribute('data-about-close')) close();
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !modal.hidden) close();
  });
})();
