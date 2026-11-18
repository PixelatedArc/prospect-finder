const $ = (id) => document.getElementById(id);
let settings = {};
let sheetUrl = '';
let scoreUrl = '';
let lastRun = null; // { rows, sheetRows, niche, city } of the run on screen (kept in memory only)

// Two lists of messages share the same behaviour: first emails and follow-ups.
const boxes = {
  first: { type: 'first', items: [], list: 'emailList', draft: 'draftBtn', send: 'sendBtn', stop: 'emailStopBtn', status: 'emailStatus', noun: 'email' },
  followup: { type: 'followup', items: [], list: 'fupList', draft: 'fupDraftBtn', send: 'fupSendBtn', stop: 'fupStopBtn', status: 'fupStatus', noun: 'follow-up' },
};
let activeBox = null;

function setLine(id, msg, kind) {
  const el = $(id);
  el.textContent = msg;
  el.className = 'status' + (kind ? ' ' + kind : '');
}
const setStatus = (msg, kind) => setLine('status', msg, kind);
function log(msg) {
  const t = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  $('log').textContent += `${t}  ${msg}\n`;
  $('log').scrollTop = $('log').scrollHeight;
}
function updateBadge() {
  const on = !!settings.connUrl;
  $('sheetBadge').textContent = on ? 'Google Sheet: connected' : 'Google Sheet: not connected';
  $('sheetBadge').classList.toggle('on', on);
  $('otherPc').hidden = !settings.connectionCode;
  $('pipeBtn').disabled = !on;
}
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

// ---------- country and city ----------
const COUNTRIES = { US: 'United States', GB: 'United Kingdom', CA: 'Canada', AU: 'Australia', NZ: 'New Zealand', IE: 'Ireland' };
const SPACE_REGION = { US: true, CA: true, AU: true }; // "Columbus OH", "Toronto ON", "Perth WA"; others "Leeds, England"
const COUNTRY_NOTES = {
  GB: 'UK rules (PECR): cold email to companies (Ltd, LLP, PLC) is allowed if you say who you are and give a way to opt out. Sole traders and partnerships count as individuals and need consent first, so skip one-person businesses.',
  IE: 'Ireland rules (ePrivacy Regulations): cold email to companies is allowed with your identity and an opt-out. Sole traders count as individuals and need consent first.',
  CA: 'Canada rules (CASL): you normally need consent first, and fines are large. The usual exception: the business publishes the address on its own site, your message is about their business, and the site does not say it refuses unsolicited email. Prefer drafts and check each site.',
  AU: 'Australia rules (Spam Act): you need consent. An address published on the business\'s own site counts only when your message is relevant to their business and the site does not say it refuses unsolicited email. Prefer drafts and check each site.',
  NZ: 'New Zealand rules (Unsolicited Electronic Messages Act): same idea as Australia. An address published on the site is enough only for messages relevant to their business, unless the site says no unsolicited email.',
};
const fold = (s) => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[,.]/g, ' ').replace(/\s+/g, ' ').trim();
const cityCache = {};
function citiesOf(cc) {
  if (cityCache[cc]) return cityCache[cc];
  const raw = (window.CITY_DATA && window.CITY_DATA[cc]) || '';
  cityCache[cc] = raw ? raw.split('\n').map((line) => {
    const [name, region] = line.split('|');
    const label = region ? (SPACE_REGION[cc] ? `${name} ${region}` : `${name}, ${region}`) : name;
    return { name, region: region || '', label, key: fold(label) };
  }) : [];
  return cityCache[cc];
}
function cityMatches(cc, text, max = 12) {
  const q = fold(text);
  if (!q) return [];
  const list = citiesOf(cc);
  const out = [];
  const seen = new Set();
  const pass = (test) => {
    for (const c of list) {
      if (out.length >= max) return;
      if (!seen.has(c) && test(c)) { seen.add(c); out.push(c); }
    }
  };
  pass((c) => c.key.startsWith(q)); // largest cities first
  pass((c) => c.key.includes(' ' + q));
  return out;
}
/** What goes into the Google Maps search and the sheet: "Columbus OH" in the US, "Leeds, England, United Kingdom" elsewhere. */
function searchCity() {
  const cc = $('country').value;
  const city = $('city').value.trim().replace(/,\s*$/, '');
  const name = COUNTRIES[cc];
  if (cc === 'US' || !city || fold(city).endsWith(fold(name))) return city;
  return `${city}, ${name}`;
}
function countryOfContext(context) {
  const c = fold(context);
  for (const [cc, name] of Object.entries(COUNTRIES)) if (cc !== 'US' && c.endsWith(fold(name))) return cc;
  return 'US';
}
function showCountryNote() {
  const note = COUNTRY_NOTES[$('country').value];
  $('countryNote').hidden = !note;
  $('countryNote').textContent = note ? note + ' The website checks are written for English-language sites.' : '';
}

