// Turns the raw page evidence (from page-lib.js) into the yes/no answers and sheet text.
// Pure functions, no browser access.

const NICHE_WORDS = [
  [/dent|orthodon/i, /implant|crown|whitening|veneer|invisalign|root canal|braces|denture|cleaning|extraction|bridge|cosmetic|orthodont|emergency|sedation|filling|periodont|aligner/i],
  [/plumb/i, /drain|water heater|leak|sewer|repip|toilet|faucet|disposal|sump|gas line|pipe|clog/i],
  [/hvac|heating|cooling|air cond/i, /air condition|\bac\b|a\/c|furnace|heat pump|duct|install|maintenance|heating|cooling|thermostat|air quality|boiler/i],
  [/roof/i, /repair|replacement|shingle|metal|gutter|siding|storm|inspection|flat|tile|commercial|residential/i],
  [/law|attorney|legal/i, /injury|accident|divorce|custody|criminal|dui|estate|probate|bankruptcy|immigration|employment|malpractice|family law|wrongful/i],
  [/chiro/i, /adjust|decompression|massage|sciatica|back pain|neck pain|headache|injury|sports|wellness/i],
  [/electric/i, /panel|wiring|lighting|generator|ev charg|outlet|rewir|surge|install|repair/i],
  [/med ?spa|aesthetic|dermat/i, /botox|filler|laser|facial|peel|microneedl|coolsculpt|hair removal|skin|body/i],
  [/vet|animal/i, /vaccin|surgery|dental|boarding|grooming|wellness|spay|neuter|emergency|diagnostic/i],
  [/auto|mechanic|car repair/i, /brake|oil change|transmission|engine|tire|alignment|diagnos|suspension|exhaust|a\/c/i],
  [/landscap|lawn/i, /lawn|irrigation|hardscap|mowing|tree|mulch|design|patio|sod|maintenance/i],
  [/pest|extermin/i, /termite|rodent|mosquito|bed bug|ant|roach|wildlife|spider|flea/i],
  [/clean|maid|janitor/i, /deep clean|move|office|carpet|window|residential|commercial|recurring|post-construction/i],
];

// The schema.org type a niche should ideally use.
const NICHE_TYPES = [
  [/dent|orthodon/i, ['Dentist']],
  [/plumb/i, ['Plumber']],
  [/hvac|heating|cooling|air cond/i, ['HVACBusiness']],
  [/roof/i, ['RoofingContractor']],
  [/law|attorney|legal/i, ['Attorney', 'LegalService']],
  [/electric/i, ['Electrician']],
  [/vet|animal hosp/i, ['VeterinaryCare']],
  [/auto repair|mechanic|car repair/i, ['AutoRepair']],
  [/locksmith/i, ['Locksmith']],
  [/mov(ing|er)/i, ['MovingCompany']],
  [/paint/i, ['HousePainter']],
  [/hair|barber/i, ['HairSalon']],
  [/salon|beauty/i, ['BeautySalon', 'HairSalon']],
  [/contractor|remodel/i, ['GeneralContractor']],
  [/real estate|realtor/i, ['RealEstateAgent']],
  [/account|cpa|bookkeep/i, ['AccountingService']],
  [/insurance/i, ['InsuranceAgency']],
  [/restaurant/i, ['Restaurant']],
  [/gym|fitness/i, ['ExerciseGym', 'HealthClub']],
  [/optom|eye/i, ['Optician', 'Optometric']],
];
const BROAD_TYPES = new Set(['LocalBusiness', 'MedicalBusiness', 'MedicalOrganization', 'ProfessionalService',
  'HomeAndConstructionBusiness', 'Store', 'HealthAndBeautyBusiness', 'AutomotiveBusiness', 'FinancialService']);

function nicheWords(niche) {
  const hit = NICHE_WORDS.find(([re]) => re.test(niche));
  return hit ? hit[1] : null;
}

/** Candidate individual-service pages, merged from every page visited. */
function serviceCandidates(pages, niche) {
  const map = new Map();
  for (const p of pages) for (const l of p.serviceLinks || []) if (!map.has(l.path)) map.set(l.path, l.text);
  if (map.size < 3) {
    const words = nicheWords(niche);
    if (words) {
      for (const p of pages) {
        for (const l of (p.links && p.links.internal) || []) {
          if (l.path === '/' || map.has(l.path)) continue;
          if (/blog|news|article|post|tag|category|author/i.test(l.path)) continue;
          if (words.test(l.text) || words.test(l.path.replace(/[-_/]/g, ' '))) map.set(l.path, l.text);
        }
      }
    }
  }
  return [...map.entries()].map(([path, text]) => ({ path, text }));
}

