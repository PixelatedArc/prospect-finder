/**
 * Prospect Finder - Google Sheet + Gmail connector.
 * Paste this into Extensions > Apps Script of your outreach sheet, then
 * Deploy > New deployment > Web app (Execute as: Me, Who has access: Anyone).
 *
 * What it can do, and nothing else:
 *   - add rows to this spreadsheet (one tab per day, named by date) and keep their Status up to date
 *   - create Gmail drafts or send emails from YOUR Gmail, within a daily limit
 *   - look in YOUR Gmail for replies and bounces from the businesses you emailed
 *   - keep the "Email Log", "Do Not Contact" and "Scorecard" tabs
 * Every request must carry the private key below, so nobody else can use the link.
 */
var KEY = '__PROSPECT_KEY__';
var HARD_DAILY_CAP = 40; // the app can ask for less, never more
var FOLLOW_UP_AFTER_DAYS = 4;
var LOG_TAB = 'Email Log';
var DNC_TAB = 'Do Not Contact';
var SCORE_TAB = 'Scorecard';
// Columns of a date tab. They are found by their header name, so older tabs with a different
// order keep working; missing columns are added at the end and "#" is inserted as column A.
var HEADERS = ['#', 'Niche', 'Business Name', 'Website', 'FAQ', 'Service Page', 'Schema', 'Other Issue', 'Schema Detail',
  'Weak? (fails of 3)', 'Agency Credit', 'Owner Email', 'Weak Sites Score', 'Owner Name', 'Google Rating', 'Priority',
  'Status', 'Status Date', 'Mobile', 'Tap to Call', 'Phone vs Google', 'Audit Summary'];
// What app versions before connector v6 sent, in this order.
var OLD_HEADERS = ['Niche', 'Business Name', 'Website', 'FAQ', 'Service Page', 'Schema', 'Other Issue', 'Schema Detail',
  'Weak? (fails of 3)', 'Agency Credit', 'Owner Email', 'Weak Sites Score', 'Owner Name', 'Google Rating', 'Priority',
  'Status', 'Status Date', 'Audit Summary'];
var FIELD = { id: '#', context: 'Niche', name: 'Business Name', website: 'Website', faq: 'FAQ', service: 'Service Page', schema: 'Schema',
  other: 'Other Issue', schemaDetail: 'Schema Detail', weak: 'Weak? (fails of 3)', agency: 'Agency Credit', email: 'Owner Email',
  score: 'Weak Sites Score', owner: 'Owner Name', rating: 'Google Rating', priority: 'Priority', status: 'Status', statusDate: 'Status Date',
  mobile: 'Mobile', tap: 'Tap to Call', phone: 'Phone vs Google', summary: 'Audit Summary' };
var LOG_HEADERS = ['Date', 'Business', 'Email', 'Subject', 'Status', 'Search', 'Sent On', 'Follow-up On', 'Replied On', 'Reply', 'Updated'];
var STATUSES = ['drafted', 'sent', 'follow-up drafted', 'follow-up sent', 'replied', 'call booked', 'won', 'lost', 'not interested', 'bounced'];
var YOURS = { 'call booked': 1, 'won': 1, 'lost': 1 }; // statuses you set by hand; never overwritten
// Out-of-office and "we got your message" robots: not a real answer, so the follow-up still happens.
var AUTO_REPLY = /\b(out of (the )?office|auto(matic|mated)?[- ]?(reply|response|responder)|autoreply|away from (the|my) (office|desk)|on (annual |maternity |paternity )?(vacation|holiday|leave)|limited access to (my )?email|we have received your (message|email|enquiry|inquiry)|this (is an|mailbox is) (automated|unmonitored)|do not reply to this (email|message))\b/i;
var OPT_OUT = /\b(no,? thanks?|no thank you|not interested|unsubscribe|remove me|stop (emailing|contacting)|do not (contact|email)|don'?t (contact|email)|take me off|leave (me|us) alone)\b/i;

/** Text from outside (emails, websites) must never become a live formula in your sheet. */
function safe(v) {
  if (typeof v !== 'string') return v == null ? '' : v;
  return /^[=+\-@]/.test(v) ? "'" + v : v;
}

/** Your own address and any "send as" aliases, so your own messages are never mistaken for a reply. */
function myAddresses() {
  var list = [String(Session.getEffectiveUser().getEmail() || '').toLowerCase()];
  try { GmailApp.getAliases().forEach(function (a) { list.push(String(a).toLowerCase()); }); } catch (ignore) {}
  return list.filter(String);
}

function doGet() {
  return out({ ok: true, app: 'Prospect Finder connector' });
}

function doPost(e) {
  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(25000);
    var body = JSON.parse(e.postData.contents);
    if (KEY.indexOf('__') === 0 || body.key !== KEY) {
      return out({ ok: false, error: 'Wrong connection key. Copy the connector code from the app again, or paste the full connection code.' });
    }
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    switch (body.action) {
      case 'ping': return out({ ok: true, name: ss.getName(), url: ss.getUrl(), version: 7 });
      case 'report': return out(actionReport(ss, body));
      case 'domains': return out(actionDomains(ss));
      case 'append': return out(actionAppend(ss, body));
      case 'weakRows': return out(actionWeakRows(ss, body));
      case 'emailStatus': return out(actionEmailStatus(ss));
      case 'email': return out(actionEmail(ss, body));
      case 'pipeline': return out(actionPipeline(ss));
      case 'replyDraft': return out(actionReplyDraft(ss, body));
      case 'followUp': return out(actionFollowUp(ss, body));
      case 'scorecard': return out(refreshScorecard(ss));
      default: return out({ ok: false, error: 'unknown action' });
    }
  } catch (err) {
    return out({ ok: false, error: String(err) });
  } finally {
    try { lock.releaseLock(); } catch (ignore) {}
  }
}