let comboItems = [];
let comboActive = -1;
function comboClose() {
  $('cityList').hidden = true;
  $('city').setAttribute('aria-expanded', 'false');
  $('city').removeAttribute('aria-activedescendant');
  comboActive = -1;
}
function comboPick(i) {
  const c = comboItems[i];
  if (!c) return;
  $('city').value = c.label;
  comboClose();
}
function comboMark(i) {
  comboActive = i;
  [...$('cityList').children].forEach((li, j) => li.setAttribute('aria-selected', String(j === i)));
  const li = $('cityList').children[i];
  if (li) {
    $('city').setAttribute('aria-activedescendant', li.id);
    li.scrollIntoView({ block: 'nearest' });
  }
}
function comboRender() {
  comboItems = cityMatches($('country').value, $('city').value);
  const ul = $('cityList');
  ul.textContent = '';
  comboActive = -1;
  if (!comboItems.length) return comboClose();
  comboItems.forEach((c, i) => {
    const li = document.createElement('li');
    li.id = `city-opt-${i}`;
    li.setAttribute('role', 'option');
    li.setAttribute('aria-selected', 'false');
    li.textContent = c.name;
    if (c.region) {
      const s = document.createElement('span');
      s.textContent = SPACE_REGION[$('country').value] ? ` ${c.region}` : `, ${c.region}`;
      li.appendChild(s);
    }
    li.addEventListener('mousedown', (ev) => { ev.preventDefault(); comboPick(i); });
    ul.appendChild(li);
  });
  ul.hidden = false;
  $('city').setAttribute('aria-expanded', 'true');
}
$('city').addEventListener('input', comboRender);
$('city').addEventListener('focus', () => { if ($('city').value.trim()) comboRender(); });
$('city').addEventListener('blur', () => setTimeout(comboClose, 120));
$('city').addEventListener('keydown', (ev) => {
  const open = !$('cityList').hidden;
  if (ev.key === 'ArrowDown') {
    ev.preventDefault();
    if (!open) comboRender();
    if (comboItems.length) comboMark(Math.min(comboActive + 1, comboItems.length - 1));
  } else if (ev.key === 'ArrowUp' && open) {
    ev.preventDefault();
    comboMark(Math.max(comboActive - 1, 0));
  } else if (ev.key === 'Enter' && open && comboActive > -1) {
    ev.preventDefault(); // pick the city, do not start the run yet
    comboPick(comboActive);
  } else if (ev.key === 'Escape' && open) {
    ev.preventDefault();
    comboClose();
  }
});
$('country').addEventListener('change', () => {
  $('city').value = '';
  comboClose();
  showCountryNote();
  $('city').focus();
});

// ---------- results table ----------
function cell(text, cls) {
  const td = document.createElement('td');
  if (cls) td.className = cls;
  td.textContent = text || '';
  return td;
}
function yesNo(v) {
  const td = document.createElement('td');
  if (v) {
    const s = document.createElement('span');
    s.className = v === 'yes' ? 'yes' : 'no';
    s.textContent = v;
    td.appendChild(s);
  }
  return td;
}
/** One short line per phone-side problem, for the results table. */
function phoneMobileCell(r) {
  const td = document.createElement('td');
  td.className = 'pm';
  if (!r.audited) return td;
  const bad = [];
  if (r.phone && r.phone.state === 'different') bad.push(`Phone differs from Google (${r.phone.google})`);
  if (r.phone && r.phone.state === 'several') bad.push('Several numbers, none is Google\'s');
  if (r.mobile && !r.mobile.ok) bad.push(r.mobile.reason === 'no-mobile-layout' ? 'No mobile layout' : 'Too wide for phones');
  if (r.tap && !r.tap.ok) bad.push('No tap-to-call');
  if (!bad.length) {
    td.textContent = r.mobile || r.tap || r.phone ? 'fine' : 'not checked';
    td.classList.add('muted');
    return td;
  }
  for (const b of bad) {
    const s = document.createElement('span');
    s.className = 'no';
    s.textContent = b;
    td.appendChild(s);
  }
  return td;
}

function addRow(r) {
  const tr = document.createElement('tr');
  tr.appendChild(cell('', 'sn'));
  const name = cell(r.name, 'name');
  if (/^https?:/.test(r.website)) {
    const a = document.createElement('a');
    a.textContent = r.website.replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, '');
    a.title = 'Open in your browser';
    a.tabIndex = 0;
    a.addEventListener('click', () => window.api.open(r.website.replace(/^http:/, 'https:')));
    name.appendChild(a);
  } else {
    const s = document.createElement('span');
    s.className = 'muted';
    s.textContent = ' (' + r.website + ')';
    name.appendChild(s);
  }
  if (r.rating) {
    const s = document.createElement('span');
    s.className = 'muted sub';
    s.textContent = `${r.rating} stars, ${r.reviews} reviews`;
    name.appendChild(s);
  }
  tr.appendChild(name);
  tr.appendChild(yesNo(r.faq));
  tr.appendChild(yesNo(r.service));
  tr.appendChild(yesNo(r.schema));
  const res = document.createElement('td');
  if (r.audited) {
    const p = document.createElement('span');
    p.className = 'pill ' + (r.fails >= 2 ? 'weak' : 'ok');
    p.textContent = r.weak;
    res.appendChild(p);
  } else {
    res.textContent = 'not scored';
    res.className = 'muted';
  }
  tr.appendChild(res);
  const pr = cell(r.priority ? r.priority.replace(/\s*\(\d+\)/, '') : '', 'prio ' + (r.priority || '').split(' ')[0].toLowerCase());
  if (r.priorityWhy) pr.title = r.priorityWhy;
  tr.appendChild(pr);
  tr.appendChild(phoneMobileCell(r));
  tr.appendChild(cell(r.schemaDetail, 'detail'));
  tr.appendChild(cell(r.agency));
  tr.appendChild(cell([r.ownerName, r.email].filter(Boolean).join(' · ')));
  tr.appendChild(cell(r.other));
  $('rows').appendChild(tr);
}

