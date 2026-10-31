'use strict';
// Exchange calendar (EWS) for the PB Abbey mailboxes. IONOS Hosted Exchange
// speaks EWS with NTLM only (no CalDAV, no basic auth) -> httpntlm (pure JS MD4).
// Times are sent in the mailboxes' zone (Paris: Peter and Christine live in France).
const httpntlm = require('httpntlm');

const EWS_URL = process.env.EWS_URL || 'https://exchange.ionos.eu/EWS/Exchange.asmx';
const TZ_ID = 'Romance Standard Time'; // Windows id for Europe/Paris
const TZ = 'Europe/Paris';

const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const unesc = (s) => String(s ?? '')
  .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16))).replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
const oneLine = (s) => s.replace(/\s*[\r\n]+\s*/g, ', ').replace(/\s{2,}/g, ' ').replace(/,\s*,/g, ',').trim();

function soap(acc, bodyXml) {
  const envelope = `<?xml version="1.0" encoding="utf-8"?>
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/" xmlns:t="http://schemas.microsoft.com/exchange/services/2006/types" xmlns:m="http://schemas.microsoft.com/exchange/services/2006/messages">
<soap:Header><t:RequestServerVersion Version="Exchange2016"/><t:TimeZoneContext><t:TimeZoneDefinition Id="${TZ_ID}"/></t:TimeZoneContext></soap:Header>
<soap:Body>${bodyXml}</soap:Body></soap:Envelope>`;
  return new Promise((resolve, reject) => {
    httpntlm.post({ url: EWS_URL, username: acc.user, password: acc.pass, domain: '', workstation: '', body: envelope,
      headers: { 'Content-Type': 'text/xml; charset=utf-8' }, timeout: 30000 }, (err, res) => {
      if (err) return reject(err);
      if (res.statusCode !== 200) return reject(new Error(`Exchange calendar ${res.statusCode}: ${String(res.body || '').replace(/<[^>]+>/g, ' ').trim().slice(0, 200)}`));
      const code = (res.body.match(/ResponseCode>([^<]+)</) || [])[1];
      if (code && code !== 'NoError') return reject(new Error(`Exchange calendar: ${code} ${(res.body.match(/MessageText>([^<]+)</) || [])[1] || ''}`.trim()));
      resolve(res.body);
    });
  });
}

const tag = (xml, name) => { const m = xml.match(new RegExp(`<t:${name}(?:\\s[^>]*)?>([\\s\\S]*?)</t:${name}>`)); return m ? unesc(m[1]) : ''; };
const parisDate = (iso) => new Date(iso).toLocaleDateString('en-CA', { timeZone: TZ }); // YYYY-MM-DD