function judgeService(candidates, servicePage) {
  if (candidates.length >= 3 && servicePage && !servicePage.blocked && servicePage.wordCount >= 120) {
    return { pass: true, note: `${candidates.length} service pages (e.g. ${candidates[0].path})` };
  }
  if (candidates.length >= 3) return { pass: false, note: 'service links found but the page opened was empty or thin' };
  if (candidates.length > 0) return { pass: false, note: `only ${candidates.length} service page(s) found` };
  return { pass: false, note: 'no individual service pages found' };
}

function judgeFaq(pages, faqPage) {
  if (pages.some((p) => p.faq && p.faq.hasFAQPageSchema)) return { pass: true, note: 'FAQPage schema present' };
  if (faqPage && !faqPage.blocked && (faqPage.faq.questionLines >= 3 || faqPage.faq.questionCount >= 3)) {
    return { pass: true, note: `FAQ page with ${Math.max(faqPage.faq.questionLines, faqPage.faq.questionCount)} questions` };
  }
  const best = pages.reduce((m, p) => Math.max(m, (p.faq && p.faq.questionCount) || 0), 0);
  const hasHeading = pages.some((p) => p.faq && p.faq.faqHeadings.length);
  if (best >= 3 || (hasHeading && best >= 2)) return { pass: true, note: `FAQ section with ${best} questions` };
  if (faqPage) return { pass: false, note: 'FAQ page linked but no real questions on it' };
  return { pass: false, note: 'no FAQ content found' };
}

function judgeSchema(pages, niche) {
  const labelled = pages.filter((p) => p && p.schema);
  const withBiz = labelled.filter((p) => p.schema.verdict === 'local-business');
  if (!withBiz.length) {
    const types = [...new Set(labelled.flatMap((p) => Object.keys(p.schema.typeCounts).concat(p.schema.microdataTypes)))];
    const parseErr = labelled.some((p) => p.schema.jsonLdParseErrors > 0);
    if (!types.length) return { pass: false, detail: parseErr ? 'None usable (JSON-LD has errors).' : 'None.' };
    const shown = types.filter((t) => !/^(ListItem|PostalAddress|ImageObject|EntryPoint|ReadAction|SearchAction)$/.test(t)).slice(0, 5);
    return { pass: false, detail: `Generic only: ${shown.join(', ')}. No business entity.` };
  }
  // Best entity = the one with the most fields filled in.
  let best = null;
  for (const p of withBiz) {
    for (const e of p.schema.businessEntities) if (!best || e.fieldsPresent.length > best.fieldsPresent.length) best = e;
  }
  if (!best) {
    const t = withBiz[0].schema.microdataTypes.concat(withBiz[0].schema.rdfaTypes).filter(Boolean)[0] || 'LocalBusiness';
    return { pass: true, detail: `${t} via microdata only (no JSON-LD). Thin.` };
  }
  const want = (NICHE_TYPES.find(([re]) => re.test(niche)) || [null, null])[1];
  const types = best.types;
  const specific = types.filter((t) => !BROAD_TYPES.has(t));
  const mainType = (specific[0] || types[0]);
  let typeNote = '';
  if (want && !types.some((t) => want.includes(t))) typeNote = ` (not ${want[0]})`;
  else if (!specific.length) typeNote = ' (broad type)';

  const has = (f) => best.fieldsPresent.includes(f);
  const parts = [];
  if (has('name')) parts.push('name');
  if (has('address')) parts.push(best.addressIsStructured ? 'address' : 'address (text only)');
  if (has('telephone')) parts.push('phone');
  if (has('openingHours') || has('openingHoursSpecification')) parts.push('hours');
  if (has('geo')) parts.push('geo');
  if (has('sameAs')) parts.push('sameAs');
  if (has('aggregateRating')) parts.push('rating');
  if (has('areaServed')) parts.push('areaServed');
  const extras = [];
  const serviceNodes = withBiz.reduce((m, p) => Math.max(m, (p.schema.typeCounts.Service || 0) + (p.schema.typeCounts.MedicalProcedure || 0)), 0);
  if (serviceNodes) extras.push(`${serviceNodes} service${serviceNodes > 1 ? 's' : ''}`);
  else if (has('hasOfferCatalog') || has('makesOffer') || has('availableService')) extras.push('services');
  if (labelled.some((p) => p.schema.hasFAQPageSchema)) extras.push('FAQPage');

  const missing = best.coreMissing.map((f) => (f === 'telephone' ? 'phone' : f));
  const depth = ['openingHours', 'openingHoursSpecification', 'geo', 'sameAs', 'aggregateRating', 'areaServed', 'hasOfferCatalog', 'makesOffer']
    .filter(has).length + (serviceNodes ? 1 : 0);
  let grade = 'OK';
  if (missing.length || (!specific.length && depth < 2) || depth === 0) grade = 'Thin';
  else if (depth >= 3 && !typeNote) grade = 'Strong';
  const where = withBiz.length < labelled.length && labelled.length > 1 ? ` On ${withBiz.length} of ${labelled.length} pages checked.` : '';
  let detail = `${mainType}${typeNote}: ${parts.join(', ')}`;
  if (extras.length) detail += ` + ${extras.join(', ')}`;
  if (missing.length) detail += `. Missing ${missing.join(', ')}`;
  detail += `. ${grade}.${where}`;
  return { pass: true, detail };
}