function setRunning(on) {
  $('runBtn').disabled = on;
  $('stopBtn').hidden = !on;
  $('stopBtn').disabled = false;
  for (const id of ['niche', 'country', 'city', 'count', 'skipTop', 'showBrowser']) $(id).disabled = on;
}

window.api.onEvent((ev) => {
  if (ev.type === 'status') setStatus(ev.msg, 'busy');
  if (ev.type === 'log') log(ev.msg);
  if (ev.type === 'row') {
    $('resultCard').hidden = false;
    addRow(ev.row);
  }
  if (ev.type === 'attention') {
    $('attention').textContent = ev.msg;
    $('attention').hidden = false;
    log(ev.msg);
  }
  if (ev.type === 'maps') $('attention').hidden = true;
});

function showResult(out, niche, city) {
  const r = out.result;
  lastRun = { rows: r.rows, sheetRows: out.sheetRows || [], niche, city };
  $('resultCard').hidden = false;
  $('score').textContent = r.auditedCount ? `Weak sites: ${r.weakCount} of ${r.auditedCount}` : 'No sites could be scored';
  let saved;
  $('copyRows').hidden = true;
  if (out.sheet && out.sheet.ok) {
    const ids = (out.sheet.ids || []).filter((x) => x !== '' && x != null);
    // Show each business's serial number in the first column, in the same order as the sheet rows.
    [...$('rows').children].forEach((tr, i) => { if (out.sheet.ids && out.sheet.ids[i] != null) tr.firstChild.textContent = out.sheet.ids[i]; });
    saved = `Added to your Google Sheet, tab "${out.tab}"${ids.length ? `, serial numbers ${ids[0]} to ${ids[ids.length - 1]}` : ''}.`;
    sheetUrl = out.sheet.url;
    $('openSheet').hidden = false;
  } else {
    saved = out.sheet
      ? `Could not write to the Google Sheet (${out.sheet.error})`
      : 'Google Sheet not connected yet, so nothing was saved.';
    saved += ' Use "Copy rows" and paste into the sheet before closing the app.';
    $('copyRows').hidden = false;
  }
  $('savedNote').textContent = saved;
  return saved;
}

$('runForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const niche = $('niche').value.trim();
  const city = searchCity();
  comboClose();
  if (!niche || !city) return;
  $('rows').textContent = '';
  $('score').textContent = '';
  $('savedNote').textContent = '';
  $('openSheet').hidden = true;
  $('copyRows').hidden = true;
  $('attention').hidden = true;
  $('emailCard').hidden = true;
  $('resultTitle').textContent = `${niche} in ${city}`;
  setRunning(true);
  setStatus('Starting', 'busy');
  log(`--- Run: ${niche} in ${city} ---`);

  const out = await window.api.start({
    niche, city,
    country: $('country').value,
    cityInput: $('city').value.trim(),
    count: Number($('count').value),
    skipTop: Number($('skipTop').value),
    showBrowser: $('showBrowser').checked,
  });
  setRunning(false);
  $('attention').hidden = true;

  if (!out.ok) {
    setStatus(out.error || 'Something went wrong.', out.stopped ? '' : 'error');
    log(out.error || 'failed');
    return;
  }
  const saved = showResult(out, niche, city);
  const r = out.result;
  const extra = [];
  if (r.notes.chains.length) extra.push(`skipped from your skip list: ${r.notes.chains.join(', ')}`);
  if (r.notes.already.length) extra.push(`already in the sheet: ${r.notes.already.join(', ')}`);
  if (extra.length) log(extra.join(' | '));
  const next = await showEmails();
  setStatus(`Done. ${$('score').textContent}. ${saved} ${next}`);
});

$('stopBtn').addEventListener('click', async () => {
  $('stopBtn').disabled = true;
  setStatus('Stopping after the current page', 'busy');
  await window.api.stop();
});
$('copyRows').addEventListener('click', async () => {
  if (!lastRun) return;
  const tsv = lastRun.sheetRows.map((r) => r.map((c) => String(c).replace(/[\t\n]/g, ' ')).join('\t')).join('\n');
  await window.api.copy(tsv);
  $('copyRows').textContent = 'Copied. Click a cell in column A of the sheet and paste';
});

