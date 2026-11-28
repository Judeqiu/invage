import type { RequestHandler } from 'express';

/** Critical header layout belongs to the host document, before any iframe loads. */
const tradingShellCss = `
.trading-shell .trading-header { font-family:"Proxima Nova",Arial,Verdana,sans-serif; }
.trading-shell .trading-brand { max-width:220px; }
.trading-shell .trading-brand img { width:220px; height:61px; object-fit:cover; object-position:center; }
@media(max-width:700px) {
  .trading-shell .trading-brand { max-width:165px; }
  .trading-shell .trading-brand img { width:165px; height:46px; }
}
`;

// Match the landing handoff in Utarus's login embed. An explicit document URL
// already chose its destination, so the SPA must not apply its default later.
const tradingShellEntry = `<script>
  if (window === window.top && (location.pathname !== '/' || new URLSearchParams(location.search).get('c')?.trim())) {
    try { sessionStorage.setItem('utarus_default_landed', '1'); } catch { /* Storage is unavailable. */ }
  }
</script>`;

/** Add Velovest's entry handling and critical layout to the framework SPA. */
export const tradingShellFirstPaint: RequestHandler = (_req, res, next) => {
  const send = res.send;
  res.send = function (body) {
    if (typeof body === 'string' && body.includes('<div id="root"></div>') && body.includes('</head>')) {
      body = body.replace('</head>', `<style id="velovest-trading-shell">${tradingShellCss}</style>${tradingShellEntry}</head>`);
    }
    return send.call(this, body);
  };
  next();
};