/* ---------- sheet rows ---------- */

/** Header name -> column number (1-based) for a tab. */
function headerMap(sheet) {
  var width = Math.max(1, sheet.getLastColumn());
  var map = {};
  sheet.getRange(1, 1, 1, width).getValues()[0].forEach(function (h, i) {
    h = String(h).trim();
    if (h && !map[h]) map[h] = i + 1;
  });
  return map;
}

/** Tabs that hold prospects: the ones with "Business Name" and "Website" headers. */
function dateTabs(ss) {
  return ss.getSheets().filter(function (sh) {
    if (sh.getLastRow() < 1) return false;
    var m = headerMap(sh);
    return !!(m['Business Name'] && m['Website']);
  });
}

/** Brings one tab up to the current layout: "#" as column A, and any new column added at the end. */
function upgradeTab(sheet) {
  var m = headerMap(sheet);
  if (!m['#']) {
    sheet.insertColumnBefore(1);
    sheet.getRange(1, 1).setValue('#').setFontWeight('bold');
    m = headerMap(sheet);
  }
  var add = HEADERS.filter(function (h) { return !m[h]; });
  if (add.length) {
    sheet.getRange(1, sheet.getLastColumn() + 1, 1, add.length).setValues([add]).setFontWeight('bold');
    m = headerMap(sheet);
  }
  return m;
}

/** Upgrades every date tab and gives every business without one the next serial number. */
function upgradeAll(ss) {
  var tabs = dateTabs(ss);
  var info = tabs.map(function (sh) {
    var m = upgradeTab(sh);
    var last = sh.getLastRow();
    if (last < 2) return { sh: sh, m: m, ids: [], names: [] };
    return { sh: sh, m: m, ids: sh.getRange(2, m['#'], last - 1, 1).getValues(), names: sh.getRange(2, m['Business Name'], last - 1, 1).getValues() };
  });
  var next = 1;
  info.forEach(function (t) { t.ids.forEach(function (r) { var n = Number(r[0]); if (n >= next) next = n + 1; }); });
  info.forEach(function (t) {
    var changed = false;
    for (var i = 0; i < t.ids.length; i++) {
      if (!Number(t.ids[i][0]) && String(t.names[i][0]).trim()) { t.ids[i][0] = next++; changed = true; }
    }
    if (changed) t.sh.getRange(2, t.m['#'], t.ids.length, 1).setValues(t.ids);
  });
}