const PLATFORM_ONLY = /wix|squarespace|godaddy|weebly|wordpress|shopify|webflow|duda|google|elementor|hubspot/i;

function findAgency(pages) {
  for (const p of pages) {
    for (const m of (p.footer && p.footer.creditMatches) || []) {
      const cleaned = m.replace(/\s+/g, ' ').replace(/(privacy|terms|sitemap|accessibility|all rights).*$/i, '').trim();
      const who = cleaned.replace(/^.*?\b(by|:)\s+/i, '');
      if (who.length < 2 || PLATFORM_ONLY.test(who)) continue;
      return cleaned.slice(0, 70);
    }
  }
  for (const p of pages) {
    for (const l of (p.footer && p.footer.footerExternalLinks) || []) {
      if (/design|market|agency|\bweb\b|seo|media|digital|studio|creative|interactive|solutions/i.test(l.text + ' ' + l.host) && !PLATFORM_ONLY.test(l.host)) {
        return `${l.text || l.host} (${l.host})`.slice(0, 70);
      }
    }
  }
  const platform = platformOf(pages);
  return platform ? `none (${platform})` : 'none';
}

function platformOf(pages) {
  for (const p of pages) {
    const hints = (p.footer && p.footer.platformHints) || [];
    const builder = hints.find((h) => /Wix|Squarespace|GoDaddy|Weebly|Duda|Webflow|Shopify/.test(h));
    if (builder) return builder;
  }
  for (const p of pages) {
    const hints = (p.footer && p.footer.platformHints) || [];
    if (hints.length) return hints[0];
  }
  return null;
}

// Free mailbox providers: a business may well use one of these as its real address.
const FREE_MAIL = /^(gmail|googlemail|yahoo|ymail|rocketmail|outlook|hotmail|live|msn|aol|icloud|me|mac|comcast|att|sbcglobal|bellsouth|verizon|cox|charter|earthlink|protonmail|proton|gmx|zoho|mail|btinternet|sky|virginmedia|bigpond|optusnet|xtra|eircom|shaw|rogers|sympatico|telus)\.[a-z.]{2,6}$/;
// Placeholder, system and role addresses nobody reads (a theme's demo "crud@", "test@", "webmaster@").
const JUNK_BOX = /^(crud|test|testing|tester|example|sample|demo|user|username|name|email|e-mail|your|yourname|youremail|yourmail|first\.?last|john|jane|johndoe|janedoe|someone|wordpress|wp|webmaster|hostmaster|postmaster|abuse|root|noreply|no-reply|donotreply|do-not-reply|privacy|legal|dmca|security|unsubscribe|bounces?|mailer-daemon)\d*$/;
const baseOf = (domain) => String(domain || '').replace(/^www\./, '').split('.').slice(0, -1).join('.').replace(/^(co|com)\./, '');
/** Domains belong together when they share a long chunk of their name ("plazadental.com" / "plazadentalkc.net"). */
function related(a, b) {
  a = baseOf(a).replace(/[^a-z0-9]/g, '');
  b = baseOf(b).replace(/[^a-z0-9]/g, '');
  if (!a || !b) return false;
  for (let i = 0; i + 6 <= a.length; i++) if (b.includes(a.slice(i, i + 6))) return true;
  return false;
}
/**
 * Only addresses that belong to the business: on its own domain, a closely related one, or a free mailbox.
 * An address on another company's domain is usually the web agency, a supplier or a theme placeholder,
 * and emailing them a critique of their client would be a real mistake.
 */
function usableEmail(e, siteHost) {
  const [local, domain] = e.email.split('@');
  if (!domain || JUNK_BOX.test(local)) return false;
  return e.sameDomain || FREE_MAIL.test(domain) || related(domain, siteHost);
}