// ---------- message lists (first emails and follow-ups) ----------
function addMailItem(box, it) {
  const el = document.createElement('details');
  el.className = 'mail' + (it.blocked ? ' off' : '');
  const sum = document.createElement('summary');
  const check = document.createElement('input');
  check.type = 'checkbox';
  check.checked = !it.blocked;
  check.disabled = !!it.blocked;
  check.setAttribute('aria-label', `Include ${it.name}`);
  check.addEventListener('click', (ev) => ev.stopPropagation());
  check.addEventListener('change', () => updateButtons(box));
  const title = document.createElement('span');
  title.textContent = it.name;
  const to = document.createElement('span');
  to.className = 'to';
  to.textContent = it.label;
  const edit = document.createElement('span');
  edit.className = 'edit';
  edit.textContent = 'read / edit';
  const state = document.createElement('span');
  state.className = 'state' + (it.blocked ? (it.waiting ? ' waiting' : ' skipped') : '');
  state.textContent = it.blocked || '';
  sum.append(check, title, to);
  if (it.from) {
    const from = document.createElement('span');
    from.className = 'from';
    from.textContent = it.from;
    sum.append(from);
  }
  if (it.tag) {
    const tag = document.createElement('span');
    tag.className = 'tag ' + it.tag.toLowerCase();
    tag.textContent = it.tag;
    if (it.tagWhy) tag.title = it.tagWhy;
    sum.append(tag);
  }
  sum.append(edit, state);
  const fields = document.createElement('div');
  fields.className = 'fields';
  let subj = null;
  if (it.subject != null) {
    subj = document.createElement('input');
    subj.value = it.subject;
    subj.setAttribute('aria-label', 'Subject');
    fields.append(subj);
  }
  const body = document.createElement('textarea');
  body.rows = it.subject != null ? 12 : 7;
  body.value = it.text;
  body.setAttribute('aria-label', 'Message');
  fields.append(body);
  el.append(sum, fields);
  $(box.list).appendChild(el);
  box.items.push({ name: it.name, to: it.to, context: it.context, el, subjectEl: subj, bodyEl: body, checkEl: check, stateEl: state, done: !!it.blocked });
}
const selected = (box) => box.items.filter((m) => !m.done && m.checkEl.checked);
function updateButtons(box) {
  const n = selected(box).length;
  const off = n === 0 || !settings.connUrl;
  $(box.draft).disabled = off;
  $(box.send).disabled = off;
  $(box.draft).textContent = n ? `Create ${plural(n, box.type === 'first' ? 'Gmail draft' : 'follow-up draft')}` : (box.type === 'first' ? 'Create Gmail drafts' : 'Create follow-up drafts');
  $(box.send).textContent = n ? `Send ${n} now` : 'Send now';
}
function counterText(sentToday, s) {
  return `Sent today: ${sentToday} of ${Math.min(settings.dailyCap, s.hardCap || settings.hardCap)}${s.sender ? '  |  from ' + s.sender : ''}`;
}

let lastHidden = 0; // businesses left out of the list because they were already emailed or drafted
async function showEmails(opts = {}) {
  const box = boxes.first;
  box.items = [];
  lastHidden = 0;
  $(box.list).textContent = '';
  setLine(box.status, '');
  if (!lastRun) return '';
  const built = await window.api.buildEmails(lastRun.rows, { niche: lastRun.niche, city: lastRun.city });
  if (!built.length) {
    $('emailCard').hidden = true;
    return 'Next step: no weak sites in this batch, so try another city or niche.';
  }
  const withEmail = built.filter((b) => b.email);
  const without = built.filter((b) => !b.email).map((b) => b.name);
  $('emailCard').hidden = false;

  let status = null;
  if (settings.connUrl) {
    const s = await window.api.emailStatus();
    if (s.ok) status = s;
  }
  const contacted = new Set(status ? status.contacted : []);
  const drafted = new Set(status && status.drafted ? status.drafted : []);
  const dnc = new Set(status ? status.doNotContact : []);
  const countries = new Set();
  for (const b of withEmail) {
    const m = b.email;
    const waiting = drafted.has(m.to);
    const blocked = dnc.has(m.to) || dnc.has(m.to.split('@')[1]) ? 'do not contact'
      : waiting ? 'draft waiting in Gmail Drafts' : contacted.has(m.to) ? 'already emailed' : '';
    if (blocked && opts.hideContacted) { lastHidden++; continue; }
    countries.add(countryOfContext(b.context));
    addMailItem(box, { name: b.name, to: m.to, label: `${m.to} (${m.kind})`, subject: m.subject, text: m.text, context: b.context, blocked, waiting,
      from: b.tab ? `from ${b.tab}` : '', tag: (b.priority || '').split(' ')[0], tagWhy: b.priorityWhy });
  }
  if (box.items.length && !box.items[0].done) box.items[0].el.open = true;

  const shown = box.items.length;
  const parts = [];
  parts.push(shown
    ? `${plural(shown, 'weak site')} with a published email address, best prospects first. Read each message, edit if you like, then create drafts or send.`
    : withEmail.length ? 'Every weak site here has already been emailed or has a draft waiting.' : 'None of the weak sites publish an email address.');
  if (drafted.size && box.items.some((m) => drafted.has(m.to))) {
    parts.push('"Draft waiting" means the email is already in your Gmail Drafts: send it from Gmail whenever you are ready, and the app will notice.');
  }
  for (const cc of countries) if (COUNTRY_NOTES[cc]) parts.push(COUNTRY_NOTES[cc]);
  if (without.length) parts.push(`No email found for: ${without.join(', ')}. Use their contact form or phone instead.`);
  if (!settings.connUrl) parts.push('Connect your Google Sheet first; emails go out through that same connection.');
  $('emailIntro').textContent = parts.join(' ');
  $('emailCounter').textContent = status ? counterText(status.sentToday, status) : '';
  updateButtons(box);
  return shown
    ? 'Next step: review the emails below.'
    : withEmail.length ? 'Next step: nothing new to email here.'
    : 'Next step: these weak sites have no email, so reach them through their contact form.';
}

