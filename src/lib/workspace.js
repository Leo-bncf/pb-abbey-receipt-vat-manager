// Two separate books on the same system: PB Abbey Ltd (UK company, £) and
// Carnas (the family house in France being sold, €). Everything under
// /carnas/... works on Carnas data; everything else on PB Abbey's. The data
// layer (src/api/base44Client.js) filters receipts, folders and scans by it,
// so the scanner pages are shared and stay identical.
export const WORKSPACES = {
  pbabbey: { key: 'pbabbey', base: '', name: 'PB Abbey', tagline: 'Receipts & VAT', currency: 'GBP', country: 'United Kingdom' },
  carnas: { key: 'carnas', base: '/carnas', name: 'Carnas', tagline: 'Payments for the house (France)', currency: 'EUR', country: 'France' },
};

export const currentWorkspace = () =>
  (typeof window !== 'undefined' && /^\/carnas(\/|$)/i.test(window.location.pathname) ? 'carnas' : 'pbabbey');
export const workspace = () => WORKSPACES[currentWorkspace()];
// '/Review' -> '/carnas/Review' when in Carnas.
export const wsPath = (p) => `${workspace().base}${p}`;
