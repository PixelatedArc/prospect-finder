// Talks to the Google Sheet (and Gmail) through the Apps Script web app. Nothing is stored on this PC.

const X = require('./extras');

const URL_RE = /^https:\/\/script\.google\.com\/macros\/s\/[^/]+\/exec/;

/** Accepts a plain web app URL, or a full connection code "URL#key=xxxx" copied from another PC. */
function parseConnection(input) {
  const s = String(input || '').trim();
  const m = s.match(/^(\S+?)#key=([A-Za-z0-9]+)$/);
  return m ? { url: m[1], key: m[2] } : { url: s, key: null };
}

async function call(conn, body) {
  if (!conn || !URL_RE.test(conn.url || '')) {
    throw new Error('That does not look like a web app link. It should start with https://script.google.com/macros/s/ and end with /exec');
  }
  let res;
  try {
    res = await fetch(conn.url, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ ...body, key: conn.key }),
      redirect: 'follow',
    });
  } catch (e) {
    throw new Error('Could not reach Google. Check the internet connection.');
  }
  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch (e) {
    throw new Error('Google did not accept the request. In the Apps Script deployment, "Who has access" must be set to "Anyone".');
  }
  if (!data.ok) {
    const err = new Error(data.error || 'The connector reported a problem.');
    err.limit = !!data.limit;
    throw err;
  }
  return data;
}

const ping = (conn) => call(conn, { action: 'ping' });
const domains = (conn) => call(conn, { action: 'domains' });
const append = (conn, tab, rows, headers) => call(conn, { action: 'append', tab, rows, headers });
const report = (conn, query) => call(conn, { action: 'report', query });
const emailStatus = (conn) => call(conn, { action: 'emailStatus' });
const email = (conn, msg) => call(conn, { action: 'email', ...msg });
/** opts: { tab } for one date tab, { tabs: [...] } for several (connector v4), {} to list the date tabs. */
const weakRows = (conn, opts = {}) => call(conn, { action: 'weakRows', ...(typeof opts === 'string' ? { tab: opts } : opts) });
const pipeline = (conn) => call(conn, { action: 'pipeline' });
const replyDraft = (conn, to, text) => call(conn, { action: 'replyDraft', to, text });
const followUp = (conn, msg) => call(conn, { action: 'followUp', ...msg });
const scorecard = (conn) => call(conn, { action: 'scorecard' });

/** Turns a row read back from the sheet into the shape the email builder expects. */
function rowFromSheet(r) {
  const m = String(r.email || '').match(/^([^\s@]+@[^\s@()]+)\s*(?:\((\w+)\))?/);
  const yn = (v) => (/^yes$/i.test(v) ? true : /^no$/i.test(v) ? false : undefined);
  const ctx = String(r.context || '');
  const cut = ctx.indexOf(',');
  const fails = Number((String(r.weak).match(/\((\d)\/3\)/) || [0, 2])[1]);
  return {
    name: String(r.name || ''),
    website: String(r.website || ''),
    audited: true,
    fails,
    weak: String(r.weak || ''),
    emailRaw: m ? m[1].toLowerCase() : '',
    emailKind: m && m[2] ? m[2] : '',
    checks: { faq: yn(r.faq), service: yn(r.service), schema: yn(r.schema) },
    niche: cut > -1 ? ctx.slice(0, cut).trim().toLowerCase() : ctx.toLowerCase(),
    city: cut > -1 ? ctx.slice(cut + 1).trim() : '',
    context: ctx,
    ownerName: String(r.ownerName || ''),
    // From connector v5 on: "4.8 (288)" rating, schema detail and the strongest competitor in the same search.
    rating: Number((String(r.rating || '').match(/^([\d.]+)/) || [0, 0])[1]) || '',
    reviews: Number((String(r.rating || '').match(/\((\d[\d,]*)\)/) || [0, '0'])[1].replace(/,/g, '')) || 0,
    schemaDetail: String(r.schemaDetail || ''),
    strong: String(r.strong || ''),
    // From connector v6 on: serial number and the phone-side checks.
    id: String(r.id || ''),
    other: String(r.other || ''),
    agency: String(r.agency || ''),
    mobile: X.parseMobile(r.mobile),
    tap: X.parseTap(r.tap),
    phone: X.parsePhone(r.phone),
    summary: String(r.summary || ''),
    priority: String(r.priority || ''),
    priorityScore: Number((String(r.priority || '').match(/\((\d+)\)/) || [0, 0])[1]),
    status: String(r.status || ''),
  };
}

/** Tab name for today, e.g. "Nov 16, 2026". */
function todayTab(d = new Date()) {
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

module.exports = { parseConnection, ping, domains, append, report, emailStatus, email, weakRows, pipeline, replyDraft, followUp, scorecard, rowFromSheet, todayTab };