window.api.onEmailEvent((ev) => {
  const box = activeBox || boxes.first;
  if (ev.type === 'wait') {
    const m = Math.floor(ev.seconds / 60);
    const s = String(ev.seconds % 60).padStart(2, '0');
    setLine(box.status, `Waiting ${m}:${s} before ${box.noun} ${ev.index + 1} of ${ev.total} (spacing them out keeps you out of spam)`, 'busy');
  }
  if (ev.type === 'working') setLine(box.status, `${box.noun} ${ev.index + 1} of ${ev.total}: ${ev.to}`, 'busy');
  if (ev.type === 'done') {
    const m = box.items.find((x) => x.to === ev.to && !x.done);
    if (m) {
      m.done = ev.status !== 'failed';
      m.stateEl.className = 'state ' + ev.status.replace(/^follow-up /, '');
      m.stateEl.textContent = ev.status + (ev.reason ? `: ${ev.reason}` : '');
      if (m.done) {
        m.checkEl.checked = false;
        m.checkEl.disabled = true;
        m.el.open = false;
      }
    }
    log(`${box.noun} to ${ev.to}: ${ev.status}${ev.reason ? ' (' + ev.reason + ')' : ''}`);
  }
  if (ev.type === 'limit') log(ev.msg);
});

async function runBox(box, mode) {
  const list = selected(box);
  if (!list.length) return;
  if (!$('senderName').value.trim() || !$('senderAddress').value.trim()) {
    $('emailSettings').open = true;
    $('emailSettings').scrollIntoView({ behavior: 'smooth' });
    setLine(box.status, 'Fill in your name and postal address under "Email settings and template" first. Anti-spam laws (US CAN-SPAM, UK PECR, Canada CASL and others) require you to say who you are and where.', 'error');
    return;
  }
  const abroad = [...new Set(list.map((m) => countryOfContext(m.context || '')))].filter((cc) => COUNTRY_NOTES[cc]);
  if (list.some((m) => /\{\{|\}\}/.test((m.subjectEl ? m.subjectEl.value : '') + m.bodyEl.value))) {
    setLine(box.status, 'One of the messages still contains a {{placeholder}}. Fix it before sending.', 'error');
    return;
  }
  if (mode === 'send') {
    const mins = Math.round(((list.length - 1) * (settings.gap[0] + settings.gap[1])) / 2 / 60);
    const rules = abroad.map((cc) => `\n\n${COUNTRY_NOTES[cc]}`).join('');
    const ok = window.confirm(`Send ${plural(list.length, box.noun)} from your Gmail now?\n\nThey go out one at a time with a pause between them, about ${plural(mins, 'minute')} in total. Keep this window open.${rules}${abroad.length ? '\n\nIf you are unsure about any of them, press Cancel and create drafts instead.' : ''}\n\nThis cannot be undone.`);
    if (!ok) return;
  }
  activeBox = box;
  $(box.draft).disabled = true;
  $(box.send).disabled = true;
  $(box.stop).hidden = mode !== 'send';
  setLine(box.status, mode === 'send' ? 'Sending' : 'Creating drafts', 'busy');
  const out = await window.api.runEmails({
    mode,
    context: lastRun ? `${lastRun.niche}, ${lastRun.city}` : '',
    items: list.map((m) => ({ type: box.type, to: m.to, business: m.name, context: m.context, subject: m.subjectEl ? m.subjectEl.value.trim() : '', text: m.bodyEl.value.trim() })),
  });
  $(box.stop).hidden = true;
  if (!out.ok) {
    setLine(box.status, out.error, 'error');
    updateButtons(box);
    return;
  }
  const count = (re) => out.done.filter((d) => re.test(d.status)).length;
  const bits = [];
  if (count(/sent$/)) bits.push(`${count(/sent$/)} sent`);
  if (count(/drafted$/)) bits.push(`${plural(count(/drafted$/), 'draft')} created (open Gmail > Drafts to review and send them; send no more than your daily limit of ${settings.dailyCap || 10} a day, a few minutes apart, not all at once)`);
  if (count(/^skipped$/)) bits.push(`${count(/^skipped$/)} skipped`);
  if (count(/^failed$/)) bits.push(`${count(/^failed$/)} failed`);
  if (out.limit) bits.push(out.limit);
  if (out.stopped) bits.push('stopped by you');
  setLine(box.status, (bits.join('; ') || 'Nothing was sent') + '. Recorded in the "Email Log" tab and in each business\'s Status.', count(/^failed$/) ? 'error' : '');
  const s = await window.api.emailStatus();
  if (s.ok) $('emailCounter').textContent = counterText(s.sentToday, s);
  updateButtons(box);
}
for (const box of Object.values(boxes)) {
  $(box.draft).addEventListener('click', () => runBox(box, 'draft'));
  $(box.send).addEventListener('click', () => runBox(box, 'send'));
  $(box.stop).addEventListener('click', async () => {
    $(box.stop).hidden = true;
    setLine(box.status, 'Stopping. No more emails will go out.', 'busy');
    await window.api.stopEmails();
  });
}

