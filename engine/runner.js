// The whole run: Google Maps -> skip the top results -> open each website -> judge -> rows.
// `browser` is { goto(url, settleMs) -> {ok, error}, evaluate(expr) -> value, url() -> string }.

const J = require('./judge');
const X = require('./extras');
const report = require('./report');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const NOT_A_SITE = /(^|\.)(facebook|instagram|yelp|linktr|google|business\.site|yellowpages|nextdoor|zocdoc|healthgrades|opencare|vagaro|booksy|squareup|square\.site|calendly|linkedin|twitter|x|tiktok|youtube|bbb|angi|thumbtack|homeadvisor|houzz|doctible|localmed)\.(com|org|ee|site|me)$/i;

const domainOf = (url) => {
  try {
    return new URL(url).hostname.replace(/^www\./, '').toLowerCase();
  } catch (e) {
    return '';
  }
};

// Drops tracking parameters (utm_source and friends) so the sheet shows the plain address.
const cleanUrl = (url) => {
  try {
    const u = new URL(url);
    for (const k of [...u.searchParams.keys()]) {
      if (/^(utm_|gclid|fbclid|y_source|gad_|ref$|source$|campaign$|medium$)/i.test(k)) u.searchParams.delete(k);
    }
    u.hash = '';
    return u.toString();
  } catch (e) {
    return url;
  }
};

class Stopped extends Error {}

