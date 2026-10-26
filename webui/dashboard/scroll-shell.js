/* Let the same-origin trading header scroll out with the dashboard; restore it on exit. */
(() => {
  if (parent === window) return;
  let shell, style;
  try {
    shell = parent.document.querySelector('.trading-shell');
    if (!shell) return;
    style = parent.document.createElement('style');
    style.textContent = `
      .trading-shell.velovest-dashboard .domain-page-frame { height: calc(100dvh - var(--velovest-header-size, var(--shell-header-height))); }
      .trading-shell.velovest-dashboard .trading-header { font-family: "Proxima Nova", Arial, Verdana, sans-serif; }
      .trading-shell.velovest-dashboard .trading-brand { width: 280px; max-width: 280px; }
      .trading-shell.velovest-dashboard .trading-brand img { width: 100%; height: auto; object-fit: contain; image-rendering: auto; }
      .trading-shell.velovest-dashboard.velovest-scrolled .trading-header { margin-top: calc(-1 * var(--velovest-header-size)); visibility: hidden; }
      .trading-shell.velovest-dashboard.velovest-scrolled .domain-page-frame { height: 100dvh; }
      .trading-shell.velovest-dashboard:focus-within .trading-header:focus-within { margin-top: 0; visibility: visible; }
      @media(max-width:700px) { .trading-shell.velovest-dashboard .trading-brand { width: min(220px, calc(100vw - 112px)); max-width: 100%; } }
    `;
    parent.document.head.append(style); shell.classList.add('velovest-dashboard');
    const update = () => {
      const header = shell.querySelector('.trading-header');
      if (header) shell.style.setProperty('--velovest-header-size', header.getBoundingClientRect().height + 'px');
      shell.classList.toggle('velovest-scrolled', scrollY > 40);
    };
    window.addEventListener('scroll', update, { passive: true });
    window.addEventListener('resize', update); update();
    window.addEventListener('pagehide', () => { style.remove(); shell.classList.remove('velovest-dashboard', 'velovest-scrolled'); shell.style.removeProperty('--velovest-header-size'); }, { once: true });
  } catch { /* Standalone reports and cross-origin embeds keep their own shell. */ }
})();