// ---------- replies, follow-ups, scorecard ----------
function showPipeline(p) {
  const bits = [];
  if (p.replies.length) bits.push(plural(p.replies.length, 'new reply').replace('replys', 'replies'));
  if (p.followUps.length) bits.push(`${plural(p.followUps.length, 'follow-up')} due`);
  if (p.optOuts.length) bits.push(`${p.optOuts.length} said no thanks (${p.optOuts.join(', ')}), added to Do Not Contact`);
  if (p.bounces.length) bits.push(`${p.bounces.length} bounced (${p.bounces.join(', ')}), added to Do Not Contact`);
  if (p.nowSent.length) bits.push(`${plural(p.nowSent.length, 'draft')} you sent from Gmail now marked as sent`);
  if (p.draftsDeleted && p.draftsDeleted.length) bits.push(`${plural(p.draftsDeleted.length, 'draft')} you deleted in Gmail (${p.draftsDeleted.join(', ')}), so ${p.draftsDeleted.length === 1 ? 'that business is' : 'those businesses are'} free to email again`);
  if (p.waitingDrafts) bits.push(`${plural(p.waitingDrafts, 'draft')} still waiting in Gmail Drafts for you to send`);
  if (p.autoReplies && p.autoReplies.length) bits.push(`${p.autoReplies.length} sent only an automatic reply such as out-of-office (${p.autoReplies.join(', ')}); not counted as an answer, so their follow-up still comes`);
  $('pipeMsg').textContent = (bits.length ? bits.join('. ') + '.' : 'Nothing new: no replies yet and no follow-ups due.')
    + (p.partial ? ' Only the most recent emails were checked this time; press the button again to check the rest.' : '');

  $('replyList').textContent = '';
  $('replyBox').hidden = !p.replies.length;
  for (const r of p.replies) {
    const el = document.createElement('div');
    el.className = 'reply';
    const head = document.createElement('b');
    head.textContent = r.business;
    const quote = document.createElement('p');
    quote.textContent = `"${r.snippet}"`;
    const note = document.createElement('p');
    note.className = r.drafted ? 'yes' : 'no';
    note.textContent = r.drafted
      ? 'A reply with their audit summary and your offer is in Gmail > Drafts. Read it, adjust it, and send it today.'
      : r.note;
    el.append(head, quote, note);
    $('replyList').appendChild(el);
  }

  const box = boxes.followup;
  box.items = [];
  $(box.list).textContent = '';
  $('fupBox').hidden = !p.followUps.length;
  $('fupTitle').textContent = `Follow-ups due (${p.followUps.length})`;
  for (const f of p.followUps) addMailItem(box, { name: f.business, to: f.to, label: `${f.to}, emailed ${f.sentOn}`, subject: null, text: f.text, context: f.context });
  setLine(box.status, '');
  updateButtons(box);

  const sc = p.scorecard;
  if (sc && sc.ok) {
    scoreUrl = sc.url;
    $('scoreLine').hidden = false;
    $('scoreLine').textContent = '';
    const stat = (label, value) => {
      const d = document.createElement('div');
      const v = document.createElement('b');
      v.textContent = value;
      const l = document.createElement('span');
      l.textContent = label;
      d.append(v, l);
      $('scoreLine').appendChild(d);
    };
    stat('sites checked', sc.checked);
    stat('weak', sc.weak);
    stat('emailed', sc.emailed);
    stat('replied', sc.replied);
    stat('reply rate', sc.replyRate);
    stat('calls booked', sc.calls);
    stat('won', sc.won);
    $('pipeActions').hidden = false;
  }
  if (typeof p.sentToday === 'number' && $('emailCounter').textContent) $('emailCounter').textContent = counterText(p.sentToday, {});
}
async function checkPipeline(quiet) {
  if (!settings.connUrl) return;
  $('pipeBtn').disabled = true;
  if (!quiet) $('pipeMsg').textContent = 'Checking your Gmail and updating the sheet';
  const p = await window.api.checkPipeline();
  $('pipeBtn').disabled = false;
  if (!p.ok) {
    $('pipeMsg').textContent = p.error;
    return;
  }
  showPipeline(p);
  log(`Checked ${p.checked} open conversations: ${$('pipeMsg').textContent}`);
}
$('pipeBtn').addEventListener('click', () => checkPipeline(false));
$('openScore').addEventListener('click', () => scoreUrl && window.api.open(scoreUrl));

// ---------- load weak sites back from the sheet ----------
const isoDay = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
function fillDays(tabs) {
  const sel = $('loadTab');
  const keep = sel.value;
  sel.textContent = '';
  if (!tabs.length) sel.appendChild(new Option('No date tabs yet', ''));
  for (const t of tabs) sel.appendChild(new Option(t, t)); // newest first
  if (tabs.includes(keep)) sel.value = keep;
}
async function syncLoadInputs() {
  const v = $('loadRange').value;
  $('loadDayWrap').hidden = v !== 'day';
  $('loadFromWrap').hidden = v !== 'custom';
  $('loadToWrap').hidden = v !== 'custom';
  if (v === 'day' && !$('loadTab').value && settings.connUrl) {
    const r = await window.api.loadWeak({ range: 'list' });
    if (r.ok) fillDays(r.tabs);
  }
}
$('loadRange').addEventListener('change', syncLoadInputs);