// Events between two ISO dates (Exchange expands recurring meetings in a CalendarView).
async function listEvents(acc, from, to) {
  const xml = await soap(acc, `<m:FindItem Traversal="Shallow"><m:ItemShape><t:BaseShape>IdOnly</t:BaseShape><t:AdditionalProperties>
<t:FieldURI FieldURI="item:Subject"/><t:FieldURI FieldURI="item:Categories"/><t:FieldURI FieldURI="calendar:Start"/><t:FieldURI FieldURI="calendar:End"/>
<t:FieldURI FieldURI="calendar:IsAllDayEvent"/><t:FieldURI FieldURI="calendar:Location"/><t:FieldURI FieldURI="calendar:IsCancelled"/><t:FieldURI FieldURI="calendar:Organizer"/>
<t:FieldURI FieldURI="calendar:MyResponseType"/><t:FieldURI FieldURI="calendar:IsMeeting"/><t:FieldURI FieldURI="calendar:CalendarItemType"/><t:FieldURI FieldURI="calendar:LegacyFreeBusyStatus"/>
</t:AdditionalProperties></m:ItemShape><m:CalendarView MaxEntriesReturned="500" StartDate="${esc(from)}" EndDate="${esc(to)}"/>
<m:ParentFolderIds><t:DistinguishedFolderId Id="calendar"/></m:ParentFolderIds></m:FindItem>`);
  const items = xml.split('<t:CalendarItem>').slice(1).map((b) => b.split('</t:CalendarItem>')[0]);
  return items.map((b) => {
    const id = (b.match(/<t:ItemId Id="([^"]+)" ChangeKey="([^"]+)"/) || []);
    const start = tag(b, 'Start'), end = tag(b, 'End'), allDay = tag(b, 'IsAllDayEvent') === 'true';
    return {
      id: id[1], changeKey: id[2], subject: tag(b, 'Subject') || '(no title)', start, end, allDay,
      date: parisDate(start), endDate: allDay ? parisDate(new Date(new Date(end).getTime() - 1).toISOString()) : parisDate(end),
      location: oneLine(tag(b, 'Location')), cancelled: tag(b, 'IsCancelled') === 'true',
      organizer: tag(tag(b, 'Organizer'), 'Name'), myResponse: tag(b, 'MyResponseType'), isMeeting: tag(b, 'IsMeeting') === 'true',
      kind: tag(b, 'CalendarItemType'), showAs: tag(b, 'LegacyFreeBusyStatus'), categories: [...b.matchAll(/<t:String>([^<]*)<\/t:String>/g)].map((m) => unesc(m[1])),
    };
  }).filter((e) => e.id);
}

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const SHOW_AS = { busy: 'Busy', free: 'Free', tentative: 'Tentative', oof: 'OOF' };
const isDate = (d) => /^\d{4}-\d{2}-\d{2}$/.test(d || '');
const addDays = (d, n) => { const x = new Date(`${d}T12:00:00Z`); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
const addrs = (v) => (Array.isArray(v) ? v : String(v || '').split(/[,;]+/)).map((x) => String(x).trim()).filter((x) => /@/.test(x));
const attendeesXml = (tagName, list) => (list.length ? `<t:${tagName}>${list.map((e) => `<t:Attendee><t:Mailbox><t:EmailAddress>${esc(e)}</t:EmailAddress></t:Mailbox></t:Attendee>`).join('')}</t:${tagName}>` : '');

// Start/end in the mailbox zone. p: { date, time?, endDate?, endTime?, minutes? }. No time = all day.
function when(p) {
  if (!isDate(p.date)) throw new Error('date must be YYYY-MM-DD');
  const allDay = !p.time;
  if (allDay) {
    const last = isDate(p.endDate) && p.endDate >= p.date ? p.endDate : p.date; // inclusive last day
    return { allDay, start: `${p.date}T00:00:00`, end: `${addDays(last, 1)}T00:00:00` };
  }
  if (!/^\d{2}:\d{2}$/.test(p.time)) throw new Error('time must be HH:MM');
  const start = `${p.date}T${p.time}:00`;
  let end;
  if (/^\d{2}:\d{2}$/.test(p.endTime || '')) end = `${isDate(p.endDate) ? p.endDate : p.date}T${p.endTime}:00`;
  else { const e = new Date(`${p.date}T${p.time}:00Z`); e.setUTCMinutes(e.getUTCMinutes() + (Number(p.minutes) || 60)); end = e.toISOString().slice(0, 19); }
  if (end <= start) throw new Error('the end must be after the start');
  return { allDay, start, end };
}
// rec: { freq: 'daily'|'weekday'|'weekly'|'monthly'|'yearly', until?: 'YYYY-MM-DD', interval? }
function recurrenceXml(rec, date) {
  if (!rec || !rec.freq || rec.freq === 'none') return '';
  const d = new Date(`${date}T12:00:00Z`); const n = Math.max(1, Math.min(99, Number(rec.interval) || 1));
  const pattern = {
    daily: `<t:DailyRecurrence><t:Interval>${n}</t:Interval></t:DailyRecurrence>`,
    weekday: '<t:WeeklyRecurrence><t:Interval>1</t:Interval><t:DaysOfWeek>Monday Tuesday Wednesday Thursday Friday</t:DaysOfWeek></t:WeeklyRecurrence>',
    weekly: `<t:WeeklyRecurrence><t:Interval>${n}</t:Interval><t:DaysOfWeek>${DAYS[d.getUTCDay()]}</t:DaysOfWeek></t:WeeklyRecurrence>`,
    monthly: `<t:AbsoluteMonthlyRecurrence><t:Interval>${n}</t:Interval><t:DayOfMonth>${d.getUTCDate()}</t:DayOfMonth></t:AbsoluteMonthlyRecurrence>`,
    yearly: `<t:AbsoluteYearlyRecurrence><t:DayOfMonth>${d.getUTCDate()}</t:DayOfMonth><t:Month>${MONTHS[d.getUTCMonth()]}</t:Month></t:AbsoluteYearlyRecurrence>`,
  }[rec.freq];
  if (!pattern) throw new Error('unknown repeat');
  const range = isDate(rec.until) ? `<t:EndDateRecurrence><t:StartDate>${date}</t:StartDate><t:EndDate>${rec.until}</t:EndDate></t:EndDateRecurrence>` : `<t:NoEndRecurrence><t:StartDate>${date}</t:StartDate></t:NoEndRecurrence>`;
  return `<t:Recurrence>${pattern}${range}</t:Recurrence>`;
}

// p: { subject, body, date, time?, endDate?, endTime?, minutes?, reminderMinutes?, busy?, showAs?, location?,
//      attendees?, optional?, recurrence?, category? (default "PB Abbey"; null = none) }
// With attendees the invitations are sent (as from this mailbox).
async function createEvent(acc, p) {
  const w = when(p);
  const reminder = p.reminderMinutes == null ? (w.allDay ? 0 : 15) : Number(p.reminderMinutes);
  const req = addrs(p.attendees), opt = addrs(p.optional);
  const showAs = SHOW_AS[p.showAs] || (p.showAs == null ? (p.busy && !w.allDay ? 'Busy' : 'Free') : 'Busy');
  const category = p.category === undefined ? 'PB Abbey' : p.category;
  const xml = await soap(acc, `<m:CreateItem SendMeetingInvitations="${req.length + opt.length ? 'SendToAllAndSaveCopy' : 'SendToNone'}"><m:SavedItemFolderId><t:DistinguishedFolderId Id="calendar"/></m:SavedItemFolderId><m:Items>
<t:CalendarItem><t:Subject>${esc(p.subject)}</t:Subject><t:Body BodyType="Text">${esc(p.body || '')}</t:Body>${category ? `<t:Categories><t:String>${esc(category)}</t:String></t:Categories>` : ''}
<t:ReminderIsSet>${reminder > 0 ? 'true' : 'false'}</t:ReminderIsSet><t:ReminderMinutesBeforeStart>${Math.max(0, reminder)}</t:ReminderMinutesBeforeStart>
<t:Start>${w.start}</t:Start><t:End>${w.end}</t:End><t:IsAllDayEvent>${w.allDay}</t:IsAllDayEvent><t:LegacyFreeBusyStatus>${showAs}</t:LegacyFreeBusyStatus>
${p.location ? `<t:Location>${esc(p.location)}</t:Location>` : ''}${attendeesXml('RequiredAttendees', req)}${attendeesXml('OptionalAttendees', opt)}${recurrenceXml(p.recurrence, p.date)}
</t:CalendarItem></m:Items></m:CreateItem>`);
  const id = xml.match(/<t:ItemId Id="([^"]+)" ChangeKey="([^"]+)"/);
  if (!id) throw new Error('Exchange did not return the new event');
  return { id: id[1], changeKey: id[2], invited: req.length + opt.length };
}

const itemRef = (id, series) => (series ? `<t:RecurringMasterItemId OccurrenceId="${esc(id)}"/>` : `<t:ItemId Id="${esc(id)}"/>`);
const people = (xml, name) => { const block = (xml.match(new RegExp(`<t:${name}>([\\s\\S]*?)</t:${name}>`)) || [])[1] || '';
  return block.split('<t:Attendee>').slice(1).map((a) => ({ name: tag(a, 'Name'), email: tag(a, 'EmailAddress'), response: tag(a, 'ResponseType') })); };

// Everything about one event (series: the whole repeating series instead of this occurrence).
async function getEvent(acc, id, series = false) {
  const xml = await soap(acc, `<m:GetItem><m:ItemShape><t:BaseShape>IdOnly</t:BaseShape><t:BodyType>Text</t:BodyType><t:AdditionalProperties>
<t:FieldURI FieldURI="item:Subject"/><t:FieldURI FieldURI="item:Body"/><t:FieldURI FieldURI="item:Categories"/><t:FieldURI FieldURI="item:ReminderIsSet"/><t:FieldURI FieldURI="item:ReminderMinutesBeforeStart"/>
<t:FieldURI FieldURI="calendar:Start"/><t:FieldURI FieldURI="calendar:End"/><t:FieldURI FieldURI="calendar:IsAllDayEvent"/><t:FieldURI FieldURI="calendar:Location"/><t:FieldURI FieldURI="calendar:LegacyFreeBusyStatus"/>
<t:FieldURI FieldURI="calendar:Organizer"/><t:FieldURI FieldURI="calendar:RequiredAttendees"/><t:FieldURI FieldURI="calendar:OptionalAttendees"/><t:FieldURI FieldURI="calendar:MyResponseType"/>
<t:FieldURI FieldURI="calendar:IsMeeting"/><t:FieldURI FieldURI="calendar:IsCancelled"/><t:FieldURI FieldURI="calendar:CalendarItemType"/>${series ? '<t:FieldURI FieldURI="calendar:Recurrence"/>' : ''}
</t:AdditionalProperties></m:ItemShape><m:ItemIds>${itemRef(id, series)}</m:ItemIds></m:GetItem>`);
  const b = xml.split('<t:CalendarItem>')[1]?.split('</t:CalendarItem>')[0] || '';
  const ids = b.match(/<t:ItemId Id="([^"]+)" ChangeKey="([^"]+)"/) || [];
  const start = tag(b, 'Start'), end = tag(b, 'End'), allDay = tag(b, 'IsAllDayEvent') === 'true';
  const rec = tag(b, 'Recurrence');
  let recurrence = null;
  if (rec) {
    const freq = /DailyRecurrence/.test(b) ? 'daily' : /WeeklyRecurrence/.test(b) ? (/Monday Tuesday Wednesday Thursday Friday/.test(b) ? 'weekday' : 'weekly') : /MonthlyRecurrence/.test(b) ? 'monthly' : /YearlyRecurrence/.test(b) ? 'yearly' : 'other';
    recurrence = { freq, interval: Number(tag(b, 'Interval')) || 1, until: (tag(b, 'EndDate') || '').slice(0, 10) || null };
  }
  return {
    id: ids[1], changeKey: ids[2], subject: tag(b, 'Subject') || '(no title)', body: tag(b, 'Body'), start, end, allDay,
    date: parisDate(start), endDate: allDay ? parisDate(new Date(new Date(end).getTime() - 1).toISOString()) : parisDate(end),
    location: tag(b, 'Location'), showAs: tag(b, 'LegacyFreeBusyStatus'), reminder: tag(b, 'ReminderIsSet') === 'true' ? Number(tag(b, 'ReminderMinutesBeforeStart')) : 0,
    organizer: { name: tag(tag(b, 'Organizer'), 'Name'), email: tag(tag(b, 'Organizer'), 'EmailAddress') },
    attendees: people(b, 'RequiredAttendees'), optional: people(b, 'OptionalAttendees'),
    myResponse: tag(b, 'MyResponseType'), isMeeting: tag(b, 'IsMeeting') === 'true', cancelled: tag(b, 'IsCancelled') === 'true',
    kind: tag(b, 'CalendarItemType'), recurrence, categories: [...b.matchAll(/<t:String>([^<]*)<\/t:String>/g)].map((m) => unesc(m[1])),
  };
}

// Change an event (series = the whole repeating series). Attendees get the update when there are any.
async function updateEvent(acc, id, p, series = false) {
  const w = when(p);
  const set = (uri, inner) => `<t:SetItemField><t:FieldURI FieldURI="${uri}"/><t:CalendarItem>${inner}</t:CalendarItem></t:SetItemField>`;
  const del = (uri) => `<t:DeleteItemField><t:FieldURI FieldURI="${uri}"/></t:DeleteItemField>`;
  const req = addrs(p.attendees), opt = addrs(p.optional);
  const reminder = Number(p.reminderMinutes) || 0;
  const u = [
    set('item:Subject', `<t:Subject>${esc(p.subject)}</t:Subject>`),
    set('item:Body', `<t:Body BodyType="Text">${esc(p.body || '')}</t:Body>`),
    set('item:ReminderIsSet', `<t:ReminderIsSet>${reminder > 0}</t:ReminderIsSet>`),
    ...(reminder > 0 ? [set('item:ReminderMinutesBeforeStart', `<t:ReminderMinutesBeforeStart>${reminder}</t:ReminderMinutesBeforeStart>`)] : []),
    set('calendar:Start', `<t:Start>${w.start}</t:Start>`), set('calendar:End', `<t:End>${w.end}</t:End>`),
    set('calendar:IsAllDayEvent', `<t:IsAllDayEvent>${w.allDay}</t:IsAllDayEvent>`),
    set('calendar:LegacyFreeBusyStatus', `<t:LegacyFreeBusyStatus>${SHOW_AS[p.showAs] || 'Busy'}</t:LegacyFreeBusyStatus>`),
    p.location ? set('calendar:Location', `<t:Location>${esc(p.location)}</t:Location>`) : del('calendar:Location'),
    req.length ? set('calendar:RequiredAttendees', attendeesXml('RequiredAttendees', req)) : del('calendar:RequiredAttendees'),
    opt.length ? set('calendar:OptionalAttendees', attendeesXml('OptionalAttendees', opt)) : del('calendar:OptionalAttendees'),
    ...(series && p.recurrence ? [p.recurrence.freq && p.recurrence.freq !== 'none' ? set('calendar:Recurrence', recurrenceXml(p.recurrence, p.date)) : del('calendar:Recurrence')] : []),
  ].join('');
  const xml = await soap(acc, `<m:UpdateItem ConflictResolution="AlwaysOverwrite" SendMeetingInvitationsOrCancellations="${req.length + opt.length || p.hadAttendees ? 'SendToAllAndSaveCopy' : 'SendToNone'}">
<m:ItemChanges><t:ItemChange>${itemRef(id, series)}<t:Updates>${u}</t:Updates></t:ItemChange></m:ItemChanges></m:UpdateItem>`);
  const ids = xml.match(/<t:ItemId Id="([^"]+)" ChangeKey="([^"]+)"/) || [];
  return { ok: true, id: ids[1] || id };
}

// Answer an invitation: accept | tentative | decline (decline also removes it from the calendar).
async function respondEvent(acc, id, answer, message = '') {
  const el = { accept: 'AcceptItem', tentative: 'TentativelyAcceptItem', decline: 'DeclineItem' }[answer];
  if (!el) throw new Error('answer must be accept, tentative or decline');
  await soap(acc, `<m:CreateItem MessageDisposition="SendAndSaveCopy"><m:Items><t:${el}>${message ? `<t:Body BodyType="Text">${esc(message)}</t:Body>` : ''}<t:ReferenceItemId Id="${esc(id)}"/></t:${el}></m:Items></m:CreateItem>`);
  return { ok: true };
}

// Delete an event (series = the whole series). notify: attendees of a meeting you organised get a cancellation.
async function deleteEvent(acc, id, { series = false, notify = false } = {}) {
  try {
    await soap(acc, `<m:DeleteItem DeleteType="MoveToDeletedItems" SendMeetingCancellations="${notify ? 'SendToAllAndSaveCopy' : 'SendToNone'}"><m:ItemIds>${itemRef(id, series)}</m:ItemIds></m:DeleteItem>`);
  } catch (e) {
    if (!/ErrorItemNotFound/.test(String(e.message))) throw e; // already deleted in Outlook: fine
  }
  return { ok: true };
}


// ---- People: the mailbox's Exchange contacts (the same ones Outlook shows) ----
const anyTag = (xml, name) => { const m = xml.match(new RegExp(`<(?:\\w+:)?${name}(?:\\s[^>]*)?>([\\s\\S]*?)</(?:\\w+:)?${name}>`)); return m ? unesc(m[1]) : ''; };
const entries = (xml, name) => { const block = anyTag(xml, name) ? (xml.match(new RegExp(`<t:${name}>([\\s\\S]*?)</t:${name}>`)) || [])[1] || '' : '';
  return [...block.matchAll(/<t:Entry Key="([^"]+)"[^>]*>([\s\S]*?)<\/t:Entry>/g)].map((m) => ({ key: m[1], value: m[2] })); };
function parseContact(b) {
  const ids = b.match(/<t:ItemId Id="([^"]+)" ChangeKey="([^"]+)"/) || [];
  const phones = Object.fromEntries(entries(b, 'PhoneNumbers').map((e) => [e.key, unesc(e.value)]));
  const addr = entries(b, 'PhysicalAddresses').find((e) => e.key === 'Business') || entries(b, 'PhysicalAddresses')[0];
  return {
    id: ids[1], changeKey: ids[2], name: tag(b, 'DisplayName') || [tag(b, 'GivenName'), tag(b, 'Surname')].filter(Boolean).join(' '),
    givenName: tag(b, 'GivenName'), surname: tag(b, 'Surname'), company: tag(b, 'CompanyName'), jobTitle: tag(b, 'JobTitle'),
    emails: entries(b, 'EmailAddresses').map((e) => unesc(e.value)).filter((x) => /@/.test(x)).map((x) => x.replace(/^smtp:/i, '')),
    mobile: phones.MobilePhone || '', business: phones.BusinessPhone || '', home: phones.HomePhone || '',
    address: addr ? { street: tag(addr.value, 'Street'), city: tag(addr.value, 'City'), postcode: tag(addr.value, 'PostalCode'), country: tag(addr.value, 'CountryOrRegion') } : null,
    notes: tag(b, 'Body'),
  };
}
async function listContacts(acc) {
  const ids = [];
  for (let offset = 0; offset < 5000; offset += 500) {
    const xml = await soap(acc, `<m:FindItem Traversal="Shallow"><m:ItemShape><t:BaseShape>IdOnly</t:BaseShape></m:ItemShape><m:IndexedPageItemView MaxEntriesReturned="500" Offset="${offset}" BasePoint="Beginning"/><m:ParentFolderIds><t:DistinguishedFolderId Id="contacts"/></m:ParentFolderIds></m:FindItem>`);
    const page = [...xml.matchAll(/<t:Contact>\s*<t:ItemId Id="([^"]+)"/g)].map((m) => m[1]);
    ids.push(...page);
    if (/IncludesLastItemInRange="true"/.test(xml) || !page.length) break;
  }
  const out = [];
  for (let i = 0; i < ids.length; i += 100) {
    const xml = await soap(acc, `<m:GetItem><m:ItemShape><t:BaseShape>AllProperties</t:BaseShape><t:BodyType>Text</t:BodyType></m:ItemShape><m:ItemIds>${ids.slice(i, i + 100).map((id) => `<t:ItemId Id="${esc(id)}"/>`).join('')}</m:ItemIds></m:GetItem>`);
    xml.split('<t:Contact>').slice(1).forEach((b) => out.push(parseContact(b.split('</t:Contact>')[0])));
  }
  return out.filter((c) => c.id).sort((a, b) => (a.name || a.emails[0] || '').localeCompare(b.name || b.emails[0] || '', 'en', { sensitivity: 'base' }));
}
// c: { id?, givenName, surname, company, jobTitle, emails: [≤3], mobile, business, home, address: {street, city, postcode, country}, notes }
async function saveContact(acc, c) {
  const emails = (c.emails || []).map((x) => String(x).trim()).filter((x) => /@/.test(x)).slice(0, 3);
  const display = [c.givenName, c.surname].map((x) => (x || '').trim()).filter(Boolean).join(' ') || (c.company || '').trim() || emails[0] || '';
  if (!display) throw new Error('Give a name, a company or an email address.');
  const a = c.address || {};
  const hasAddr = ['street', 'city', 'postcode', 'country'].some((k) => (a[k] || '').trim());
  const phones = [['MobilePhone', c.mobile], ['BusinessPhone', c.business], ['HomePhone', c.home]].filter(([, v]) => (v || '').trim());
  if (!c.id) {
    const xml = await soap(acc, `<m:CreateItem><m:SavedItemFolderId><t:DistinguishedFolderId Id="contacts"/></m:SavedItemFolderId><m:Items><t:Contact>
${c.notes ? `<t:Body BodyType="Text">${esc(c.notes)}</t:Body>` : ''}<t:FileAs>${esc(display)}</t:FileAs><t:DisplayName>${esc(display)}</t:DisplayName>${c.givenName ? `<t:GivenName>${esc(c.givenName)}</t:GivenName>` : ''}
${c.company ? `<t:CompanyName>${esc(c.company)}</t:CompanyName>` : ''}${emails.length ? `<t:EmailAddresses>${emails.map((e, i) => `<t:Entry Key="EmailAddress${i + 1}">${esc(e)}</t:Entry>`).join('')}</t:EmailAddresses>` : ''}
${hasAddr ? `<t:PhysicalAddresses><t:Entry Key="Business"><t:Street>${esc(a.street || '')}</t:Street><t:City>${esc(a.city || '')}</t:City><t:CountryOrRegion>${esc(a.country || '')}</t:CountryOrRegion><t:PostalCode>${esc(a.postcode || '')}</t:PostalCode></t:Entry></t:PhysicalAddresses>` : ''}
${phones.length ? `<t:PhoneNumbers>${phones.map(([k, v]) => `<t:Entry Key="${k}">${esc(v)}</t:Entry>`).join('')}</t:PhoneNumbers>` : ''}${c.jobTitle ? `<t:JobTitle>${esc(c.jobTitle)}</t:JobTitle>` : ''}${c.surname ? `<t:Surname>${esc(c.surname)}</t:Surname>` : ''}
</t:Contact></m:Items></m:CreateItem>`);
    const id = xml.match(/<t:ItemId Id="([^"]+)"/); return { ok: true, id: id && id[1] };
  }
  const set = (uri, inner) => `<t:SetItemField><t:FieldURI FieldURI="${uri}"/><t:Contact>${inner}</t:Contact></t:SetItemField>`;
  const del = (uri) => `<t:DeleteItemField><t:FieldURI FieldURI="${uri}"/></t:DeleteItemField>`;
  const iset = (uri, idx, inner) => `<t:SetItemField><t:IndexedFieldURI FieldURI="${uri}" FieldIndex="${idx}"/><t:Contact>${inner}</t:Contact></t:SetItemField>`;
  const idel = (uri, idx) => `<t:DeleteItemField><t:IndexedFieldURI FieldURI="${uri}" FieldIndex="${idx}"/></t:DeleteItemField>`;
  const simple = (uri, el, v) => ((v || '').trim() ? set(uri, `<t:${el}>${esc(v.trim())}</t:${el}>`) : del(uri));
  const u = [
    c.notes ? set('item:Body', `<t:Body BodyType="Text">${esc(c.notes)}</t:Body>`) : del('item:Body'),
    set('contacts:FileAs', `<t:FileAs>${esc(display)}</t:FileAs>`), set('contacts:DisplayName', `<t:DisplayName>${esc(display)}</t:DisplayName>`),
    simple('contacts:GivenName', 'GivenName', c.givenName), simple('contacts:CompanyName', 'CompanyName', c.company),
    ...[1, 2, 3].map((i) => (emails[i - 1] ? iset('contacts:EmailAddress', `EmailAddress${i}`, `<t:EmailAddresses><t:Entry Key="EmailAddress${i}">${esc(emails[i - 1])}</t:Entry></t:EmailAddresses>`) : idel('contacts:EmailAddress', `EmailAddress${i}`))),
    ...[['street', 'Street'], ['city', 'City'], ['country', 'CountryOrRegion'], ['postcode', 'PostalCode']].map(([k, el]) => ((a[k] || '').trim()
      ? iset(`contacts:PhysicalAddress:${el}`, 'Business', `<t:PhysicalAddresses><t:Entry Key="Business"><t:${el}>${esc(a[k].trim())}</t:${el}></t:Entry></t:PhysicalAddresses>`) : idel(`contacts:PhysicalAddress:${el}`, 'Business'))),
    ...[['MobilePhone', c.mobile], ['BusinessPhone', c.business], ['HomePhone', c.home]].map(([k, v]) => ((v || '').trim() ? iset('contacts:PhoneNumber', k, `<t:PhoneNumbers><t:Entry Key="${k}">${esc(v.trim())}</t:Entry></t:PhoneNumbers>`) : idel('contacts:PhoneNumber', k))),
    simple('contacts:JobTitle', 'JobTitle', c.jobTitle), simple('contacts:Surname', 'Surname', c.surname),
  ].join('');
  await soap(acc, `<m:UpdateItem ConflictResolution="AlwaysOverwrite"><m:ItemChanges><t:ItemChange><t:ItemId Id="${esc(c.id)}"/><t:Updates>${u}</t:Updates></t:ItemChange></m:ItemChanges></m:UpdateItem>`);
  return { ok: true, id: c.id };
}
async function deleteContact(acc, id) {
  await soap(acc, `<m:DeleteItem DeleteType="MoveToDeletedItems"><m:ItemIds><t:ItemId Id="${esc(id)}"/></m:ItemIds></m:DeleteItem>`);
  return { ok: true };
}

// ---- Automatic replies (out of office) ----
async function getOof(acc) {
  const xml = await soap(acc, `<m:GetUserOofSettingsRequest><t:Mailbox><t:Address>${esc(acc.email)}</t:Address></t:Mailbox></m:GetUserOofSettingsRequest>`);
  const reply = (name) => anyTag(anyTag(xml, name), 'Message');
  return { state: anyTag(xml, 'OofState') || 'Disabled', audience: anyTag(xml, 'ExternalAudience') || 'All',
    start: anyTag(anyTag(xml, 'Duration'), 'StartTime'), end: anyTag(anyTag(xml, 'Duration'), 'EndTime'), internal: reply('InternalReply'), external: reply('ExternalReply') };
}
// o: { state: 'Disabled'|'Enabled'|'Scheduled', audience: 'All'|'Known'|'None', start, end (ISO), internal, external (HTML or text) }
async function setOof(acc, o) {
  const state = ['Disabled', 'Enabled', 'Scheduled'].includes(o.state) ? o.state : 'Disabled';
  const audience = ['All', 'Known', 'None'].includes(o.audience) ? o.audience : 'All';
  if (state === 'Scheduled' && !(o.start && o.end && new Date(o.end) > new Date(o.start))) throw new Error('Pick a start and an end (the end after the start).');
  const iso = (d) => new Date(d).toISOString().replace(/\.\d+Z$/, 'Z');
  const start = o.start ? iso(o.start) : new Date().toISOString().replace(/\.\d+Z$/, 'Z');
  const end = o.end ? iso(o.end) : new Date(Date.now() + 7 * 864e5).toISOString().replace(/\.\d+Z$/, 'Z');
  await soap(acc, `<m:SetUserOofSettingsRequest><t:Mailbox><t:Address>${esc(acc.email)}</t:Address></t:Mailbox><t:UserOofSettings>
<t:OofState>${state}</t:OofState><t:ExternalAudience>${audience}</t:ExternalAudience><t:Duration><t:StartTime>${start}</t:StartTime><t:EndTime>${end}</t:EndTime></t:Duration>
<t:InternalReply><t:Message>${esc(o.internal || '')}</t:Message></t:InternalReply><t:ExternalReply><t:Message>${esc(o.external || o.internal || '')}</t:Message></t:ExternalReply>
</t:UserOofSettings></m:SetUserOofSettingsRequest>`);
  return getOof(acc);
}


// ---- Mail over EWS ----
// Exchange answers IMAP very slowly on big folders (it converts each mail on the fly: ~20 s for
// 30 mails in Sent) but EWS natively in ~0.5 s. With MAIL_ENGINE=ews the lists and searches come
// from here and each mail's id ("uid") is its Exchange ItemId (a long string). Every action then
// follows the id it is given: an ItemId goes through EWS, a number through IMAP as before.
// (The MAPI article number 0x0E23 is NOT a usable link to IMAP UIDs: Exchange renumbers changed mail.)
const isEwsId = (v) => typeof v === 'string' && v.length > 20 && !/^\d+$/.test(v);
const ids = (list) => list.map((id) => `<t:ItemId Id="${esc(id)}"/>`).join('');

const folderCache = new Map(); // account id -> { at, byPath: Map(lowercased IMAP-style path -> FolderId) }
async function folderMap(acc) {
  const hit = folderCache.get(acc.id);
  if (hit && Date.now() - hit.at < 5 * 60e3) return hit.byPath;
  const xml = await soap(acc, `<m:FindFolder Traversal="Deep"><m:FolderShape><t:BaseShape>IdOnly</t:BaseShape><t:AdditionalProperties>
<t:FieldURI FieldURI="folder:DisplayName"/><t:FieldURI FieldURI="folder:ParentFolderId"/></t:AdditionalProperties></m:FolderShape>
<m:IndexedPageFolderView MaxEntriesReturned="5000" Offset="0" BasePoint="Beginning"/>
<m:ParentFolderIds><t:DistinguishedFolderId Id="msgfolderroot"/></m:ParentFolderIds></m:FindFolder>`);
  const rootXml = await soap(acc, `<m:GetFolder><m:FolderShape><t:BaseShape>IdOnly</t:BaseShape></m:FolderShape><m:FolderIds>
<t:DistinguishedFolderId Id="msgfolderroot"/><t:DistinguishedFolderId Id="inbox"/></m:FolderIds></m:GetFolder>`);
  const [rootId, inboxId] = [...rootXml.matchAll(/<t:FolderId Id="([^"]+)"/g)].map((m) => m[1]);
  const nodes = new Map();
  for (const m of xml.matchAll(/<t:(Folder|SearchFolder|CalendarFolder|ContactsFolder|TasksFolder)>([\s\S]*?)<\/t:\1>/g)) {
    const id = (m[2].match(/<t:FolderId Id="([^"]+)"/) || [])[1];
    const parent = (m[2].match(/<t:ParentFolderId Id="([^"]+)"/) || [])[1];
    if (id) nodes.set(id, { name: tag(m[2], 'DisplayName'), parent });
  }
  const pathOf = (id, depth = 0) => {
    if (id === inboxId) return 'INBOX'; // IMAP calls the inbox INBOX, whatever its display name
    const n = nodes.get(id);
    if (!n || depth > 30) return null;
    if (n.parent === rootId) return n.name;
    const up = pathOf(n.parent, depth + 1);
    return up == null ? null : `${up}/${n.name}`;
  };
  const byPath = new Map([['inbox', inboxId]]);
  for (const id of nodes.keys()) { const pth = pathOf(id); if (pth) byPath.set(pth.toLowerCase(), id); }
  folderCache.set(acc.id, { at: Date.now(), byPath });
  return byPath;
}
// `path` = IMAP folder name decoded from UTF-7, e.g. "Sent Items", "PB Abbey/Admin/Group Insurance".
async function folderId(acc, path) {
  const key = String(path).toLowerCase();
  let fid = (await folderMap(acc)).get(key);
  if (!fid) { folderCache.delete(acc.id); fid = (await folderMap(acc)).get(key); }
  if (!fid) throw new Error('EWS: folder not found: ' + path);
  return fid;
}

const fmtAddr = (xml) => { const n = tag(xml, 'Name'), e = tag(xml, 'EmailAddress'); return n && e && n !== e ? `${n} <${e}>` : (e || n); };
const LIST_PROPS = `<t:FieldURI FieldURI="item:Subject"/><t:FieldURI FieldURI="item:DateTimeReceived"/><t:FieldURI FieldURI="message:From"/><t:FieldURI FieldURI="message:IsRead"/>
<t:FieldURI FieldURI="item:Size"/><t:FieldURI FieldURI="item:Importance"/>
<t:ExtendedFieldURI PropertyTag="0x0E1B" PropertyType="Boolean"/><t:ExtendedFieldURI PropertyTag="0x1090" PropertyType="Integer"/><t:ExtendedFieldURI PropertyTag="0x1081" PropertyType="Integer"/>`;
function parseItems(xml) {
  const out = [];
  for (const m of xml.matchAll(/<t:(Message|MeetingRequest|MeetingResponse|MeetingCancellation|PostItem|Item)>([\s\S]*?)<\/t:\1>/g)) {
    const b = m[2];
    const id = (b.match(/<t:ItemId Id="([^"]+)"/) || [])[1]; if (!id) continue;
    const ext = {}; for (const e of b.matchAll(/PropertyTag="0x([0-9a-f]+)"[^>]*\/><t:Value>([^<]*)</gi)) ext[parseInt(e[1], 16)] = e[2];
    const fromBlock = (b.match(/<t:From>([\s\S]*?)<\/t:From>/) || [])[1] || '';
    out.push({ uid: unesc(id), from: fmtAddr(fromBlock), subject: (tag(b, 'Subject') || '(no subject)').trim(), date: tag(b, 'DateTimeReceived'),
      size: Number(tag(b, 'Size') || 0), attach: ext[0x0e1b] === 'true', important: tag(b, 'Importance') === 'High',
      seen: tag(b, 'IsRead') !== 'false', flagged: Number(ext[0x1090]) === 2, answered: [102, 103].includes(Number(ext[0x1081])) });
  }
  return out;
}

// Same answer as the IMAP list: { mailbox, total, messages: [{uid, from, subject, date, size, attach, important, seen, flagged, answered}], more }.
async function listMail(acc, path, mailbox, limit, skip = 0, filter = '') {
  const fid = await folderId(acc, path);
  const restrict = filter === 'unread' ? '<m:Restriction><t:IsEqualTo><t:FieldURI FieldURI="message:IsRead"/><t:FieldURIOrConstant><t:Constant Value="false"/></t:FieldURIOrConstant></t:IsEqualTo></m:Restriction>'
    : filter === 'flagged' ? '<m:Restriction><t:IsEqualTo><t:ExtendedFieldURI PropertyTag="0x1090" PropertyType="Integer"/><t:FieldURIOrConstant><t:Constant Value="2"/></t:FieldURIOrConstant></t:IsEqualTo></m:Restriction>' : '';
  const xml = await soap(acc, `<m:FindItem Traversal="Shallow"><m:ItemShape><t:BaseShape>IdOnly</t:BaseShape><t:AdditionalProperties>${LIST_PROPS}</t:AdditionalProperties></m:ItemShape>
<m:IndexedPageItemView MaxEntriesReturned="${limit}" Offset="${skip}" BasePoint="Beginning"/>${restrict}
<m:SortOrder><t:FieldOrder Order="Descending"><t:FieldURI FieldURI="item:DateTimeReceived"/></t:FieldOrder></m:SortOrder>
<m:ParentFolderIds><t:FolderId Id="${esc(fid)}"/></m:ParentFolderIds></m:FindItem>`);
  const total = Number((xml.match(/TotalItemsInView="(\d+)"/) || [])[1] || 0);
  return { mailbox, total, messages: parseItems(xml), more: skip + limit < total, ...(filter ? { filter } : {}) };
}

// Subject / sender / recipients (and body when asked), newest first, like the IMAP search.
async function searchMail(acc, path, mailbox, q, limit, inBody) {
  const fid = await folderId(acc, path);
  const c = (field) => `<t:Contains ContainmentMode="Substring" ContainmentComparison="IgnoreCase">${field}<t:Constant Value="${esc(q)}"/></t:Contains>`;
  const str = (tagHex) => `<t:ExtendedFieldURI PropertyTag="${tagHex}" PropertyType="String"/>`;
  const or = [c('<t:FieldURI FieldURI="item:Subject"/>'), c(str('0x0C1A')), c(str('0x0C1F')), c(str('0x0E04')), c(str('0x0E03'))];
  if (inBody) or.push(c('<t:FieldURI FieldURI="item:Body"/>'));
  const xml = await soap(acc, `<m:FindItem Traversal="Shallow"><m:ItemShape><t:BaseShape>IdOnly</t:BaseShape><t:AdditionalProperties>${LIST_PROPS}</t:AdditionalProperties></m:ItemShape>
<m:IndexedPageItemView MaxEntriesReturned="${limit}" Offset="0" BasePoint="Beginning"/><m:Restriction><t:Or>${or.join('')}</t:Or></m:Restriction>
<m:SortOrder><t:FieldOrder Order="Descending"><t:FieldURI FieldURI="item:DateTimeReceived"/></t:FieldOrder></m:SortOrder>
<m:ParentFolderIds><t:FolderId Id="${esc(fid)}"/></m:ParentFolderIds></m:FindItem>`);
  const total = Number((xml.match(/TotalItemsInView="(\d+)"/) || [])[1] || 0);
  return { mailbox, total, matches: total, messages: parseItems(xml) };
}

// The whole mail as raw MIME (fed to the same parser as IMAP's BODY[]).
async function getMime(acc, id) {
  const xml = await soap(acc, `<m:GetItem><m:ItemShape><t:BaseShape>IdOnly</t:BaseShape><t:IncludeMimeContent>true</t:IncludeMimeContent></m:ItemShape><m:ItemIds>${ids([id])}</m:ItemIds></m:GetItem>`);
  const b64 = (xml.match(/<t:MimeContent[^>]*>([^<]*)<\/t:MimeContent>/) || [])[1];
  return b64 ? Buffer.from(b64, 'base64') : null;
}

// set: seen | unseen | flagged | unflagged
async function setFlags(acc, list, set) {
  const field = set === 'seen' || set === 'unseen'
    ? `<t:SetItemField><t:FieldURI FieldURI="message:IsRead"/><t:Message><t:IsRead>${set === 'seen'}</t:IsRead></t:Message></t:SetItemField>`
    : `<t:SetItemField><t:FieldURI FieldURI="item:Flag"/><t:Message><t:Flag><t:FlagStatus>${set === 'flagged' ? 'Flagged' : 'NotFlagged'}</t:FlagStatus></t:Flag></t:Message></t:SetItemField>`;
  const changes = list.map((id) => `<t:ItemChange><t:ItemId Id="${esc(id)}"/><t:Updates>${field}</t:Updates></t:ItemChange>`).join('');
  await soap(acc, `<m:UpdateItem ConflictResolution="AlwaysOverwrite" MessageDisposition="SaveOnly"><m:ItemChanges>${changes}</m:ItemChanges></m:UpdateItem>`);
}
async function moveTo(acc, list, destPath) {
  const dest = await folderId(acc, destPath);
  await soap(acc, `<m:MoveItem><m:ToFolderId><t:FolderId Id="${esc(dest)}"/></m:ToFolderId><m:ItemIds>${ids(list)}</m:ItemIds></m:MoveItem>`);
}
// hard = gone for good (mail already in Deleted Items); otherwise to Deleted Items.
async function deleteMail(acc, list, hard) {
  await soap(acc, `<m:DeleteItem DeleteType="${hard ? 'HardDelete' : 'MoveToDeletedItems'}"><m:ItemIds>${ids(list)}</m:ItemIds></m:DeleteItem>`);
}

// Address book from recent correspondence (same shape as the IMAP one): senders of the last
// 400 inbox mails + recipients of the last 250 sent mails, most frequent first.
async function collectContactsEws(acc, own) {
  const tally = new Map();
  const add = (name, email) => {
    email = String(email || '').trim().toLowerCase(); if (!/^[^@\s]+@[^@\s]+$/.test(email) || email === String(own || '').toLowerCase()) return;
    const t = tally.get(email) || { email, name: '', count: 0 }; t.count++; if (name && name !== email && !t.name) t.name = name; tally.set(email, t);
  };
  const find = (folder, n) => soap(acc, `<m:FindItem Traversal="Shallow"><m:ItemShape><t:BaseShape>IdOnly</t:BaseShape><t:AdditionalProperties><t:FieldURI FieldURI="message:From"/></t:AdditionalProperties></m:ItemShape>
<m:IndexedPageItemView MaxEntriesReturned="${n}" Offset="0" BasePoint="Beginning"/><m:SortOrder><t:FieldOrder Order="Descending"><t:FieldURI FieldURI="item:DateTimeReceived"/></t:FieldOrder></m:SortOrder>
<m:ParentFolderIds><t:DistinguishedFolderId Id="${folder}"/></m:ParentFolderIds></m:FindItem>`);
  const inbox = await find('inbox', 400);
  for (const m of inbox.matchAll(/<t:From>([\s\S]*?)<\/t:From>/g)) add(tag(m[1], 'Name'), tag(m[1], 'EmailAddress'));
  const sent = await find('sentitems', 250);
  const sentIds = [...sent.matchAll(/<t:ItemId Id="([^"]+)"/g)].map((m) => unesc(m[1]));
  if (sentIds.length) {
    const xml = await soap(acc, `<m:GetItem><m:ItemShape><t:BaseShape>IdOnly</t:BaseShape><t:AdditionalProperties><t:FieldURI FieldURI="message:ToRecipients"/><t:FieldURI FieldURI="message:CcRecipients"/></t:AdditionalProperties></m:ItemShape><m:ItemIds>${ids(sentIds)}</m:ItemIds></m:GetItem>`);
    for (const m of xml.matchAll(/<t:Mailbox>([\s\S]*?)<\/t:Mailbox>/g)) add(tag(m[1], 'Name'), tag(m[1], 'EmailAddress'));
  }
  return [...tally.values()].sort((a, b) => b.count - a.count).slice(0, 400);
}

// Unread / total of every folder in ONE call (IMAP needs one STATUS per folder: ~40 s for ~590 folders).
// Keys: the IMAP-style path in lower case ("inbox", "pb abbey/admin/vat"…).
async function folderCountsEws(acc) {
  const xml = await soap(acc, `<m:FindFolder Traversal="Deep"><m:FolderShape><t:BaseShape>IdOnly</t:BaseShape><t:AdditionalProperties>
<t:FieldURI FieldURI="folder:TotalCount"/><t:FieldURI FieldURI="folder:UnreadCount"/></t:AdditionalProperties></m:FolderShape>
<m:IndexedPageFolderView MaxEntriesReturned="5000" Offset="0" BasePoint="Beginning"/>
<m:ParentFolderIds><t:DistinguishedFolderId Id="msgfolderroot"/></m:ParentFolderIds></m:FindFolder>`);
  const byId = new Map();
  for (const m of xml.matchAll(/<t:(Folder|SearchFolder|CalendarFolder|ContactsFolder|TasksFolder)>([\s\S]*?)<\/t:\1>/g)) {
    const id = (m[2].match(/<t:FolderId Id="([^"]+)"/) || [])[1];
    if (id) byId.set(id, { total: Number(tag(m[2], 'TotalCount') || 0), unread: Number(tag(m[2], 'UnreadCount') || 0) });
  }
  const inbox = await soap(acc, `<m:GetFolder><m:FolderShape><t:BaseShape>IdOnly</t:BaseShape><t:AdditionalProperties><t:FieldURI FieldURI="folder:TotalCount"/><t:FieldURI FieldURI="folder:UnreadCount"/></t:AdditionalProperties></m:FolderShape><m:FolderIds><t:DistinguishedFolderId Id="inbox"/></m:FolderIds></m:GetFolder>`);
  const out = new Map();
  for (const [path, id] of await folderMap(acc)) if (byId.has(id)) out.set(path, byId.get(id));
  out.set('inbox', { total: Number(tag(inbox, 'TotalCount') || 0), unread: Number(tag(inbox, 'UnreadCount') || 0) });
  return out;
}

module.exports = { folderCountsEws, collectContactsEws, isEwsId, listMail, searchMail, getMime, setFlags, moveTo, deleteMail, folderId, listEvents, createEvent, getEvent, updateEvent, respondEvent, deleteEvent, listContacts, saveContact, deleteContact, getOof, setOof };