async function run(browser, opts, emit, isStopped) {
  const { niche, city } = opts;
  const count = Math.min(10, Math.max(1, Number(opts.count) || 8));
  const skipTop = Math.max(0, Number(opts.skipTop == null ? 3 : opts.skipTop));
  const knownDomains = new Set((opts.knownDomains || []).map((d) => d.toLowerCase()));
  const skipNames = (opts.skipNames || '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
  const check = () => {
    if (isStopped()) throw new Stopped('stopped');
  };
  const log = (msg) => emit({ type: 'log', msg });

  // ---------- Google Maps ----------
  const query = `${niche} in ${city}`;
  log(`Searching Google Maps for "${query}"`);
  await browser.goto(`https://www.google.com/maps/search/${encodeURIComponent(query)}?hl=en`, 3000);
  let list = null;
  for (let attempt = 0; attempt < 60; attempt++) {
    check();
    const here = browser.url();
    if (/consent\.google/.test(here)) {
      await browser.evaluate(`(() => { const b = [...document.querySelectorAll('button, input[type=submit]')].find(x => /accept all|i agree/i.test(x.innerText || x.value || '')); if (b) b.click(); return !!b; })()`).catch(() => {});
      await sleep(4000);
      continue;
    }
    if (/\/sorry\//.test(here)) {
      if (attempt % 6 === 0) emit({ type: 'attention', msg: 'Google is asking for a quick "I am not a robot" check. Please complete it in the browser window; the run continues by itself.' });
      await sleep(5000);
      continue;
    }
    list = await browser.evaluate('window.__prospect.mapsList()').catch((e) => ({ error: String(e.message || e) }));
    if (list && list.listings && list.listings.length) break;
    await sleep(3000);
    if (attempt === 4) await browser.goto(`https://www.google.com/maps/search/${encodeURIComponent(query)}?hl=en`, 4000);
    if (attempt >= 9 && !/\/sorry\/|consent/.test(browser.url())) break;
  }
  if (!list || !list.listings || !list.listings.length) {
    throw new Error('Could not read the Google Maps results. Check the spelling of the niche and city, or try again in a minute.');
  }
  const listings = list.listings;
  const skipped = listings.slice(0, skipTop).map((l) => l.name);
  log(`Found ${listings.length} listings (${list.adsSkipped} ads ignored). Skipping the top ${skipTop}: ${skipped.join(', ')}`);
  emit({ type: 'maps', total: listings.length, skipped });

  const rows = [];
  const notes = { chains: [], already: [] };
  let audited = 0;
  const maxRank = Math.min(listings.length, skipTop + 25);

  for (let i = skipTop; i < maxRank && audited < count; i++) {
    check();
    const item = listings[i];
    if (skipNames.some((n) => item.name.toLowerCase().includes(n))) {
      notes.chains.push(item.name);
      log(`#${item.rank} ${item.name}: skipped (on your skip list)`);
      continue;
    }
    emit({ type: 'status', msg: `#${item.rank} ${item.name}: opening the Maps listing` });
    await browser.goto(item.placeUrl, 1500);
    const place = await browser.evaluate('window.__prospect.mapsPlace()').catch(() => null);
    const website = place && place.website ? cleanUrl(place.website) : null;
    const name = item.name;

    if (!website || NOT_A_SITE.test(domainOf(website))) {
      const row = blankRow(name, 'no website');
      if (website) row.other = `only link is ${domainOf(website)}`;
      rows.push(row);
      emit({ type: 'row', row });
      log(`#${item.rank} ${name}: no website`);
      continue;
    }
    const domain = domainOf(website);
    if (knownDomains.has(domain)) {
      notes.already.push(name);
      log(`#${item.rank} ${name}: already in your sheet, skipped`);
      continue;
    }
    knownDomains.add(domain);

    emit({ type: 'status', msg: `#${item.rank} ${name}: checking ${domain} (${audited + 1} of ${count})` });
    let row;
    try {
      row = await auditSite(browser, { name, website, niche, place }, check, (m) => emit({ type: 'status', msg: `#${item.rank} ${name}: ${m}` }));
    } catch (e) {
      if (e instanceof Stopped) throw e;
      row = blankRow(name, website);
      row.other = `could not check (${String(e.message || e).slice(0, 80)})`;
    }
    row.rating = item.rating || '';
    row.reviews = item.reviews || 0;
    if (row.audited && row.fails >= 2) {
      const p = J.priority(row);
      row.priority = `${p.label} (${p.score})`;
      row.priorityScore = p.score;
      row.priorityWhy = p.reasons.join(', ');
      row.summary = report.build(row, niche, city);
    }
    rows.push(row);
    emit({ type: 'row', row });
    if (row.audited) {
      audited++;
      log(`#${item.rank} ${name}: FAQ ${row.faq}, service pages ${row.service}, schema ${row.schema} -> ${row.weak} | mobile ${X.formatMobile(row.mobile) || '?'} | tap to call ${X.formatTap(row.tap) || '?'} | phone ${X.formatPhone(row.phone) || '?'}`);
    } else {
      log(`#${item.rank} ${name}: ${row.other}`);
    }
  }

  const auditedRows = rows.filter((r) => r.audited);
  const weakCount = auditedRows.filter((r) => r.fails >= 2).length;
  const score = auditedRows.length ? `${weakCount}/${auditedRows.length}` : '';
  if (rows.length) {
    rows[0].niche = `${cap(niche)}, ${city}`;
    rows[0].score = score;
  }
  return { query, niche, city, skipped, rows, score, weakCount, auditedCount: auditedRows.length, notes };
}

function blankRow(name, website) {
  return { niche: '', name, website, faq: '', service: '', schema: '', other: '', schemaDetail: '', weak: '', agency: '', email: '', score: '', audited: false, fails: 0,
    ownerName: '', greeting: '', rating: '', reviews: 0, priority: '', priorityScore: 0, status: '', statusDate: '', summary: '',
    mobile: null, tap: null, phone: null };
}

const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

async function auditSite(browser, { name, website, niche, place }, check, status) {
  const row = blankRow(name, website);
  const origin = new URL(website).origin;

  const visit = async (url, label) => {
    check();
    status(label);
    const nav = await browser.goto(url, 2200);
    if (!nav.ok) return { loadError: nav.error };
    let page = await browser.evaluate('window.__prospect.audit()');
    if (page && page.blocked) {
      await sleep(8000);
      page = await browser.evaluate('window.__prospect.audit()').catch(() => page);
    }
    return page;
  };

  const home = await visit(website, 'reading the homepage');
  if (!home || home.loadError) {
    const err = (home && home.loadError) || 'no response';
    row.other = /CERT/.test(err) ? 'site did not load: SSL certificate error' : `site did not load (${err})`;
    return row;
  }
  if (home.blocked) {
    row.other = 'blocked, check manually';
    return row;
  }
  const pages = [home];

  // If Maps pointed at a location subpage, look at the real homepage too.
  if (new URL(home.url).pathname.replace(/\/+$/, '') !== '') {
    const root = await visit(origin + '/', 'reading the main homepage');
    if (root && !root.loadError && !root.blocked) pages.push(root);
  }

  // Services: look at the hub page if the menu did not give enough.
  let candidates = J.serviceCandidates(pages, niche);
  const hub = pages.map((p) => p.serviceHub).find(Boolean);
  if (candidates.length < 3 && hub) {
    const hubPage = await visit(origin + hub, 'reading the services page');
    if (hubPage && !hubPage.loadError && !hubPage.blocked) {
      pages.push(hubPage);
      candidates = J.serviceCandidates(pages, niche);
    }
  }
  let servicePage = null;
  if (candidates.length >= 3) {
    servicePage = await visit(origin + candidates[0].path, 'opening a service page');
    if (servicePage && (servicePage.loadError || servicePage.blocked)) servicePage = null;
    if (servicePage) pages.push(servicePage);
  }

  // FAQ page, if one is linked.
  let faqPage = null;
  const faqLink = pages.flatMap((p) => p.faq.faqLinks).find((l) => /faq|frequently|question/i.test(l.path + ' ' + l.text));
  if (faqLink) {
    faqPage = await visit(origin + faqLink.path, 'opening the FAQ page');
    if (faqPage && (faqPage.loadError || faqPage.blocked)) faqPage = null;
    if (faqPage) pages.push(faqPage);
  }

  // Contact / about page for the email.
  const contactLinks = pages.flatMap((p) => p.links.contactAboutLinks);
  const contact = contactLinks.find((l) => /contact/i.test(l.path)) || contactLinks.find((l) => /about|team|meet|doctor|owner/i.test(l.path));
  if (contact && !pages.some((p) => new URL(p.url).pathname.replace(/\/+$/, '') === contact.path)) {
    const cp = await visit(origin + contact.path, 'opening the contact page');
    if (cp && !cp.loadError && !cp.blocked) pages.push(cp);
  }

  // The homepage again, the way a phone sees it: does it fit the screen, and can people tap to call?
  check();
  status('checking the site on a phone');
  const phoneView = browser.asPhone ? await browser.asPhone(home.url, 'window.__prospect.mobileCheck()').catch(() => null) : null;
  row.mobile = X.judgeMobile(phoneView);
  row.tap = X.judgeTap(phoneView);
  row.phone = X.judgePhone(pages, place && place.phone, place && place.phoneText);

  const svc = J.judgeService(candidates, servicePage);
  const faq = J.judgeFaq(pages, faqPage);
  const schema = J.judgeSchema(pages, niche);
  const fails = [svc.pass, faq.pass, schema.pass].filter((p) => !p).length;

  row.audited = true;
  row.fails = fails;
  row.faq = faq.pass ? 'yes' : 'no';
  row.service = svc.pass ? 'yes' : 'no';
  row.schema = schema.pass ? 'yes' : 'no';
  row.schemaDetail = schema.detail;
  row.weak = fails >= 2 ? `WEAK (${fails}/3)` : `ok (${fails}/3)`;
  row.agency = J.findAgency(pages);
  row.email = J.findEmail(pages);
  const best = J.bestEmail(pages);
  row.emailRaw = best ? best.email : '';
  row.emailKind = best ? best.kind : '';
  row.checks = { faq: faq.pass, service: svc.pass, schema: schema.pass };
  const owner = J.pickOwner(pages);
  row.ownerName = owner ? owner.name : '';
  row.greeting = owner ? owner.greeting : '';
  row.other = J.otherIssues(home, pages, row.agency);
  row.evidence = { service: svc.note, faq: faq.note, pagesChecked: pages.map((p) => p.url) };
  return row;
}

// The columns the app writes, in this order. The connector places each one under the matching header,
// adds a "#" serial number column first, and creates any column a tab does not have yet.
const HEADERS = ['Niche', 'Business Name', 'Website', 'FAQ', 'Service Page', 'Schema', 'Other Issue', 'Schema Detail',
  'Weak? (fails of 3)', 'Agency Credit', 'Owner Email', 'Weak Sites Score', 'Owner Name', 'Google Rating', 'Priority', 'Status',
  'Status Date', 'Mobile', 'Tap to Call', 'Phone vs Google', 'Audit Summary'];

// Text taken from websites must never be read as a formula by Sheets or Excel.
const safeCell = (v) => {
  const s = v == null ? '' : String(v);
  return /^[=+\-@]/.test(s) ? "'" + s : s;
};

const toSheetRow = (r) => [r.niche, r.name, r.website, r.faq, r.service, r.schema, r.other, r.schemaDetail, r.weak, r.agency, r.email, r.score,
  r.ownerName, r.rating ? `${r.rating} (${r.reviews})` : '', r.priority, r.status, r.statusDate,
  X.formatMobile(r.mobile), X.formatTap(r.tap), X.formatPhone(r.phone), r.summary].map(safeCell);

module.exports = { run, Stopped, HEADERS, toSheetRow, domainOf };
