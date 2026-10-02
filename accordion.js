// Independent accordion behavior for the left sidebar.
// Kept outside ui.js so menu collapsing does not depend on game initialization.
document.addEventListener('click', (event) => {
  const toggle = event.target.closest('.panelToggle');
  if (!toggle) return;

  const bodyId = toggle.getAttribute('aria-controls');
  if (!bodyId) return;

  const body = document.getElementById(bodyId);
  if (!body) return;

  const opening = body.hidden;
  body.hidden = !opening;
  toggle.setAttribute('aria-expanded', String(opening));
  toggle.classList.toggle('active', opening);
});