$('loadBtn').addEventListener('click', async () => {
  if (!settings.connUrl) {
    $('loadMsg').textContent = 'Connect your Google Sheet first.';
    $('sheetCard').open = true;
    return;
  }
  const range = $('loadRange').value;
  if (range === 'custom' && (!$('loadFrom').value || !$('loadTo').value)) {
    $('loadMsg').textContent = 'Pick both a From and a To date.';
    return;
  }
  $('loadBtn').disabled = true;
  $('loadMsg').textContent = 'Reading your sheet';
  const r = await window.api.loadWeak({ range, day: $('loadTab').value, from: $('loadFrom').value, to: $('loadTo').value });
  $('loadBtn').disabled = false;
  if (!r.ok) {
    $('loadMsg').textContent = r.error;
    return;
  }
  fillDays(r.tabs);
  const label = $('loadRange').selectedOptions[0].textContent.toLowerCase().replace(/\s*\(.*\)/, '');
  if (!r.tabs.length) {
    $('loadMsg').textContent = 'No date tabs in the sheet yet. Do a run first.';
    return;
  }
  if (!r.picked.length) {
    $('loadMsg').textContent = `Your sheet has no runs for ${range === 'custom' ? 'those dates' : label}. Pick another period.`;
    return;
  }
  const days = r.picked.length === 1 ? `"${r.picked[0]}"` : `${r.picked.length} days (${r.picked[r.picked.length - 1]} to ${r.picked[0]})`;
  if (!r.rows.length) {
    $('loadMsg').textContent = `No WEAK rows in ${days}.`;
    return;
  }
  lastRun = { rows: r.rows, sheetRows: [], niche: '', city: '' };
  await showEmails({ hideContacted: $('hideContacted').checked });
  const hidden = lastHidden ? ` ${plural(lastHidden, 'business')} already emailed or with a draft waiting ${lastHidden === 1 ? 'is' : 'are'} hidden; untick the box to see them.`.replace('businesss', 'businesses') : '';
  $('loadMsg').textContent = `Loaded ${plural(r.rows.length, 'weak site')} from ${days}.${hidden}`;
  $('emailCard').scrollIntoView({ behavior: 'smooth' });
});

// ---------- audit report on demand ----------
let reportItem = null; // { name, email, report, reply, ... } of the report on screen
let reportView = 'reply';
function showReportView(view) {
  if (!reportItem) return;
  // Keep any edits made in the box for the view being left.
  reportItem[reportView] = $('reportText').value;
  reportView = view;
  $('reportText').value = reportItem[view];
  $('reportTabReply').classList.toggle('on', view === 'reply');
  $('reportTabReport').classList.toggle('on', view === 'report');
  $('reportTabReply').setAttribute('aria-selected', String(view === 'reply'));
  $('reportTabReport').setAttribute('aria-selected', String(view === 'report'));
  $('reportStatus').textContent = '';
}
function openReport(m) {
  reportItem = { ...m };
  reportView = 'reply';
  $('reportPick').hidden = true;
  $('reportOut').hidden = false;
  $('reportTitle').textContent = `#${m.id || '?'} ${m.name}`;
  const bits = [m.website.replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, ''), m.context, m.tab, m.email || 'no email found'];
  if (m.logStatus || m.status) bits.push(`status: ${m.logStatus || m.status}`);
  $('reportMeta').textContent = bits.filter(Boolean).join('  |  ');
  $('reportText').value = m.reply;
  $('reportTabReply').classList.add('on');
  $('reportTabReport').classList.remove('on');
  const canDraft = !!m.email && /replied|call booked|won|lost|not interested/.test(m.logStatus || m.status || '');
  $('reportDraft').disabled = !canDraft || !settings.connUrl;
  $('reportDraft').title = canDraft ? '' : 'Available once they have replied to your email';
  $('reportStatus').textContent = '';
  $('reportMsg').textContent = '';
}
async function findReport() {
  const q = $('reportQuery').value.trim();
  if (!q) return;
  if (!settings.connUrl) {
    $('reportMsg').textContent = 'Connect your Google Sheet first.';
    $('sheetCard').open = true;
    return;
  }
  $('reportBtn').disabled = true;
  $('reportMsg').textContent = 'Looking it up in your sheet';
  $('reportOut').hidden = true;
  $('reportPick').hidden = true;
  const r = await window.api.findReport(q);
  $('reportBtn').disabled = false;
  if (!r.ok) {
    $('reportMsg').textContent = r.error;
    return;
  }
  if (!r.matches.length) {
    $('reportMsg').textContent = `Nothing in your sheet matches "${q}". Check the number in the # column, or try the website or part of the name.`;
    return;
  }
  if (r.matches.length === 1) return openReport(r.matches[0]);
  $('reportMsg').textContent = `${r.total} businesses match. Pick one:`;
  const box = $('reportPick');
  box.textContent = '';
  for (const m of r.matches) {
    const b = document.createElement('button');
    b.type = 'button';
    const strong = document.createElement('b');
    strong.textContent = `#${m.id} ${m.name}`;
    b.append(strong, document.createTextNode(`  ${m.context || ''}  ${m.tab || ''}  ${m.weak || ''}`));
    b.addEventListener('click', () => openReport(m));
    box.appendChild(b);
  }
  box.hidden = false;
}
$('reportBtn').addEventListener('click', findReport);
$('reportQuery').addEventListener('keydown', (ev) => { if (ev.key === 'Enter') { ev.preventDefault(); findReport(); } });
$('reportTabReply').addEventListener('click', () => showReportView('reply'));
$('reportTabReport').addEventListener('click', () => showReportView('report'));
$('reportCopy').addEventListener('click', async () => {
  await window.api.copy($('reportText').value);
  $('reportStatus').textContent = 'Copied.';
});
$('reportDraft').addEventListener('click', async () => {
  if (!reportItem) return;
  if (!settings.senderName) {
    $('reportStatus').textContent = 'Fill in your name under "Email settings and template" first.';
    return;
  }
  reportItem[reportView] = $('reportText').value;
  $('reportDraft').disabled = true;
  $('reportStatus').textContent = 'Creating the draft';
  const r = await window.api.draftReport({ to: reportItem.email, text: reportItem.reply });
  $('reportDraft').disabled = false;
  $('reportStatus').textContent = r.ok ? 'Draft created: open Gmail > Drafts, read it once more and send.' : r.error;
});