function actionDomains(ss) {
  // Every website already logged, on any date tab, so nobody is audited twice.
  var domains = {};
  dateTabs(ss).forEach(function (sh) {
    var last = sh.getLastRow();
    if (last < 2) return;
    sh.getRange(2, headerMap(sh)['Website'], last - 1, 1).getValues().forEach(function (r) {
      var m = String(r[0]).match(/^https?:\/\/(?:www\.)?([^\/?#]+)/i);
      if (m) domains[m[1].toLowerCase()] = true;
    });
  });
  return { ok: true, domains: Object.keys(domains), name: ss.getName(), url: ss.getUrl() };
}

function actionAppend(ss, body) {
  var rows = body.rows || [];
  if (!rows.length) return { ok: false, error: 'no rows sent' };
  var sent = Array.isArray(body.headers) && body.headers.length ? body.headers.map(String) : OLD_HEADERS;
  var tab = String(body.tab);
  var sheet = ss.getSheetByName(tab);
  var created = false;
  if (!sheet) {
    sheet = ss.insertSheet(tab, ss.getNumSheets());
    sheet.getRange(1, 1, 1, HEADERS.length).setValues([HEADERS]).setFontWeight('bold');
    sheet.setFrozenRows(1);
    created = true;
  }
  var m = upgradeTab(sheet);
  var extra = sent.filter(function (h) { return !m[h]; });
  if (extra.length) {
    sheet.getRange(1, sheet.getLastColumn() + 1, 1, extra.length).setValues([extra]).setFontWeight('bold');
    m = headerMap(sheet);
  }
  var width = sheet.getLastColumn();
  var last = sheet.getLastRow();
  var start = last <= 1 ? 2 : last + 2; // one blank row between batches
  var lines = rows.map(function (r) {
    var line = [];
    for (var c = 0; c < width; c++) line.push('');
    sent.forEach(function (h, i) { if (m[h] && r[i] != null) line[m[h] - 1] = safe(r[i]); });
    return line;
  });
  sheet.getRange(start, 1, lines.length, width).setValues(lines);
  // Status is a dropdown so you can mark "call booked", "won" or "lost" yourself.
  var rule = SpreadsheetApp.newDataValidation().requireValueInList(STATUSES, true).setAllowInvalid(true).build();
  sheet.getRange(start, m['Status'], lines.length, 1).setDataValidation(rule);
  sheet.getRange(start, m['Audit Summary'], lines.length, 1).setWrapStrategy(SpreadsheetApp.WrapStrategy.CLIP);
  upgradeAll(ss); // gives the new rows their serial numbers
  var ids = sheet.getRange(start, m['#'], lines.length, 1).getValues().map(function (r) { return r[0]; });
  return { ok: true, tab: tab, created: created, startRow: start, rows: lines.length, ids: ids, url: ss.getUrl() + '#gid=' + sheet.getSheetId() };
}

function emailOf(cell) {
  var m = String(cell || '').match(/^([^\s@]+@[^\s@()]+)/);
  return m ? m[1].toLowerCase() : '';
}

/** Every prospect row on every date tab, with the search ("Dentist, Columbus OH") carried down. */
function allProspects(ss) {
  var list = [];
  dateTabs(ss).forEach(function (sh) {
    var last = sh.getLastRow();
    if (last < 2) return;
    var m = headerMap(sh);
    var get = function (r, f) { var c = m[FIELD[f]]; return c ? String(r[c - 1]) : ''; };
    var carry = '';
    sh.getRange(2, 1, last - 1, sh.getLastColumn()).getDisplayValues().forEach(function (r, i) {
      var ctx = get(r, 'context').trim();
      if (ctx) carry = ctx;
      var name = get(r, 'name').trim();
      if (!name) return;
      list.push({
        sheet: sh, cols: m, row: i + 2, tab: sh.getName(), id: get(r, 'id'), context: carry, name: name, website: get(r, 'website'),
        faq: get(r, 'faq'), service: get(r, 'service'), schema: get(r, 'schema'), other: get(r, 'other'), schemaDetail: get(r, 'schemaDetail'),
        rating: get(r, 'rating'), weak: get(r, 'weak'), agency: get(r, 'agency'), emailCell: get(r, 'email'), email: emailOf(get(r, 'email')),
        owner: get(r, 'owner'), priority: get(r, 'priority'), status: get(r, 'status').trim(),
        mobile: get(r, 'mobile'), tap: get(r, 'tap'), phone: get(r, 'phone'), summary: get(r, 'summary')
      });
    });
  });
  return list;
}

/** What the app gets back for one business. */
function publicRow(p) {
  return { id: p.id, tab: p.tab, context: p.context, name: p.name, website: p.website, faq: p.faq, service: p.service, schema: p.schema,
    other: p.other, schemaDetail: p.schemaDetail, weak: p.weak, agency: p.agency, email: p.emailCell, ownerName: p.owner, rating: p.rating,
    priority: p.priority, status: p.status, mobile: p.mobile, tap: p.tap, phone: p.phone, summary: p.summary };
}

/** For each search, the competitor whose site passed every check, the best reviewed first (named in the email). */
function strongBySearch(all) {
  var reviewsOf = function (p) { var m = String(p.rating || '').match(/\((\d[\d,]*)\)/); return m ? Number(m[1].replace(/,/g, '')) : 0; };
  var strong = {};
  all.forEach(function (p) {
    if (!/^ok \(0\/3\)/i.test(String(p.weak))) return;
    var k = p.tab + '|' + p.context;
    if (!strong[k] || reviewsOf(p) > reviewsOf(strong[k])) strong[k] = p;
  });
  return function (p) { var s = strong[p.tab + '|' + p.context]; return s && s.name !== p.name ? s.name : ''; };
}

function setStatusCells(p, status) {
  if (p.cols['Status']) p.sheet.getRange(p.row, p.cols['Status']).setValue(status);
  if (p.cols['Status Date']) p.sheet.getRange(p.row, p.cols['Status Date']).setValue(new Date());
  p.status = status;
}

function prospectByEmail(ss) {
  var map = {};
  allProspects(ss).forEach(function (p) { if (p.email && !map[p.email]) map[p.email] = p; });
  return map;
}

function setProspectStatus(p, status) {
  if (!p || YOURS[p.status]) return;
  setStatusCells(p, status);
}

/** WEAK rows from one date tab (body.tab) or several (body.tabs). With neither, just lists the date tabs. */
function actionWeakRows(ss, body) {
  var tabs = dateTabs(ss).map(function (s) { return s.getName(); });
  var asked = Array.isArray(body.tabs) ? body.tabs.map(String) : (body.tab ? [String(body.tab)] : []);
  var wanted = {};
  asked.forEach(function (t) { if (tabs.indexOf(t) > -1) wanted[t] = true; });
  var picked = Object.keys(wanted);
  if (!picked.length) return { ok: true, version: 7, tabs: tabs, tab: null, picked: [], rows: [] };
  upgradeAll(ss);
  var all = allProspects(ss);
  var strongFor = strongBySearch(all);
  var rows = all.filter(function (p) { return wanted[p.tab] && /^WEAK \(/.test(String(p.weak)); })
    .map(function (p) { var r = publicRow(p); r.strong = strongFor(p); return r; });
  return { ok: true, version: 7, tabs: tabs, tab: picked.length === 1 ? picked[0] : null, picked: picked, rows: rows };
}

/** Finds a business by serial number, email address, website or part of its name, for its audit report. */
function actionReport(ss, body) {
  var q = String(body.query || '').trim().toLowerCase().replace(/^#\s*/, '');
  if (!q) return { ok: false, error: 'Type a serial number, an email address, a website or a business name.' };
  upgradeAll(ss);
  var all = allProspects(ss);
  var domainOf = function (s) { return String(s || '').toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/[\/?#].*$/, ''); };
  var hits;
  if (/^\d+$/.test(q)) {
    hits = all.filter(function (p) { return String(p.id) === q; });
  } else if (q.indexOf('@') > -1) {
    hits = all.filter(function (p) { return p.email === q; });
    if (!hits.length) hits = all.filter(function (p) { return domainOf(p.website) === q.split('@')[1]; });
  } else if (/^[^\s]+\.[a-z]{2,}(\/.*)?$/.test(q.replace(/^https?:\/\//, ''))) {
    hits = all.filter(function (p) { return domainOf(p.website) === domainOf(q); });
  } else {
    hits = all.filter(function (p) { return p.name.toLowerCase().indexOf(q) > -1; });
  }
  var strongFor = strongBySearch(all);
  var log = readLog(ss);
  return { ok: true, version: 7, total: hits.length, matches: hits.slice(0, 10).map(function (p) {
    var r = publicRow(p);
    r.strong = strongFor(p);
    var entry = null;
    log.forEach(function (e) { if (e.email && e.email === p.email) entry = e; });
    r.logStatus = entry ? entry.status : '';
    return r;
  }) };
}

/* ---------- email log, limits, do-not-contact ---------- */

function logSheet(ss) {
  var log = ss.getSheetByName(LOG_TAB);
  if (!log) log = ss.insertSheet(LOG_TAB, ss.getNumSheets());
  var have = log.getRange(1, 1, 1, LOG_HEADERS.length).getValues()[0];
  if (have.join('|') !== LOG_HEADERS.join('|')) {
    log.getRange(1, 1, 1, LOG_HEADERS.length).setValues([LOG_HEADERS]).setFontWeight('bold');
    log.setFrozenRows(1);
  }
  return log;
}

function readLog(ss) {
  var log = logSheet(ss);
  var last = log.getLastRow();
  if (last < 2) return [];
  return log.getRange(2, 1, last - 1, LOG_HEADERS.length).getValues().map(function (r, i) {
    return { row: i + 2, date: r[0], business: String(r[1]), email: String(r[2]).toLowerCase().trim(), subject: String(r[3]),
      status: String(r[4]).trim(), search: String(r[5]), sentOn: r[6], followOn: r[7], repliedOn: r[8] };
  });
}

function setLog(ss, entry, fields) {
  var log = logSheet(ss);
  var map = { status: 5, sentOn: 7, followOn: 8, repliedOn: 9, reply: 10 };
  Object.keys(fields).forEach(function (k) { log.getRange(entry.row, map[k]).setValue(safe(fields[k])); });
  log.getRange(entry.row, 11).setValue(new Date());
}

function dncSheet(ss) {
  var d = ss.getSheetByName(DNC_TAB);
  if (!d) {
    d = ss.insertSheet(DNC_TAB, ss.getNumSheets());
    d.getRange(1, 1).setValue('Never contact: put one email address or one domain per row below').setFontWeight('bold');
    d.setFrozenRows(1);
  }
  return d;
}

function readDnc(ss) {
  var d = dncSheet(ss);
  var dnc = {};
  if (d.getLastRow() > 1) {
    d.getRange(2, 1, d.getLastRow() - 1, 1).getValues().forEach(function (r) {
      var v = String(r[0]).toLowerCase().trim().replace(/^https?:\/\/(www\.)?/, '').replace(/\/.*$/, '');
      if (v) dnc[v] = true;
    });
  }
  return dnc;
}

function isDnc(dnc, email) {
  return !!(dnc[email] || dnc[email.split('@')[1]]);
}

function dayKey(d, tz) {
  return d instanceof Date ? Utilities.formatDate(d, tz, 'yyyy-MM-dd') : '';
}

/** Emails that left your account today: first emails plus follow-ups. */
function sentTodayCount(ss, log) {
  var tz = ss.getSpreadsheetTimeZone();
  var today = dayKey(new Date(), tz);
  var n = 0;
  log.forEach(function (e) {
    if (dayKey(e.sentOn, tz) === today) n++;
    if (dayKey(e.followOn, tz) === today) n++;
  });
  return n;
}

function capOf(body) {
  return Math.min(HARD_DAILY_CAP, Math.max(1, Number(body.dailyCap) || 10));
}

function actionEmailStatus(ss) {
  var log = readLog(ss).filter(function (e) { return e.status !== 'draft deleted'; });
  return { ok: true, sentToday: sentTodayCount(ss, log), contacted: log.map(function (e) { return e.email; }),
    drafted: log.filter(function (e) { return e.status === 'drafted'; }).map(function (e) { return e.email; }),
    doNotContact: Object.keys(readDnc(ss)), googleQuotaLeft: MailApp.getRemainingDailyQuota(),
    sender: Session.getEffectiveUser().getEmail(), hardCap: HARD_DAILY_CAP };
}

function actionEmail(ss, body) {
  var to = String(body.to || '').trim().toLowerCase();
  if (!/^[^@\s,;]+@[^@\s,;]+\.[a-z]{2,}$/.test(to)) return { ok: false, error: 'not a valid email address' };
  var subject = String(body.subject || '').trim();
  var text = String(body.text || '').trim();
  if (!subject || !text) return { ok: false, error: 'empty subject or message' };
  var log = readLog(ss);
  if (isDnc(readDnc(ss), to)) return { ok: true, status: 'skipped', reason: 'on your Do Not Contact list' };
  if (log.some(function (e) { return e.email === to && e.status !== 'draft deleted'; })) {
    return { ok: true, status: 'skipped', reason: 'already emailed, or a draft to them is waiting in Gmail' };
  }

  var mode = body.mode === 'send' ? 'send' : 'draft';
  var options = body.senderName ? { name: String(body.senderName) } : {};
  var sentToday = sentTodayCount(ss, log);
  if (mode === 'send') {
    var cap = capOf(body);
    if (sentToday >= cap) return { ok: false, limit: true, error: 'Daily limit of ' + cap + ' emails reached. Continue tomorrow.' };
    if (MailApp.getRemainingDailyQuota() < 1) return { ok: false, limit: true, error: 'Google\'s own daily sending quota for this account is used up.' };
  }
  var draft = GmailApp.createDraft(to, subject, text, options);
  if (mode === 'send') draft.send();
  var status = mode === 'send' ? 'sent' : 'drafted';
  var now = new Date();
  logSheet(ss).appendRow([now, safe(String(body.business || '')), to, safe(subject), status, safe(String(body.context || '')), mode === 'send' ? now : '', '', '', '', now]);
  setProspectStatus(prospectByEmail(ss)[to], status);
  return { ok: true, status: status, sentToday: sentToday + (mode === 'send' ? 1 : 0) };
}

/* ---------- replies, bounces, follow-ups ---------- */

function actionPipeline(ss) {
  var started = Date.now();
  var log = readLog(ss);
  var prospects = prospectByEmail(ss);
  var dnc = readDnc(ss);
  var res = { ok: true, newReplies: [], optOuts: [], bounces: [], nowSent: [], draftsDeleted: [], waitingDrafts: 0, autoReplies: [], followUps: [], checked: 0, partial: false };
  var mine = myAddresses();
  var draftsTo = null; // addresses that have a draft waiting in Gmail, read once when needed
  var open = { 'drafted': 1, 'sent': 1, 'follow-up drafted': 1, 'follow-up sent': 1 };

  for (var i = log.length - 1; i >= 0; i--) {
    var e = log[i];
    if (!open[e.status] || !e.email) continue;
    if (Date.now() - started > 210000 || res.checked >= 80) { res.partial = true; break; }
    res.checked++;
    var p = prospects[e.email];
    var since = e.date instanceof Date ? e.date : new Date(0);

    // A draft you sent yourself from Gmail counts as sent.
    if (e.status === 'drafted' || !(e.sentOn instanceof Date)) {
      var sentThreads = GmailApp.search('in:sent to:' + e.email + ' newer_than:90d', 0, 1);
      if (sentThreads.length) {
        e.sentOn = sentThreads[0].getMessages()[0].getDate();
        if (e.status === 'drafted') e.status = 'sent';
        setLog(ss, e, { status: e.status, sentOn: e.sentOn });
        setProspectStatus(p, e.status);
        res.nowSent.push(e.business);
      } else if (e.status === 'drafted') {
        // Not sent yet. If the draft is still in Gmail it simply waits; if you deleted it, the business is freed up again.
        if (!draftsTo) {
          draftsTo = {};
          GmailApp.getDrafts().forEach(function (d) {
            String(d.getMessage().getTo() || '').toLowerCase().split(/[,;]/).forEach(function (a) {
              var m = a.match(/[^\s<>"]+@[^\s<>"]+/);
              if (m) draftsTo[m[0]] = true;
            });
          });
        }
        if (!draftsTo[e.email]) {
          setLog(ss, e, { status: 'draft deleted' });
          if (p && p.status === 'drafted') setStatusCells(p, '');
          res.draftsDeleted.push(e.business);
          e.status = 'draft deleted';
        } else {
          res.waitingDrafts++;
        }
        continue;
      }
    }

    // Bounce: the address does not exist.
    var bounced = GmailApp.search('from:(mailer-daemon OR postmaster) "' + e.email + '" newer_than:90d', 0, 1);
    if (bounced.length && bounced[0].getLastMessageDate() >= since) {
      setLog(ss, e, { status: 'bounced' });
      setProspectStatus(p, 'bounced');
      if (!isDnc(dnc, e.email)) { dncSheet(ss).appendRow([e.email]); dnc[e.email] = true; }
      res.bounces.push(e.business);
      e.status = 'bounced';
      continue;
    }

    // Reply: a message from that address since the first email, or from anyone else answering in the
    // same thread (an office manager replying from their own address). Auto-replies do not count.
    var reply = null;
    var consider = function (m, anySender) {
      var from = String(m.getFrom() || '').toLowerCase();
      if (m.getDate() < since || /mailer-daemon|postmaster/.test(from)) return;
      if (anySender ? mine.some(function (a) { return from.indexOf(a) > -1; }) : from.indexOf(e.email) === -1) return;
      if (AUTO_REPLY.test(String(m.getSubject() || '') + ' ' + String(m.getPlainBody() || '').slice(0, 500))) { autoSeen = true; return; }
      if (!reply || m.getDate() > reply.getDate()) reply = m;
    };
    var autoSeen = false;
    GmailApp.search('from:' + e.email + ' newer_than:90d', 0, 3).forEach(function (t) {
      t.getMessages().forEach(function (m) { consider(m, false); });
    });
    if (!reply) {
      GmailApp.search('in:sent to:' + e.email + ' newer_than:90d', 0, 3).forEach(function (t) {
        t.getMessages().forEach(function (m) { consider(m, true); });
      });
    }
    if (!reply && autoSeen && res.autoReplies.indexOf(e.business) === -1) res.autoReplies.push(e.business);
    if (reply) {
      var replyFrom = (String(reply.getFrom() || '').toLowerCase().match(/[^\s<>"]+@[^\s<>"]+/) || [e.email])[0];
      var snippet = String(reply.getPlainBody() || '').split(/\n\s*(?:On .{3,90} wrote:|From: |-----Original|_{5,})/)[0].replace(/^>.*$/gm, '').replace(/\s+/g, ' ').trim().slice(0, 300);
      var no = OPT_OUT.test(snippet);
      var status = no ? 'not interested' : 'replied';
      setLog(ss, e, { status: status, repliedOn: reply.getDate(), reply: snippet });
      setProspectStatus(p, status);
      e.status = status;
      if (no) {
        if (!isDnc(dnc, e.email)) { dncSheet(ss).appendRow([e.email]); dnc[e.email] = true; }
        res.optOuts.push(e.business);
      } else {
        res.newReplies.push({ to: e.email, replyFrom: replyFrom, business: e.business, snippet: snippet, website: p ? p.website : '',
          ownerName: p ? p.owner : '', summary: p ? p.summary : '', row: p ? publicRow(p) : null });
      }
    }
  }

  // Who is due one follow-up: sent at least FOLLOW_UP_AFTER_DAYS ago, no answer, never followed up.
  var cutoff = Date.now() - FOLLOW_UP_AFTER_DAYS * 86400000;
  log.forEach(function (e) {
    if (e.status !== 'sent' || !(e.sentOn instanceof Date) || e.followOn instanceof Date) return;
    if (e.sentOn.getTime() > cutoff || isDnc(dnc, e.email)) return;
    var p = prospects[e.email];
    if (p && YOURS[p.status]) return;
    res.followUps.push({ to: e.email, business: e.business, subject: e.subject, search: e.search, website: p ? p.website : '',
      ownerName: p ? p.owner : '', sentOn: Utilities.formatDate(e.sentOn, ss.getSpreadsheetTimeZone(), 'MMM d') });
  });

  res.sentToday = sentTodayCount(ss, readLog(ss));
  res.scorecard = refreshScorecard(ss);
  return res;
}

/** Puts a reply (the audit summary and the offer) in your Drafts, in the thread where they answered. */
function actionReplyDraft(ss, body) {
  var to = String(body.to || '').trim().toLowerCase();
  var text = String(body.text || '').trim();
  if (!to || !text) return { ok: false, error: 'nothing to draft' };
  var threads = GmailApp.search('from:' + to + ' newer_than:90d', 0, 3);
  var last = null;
  threads.forEach(function (t) {
    t.getMessages().forEach(function (m) {
      if (m.getFrom().toLowerCase().indexOf(to) > -1 && (!last || m.getDate() > last.getDate())) last = m;
    });
  });
  if (!last) {
    // Someone else at the business may have answered your email: reply to their message in that thread.
    var mine = myAddresses();
    GmailApp.search('in:sent to:' + to + ' newer_than:90d', 0, 3).forEach(function (t) {
      t.getMessages().forEach(function (m) {
        var from = String(m.getFrom() || '').toLowerCase();
        if (mine.some(function (a) { return from.indexOf(a) > -1; }) || /mailer-daemon|postmaster/.test(from)) return;
        if (!last || m.getDate() > last.getDate()) last = m;
      });
    });
  }
  if (!last) return { ok: false, error: 'could not find their reply in Gmail' };
  last.createDraftReply(text);
  return { ok: true, status: 'reply drafted' };
}

/** One follow-up, written into the same thread as the first email. */
function actionFollowUp(ss, body) {
  var to = String(body.to || '').trim().toLowerCase();
  var text = String(body.text || '').trim();
  if (!to || !text) return { ok: false, error: 'nothing to send' };
  var log = readLog(ss);
  var entry = null;
  log.forEach(function (e) { if (e.email === to) entry = e; });
  if (!entry) return { ok: false, error: 'no first email on record for this address' };
  if (entry.followOn instanceof Date) return { ok: true, status: 'skipped', reason: 'already followed up once' };
  if (entry.status !== 'sent') return { ok: true, status: 'skipped', reason: 'status is "' + entry.status + '"' };
  if (isDnc(readDnc(ss), to)) return { ok: true, status: 'skipped', reason: 'on your Do Not Contact list' };

  var mode = body.mode === 'send' ? 'send' : 'draft';
  if (mode === 'send') {
    var cap = capOf(body);
    if (sentTodayCount(ss, log) >= cap) return { ok: false, limit: true, error: 'Daily limit of ' + cap + ' emails reached. Continue tomorrow.' };
    if (MailApp.getRemainingDailyQuota() < 1) return { ok: false, limit: true, error: 'Google\'s own daily sending quota for this account is used up.' };
  }
  var threads = GmailApp.search('in:sent to:' + to + ' newer_than:90d', 0, 1);
  if (!threads.length) return { ok: false, error: 'the first email was not found in your Sent folder' };
  var msgs = threads[0].getMessages();
  var draft = msgs[msgs.length - 1].createDraftReply(text);
  // Replying to your own message can address the draft to yourself; make sure it goes to them.
  if (String(draft.getMessage().getTo()).toLowerCase().indexOf(to) === -1) {
    draft = draft.update(to, 'Re: ' + String(entry.subject).replace(/^re:\s*/i, ''), text);
  }
  if (mode === 'send') draft.send();
  var status = mode === 'send' ? 'follow-up sent' : 'follow-up drafted';
  setLog(ss, entry, { status: status, followOn: new Date() });
  setProspectStatus(prospectByEmail(ss)[to], status);
  return { ok: true, status: status };
}

/* ---------- scorecard ---------- */

function refreshScorecard(ss) {
  var emailed = { 'sent': 1, 'follow-up drafted': 1, 'follow-up sent': 1, 'replied': 1, 'call booked': 1, 'won': 1, 'lost': 1, 'not interested': 1, 'bounced': 1 };
  var answered = { 'replied': 1, 'call booked': 1, 'won': 1, 'lost': 1, 'not interested': 1 };
  var blank = function () { return { checked: 0, weak: 0, emailed: 0, replied: 0, calls: 0, won: 0, no: 0, bounced: 0 }; };
  var total = blank();
  var by = {};
  var order = [];
  allProspects(ss).forEach(function (p) {
    if (!/^(WEAK|ok) \(/.test(String(p.weak))) return; // only sites that were actually scored
    var key = p.context || '(unknown)';
    if (!by[key]) { by[key] = blank(); order.push(key); }
    [total, by[key]].forEach(function (g) {
      g.checked++;
      if (/^WEAK/.test(p.weak)) g.weak++;
      if (emailed[p.status]) g.emailed++;
      if (answered[p.status]) g.replied++;
      if (p.status === 'call booked' || p.status === 'won') g.calls++;
      if (p.status === 'won') g.won++;
      if (p.status === 'not interested') g.no++;
      if (p.status === 'bounced') g.bounced++;
    });
  });
  var week = Date.now() - 7 * 86400000;
  var sent7 = 0, replies7 = 0;
  readLog(ss).forEach(function (e) {
    if (e.sentOn instanceof Date && e.sentOn.getTime() >= week) sent7++;
    if (e.followOn instanceof Date && e.followOn.getTime() >= week) sent7++;
    if (e.repliedOn instanceof Date && e.repliedOn.getTime() >= week) replies7++;
  });
  var pct = function (a, b) { return b ? Math.round((a / b) * 100) + '%' : '-'; };

  var sh = ss.getSheetByName(SCORE_TAB);
  if (!sh) sh = ss.insertSheet(SCORE_TAB, 0);
  sh.clearContents();
  var rows = [
    ['Scorecard', 'updated ' + Utilities.formatDate(new Date(), ss.getSpreadsheetTimeZone(), 'MMM d, yyyy HH:mm'), '', '', '', '', '', '', ''],
    ['', '', '', '', '', '', '', '', ''],
    ['Last 7 days', 'Emails sent', sent7, 'Replies', replies7, '', '', '', ''],
    ['', '', '', '', '', '', '', '', ''],
    ['Search', 'Sites checked', 'Weak', 'Emailed', 'Replied', 'Reply rate', 'Calls booked', 'Won', 'Not interested / bounced'],
    ['ALL', total.checked, total.weak, total.emailed, total.replied, pct(total.replied, total.emailed), total.calls, total.won, total.no + ' / ' + total.bounced]
  ];
  order.forEach(function (k) {
    var g = by[k];
    rows.push([k, g.checked, g.weak, g.emailed, g.replied, pct(g.replied, g.emailed), g.calls, g.won, g.no + ' / ' + g.bounced]);
  });
  rows.push(['', '', '', '', '', '', '', '', '']);
  rows.push(['To record a call or a sale, set the Status dropdown on that business in its date tab to "call booked", "won" or "lost".', '', '', '', '', '', '', '', '']);
  sh.getRange(1, 1, rows.length, 9).setValues(rows);
  sh.getRange(1, 1, 1, 1).setFontWeight('bold');
  sh.getRange(5, 1, 2, 9).setFontWeight('bold');
  return { ok: true, checked: total.checked, weak: total.weak, emailed: total.emailed, replied: total.replied,
    replyRate: pct(total.replied, total.emailed), calls: total.calls, won: total.won, sent7: sent7, replies7: replies7,
    url: ss.getUrl() + '#gid=' + sh.getSheetId() };
}

function out(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
