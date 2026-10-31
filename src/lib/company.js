// PB ABBEY LTD — Companies House record (checked 5 Oct 2026) and the legal
// deadlines that follow from it. Shared by the Company page and the home To do.
// The scan-runner (mail-imap/runner.js) repeats the same rules for email reminders.

export const COMPANY = {
  name: 'PB ABBEY LTD',
  number: '08819146',
  incorporated: '2013-12-18',
  type: 'Private limited company',
  registeredOffice: 'One New Street, Wells, Somerset, England, BA5 2LA',
  tradingAddress: 'Riverside Road, Pottington Business Park, Barnstaple, Devon EX31 1QN',
  sic: ['41100 – Development of building projects', '68209 – Other letting and operating of own or leased real estate'],
  directors: [
    { name: 'Peter Ben Bancroft', since: '2013-12-18', note: 'Director · 25–50% of shares and votes' },
    { name: 'Christine Isabelle Bancroft', since: '2013-12-18', note: 'Director · 25–50% of shares and votes' },
  ],
  charges: [
    { code: '0881 9146 0001', created: '2026-07-21', lender: 'Handelsbanken PLC', what: 'Fixed charge' },
    { code: '0881 9146 0002', created: '2026-07-21', lender: 'Handelsbanken PLC', what: 'Team House, Riverside Road, Pottington Industrial Estate' },
  ],
  lastAccounts: '2025-06-30',
  // Accounting reference date: 29 June (Companies House). Earlier years are filed.
  firstOpenYearEnd: '2026-06-29',
  // Confirmation statement review date: 18 December, due 14 days later.
  firstOpenReview: '2026-12-18',
  chUrl: 'https://find-and-update.company-information.service.gov.uk/company/08819146',
};

const pad = (n) => String(n).padStart(2, '0');
export const iso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const at = (s) => new Date(`${s}T12:00:00`);
// Add months keeping the day (29 Jun + 9 months = 29 Mar).
const addMonths = (s, m) => { const d = at(s); const day = d.getDate(); d.setDate(1); d.setMonth(d.getMonth() + m); d.setDate(Math.min(day, new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate())); return iso(d); };
const addDays = (s, n) => { const d = at(s); d.setDate(d.getDate() + n); return iso(d); };
const fmt = (s) => at(s).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });

export const KINDS = {
  cs: { label: 'Confirmation statement', who: 'Companies House', how: 'File online at Companies House — a few minutes if nothing has changed.', url: 'https://www.gov.uk/file-your-confirmation-statement-with-companies-house' },
  accounts: { label: 'Annual accounts', who: 'Companies House', how: 'Usually filed by the accountant. Late filing is fined from £150.', url: 'https://www.gov.uk/file-your-company-accounts-and-tax-return' },
  ct_pay: { label: 'Corporation Tax payment', who: 'HMRC', how: 'Pay the tax for the year (9 months and 1 day after the year end). Interest runs from the day after.', url: 'https://www.gov.uk/pay-corporation-tax' },
  ct600: { label: 'Corporation Tax return (CT600)', who: 'HMRC', how: 'Usually filed by the accountant, 12 months after the year end.', url: 'https://www.gov.uk/company-tax-returns' },
};

// The next open (not done) occurrence of each deadline.
// filed: { "<kind>:<period>": { at, by } }
export function companyDeadlines(filed = {}) {
  const out = [];
  const next = (kind, first, step, dueOf, periodLabel) => {
    let p = first;
    for (let i = 0; i < 50 && filed[`${kind}:${p}`]; i++) p = addMonths(p, step);
    out.push({ key: `${kind}:${p}`, kind, period: p, due: dueOf(p), periodLabel: periodLabel(p), ...KINDS[kind] });
  };
  const yearLabel = (ye) => `year to ${fmt(ye)}`;
  next('cs', COMPANY.firstOpenReview, 12, (r) => addDays(r, 14), (r) => `review date ${fmt(r)}`);
  next('accounts', COMPANY.firstOpenYearEnd, 12, (ye) => addMonths(ye, 9), yearLabel);
  next('ct_pay', COMPANY.firstOpenYearEnd, 12, (ye) => addDays(addMonths(ye, 9), 1), yearLabel);
  next('ct600', COMPANY.firstOpenYearEnd, 12, (ye) => addMonths(ye, 12), yearLabel);
  return out.sort((a, b) => (a.due < b.due ? -1 : 1));
}

export const daysUntil = (s) => Math.round((at(s) - at(iso(new Date()))) / 86400000);
export const fmtDate = fmt;

// Financial years (1 July – 30 June), most recent first — for the year-end pack.
export function financialYears(count = 4) {
  const now = new Date();
  const endYear = now.getMonth() >= 6 ? now.getFullYear() + 1 : now.getFullYear(); // FY containing today ends 30 Jun endYear
  return Array.from({ length: count }, (_, i) => {
    const e = endYear - i;
    return { key: `${e - 1}-${e}`, label: `July ${e - 1} – June ${e}`, start: `${e - 1}-07-01`, end: `${e}-06-30`, current: i === 0 };
  });
}

// ---- VAT returns ----
// Quarter pattern is shared (app_settings 'vat_settings'.stagger), set on the VAT return page.
export const VAT_STAGGERS = { 1: [3, 6, 9, 12], 2: [4, 7, 10, 1], 3: [5, 8, 11, 2] };
// Every VAT quarter whose filing deadline (quarter end + 1 month + 7 days) falls in [from, to].
export function vatDeadlines(stagger = 1, from, to) {
  const ends = VAT_STAGGERS[stagger] || VAT_STAGGERS[1];
  const out = [];
  const y0 = Number(from.slice(0, 4)) - 1, y1 = Number(to.slice(0, 4)) + 1;
  for (let y = y0; y <= y1; y++) {
    for (const m of ends) {
      const end = new Date(y, m, 0, 12);
      const start = new Date(end.getFullYear(), end.getMonth() - 2, 1, 12);
      const deadline = iso(new Date(end.getFullYear(), end.getMonth() + 2, 7, 12));
      if (deadline >= from && deadline <= to) out.push({ key: iso(end), start: iso(start), end: iso(end), deadline,
        label: `${start.toLocaleDateString('en-GB', { month: 'short' })}–${end.toLocaleDateString('en-GB', { month: 'short', year: 'numeric' })}` });
    }
  }
  return out.sort((a, b) => (a.deadline < b.deadline ? -1 : 1));
}

// People who use the app (for assigning agenda tasks).
export const TEAM = [
  { email: 'office@pbabbey.com', name: 'Peter' },
  { email: 'chrispetban@gmail.com', name: 'Christine' },
  { email: 'leo.bancroft34@icloud.com', name: 'Leo' },
];
export const personName = (email) => TEAM.find((p) => p.email === (email || '').toLowerCase())?.name || email || '';

// Next date of a repeating task.
export function nextOccurrence(date, recurrence) {
  const m = { monthly: 1, quarterly: 3, yearly: 12 }[recurrence];
  return m ? addMonths(date, m) : null;
}