// ---------- connection + settings ----------
$('sheetBadge').addEventListener('click', () => {
  $('sheetCard').open = true;
  $('sheetCard').scrollIntoView({ behavior: 'smooth' });
});
$('copyScript').addEventListener('click', async () => {
  await window.api.copy(settings.appsScript);
  $('copyScript').textContent = 'Copied. Now paste it into Apps Script';
});
$('copyConn').addEventListener('click', async () => {
  await window.api.copy(settings.connectionCode);
  $('copyConn').textContent = 'Copied';
});
$('testSheet').addEventListener('click', async () => {
  const input = $('webhook').value.trim();
  $('sheetMsg').textContent = 'Checking the connection';
  const r = await window.api.testSheet(input);
  if (r.ok) {
    settings = { ...settings, ...(await window.api.getSettings()) };
    sheetUrl = r.url;
    $('webhook').value = settings.connUrl;
    $('sheetMsg').textContent = `Connected to "${r.name}".`;
  } else {
    $('sheetMsg').textContent = r.error;
  }
  updateBadge();
  Object.values(boxes).forEach(updateButtons);
  if (r.ok) checkPipeline(true);
});
$('openSheet').addEventListener('click', () => sheetUrl && window.api.open(sheetUrl));

const SAVED = ['skipNames', 'senderName', 'senderAddress', 'dailyCap', 'subject', 'body', 'followUpBody', 'replyBody',
  'offerName', 'offerIncludes', 'offerPrice', 'offerTimeline', 'offer2Name', 'offer2Includes', 'offer2Price', 'bookingLink'];
const REBUILD = ['senderName', 'senderAddress', 'subject', 'body'];
const untouched = () => !boxes.first.items.some((m) => m.done && /sent|drafted|failed/.test(m.stateEl.textContent));
for (const id of SAVED) {
  $(id).addEventListener('change', async () => {
    const value = id === 'dailyCap' ? Number($(id).value) : $(id).value;
    settings[id] = value;
    await window.api.saveSettings({ [id]: value });
    $('settingsSaved').textContent = 'Saved.';
    if (lastRun && REBUILD.includes(id) && untouched()) await showEmails();
  });
}
$('offersReady').addEventListener('change', async () => {
  settings.offersReady = $('offersReady').checked;
  await window.api.saveSettings({ offersReady: settings.offersReady });
  $('settingsSaved').textContent = settings.offersReady ? 'Saved. Replies now include your two offers.' : 'Saved. Replies show "[YOUR OFFER GOES HERE]" until you tick this again.';
});
$('resetTemplate').addEventListener('click', async () => {
  const d = settings.defaults;
  for (const k of Object.keys(d)) {
    $(k).value = d[k];
    settings[k] = d[k];
  }
  await window.api.saveSettings(d);
  $('settingsSaved').textContent = 'Original templates restored.';
  if (lastRun && untouched()) await showEmails();
});

// Development aid: show sample results without running.
window.api.onDemo(async (demo) => {
  $('resultTitle').textContent = `${demo.niche} in ${demo.city}`;
  demo.result.rows.forEach(addRow);
  showResult(demo, demo.niche, demo.city);
  await showEmails();
  if (demo.pipeline) showPipeline(demo.pipeline);
});

(async () => {
  settings = await window.api.getSettings();
  $('niche').value = settings.niche || '';
  $('country').value = COUNTRIES[settings.country] ? settings.country : 'US';
  $('city').value = settings.city || '';
  showCountryNote();
  const today = new Date();
  $('loadTo').value = isoDay(today);
  $('loadFrom').value = isoDay(new Date(today.getFullYear(), today.getMonth(), today.getDate() - 6));
  $('count').value = String(settings.count || 8);
  $('skipTop').value = String(settings.skipTop == null ? 3 : settings.skipTop);
  $('showBrowser').checked = settings.showBrowser !== false;
  $('webhook').value = settings.connUrl || '';
  $('dailyCap').value = String(settings.dailyCap || 10);
  for (const id of SAVED) if (id !== 'dailyCap') $(id).value = settings[id] || '';
  $('offersReady').checked = settings.offersReady === true;
  $('todayTab').textContent = settings.today;
  $('hardCap').textContent = settings.hardCap;
  $('gapText').textContent = `${settings.gap[0] / 60} to ${settings.gap[1] / 60}`;
  sheetUrl = settings.sheetUrl || '';
  if (!settings.connUrl) $('sheetCard').open = true;
  updateBadge();
  Object.values(boxes).forEach(updateButtons);
  checkPipeline(true); // on every start: any replies or follow-ups waiting?
})();