function bestEmail(pages) {
  const all = new Map();
  for (const p of pages) {
    let host = '';
    try { host = new URL(p.url).hostname.replace(/^www\./, ''); } catch (err) {}
    for (const e of p.emails || []) if (!all.has(e.email) && usableEmail(e, host)) all.set(e.email, e);
  }
  const list = [...all.values()];
  const rank = (e) => (e.mailbox === 'personal-looking' ? 0 : 2) + (e.sameDomain ? 0 : 1);
  list.sort((a, b) => rank(a) - rank(b));
  return list.length ? { email: list[0].email, kind: list[0].mailbox === 'generic' ? 'generic' : 'personal' } : null;
}

function findEmail(pages) {
  const best = bestEmail(pages);
  if (best) return `${best.email} (${best.kind})`;
  return pages.some((p) => p.hasContactForm) ? 'not found (form only)' : 'not found';
}

function otherIssues(home, pages, agency) {
  const notes = [];
  const platform = platformOf(pages);
  if (platform && /Wix|Squarespace|GoDaddy|Weebly/.test(platform) && /^none/.test(agency || 'none')) {
    notes.push(`${platform.replace(/ builder$/, '')} builder site`);
  }
  if (home.wordCount < 250) notes.push(`thin homepage (${home.wordCount} words)`);
  const years = ((home.footer && home.footer.footerText) || '').match(/(?:©|copyright)\s*(?:\d{4}\s*[-–]\s*)?(20\d{2})/i);
  if (years && Number(years[1]) < new Date().getFullYear() - 1) notes.push(`footer copyright ${years[1]}`);
  if (!home.h1) notes.push('no H1 heading');
  if (/^http:/.test(home.url)) notes.push('no HTTPS');
  return notes.join('; ');
}

/**
 * The owner or lead practitioner, only when the site makes it clear. A wrong name in a greeting
 * is worse than no name, so with several equally prominent people this returns null.
 */
function pickOwner(pages) {
  const all = new Map();
  for (const p of pages) {
    for (const person of p.people || []) {
      const key = person.name.toLowerCase();
      const cur = all.get(key) || { name: person.name, doctor: false, owner: false, score: 0 };
      cur.doctor = cur.doctor || person.doctor;
      cur.owner = cur.owner || person.owner;
      cur.score += person.score;
      all.set(key, cur);
    }
  }
  const list = [...all.values()].sort((a, b) => b.score - a.score);
  const owners = list.filter((p) => p.owner);
  let pick = null;
  if (owners.length) pick = owners[0];
  else {
    const doctors = list.filter((p) => p.doctor);
    if (doctors.length === 1) pick = doctors[0];
    else if (doctors.length > 1 && doctors[0].score >= doctors[1].score * 2) pick = doctors[0];
  }
  if (!pick) return null;
  const parts = pick.name.split(/\s+/);
  return {
    name: (pick.doctor ? 'Dr. ' : '') + pick.name,
    greeting: pick.doctor ? `Dr. ${parts[parts.length - 1]}` : parts[0],
  };
}

/** How worthwhile this prospect is, for weak sites only. Returns { score, label, reasons }. */
function priority(row) {
  let score = 0;
  const why = [];
  const reviews = row.reviews || 0;
  if (reviews >= 200) { score += 30; why.push(`${reviews} reviews`); }
  else if (reviews >= 75) { score += 22; why.push(`${reviews} reviews`); }
  else if (reviews >= 25) score += 12;
  else score += 4;
  if (Number(row.rating) >= 4.5) score += 5;
  score += row.fails >= 3 ? 25 : 18;
  if (row.emailKind === 'personal') { score += 20; why.push('personal email'); }
  else if (row.emailKind === 'generic') score += 10;
  else why.push('no email');
  if (/^none/.test(row.agency || 'none')) { score += 10; why.push('no agency'); }
  else why.push('has an agency');
  if (row.ownerName) { score += 10; why.push('owner known'); }
  // Problems an owner feels straight away make the email land harder.
  if (row.phone && row.phone.state === 'different') { score += 8; why.push('phone differs from Google'); }
  if (row.mobile && !row.mobile.ok) { score += 8; why.push('not built for phones'); }
  else if (row.tap && !row.tap.ok) { score += 4; why.push('no tap-to-call'); }
  const label = score >= 65 ? 'High' : score >= 45 ? 'Medium' : 'Low';
  return { score, label, reasons: why };
}

module.exports = { pickOwner, priority, serviceCandidates, judgeService, judgeFaq, judgeSchema, findAgency, findEmail, bestEmail, otherIssues };
